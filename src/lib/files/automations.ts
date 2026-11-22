import "server-only";
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { recordEmail } from "@/lib/email/outbox";
import { expiredEmail } from "@/lib/email/templates";
import { reminderEmailFor, SIGN_KINDS } from "./actions";
import { automationsEnabled, dueReminder } from "./reminders";
import { emit } from "@/lib/integrations/dispatch";

/**
 * Time-based automations, run from the /api/health sweep (the uptime pinger hits it every few
 * minutes). All state is in Postgres; every step is idempotent, so overlapping or repeated
 * sweeps are safe:
 *  - expiry: a conditional status update (only one sweep wins) + one email to the firm
 *  - reminders: one outbox row per (signer, schedule slot), enforced by a unique index
 *
 * `now` is a parameter so tests can move time forward without touching the clock.
 */

const OPEN = ["sent", "partially_signed"] as const;

export { automationsEnabled };

let running: Promise<unknown> | null = null;
let lastRun = 0;

/** Called (not awaited) by /api/health. Single-flight, at most once a minute per process. */
export function sweepAutomations(baseUrl: string) {
  if (!automationsEnabled() || running || Date.now() - lastRun < 60_000) return;
  lastRun = Date.now();
  running = runAutomations({ now: new Date(), baseUrl })
    .then(() => import("@/lib/integrations/deliveries").then((m) => m.sweepDeliveries()))
    .then(() => import("@/lib/bulk/worker").then((m) => m.resumeBatches()))
    .catch((e) => console.error("automations sweep failed", (e as Error).message))
    .finally(() => {
      running = null;
    });
}

export async function runAutomations(o: { now: Date; baseUrl: string; fileId?: string; companyId?: string }) {
  const expired = await expireDueFiles(o);
  const reminded = await sendDueReminders(o);
  return { expired, reminded };
}

async function expireDueFiles(o: { now: Date; baseUrl: string; fileId?: string; companyId?: string }) {
  const due = await db
    .select({ id: schema.files.id })
    .from(schema.files)
    .where(
      and(
        inArray(schema.files.status, [...OPEN]),
        lte(schema.files.expiresAt, o.now),
        o.fileId ? eq(schema.files.id, o.fileId) : undefined,
        o.companyId ? eq(schema.files.companyId, o.companyId) : undefined,
      ),
    )
    .limit(25);
  let n = 0;
  for (const f of due) if (await expireFile(f.id, o.now, o.baseUrl)) n++;
  return n;
}

/**
 * Marks a File Expired (if it's still out for signature and past its expiry) and emails the
 * firm. Links then show the expired page. Returns false if another sweep or a link open got
 * there first. Also used lazily when a link is opened.
 */
export async function expireFile(fileId: string, now: Date, baseUrl: string) {
  const expired = await db.transaction(async (tx) => {
    const [file] = await tx
      .update(schema.files)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(schema.files.id, fileId), inArray(schema.files.status, [...OPEN]), lte(schema.files.expiresAt, now)))
      .returning();
    if (!file) return false;
    const [waiting, [company], [t], [owner]] = await Promise.all([
      tx
        .select({ name: schema.recipients.name })
        .from(schema.recipients)
        .where(and(eq(schema.recipients.documentId, file.currentDocumentId!), inArray(schema.recipients.status, ["active", "viewed"])))
        .orderBy(asc(schema.recipients.signingOrder)),
      tx.select({ name: schema.companies.name, color: schema.companies.brandColor }).from(schema.companies).where(eq(schema.companies.id, file.companyId)),
      file.templateId ? tx.select({ name: schema.templates.name }).from(schema.templates).where(eq(schema.templates.id, file.templateId)) : Promise.resolve([]),
      // The File's owner; if they've left, the company's first admin.
      tx
        .select({ name: schema.users.name, email: schema.users.email })
        .from(schema.users)
        .where(and(eq(schema.users.companyId, file.companyId), file.ownerUserId ? or(eq(schema.users.id, file.ownerUserId), eq(schema.users.role, "admin")) : eq(schema.users.role, "admin")))
        .orderBy(sql`${schema.users.id}::text = ${file.ownerUserId ?? ""} desc`, asc(schema.users.createdAt))
        .limit(1),
    ]);
    const waitingOn = waiting.map((w) => w.name).join(" and ") || null;
    await tx.insert(schema.events).values({ companyId: file.companyId, fileId, actorType: "system", type: "file.expired", data: { expiresAt: file.expiresAt?.toISOString(), waitingOn } });
    if (owner && company) {
      const email = expiredEmail({ brand: company, recipientName: owner.name, documentName: t?.name ?? "the agreement", clientLegalName: file.clientLegalName, waitingOn, fileUrl: `${baseUrl}/files/${fileId}` });
      await recordEmail(tx, { companyId: file.companyId, fileId, kind: "expired", toEmail: owner.email, toName: owner.name, ...email });
    }
    return file.companyId;
  });
  if (!expired) return false;
  emit({ event: "file.expired", companyId: expired, fileId, baseUrl, at: now });
  return true;
}

async function sendDueReminders(o: { now: Date; baseUrl: string; fileId?: string; companyId?: string }) {
  const r = schema.recipients;
  const f = schema.files;
  const c = schema.companies;
  const candidates = await db
    .select({
      recipient: r,
      file: f,
      company: { name: c.name, color: c.brandColor, enabled: c.remindersEnabled, days: c.reminderDays, finalDays: c.finalReminderDays },
      ownerName: schema.users.name,
      lastEmailedAt: sql<string | null>`(select max(o.created_at) from outbox o where o.recipient_id = ${r.id} and o.kind in (${sql.join(
        SIGN_KINDS.map((k) => sql`${k}`),
        sql`, `,
      )}))`,
    })
    .from(r)
    .innerJoin(f, and(eq(f.id, r.fileId), eq(f.currentDocumentId, r.documentId)))
    .innerJoin(c, eq(c.id, r.companyId))
    .leftJoin(schema.users, eq(schema.users.id, f.ownerUserId))
    .where(
      and(
        inArray(r.status, ["active", "viewed"]),
        inArray(f.status, [...OPEN]),
        eq(c.remindersEnabled, true),
        or(isNull(f.expiresAt), gt(f.expiresAt, o.now)),
        o.fileId ? eq(f.id, o.fileId) : undefined,
        o.companyId ? eq(f.companyId, o.companyId) : undefined,
      ),
    )
    .orderBy(asc(r.activatedAt))
    .limit(100);

  let sent = 0;
  for (const row of candidates) {
    const due = dueReminder(
      { enabled: row.company.enabled, days: row.company.days ?? [], finalDays: row.company.finalDays },
      { activatedAt: row.recipient.activatedAt ?? row.recipient.createdAt, expiresAt: row.file.expiresAt, now: o.now, lastEmailedAt: row.lastEmailedAt ? new Date(row.lastEmailedAt) : null },
    );
    if (!due) continue;
    const ok = await db.transaction(async (tx) => {
      // Re-check under lock: still this signer's turn, File still open.
      const [file] = await tx.select().from(f).where(eq(f.id, row.file.id)).for("update");
      const [cur] = await tx.select({ status: r.status }).from(r).where(eq(r.id, row.recipient.id));
      if (!file || !OPEN.includes(file.status as (typeof OPEN)[number]) || file.currentDocumentId !== row.recipient.documentId) return false;
      if (cur?.status !== "active" && cur?.status !== "viewed") return false;
      const email = await reminderEmailFor(tx, file, row.recipient, { name: row.company.name, color: row.company.color }, o.baseUrl, row.ownerName ?? row.company.name);
      const id = await recordEmail(tx, { companyId: file.companyId, fileId: file.id, recipientId: row.recipient.id, kind: "reminder", toEmail: row.recipient.email, toName: row.recipient.name, ...email, reminderSlot: due.slot });
      if (!id) return false; // this slot was already sent
      await tx.insert(schema.events).values({
        companyId: file.companyId,
        fileId: file.id,
        recipientId: row.recipient.id,
        actorType: "system",
        type: "file.reminded",
        data: { to: row.recipient.name, email: row.recipient.email, slot: due.slot, final: due.final },
      });
      return true;
    });
    if (ok) sent++;
  }
  return sent;
}

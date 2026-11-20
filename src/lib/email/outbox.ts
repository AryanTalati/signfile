import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getObject } from "@/lib/storage";
import { gmailConfig, isTestAddress, sendGmail } from "./gmail";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The outbox is the record of every email, saved BEFORE any send attempt. Delivery
 * (Gmail API over HTTPS) runs after the surrounding transaction commits, in the
 * background: it never blocks or breaks signing. Statuses:
 *   queued   -> waiting to be sent
 *   sent     -> delivered to Gmail
 *   failed   -> Gmail refused or errored (error text kept, no secrets); can be retried
 *   captured -> recorded but intentionally not sent (sending off here, or a test address)
 */
export async function recordEmail(
  tx: Tx,
  e: {
    companyId: string;
    fileId?: string;
    recipientId?: string;
    kind: string;
    toEmail: string;
    toName?: string;
    subject: string;
    html: string;
    text: string;
    attachments?: { filename: string; storageKey: string }[];
  },
) {
  const configured = !!gmailConfig();
  const test = isTestAddress(e.toEmail);
  const status = configured && !test ? "queued" : "captured";
  const [row] = await tx
    .insert(schema.outbox)
    .values({
      ...e,
      attachments: e.attachments ?? [],
      status,
      provider: status === "queued" ? "gmail" : null,
      error: !configured ? "Sending is off in this environment." : test ? "Test address: not sent." : null,
    })
    .returning({ id: schema.outbox.id });
  if (status === "queued") scheduleDelivery(row.id);
  return row.id;
}

const inflight = new Set<string>();

function scheduleDelivery(id: string, delayMs = 1500, tries = 0) {
  setTimeout(() => {
    deliverOutbox(id).then(
      (r) => {
        // The row may not be visible yet if the transaction was slow to commit.
        if (r === "missing" && tries < 3) scheduleDelivery(id, 10_000, tries + 1);
      },
      (err) => console.error("outbox delivery crashed", id, (err as Error).message),
    );
  }, delayMs).unref?.();
}

/** Sends one queued email. Claims the row first so it can't be sent twice. */
export async function deliverOutbox(id: string): Promise<"sent" | "failed" | "missing" | "skipped"> {
  if (inflight.has(id)) return "skipped";
  const cfg = gmailConfig();
  if (!cfg) return "skipped";
  inflight.add(id);
  try {
    const [row] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, id));
    if (!row) return "missing";
    if (row.status !== "queued") return "skipped";
    const claimed = await db
      .update(schema.outbox)
      .set({ attempts: row.attempts + 1 })
      .where(and(eq(schema.outbox.id, id), eq(schema.outbox.status, "queued"), eq(schema.outbox.attempts, row.attempts)))
      .returning({ id: schema.outbox.id });
    if (!claimed.length) return "skipped";
    const [company] = await db.select({ name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, row.companyId));
    try {
      const attachments = await Promise.all(
        (row.attachments ?? []).map(async (a) => ({ filename: a.filename, contentType: "application/pdf", content: new Uint8Array(await getObject(a.storageKey)) })),
      );
      const messageId = await sendGmail(cfg, {
        fromName: company?.name ?? "SignFile",
        to: row.toEmail,
        toName: row.toName,
        subject: row.subject,
        text: row.text,
        html: row.html,
        attachments,
      });
      await db.update(schema.outbox).set({ status: "sent", sentAt: new Date(), providerMessageId: messageId, error: null }).where(eq(schema.outbox.id, id));
      return "sent";
    } catch (err) {
      const msg = ((err as Error).message || "Unknown error").slice(0, 500);
      await db.update(schema.outbox).set({ status: "failed", error: msg }).where(eq(schema.outbox.id, id));
      console.error("email send failed", id, msg);
      return "failed";
    }
  } finally {
    inflight.delete(id);
  }
}

/** Retries emails left queued (e.g. the process restarted mid-send). Cheap when there are none. */
export async function sweepOutbox() {
  if (!gmailConfig()) return 0;
  const rows = await db
    .select({ id: schema.outbox.id })
    .from(schema.outbox)
    .where(and(eq(schema.outbox.status, "queued"), lt(schema.outbox.createdAt, sql`now() - interval '1 minute'`), lt(schema.outbox.attempts, 3)))
    .limit(20);
  for (const r of rows) await deliverOutbox(r.id);
  return rows.length;
}

/** Manual retry of a failed email (company-scoped by the caller). */
export async function retryOutbox(companyId: string, id: string) {
  const updated = await db
    .update(schema.outbox)
    .set({ status: "queued", error: null })
    .where(and(eq(schema.outbox.id, id), eq(schema.outbox.companyId, companyId), eq(schema.outbox.status, "failed")))
    .returning({ id: schema.outbox.id });
  if (!updated.length) return null;
  return deliverOutbox(id);
}

export const sendingEnabled = () => !!gmailConfig();

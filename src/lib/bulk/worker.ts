import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { type AuthContext, withRequestMeta } from "@/lib/auth/session";
import { db, schema } from "@/lib/db/client";
import { createAndSendFile } from "@/lib/files/service";
import { emit } from "@/lib/integrations/dispatch";
import type { RowValues } from "./core";

/**
 * Processes a bulk run in the background, one row at a time. Resumable: each row is claimed
 * inside the transaction that creates its File (status 'pending' -> 'sent'), so a restart or a
 * second worker never sends a row twice; a run left 'running' is picked up again by the health
 * sweep or when someone opens it. Emails go through the normal outbox (Gmail / test capture).
 */

const running = new Set<string>();
/** Spacing between Files, so a big run doesn't burst the email provider. */
const rowDelay = () => (process.env.E2E_HOOKS === "1" ? 0 : Number(process.env.BULK_ROW_DELAY_MS ?? 400));

class AlreadyDone extends Error {}

export function kickBatch(batchId: string) {
  if (running.has(batchId)) return;
  running.add(batchId);
  void runBatch(batchId)
    .catch((e) => console.error("bulk run failed", batchId, (e as Error).message))
    .finally(() => running.delete(batchId));
}

/** Resume runs left unfinished (restart, deploy). Called from the health sweep. */
export async function resumeBatches() {
  const open = await db.select({ id: schema.bulkBatches.id }).from(schema.bulkBatches).where(eq(schema.bulkBatches.status, "running")).limit(5);
  for (const b of open) kickBatch(b.id);
}

async function runBatch(batchId: string) {
  const [batch] = await db.select().from(schema.bulkBatches).where(eq(schema.bulkBatches.id, batchId));
  if (!batch || batch.status !== "running") return;
  const meta = batch.meta as { ip: string | null; userAgent: string | null; baseUrl?: string };
  const baseUrl = meta.baseUrl ?? process.env.APP_URL ?? "";
  // The run acts as the person who confirmed it (their Files, their audit events).
  const [row] = batch.createdById
    ? await db
        .select({ user: schema.users, company: schema.companies })
        .from(schema.users)
        .innerJoin(schema.companies, eq(schema.companies.id, schema.users.companyId))
        .where(and(eq(schema.users.id, batch.createdById), eq(schema.users.companyId, batch.companyId)))
    : [];
  const auth: AuthContext | null = row
    ? {
        user: { id: row.user.id, email: row.user.email, name: row.user.name, title: row.user.title, role: row.user.role as "admin" | "member" },
        company: { id: row.company.id, name: row.company.name, slug: row.company.slug, brandColor: row.company.brandColor, logoKey: row.company.logoKey },
        sessionId: `bulk:${batchId}`,
      }
    : null;

  for (;;) {
    const [next] = await db
      .select()
      .from(schema.bulkRows)
      .where(and(eq(schema.bulkRows.batchId, batchId), eq(schema.bulkRows.status, "pending")))
      .orderBy(asc(schema.bulkRows.rowNo))
      .limit(1);
    if (!next) break;
    if (!auth) {
      await failRow(next.id, "the person who started this run no longer has an account");
      continue;
    }
    const v = next.values as unknown as RowValues;
    try {
      await withRequestMeta({ ip: meta.ip, userAgent: meta.userAgent }, () =>
        createAndSendFile(
          auth,
          {
            templateId: batch.templateId!,
            clientLegalName: v.clientLegalName,
            reference: v.reference || v.externalId || "",
            signerName: v.signerName,
            signerTitle: v.signerTitle,
            signerEmail: v.signerEmail,
            signNow: false,
            sendNow: batch.sendNow,
            firmValues: v.firmValues,
            ccEmails: v.ccEmails ? v.ccEmails.split(", ") : [],
          },
          baseUrl,
          {
            bulkBatchId: batchId,
            // Claim the row in the File's own transaction: done exactly once, or not at all.
            inTx: async (tx, fileId) => {
              const claimed = await tx
                .update(schema.bulkRows)
                .set({ status: batch.sendNow ? "sent" : "draft", fileId, processedAt: new Date() })
                .where(and(eq(schema.bulkRows.id, next.id), eq(schema.bulkRows.status, "pending")))
                .returning({ id: schema.bulkRows.id });
              if (!claimed.length) throw new AlreadyDone();
            },
          },
        ),
      );
    } catch (e) {
      if (!(e instanceof AlreadyDone)) await failRow(next.id, batch.templateId ? (e as Error).message.slice(0, 300) : "the template was deleted");
    }
    await refreshCounts(batchId);
    const d = rowDelay();
    if (d) await new Promise((r) => setTimeout(r, d));
  }
  await finish(batchId, baseUrl);
}

async function failRow(rowId: string, reason: string) {
  await db
    .update(schema.bulkRows)
    .set({ status: "failed", reason, processedAt: new Date() })
    .where(and(eq(schema.bulkRows.id, rowId), eq(schema.bulkRows.status, "pending")));
}

async function refreshCounts(batchId: string) {
  const rows = (await db.execute(sql`select status, count(*)::int as n from bulk_rows where batch_id = ${batchId} group by status`)) as unknown as { status: string; n: number }[];
  const counts: Record<string, number> = { total: 0, pending: 0, sent: 0, draft: 0, skipped: 0, failed: 0 };
  for (const r of rows) {
    counts[r.status] = r.n;
    counts.total += r.n;
  }
  await db.update(schema.bulkBatches).set({ counts }).where(eq(schema.bulkBatches.id, batchId));
  return counts;
}

async function finish(batchId: string, baseUrl: string) {
  const counts = await refreshCounts(batchId);
  const [b] = await db
    .update(schema.bulkBatches)
    .set({ status: "completed", finishedAt: new Date() })
    .where(and(eq(schema.bulkBatches.id, batchId), eq(schema.bulkBatches.status, "running")))
    .returning();
  if (!b) return; // another worker finished it
  await db.insert(schema.events).values({ companyId: b.companyId, actorType: "system", type: "bulk.completed", data: { batchId, template: b.templateName, ...counts } });
  emit({ event: "bulk.completed", companyId: b.companyId, fileId: null, baseUrl, batch: { id: batchId, templateName: b.templateName, counts, resultUrl: `${baseUrl}/api/bulk/${batchId}/result.csv` } });
}

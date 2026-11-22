import "server-only";
import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type AuthContext, requestMeta } from "@/lib/auth/session";
import { db, schema } from "@/lib/db/client";
import { validateFields } from "@/lib/fields/validate";
import { getTemplate } from "@/lib/templates/service";
import { autoMap, type Column, columnsFor, MAX_ROWS, parseCsv, type PreviewRow, resultCsv, validateRows } from "./core";

/**
 * Bulk send. Nothing is created or sent until the firm confirms a preview; the server
 * re-validates on confirm; each row has an idempotency key so the same CSV can't email a
 * client twice by accident. Every File goes through the normal createAndSendFile path.
 */

/** A row that produced a File within this window counts as "already sent". */
const ALREADY_SENT_DAYS = 90;

export class BulkError extends Error {}

export async function bulkSetup(auth: AuthContext, templateId: string) {
  const t = await getTemplate(auth, templateId);
  if (!t || t.template.revisionForFileId) return null;
  const v = t.version;
  return { template: { id: t.template.id, name: t.template.name }, columns: columnsFor(v.fields), problems: validateFields(v.fields, v.roles ?? [], v.pageCount) };
}

export const bulkInputSchema = z.object({
  csv: z.string().min(1, "The CSV is empty.").max(2_000_000, "That CSV is too large."),
  filename: z.string().max(200).default("upload.csv"),
  /** Column key -> CSV header index (-1 = not mapped). */
  mapping: z.record(z.string(), z.number().int().min(-1)),
  /** Row numbers to send again although they were already sent. */
  resend: z.array(z.number().int().min(1)).max(MAX_ROWS).default([]),
  sendNow: z.boolean().default(true),
});
export type BulkInput = z.infer<typeof bulkInputSchema>;

async function alreadySent(companyId: string, keys: string[]) {
  const out = new Map<string, { fileId: string; at: string }>();
  if (!keys.length) return out;
  const rows = await db
    .select({ key: schema.bulkRows.rowKey, fileId: schema.bulkRows.fileId, at: schema.bulkRows.processedAt })
    .from(schema.bulkRows)
    .where(
      and(
        eq(schema.bulkRows.companyId, companyId),
        inArray(schema.bulkRows.rowKey, keys),
        inArray(schema.bulkRows.status, ["sent", "draft"]),
        isNotNull(schema.bulkRows.fileId),
        gt(schema.bulkRows.processedAt, sql`now() - make_interval(days => ${ALREADY_SENT_DAYS})`),
      ),
    )
    .orderBy(desc(schema.bulkRows.processedAt));
  for (const r of rows) if (!out.has(r.key)) out.set(r.key, { fileId: r.fileId!, at: r.at!.toISOString() });
  return out;
}

/** Parses, maps and validates. Read-only: creates nothing (this is also "Validate only"). */
export async function previewBulk(auth: AuthContext, templateId: string, input: BulkInput, baseUrl: string) {
  const setup = await bulkSetup(auth, templateId);
  if (!setup) throw new BulkError("Template not found.");
  if (setup.problems.length) throw new BulkError(`This template isn't ready to send: ${setup.problems[0]}`);
  const all = parseCsv(input.csv);
  if (all.length < 2) throw new BulkError("The CSV needs a header row and at least one client row.");
  const [headers, ...data] = all;
  if (data.length > MAX_ROWS) throw new BulkError(`At most ${MAX_ROWS} rows per bulk send (this file has ${data.length}).`);
  const missing = setup.columns.filter((c) => c.required && !(input.mapping[c.key] >= 0 && input.mapping[c.key] < headers.length));
  if (missing.length) throw new BulkError(`Choose a CSV column for: ${missing.map((c) => c.label).join(", ")}.`);
  const first = validateRows(data, setup.columns, input.mapping, templateId);
  const sent = await alreadySent(auth.company.id, [...new Set(first.map((r) => r.key))]);
  const rows = validateRows(data, setup.columns, input.mapping, templateId, sent, new Set(input.resend));
  const counts = { total: rows.length, ready: 0, invalid: 0, duplicate: 0, already_sent: 0 };
  for (const r of rows) counts[r.status]++;
  // The validation result as a CSV (what would happen to each row; nothing is created).
  const csv = resultCsv(
    headers,
    rows.map((r) => ({ cells: r.cells, status: r.status === "ready" ? "would send" : "skipped", link: r.previous ? `${baseUrl}/files/${r.previous.fileId}` : "", reason: r.reasons.join("; ") })),
  );
  return { template: setup.template, columns: setup.columns, headers, rows, counts, resultCsv: csv };
}

/** Confirmed: re-validates on the server, stores the run, and queues the ready rows. Returns the batch id. */
export async function startBulk(auth: AuthContext, templateId: string, input: BulkInput, baseUrl: string) {
  const p = await previewBulk(auth, templateId, input, baseUrl);
  if (!p.counts.ready) throw new BulkError("No rows are ready to send.");
  const meta = await requestMeta();
  const skippedReason = (r: PreviewRow) => r.reasons.join("; ") || r.status;
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(schema.bulkBatches)
      .values({
        companyId: auth.company.id,
        templateId,
        templateName: p.template.name,
        createdById: auth.user.id,
        filename: input.filename.slice(0, 200) || "upload.csv",
        headers: p.headers,
        sendNow: input.sendNow,
        counts: { total: p.counts.total, pending: p.counts.ready, skipped: p.counts.total - p.counts.ready, sent: 0, draft: 0, failed: 0 },
        meta: { ...meta, baseUrl } as never,
      })
      .returning({ id: schema.bulkBatches.id });
    for (let i = 0; i < p.rows.length; i += 200)
      await tx.insert(schema.bulkRows).values(
        p.rows.slice(i, i + 200).map((r) => ({
          companyId: auth.company.id,
          batchId: batch.id,
          rowNo: r.rowNo,
          rowKey: r.key,
          clientLegalName: r.values.clientLegalName,
          cells: r.cells,
          values: r.values as unknown as Record<string, unknown>,
          status: (r.status === "ready" ? "pending" : "skipped") as "pending" | "skipped",
          reason: r.status === "ready" ? null : skippedReason(r),
          processedAt: r.status === "ready" ? null : new Date(),
        })),
      );
    await tx.insert(schema.events).values({
      companyId: auth.company.id,
      actorType: "user",
      actorId: auth.user.id,
      actorLabel: auth.user.name,
      type: "bulk.started",
      data: { batchId: batch.id, templateId, template: p.template.name, total: p.counts.total, toSend: p.counts.ready, skipped: p.counts.total - p.counts.ready, sendNow: input.sendNow },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return batch.id;
  });
}

export async function listBatches(auth: AuthContext) {
  return db.select().from(schema.bulkBatches).where(eq(schema.bulkBatches.companyId, auth.company.id)).orderBy(desc(schema.bulkBatches.createdAt)).limit(100);
}

export async function getBatch(auth: AuthContext, batchId: string) {
  if (!z.string().uuid().safeParse(batchId).success) return null;
  const [batch] = await db.select().from(schema.bulkBatches).where(and(eq(schema.bulkBatches.id, batchId), eq(schema.bulkBatches.companyId, auth.company.id)));
  if (!batch) return null;
  const rows = await db
    .select({ rowNo: schema.bulkRows.rowNo, cells: schema.bulkRows.cells, values: schema.bulkRows.values, status: schema.bulkRows.status, reason: schema.bulkRows.reason, fileId: schema.bulkRows.fileId })
    .from(schema.bulkRows)
    .where(and(eq(schema.bulkRows.batchId, batchId), eq(schema.bulkRows.companyId, auth.company.id)))
    .orderBy(asc(schema.bulkRows.rowNo));
  return { batch, rows };
}

/** The run's result: every input row + File status + File link or skip reason. */
export function batchResultCsv(b: NonNullable<Awaited<ReturnType<typeof getBatch>>>, baseUrl: string) {
  return resultCsv(
    b.batch.headers,
    b.rows.map((r) => ({ cells: r.cells, status: r.status, link: r.fileId ? `${baseUrl}/files/${r.fileId}` : "", reason: r.reason ?? "" })),
  );
}

export { autoMap, columnsFor, type Column };

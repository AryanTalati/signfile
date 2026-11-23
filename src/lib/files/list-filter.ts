/**
 * Files list search + status filter. Built as one SQL condition, always ANDed with the
 * company's own scope, so a search can never reach another firm's Files.
 */
import { and, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

export const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "waiting_client", label: "Waiting on client" },
  { key: "waiting_firm", label: "Waiting on firm" },
  { key: "completed", label: "Completed" },
  { key: "stopped", label: "Declined / Changes requested" },
  { key: "voided", label: "Voided" },
  { key: "expired", label: "Expired" },
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number]["key"];

export interface FilesQuery {
  q: string;
  status: StatusFilter;
}

/** From the URL: trimmed search (max 100 chars) and a known status, else "all". */
export function parseFilesQuery(p: { q?: string | string[]; status?: string | string[] }): FilesQuery {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = one(p.status);
  return { q: one(p.q).trim().slice(0, 100), status: STATUS_FILTERS.some((s) => s.key === status) ? (status as StatusFilter) : "all" };
}

/** A partial, literal match: % and _ typed by the user match themselves, not "anything". */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The role the File is waiting on: the first live signer of its current version. */
export const waitingOnSql = sql<string | null>`(select r.role_key from recipients r where r.file_id = ${schema.files.id} and r.document_id = ${schema.files.currentDocumentId} and r.status in ('active','viewed') order by r.signing_order limit 1)`;

export function filesWhere(companyId: string, f: FilesQuery): SQL {
  const parts: (SQL | undefined)[] = [eq(schema.files.companyId, companyId)];
  if (f.q) {
    const p = likePattern(f.q);
    parts.push(
      or(
        ilike(schema.files.clientLegalName, p),
        ilike(schema.files.reference, p),
        ilike(schema.templates.name, p),
        // A signer on this File (any version) by name or email, within the same company.
        sql`exists (select 1 from recipients r where r.file_id = ${schema.files.id} and r.company_id = ${companyId} and (r.name ilike ${p} or r.email ilike ${p}))`,
      ),
    );
  }
  const live = inArray(schema.files.status, ["sent", "partially_signed"]);
  switch (f.status) {
    case "draft":
    case "completed":
    case "voided":
    case "expired":
      parts.push(eq(schema.files.status, f.status));
      break;
    case "stopped":
      parts.push(inArray(schema.files.status, ["declined", "changes_requested"]));
      break;
    // Same rule as the status badge: the live signer's role, else sent = client, partially signed = firm.
    case "waiting_client":
      parts.push(and(live, sql`coalesce(${waitingOnSql}, case when ${schema.files.status} = 'sent' then 'client' else 'firm' end) <> 'firm'`));
      break;
    case "waiting_firm":
      parts.push(and(live, sql`coalesce(${waitingOnSql}, case when ${schema.files.status} = 'sent' then 'client' else 'firm' end) = 'firm'`));
      break;
  }
  return and(...parts)!;
}

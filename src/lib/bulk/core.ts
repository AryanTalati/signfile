/**
 * Bulk send from a CSV: the pure parts (columns for a template, CSV parsing, header mapping,
 * row validation, idempotency keys, the result CSV). Used by the server and the browser.
 */
import { parseCcEmails } from "@/lib/files/cc";
import { isoDate } from "@/lib/ai/term-offers";
import { isDateFill } from "@/lib/fields/format";
import type { FieldDef } from "@/lib/fields/types";

export const MAX_ROWS = 500;

export interface Column {
  /** Header name in the CSV template. */
  key: string;
  label: string;
  required: boolean;
  /** Where the value goes: a File field, or a "Filled by you" key. */
  target: { kind: "file"; field: "clientLegalName" | "signerName" | "signerEmail" | "signerTitle" | "reference" | "externalId" | "ccEmails" } | { kind: "firm"; firmKey: string; date: boolean };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "field";

/** The columns this template needs: the client signer, then one per "Filled by you" field. */
export function columnsFor(fields: FieldDef[]): Column[] {
  const cols: Column[] = [
    { key: "client_legal_name", label: "Client legal name", required: true, target: { kind: "file", field: "clientLegalName" } },
    { key: "signer_name", label: "Signer name", required: true, target: { kind: "file", field: "signerName" } },
    { key: "signer_email", label: "Signer email", required: true, target: { kind: "file", field: "signerEmail" } },
    { key: "signer_title", label: "Signer title", required: false, target: { kind: "file", field: "signerTitle" } },
    { key: "reference", label: "Reference", required: false, target: { kind: "file", field: "reference" } },
    { key: "external_id", label: "External ID", required: false, target: { kind: "file", field: "externalId" } },
    { key: "cc_emails", label: "Send signed copy to", required: false, target: { kind: "file", field: "ccEmails" } },
  ];
  const seen = new Set(cols.map((c) => c.key));
  for (const f of fields) {
    if (f.type !== "firm_fill") continue;
    const firmKey = f.firmFillKey ?? f.id;
    if (cols.some((c) => c.target.kind === "firm" && c.target.firmKey === firmKey)) continue;
    let key = slug(f.label === "Filled by you" ? firmKey : f.label);
    for (let i = 2; seen.has(key); i++) key = `${slug(f.label)}_${i}`;
    seen.add(key);
    cols.push({ key, label: f.label, required: f.required, target: { kind: "firm", firmKey, date: isDateFill({ key: firmKey, label: f.label }) } });
  }
  return cols;
}

// ---------- CSV ----------

/** RFC 4180 CSV: quoted fields, "" escapes, CRLF/LF, BOM. Empty lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** CSV out. Cells that a spreadsheet would run as a formula (=, +, -, @) get a leading apostrophe. */
export function toCsv(rows: string[][]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map((v) => cell(v ?? "")).join(",")).join("\r\n") + "\r\n";
}

// ---------- mapping ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const ALIASES: Record<string, string[]> = {
  client_legal_name: ["client", "clientname", "company", "companyname", "legalname", "customer", "organization", "organisation"],
  signer_name: ["name", "fullname", "contactname", "signer"],
  signer_email: ["email", "emailaddress", "signeremail", "contactemail"],
  signer_title: ["title", "jobtitle", "position", "role"],
  reference: ["ref", "jobnumber", "projectnumber", "matter"],
  external_id: ["id", "externalid", "crmid", "clientid", "customerid"],
  cc_emails: ["cc", "ccemail", "ccemails", "copyto", "sendsignedcopyto"],
};

/** CSV header index for each column (or -1): exact key, label, or a common alias. */
export function autoMap(headers: string[], cols: Column[]): Record<string, number> {
  const h = headers.map(norm);
  const out: Record<string, number> = {};
  const used = new Set<number>();
  for (const c of cols) {
    const names = [c.key, c.label, ...(ALIASES[c.key] ?? [])].map(norm);
    const i = h.findIndex((x, idx) => !used.has(idx) && names.includes(x));
    out[c.key] = i;
    if (i >= 0) used.add(i);
  }
  return out;
}

// ---------- validation ----------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RowValues {
  clientLegalName: string;
  signerName: string;
  signerEmail: string;
  signerTitle: string;
  reference: string;
  externalId: string;
  /** "Send the signed copy to", normalized ("a@x.com, b@y.com"); may be missing on rows saved before it existed. */
  ccEmails?: string;
  firmValues: Record<string, string>;
}

export type RowStatus = "ready" | "invalid" | "duplicate" | "already_sent";
export interface PreviewRow {
  rowNo: number; // 1-based data row (the header is row 0)
  cells: string[];
  values: RowValues;
  key: string;
  status: RowStatus;
  reasons: string[];
  /** For already_sent: the File it produced. */
  previous?: { fileId: string; at: string };
}

/** Idempotency key: the same signer, template and external_id is the same send. */
export const rowKey = (templateId: string, email: string, externalId: string) => `${templateId}|${email.trim().toLowerCase()}|${externalId.trim()}`;

/**
 * Maps and checks every row. `alreadySent` holds keys that produced a File in a recent batch;
 * those rows are skipped unless their row number is in `resend`.
 */
export function validateRows(
  rows: string[][],
  cols: Column[],
  mapping: Record<string, number>,
  templateId: string,
  alreadySent: Map<string, { fileId: string; at: string }> = new Map(),
  resend: Set<number> = new Set(),
): PreviewRow[] {
  const firstByKey = new Map<string, number>();
  const firstByEmail = new Map<string, number>();
  return rows.map((cells, i) => {
    const rowNo = i + 1;
    const get = (c: Column) => (mapping[c.key] >= 0 ? (cells[mapping[c.key]] ?? "").trim() : "");
    const values: RowValues = { clientLegalName: "", signerName: "", signerEmail: "", signerTitle: "", reference: "", externalId: "", ccEmails: "", firmValues: {} };
    const reasons: string[] = [];
    for (const c of cols) {
      let v = get(c);
      if (c.required && !v) {
        reasons.push(`${c.label} is empty`);
        continue;
      }
      if (c.target.kind === "file") {
        if (c.target.field === "signerEmail") {
          v = v.toLowerCase();
          if (v && !EMAIL.test(v)) reasons.push(`"${v}" isn't a valid email`);
        }
        if (c.target.field === "ccEmails") {
          const cc = parseCcEmails(v);
          if ("error" in cc) reasons.push(`${c.label}: ${cc.error.replace(/\.$/, "")}`);
          else v = cc.emails.join(", ");
          values.ccEmails = v;
          continue;
        }
        const max = c.target.field === "clientLegalName" ? 200 : 120;
        if (v.length > max) reasons.push(`${c.label} is longer than ${max} characters`);
        if ((c.target.field === "clientLegalName" || c.target.field === "signerName") && v && v.length < 2) reasons.push(`${c.label} is too short`);
        values[c.target.field] = v;
      } else if (v) {
        if (c.target.date) {
          const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : isoDate(v);
          if (!iso) reasons.push(`${c.label}: "${v}" isn't a date`);
          else v = iso;
        }
        if (v.length > 500) reasons.push(`${c.label} is too long`);
        values.firmValues[c.target.firmKey] = v;
      }
    }
    const key = rowKey(templateId, values.signerEmail, values.externalId);
    let status: RowStatus = reasons.length ? "invalid" : "ready";
    let previous: PreviewRow["previous"];
    if (status === "ready") {
      // The same signer twice in one file (and no external_id telling them apart) is almost always a mistake.
      const dupe = firstByKey.get(key) ?? (values.externalId ? undefined : firstByEmail.get(values.signerEmail));
      if (dupe) {
        status = "duplicate";
        reasons.push(`same signer as row ${dupe}${values.externalId ? " (same external_id)" : ""}`);
      } else if (alreadySent.has(key) && !resend.has(rowNo)) {
        status = "already_sent";
        previous = alreadySent.get(key);
        reasons.push(`already sent on ${previous!.at.slice(0, 10)}`);
      }
    }
    if (status !== "invalid") {
      if (!firstByKey.has(key)) firstByKey.set(key, rowNo);
      if (!values.externalId && !firstByEmail.has(values.signerEmail)) firstByEmail.set(values.signerEmail, rowNo);
    }
    return { rowNo, cells, values, key, status, reasons, previous };
  });
}

/** The exact header row for a template, plus one example line. */
export function headerTemplateCsv(cols: Column[]): string {
  const example: Record<string, string> = {
    client_legal_name: "Example Client LLC",
    signer_name: "Jordan Example",
    signer_email: "jordan@example.com",
    signer_title: "Operations Director",
    reference: "JOB-001",
    external_id: "CRM-1001",
    cc_emails: "legal@example.com",
  };
  return toCsv([cols.map((c) => c.key), cols.map((c) => example[c.key] ?? (c.target.kind === "firm" && c.target.date ? "2026-12-01" : ""))]);
}

/** Result CSV: every input row, then what happened to it. */
export function resultCsv(headers: string[], rows: { cells: string[]; status: string; link: string; reason: string }[]): string {
  return toCsv([[...headers, "file_status", "file_link", "skip_reason"], ...rows.map((r) => [...headers.map((_, i) => r.cells[i] ?? ""), r.status, r.link, r.reason])]);
}

/** "18 sent, 1 draft, 2 skipped" (failed only when there are any). */
export function batchSummary(c: Record<string, number>) {
  return [`${c.sent ?? 0} sent`, ...(c.draft ? [`${c.draft} draft${c.draft === 1 ? "" : "s"}`] : []), `${c.skipped ?? 0} skipped`, ...(c.failed ? [`${c.failed} failed`] : [])].join(", ");
}

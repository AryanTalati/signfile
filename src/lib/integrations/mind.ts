/**
 * MIND sync: the private document SignFile writes into a firm's MIND knowledge graph when a
 * File completes. Pure (no network). One `mind_remember` create, type "document" (private),
 * never "feed_post" (public). Agreement facts only: no signer emails or phone numbers. MIND
 * extracts the entities (client, fee, dates) itself.
 */
import type { EventContext } from "./core";

export const MIND_TOOL = "mind_remember";

export interface MindArgs {
  action: "create";
  type: "document";
  title: string;
  content: string;
  tags: string[];
  source: "signfile";
}

const TERM_LABELS: Record<string, string> = { fee: "Fee", term: "Term", effective_date: "Effective date", renewal: "Renewal", governing_law: "Governing law", parties: "Parties" };
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function mindDocument(c: EventContext): MindArgs {
  const lines = [
    `Signed agreement (via SignFile).`,
    `Client: ${c.file.clientLegalName}`,
    `Agreement: ${c.documentName}${c.version ? ` (version ${c.version})` : ""}`,
    `Firm: ${c.firm}`,
    ...(c.file.reference ? [`Reference: ${c.file.reference}`] : []),
  ];
  // Key terms read from the agreement, each only if it was found (never guessed).
  for (const [k, t] of Object.entries(c.terms ?? {})) {
    if (!t?.found || !t.value) continue;
    const value = k === "parties" ? nameParties(t.value, c.file.clientLegalName) : k === "effective_date" ? effectiveDate(t.value, c.file.completedAt) : t.value;
    lines.push(`${TERM_LABELS[k] ?? k}: ${value}`);
  }
  // Signers by name and role, with the date each signed. No emails or phone numbers.
  for (const s of c.signers) lines.push(`${s.role === "firm" ? "Countersigned" : "Signed"} by ${s.name} (${s.role === "firm" ? c.firm : c.file.clientLegalName})${day(s.signedAt) ? ` on ${day(s.signedAt)}` : ""}`);
  if (c.file.completedAt) lines.push(`Completed: ${day(c.file.completedAt)}`);
  if (c.fileUrl) lines.push(`File: ${c.fileUrl}`);
  if (c.verifyUrl) lines.push(`Verify the signed PDF: ${c.verifyUrl}`);
  return {
    action: "create",
    type: "document",
    title: `Signed: ${c.documentName} — ${c.file.clientLegalName}`.slice(0, 200),
    content: lines.join("\n"),
    tags: ["signfile", "agreement"],
    source: "signfile",
  };
}

/**
 * "Lumen Cloud Software Inc. (Vendor) and Customer" -> "... and Northwind Analytics LLC (Customer)":
 * a bare generic role gets the File's client name. Left alone if the name is already there.
 */
export function nameParties(text: string, client: string): string {
  if (!client || text.toLowerCase().includes(client.toLowerCase())) return text;
  // The role word on its own: not already in parentheses, not part of a name ("Customer Corp").
  return text.replace(/(?<![(\w"“'‘])(?:the\s+)?(Customer|Client|Company)(?![\w)"”'’])(?!\s+(?:Inc|LLC|Ltd|Corp|Co)\b)/i, (_m, role: string) => `${client} (${role[0].toUpperCase()}${role.slice(1).toLowerCase()})`);
}

/** "Date of the last signature" (and similar) on a completed File -> "2026-11-22 (date of the last signature)". */
export function effectiveDate(value: string, completedAt: Date | null): string {
  if (!completedAt || !/last (signature|party|signatory|to sign)|(fully|last) (executed|signed)|date of (full )?execution|when (both|all) parties (have )?signed|signed by (both|all) parties/i.test(value)) return value;
  return `${day(completedAt)} (date of the last signature)`;
}

/** Defence in depth: whatever is stored, only a private document create is ever sent. */
export function safeMindArgs(raw: unknown): MindArgs | null {
  const a = raw as Partial<MindArgs> | null;
  if (!a || typeof a.title !== "string" || typeof a.content !== "string") return null;
  return { action: "create", type: "document", title: a.title.slice(0, 200), content: a.content.slice(0, 20_000), tags: ["signfile", "agreement"], source: "signfile" };
}

/** MIND answers a create with JSON carrying the new item's id (status PROCESSING). That counts as delivered. */
export function mindAcceptedId(text: string): string | null {
  try {
    const j = JSON.parse(text) as { id?: unknown };
    return typeof j.id === "string" && j.id ? j.id : null;
  } catch {
    return /"id"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? null;
  }
}

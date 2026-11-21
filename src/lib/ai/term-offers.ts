/**
 * Which key term could fill a "Filled by you" field (fee -> "Monthly fee"), offered on the New
 * File form for the firm to accept with one click. Never applied automatically. Pure.
 */
import type { TermKey } from "@/lib/llm/review-schema";
import type { Term, Terms } from "./review";

const MATCH: [TermKey, RegExp][] = [
  ["effective_date", /effective|start|commencement/i],
  ["fee", /fee|price|amount|rate|cost|retainer|compensation/i],
  ["renewal", /renew/i],
  ["governing_law", /governing|jurisdiction|\blaw\b/i],
  ["term", /\bterm\b|duration|length/i],
];

export type TermOffer = Term & { key: TermKey; fill: string };

/** "November 20, 2026" -> "2026-11-20" for a date picker; null if it isn't a plain date. */
export function isoDate(value: string): string | null {
  const t = Date.parse(value.replace(/(\d)(st|nd|rd|th)\b/g, "$1"));
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function termOfferFor(field: { key: string; label: string }, terms: Terms | null, isDate: boolean): TermOffer | null {
  if (!terms) return null;
  const hay = `${field.key} ${field.label}`;
  for (const [key, re] of MATCH) {
    if (!re.test(hay)) continue;
    const t = terms[key];
    if (!t?.found || !t.value) return null;
    const fill = isDate ? isoDate(t.value) : t.value;
    return fill ? { ...t, key, fill } : null;
  }
  return null;
}

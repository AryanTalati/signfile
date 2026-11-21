/**
 * AI second opinion on a new agreement's fields and key terms. Rules stay the default; the
 * model proposes; a person confirms anything uncertain. Pure apart from the injected provider
 * and daily-cap check, so it's unit-tested with a mocked model.
 *
 *   agree     (same type + signer, model sure)  -> high confidence, accepted
 *   disagree  (or the model is unsure)          -> rules' value kept, flagged "AI-suggested"
 *   model-only field (rules found none)         -> added, flagged "AI-suggested"
 *   any failure / timeout / no key / cap hit    -> the rules' result, unchanged
 */
import type { FieldDef, FieldType } from "@/lib/fields/types";
import { FIELD_META } from "@/lib/fields/meta";
import { boxForBlank, listBlanks, type PageBlank } from "@/lib/pdf/detect";
import type { PageLayout } from "@/lib/pdf/extract";
import { type AgreementReview, type ReviewInput, TERM_KEYS, type TermKey } from "@/lib/llm/review-schema";

export const AGREE_MIN = 0.7; // model confidence needed to count as agreement
export const ADD_MIN = 0.5; // model confidence needed to propose a field the rules missed
const MAX_ADDED = 20;

export type Term = { found: boolean; value: string | null; quote: string | null; page: number | null };
export type Terms = Record<TermKey, Term>;

export type AiOutcome =
  | { status: "ok"; model: string; fields: FieldDef[]; summary: { agreed: number; flagged: number; added: number }; terms: Terms; inputTokens: number; outputTokens: number }
  | { status: "skipped" | "failed"; reason: string };

export interface AiDeps {
  provider: { reviewAgreement(input: ReviewInput, signal?: AbortSignal): Promise<{ review: AgreementReview; model: string; inputTokens: number; outputTokens: number }> } | null;
  /** Reserves one call against the company's daily cap; false when the cap is reached. */
  reserve: () => Promise<boolean>;
  maxInputChars: number;
}

// ---------- input ----------

/** Contact data is never sent: emails and phone numbers in the agreement text are masked. */
export const redact = (s: string) =>
  s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]").replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "[phone]" : m));

function pageLines(page: PageLayout) {
  const rows: { baseline: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of [...page.items].sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.baseline - it.baseline) < 2.5);
    if (row) row.parts.push({ x: it.x, s: it.str });
    else rows.push({ baseline: it.baseline, parts: [{ x: it.x, s: it.str }] });
  }
  rows.sort((a, b) => a.baseline - b.baseline);
  return rows.map((r) => ({ baseline: r.baseline, text: redact(r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim()) }));
}

export function buildReviewInput(layout: PageLayout[], ruleFields: FieldDef[], firmName: string) {
  const blanks = new Map<string, PageBlank>();
  const mapping = new Map<string, string>(); // field id -> blank id
  const input: ReviewInput = { pages: [], blanks: [], firmName, ruleHints: {} };
  for (const page of layout) {
    const lines = pageLines(page);
    input.pages.push({ page: page.page, lines: lines.map((l) => l.text) });
    for (const b of listBlanks(page)) {
      const id = `B${blanks.size + 1}`;
      blanks.set(id, b);
      // The line the blank sits on (or the nearest one above it).
      let line = 0;
      for (let i = 0; i < lines.length; i++) if (lines[i].baseline <= b.bottom + 4) line = i;
      input.blanks.push({ id, page: page.page, line: line + 1, label: b.label ? redact(b.label) : null, context: (lines[line]?.text ?? "").slice(0, 160) });
    }
  }
  for (const f of ruleFields) {
    const page = layout[f.page - 1];
    if (!page) continue;
    const bottom = (f.y + f.h) * page.height, x1 = f.x * page.width, x2 = (f.x + f.w) * page.width;
    let best: string | null = null, bestD = Infinity;
    for (const [id, b] of blanks) {
      if (b.page !== f.page || Math.min(x2, b.x2) - Math.max(x1, b.x1) <= 0) continue;
      const d = Math.abs(b.bottom - bottom);
      if (d < 8 && d < bestD) [best, bestD] = [id, d];
    }
    if (best && ![...mapping.values()].includes(best)) {
      mapping.set(f.id, best);
      input.ruleHints![best] = { type: f.type, roleKey: f.roleKey };
    }
  }
  const chars = input.pages.reduce((n, p) => n + p.lines.join("\n").length, 0);
  return { input, blanks, mapping, chars };
}

// ---------- merge ----------

const pct = (n: number) => `${Math.round(n * 100)}%`;
const describe = (a: AgreementReview["blanks"][number]) => (a.kind === "not_a_field" ? "not a signer field" : `${FIELD_META[a.type as FieldType]?.label ?? a.type} for the ${a.signer === "firm" ? "firm" : a.signer === "client" ? "client" : "firm (filled before sending)"}`);

export function mergeReview(layout: PageLayout[], ruleFields: FieldDef[], built: ReturnType<typeof buildReviewInput>, review: AgreementReview) {
  const byBlank = new Map(review.blanks.map((b) => [b.id, b]));
  const summary = { agreed: 0, flagged: 0, added: 0 };
  const fields = ruleFields.map((f): FieldDef => {
    const a = built.mapping.has(f.id) ? byBlank.get(built.mapping.get(f.id)!) : undefined;
    // Fields nobody signs (firm-filled, agreement date) and the document's own form fields: rules only.
    if (!a || f.roleKey === null || f.source === "acroform" || f.source === "appended") return f;
    const conf = Math.min(1, Math.max(0, a.confidence));
    const agrees = a.kind === "field" && a.type === f.type && a.signer === f.roleKey && conf >= AGREE_MIN;
    if (agrees) {
      summary.agreed++;
      return { ...f, confidence: Math.max(f.confidence, 0.9), reason: `${f.reason ? `${f.reason}; ` : ""}AI review agrees (${pct(conf)})` };
    }
    summary.flagged++;
    const suggestion = a.kind === "field" && a.type === f.type && a.signer === f.roleKey ? `same, but unsure (${pct(conf)})` : `${describe(a)} (${pct(conf)})`;
    return { ...f, confidence: Math.min(f.confidence, 0.6), reviewed: false, ai: { suggestion, confidence: conf }, reason: `${f.reason ? `${f.reason}; ` : ""}AI-suggested: ${suggestion}` };
  });
  // Blanks the rules left empty that the model thinks a signer fills: proposed, never accepted.
  const mapped = new Set(built.mapping.values());
  for (const a of review.blanks) {
    if (summary.added >= MAX_ADDED || mapped.has(a.id) || a.kind !== "field" || !a.type || (a.signer !== "client" && a.signer !== "firm")) continue;
    const conf = Math.min(1, Math.max(0, a.confidence));
    const b = built.blanks.get(a.id);
    if (!b || conf < ADD_MIN) continue;
    const box = boxForBlank(layout[b.page - 1], b, a.type);
    if (!box) continue;
    summary.added++;
    const suggestion = `${describe(a)} (${pct(conf)})`;
    fields.push({
      id: `ai_${a.id}`,
      page: b.page,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      type: a.type,
      roleKey: a.signer,
      label: FIELD_META[a.type].label,
      required: a.type !== "checkbox" && a.type !== "text",
      confidence: Math.min(conf, 0.6),
      source: "ai",
      reviewed: false,
      ai: { suggestion, confidence: conf },
      reason: `AI-suggested: ${suggestion}; the rules found no field here${b.label ? ` (label "${b.label}")` : ""}`,
    });
  }
  return { fields, summary };
}

// ---------- key terms ----------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”"'’‘]/g, "")
    .replace(/[^\p{L}\p{N}$€£%.,]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A term counts only if its quote is really in the agreement; otherwise "not found" (never a guess). */
export function verifyTerms(terms: AgreementReview["terms"], input: ReviewInput): Terms {
  const text = norm(input.pages.map((p) => p.lines.join(" ")).join(" "));
  const out = {} as Terms;
  for (const k of TERM_KEYS) {
    const t = terms[k];
    const q = t?.quote ? norm(t.quote) : "";
    out[k] = t?.found && t.value && q.length >= 3 && text.includes(q) ? { found: true, value: t.value.slice(0, 200), quote: t.quote!.slice(0, 300), page: t.page } : { found: false, value: null, quote: null, page: null };
  }
  return out;
}

// ---------- the call ----------

export async function runAiReview(deps: AiDeps, args: { layout: PageLayout[]; fields: FieldDef[]; firmName: string; signal?: AbortSignal }): Promise<AiOutcome> {
  if (!deps.provider) return { status: "skipped", reason: "AI review is off" };
  const built = buildReviewInput(args.layout, args.fields, args.firmName);
  if (built.chars > deps.maxInputChars) return { status: "skipped", reason: "agreement too long for AI review" };
  if (!built.chars) return { status: "skipped", reason: "no text to review" };
  if (!(await deps.reserve())) return { status: "skipped", reason: "daily AI review limit reached" };
  try {
    const { input } = built;
    const res = await deps.provider.reviewAgreement(input, args.signal);
    const merged = mergeReview(args.layout, args.fields, built, res.review);
    return { status: "ok", model: res.model, ...merged, terms: verifyTerms(res.review.terms, input), inputTokens: res.inputTokens, outputTokens: res.outputTokens };
  } catch (e) {
    // Never block the upload: the rules' result stands. Log the error kind only (no key, no text).
    const err = e as { name?: string; status?: number };
    return { status: "failed", reason: `${err.name ?? "Error"}${err.status ? ` ${err.status}` : ""}` };
  }
}

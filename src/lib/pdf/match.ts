/**
 * Matches a revised document's detected fields to the previous version's fields, by what
 * they mean, not where they are: same type, same signer role, and similar anchor text (the
 * words to the left on the same row and just above, like "CLIENT ... By:"). Pure.
 */
import type { FieldDef } from "@/lib/fields/types";
import type { PageLayout } from "./extract";

export interface FieldMatch {
  /** The new field, carrying over the old field's label/required/fill key when matched. */
  field: FieldDef;
  oldId: string | null;
  score: number;
  status: "matched" | "low" | "new";
}

export interface MatchResult {
  fields: FieldDef[];
  matches: FieldMatch[];
  /** Previous fields with no counterpart in the new document. */
  missing: FieldDef[];
  /** True when every previous field matched with high confidence and nothing is new. */
  clean: boolean;
  summary: { previous: number; matched: number; low: number; added: number; missing: number };
}

export const HIGH = 0.6;

/** Words that locate a field: text on its row to the left (≤ 250 pt) and the line just above it. */
export function anchorText(page: PageLayout | undefined, f: FieldDef): string {
  if (!page) return "";
  const W = page.width, H = page.height;
  const x = f.x * W, y = f.y * H, w = f.w * W, bottom = (f.y + f.h) * H;
  const words: string[] = [];
  for (const it of page.items) {
    const right = it.x + it.w;
    const sameRow = it.baseline > y - 2 && it.baseline <= bottom + 4 && right <= x + 3 && x - right < 250;
    const above = it.baseline <= y + 2 && y - it.baseline < 30 && it.x < x + w && right > x - 200;
    if (sameRow || above) words.push(it.str);
  }
  return normalize(words.join(" "));
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_.…]{2,}/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function similarity(a: string, b: string) {
  const ta = new Set(a.split(" ").filter((t) => t.length > 1));
  const tb = new Set(b.split(" ").filter((t) => t.length > 1));
  if (!ta.size && !tb.size) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const kindKey = (f: FieldDef) => `${f.type}|${f.roleKey ?? "none"}`;

export function matchFields(oldFields: FieldDef[], oldLayout: PageLayout[], newFields: FieldDef[], newLayout: PageLayout[]): MatchResult {
  const oldA = oldFields.map((f) => ({ f, a: anchorText(oldLayout[f.page - 1], f) }));
  const newA = newFields.map((f) => ({ f, a: anchorText(newLayout[f.page - 1], f) }));

  // All same-kind pairs, scored by anchor similarity, plus a small bonus for the same order
  // among same-kind fields (k-th client signature <-> k-th client signature).
  const order = (list: { f: FieldDef }[], f: FieldDef) => list.filter((x) => kindKey(x.f) === kindKey(f)).findIndex((x) => x.f === f);
  const pairs: { o: number; n: number; score: number }[] = [];
  oldA.forEach((o, oi) =>
    newA.forEach((n, ni) => {
      if (kindKey(o.f) !== kindKey(n.f)) return;
      const sim = similarity(o.a, n.a);
      const sameOrder = order(oldA, o.f) === order(newA, n.f) ? 0.1 : 0;
      pairs.push({ o: oi, n: ni, score: Math.min(1, sim + sameOrder) });
    }),
  );
  pairs.sort((a, b) => b.score - a.score);

  const usedO = new Set<number>(), usedN = new Set<number>();
  const byNew = new Map<number, { o: number; score: number }>();
  for (const p of pairs) {
    if (usedO.has(p.o) || usedN.has(p.n)) continue;
    usedO.add(p.o);
    usedN.add(p.n);
    byNew.set(p.n, { o: p.o, score: p.score });
  }
  // A lone same-kind pair with weak anchors (e.g. a reworded label) is still a likely match, but low.
  const matches: FieldMatch[] = newA.map(({ f }, ni) => {
    const m = byNew.get(ni);
    // New in this version: always flagged for the firm to confirm (capped below the review threshold).
    if (!m) return { field: { ...f, confidence: Math.min(f.confidence, 0.6), reviewed: false, reason: "new in this version" }, oldId: null, score: 0, status: "new" as const };
    const old = oldA[m.o].f;
    const status = m.score >= HIGH ? "matched" : "low";
    return {
      field: {
        ...f,
        type: old.type,
        roleKey: old.roleKey,
        label: old.label,
        required: old.required,
        ...(old.firmFillKey ? { firmFillKey: old.firmFillKey } : {}),
        confidence: status === "matched" ? Math.max(f.confidence, m.score) : Math.min(f.confidence, 0.6),
        reviewed: status === "matched",
        reason: `matched to the previous version's "${old.label}" (${Math.round(m.score * 100)}% similar position text)`,
      },
      oldId: old.id,
      score: m.score,
      status,
    };
  });
  const missing = oldA.filter((_, oi) => !usedO.has(oi)).map((x) => x.f);
  const summary = {
    previous: oldFields.length,
    matched: matches.filter((m) => m.status === "matched").length,
    low: matches.filter((m) => m.status === "low").length,
    added: matches.filter((m) => m.status === "new").length,
    missing: missing.length,
  };
  return { fields: matches.map((m) => m.field), matches, missing, clean: summary.matched === summary.previous && summary.low === 0 && summary.added === 0, summary };
}

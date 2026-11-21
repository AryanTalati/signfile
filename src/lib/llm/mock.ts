/**
 * Deterministic stand-in for the model, for tests only (LLM_MOCK=1). It agrees with the rules
 * everywhere except one deliberate disagreement (the first client Title it calls a full name),
 * finds the parties with a real quote, reports a fee with a quote that isn't in the document
 * (which must be rejected as "not found"), and leaves every other term not found.
 */
import type { AgreementReview, ReviewInput } from "./review-schema";

const none = { found: false, value: null, quote: null, page: null };

export function mockReview(input: ReviewInput): AgreementReview {
  let disagreed = false;
  const blanks = input.blanks.map((b) => {
    const hint = input.ruleHints?.[b.id];
    if (!hint) return { id: b.id, kind: "not_a_field" as const, type: null, signer: null, confidence: 0.6 };
    if (!disagreed && hint.type === "title" && hint.roleKey === "client") {
      disagreed = true;
      return { id: b.id, kind: "field" as const, type: "full_name" as const, signer: "client" as const, confidence: 0.8 };
    }
    return { id: b.id, kind: "field" as const, type: hint.type as AgreementReview["blanks"][number]["type"], signer: (hint.roleKey ?? "none") as "client" | "firm" | "none", confidence: 0.95 };
  });
  const partiesLine = input.pages.flatMap((p) => p.lines.map((l) => ({ l, page: p.page }))).find((x) => /entered into by/i.test(x.l));
  return {
    parties: [],
    signature_blocks: [],
    blanks,
    terms: {
      parties: partiesLine ? { found: true, value: "the parties named in the opening paragraph", quote: partiesLine.l.slice(0, 120), page: partiesLine.page } : none,
      fee: { found: true, value: "$9,999 per month", quote: "a monthly fee of $9,999", page: 1 },
      term: none,
      effective_date: none,
      renewal: none,
      governing_law: none,
    },
  };
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildReviewInput, redact, runAiReview, type AiDeps } from "../../src/lib/ai/review";
import { isoDate, termOfferFor } from "../../src/lib/ai/term-offers";
import { needsReview, REVIEW_THRESHOLD } from "../../src/lib/fields/types";
import { renderInput } from "../../src/lib/llm";
import { mockReview } from "../../src/lib/llm/mock";
import type { AgreementReview, ReviewInput } from "../../src/lib/llm/review-schema";
import { detectFields } from "../../src/lib/pdf/detect";
import { extractLayout } from "../../src/lib/pdf/extract";

const FIRM = "Cloudly Test Software Inc.";
async function fixture() {
  const layout = await extractLayout(new Uint8Array(readFileSync("fixtures/agreements/pdf-saas-table.pdf")));
  return { layout, fields: detectFields(layout, { firmName: FIRM }).fields };
}
/** A mocked model: answers from the blanks it's given, via `answer`. */
const model = (answer: (input: ReviewInput) => AgreementReview, calls: { n: number } = { n: 0 }): AiDeps["provider"] => ({
  reviewAgreement: async (input) => {
    calls.n++;
    return { review: answer(input), model: "mock", inputTokens: 1, outputTokens: 1 };
  },
});
const deps = (provider: AiDeps["provider"], reserve = async () => true): AiDeps => ({ provider, reserve, maxInputChars: 150_000 });
/** Agrees with the rules on every blank (no deliberate disagreement). */
const agreeAll = (input: ReviewInput): AgreementReview => ({
  ...mockReview(input),
  blanks: input.blanks.map((b) => {
    const h = input.ruleHints?.[b.id];
    return h ? { id: b.id, kind: "field", type: h.type as never, signer: (h.roleKey ?? "none") as never, confidence: 0.95 } : { id: b.id, kind: "not_a_field", type: null, signer: null, confidence: 0.9 };
  }),
});

test("rules and AI agree: the field is accepted with high confidence, nothing to check", async () => {
  const { layout, fields } = await fixture();
  const out = await runAiReview(deps(model(agreeAll)), { layout, fields, firmName: FIRM });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.summary.agreed, 10);
  assert.equal(out.summary.flagged + out.summary.added, 0);
  for (const f of out.fields) {
    assert.ok(f.confidence >= REVIEW_THRESHOLD && !f.ai && !needsReview(f), `${f.roleKey} ${f.type} accepted`);
    assert.match(f.reason ?? "", /AI review agrees/);
  }
});

test("rules and AI disagree: the rules' value stays, the field is flagged 'AI-suggested' until a person confirms", async () => {
  const { layout, fields } = await fixture();
  const out = await runAiReview(deps(model(mockReview)), { layout, fields, firmName: FIRM }); // mock calls the client Position a full name
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.summary.flagged, 1);
  const f = out.fields.find((x) => x.ai)!;
  assert.equal(f.type, "title"); // rules stay the default
  assert.equal(f.roleKey, "client");
  assert.match(f.ai!.suggestion, /Full name for the client/);
  assert.ok(needsReview(f));
  // Even a confident AI suggestion is never auto-confirmed.
  assert.ok(needsReview({ ...f, confidence: 0.99 }));
  assert.ok(!needsReview({ ...f, reviewed: true }));
});

test("a failing or unavailable model falls back to the rules", async () => {
  const { layout, fields } = await fixture();
  const failing: AiDeps["provider"] = {
    reviewAgreement: async () => {
      throw Object.assign(new Error("boom"), { name: "APIConnectionTimeoutError" });
    },
  };
  const out = await runAiReview(deps(failing), { layout, fields, firmName: FIRM });
  assert.deepEqual(out, { status: "failed", reason: "APIConnectionTimeoutError" });
  assert.equal((await runAiReview(deps(null), { layout, fields, firmName: FIRM })).status, "skipped"); // no key / AI off
});

test("daily cap: once reached, the model isn't called", async () => {
  const { layout, fields } = await fixture();
  const calls = { n: 0 };
  let used = 0;
  const cap = 2;
  const d = deps(model(agreeAll, calls), async () => (used < cap ? (used++, true) : false));
  const results = [];
  for (let i = 0; i < 4; i++) results.push((await runAiReview(d, { layout, fields, firmName: FIRM })).status);
  assert.deepEqual(results, ["ok", "ok", "skipped", "skipped"]);
  assert.equal(calls.n, 2);
});

test("key terms: missing ones are 'not found'; a quote that isn't in the document is rejected, never guessed", async () => {
  const { layout, fields } = await fixture();
  const out = await runAiReview(deps(model(mockReview)), { layout, fields, firmName: FIRM });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.terms.parties.found, true); // real quote from the agreement
  assert.match(out.terms.parties.quote!, /entered into by/);
  assert.deepEqual(out.terms.fee, { found: false, value: null, quote: null, page: null }); // mock invented "$9,999": rejected
  for (const k of ["term", "effective_date", "renewal", "governing_law"] as const) assert.equal(out.terms[k].found, false);
  // Prefill offers only come from found terms, and dates become date-picker values.
  assert.equal(termOfferFor({ key: "fee", label: "Monthly fee" }, out.terms, false), null);
  const withDate = { ...out.terms, effective_date: { found: true, value: "November 20, 2026", quote: "effective as of November 20, 2026", page: 1 } };
  assert.equal(termOfferFor({ key: "date", label: "Effective date" }, withDate, true)?.fill, "2026-11-20");
  assert.equal(isoDate("not a date"), null);
});

test("privacy: contact data is masked and the rules' answers are never sent to the model", async () => {
  assert.equal(redact("Notices to jane.doe@example.com or +1 (555) 010-2030."), "Notices to [email] or [phone].");
  assert.equal(redact("Section 12.3 on page 4"), "Section 12.3 on page 4");
  const { layout, fields } = await fixture();
  const { input } = buildReviewInput(layout, fields, FIRM);
  const sent = renderInput(input);
  assert.ok(Object.keys(input.ruleHints!).length > 0);
  assert.doesNotMatch(sent, /ruleHints|roleKey/);
  assert.match(sent, /=== Page 2 ===/);
  assert.match(sent, /B\d+ \| page 2 \| line \d+ \| label: "Date signed:"/);
});

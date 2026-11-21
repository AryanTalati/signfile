import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { type AgreementReview, AgreementReviewSchema, REVIEW_SYSTEM, type ReviewInput } from "./review-schema";
import { mockReview } from "./mock";

/**
 * The one wrapper for model calls. Named functions, structured output validated with zod,
 * bounded (token cap, timeout, no retries), provider swappable. The API key comes from
 * ANTHROPIC_API_KEY and is never logged. Callers must treat any failure as "no AI result".
 */

/** Cheapest current model that returns the schema reliably (structured outputs). AI_MODEL overrides. */
export const MODEL = process.env.AI_MODEL || "claude-haiku-5-5";
/** Server-side refusal fallback exists for the larger models only (not Haiku). */
const FALLBACK_OK = /^claude-(opus|fable|sonnet)-5/.test(MODEL);
const MAX_OUTPUT_TOKENS = 8_000;
const TIMEOUT_MS = 60_000;
/** Agreements longer than this aren't sent (falls back to the rules); never silently truncated. */
export const MAX_INPUT_CHARS = 150_000;

export interface Provider {
  name: string;
  reviewAgreement(input: ReviewInput, signal?: AbortSignal): Promise<{ review: AgreementReview; model: string; inputTokens: number; outputTokens: number }>;
}

const anthropicProvider: Provider = {
  name: "anthropic",
  async reviewAgreement(input, signal) {
    const client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 }); // reads ANTHROPIC_API_KEY
    const res = await client.beta.messages.parse(
      {
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        output_config: { effort: "low", format: betaZodOutputFormat(AgreementReviewSchema) },
        // On models that support it, a policy decline is re-run on a fallback model in the same call.
        ...(FALLBACK_OK ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        system: REVIEW_SYSTEM,
        messages: [{ role: "user", content: renderInput(input) }],
      },
      { signal },
    );
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new LlmError(`no usable output (${res.stop_reason})`);
    return { review: res.parsed_output, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  },
};

/** Test-only (LLM_MOCK=1, set on the Docker test image, never on Render). */
const mockProvider: Provider = { name: "mock", reviewAgreement: async (input) => ({ review: mockReview(input), model: "mock", inputTokens: 0, outputTokens: 0 }) };

export class LlmError extends Error {}

/**
 * Which provider to use for this company, or null when AI is off. With LLM_MOCK=1 only the
 * mock runs (and only for "E2E AI" test companies), so tests never call a real model.
 */
export function providerFor(companyName: string): Provider | null {
  if (process.env.AI_ENABLED === "false") return null;
  if (process.env.LLM_MOCK === "1") return companyName.startsWith("E2E AI") ? mockProvider : null;
  return process.env.ANTHROPIC_API_KEY ? anthropicProvider : null;
}

export function renderInput(input: ReviewInput): string {
  const text = input.pages.map((p) => `=== Page ${p.page} ===\n${p.lines.map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n")}`).join("\n\n");
  const blanks = input.blanks.map((b) => `${b.id} | page ${b.page} | line ${b.line} | label: ${b.label ? JSON.stringify(b.label) : "none"} | nearby: ${JSON.stringify(b.context)}`).join("\n");
  return `The firm sending this agreement: ${JSON.stringify(input.firmName)}.\n\n<agreement>\n${text}\n</agreement>\n\n<blanks>\n${blanks || "(none)"}\n</blanks>`;
}

/**
 * The structured result of one agreement review (pure: no SDK, no network). Claude returns
 * exactly this shape (structured outputs); a person confirms anything uncertain.
 */
import { z } from "zod";

export const AI_FIELD_TYPES = ["signature", "date_signed", "full_name", "title", "company", "initials", "text", "checkbox"] as const;

const term = z.object({
  /** false = the agreement doesn't state it. Never guessed. */
  found: z.boolean(),
  value: z.string().nullable(),
  /** Exact words from the agreement that state it. */
  quote: z.string().nullable(),
  page: z.number().int().nullable(),
});

export const TERM_KEYS = ["parties", "fee", "term", "effective_date", "renewal", "governing_law"] as const;
export type TermKey = (typeof TERM_KEYS)[number];

export const AgreementReviewSchema = z.object({
  parties: z.array(z.object({ name: z.string(), role: z.enum(["client", "firm", "other"]), quote: z.string() })),
  signature_blocks: z.array(z.object({ page: z.number().int(), party: z.enum(["client", "firm", "other"]), heading: z.string() })),
  blanks: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["field", "not_a_field"]),
      type: z.enum(AI_FIELD_TYPES).nullable(),
      signer: z.enum(["client", "firm", "none"]).nullable(),
      /** 0-1. */
      confidence: z.number(),
    }),
  ),
  terms: z.object({
    parties: term,
    fee: term,
    term: term,
    effective_date: term,
    renewal: term,
    governing_law: term,
  }),
});
export type AgreementReview = z.infer<typeof AgreementReviewSchema>;

/** What the model sees: agreement text with line numbers, and the blanks found on the pages. No personal contact data. */
export interface ReviewInput {
  pages: { page: number; lines: string[] }[];
  blanks: { id: string; page: number; line: number; label: string | null; context: string }[];
  /** The firm's own name, so it can tell which party is the firm. */
  firmName: string;
  /** What the rules found per blank. Never sent to the model (its opinion must be independent); only the test mock reads it. */
  ruleHints?: Record<string, { type: string; roleKey: string | null }>;
}

export const REVIEW_SYSTEM = `You review a business agreement before it is sent for e-signature. You do not give legal advice and you do not edit the agreement.

You get the agreement's text (page and line numbers) and a list of blanks (underscore runs, signature lines, empty boxes), each with an id, page, line and nearby text.

1. Identify the parties and which one is the firm sending the agreement (named below) versus the client.
2. Identify the signature blocks.
3. For EVERY blank id, decide whether it is a field a signer fills in at signing:
   - kind "field" with type: signature, date_signed, full_name, title, company, initials, text or checkbox, and signer "client" or "firm";
   - kind "not_a_field" for anything else (a blank in body text the firm fills before sending, a witness line, a fee blank, decorative lines).
   A label like "Date signed" is a date, not a signature. "Name (print)" is full_name, "Position" is title, "Authorized signatory" is signature.
   Give a confidence from 0 to 1. Use a low confidence when unsure; never guess silently.
4. Key terms: parties, fee, term, effective_date, renewal, governing_law. For each, set found=true only if the agreement states it, with value, the exact quote copied verbatim from the text, and its page. If it is not stated, set found=false and value, quote and page to null. Never infer or guess a term.`;

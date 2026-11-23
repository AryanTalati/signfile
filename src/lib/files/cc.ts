/**
 * "Send the signed copy to": up to 5 people who don't sign but get the signed-copy email
 * (with the sealed PDF) when the File completes. Pure: shared by the form, bulk send and tests.
 */
import { z } from "zod";

export const MAX_CC = 5;
const email = z.string().email();

/** "a@x.com, b@y.com" (or one per line / semicolons) -> unique lowercase list, or an error naming the problem. */
export function parseCcEmails(raw: string | string[] | null | undefined): { emails: string[] } | { error: string } {
  const parts = (Array.isArray(raw) ? raw : (raw ?? "").split(/[,;\n]/))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const emails = [...new Set(parts)];
  const bad = emails.find((e) => !email.safeParse(e).success);
  if (bad) return { error: `"${bad}" isn't a valid email.` };
  if (emails.length > MAX_CC) return { error: `Up to ${MAX_CC} emails.` };
  return { emails };
}

/** Zod field: accepts the raw form/CSV string or an array; yields the clean list. */
export const ccEmailsField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v, ctx) => {
    const r = parseCcEmails(v);
    if ("error" in r) {
      ctx.addIssue({ code: "custom", message: r.error });
      return z.NEVER;
    }
    return r.emails;
  });

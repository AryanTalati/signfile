import "server-only";
import { eq, sql } from "drizzle-orm";
import type { AuthContext } from "@/lib/auth/session";
import { db, schema } from "@/lib/db/client";
import type { FieldDef } from "@/lib/fields/types";
import { MAX_INPUT_CHARS, providerFor } from "@/lib/llm";
import type { PageLayout } from "@/lib/pdf/extract";
import { type AiOutcome, runAiReview } from "./review";

/** Calls per company per rolling 24 hours (AI_DAILY_CAP, default 20). */
export const dailyCap = () => Math.max(0, Number(process.env.AI_DAILY_CAP ?? 20) || 0);

/**
 * Reserves one AI call for this company if it's under the daily cap. Serialized per company
 * (advisory lock), so concurrent uploads can't overshoot the cap.
 */
export async function reserveAiCall(companyId: string, kind: string): Promise<string | null> {
  const cap = dailyCap();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai:${companyId}`}))`);
    const [{ n }] = (await tx.execute(sql`select count(*)::int as n from ai_usage where company_id = ${companyId} and created_at > now() - interval '24 hours'`)) as unknown as { n: number }[];
    if (n >= cap) return null;
    const [row] = await tx.insert(schema.aiUsage).values({ companyId, kind }).returning({ id: schema.aiUsage.id });
    return row.id;
  });
}

/** The AI second opinion for a newly uploaded agreement. Never throws: on any problem, the rules' result stands. */
export async function reviewNewAgreement(auth: AuthContext, layout: PageLayout[], fields: FieldDef[], signal?: AbortSignal): Promise<AiOutcome> {
  let usageId: string | null = null;
  try {
    const out = await runAiReview(
      {
        provider: providerFor(auth.company.name),
        reserve: async () => (usageId = await reserveAiCall(auth.company.id, "agreement_review")) !== null,
        maxInputChars: MAX_INPUT_CHARS,
      },
      { layout, fields, firmName: auth.company.name, signal },
    );
    if (usageId)
      await db
        .update(schema.aiUsage)
        .set(out.status === "ok" ? { status: "ok", model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens } : { status: out.status })
        .where(eq(schema.aiUsage.id, usageId));
    if (out.status === "failed") console.warn("AI review failed; using the rules' result:", out.reason);
    return out;
  } catch (e) {
    console.warn("AI review skipped:", (e as Error).name);
    return { status: "failed", reason: "unexpected error" };
  }
}

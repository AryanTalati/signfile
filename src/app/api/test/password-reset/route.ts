import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { testResetLinks } from "@/lib/auth/password-reset";
import { db, schema } from "@/lib/db/client";
import { isTestAddress } from "@/lib/email/gmail";
import { fail, json } from "@/lib/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEST ONLY (E2E_HOOKS=1, never on Render; otherwise a 404), and only for reserved test
 * addresses: GET returns the last reset link emailed to a test address (kept in memory, since
 * the database stores only hashes); POST {email, expire: true} ages that user's open links past
 * their expiry so the expired-link path can be tested without waiting an hour.
 */
export async function GET(req: Request) {
  if (process.env.E2E_HOOKS !== "1") return fail(404, "Not found.");
  const email = (new URL(req.url).searchParams.get("email") ?? "").toLowerCase();
  if (!isTestAddress(email)) return fail(400, "Test addresses only.");
  const link = testResetLinks.get(email);
  return link ? json({ link }) : fail(404, "No link yet.");
}

export async function POST(req: Request) {
  if (process.env.E2E_HOOKS !== "1") return fail(404, "Not found.");
  const body = z.object({ email: z.string().email(), expire: z.literal(true) }).safeParse(await req.json().catch(() => null));
  if (!body.success || !isTestAddress(body.data.email)) return fail(400, "Test addresses only.");
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${body.data.email.toLowerCase()}`);
  if (!user) return fail(404, "No such user.");
  const rows = await db
    .update(schema.passwordResetTokens)
    .set({ expiresAt: sql`now() - interval '1 minute'` })
    .where(and(eq(schema.passwordResetTokens.userId, user.id), isNull(schema.passwordResetTokens.usedAt)))
    .returning({ id: schema.passwordResetTokens.id });
  return json({ expired: rows.length });
}

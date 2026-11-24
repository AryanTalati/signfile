import "server-only";
/**
 * Forgot password. Additive: login, sessions and signup are unchanged.
 *
 * - Request: always the same answer, whether or not the email has an account. A known email
 *   gets a new link (older unused links are cancelled); the email is sent after the response,
 *   so timing doesn't reveal much either. Rate limited per email and per IP.
 * - The link carries a 256-bit random token; only its SHA-256 is stored, with a 1-hour expiry.
 * - Reset: the token is claimed in one UPDATE (unused, unexpired, hash matches), so it works
 *   exactly once even under a double submit. Then the password changes, every other unused
 *   link for that user is cancelled, and all their sessions end (signed out everywhere).
 * - Tokens and links are never logged. The outbox keeps a copy of the email WITHOUT the link,
 *   because the Outbox page is visible to the whole company.
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { db, schema } from "@/lib/db/client";
import { gmailConfig, isTestAddress, sendGmail } from "@/lib/email/gmail";
import { hashResetToken, looksLikeResetToken, newResetToken, RESET_TTL_MS, ResetLimiter, resetTokenState, type TokenState } from "./reset-token";

const limiter = new ResetLimiter();

/** E2E only (E2E_HOOKS=1, test addresses only): the last link per email, in memory, so tests can open it. */
const g = globalThis as unknown as { __signfileResetTestLinks?: Map<string, string> };
export const testResetLinks = (g.__signfileResetTestLinks ??= new Map());

export type RequestResult = { status: "ok" } | { status: "rate_limited" };

export async function requestPasswordReset(input: { email: string; ip: string | null; baseUrl: string }): Promise<RequestResult> {
  const email = input.email.trim().toLowerCase();
  const { ipLimited, emailLimited } = limiter.hit(email, input.ip);
  if (ipLimited) return { status: "rate_limited" }; // says nothing about the email
  const { token, hash } = newResetToken(); // made for every request, so both paths do the same work
  if (emailLimited) return { status: "ok" }; // silently: same answer as a sent link

  const [user] = await db
    .select({ id: schema.users.id, companyId: schema.users.companyId, name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`)
    .limit(1);
  if (!user) return { status: "ok" };

  const now = new Date();
  await db.transaction(async (tx) => {
    // Only the newest link works.
    await tx
      .update(schema.passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(schema.passwordResetTokens.userId, user.id), isNull(schema.passwordResetTokens.usedAt)));
    await tx.insert(schema.passwordResetTokens).values({
      companyId: user.companyId,
      userId: user.id,
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + RESET_TTL_MS),
      requestIp: input.ip,
    });
  });

  const link = `${input.baseUrl}/reset-password?token=${token}`;
  if (process.env.E2E_HOOKS === "1" && isTestAddress(user.email)) testResetLinks.set(user.email.toLowerCase(), link);
  // After the response: the caller never waits on Gmail, and errors never surface to the requester.
  setTimeout(() => {
    sendResetEmail(user, link).catch((e) => console.error("password reset email failed", (e as Error).message));
  }, 0).unref?.();
  return { status: "ok" };
}

export function resetEmail(o: { name: string; email: string; link: string | null }) {
  const first = (o.name || "there").split(" ")[0];
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const linkHtml = o.link
    ? `<p style="margin:24px 0"><a href="${esc(o.link)}" style="display:inline-block;background:#4338ca;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Choose a new password</a></p>`
    : `<p style="color:#6b6b66">[The reset link is not stored in the Outbox.]</p>`;
  const subject = "Reset your signfile password";
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1a">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4df;border-radius:12px;padding:24px;font-size:15px;line-height:1.55">
<p>Hi ${esc(first)},</p>
<p>Someone asked to reset the password for <strong>${esc(o.email)}</strong> on signfile.</p>
${linkHtml}
<p style="font-size:13px;color:#6b6b66">The link works once and expires in 1 hour. If you didn't ask for this, ignore this email: your password stays the same.</p>
</div></body></html>`;
  const text = `Hi ${first},\n\nSomeone asked to reset the password for ${o.email} on signfile.\n\n${o.link ? `Choose a new password: ${o.link}` : "[The reset link is not stored in the Outbox.]"}\n\nThe link works once and expires in 1 hour. If you didn't ask for this, ignore this email: your password stays the same.`;
  return { subject, html, text };
}

/** Sends through the Gmail API directly (the link must not sit in the outbox), then records a copy without the link. */
async function sendResetEmail(user: { id: string; companyId: string; name: string; email: string }, link: string) {
  const cfg = gmailConfig();
  const test = isTestAddress(user.email);
  const stored = resetEmail({ name: user.name, email: user.email, link: null });
  const base = { companyId: user.companyId, kind: "password_reset", toEmail: user.email, toName: user.name, ...stored, attachments: [] };
  if (!cfg || test) {
    await db.insert(schema.outbox).values({ ...base, status: "captured", error: !cfg ? "Sending is off in this environment." : "Test address: not sent." });
    return;
  }
  try {
    const messageId = await sendGmail(cfg, { fromName: "signfile", to: user.email, toName: user.name, ...resetEmail({ name: user.name, email: user.email, link }) });
    await db.insert(schema.outbox).values({ ...base, status: "sent", provider: "gmail", providerMessageId: messageId, attempts: 1, sentAt: new Date() });
  } catch (e) {
    // "skipped", not "failed": a retry from the Outbox would resend the copy without the link.
    const msg = ((e as Error).message || "Unknown error").slice(0, 300);
    await db.insert(schema.outbox).values({ ...base, status: "skipped", provider: "gmail", attempts: 1, error: `Not delivered (${msg}). Ask for a new reset link.` });
  }
}

/** For the reset page: is this link usable right now? */
export async function checkResetToken(token: unknown): Promise<TokenState> {
  if (!looksLikeResetToken(token)) return "invalid";
  const [row] = await db
    .select({ expiresAt: schema.passwordResetTokens.expiresAt, usedAt: schema.passwordResetTokens.usedAt })
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.tokenHash, hashResetToken(token)))
    .limit(1);
  return resetTokenState(row);
}

export const SAME_PASSWORD_MESSAGE = "Please choose a password different from your current one.";

export type ResetResult = { ok: true } | { ok: false; field?: "password"; error: string; state?: TokenState };

export async function resetPassword(token: unknown, password: string): Promise<ResetResult> {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, field: "password", error: problem };
  if (!looksLikeResetToken(token)) return { ok: false, error: "This reset link isn't valid.", state: "invalid" };
  const hash = hashResetToken(token);

  // Same as the current password? Checked against the stored hash before the link is claimed,
  // so the link still works for a second try. An unusable link falls through to the claim below.
  const [current] = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.passwordResetTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.passwordResetTokens.userId))
    .where(and(eq(schema.passwordResetTokens.tokenHash, hash), isNull(schema.passwordResetTokens.usedAt), gt(schema.passwordResetTokens.expiresAt, new Date())))
    .limit(1);
  if (current?.passwordHash && (await verifyPassword(current.passwordHash, password))) {
    return { ok: false, field: "password", error: SAME_PASSWORD_MESSAGE };
  }

  const passwordHash = await hashPassword(password); // slow (argon2): done before the transaction

  const done = await db.transaction(async (tx) => {
    const now = new Date();
    // Claim: unused, unexpired, hash matches. Exactly one request can win.
    const [claimed] = await tx
      .update(schema.passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(schema.passwordResetTokens.tokenHash, hash), isNull(schema.passwordResetTokens.usedAt), gt(schema.passwordResetTokens.expiresAt, now)))
      .returning({ userId: schema.passwordResetTokens.userId });
    if (!claimed) return false;
    await tx.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, claimed.userId));
    // Every other outstanding link for this user stops working, and every session ends.
    await tx
      .update(schema.passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(schema.passwordResetTokens.userId, claimed.userId), isNull(schema.passwordResetTokens.usedAt)));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, claimed.userId));
    return true;
  });
  if (done) return { ok: true };
  const state = await checkResetToken(token);
  return { ok: false, error: "This reset link has expired or was already used. Ask for a new one.", state: state === "valid" ? "used" : state };
}

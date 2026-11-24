/**
 * Forgot password: pure helpers (no database), so they can be unit tested.
 * The raw token lives only in the emailed link; the database stores its SHA-256.
 */
import { createHash, randomBytes } from "node:crypto";

export const RESET_TTL_MS = 60 * 60_000; // 1 hour

/** 32 random bytes (256 bits), base64url: safe in a URL, impossible to guess. */
export function newResetToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashResetToken(token) };
}

export const hashResetToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Shape check before any database lookup: 43 base64url characters. */
export const looksLikeResetToken = (token: unknown): token is string => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

export type TokenState = "valid" | "invalid" | "expired" | "used";

/** A stored token row (or none) at a given time. Used tokens report "used" even when also expired. */
export function resetTokenState(row: { expiresAt: Date; usedAt: Date | null } | null | undefined, now = new Date()): TokenState {
  if (!row) return "invalid";
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

/** The one message the request form ever shows, whether or not the email has an account. */
export const RESET_REQUESTED_MESSAGE = "If an account exists for that email, we've sent a link to reset your password. The link works once and expires in 1 hour.";

/**
 * In-memory sliding-window limits for reset requests, like the login throttle: per email
 * (3 an hour) so one inbox can't be flooded, and per IP (10 an hour) so one client can't spray
 * many addresses. Single Render instance; would move to Postgres if we scaled out.
 */
export class ResetLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limits = { perEmail: 3, perIp: 10, windowMs: 60 * 60_000 },
    private readonly clock: () => number = Date.now,
  ) {}

  private recent(key: string) {
    const now = this.clock();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.limits.windowMs);
    this.hits.set(key, list);
    return list;
  }

  /** Records the attempt and says which limit (if any) it went over. Over-limit attempts still count. */
  hit(email: string, ip: string | null): { ipLimited: boolean; emailLimited: boolean } {
    if (this.hits.size > 10_000) this.hits.clear();
    const ipKey = `ip:${ip ?? "unknown"}`;
    const emailKey = `email:${email}`;
    const ipLimited = this.recent(ipKey).length >= this.limits.perIp;
    const emailLimited = this.recent(emailKey).length >= this.limits.perEmail;
    this.recent(ipKey).push(this.clock());
    this.recent(emailKey).push(this.clock());
    return { ipLimited, emailLimited };
  }
}

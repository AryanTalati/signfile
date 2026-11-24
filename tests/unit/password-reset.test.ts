import assert from "node:assert/strict";
import { test } from "node:test";
import { hashResetToken, looksLikeResetToken, newResetToken, RESET_TTL_MS, ResetLimiter, resetTokenState } from "../../src/lib/auth/reset-token";
import { resetEmail } from "../../src/lib/auth/password-reset";

test("reset token: 256-bit random, base64url; only the SHA-256 is meant for storage", () => {
  const a = newResetToken();
  const b = newResetToken();
  assert.equal(a.token.length, 43);
  assert.ok(looksLikeResetToken(a.token));
  assert.notEqual(a.token, b.token);
  assert.equal(a.hash, hashResetToken(a.token));
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.notEqual(a.hash, a.token);
  assert.equal(RESET_TTL_MS, 60 * 60_000);
});

test("reset token: malformed values are rejected before any lookup", () => {
  for (const bad of [undefined, null, 42, "", "short", "a".repeat(44), "a".repeat(42) + "=", "a".repeat(42) + "/"]) assert.equal(looksLikeResetToken(bad), false, String(bad));
});

test("reset token state: valid, expired, used, invalid", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  assert.equal(resetTokenState({ expiresAt: new Date("2026-11-23T12:30:00Z"), usedAt: null }, now), "valid");
  assert.equal(resetTokenState({ expiresAt: new Date("2026-11-23T12:00:00Z"), usedAt: null }, now), "expired"); // at the expiry instant
  assert.equal(resetTokenState({ expiresAt: new Date("2026-11-23T11:00:00Z"), usedAt: null }, now), "expired");
  assert.equal(resetTokenState({ expiresAt: new Date("2026-11-23T12:30:00Z"), usedAt: new Date("2026-11-23T11:59:00Z") }, now), "used");
  assert.equal(resetTokenState(undefined, now), "invalid");
});

test("rate limits: 3 per email and 10 per IP per hour, sliding", () => {
  let t = 0;
  const l = new ResetLimiter({ perEmail: 3, perIp: 10, windowMs: 3_600_000 }, () => t);
  for (let i = 0; i < 3; i++) assert.deepEqual(l.hit("a@x.example", "1.1.1.1"), { ipLimited: false, emailLimited: false });
  assert.equal(l.hit("a@x.example", "1.1.1.1").emailLimited, true);
  // Same email from another IP is still limited (per email), a new email from the first IP is not yet.
  assert.equal(l.hit("a@x.example", "2.2.2.2").emailLimited, true);
  assert.equal(l.hit("b@x.example", "1.1.1.1").emailLimited, false);
  // 1.1.1.1 has now made 5 requests; 5 more different emails reach 10, the 11th is IP-limited.
  for (let i = 0; i < 5; i++) assert.equal(l.hit(`c${i}@x.example`, "1.1.1.1").ipLimited, false);
  assert.equal(l.hit("d@x.example", "1.1.1.1").ipLimited, true);
  // An hour later both windows have cleared.
  t = 3_600_001;
  assert.deepEqual(l.hit("a@x.example", "1.1.1.1"), { ipLimited: false, emailLimited: false });
});

test("reset email: the sent copy has the link; the copy kept in the Outbox never does", () => {
  const link = "https://app.example/reset-password?token=" + "a".repeat(43);
  const sent = resetEmail({ name: "Ann Example", email: "ann@x.example", link });
  assert.ok(sent.html.includes(link) && sent.text.includes(link));
  const kept = resetEmail({ name: "Ann Example", email: "ann@x.example", link: null });
  assert.ok(!kept.html.includes("token=") && !kept.text.includes("token="));
  assert.match(kept.text, /not stored in the Outbox/);
  assert.match(sent.text, /expires in 1 hour/);
});

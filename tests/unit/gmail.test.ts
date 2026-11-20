import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { accessToken, buildMime, gmailConfig, isTestAddress, resetTokenCache, sendGmail, type GmailConfig } from "../../src/lib/email/gmail";

const cfg: GmailConfig = { clientId: "cid-123", clientSecret: "SECRET-abc", refreshToken: "REFRESH-xyz", sender: "sender@signfile-demo.test" };
const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => resetTokenCache());

test("config requires all four variables", () => {
  assert.equal(gmailConfig({ GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REFRESH_TOKEN: "c" } as unknown as NodeJS.ProcessEnv), null);
  assert.ok(gmailConfig({ GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REFRESH_TOKEN: "c", GMAIL_SENDER: "d@x.org" } as unknown as NodeJS.ProcessEnv));
});

test("access token is fetched once and cached until near expiry", async () => {
  let calls = 0;
  const f = (async () => (calls++, jsonRes(200, { access_token: "tok-1", expires_in: 3600 }))) as typeof fetch;
  const t0 = 1_000_000;
  assert.equal(await accessToken(cfg, f, t0), "tok-1");
  assert.equal(await accessToken(cfg, f, t0 + 30 * 60_000), "tok-1");
  assert.equal(calls, 1);
  await accessToken(cfg, f, t0 + 3600_000); // past expiry: refresh
  assert.equal(calls, 2);
});

test("sends raw base64url MIME with UTF-8 subject, names and body, plus attachments", async () => {
  type Sent = { url: string; body: string; auth: string };
  const box: { sent: Sent | null } = { sent: null };
  const f = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("oauth2")) return jsonRes(200, { access_token: "tok", expires_in: 3600 });
    box.sent = { url: String(url), body: String(init?.body), auth: String((init?.headers as Record<string, string>).authorization) };
    return jsonRes(200, { id: "msg-1" });
  }) as typeof fetch;
  const id = await sendGmail(cfg, { fromName: "Riverton Consulting · Ünïcode", to: "client@realdomain.org", toName: "José Núñez", subject: "Please sign “Agreement” — ✓", text: "Héllo ✓", html: "<p>Héllo ✓</p>", attachments: [{ filename: "signed.pdf", contentType: "application/pdf", content: new Uint8Array([37, 80, 68, 70]) }] }, f);
  assert.equal(id, "msg-1");
  const sent = box.sent;
  assert.ok(sent);
  assert.match(sent.url, /gmail\/v1\/users\/me\/messages\/send$/);
  assert.equal(sent.auth, "Bearer tok");
  const raw = JSON.parse(sent.body).raw as string;
  assert.match(raw, /^[A-Za-z0-9_-]+$/, "base64url");
  const mime = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(mime, /^Subject: =\?UTF-8\?B\?/m);
  assert.equal(Buffer.from(/Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(mime)![1], "base64").toString("utf8"), "Please sign “Agreement” — ✓");
  assert.match(mime, /^From: =\?UTF-8\?B\?[^?]+\?= <sender@signfile-demo\.test>/m);
  assert.match(mime, /Content-Type: text\/html; charset="UTF-8"/);
  assert.match(mime, /Content-Disposition: attachment; filename="signed.pdf"/);
  const htmlB64 = /charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g;
  const parts = [...mime.matchAll(htmlB64)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8"));
  assert.deepEqual(parts, ["Héllo ✓", "<p>Héllo ✓</p>"]);
});

test("header injection via CR/LF is neutralised", () => {
  const mime = buildMime("s@x.org", { fromName: "Firm\r\nBcc: evil@x.org", to: "a@b.org\r\nBcc: evil@x.org", subject: "Hi\r\nBcc: evil@x.org", text: "t", html: "h" });
  assert.doesNotMatch(mime, /^Bcc:/m);
});

test("errors carry status and Google's message, never credentials", async () => {
  const f = (async (url: string) =>
    String(url).includes("oauth2") ? jsonRes(200, { access_token: "tok", expires_in: 3600 }) : jsonRes(403, { error: { status: "PERMISSION_DENIED", message: "Insufficient scope" } })) as typeof fetch;
  await assert.rejects(sendGmail(cfg, { fromName: "F", to: "a@realdomain.org", subject: "s", text: "t", html: "h" }, f), (e: Error) => {
    assert.match(e.message, /403 PERMISSION_DENIED: Insufficient scope/);
    for (const secret of [cfg.clientSecret, cfg.refreshToken, "tok"]) assert.ok(!e.message.includes(secret));
    return true;
  });
  resetTokenCache();
  const bad = (async () => jsonRes(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." })) as typeof fetch;
  await assert.rejects(accessToken(cfg, bad), (e: Error) => !e.message.includes("REFRESH") && !e.message.includes("SECRET") && /invalid_grant/.test(e.message));
});

test("reserved test domains are never sent", () => {
  for (const a of ["jamie@example.com", "x@example.org", "y@foo.example", "z@signfile-e2e.example", "q@bar.test", "r@baz.invalid"]) assert.ok(isTestAddress(a), a);
  for (const a of ["client@gmail.com", "ops@acme-rentals.com"]) assert.ok(!isTestAddress(a), a);
});

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { afterAttempt, checkTargetUrl, type EventContext, MAX_ATTEMPTS, maskSecretUrl, retryDelayMs, signBody, slackText, webhookPayload } from "../../src/lib/integrations/core";
import { createDispatcher, type FileEvent } from "../../src/lib/integrations/dispatch";

const tick = () => new Promise((r) => setTimeout(r, 10));
const event: FileEvent = { event: "file.signed", companyId: "c1", fileId: "f1", recipientId: "r1", baseUrl: "https://app.example" };

test("dispatcher: events reach every subscriber, in the background", async () => {
  const got: string[] = [];
  const emit = createDispatcher(() => [async (e) => void got.push(`a:${e.event}:${e.fileId}`), async (e) => void got.push(`b:${e.event}`)]);
  emit(event);
  assert.deepEqual(got, []); // emit returned before any subscriber ran
  await tick();
  assert.deepEqual(got.sort(), ["a:file.signed:f1", "b:file.signed"]);
});

test("dispatcher: a failing subscriber never reaches the caller or the other subscribers", async () => {
  const got: string[] = [];
  const errors = console.error;
  console.error = () => undefined;
  try {
    const emit = createDispatcher(() => [
      async () => {
        throw new Error("webhook down");
      },
      () => {
        throw new Error("sync throw");
      },
      async (e) => void got.push(e.event),
    ]);
    assert.doesNotThrow(() => emit({ ...event, event: "file.completed" }));
    await tick();
    assert.deepEqual(got, ["file.completed"]);
    // Even the subscriber list failing to load is contained.
    assert.doesNotThrow(() => createDispatcher(() => Promise.reject(new Error("import failed")))(event));
    await tick();
  } finally {
    console.error = errors;
  }
});

test("signature header: sha256=HMAC-SHA256(secret, exact body), hex", () => {
  const body = JSON.stringify({ type: "file.completed", file: { id: "f1" } });
  const secret = "test-secret-0123456789";
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(signBody(secret, body), `sha256=${expected}`);
  assert.notEqual(signBody(secret, body + " "), signBody(secret, body)); // any byte change breaks it
  assert.notEqual(signBody("other-secret-0123456789", body), signBody(secret, body));
});

test("retries: 3 attempts with growing backoff, then failed; a manual retry is a single attempt", () => {
  assert.equal(MAX_ATTEMPTS, 3);
  assert.equal(afterAttempt(1, false), "pending");
  assert.equal(afterAttempt(2, false), "pending");
  assert.equal(afterAttempt(3, false), "failed");
  assert.equal(afterAttempt(2, true), "delivered");
  assert.equal(afterAttempt(4, false, true), "failed");
  assert.ok(retryDelayMs(2) > retryDelayMs(1));
});

test("target URLs: https and public only; Slack must be hooks.slack.com", () => {
  assert.ok("url" in checkTargetUrl("https://example.com/hook", "webhook"));
  for (const bad of ["http://example.com/hook", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://192.168.1.2/x", "https://169.254.169.254/latest", "https://user:pw@example.com/", "not a url"])
    assert.ok("error" in checkTargetUrl(bad, "webhook"), bad);
  assert.ok("error" in checkTargetUrl("https://example.com/services/x", "slack"));
  assert.ok("url" in checkTargetUrl("https://hooks.slack.com/services/T0/B0/x", "slack"));
  assert.ok("url" in checkTargetUrl("http://host.docker.internal:4555/hook", "webhook", true)); // E2E receiver only
});

const ctx: EventContext = {
  type: "file.signed",
  at: new Date("2026-11-21T18:00:00.000Z"),
  file: { id: "f1", reference: "JOB-7", status: "partially_signed", clientLegalName: "Northwind Analytics LLC", sentAt: new Date("2026-11-21T17:00:00Z"), completedAt: null, expiresAt: null },
  documentName: "Consulting Services Agreement",
  firm: "Astra AI",
  signers: [{ role: "client", name: "Jordan Blake", email: "jordan@example.com", status: "signed", signedAt: new Date("2026-11-21T18:00:00Z") }],
  signer: { name: "Jordan Blake", email: "jordan@example.com" },
  signedPdfUrl: "https://app.example/api/sign/tok/download",
  reason: null,
};

test("Slack: one short plain-text line", () => {
  assert.equal(slackText(ctx), "Jordan Blake signed 'Consulting Services Agreement' (Northwind Analytics LLC)");
  assert.equal(slackText({ ...ctx, type: "file.declined", reason: "Wrong rate" }), "Jordan Blake declined 'Consulting Services Agreement' (Northwind Analytics LLC): Wrong rate");
});

test("payload: UTC timestamps; signed PDF link only on file.completed", () => {
  const p = webhookPayload(ctx, "d1");
  assert.equal(p.occurredAt, "2026-11-21T18:00:00.000Z");
  assert.equal(p.file.reference, "JOB-7");
  assert.equal(p.signers[0].signedAt, "2026-11-21T18:00:00.000Z");
  assert.ok(!("signedPdfUrl" in p));
  assert.equal(webhookPayload({ ...ctx, type: "file.completed" }, "d2").signedPdfUrl, "https://app.example/api/sign/tok/download");
});

test("a saved Slack URL is only ever shown masked: host and last 4 characters", () => {
  const url = "https://hooks.slack.com/services/T0AAAAAAA/B0BBBBBBB/abcdEFGHijklMNOPqrst1234";
  const masked = maskSecretUrl(url)!;
  assert.equal(masked, "hooks.slack.com/…1234");
  assert.ok(!masked.includes("T0AAAAAAA") && !masked.includes("abcdEFGH"));
  assert.equal(maskSecretUrl("https://hooks.slack.com/services/x/y/zzzz9876/"), "hooks.slack.com/…9876");
  assert.equal(maskSecretUrl(null), null);
  assert.equal(maskSecretUrl(""), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventContext } from "../../src/lib/integrations/core";
import { mindAcceptedId, mindDocument, safeMindArgs } from "../../src/lib/integrations/mind";

const ctx: EventContext = {
  type: "file.completed",
  at: new Date("2026-11-22T19:00:00Z"),
  file: { id: "f1", reference: "JOB-7", status: "completed", clientLegalName: "Northwind Test Analytics LLC", sentAt: new Date("2026-11-20T10:00:00Z"), completedAt: new Date("2026-11-22T18:59:00Z"), expiresAt: null },
  documentName: "Consulting Services Agreement",
  firm: "Astra AI",
  signers: [
    { role: "client", name: "Jordan Blake", email: "jordan@example.com", status: "signed", signedAt: new Date("2026-11-21T15:00:00Z") },
    { role: "firm", name: "Test Admin", email: "admin@example.com", status: "signed", signedAt: new Date("2026-11-22T18:59:00Z") },
  ],
  signer: null,
  signedPdfUrl: null,
  reason: null,
  version: 2,
  terms: { fee: { found: true, value: "$4,500 per month" }, term: { found: false, value: null }, governing_law: { found: true, value: "State of Delaware" } },
  fileUrl: "https://app.example/files/f1",
  verifyUrl: "https://app.example/verify",
};

test("MIND document: a private create with the agreement facts, no contact data", () => {
  const d = mindDocument(ctx);
  assert.equal(d.action, "create");
  assert.equal(d.type, "document");
  assert.equal(d.title, "Signed: Consulting Services Agreement — Northwind Test Analytics LLC");
  assert.deepEqual(d.tags, ["signfile", "agreement"]);
  assert.equal(d.source, "signfile");
  for (const line of [
    "Client: Northwind Test Analytics LLC",
    "Agreement: Consulting Services Agreement (version 2)",
    "Reference: JOB-7",
    "Fee: $4,500 per month",
    "Governing law: State of Delaware",
    "Signed by Jordan Blake (Northwind Test Analytics LLC) on 2026-11-21",
    "Countersigned by Test Admin (Astra AI) on 2026-11-22",
    "File: https://app.example/files/f1",
    "Verify the signed PDF: https://app.example/verify",
  ])
    assert.ok(d.content.includes(line), line);
  assert.doesNotMatch(d.content, /@|Term:/); // no emails; a term not found is left out, never guessed
  assert.doesNotMatch(d.content, /jordan@|admin@|example\.com/i);
});

test("whatever is stored, only a private document create is sent", () => {
  const a = safeMindArgs({ action: "delete", type: "feed_post", title: "t", content: "c", tags: ["x"], source: "y" })!;
  assert.deepEqual(a, { action: "create", type: "document", title: "t", content: "c", tags: ["signfile", "agreement"], source: "signfile" });
  assert.equal(safeMindArgs({ type: "document" }), null);
});

test("accepted with an id (status PROCESSING) counts as delivered", () => {
  assert.equal(mindAcceptedId('{"id":"81df4a04","status":"PROCESSING"}'), "81df4a04");
  assert.equal(mindAcceptedId("Error: MIND API error 401"), null);
});

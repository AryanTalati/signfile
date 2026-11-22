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

test("parties: a bare generic role gets the client's name; a named party is left alone", async () => {
  const { nameParties } = await import("../../src/lib/integrations/mind");
  const client = "Northwind Analytics LLC";
  assert.equal(nameParties("Lumen Cloud Software Inc. (Vendor) and Customer", client), "Lumen Cloud Software Inc. (Vendor) and Northwind Analytics LLC (Customer)");
  assert.equal(nameParties("Astra AI (Provider) and the Client", client), "Astra AI (Provider) and Northwind Analytics LLC (Client)");
  assert.equal(nameParties("Lumen Cloud Software Inc. (Vendor) and Northwind Analytics LLC (Customer)", client), "Lumen Cloud Software Inc. (Vendor) and Northwind Analytics LLC (Customer)");
  assert.equal(nameParties('Acme Corp (the "Company") and Jane Example', client), 'Acme Corp (the "Company") and Jane Example'); // role already defined, in quotes
  assert.equal(nameParties("Customer Corp and Vendor Inc", client), "Customer Corp and Vendor Inc"); // part of a name
});

test("effective date 'date of the last signature' becomes the completion date on a completed File", async () => {
  const { effectiveDate } = await import("../../src/lib/integrations/mind");
  const done = new Date("2026-11-22T18:59:00Z");
  assert.equal(effectiveDate("Date of the last signature", done), "2026-11-22 (date of the last signature)");
  assert.equal(effectiveDate("the date on which it is signed by both parties", done), "2026-11-22 (date of the last signature)");
  assert.equal(effectiveDate("Date of the last signature", null), "Date of the last signature"); // not complete: as written
  assert.equal(effectiveDate("November 1, 2026", done), "November 1, 2026");
});

test("the payload uses them, keeps 'Firm:', and links to this File's verification", () => {
  const d = mindDocument({
    ...ctx,
    terms: { parties: { found: true, value: "Lumen Cloud Software Inc. (Vendor) and Customer" }, effective_date: { found: true, value: "Date of the last signature" } },
    file: { ...ctx.file, clientLegalName: "Northwind Analytics LLC" },
    verifyUrl: "https://app.example/verify?file=f1",
  });
  assert.ok(d.content.includes("Parties: Lumen Cloud Software Inc. (Vendor) and Northwind Analytics LLC (Customer)"));
  assert.ok(d.content.includes("Effective date: 2026-11-22 (date of the last signature)"));
  assert.ok(d.content.includes("Firm: Astra AI"));
  assert.ok(d.content.includes("Verify the signed PDF: https://app.example/verify?file=f1"));
});

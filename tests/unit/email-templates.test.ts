import assert from "node:assert/strict";
import { test } from "node:test";
import { countersignRequestEmail, signerLabel } from "../../src/lib/email/templates";

const brand = { name: "Acme Rentals", color: "#123456" };

test("countersign email names the person who signed, never the firm", () => {
  const e = countersignRequestEmail({ brand, recipientName: "Firm Signer", documentName: "Services Agreement", signerName: "Amber Rivers", signerCompany: "Acme Rentals LLC", link: "https://x/sign/t" });
  assert.equal(e.subject, 'Countersign: Amber Rivers signed "Services Agreement"');
  assert.doesNotMatch(e.subject + e.text + e.html, /Acme Rentals LLC/);
});

test("the client's company is added when one was entered and it isn't the firm", () => {
  const e = countersignRequestEmail({ brand, recipientName: "Firm Signer", documentName: "Services Agreement", signerName: "Amber Rivers", signerCompany: "Globex Test Ltd", link: "https://x/sign/t" });
  assert.equal(e.subject, 'Countersign: Amber Rivers (Globex Test Ltd) signed "Services Agreement"');
  assert.match(e.html, /<strong>Amber Rivers \(Globex Test Ltd\)<\/strong> has signed/);
});

test("signerLabel ignores punctuation/case/suffix differences when comparing to the firm name", () => {
  assert.equal(signerLabel("Amber Rivers", "ACME RENTALS", "Acme Rentals"), "Amber Rivers");
  assert.equal(signerLabel("Amber Rivers", "", "Acme Rentals"), "Amber Rivers");
  assert.equal(signerLabel("Amber Rivers", null, "Acme Rentals"), "Amber Rivers");
});

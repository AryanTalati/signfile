import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifyLabel, detectFields } from "../../src/lib/pdf/detect";
import { extractLayout } from "../../src/lib/pdf/extract";

const kind = (s: string) => classifyLabel(s)?.kind ?? null;

test("labels: dates win over 'signed'; signature needs a real signature word", () => {
  for (const l of ["Date signed:", "Signed date", "Date of signature:", "Signed on:", "Date:", "Dated:", "Signature date"]) assert.equal(kind(l), "date", l);
  for (const l of ["Signature:", "By:", "Authorized signatory:", "Authorised signatory", "Sign here", "Signed for the Client:", "SIGNED by"]) assert.equal(kind(l), "signature", l);
  for (const l of ["Signed", "Signed:", "Designed by:", "Assigned to:"]) assert.notEqual(kind(l), "signature", l);
});

test("labels: name, title and company variants", () => {
  for (const l of ["Name (print):", "Printed name", "Name:"]) assert.equal(kind(l), "full_name", l);
  for (const l of ["Position:", "Title:", "Its:"]) assert.equal(kind(l), "title", l);
  for (const l of ["Customer legal name:", "Company:", "Client company:", "Organization:", "Organisation:", "Legal name:"]) assert.equal(kind(l), "company", l);
});

test("SaaS vendor/customer signature table: 'Date signed' is a date, one signature per side, company for each", async () => {
  const layout = await extractLayout(new Uint8Array(readFileSync("fixtures/agreements/pdf-saas-table.pdf")));
  const d = detectFields(layout, { firmName: "Cloudly Test Software Inc." });
  const of = (role: string, type: string) => d.fields.filter((f) => f.roleKey === role && f.type === type);
  for (const role of ["firm", "client"]) {
    assert.equal(of(role, "signature").length, 1, `${role}: exactly one signature`);
    assert.equal(of(role, "date_signed").length, 1, `${role}: Date signed is a date`);
    assert.equal(of(role, "company").length, 1, `${role}: company`);
    assert.equal(of(role, "full_name").length, 1, `${role}: Name (print)`);
    assert.equal(of(role, "title").length, 1, `${role}: Position`);
    // The date sits on the "Date signed" row, below the signature.
    assert.ok(of(role, "date_signed")[0].y > of(role, "signature")[0].y);
  }
});

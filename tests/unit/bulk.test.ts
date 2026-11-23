import assert from "node:assert/strict";
import { test } from "node:test";
import { autoMap, columnsFor, headerTemplateCsv, parseCsv, resultCsv, rowKey, toCsv, validateRows } from "../../src/lib/bulk/core";
import type { FieldDef } from "../../src/lib/fields/types";

const fill = (id: string, label: string, required = true, key = id) => ({ id, type: "firm_fill", label, required, firmFillKey: key, roleKey: null, page: 1, x: 0, y: 0, w: 0.1, h: 0.02, confidence: 1, source: "manual" }) as unknown as FieldDef;
const sig = { id: "s1", type: "signature", label: "Signature", required: true, roleKey: "client", page: 1, x: 0, y: 0, w: 0.1, h: 0.02, confidence: 1, source: "rule" } as unknown as FieldDef;
const fields = [sig, fill("f1", "Monthly fee", true, "fee"), fill("f2", "Start date", true, "start"), fill("f3", "Notes", false, "notes")];
const T = "11111111-1111-1111-1111-111111111111";

test("columns come from the template's own fields", () => {
  const cols = columnsFor(fields);
  assert.deepEqual(
    cols.map((c) => c.key),
    ["client_legal_name", "signer_name", "signer_email", "signer_title", "reference", "external_id", "cc_emails", "monthly_fee", "start_date", "notes"],
  );
  assert.deepEqual(cols.find((c) => c.key === "start_date")!.target, { kind: "firm", firmKey: "start", date: true });
  assert.equal(headerTemplateCsv(cols).split("\r\n")[0], "client_legal_name,signer_name,signer_email,signer_title,reference,external_id,cc_emails,monthly_fee,start_date,notes");
});

test("CSV parsing: quotes, escaped quotes, commas and newlines in cells, CRLF, BOM, blank lines", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\n\n"multi\nline",z\n'), [
    ["a", "b"],
    ["x, y", 'he said "hi"'],
    ["multi\nline", "z"],
  ]);
  // Round trip, and spreadsheet formulas neutralized on the way out.
  assert.deepEqual(parseCsv(toCsv([["a,b", 'q"q', "=HYPERLINK(1)"]])), [["a,b", 'q"q', "'=HYPERLINK(1)"]]);
});

test("header mapping: exact names, labels and common aliases", () => {
  const cols = columnsFor(fields);
  const m = autoMap(["Company", "Contact Name", "Email Address", "Monthly Fee", "start_date", "CRM ID"], cols);
  assert.equal(m.client_legal_name, 0);
  assert.equal(m.signer_name, 1);
  assert.equal(m.signer_email, 2);
  assert.equal(m.monthly_fee, 3);
  assert.equal(m.start_date, 4);
  assert.equal(m.external_id, 5);
  assert.equal(m.signer_title, -1);
});

test("validation: bad rows get reasons; duplicates and already-sent rows are skipped unless resent", () => {
  const cols = columnsFor(fields);
  const headers = ["client_legal_name", "signer_name", "signer_email", "monthly_fee", "start_date"];
  const map = autoMap(headers, cols);
  const rows = parseCsv(
    [
      "Acme Test LLC,Ann Example,ann@example.com,$1000,2026-12-01",
      "Bolt Test Inc,Bo Example,not-an-email,$2000,2026-12-01",
      ",Cy Example,cy@example.com,$3000,December 5 2026",
      "Dup Test Co,Ann Again,ANN@example.com,$4000,2026-12-01",
      "Echo Test LLC,Ed Example,ed@example.com,,someday",
      "Fox Test LLC,Fay Example,fay@example.com,$6000,2026-12-02",
    ].join("\n"),
  );
  const sent = new Map([[rowKey(T, "fay@example.com", ""), { fileId: "f-old", at: "2026-11-20T10:00:00Z" }]]);
  const out = validateRows(rows, cols, map, T, sent);
  assert.deepEqual(
    out.map((r) => [r.rowNo, r.status]),
    [
      [1, "ready"],
      [2, "invalid"],
      [3, "invalid"],
      [4, "duplicate"],
      [5, "invalid"],
      [6, "already_sent"],
    ],
  );
  assert.deepEqual(out[1].reasons, ['"not-an-email" isn\'t a valid email']);
  assert.deepEqual(out[2].reasons, ["Client legal name is empty"]);
  assert.match(out[3].reasons[0], /same signer as row 1/);
  assert.deepEqual(out[4].reasons, ["Monthly fee is empty", 'Start date: "someday" isn\'t a date']);
  assert.equal(out[5].reasons[0], "already sent on 2026-11-20");
  // A date in words becomes the date picker's format.
  assert.equal(validateRows([["Cy Test", "Cy Example", "cy@example.com", "$3", "December 5 2026"]], cols, map, T)[0].values.firmValues.start, "2026-12-05");
  // Ticking "resend" for that row sends it again.
  assert.equal(validateRows(rows, cols, map, T, sent, new Set([6]))[5].status, "ready");
});

test("an external_id tells two rows for the same signer apart", () => {
  const cols = columnsFor([sig]);
  const map = autoMap(["client_legal_name", "signer_name", "signer_email", "external_id"], cols);
  const out = validateRows(
    [
      ["Acme Test LLC", "Ann Example", "ann@example.com", "A-1"],
      ["Acme Test LLC", "Ann Example", "ann@example.com", "A-2"],
      ["Acme Test LLC", "Ann Example", "ann@example.com", "A-2"],
    ],
    cols,
    map,
    T,
  );
  assert.deepEqual(out.map((r) => r.status), ["ready", "ready", "duplicate"]);
});

test("result CSV: each input row plus status, link and reason", () => {
  const csv = resultCsv(["client_legal_name", "signer_email"], [
    { cells: ["Acme Test LLC", "ann@example.com"], status: "sent", link: "https://app.example/files/1", reason: "" },
    { cells: ["Bolt Test Inc", "bad"], status: "skipped", link: "", reason: '"bad" isn\'t a valid email' },
  ]);
  assert.deepEqual(parseCsv(csv), [
    ["client_legal_name", "signer_email", "file_status", "file_link", "skip_reason"],
    ["Acme Test LLC", "ann@example.com", "sent", "https://app.example/files/1", ""],
    ["Bolt Test Inc", "bad", "skipped", "", '"bad" isn\'t a valid email'],
  ]);
});

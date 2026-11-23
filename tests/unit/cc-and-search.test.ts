import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { ccEmailsField, parseCcEmails } from "../../src/lib/files/cc";
import { filesWhere, likePattern, parseFilesQuery } from "../../src/lib/files/list-filter";
import { validateRows, columnsFor } from "../../src/lib/bulk/core";

// ---------- CC ("Send the signed copy to") ----------

test("CC: comma separated, trimmed, lowercased, de-duplicated; empty is fine", () => {
  assert.deepEqual(parseCcEmails(" Legal@Client.example , finance@client.example,legal@client.example "), { emails: ["legal@client.example", "finance@client.example"] });
  assert.deepEqual(parseCcEmails("a@example.com; b@example.com\nc@example.com"), { emails: ["a@example.com", "b@example.com", "c@example.com"] });
  assert.deepEqual(parseCcEmails(""), { emails: [] });
  assert.deepEqual(parseCcEmails(undefined), { emails: [] });
  assert.deepEqual(parseCcEmails(" , ,"), { emails: [] });
});

test("CC: an invalid address is named; more than 5 is rejected", () => {
  assert.deepEqual(parseCcEmails("ok@example.com, not-an-email"), { error: '"not-an-email" isn\'t a valid email.' });
  assert.deepEqual(parseCcEmails("1@x.example,2@x.example,3@x.example,4@x.example,5@x.example,6@x.example"), { error: "Up to 5 emails." });
  assert.deepEqual(parseCcEmails("1@x.example,2@x.example,3@x.example,4@x.example,5@x.example"), { emails: ["1@x.example", "2@x.example", "3@x.example", "4@x.example", "5@x.example"] });
});

test("CC: the form field gives a clean list or a validation error", () => {
  assert.deepEqual(ccEmailsField.parse("a@example.com, B@example.com"), ["a@example.com", "b@example.com"]);
  assert.deepEqual(ccEmailsField.parse(undefined), []);
  const bad = ccEmailsField.safeParse("a@example.com, nope");
  assert.equal(bad.success, false);
  assert.equal(bad.error!.issues[0].message, '"nope" isn\'t a valid email.');
});

test("CC: bulk cc_emails column is validated per row and normalized", () => {
  const cols = columnsFor([]);
  const headers = cols.map((c) => c.key);
  const mapping = Object.fromEntries(headers.map((h, i) => [h, i]));
  const row = (cc: string) => ["Test Client LLC", "Ann Example", "ann@example.com", "", "", "", cc];
  const [ok, bad] = validateRows([row("Legal@Example.com, ops@example.com"), row("legal@example.com, oops")], cols, mapping, "t1");
  assert.equal(ok.status, "ready");
  assert.equal(ok.values.ccEmails, "legal@example.com, ops@example.com");
  assert.equal(bad.status, "invalid");
  assert.deepEqual(bad.reasons, ['Send signed copy to: "oops" isn\'t a valid email']);
});

// ---------- Files list search + status filter ----------

const compile = (companyId: string, q: string, status: string) => new PgDialect().sqlToQuery(filesWhere(companyId, parseFilesQuery({ q, status })));

test("search query: URL params are trimmed, capped, and an unknown status means All", () => {
  assert.deepEqual(parseFilesQuery({ q: "  northwind  ", status: "completed" }), { q: "northwind", status: "completed" });
  assert.deepEqual(parseFilesQuery({ q: undefined, status: "bogus" }), { q: "", status: "all" });
  assert.deepEqual(parseFilesQuery({ q: ["a", "b"], status: ["draft"] }), { q: "a", status: "draft" });
  assert.equal(parseFilesQuery({ q: "x".repeat(300) }).q.length, 100);
});

test("search query: a partial, case-insensitive match where % and _ are literal", () => {
  assert.equal(likePattern("north"), "%north%");
  assert.equal(likePattern("50%_off\\"), "%50\\%\\_off\\\\%");
});

test("search query: always scoped to the company; searches client, reference, agreement, signer name and email", () => {
  const { sql, params } = compile("company-1", "Dana", "all");
  assert.ok(sql.startsWith('("files"."company_id" = $1'), sql);
  assert.equal(params[0], "company-1");
  for (const col of ['"files"."client_legal_name" ilike', '"files"."reference" ilike', '"templates"."name" ilike', "r.name ilike", "r.email ilike"]) assert.ok(sql.includes(col), col);
  assert.ok(sql.includes("r.company_id = "), "signer match stays inside the company");
  assert.ok(params.includes("%Dana%"));
  // No search and All: only the company scope.
  const plain = compile("company-1", "", "all");
  assert.deepEqual([plain.sql, plain.params], ['"files"."company_id" = $1', ["company-1"]]);
});

test("search query: status filters, combined with search", () => {
  assert.ok(compile("c", "", "completed").sql.includes('"files"."status" = $2'));
  assert.deepEqual(compile("c", "", "completed").params, ["c", "completed"]);
  assert.deepEqual(compile("c", "", "stopped").params, ["c", "declined", "changes_requested"]);
  const client = compile("c", "", "waiting_client").sql;
  assert.ok(client.includes("<> 'firm'") && client.includes('"files"."status" in'), client);
  assert.ok(compile("c", "", "waiting_firm").sql.includes("= 'firm'"));
  const both = compile("c", "acme", "voided");
  assert.ok(both.sql.includes("ilike") && both.params.includes("voided") && both.params.includes("%acme%"));
});

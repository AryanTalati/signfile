import assert from "node:assert/strict";
import { test } from "node:test";
import { detailChanges, signedTitle } from "../../src/lib/fields/signer-details";
import type { FieldDef } from "../../src/lib/fields/types";

const f = (id: string, type: string, roleKey = "client") => ({ id, type, roleKey, page: 1, x: 0, y: 0, w: 0.1, h: 0.02, label: type, required: true }) as unknown as FieldDef;
const mine = [f("n1", "full_name"), f("n2", "full_name"), f("t1", "title")];

test("detailChanges: unchanged prefill logs nothing", () => {
  assert.deepEqual(detailChanges(mine, { n1: "Jamie", n2: "Jamie", t1: "CEO" }, { n1: "Jamie", n2: "Jamie", t1: "CEO" }), []);
});

test("detailChanges: one entry per field type, from the prefilled value", () => {
  assert.deepEqual(detailChanges(mine, { n1: "Jamie", n2: "Jamie", t1: "CEO" }, { n1: "Jamie Q", n2: "Jamie Q", t1: "COO" }), [
    { field: "Name", from: "Jamie", to: "Jamie Q" },
    { field: "Title", from: "CEO", to: "COO" },
  ]);
});

test("detailChanges: a blank prefilled title isn't a change", () => {
  assert.deepEqual(detailChanges(mine, { n1: "Jamie", n2: "Jamie", t1: "" }, { n1: "Jamie", n2: "Jamie", t1: "ceo" }), []);
});

test("signedTitle: the title typed in the signer's own Title field", () => {
  const fields = [...mine, f("t9", "title", "firm")];
  assert.equal(signedTitle(fields, "client", { t1: " ceo " }), "ceo");
  assert.equal(signedTitle(fields, "firm", { t1: "ceo" }), null);
  assert.equal(signedTitle([f("s", "signature", "firm")], "firm", {}), null);
});

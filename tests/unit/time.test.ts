import assert from "node:assert/strict";
import { test } from "node:test";
import { localStamp, shortDate, utcAndLocal, validTimeZone } from "../../src/lib/time";

const d = new Date("2026-11-20T23:19:37.123Z");

test("utcAndLocal: UTC first, then the local time with its abbreviation", () => {
  assert.equal(utcAndLocal(d, "America/Denver"), "2026-11-20 23:19:37 UTC / Nov 20, 2026, 4:19:37 PM MST");
});

test("utcAndLocal: UTC only without a (valid) zone", () => {
  assert.equal(utcAndLocal(d, null), "2026-11-20 23:19:37 UTC");
  assert.equal(utcAndLocal(d, "Not/AZone"), "2026-11-20 23:19:37 UTC");
  assert.equal(localStamp(d, ""), "");
});

test("validTimeZone", () => {
  assert.equal(validTimeZone("America/Phoenix"), "America/Phoenix");
  assert.equal(validTimeZone("Mars/Base"), null);
  assert.equal(validTimeZone(42), null);
});

test("shortDate: 'Nov 20, 2026' from a Date or ISO string", () => {
  assert.equal(shortDate(d), "Nov 20, 2026");
  assert.equal(shortDate("2026-11-20T23:23:03.109Z"), "Nov 20, 2026");
  assert.equal(shortDate("2026-11-20T23:23:03.109Z", "Asia/Tokyo"), "Nov 21, 2026");
  assert.equal(shortDate("nonsense"), "");
});

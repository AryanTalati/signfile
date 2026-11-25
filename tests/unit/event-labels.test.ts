import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { test } from "node:test";
import { EVENT_LABELS, eventLabel } from "../../src/lib/files/event-labels";

test("every event type the app emits has a plain-English label", () => {
  const emitted = new Set(
    execSync(`grep -rhoE 'type: "[a-z_]+\\.[a-z_]+"' src`, { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map((l) => l.replace(/^type: "|"$/g, "")),
  );
  const missing = [...emitted].filter((t) => !EVENT_LABELS[t]);
  assert.deepEqual(missing, [], `event types without a label: ${missing.join(", ")}`);
});

test("labels read naturally and never show a raw event name", () => {
  assert.equal(eventLabel({ type: "recipient.viewed", actorLabel: "Jamie Example" }), "Viewed by Jamie Example");
  assert.equal(eventLabel({ type: "recipient.consented", actorLabel: "Jamie Example" }), "Jamie Example agreed to sign electronically");
  assert.equal(eventLabel({ type: "file.sent", data: { to: { name: "Jamie Example" } } }), "Sent to Jamie Example for signature");
  assert.equal(eventLabel({ type: "file.voided", actorLabel: "Test Admin", data: { reason: "Wrong scope" } }), "Voided by Test Admin: Wrong scope");
  assert.doesNotMatch(eventLabel({ type: "some.future_event" }), /\./);
});

test("timeline dates read 'Nov 20, 2026', never ISO", () => {
  const label = eventLabel({ type: "recipient.auto_countersigned", actorLabel: "Test Admin", data: { authorizedAt: "2026-11-20T23:23:03.109Z" } });
  assert.match(label, /Nov 20, 2026/);
  assert.doesNotMatch(label, /2026-11-20/);
});

test("consent given in advance (automatic countersign) says so", () => {
  const label = eventLabel({ type: "recipient.consented", actorLabel: "Test Admin", data: { inAdvance: true, authorizedAt: "2026-11-20T23:23:03.109Z" } });
  assert.equal(label, "Test Admin agreed to sign electronically in advance, by authorizing automatic countersign on Nov 20, 2026");
  assert.equal(eventLabel({ type: "recipient.consented", actorLabel: "Jamie", data: {} }), "Jamie agreed to sign electronically");
});

// An authorization at 8:30 PM MST on Nov 20 is Nov 21 in UTC.
const EVENING = "2026-11-21T03:30:00.000Z";

test("certificate wording is locked: without a zone, dates inside labels stay UTC calendar days", () => {
  const consent = { type: "recipient.consented", actorLabel: "Test Admin", data: { inAdvance: true, authorizedAt: EVENING } };
  const auto = { type: "recipient.auto_countersigned", actorLabel: "Test Admin", data: { authorizedAt: EVENING } };
  assert.equal(eventLabel(consent), "Test Admin agreed to sign electronically in advance, by authorizing automatic countersign on Nov 21, 2026");
  assert.equal(eventLabel(auto), "Countersigned automatically with Test Admin's saved signature (authorized Nov 21, 2026)");
  // undefined / null / an invalid zone all give exactly the same text as before.
  for (const tz of [undefined, null, "Not/AZone"]) {
    assert.equal(eventLabel(consent, tz), eventLabel(consent));
    assert.equal(eventLabel(auto, tz), eventLabel(auto));
  }
  // Every label type: no zone gives the same text as an explicit UTC-only call.
  for (const type of Object.keys(EVENT_LABELS)) {
    const e = { type, actorLabel: "Test Admin", data: { authorizedAt: EVENING, inAdvance: true, to: { name: "Jamie" }, reason: "x" } };
    assert.equal(eventLabel(e, undefined), eventLabel(e), type);
  }
});

test("the certificate calls eventLabel without a zone (so sealed certificates never change)", () => {
  const src = readFileSync("src/lib/pdf/certificate.ts", "utf8");
  const calls = src.match(/eventLabel\(\{[^}]*\}[^)]*\)/g) ?? [];
  assert.equal(calls.length, 1, "one eventLabel call in certificate.ts");
  assert.equal(calls[0], "eventLabel({ type: e.type, actorLabel: e.actor, data })");
});

test("the File timeline can show those dates in the firm's zone", () => {
  const auto = { type: "recipient.auto_countersigned", actorLabel: "Test Admin", data: { authorizedAt: EVENING } };
  assert.equal(eventLabel(auto, "America/Denver"), "Countersigned automatically with Test Admin's saved signature (authorized Nov 20, 2026)");
  const consent = { type: "recipient.consented", actorLabel: "Test Admin", data: { inAdvance: true, authorizedAt: EVENING } };
  assert.match(eventLabel(consent, "America/Denver"), /on Nov 20, 2026$/);
});

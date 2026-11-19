import assert from "node:assert/strict";
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

import assert from "node:assert/strict";
import { test } from "node:test";
import { automationsEnabled, DAY_MS, DEFAULT_REMINDERS, dueReminder, parseReminderDays, reminderSlots } from "../../src/lib/files/reminders";

// Mocked clock: everything is relative to a fixed start time.
const t0 = new Date("2026-11-02T15:00:00Z");
const at = (days: number, hours = 0) => new Date(t0.getTime() + days * DAY_MS + hours * 3_600_000);
const exp30 = at(30);
const due = (now: Date, o: { expiresAt?: Date | null; lastEmailedAt?: Date | null; s?: typeof DEFAULT_REMINDERS } = {}) =>
  dueReminder(o.s ?? DEFAULT_REMINDERS, { activatedAt: t0, expiresAt: o.expiresAt === undefined ? exp30 : o.expiresAt, now, lastEmailedAt: o.lastEmailedAt ?? t0 })?.slot ?? null;

test("defaults: day 2, day 5, then 2 days before expiry", () => {
  assert.deepEqual(
    reminderSlots(DEFAULT_REMINDERS, t0, exp30).map((s) => [s.slot, s.dueAt.toISOString()]),
    [
      ["after:2", at(2).toISOString()],
      ["after:5", at(5).toISOString()],
      ["before_expiry:2", at(28).toISOString()],
    ],
  );
});

test("nothing before day 2; each slot once due; the latest due slot wins", () => {
  assert.equal(due(at(1, 23)), null);
  assert.equal(due(at(2)), "after:2");
  assert.equal(due(at(4, 23)), "after:2"); // same slot: the outbox unique index makes it a no-op
  assert.equal(due(at(5, 1)), "after:5");
  assert.equal(due(at(27)), "after:5");
  assert.equal(due(at(28, 1)), "before_expiry:2");
});

test("a sweep that was down for days sends one reminder, not a burst", () => {
  assert.equal(due(at(6)), "after:5"); // after:2 is skipped, not sent late
});

test("no reminders at or after expiry", () => {
  assert.equal(due(at(30)), null);
  assert.equal(due(at(31)), null);
});

test("recently emailed signers (e.g. a manual resend) aren't reminded yet", () => {
  assert.equal(due(at(2, 1), { lastEmailedAt: at(1, 12) }), null);
  assert.equal(due(at(2, 9), { lastEmailedAt: at(1, 12) }), "after:2");
});

test("short expiry: after-N slots that land on or after the final reminder are dropped", () => {
  const exp6 = at(6);
  assert.deepEqual(reminderSlots(DEFAULT_REMINDERS, t0, exp6).map((s) => s.slot), ["after:2", "before_expiry:2"]);
  assert.deepEqual(reminderSlots(DEFAULT_REMINDERS, t0, at(2)).map((s) => s.slot), []); // final would be before the turn started
});

test("disabled, no final reminder, and no expiry", () => {
  assert.equal(due(at(10), { s: { ...DEFAULT_REMINDERS, enabled: false } }), null);
  assert.deepEqual(reminderSlots({ ...DEFAULT_REMINDERS, finalDays: 0 }, t0, exp30).map((s) => s.slot), ["after:2", "after:5"]);
  assert.equal(due(at(400), { expiresAt: null }), "after:5");
});

test("settings parser", () => {
  assert.deepEqual(parseReminderDays("5, 2"), [2, 5]);
  assert.deepEqual(parseReminderDays(""), []);
  assert.equal(parseReminderDays("0"), null);
  assert.equal(parseReminderDays("1.5"), null);
  assert.equal(parseReminderDays("1,2,3,4,5,6"), null);
});

test("sweep runs only with an explicit ENABLE_SWEEP=1, never with E2E_HOOKS", () => {
  const gmail = { GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REFRESH_TOKEN: "c", GMAIL_SENDER: "d@x.org" };
  assert.equal(automationsEnabled({ ...gmail } as unknown as NodeJS.ProcessEnv), false); // Gmail alone isn't enough
  assert.equal(automationsEnabled({ ENABLE_SWEEP: "true" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(automationsEnabled({ ENABLE_SWEEP: "1" } as unknown as NodeJS.ProcessEnv), true);
  assert.equal(automationsEnabled({ ENABLE_SWEEP: "1", E2E_HOOKS: "1" } as unknown as NodeJS.ProcessEnv), false);
});

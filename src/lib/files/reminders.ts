/**
 * Reminder schedule. Pure: given when it became a signer's turn, the File's expiry and "now",
 * returns the schedule slot that is due (if any). The caller records the slot with the email;
 * a unique index on (recipient, slot) means a slot is sent at most once.
 *
 * Only the LATEST due slot is returned, so a sweep that was down for a few days sends one
 * reminder, not a burst. After-N-days slots that would land on or after the final
 * before-expiry reminder are dropped (the final one replaces them).
 */
export interface ReminderSettings {
  enabled: boolean;
  /** Days after the signer's turn starts, e.g. [2, 5]. */
  days: number[];
  /** Days before expiry for the final reminder; 0 = none. */
  finalDays: number;
}

export const DEFAULT_REMINDERS: ReminderSettings = { enabled: true, days: [2, 5], finalDays: 2 };
export const DAY_MS = 86_400_000;
/** A signer emailed this recently (sign request, manual resend) isn't reminded yet. */
export const QUIET_MS = 20 * 3_600_000;

export interface DueSlot {
  slot: string;
  dueAt: Date;
  final: boolean;
}

export function reminderSlots(s: ReminderSettings, activatedAt: Date, expiresAt: Date | null): DueSlot[] {
  if (!s.enabled) return [];
  const start = activatedAt.getTime();
  const end = expiresAt?.getTime() ?? Infinity;
  const final = expiresAt && s.finalDays > 0 ? { slot: `before_expiry:${s.finalDays}`, dueAt: new Date(end - s.finalDays * DAY_MS), final: true } : null;
  const cutoff = final ? final.dueAt.getTime() : end;
  const after = [...new Set(s.days)]
    .filter((d) => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b)
    .map((d) => ({ slot: `after:${d}`, dueAt: new Date(start + d * DAY_MS), final: false }))
    .filter((x) => x.dueAt.getTime() < cutoff);
  return final && final.dueAt.getTime() > start ? [...after, final] : after;
}

export function dueReminder(s: ReminderSettings, o: { activatedAt: Date; expiresAt: Date | null; now: Date; lastEmailedAt?: Date | null }): DueSlot | null {
  const now = o.now.getTime();
  if (o.expiresAt && now >= o.expiresAt.getTime()) return null;
  if (o.lastEmailedAt && now - o.lastEmailedAt.getTime() < QUIET_MS) return null;
  const due = reminderSlots(s, o.activatedAt, o.expiresAt).filter((x) => x.dueAt.getTime() <= now);
  return due.at(-1) ?? null;
}

/** Parses "2, 5" from the settings form. */
export function parseReminderDays(raw: string): number[] | null {
  const parts = raw.split(/[\s,]+/).filter(Boolean);
  if (parts.length > 5) return null;
  const days = parts.map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 60)) return null;
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * The sweep runs only where ENABLE_SWEEP=1 is set explicitly (Render only). Local dev and the
 * Docker test run share the production database and must never send reminders or expire Files.
 */
export const automationsEnabled = (env: NodeJS.ProcessEnv = process.env) => env.ENABLE_SWEEP === "1" && env.E2E_HOOKS !== "1";

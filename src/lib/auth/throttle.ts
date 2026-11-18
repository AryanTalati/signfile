import "server-only";

/**
 * In-memory login throttle (sliding 15-minute window). Keys are IP+email
 * (8 failures) and IP alone (30), never email alone: an email-only lockout
 * would let anyone lock out any account, including the public demo login.
 * Fine for a single Render instance; would move to Postgres if we scaled out.
 */
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, number[]>();

function recent(key: string) {
  const now = Date.now();
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(key, list);
  return list;
}

export function loginKeys(ip: string | null, email: string) {
  const i = ip ?? "unknown";
  return [
    { key: `ip-email:${i}:${email}`, max: 8 },
    { key: `ip:${i}`, max: 30 },
  ];
}

type Key = { key: string; max: number };

export function isThrottled(keys: Key[]) {
  return keys.some((k) => recent(k.key).length >= k.max);
}

export function recordFailure(keys: Key[]) {
  if (failures.size > 10_000) failures.clear();
  for (const k of keys) recent(k.key).push(Date.now());
}

export function clearFailures(keys: Key[]) {
  // Only the IP+email key: a success shouldn't reset an IP that's guessing at other accounts.
  failures.delete(keys[0].key);
}

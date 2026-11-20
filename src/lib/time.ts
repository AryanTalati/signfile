/**
 * Date/time display used across the app and the certificate. Pure.
 * UTC is always primary; local times are shown next to it.
 */

/** The IANA zone if the runtime knows it, else null. */
export function validTimeZone(tz: unknown): string | null {
  if (typeof tz !== "string" || !tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** "2026-11-20 23:19:37 UTC" */
export const utcStamp = (d: Date) => d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");

/** "Nov 20, 2026, 4:19:37 PM MST" in `tz`; "" if no valid zone. */
export function localStamp(d: Date, tz: string | null | undefined) {
  const zone = validTimeZone(tz);
  if (!zone) return "";
  return d.toLocaleString("en-US", { timeZone: zone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
}

/** "2026-11-20 23:19:37 UTC / Nov 20, 2026, 4:19:37 PM MST" (UTC only without a zone). */
export const utcAndLocal = (d: Date, tz: string | null | undefined) => [utcStamp(d), localStamp(d, tz)].filter(Boolean).join(" / ");

/** "Nov 20, 2026" (UTC calendar day unless a zone is given). */
export function shortDate(d: Date | string, tz?: string | null) {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { timeZone: validTimeZone(tz) ?? "UTC", month: "short", day: "numeric", year: "numeric" });
}

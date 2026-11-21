/** "November 20, 2026" in the signer's time zone (falls back to UTC). */
export function formatSignedDate(d: Date, tz?: string | null) {
  try {
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: tz || "UTC" });
  } catch {
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  }
}

/** "2026-11-20" (a date picked on the New File form) → "November 20, 2026". Other values unchanged. */
export function formatFirmValue(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return v;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) return v; // not a real date (e.g. 2026-02-31)
  return formatSignedDate(d, "UTC");
}

/** A firm-filled field that holds a date (label or key says so): shown as a date picker. */
export const isDateFill = (f: { key: string; label: string }) => /\bdate\b|dated\b/i.test(`${f.key} ${f.label}`);

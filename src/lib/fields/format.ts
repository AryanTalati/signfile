/** "November 20, 2026" in the signer's time zone (falls back to UTC). */
export function formatSignedDate(d: Date, tz?: string | null) {
  try {
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: tz || "UTC" });
  } catch {
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  }
}


"use client";

import { useEffect, useState } from "react";

/**
 * A timestamp in the viewer's local time zone, always "Nov 20, 2026" style (the app's one date format). The server renders UTC (it can't know the
 * viewer's zone); the browser swaps in local time after mount. UI only: the audit trail and
 * the certificate stay in UTC.
 */
export function LocalTime({ iso, dateOnly = false }: { iso: string; dateOnly?: boolean }) {
  const d = new Date(iso);
  const utc = dateOnly
    ? d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })
    : `${d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
  const [text, setText] = useState(utc);
  useEffect(() => {
    // Explicit components: browsers throw if dateStyle/timeStyle are mixed with timeZoneName.
    setText(
      dateOnly
        ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
        : d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso, dateOnly]);
  return (
    <time dateTime={iso} title={d.toISOString()} suppressHydrationWarning>
      {text}
    </time>
  );
}

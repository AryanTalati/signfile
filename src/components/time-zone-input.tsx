"use client";

import { useEffect, useState } from "react";

/** The browser's IANA time zone, submitted as a hidden `timezone` field. */
export function TimeZoneInput() {
  const [tz, setTz] = useState("");
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""), []);
  return <input type="hidden" name="timezone" value={tz} />;
}

/** A time zone picker; empty value defaults to the browser's zone. */
export function TimeZoneSelect({ name, value }: { name: string; value: string | null }) {
  const [zones, setZones] = useState<string[]>(value ? [value] : []);
  const [v, setV] = useState(value ?? "");
  useEffect(() => {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setZones([...new Set([...(value ? [value] : []), browser, "UTC", ...all])].sort());
    if (!value) setV(browser);
  }, [value]);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        Firm time zone
      </label>
      <select id={name} name={name} value={v} onChange={(e) => setV(e.target.value)} className="rounded-lg border border-border bg-surface px-3 py-2.5 text-base sm:text-sm">
        {zones.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted">Certificates show times in UTC and in this time zone.</p>
    </div>
  );
}

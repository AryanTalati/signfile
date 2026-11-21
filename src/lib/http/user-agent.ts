/**
 * A readable summary of a user-agent string for the certificate ("Chrome 158 on macOS").
 * The full string stays in the audit record (recipients/events). Pure.
 */
export function uaSummary(ua: string | null | undefined): string {
  if (!ua) return "not recorded";
  const v = (re: RegExp) => ua.match(re)?.[1];
  const browser =
    (v(/EdgA?\/(\d+)/) && `Edge ${v(/EdgA?\/(\d+)/)}`) ||
    (v(/OPR\/(\d+)/) && `Opera ${v(/OPR\/(\d+)/)}`) ||
    (v(/SamsungBrowser\/(\d+)/) && `Samsung Internet ${v(/SamsungBrowser\/(\d+)/)}`) ||
    (v(/CriOS\/(\d+)/) && `Chrome ${v(/CriOS\/(\d+)/)}`) ||
    (v(/FxiOS\/(\d+)/) && `Firefox ${v(/FxiOS\/(\d+)/)}`) ||
    (v(/Firefox\/(\d+)/) && `Firefox ${v(/Firefox\/(\d+)/)}`) ||
    (v(/Chrome\/(\d+)/) && `Chrome ${v(/Chrome\/(\d+)/)}`) ||
    (/Safari\//.test(ua) && v(/Version\/(\d+)/) && `Safari ${v(/Version\/(\d+)/)}`) ||
    null;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /CrOS/.test(ua)
        ? "ChromeOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  if (!browser && !os) return "unrecognized browser";
  return [browser ?? "Unknown browser", os].filter(Boolean).join(" on ");
}

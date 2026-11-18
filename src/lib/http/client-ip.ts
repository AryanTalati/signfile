import { isIP } from "node:net";

/**
 * The client's IP address, for the login throttle and the audit trail
 * (recipient IPs on the signing certificate). The ONLY place that reads
 * forwarding headers.
 *
 * On Render (*.onrender.com), every request passes Cloudflare -> Render proxy
 * -> app. Measured on the live service (Nov 18, 2026):
 *   - CF-Connecting-IP: set by Cloudflare to the real client IP. A client
 *     sending its own is rejected by Cloudflare (error 1000). Trusted.
 *   - True-Client-IP:   overwritten by Cloudflare with the same value. Trusted fallback.
 *   - X-Forwarded-For:  client-supplied values are KEPT at the front:
 *     "1.2.3.4, <client>, <cloudflare edge>, <render internal>". The first
 *     entry is attacker-controlled, so it is never used in production.
 *   - X-Real-IP:        not passed through.
 *
 * Outside production (local dev, tests) there's no proxy, so we fall back to
 * the first X-Forwarded-For entry for convenience.
 *
 * Returns null when no trustworthy IP is available; callers record "unknown".
 */
export function getClientIp(headers: Headers, env: { production: boolean } = { production: process.env.NODE_ENV === "production" }): string | null {
  for (const name of ["cf-connecting-ip", "true-client-ip"]) {
    const ip = clean(headers.get(name));
    if (ip) return ip;
  }
  if (!env.production) return clean(headers.get("x-forwarded-for")?.split(",")[0]);
  return null;
}

function clean(v: string | null | undefined): string | null {
  const ip = v?.trim();
  return ip && isIP(ip) ? ip : null;
}

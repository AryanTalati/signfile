/**
 * Gmail API sender over HTTPS (Render's free tier blocks SMTP). Plain fetch, no SDK.
 * Credentials come from env and are never logged, returned or stored: errors carry only
 * the HTTP status and Google's error message.
 */

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  sender: string;
}

export function gmailConfig(env: NodeJS.ProcessEnv = process.env): GmailConfig | null {
  const c = { clientId: env.GMAIL_CLIENT_ID, clientSecret: env.GMAIL_CLIENT_SECRET, refreshToken: env.GMAIL_REFRESH_TOKEN, sender: env.GMAIL_SENDER };
  return c.clientId && c.clientSecret && c.refreshToken && c.sender ? (c as GmailConfig) : null;
}

export interface OutgoingEmail {
  fromName: string;
  to: string;
  toName?: string | null;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; contentType: string; content: Uint8Array }[];
}

export class GmailError extends Error {}

type Fetch = typeof fetch;
let cached: { token: string; expires: number; key: string } | null = null;

/** Exchanges the refresh token for an access token; cached until shortly before expiry. */
export async function accessToken(cfg: GmailConfig, f: Fetch = fetch, now = Date.now()): Promise<string> {
  const key = `${cfg.clientId}:${cfg.refreshToken.slice(-6)}`;
  if (cached && cached.key === key && cached.expires > now + 60_000) return cached.token;
  const res = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: cfg.refreshToken }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new GmailError(`Gmail auth failed (${res.status}${data.error ? ` ${data.error}` : ""}${data.error_description ? `: ${data.error_description}` : ""})`);
  cached = { token: data.access_token, expires: now + (data.expires_in ?? 3600) * 1000, key };
  return data.access_token;
}

export function resetTokenCache() {
  cached = null;
}

/** Sends one email; returns Gmail's message id. */
export async function sendGmail(cfg: GmailConfig, email: OutgoingEmail, f: Fetch = fetch): Promise<string> {
  const token = await accessToken(cfg, f);
  const raw = Buffer.from(buildMime(cfg.sender, email)).toString("base64url");
  const res = await f("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string; status?: string } };
  if (res.status === 401) resetTokenCache();
  if (!res.ok || !data.id) throw new GmailError(`Gmail send failed (${res.status}${data.error?.status ? ` ${data.error.status}` : ""}${data.error?.message ? `: ${data.error.message}` : ""})`);
  return data.id;
}

// ---------- MIME ----------

const noCrLf = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
/** RFC 2047 encoded-word for non-ASCII header text (subject, display names). */
export const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const address = (name: string | null | undefined, email: string) => {
  const e = noCrLf(email).replace(/[<>",]/g, "");
  const n = name ? noCrLf(name) : "";
  return n ? `${/^[\x20-\x7e]*$/.test(n) ? `"${n.replace(/["\\]/g, "")}"` : encodeWord(n)} <${e}>` : e;
};
const b64lines = (data: Uint8Array | string) =>
  (typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data)).toString("base64").replace(/.{76}/g, "$&\r\n");

export function buildMime(sender: string, e: OutgoingEmail): string {
  const mixed = `mixed_${Math.random().toString(36).slice(2)}`;
  const alt = `alt_${Math.random().toString(36).slice(2)}`;
  const lines = [
    `From: ${address(e.fromName, sender)}`,
    `To: ${address(e.toName, e.to)}`,
    `Subject: ${encodeWord(noCrLf(e.subject))}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(e.text),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(e.html),
    `--${alt}--`,
  ];
  for (const a of e.attachments ?? []) {
    const name = encodeWord(noCrLf(a.filename).replace(/["\\]/g, ""));
    lines.push(`--${mixed}`, `Content-Type: ${a.contentType}; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`, "Content-Transfer-Encoding: base64", "", b64lines(a.content));
  }
  lines.push(`--${mixed}--`, "");
  return lines.join("\r\n");
}

/** Reserved test domains (RFC 2606/6761) and our E2E domain: never sent, only captured. */
export function isTestAddress(email: string) {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  return /(^|\.)example\.(com|net|org)$/.test(domain) || /\.(example|test|invalid|localhost)$/.test(domain) || domain === "example";
}

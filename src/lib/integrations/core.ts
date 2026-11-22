/**
 * Outgoing webhooks and Slack: the pure parts (event names, signing, retry schedule, URL
 * checks, payload and message text). No DB, no network. Tested in tests/unit/integrations.test.ts.
 */
import { createHmac } from "node:crypto";

import type { FileEventType } from "./events";

export { DEFAULT_SLACK_EVENTS, EVENT_NAMES, FILE_EVENTS, pickEvents, type FileEventType } from "./events";

/** `X-SignFile-Signature` value: HMAC-SHA256 of the exact request body, hex. */
export const SIGNATURE_HEADER = "X-SignFile-Signature";
export const signBody = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

/** Up to 3 attempts: now, then after 30 s, then after 5 min. `scale` shortens it in tests. */
export const MAX_ATTEMPTS = 3;
export const retryDelayMs = (attemptsSoFar: number, scale = 1) => (attemptsSoFar <= 1 ? 30_000 : 300_000) * scale;

/** After an attempt: delivered, try again later, or give up. */
export function afterAttempt(attempts: number, ok: boolean, final = false): "delivered" | "pending" | "failed" {
  if (ok) return "delivered";
  return final || attempts >= MAX_ATTEMPTS ? "failed" : "pending";
}

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

/**
 * A URL we're willing to POST to: https, and not a private/loopback host (so a firm can't
 * point our server at internal services). `allowLocal` is for the E2E test receiver only.
 */
export function checkTargetUrl(raw: string, kind: "webhook" | "slack", allowLocal = false): { url: string } | { error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { error: "Enter a full URL starting with https://" };
  }
  if (u.username || u.password) return { error: "The URL can't contain a username or password." };
  if (!allowLocal) {
    if (u.protocol !== "https:") return { error: "The URL must start with https://" };
    if (PRIVATE_HOST.test(u.hostname)) return { error: "That address isn't reachable from the internet." };
    if (kind === "slack" && u.hostname !== "hooks.slack.com") return { error: "Paste a Slack incoming-webhook URL (https://hooks.slack.com/…)." };
  } else if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "The URL must start with https://" };
  return { url: u.toString() };
}

export interface EventContext {
  type: FileEventType;
  at: Date;
  file: { id: string; reference: string | null; status: string; clientLegalName: string; sentAt: Date | null; completedAt: Date | null; expiresAt: Date | null };
  documentName: string;
  firm: string;
  signers: { role: string; name: string; email: string; status: string; signedAt: Date | null }[];
  /** The signer this event is about (viewed, signed, declined, changes requested). */
  signer: { name: string; email: string } | null;
  signedPdfUrl: string | null;
  reason: string | null;
  /** Agreement version the File is on, key terms read from it (MIND sync). */
  version?: number | null;
  terms?: Record<string, { found: boolean; value: string | null } | undefined> | null;
  fileUrl?: string;
  verifyUrl?: string;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** The webhook body. Times are UTC ISO 8601. */
export function webhookPayload(c: EventContext, deliveryId: string) {
  return {
    id: deliveryId,
    type: c.type,
    occurredAt: c.at.toISOString(),
    file: {
      id: c.file.id,
      reference: c.file.reference,
      status: c.file.status,
      client: c.file.clientLegalName,
      document: c.documentName,
      sentAt: iso(c.file.sentAt),
      completedAt: iso(c.file.completedAt),
      expiresAt: iso(c.file.expiresAt),
    },
    signer: c.signer,
    signers: c.signers.map((s) => ({ role: s.role, name: s.name, email: s.email, status: s.status, signedAt: iso(s.signedAt) })),
    ...(c.reason ? { reason: c.reason } : {}),
    ...(c.type === "file.completed" ? { signedPdfUrl: c.signedPdfUrl } : {}),
  };
}

/** One short plain-text Slack line per event. */
export function slackText(c: EventContext) {
  const doc = `'${c.documentName}' (${c.file.clientLegalName})`;
  const who = c.signer?.name ?? "A signer";
  switch (c.type) {
    case "file.sent":
      return `${doc} was sent for signature`;
    case "file.viewed":
      return `${who} opened ${doc}`;
    case "file.signed":
      return `${who} signed ${doc}`;
    case "file.completed":
      return `Everyone signed ${doc}. The sealed PDF is ready.`;
    case "file.declined":
      return `${who} declined ${doc}${c.reason ? `: ${c.reason}` : ""}`;
    case "file.changes_requested":
      return `${who} requested changes to ${doc}${c.reason ? `: ${c.reason}` : ""}`;
    case "file.voided":
      return `${doc} was voided`;
    case "file.expired":
      return `Signing links for ${doc} expired`;
    default:
      return `${doc}: ${c.type}`;
  }
}

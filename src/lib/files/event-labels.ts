/**
 * Plain-English labels for every audit event type, used by the File timeline and the
 * certificate. Every type the app emits must be listed (tests/unit/event-labels.test.ts
 * fails otherwise); unknown types fall back to a readable form, never the raw name.
 */
import { shortDate } from "@/lib/time";

export interface EventLike {
  type: string;
  actorLabel?: string | null;
  data?: Record<string, unknown> | null;
}

const who = (e: EventLike) => e.actorLabel || "Someone";
const str = (v: unknown) => (typeof v === "string" ? v : "");

export const EVENT_LABELS: Record<string, (e: EventLike) => string> = {
  "company.created": (e) => `Company created by ${who(e)}`,
  "file.created": (e) => {
    const n = Number(e.data?.aiConfirmedFields ?? 0);
    return `File created by ${who(e)}${e.data?.bulkBatchId ? " (bulk send from CSV)" : ""}${n ? ` (${n} AI-suggested field${n === 1 ? "" : "s"}, each confirmed by a person)` : ""}`;
  },
  "file.sent": (e) => {
    const to = e.data?.to as { name?: string } | undefined;
    return to?.name ? `Sent to ${to.name} for signature` : "Sent for signature";
  },
  "recipient.viewed": (e) => `Viewed by ${who(e)}`,
  "recipient.consented": (e) =>
    e.data?.inAdvance
      ? `${who(e)} agreed to sign electronically in advance, by authorizing automatic countersign${str(e.data?.authorizedAt) ? ` on ${shortDate(str(e.data?.authorizedAt))}` : ""}`
      : `${who(e)} agreed to sign electronically`,
  "recipient.signed": (e) => `Signed by ${who(e)}`,
  "recipient.details_changed": (e) =>
    `${str(e.data?.field) || "Detail"} changed from ${str(e.data?.from) || "(blank)"} to ${str(e.data?.to) || "(blank)"} by ${who(e)}`,
  "recipient.signed_with_saved_signature": (e) => `${who(e)} used their saved signature`,
  "recipient.auto_countersigned": (e) => `Countersigned automatically with ${who(e)}'s saved signature${str(e.data?.authorizedAt) ? ` (authorized ${shortDate(str(e.data?.authorizedAt))})` : ""}`,
  "recipient.auto_countersign_failed": (e) => `Automatic countersign didn't apply${str(e.data?.reason) ? ` (${str(e.data?.reason)})` : ""}; ${who(e)} was asked to countersign`,
  "recipient.activated": (e) => (str(e.data?.name) ? `${str(e.data?.name)}'s turn to sign` : "Next signer's turn"),
  "recipient.declined": (e) => `Declined by ${who(e)}${str(e.data?.reason) ? `: ${str(e.data?.reason)}` : ""}`,
  "recipient.requested_changes": (e) => `${who(e)} requested changes${str(e.data?.message) ? `: ${str(e.data?.message)}` : ""}`,
  "file.revised": (e) =>
    `Revised version ${String(e.data?.toVersion ?? "")} sent by ${who(e)}; version ${String(e.data?.fromVersion ?? "")} superseded${str(e.data?.note) ? `. What changed: ${str(e.data?.note)}` : ""}`,
  "file.completed": () => "All parties signed",
  "file.sealed": () => "Signed PDF sealed with its certificate",
  "file.expired": () => "Signing links expired",
  "file.extended": (e) => `Links extended and resent by ${who(e)}`,
  "file.reminded": (e) => `Reminder sent to ${str(e.data?.to) || "the signer"}`,
  "file.voided": (e) => `Voided by ${who(e)}${str(e.data?.reason) ? `: ${str(e.data?.reason)}` : ""}`,
  "file.resent": (e) => `Signing email resent to ${str(e.data?.to) || "the signer"} by ${who(e)}`,
  "template.created": (e) => `Template created by ${who(e)}`,
  "bulk.started": (e) => `Bulk send from CSV started by ${who(e)}: ${Number(e.data?.toSend ?? 0)} to send, ${Number(e.data?.skipped ?? 0)} skipped`,
  "bulk.completed": (e) => `Bulk send finished: ${Number(e.data?.sent ?? 0)} sent, ${Number(e.data?.draft ?? 0)} drafts, ${Number(e.data?.skipped ?? 0)} skipped, ${Number(e.data?.failed ?? 0)} failed`,
  "template.ai_reviewed": (e) => `AI review of the agreement: ${Number(e.data?.agreed ?? 0)} fields agreed with the rules, ${Number(e.data?.flagged ?? 0) + Number(e.data?.added ?? 0)} flagged for a person to check`,
  "template.ai_suggestion_confirmed": (e) => `${who(e)} confirmed an AI-suggested ${str(e.data?.label) || "field"}${e.data?.changed ? " (after changing it)" : ""}`,
  "template.signature_page_appended": (e) => `Signature page added by ${who(e)}`,
  "template.signature_page_removed": (e) => `Signature page removed by ${who(e)}`,
  "user.signature_adopted": (e) => `${who(e)} saved their signature`,
  "user.signature_removed": (e) => `${who(e)} removed their saved signature`,
  "user.auto_countersign_enabled": (e) => `${who(e)} turned on automatic countersigning`,
  "user.auto_countersign_disabled": (e) => `${who(e)} turned off automatic countersigning`,
};

export function eventLabel(e: EventLike): string {
  const f = EVENT_LABELS[e.type];
  if (f) return f(e);
  // Fallback: never show a raw dotted name.
  const words = e.type.split(".").pop()!.replace(/_/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}${e.actorLabel ? ` · ${e.actorLabel}` : ""}`;
}

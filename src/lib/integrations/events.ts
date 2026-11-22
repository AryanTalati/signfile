/** Integration event names. No Node imports: used by the Settings page in the browser too. */
export const FILE_EVENTS = ["file.sent", "file.viewed", "file.signed", "file.completed", "file.declined", "file.changes_requested", "file.voided", "file.expired", "bulk.completed"] as const;
export type FileEventType = (typeof FILE_EVENTS)[number];

export const EVENT_NAMES: Record<FileEventType, string> = {
  "file.sent": "Sent for signature",
  "file.viewed": "Viewed by a signer",
  "file.signed": "Signed (each signer)",
  "file.completed": "Completed (everyone signed)",
  "file.declined": "Declined",
  "file.changes_requested": "Changes requested",
  "file.voided": "Voided",
  "file.expired": "Expired",
  "bulk.completed": "Bulk send finished (counts)",
};

export const DEFAULT_SLACK_EVENTS: FileEventType[] = ["file.signed", "file.completed", "file.declined", "file.changes_requested", "file.expired"];

export const pickEvents = (list: unknown): FileEventType[] => FILE_EVENTS.filter((e) => Array.isArray(list) && list.includes(e));

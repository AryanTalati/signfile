/**
 * The internal event dispatcher. Call `emit` AFTER the database write has committed. It
 * returns immediately: subscribers run in the background, and a subscriber that throws is
 * logged and never reaches the caller (signing, sending, sealing never wait on or fail
 * because of an integration).
 */
import type { FileEventType } from "./core";

export interface FileEvent {
  /** Integration event name (not an audit-log event type). */
  event: FileEventType;
  companyId: string;
  fileId: string;
  /** The signer the event is about, if any. */
  recipientId?: string | null;
  /** Free text from the signer (decline reason, requested changes). */
  reason?: string | null;
  baseUrl: string;
  at?: Date;
}

export type Subscriber = (e: FileEvent & { at: Date }) => Promise<unknown>;

export function createDispatcher(load: () => Promise<Subscriber[]> | Subscriber[]) {
  return function emit(e: FileEvent) {
    const event = { ...e, at: e.at ?? new Date() };
    void Promise.resolve()
      .then(load)
      .then((subs) =>
        Promise.all(subs.map((s) => Promise.resolve().then(() => s(event)).catch((err) => console.error("event subscriber failed", event.event, event.fileId, (err as Error).message)))),
      )
      .catch((err) => console.error("event dispatch failed", event.event, (err as Error).message));
  };
}

/** Subscribers: outgoing webhook and Slack (loaded lazily so emitters don't import them). */
export const emit = createDispatcher(async () => {
  const m = await import("./deliveries");
  return [m.webhookSubscriber, m.slackSubscriber];
});

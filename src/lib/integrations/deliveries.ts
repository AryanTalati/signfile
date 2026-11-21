import "server-only";
import { and, asc, desc, eq, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { afterAttempt, checkTargetUrl, type EventContext, MAX_ATTEMPTS, pickEvents, retryDelayMs, SIGNATURE_HEADER, signBody, slackText, webhookPayload } from "./core";
import type { FileEvent, Subscriber } from "./dispatch";

/**
 * Subscribers for the outgoing webhook and Slack. Each event becomes a `deliveries` row (so
 * the firm sees it in Settings and a retry sends the same body), then a POST in the
 * background: up to 3 attempts with backoff, then `failed`. Nothing here is awaited by
 * signing; errors are recorded on the row and logged without the URL or secret.
 */

type Evt = FileEvent & { at: Date };
const allowLocal = () => process.env.E2E_HOOKS === "1"; // the E2E receiver runs on the test machine
const scale = () => (process.env.E2E_HOOKS === "1" ? 0.002 : 1); // E2E: 60 ms / 600 ms instead of 30 s / 5 min

async function settings(companyId: string) {
  const [c] = await db
    .select({ webhookUrl: schema.companies.webhookUrl, webhookSecret: schema.companies.webhookSecret, webhookEvents: schema.companies.webhookEvents, slackUrl: schema.companies.slackWebhookUrl, slackEvents: schema.companies.slackEvents })
    .from(schema.companies)
    .where(eq(schema.companies.id, companyId));
  return c;
}

/** Everything a payload or message needs about one File, read once per event. */
const contexts = new WeakMap<Evt, Promise<EventContext | null>>();
function contextFor(e: Evt) {
  let p = contexts.get(e);
  if (!p) contexts.set(e, (p = loadContext(e)));
  return p;
}
async function loadContext(e: Evt): Promise<EventContext | null> {
  const [row] = await db
    .select({ file: schema.files, firm: schema.companies.name })
    .from(schema.files)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.files.companyId))
    .where(and(eq(schema.files.id, e.fileId), eq(schema.files.companyId, e.companyId)));
  if (!row) return null;
  const f = row.file;
  const [signers, [t]] = await Promise.all([
    f.currentDocumentId
      ? db.select().from(schema.recipients).where(and(eq(schema.recipients.documentId, f.currentDocumentId), eq(schema.recipients.companyId, e.companyId))).orderBy(asc(schema.recipients.signingOrder))
      : Promise.resolve([]),
    f.templateId ? db.select({ name: schema.templates.name }).from(schema.templates).where(eq(schema.templates.id, f.templateId)) : Promise.resolve([]),
  ]);
  const live = signers.filter((s) => s.status !== "revoked" && s.status !== "forwarded");
  const who = e.recipientId ? signers.find((s) => s.id === e.recipientId) : undefined;
  const last = [...live].reverse().find((s) => s.status === "signed");
  return {
    type: e.event,
    at: e.at,
    file: { id: f.id, reference: f.reference, status: f.status, clientLegalName: f.clientLegalName, sentAt: f.sentAt, completedAt: f.completedAt, expiresAt: f.expiresAt },
    documentName: t?.name ?? "the agreement",
    firm: row.firm,
    signers: live.map((s) => ({ role: s.roleKey === "firm" ? "firm" : "client", name: s.name, email: s.email, status: s.status, signedAt: s.signedAt })),
    signer: who ? { name: who.name, email: who.email } : null,
    // A signer's own download link: it seals on demand, so it works as soon as the File completes.
    signedPdfUrl: e.event === "file.completed" && last ? `${e.baseUrl}/api/sign/${last.token}/download` : null,
    reason: e.reason ?? null,
  };
}

async function enqueue(e: Evt, target: "webhook" | "slack", build: (ctx: EventContext, id: string) => string) {
  const ctx = await contextFor(e);
  if (!ctx) return;
  const id = crypto.randomUUID();
  await db.insert(schema.deliveries).values({ id, companyId: e.companyId, fileId: e.fileId, target, event: e.event, body: build(ctx, id), nextAttemptAt: e.at });
  await attempt(id);
}

export const webhookSubscriber: Subscriber = async (e) => {
  const c = await settings(e.companyId);
  if (!c?.webhookUrl || !c.webhookSecret || !pickEvents(c.webhookEvents).includes(e.event)) return;
  await enqueue(e, "webhook", (ctx, id) => JSON.stringify(webhookPayload(ctx, id)));
};

export const slackSubscriber: Subscriber = async (e) => {
  const c = await settings(e.companyId);
  if (!c?.slackUrl || !pickEvents(c.slackEvents).includes(e.event)) return;
  await enqueue(e, "slack", (ctx) => JSON.stringify({ text: slackText(ctx) }));
};

/** One POST. Schedules the next attempt itself (in-process timer; the sweep picks up any lost to a restart). */
export async function attempt(id: string, opts: { final?: boolean } = {}) {
  const [d] = await db.select().from(schema.deliveries).where(eq(schema.deliveries.id, id));
  if (!d || d.status !== "pending") return;
  const c = await settings(d.companyId);
  const url = d.target === "webhook" ? c?.webhookUrl : c?.slackUrl;
  const checked = url ? checkTargetUrl(url, d.target, allowLocal()) : { error: "No URL is set." };

  let ok = false;
  let responseStatus: number | null = null;
  let error: string | null = null;
  if ("error" in checked) error = checked.error;
  else if (d.target === "webhook" && !c?.webhookSecret) error = "No signing secret is set.";
  else {
    const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "SignFile-Webhooks/1" };
    if (d.target === "webhook") Object.assign(headers, { [SIGNATURE_HEADER]: signBody(c!.webhookSecret!, d.body), "X-SignFile-Event": d.event, "X-SignFile-Delivery": d.id });
    try {
      const res = await fetch(checked.url, { method: "POST", headers, body: d.body, redirect: "manual", signal: AbortSignal.timeout(10_000) });
      responseStatus = res.status;
      ok = res.status >= 200 && res.status < 300;
      if (!ok) error = `HTTP ${res.status}`;
      await res.body?.cancel().catch(() => undefined);
    } catch (e) {
      error = (e as Error).name === "TimeoutError" ? "Timed out after 10 s" : "Couldn't connect";
    }
  }
  const attempts = d.attempts + 1;
  const status = afterAttempt(attempts, ok, opts.final);
  const now = new Date();
  const delay = retryDelayMs(attempts, scale());
  await db
    .update(schema.deliveries)
    .set({ status, attempts, responseStatus, error: ok ? null : error, nextAttemptAt: status === "pending" ? new Date(now.getTime() + delay) : null, updatedAt: now })
    .where(eq(schema.deliveries.id, id));
  if (!ok) console.warn(`${d.target} delivery ${status === "failed" ? "failed" : "will retry"}`, d.event, d.id, error);
  if (status === "pending") setTimeout(() => void attempt(id).catch((e) => console.error("delivery retry failed", id, (e as Error).message)), delay).unref?.();
}

/** Settings → Retry on a failed delivery: one more attempt, same body, current URL and secret. */
export async function retryDelivery(companyId: string, id: string) {
  const [d] = await db
    .update(schema.deliveries)
    .set({ status: "pending", updatedAt: new Date() })
    .where(and(eq(schema.deliveries.id, id), eq(schema.deliveries.companyId, companyId), eq(schema.deliveries.status, "failed")))
    .returning({ id: schema.deliveries.id });
  if (!d) return false;
  await attempt(id, { final: true });
  return true;
}

/** Health sweep: attempts whose timer was lost (restart/deploy) and are overdue. */
export async function sweepDeliveries(now = new Date()) {
  const due = await db
    .select({ id: schema.deliveries.id })
    .from(schema.deliveries)
    .where(and(eq(schema.deliveries.status, "pending"), lte(schema.deliveries.nextAttemptAt, new Date(now.getTime() - 60_000))))
    .limit(20);
  for (const d of due) await attempt(d.id);
  return due.length;
}

export async function listDeliveries(companyId: string, limit = 20) {
  return db
    .select({ id: schema.deliveries.id, target: schema.deliveries.target, event: schema.deliveries.event, status: schema.deliveries.status, attempts: schema.deliveries.attempts, error: schema.deliveries.error, createdAt: schema.deliveries.createdAt, updatedAt: schema.deliveries.updatedAt })
    .from(schema.deliveries)
    .where(eq(schema.deliveries.companyId, companyId))
    .orderBy(desc(schema.deliveries.createdAt))
    .limit(limit);
}

export { MAX_ATTEMPTS };

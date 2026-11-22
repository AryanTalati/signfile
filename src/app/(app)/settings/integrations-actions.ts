"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { db, schema } from "@/lib/db/client";
import { checkTargetUrl, FILE_EVENTS, pickEvents } from "@/lib/integrations/core";
import { retryDelivery } from "@/lib/integrations/deliveries";

export type IntegrationState = { error?: string; ok?: boolean };

const allowLocal = () => process.env.E2E_HOOKS === "1";
const eventsFrom = (fd: FormData) => pickEvents(FILE_EVENTS.filter((e) => fd.get(`event:${e}`) === "on"));

/** Webhook: URL, events, and a signing secret (blank keeps the saved one). The secret is never sent back to the page. */
export async function saveWebhookAction(_: IntegrationState, fd: FormData): Promise<IntegrationState> {
  const auth = await requireAdmin();
  if (fd.get("intent") === "off") {
    await db.update(schema.companies).set({ webhookUrl: null, webhookSecret: null }).where(eq(schema.companies.id, auth.company.id));
    revalidatePath("/settings");
    return { ok: true };
  }
  const url = checkTargetUrl(String(fd.get("url") ?? ""), "webhook", allowLocal());
  if ("error" in url) return { error: url.error };
  const secret = String(fd.get("secret") ?? "").trim();
  const [cur] = await db.select({ secret: schema.companies.webhookSecret }).from(schema.companies).where(eq(schema.companies.id, auth.company.id));
  if (secret && (secret.length < 16 || secret.length > 200)) return { error: "The secret must be 16 to 200 characters." };
  if (!secret && !cur?.secret) return { error: "Enter a signing secret (at least 16 characters), or press Generate." };
  const events = eventsFrom(fd);
  if (!events.length) return { error: "Pick at least one event to send." };
  await db
    .update(schema.companies)
    .set({ webhookUrl: url.url, webhookEvents: events, ...(secret ? { webhookSecret: secret } : {}) })
    .where(eq(schema.companies.id, auth.company.id));
  revalidatePath("/settings");
  return { ok: true };
}

export async function saveSlackAction(_: IntegrationState, fd: FormData): Promise<IntegrationState> {
  const auth = await requireAdmin();
  if (fd.get("intent") === "off") {
    await db.update(schema.companies).set({ slackWebhookUrl: null }).where(eq(schema.companies.id, auth.company.id));
    revalidatePath("/settings");
    return { ok: true };
  }
  const url = checkTargetUrl(String(fd.get("url") ?? ""), "slack", allowLocal());
  if ("error" in url) return { error: url.error };
  const events = eventsFrom(fd);
  if (!events.length) return { error: "Pick at least one event to post." };
  await db.update(schema.companies).set({ slackWebhookUrl: url.url, slackEvents: events }).where(eq(schema.companies.id, auth.company.id));
  revalidatePath("/settings");
  return { ok: true };
}

/** MIND sync: a firm's own MIND API key and an on/off switch. Blank key keeps the saved one. Never sent back to the page. */
export async function saveMindAction(_: IntegrationState, fd: FormData): Promise<IntegrationState> {
  const auth = await requireAdmin();
  if (fd.get("intent") === "remove") {
    await db.update(schema.companies).set({ mindApiKey: null, mindEnabled: false }).where(eq(schema.companies.id, auth.company.id));
    revalidatePath("/settings");
    return { ok: true };
  }
  const key = String(fd.get("key") ?? "").trim();
  const enabled = fd.get("enabled") === "on";
  if (key && !/^mind_[A-Za-z0-9_-]{8,200}$/.test(key)) return { error: "That doesn't look like a MIND API key (it starts with mind_)." };
  const [cur] = await db.select({ key: schema.companies.mindApiKey }).from(schema.companies).where(eq(schema.companies.id, auth.company.id));
  if (enabled && !key && !cur?.key) return { error: "Paste your MIND API key to turn MIND sync on." };
  await db
    .update(schema.companies)
    .set({ mindEnabled: enabled, ...(key ? { mindApiKey: key } : {}) })
    .where(eq(schema.companies.id, auth.company.id));
  revalidatePath("/settings");
  return { ok: true };
}

export async function retryDeliveryAction(id: string) {
  const auth = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  await retryDelivery(auth.company.id, id);
  revalidatePath("/settings");
}

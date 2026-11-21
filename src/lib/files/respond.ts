import "server-only";
import { emit } from "@/lib/integrations/dispatch";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { recordEmail } from "@/lib/email/outbox";
import { changesRequestedEmail, declinedEmail } from "@/lib/email/templates";
import type { SigningContext } from "./signing";

/** Signer-side responses: decline, request changes. Authorized by the signing link only. */

export const reasonSchema = z.object({ text: z.string().trim().min(3, "Please add a few words.").max(2000) });
export class RespondError extends Error {}

type Meta = { ip: string | null; userAgent: string | null };

async function lockOpen(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ctx: SigningContext) {
  // Lock the File, then re-check: only an open File and a signer who hasn't signed can respond.
  const f = await tx.execute(sql`select status from files where id = ${ctx.file.id} for update`);
  const r = await tx.execute(sql`select status from recipients where id = ${ctx.recipient.id} for update`);
  const fileStatus = (f[0] as { status: string } | undefined)?.status;
  const rStatus = (r[0] as { status: string } | undefined)?.status;
  if (fileStatus !== "sent" && fileStatus !== "partially_signed") throw new RespondError("This agreement can't be changed right now.");
  if (rStatus !== "active" && rStatus !== "viewed") throw new RespondError(rStatus === "signed" ? "You've already signed." : "This link can't be used right now.");
}

async function docName(fileTemplateId: string | null) {
  if (!fileTemplateId) return "the agreement";
  const [t] = await db.select({ name: schema.templates.name }).from(schema.templates).where(eq(schema.templates.id, fileTemplateId));
  return t?.name ?? "the agreement";
}

/** The firm's people for this File: its owner and any firm signers (deduped by email). */
async function firmContacts(ctx: SigningContext) {
  const out = new Map<string, { name: string; email: string; recipientId?: string }>();
  if (ctx.file.ownerUserId) {
    const [o] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, ctx.file.ownerUserId));
    if (o) out.set(o.email.toLowerCase(), o);
  }
  const firm = await db
    .select({ id: schema.recipients.id, name: schema.recipients.name, email: schema.recipients.email, userId: schema.recipients.userId })
    .from(schema.recipients)
    .where(eq(schema.recipients.documentId, ctx.recipient.documentId));
  for (const r of firm) if (r.userId && !out.has(r.email.toLowerCase())) out.set(r.email.toLowerCase(), { name: r.name, email: r.email, recipientId: r.id });
  return [...out.values()];
}

export async function declineSigning(ctx: SigningContext, reason: string, meta: Meta, baseUrl: string) {
  const name = await docName(ctx.file.templateId);
  // Everyone on the File: every signer on the current version and the firm's people.
  const signers = await db
    .select({ id: schema.recipients.id, name: schema.recipients.name, email: schema.recipients.email })
    .from(schema.recipients)
    .where(eq(schema.recipients.documentId, ctx.recipient.documentId));
  const firm = await firmContacts(ctx);
  const to = new Map<string, { name: string; email: string; recipientId?: string }>();
  for (const s of signers) to.set(s.email.toLowerCase(), { name: s.name, email: s.email, recipientId: s.id });
  for (const f of firm) if (!to.has(f.email.toLowerCase())) to.set(f.email.toLowerCase(), f);

  await db.transaction(async (tx) => {
    await lockOpen(tx, ctx);
    const now = new Date();
    await tx.update(schema.recipients).set({ status: "declined", declinedAt: now, declineReason: reason, ip: meta.ip, userAgent: meta.userAgent }).where(eq(schema.recipients.id, ctx.recipient.id));
    await tx.update(schema.files).set({ status: "declined", updatedAt: now }).where(eq(schema.files.id, ctx.file.id));
    await tx.insert(schema.events).values({
      companyId: ctx.file.companyId,
      fileId: ctx.file.id,
      recipientId: ctx.recipient.id,
      actorType: "recipient",
      actorId: ctx.recipient.id,
      actorLabel: ctx.recipient.name,
      type: "recipient.declined",
      data: { reason, notified: [...to.values()].map((t) => t.email) },
      ...meta,
    });
    for (const t of to.values()) {
      const email = declinedEmail({ brand: { name: ctx.company.name, color: ctx.company.brandColor }, recipientName: t.name, documentName: name, clientLegalName: ctx.file.clientLegalName, declinedBy: ctx.recipient.name, reason });
      await recordEmail(tx, { companyId: ctx.file.companyId, fileId: ctx.file.id, recipientId: t.recipientId, kind: "declined", toEmail: t.email, toName: t.name, ...email });
    }
  });
  emit({ event: "file.declined", companyId: ctx.file.companyId, fileId: ctx.file.id, recipientId: ctx.recipient.id, reason, baseUrl });
}

export async function requestChanges(ctx: SigningContext, message: string, meta: Meta, baseUrl: string) {
  const name = await docName(ctx.file.templateId);
  const firm = await firmContacts(ctx);
  await db.transaction(async (tx) => {
    await lockOpen(tx, ctx);
    const now = new Date();
    await tx.update(schema.recipients).set({ status: "changes_requested", changeComment: message, ip: meta.ip, userAgent: meta.userAgent }).where(eq(schema.recipients.id, ctx.recipient.id));
    await tx.update(schema.files).set({ status: "changes_requested", updatedAt: now }).where(eq(schema.files.id, ctx.file.id));
    await tx.insert(schema.events).values({
      companyId: ctx.file.companyId,
      fileId: ctx.file.id,
      recipientId: ctx.recipient.id,
      actorType: "recipient",
      actorId: ctx.recipient.id,
      actorLabel: ctx.recipient.name,
      type: "recipient.requested_changes",
      data: { message },
      ...meta,
    });
    for (const f of firm) {
      const email = changesRequestedEmail({
        brand: { name: ctx.company.name, color: ctx.company.brandColor },
        recipientName: f.name,
        documentName: name,
        clientLegalName: ctx.file.clientLegalName,
        requestedBy: ctx.recipient.name,
        message,
        fileUrl: `${baseUrl}/files/${ctx.file.id}`,
      });
      await recordEmail(tx, { companyId: ctx.file.companyId, fileId: ctx.file.id, recipientId: f.recipientId, kind: "changes_requested", toEmail: f.email, toName: f.name, ...email });
    }
  });
  emit({ event: "file.changes_requested", companyId: ctx.file.companyId, fileId: ctx.file.id, recipientId: ctx.recipient.id, reason: message, baseUrl });
}


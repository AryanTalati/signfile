import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AuthContext } from "@/lib/auth/session";
import { requestMeta } from "@/lib/auth/session";
import { db, schema } from "@/lib/db/client";
import { recordEmail } from "@/lib/email/outbox";
import { countersignRequestEmail, firmSignFirstEmail, signRequestEmail, voidedEmail } from "@/lib/email/templates";
import { isFirmFirst } from "@/lib/fields/validate";
import { signLink } from "./service";

/** Firm-side File actions: void, resend. Company-scoped; every action is logged. */

export class FileActionError extends Error {}

const OPEN: ("sent" | "partially_signed" | "changes_requested" | "expired" | "draft")[] = ["draft", "sent", "partially_signed", "changes_requested", "expired"];

export async function voidFile(auth: AuthContext, fileId: string, reason: string) {
  const r = reason.trim();
  if (r.length < 3) throw new FileActionError("Give a reason for voiding (it's kept in the audit trail).");
  if (r.length > 500) throw new FileActionError("Keep the reason under 500 characters.");
  const { ip, userAgent } = await requestMeta();
  return db.transaction(async (tx) => {
    const [file] = await tx
      .select()
      .from(schema.files)
      .where(and(eq(schema.files.id, fileId), eq(schema.files.companyId, auth.company.id)))
      .for("update");
    if (!file) throw new FileActionError("File not found.");
    if (!OPEN.includes(file.status as (typeof OPEN)[number])) throw new FileActionError(file.status === "completed" ? "A completed File can't be voided." : "This File is already closed.");
    const now = new Date();
    // Everyone who ever got a link for this File is told; all open links stop working.
    const notified = await tx
      .select()
      .from(schema.recipients)
      .where(and(eq(schema.recipients.fileId, fileId), inArray(schema.recipients.status, ["active", "viewed", "signed", "changes_requested"])));
    await tx
      .update(schema.recipients)
      .set({ status: "revoked" })
      .where(and(eq(schema.recipients.fileId, fileId), inArray(schema.recipients.status, ["waiting", "active", "viewed", "changes_requested"])));
    await tx.update(schema.files).set({ status: "voided", voidedAt: now, voidReason: r, updatedAt: now }).where(eq(schema.files.id, fileId));
    await tx.insert(schema.events).values({
      companyId: auth.company.id,
      fileId,
      actorType: "user",
      actorId: auth.user.id,
      actorLabel: auth.user.name,
      type: "file.voided",
      data: { reason: r, notified: notified.map((n) => n.email) },
      ip,
      userAgent,
    });
    const [t] = file.templateId ? await tx.select({ name: schema.templates.name }).from(schema.templates).where(eq(schema.templates.id, file.templateId)) : [];
    for (const n of notified) {
      const email = voidedEmail({ brand: { name: auth.company.name, color: auth.company.brandColor }, recipientName: n.name, documentName: t?.name ?? "the agreement", clientLegalName: file.clientLegalName });
      await recordEmail(tx, { companyId: auth.company.id, fileId, recipientId: n.id, kind: "voided", toEmail: n.email, toName: n.name, ...email });
    }
    return { notified: notified.length };
  });
}

export const RESEND_COOLDOWN_MS = 10 * 60_000;
export const SIGN_KINDS = ["sign_request", "countersign_request", "firm_sign_first", "resend", "reminder"];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type FileRow = typeof schema.files.$inferSelect;
type RecipientRow = typeof schema.recipients.$inferSelect;

/**
 * The signing email for whoever's turn it is, as "Reminder: …". Used by the firm's Resend
 * button and by automatic reminders, so both say the same thing.
 */
export async function reminderEmailFor(tx: Tx, file: FileRow, r: RecipientRow, brand: { name: string; color: string }, baseUrl: string, senderName: string) {
  const [[doc], [t], [lastSigner]] = await Promise.all([
    tx.select({ roles: schema.fileDocuments.roles }).from(schema.fileDocuments).where(eq(schema.fileDocuments.id, file.currentDocumentId!)),
    file.templateId ? tx.select({ name: schema.templates.name }).from(schema.templates).where(eq(schema.templates.id, file.templateId)) : Promise.resolve([]),
    // Who signed most recently on this document (named in countersign reminders).
    tx
      .select({ name: schema.recipients.name })
      .from(schema.recipients)
      .where(and(eq(schema.recipients.fileId, file.id), eq(schema.recipients.documentId, file.currentDocumentId!), eq(schema.recipients.status, "signed")))
      .orderBy(desc(schema.recipients.signedAt))
      .limit(1),
  ]);
  const documentName = t?.name ?? "the agreement";
  const link = signLink(baseUrl, r.token);
  const email =
    r.userId === null
      ? signRequestEmail({ brand, recipientName: r.name, documentName, clientLegalName: file.clientLegalName, link, expiresAt: file.expiresAt ?? new Date(Date.now() + 30 * 86_400_000), senderName, countersign: false })
      : isFirmFirst(doc?.roles) && !lastSigner
        ? firmSignFirstEmail({ brand, recipientName: r.name, documentName, clientLegalName: file.clientLegalName, link })
        : countersignRequestEmail({ brand, recipientName: r.name, documentName, signerName: lastSigner?.name ?? file.clientLegalName, signerCompany: lastSigner ? file.clientLegalName : null, link });
  return { ...email, subject: `Reminder: ${email.subject}` };
}

/**
 * Re-sends the signing email to whoever's turn it is. At most once per 10 minutes per signer.
 * On an Expired File it first extends the links by the firm's expiry period (logged).
 */
export async function resendSigningEmail(auth: AuthContext, fileId: string, baseUrl: string) {
  const { ip, userAgent } = await requestMeta();
  return db.transaction(async (tx) => {
    const [file] = await tx
      .select()
      .from(schema.files)
      .where(and(eq(schema.files.id, fileId), eq(schema.files.companyId, auth.company.id)))
      .for("update");
    if (!file) throw new FileActionError("File not found.");
    if (file.status !== "sent" && file.status !== "partially_signed" && file.status !== "expired") throw new FileActionError("There's no one waiting to sign this File.");
    const live = await tx
      .select()
      .from(schema.recipients)
      .where(and(eq(schema.recipients.fileId, fileId), eq(schema.recipients.documentId, file.currentDocumentId!), inArray(schema.recipients.status, ["active", "viewed"])));
    if (!live.length) throw new FileActionError("There's no one waiting to sign this File.");
    const brand = { name: auth.company.name, color: auth.company.brandColor };
    const extending = file.status === "expired";
    if (extending) {
      const [c] = await tx.select({ days: schema.companies.linkExpiryDays }).from(schema.companies).where(eq(schema.companies.id, auth.company.id));
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (c?.days ?? 30) * 86_400_000);
      const [anySigned] = await tx
        .select({ id: schema.recipients.id })
        .from(schema.recipients)
        .where(and(eq(schema.recipients.documentId, file.currentDocumentId!), eq(schema.recipients.status, "signed")))
        .limit(1);
      const status = anySigned ? "partially_signed" : "sent";
      await tx.update(schema.files).set({ status, expiresAt, updatedAt: now }).where(eq(schema.files.id, fileId));
      // Reminders restart from now for whoever's turn it is.
      await tx.update(schema.recipients).set({ activatedAt: now }).where(inArray(schema.recipients.id, live.map((r) => r.id)));
      await tx.insert(schema.events).values({ companyId: auth.company.id, fileId, actorType: "user", actorId: auth.user.id, actorLabel: auth.user.name, type: "file.extended", data: { expiresAt: expiresAt.toISOString() }, ip, userAgent });
      file.expiresAt = expiresAt;
      file.status = status;
    }
    const sent: string[] = [];
    for (const r of live) {
      const [last] = await tx
        .select({ at: schema.outbox.createdAt })
        .from(schema.outbox)
        .where(and(eq(schema.outbox.recipientId, r.id), inArray(schema.outbox.kind, SIGN_KINDS)))
        .orderBy(desc(schema.outbox.createdAt))
        .limit(1);
      const wait = last ? RESEND_COOLDOWN_MS - (Date.now() - last.at.getTime()) : 0;
      if (wait > 0 && !extending) throw new FileActionError(`${r.name} was emailed recently. You can resend in ${Math.ceil(wait / 60_000)} minute${Math.ceil(wait / 60_000) === 1 ? "" : "s"}.`);
      const email = await reminderEmailFor(tx, file, r, brand, baseUrl, auth.user.name);
      await recordEmail(tx, { companyId: auth.company.id, fileId, recipientId: r.id, kind: "resend", toEmail: r.email, toName: r.name, ...email });
      await tx.insert(schema.events).values({ companyId: auth.company.id, fileId, recipientId: r.id, actorType: "user", actorId: auth.user.id, actorLabel: auth.user.name, type: "file.resent", data: { to: r.name, email: r.email }, ip, userAgent });
      sent.push(r.name);
    }
    return { sent };
  });
}

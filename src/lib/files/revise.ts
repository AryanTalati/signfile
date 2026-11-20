import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AuthContext } from "@/lib/auth/session";
import { requestMeta } from "@/lib/auth/session";
import { db, schema } from "@/lib/db/client";
import { recordEmail } from "@/lib/email/outbox";
import { firmSignFirstEmail, revisionNoticeEmail, signRequestEmail } from "@/lib/email/templates";
import { validateFields } from "@/lib/fields/validate";
import { getTemplate } from "@/lib/templates/service";
import { copyObject } from "@/lib/storage";
import { newToken, signLink } from "./service";

export class ReviseError extends Error {}

/**
 * Sends a revised version of a Declined / Changes-requested File:
 *  - the previous version is marked superseded (kept, never deleted) and its open links stop working
 *  - the revised template version is snapshotted as version n+1 of the File
 *  - the same people sign again in the same roles; whoever signed the old version must sign again
 *  - everyone is emailed: the first signer gets the new link, later signers a notice
 */
export async function reviseAndResend(
  auth: AuthContext,
  fileId: string,
  revisionTemplateId: string,
  baseUrl: string,
  opts: { note?: string | null; firmValues?: Record<string, string> } = {},
) {
  const note = opts.note?.trim().slice(0, 2000) || null;
  const t = await getTemplate(auth, revisionTemplateId);
  if (!t || t.template.revisionForFileId !== fileId) throw new ReviseError("That revised version doesn't belong to this File.");
  const v = t.version;
  const roles = v.roles ?? [];
  const problems = validateFields(v.fields, roles, v.pageCount);
  if (problems.length) throw new ReviseError(`The revised version isn't ready: ${problems[0]}`);
  const flagged = ((v.detection as { match?: { flagged?: { id: string }[] } } | null)?.match?.flagged ?? []).map((x) => x.id);
  const unreviewed = v.fields.filter((f) => flagged.includes(f.id) && !f.reviewed);
  if (unreviewed.length) throw new ReviseError(`Review the ${unreviewed.length} flagged field${unreviewed.length > 1 ? "s" : ""} first.`);

  const [file] = await db.select().from(schema.files).where(and(eq(schema.files.id, fileId), eq(schema.files.companyId, auth.company.id)));
  if (!file) throw new ReviseError("File not found.");
  if (file.status !== "declined" && file.status !== "changes_requested") throw new ReviseError("This File isn't waiting for a revised version.");
  const [oldDoc] = await db.select().from(schema.fileDocuments).where(eq(schema.fileDocuments.id, file.currentDocumentId!));
  const oldRecipients = await db.select().from(schema.recipients).where(eq(schema.recipients.documentId, oldDoc.id)).orderBy(desc(schema.recipients.createdAt));

  // The same people, role by role (latest recipient for each role on the old version).
  const people = roles
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((role) => {
      const prior = oldRecipients.find((r) => r.roleKey === role.key);
      return { role, prior };
    });
  if (people.some((p) => !p.prior)) throw new ReviseError("The revised version has a signer role the original didn't. Send it as a new File instead.");

  const versionNo = oldDoc.versionNo + 1;
  const documentId = randomUUID();
  const pdfKey = `${auth.company.id}/files/${fileId}/v${versionNo}/document.pdf`;
  await copyObject(v.pdfKey, pdfKey);
  const [company] = await db.select({ linkExpiryDays: schema.companies.linkExpiryDays }).from(schema.companies).where(eq(schema.companies.id, auth.company.id));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (company?.linkExpiryDays ?? 30) * 86_400_000);
  const { ip, userAgent } = await requestMeta();
  const [orig] = file.templateId ? await db.select({ name: schema.templates.name }).from(schema.templates).where(eq(schema.templates.id, file.templateId)) : [];
  const documentName = orig?.name ?? "the agreement";
  const brand = { name: auth.company.name, color: auth.company.brandColor };

  await db.transaction(async (tx) => {
    // Re-check under lock: the File must still be waiting for a revision.
    const [locked] = await tx.select({ status: schema.files.status }).from(schema.files).where(eq(schema.files.id, fileId)).for("update");
    if (locked?.status !== "declined" && locked?.status !== "changes_requested") throw new ReviseError("This File isn't waiting for a revised version.");

    await tx.update(schema.fileDocuments).set({ supersededAt: now }).where(eq(schema.fileDocuments.id, oldDoc.id));
    await tx
      .update(schema.recipients)
      .set({ status: "revoked" })
      .where(and(eq(schema.recipients.documentId, oldDoc.id), inArray(schema.recipients.status, ["waiting", "active", "viewed", "declined", "changes_requested"])));
    await tx.insert(schema.fileDocuments).values({
      id: documentId,
      companyId: auth.company.id,
      fileId,
      versionNo,
      templateVersionId: v.id,
      pdfKey,
      pdfSha256: v.pdfSha256,
      sourceSha256: v.sourceSha256,
      sourceFilename: v.sourceFilename,
      pages: v.pages,
      roles,
      fields: v.fields,
      createdById: auth.user.id,
    });

    const created: { id: string; token: string; name: string; email: string; userId: string | null; active: boolean; signAgain: boolean }[] = [];
    for (const [i, { role, prior }] of people.entries()) {
      const token = newToken();
      const active = i === 0;
      const [r] = await tx
        .insert(schema.recipients)
        .values({
          companyId: auth.company.id,
          fileId,
          documentId,
          roleKey: role.key,
          signingOrder: role.order,
          userId: prior!.userId,
          name: prior!.name,
          title: prior!.title,
          email: prior!.email,
          token,
          status: active ? "active" : "waiting",
        })
        .returning({ id: schema.recipients.id });
      created.push({ id: r.id, token, name: prior!.name, email: prior!.email, userId: prior!.userId, active, signAgain: prior!.status === "signed" });
    }

    await tx
      .update(schema.files)
      .set({ status: "sent", currentDocumentId: documentId, sentAt: now, expiresAt, completedAt: null, updatedAt: now, firmValues: { ...(file.firmValues ?? {}), ...(opts.firmValues ?? {}) } })
      .where(eq(schema.files.id, fileId));
    await tx.insert(schema.events).values([
      {
        companyId: auth.company.id,
        fileId,
        actorType: "user",
        actorId: auth.user.id,
        actorLabel: auth.user.name,
        type: "file.revised",
        data: { fromVersion: oldDoc.versionNo, toVersion: versionNo, supersededDocumentSha256: oldDoc.pdfSha256, documentSha256: v.pdfSha256, note },
        ip,
        userAgent,
      },
      {
        companyId: auth.company.id,
        fileId,
        recipientId: created[0].id,
        actorType: "user",
        actorId: auth.user.id,
        actorLabel: auth.user.name,
        type: "file.sent",
        data: { documentVersion: versionNo, documentSha256: v.pdfSha256, sourceSha256: v.sourceSha256, to: { name: created[0].name, email: created[0].email }, expiresAt: expiresAt.toISOString() },
        ip,
        userAgent,
      },
    ]);

    for (const r of created) {
      const link = signLink(baseUrl, r.token);
      const email = r.active
        ? r.userId
          ? firmSignFirstEmail({ brand, recipientName: r.name, documentName, clientLegalName: file.clientLegalName, link })
          : signRequestEmail({ brand, recipientName: r.name, documentName, clientLegalName: file.clientLegalName, link, expiresAt, senderName: auth.user.name, countersign: false, revised: { version: versionNo, signAgain: r.signAgain, note } })
        : revisionNoticeEmail({ brand, recipientName: r.name, documentName, clientLegalName: file.clientLegalName, version: versionNo, signAgain: r.signAgain, note });
      await recordEmail(tx, { companyId: auth.company.id, fileId, recipientId: r.id, kind: r.active ? "sign_request" : "revision_notice", toEmail: r.email, toName: r.name, ...email });
    }
  });
  return { versionNo };
}

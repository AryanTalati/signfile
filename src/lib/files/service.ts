import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AuthContext } from "@/lib/auth/session";
import { requestMeta } from "@/lib/auth/session";
import { db, schema } from "@/lib/db/client";
import { signRequestEmail } from "@/lib/email/templates";
import { recordEmail } from "@/lib/email/outbox";
import { validateFields } from "@/lib/fields/validate";
import { getTemplate } from "@/lib/templates/service";
import { copyObject } from "@/lib/storage";

/**
 * Files: one engagement for one client. Every function takes the caller's
 * AuthContext and filters by its company id.
 */

export const newToken = () => randomBytes(32).toString("base64url");
export const signLink = (base: string, token: string) => `${base}/sign/${token}`;

export const createFileSchema = z.object({
  templateId: z.string().uuid(),
  clientLegalName: z.string().trim().min(2, "Enter the client's legal name.").max(200),
  reference: z.string().trim().max(120).optional().default(""),
  signerName: z.string().trim().min(2, "Enter the signer's name.").max(120),
  signerTitle: z.string().trim().max(120).optional().default(""),
  signerEmail: z.string().trim().toLowerCase().email("Enter a valid email."),
  countersignerId: z.string().uuid().optional(),
  firmValues: z.record(z.string(), z.string().trim().max(500)).default({}),
});
export type CreateFileInput = z.infer<typeof createFileSchema>;

export class FileInputError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/** Team members who can countersign (any user of the company). */
export async function listCountersigners(auth: AuthContext) {
  return db
    .select({ id: schema.users.id, name: schema.users.name, title: schema.users.title, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.companyId, auth.company.id))
    .orderBy(asc(schema.users.name));
}

/** Creates a File from a template and sends it: snapshot, signers, links, outbox. */
export async function createAndSendFile(auth: AuthContext, input: CreateFileInput, baseUrl: string) {
  const t = await getTemplate(auth, input.templateId);
  if (!t) throw new FileInputError("That template no longer exists.", "templateId");
  const v = t.version;
  const roles = v.roles?.length ? v.roles : [];
  const problems = validateFields(v.fields, roles, v.pageCount);
  if (problems.length) throw new FileInputError(`This template isn't ready to send: ${problems[0]}`, "templateId");

  // "Filled by you" values: every required one must be filled.
  const firmFill = v.fields.filter((f) => f.type === "firm_fill");
  const firmValues: Record<string, string> = {};
  for (const f of firmFill) {
    const key = f.firmFillKey ?? f.id;
    const val = (input.firmValues[key] ?? "").trim();
    if (f.required && !val) throw new FileInputError(`Fill in "${f.label}".`, `firm:${key}`);
    if (val) firmValues[key] = val;
  }

  const countersign = roles.some((r) => r.kind === "firm");
  let countersigner: { id: string; name: string; title: string | null; email: string } | null = null;
  if (countersign) {
    const wanted = input.countersignerId ?? (await defaultCountersignerId(auth)) ?? auth.user.id;
    const [u] = await db
      .select({ id: schema.users.id, name: schema.users.name, title: schema.users.title, email: schema.users.email })
      .from(schema.users)
      .where(and(eq(schema.users.id, wanted), eq(schema.users.companyId, auth.company.id)))
      .limit(1);
    if (!u) throw new FileInputError("Choose who countersigns for your firm.", "countersignerId");
    countersigner = u;
  }

  const fileId = randomUUID();
  const documentId = randomUUID();
  // Snapshot: the File gets its own copy of the PDF and fields; template edits never touch it.
  const pdfKey = `${auth.company.id}/files/${fileId}/v1/document.pdf`;
  await copyObject(v.pdfKey, pdfKey);

  const [company] = await db
    .select({ linkExpiryDays: schema.companies.linkExpiryDays, brandColor: schema.companies.brandColor })
    .from(schema.companies)
    .where(eq(schema.companies.id, auth.company.id));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (company?.linkExpiryDays ?? 30) * 86_400_000);
  const clientRole = roles.find((r) => r.kind === "client") ?? roles[0];
  const firmRole = roles.find((r) => r.kind === "firm");
  const clientToken = newToken();
  const { ip, userAgent } = await requestMeta();
  const actor = { actorType: "user", actorId: auth.user.id, actorLabel: auth.user.name, ip, userAgent } as const;

  await db.transaction(async (tx) => {
    await tx.insert(schema.files).values({
      id: fileId,
      companyId: auth.company.id,
      ownerUserId: auth.user.id,
      templateId: t.template.id,
      reference: input.reference || null,
      clientLegalName: input.clientLegalName,
      firmValues,
      status: "sent",
      expiresAt,
      sentAt: now,
    });
    await tx.insert(schema.fileDocuments).values({
      id: documentId,
      companyId: auth.company.id,
      fileId,
      versionNo: 1,
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
    await tx.update(schema.files).set({ currentDocumentId: documentId }).where(eq(schema.files.id, fileId));

    const [client] = await tx
      .insert(schema.recipients)
      .values({
        companyId: auth.company.id,
        fileId,
        documentId,
        roleKey: clientRole.key,
        signingOrder: clientRole.order,
        name: input.signerName,
        title: input.signerTitle || null,
        email: input.signerEmail,
        token: clientToken,
        status: "active",
      })
      .returning({ id: schema.recipients.id });
    let firmRecipientId: string | null = null;
    if (countersigner && firmRole) {
      const [firm] = await tx
        .insert(schema.recipients)
        .values({
          companyId: auth.company.id,
          fileId,
          documentId,
          roleKey: firmRole.key,
          signingOrder: firmRole.order,
          userId: countersigner.id,
          name: countersigner.name,
          title: countersigner.title,
          email: countersigner.email,
          token: newToken(),
          status: "waiting",
        })
        .returning({ id: schema.recipients.id });
      firmRecipientId = firm.id;
    }

    await tx.insert(schema.events).values([
      {
        ...actor,
        companyId: auth.company.id,
        fileId,
        type: "file.created",
        data: { template: t.template.name, templateVersion: v.version, clientLegalName: input.clientLegalName, reference: input.reference || null },
      },
      {
        ...actor,
        companyId: auth.company.id,
        fileId,
        recipientId: client.id,
        type: "file.sent",
        data: {
          documentVersion: 1,
          documentSha256: v.pdfSha256,
          sourceSha256: v.sourceSha256,
          to: { name: input.signerName, email: input.signerEmail, title: input.signerTitle || null },
          countersigner: countersigner ? { name: countersigner.name, email: countersigner.email } : null,
          firmRecipientId,
          expiresAt: expiresAt.toISOString(),
        },
      },
    ]);

    const email = signRequestEmail({
      brand: { name: auth.company.name, color: company?.brandColor ?? auth.company.brandColor },
      recipientName: input.signerName,
      documentName: t.template.name,
      clientLegalName: input.clientLegalName,
      link: signLink(baseUrl, clientToken),
      expiresAt,
      senderName: auth.user.name,
      countersign,
    });
    await recordEmail(tx, {
      companyId: auth.company.id,
      fileId,
      recipientId: client.id,
      kind: "sign_request",
      toEmail: input.signerEmail,
      toName: input.signerName,
      ...email,
    });
  });

  return { fileId };
}

async function defaultCountersignerId(auth: AuthContext) {
  const [c] = await db.select({ id: schema.companies.defaultCountersignerId }).from(schema.companies).where(eq(schema.companies.id, auth.company.id));
  return c?.id ?? null;
}

/** Files waiting on the current user's countersignature. */
export async function listAwaitingMe(auth: AuthContext) {
  return db
    .select({ fileId: schema.files.id, clientLegalName: schema.files.clientLegalName, token: schema.recipients.token })
    .from(schema.recipients)
    .innerJoin(schema.files, eq(schema.files.id, schema.recipients.fileId))
    .where(
      and(
        eq(schema.recipients.companyId, auth.company.id),
        eq(schema.recipients.userId, auth.user.id),
        inArray(schema.recipients.status, ["active", "viewed"]),
        inArray(schema.files.status, ["sent", "partially_signed"]),
      ),
    )
    .limit(50);
}

export async function listFiles(auth: AuthContext) {
  return db
    .select({
      id: schema.files.id,
      clientLegalName: schema.files.clientLegalName,
      reference: schema.files.reference,
      status: schema.files.status,
      sentAt: schema.files.sentAt,
      updatedAt: schema.files.updatedAt,
      templateName: schema.templates.name,
    })
    .from(schema.files)
    .leftJoin(schema.templates, eq(schema.templates.id, schema.files.templateId))
    .where(eq(schema.files.companyId, auth.company.id))
    .orderBy(desc(schema.files.createdAt))
    .limit(200);
}

/** A File with its current document, signers, events and emails. Null if not in this company. */
export async function getFile(auth: AuthContext, fileId: string) {
  if (!z.string().uuid().safeParse(fileId).success) return null;
  const [file] = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, fileId), eq(schema.files.companyId, auth.company.id)))
    .limit(1);
  if (!file) return null;
  const scope = (col: typeof schema.recipients.fileId | typeof schema.events.fileId | typeof schema.outbox.fileId | typeof schema.fileDocuments.fileId) => eq(col, fileId);
  const [recipients, events, emails, documents, template] = await Promise.all([
    db.select().from(schema.recipients).where(and(scope(schema.recipients.fileId), eq(schema.recipients.companyId, auth.company.id))).orderBy(asc(schema.recipients.signingOrder), asc(schema.recipients.createdAt)),
    db.select().from(schema.events).where(and(scope(schema.events.fileId), eq(schema.events.companyId, auth.company.id))).orderBy(asc(schema.events.id)),
    db.select().from(schema.outbox).where(and(scope(schema.outbox.fileId), eq(schema.outbox.companyId, auth.company.id))).orderBy(desc(schema.outbox.createdAt)),
    db.select().from(schema.fileDocuments).where(and(scope(schema.fileDocuments.fileId), eq(schema.fileDocuments.companyId, auth.company.id))).orderBy(asc(schema.fileDocuments.versionNo)),
    file.templateId
      ? db.select({ name: schema.templates.name }).from(schema.templates).where(and(eq(schema.templates.id, file.templateId), eq(schema.templates.companyId, auth.company.id)))
      : Promise.resolve([]),
  ]);
  return { file, recipients, events, emails, documents, templateName: template[0]?.name ?? "Agreement" };
}

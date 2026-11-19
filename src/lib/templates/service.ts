import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AuthContext } from "@/lib/auth/session";
import { db, schema } from "@/lib/db/client";
import { FIELD_TYPES, type FieldDef, type RoleDef } from "@/lib/fields/types";
import { DEFAULT_ROLES, detectFields } from "@/lib/pdf/detect";
import { extractLayout } from "@/lib/pdf/extract";
import { prepareDocument, sha256 } from "@/lib/pdf/prepare";
import { appendSignaturePage } from "@/lib/pdf/signature-page";
import { deleteObjects, getObject, putObject } from "@/lib/storage";

/**
 * Templates: an uploaded agreement + its fields. Every function takes the
 * caller's AuthContext and filters by its company id.
 */

const EXT: Record<string, string> = { pdf: "pdf", docx: "docx", doc: "doc", odt: "odt", rtf: "rtf" };

export async function createTemplateFromUpload(auth: AuthContext, file: { name: string; bytes: Uint8Array }) {
  const prepared = await prepareDocument(file.bytes); // throws UploadError with a user-facing message
  const t0 = Date.now();
  const layout = await extractLayout(prepared.pdf);
  const detection = detectFields(layout, { firmName: auth.company.name });
  const detectMs = Date.now() - t0;

  const templateId = randomUUID();
  const base = `${auth.company.id}/templates/${templateId}/v1`;
  const sourceKey = `${base}/source.${EXT[prepared.source.kind]}`;
  const pdfKey = `${base}/document.pdf`;
  await putObject(sourceKey, file.bytes, prepared.source.mime);
  await putObject(pdfKey, prepared.pdf, "application/pdf");

  const name = cleanName(file.name);
  await db.transaction(async (tx) => {
    await tx.insert(schema.templates).values({ id: templateId, companyId: auth.company.id, name, createdById: auth.user.id });
    await tx.insert(schema.templateVersions).values({
      companyId: auth.company.id,
      templateId,
      version: 1,
      sourceKey,
      sourceFilename: file.name.slice(0, 200),
      sourceMime: prepared.source.mime,
      sourceSha256: prepared.source.sha256,
      pdfKey,
      pdfSha256: prepared.pdfSha256,
      pageCount: prepared.pages.length,
      pages: prepared.pages,
      roles: detection.roles,
      fields: detection.fields,
      detection: {
        method: "rules",
        outcome: detection.outcome,
        warnings: detection.warnings,
        stats: detection.stats,
        notes: prepared.notes,
        conversionMs: prepared.conversionMs ?? null,
        detectMs,
        detectedCount: detection.fields.length,
      },
      createdById: auth.user.id,
    });
    await tx.insert(schema.events).values({
      companyId: auth.company.id,
      actorType: "user",
      actorId: auth.user.id,
      actorLabel: auth.user.name,
      type: "template.created",
      data: { templateId, name, fields: detection.fields.length, outcome: detection.outcome, sourceSha256: prepared.source.sha256 },
    });
  });
  return { templateId, detection };
}

function cleanName(filename: string) {
  return (
    filename
      .replace(/\.(pdf|docx?|odt|rtf)$/i, "")
      .replace(/[_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Untitled agreement"
  );
}

export async function listTemplates(auth: AuthContext) {
  const rows = await db
    .select({
      id: schema.templates.id,
      name: schema.templates.name,
      updatedAt: schema.templates.updatedAt,
      archivedAt: schema.templates.archivedAt,
      version: schema.templateVersions.version,
      pageCount: schema.templateVersions.pageCount,
      fields: schema.templateVersions.fields,
      sourceFilename: schema.templateVersions.sourceFilename,
    })
    .from(schema.templates)
    .innerJoin(
      schema.templateVersions,
      and(eq(schema.templateVersions.templateId, schema.templates.id), eq(schema.templateVersions.version, schema.templates.currentVersion)),
    )
    .where(eq(schema.templates.companyId, auth.company.id))
    .orderBy(desc(schema.templates.updatedAt));
  return rows;
}

/** Template + its current version, or null if it doesn't exist in this company. */
export async function getTemplate(auth: AuthContext, templateId: string) {
  if (!z.string().uuid().safeParse(templateId).success) return null;
  const [row] = await db
    .select({ template: schema.templates, version: schema.templateVersions })
    .from(schema.templates)
    .innerJoin(
      schema.templateVersions,
      and(eq(schema.templateVersions.templateId, schema.templates.id), eq(schema.templateVersions.version, schema.templates.currentVersion)),
    )
    .where(and(eq(schema.templates.id, templateId), eq(schema.templates.companyId, auth.company.id)))
    .limit(1);
  return row ?? null;
}

export async function getTemplatePdf(auth: AuthContext, templateId: string) {
  const t = await getTemplate(auth, templateId);
  if (!t) return null;
  return { bytes: await getObject(t.version.pdfKey), sha256: t.version.pdfSha256 };
}

// ---------- saving fields ----------

const num01 = z.number().min(0).max(1);
export const fieldSchema = z.object({
  id: z.string().min(1).max(64),
  page: z.number().int().min(1),
  x: num01,
  y: num01,
  w: z.number().min(0.005).max(1),
  h: z.number().min(0.005).max(1),
  type: z.enum(FIELD_TYPES),
  roleKey: z.string().max(32).nullable(),
  label: z.string().trim().min(1).max(60),
  required: z.boolean(),
  firmFillKey: z.string().max(60).optional(),
  confidence: z.number().min(0).max(1),
  source: z.enum(["rule", "manual", "ai", "appended", "acroform"]),
  reason: z.string().max(400).optional(),
  reviewed: z.boolean().optional(),
});

export const saveSchema = z.object({
  /** The PDF the editor was showing; a save against an older PDF (e.g. before a signature page was appended) is rejected. */
  pdfSha256: z.string().length(64).optional(),
  name: z.string().trim().min(1).max(120),
  countersign: z.boolean(),
  fields: z.array(fieldSchema).max(500),
});

export function rolesFor(countersign: boolean): RoleDef[] {
  return countersign ? DEFAULT_ROLES : DEFAULT_ROLES.filter((r) => r.kind === "client");
}

/** Problems that block sending (shown in the editor; saving drafts is always allowed). */
export function validateFields(fields: FieldDef[], roles: RoleDef[], pageCount: number): string[] {
  const problems: string[] = [];
  const keys = new Set(roles.map((r) => r.key));
  for (const r of roles) if (!fields.some((f) => f.roleKey === r.key && f.type === "signature")) problems.push(`Add a signature field for the ${r.kind === "client" ? "client" : "firm"}.`);
  const orphan = fields.filter((f) => f.type !== "firm_fill" && (!f.roleKey || !keys.has(f.roleKey)));
  if (orphan.length) problems.push(`${orphan.length} field${orphan.length > 1 ? "s are" : " is"} assigned to a signer who isn't on this template.`);
  if (fields.some((f) => f.page > pageCount)) problems.push("A field is on a page that doesn't exist.");
  return problems;
}

export async function saveTemplate(auth: AuthContext, templateId: string, input: z.infer<typeof saveSchema>) {
  const t = await getTemplate(auth, templateId);
  if (!t) return null;
  if (input.pdfSha256 && input.pdfSha256 !== t.version.pdfSha256) return { stale: true as const };
  const roles = rolesFor(input.countersign);
  const fields: FieldDef[] = input.fields
    .filter((f) => f.page <= t.version.pageCount)
    .map((f) => ({ ...f, x: Math.min(f.x, 1 - f.w), y: Math.min(f.y, 1 - f.h), roleKey: f.type === "firm_fill" ? null : f.roleKey }));
  await db.transaction(async (tx) => {
    await tx.update(schema.templateVersions).set({ fields, roles }).where(and(eq(schema.templateVersions.id, t.version.id), eq(schema.templateVersions.companyId, auth.company.id)));
    await tx
      .update(schema.templates)
      .set({ name: input.name, updatedAt: new Date() })
      .where(and(eq(schema.templates.id, templateId), eq(schema.templates.companyId, auth.company.id)));
  });
  return { fields, roles, problems: validateFields(fields, roles, t.version.pageCount) };
}

// ---------- append signature page ----------

export async function appendSignaturePageToTemplate(auth: AuthContext, templateId: string) {
  const t = await getTemplate(auth, templateId);
  if (!t) return null;
  if (t.version.signaturePageAppended) return { alreadyAppended: true as const };
  const roles = t.version.roles?.length ? t.version.roles : DEFAULT_ROLES;
  const current = await getObject(t.version.pdfKey);
  const out = await appendSignaturePage(new Uint8Array(current), {
    documentName: t.template.name,
    roles,
    partyNames: { firm: auth.company.name },
  });
  const pdfKey = `${auth.company.id}/templates/${templateId}/v${t.version.version}/document-with-signature-page-${Date.now()}.pdf`;
  await putObject(pdfKey, out.pdf, "application/pdf");
  const fields = [...(t.version.fields ?? []), ...out.fields];
  await db.transaction(async (tx) => {
    await tx
      .update(schema.templateVersions)
      .set({ pdfKey, pdfSha256: sha256(out.pdf), pages: out.pages, pageCount: out.pages.length, fields, signaturePageAppended: true })
      .where(and(eq(schema.templateVersions.id, t.version.id), eq(schema.templateVersions.companyId, auth.company.id)));
    await tx.update(schema.templates).set({ updatedAt: new Date() }).where(eq(schema.templates.id, templateId));
    await tx.insert(schema.events).values({
      companyId: auth.company.id,
      actorType: "user",
      actorId: auth.user.id,
      actorLabel: auth.user.name,
      type: "template.signature_page_appended",
      data: { templateId, pages: out.pages.length },
    });
  });
  // The pre-append PDF is no longer referenced by this version (the source file is kept).
  if (t.version.pdfKey !== pdfKey) await deleteObjects([t.version.pdfKey]).catch(() => undefined);
  return { fields, pages: out.pages, pageCount: out.pages.length };
}

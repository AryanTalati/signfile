import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AuthContext } from "@/lib/auth/session";
import { db, schema } from "@/lib/db/client";
import { FIELD_TYPES, hasNoSigner, type FieldDef, type RoleDef } from "@/lib/fields/types";
import { matchFields } from "@/lib/pdf/match";
import { detectFields, snapPlacement } from "@/lib/pdf/detect";
import { reviewNewAgreement } from "@/lib/ai/run";
import { DEFAULT_ROLES, rolesFor, validateFields } from "@/lib/fields/validate";
import { extractLayout } from "@/lib/pdf/extract";
import { prepareDocument, sha256 } from "@/lib/pdf/prepare";
import { appendSignaturePage } from "@/lib/pdf/signature-page";
import { deleteObjects, getObject, putObject } from "@/lib/storage";

/**
 * Templates: an uploaded agreement + its fields. Every function takes the
 * caller's AuthContext and filters by its company id.
 */

const EXT: Record<string, string> = { pdf: "pdf", docx: "docx", doc: "doc", odt: "odt", rtf: "rtf" };

/**
 * Document processing (conversion, parsing, detection) is CPU-heavy and the
 * Render free instance has 0.1 CPU. Process one upload at a time, let a few
 * wait, and turn the rest away with a clear message rather than letting a
 * backlog make the whole site unresponsive.
 */
const MAX_WAITING = 3;
let processing: Promise<unknown> = Promise.resolve();
let waiting = 0;

export class BusyError extends Error {}
export class AbortedError extends Error {}

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (waiting >= MAX_WAITING) return Promise.reject(new BusyError("We're processing other documents right now. Try again in a minute."));
  waiting++;
  const run = processing.then(
    () => (waiting--, fn()),
    () => (waiting--, fn()),
  );
  processing = run.catch(() => undefined);
  return run;
}

export class RevisionError extends Error {}

export function createTemplateFromUpload(auth: AuthContext, file: { name: string; bytes: Uint8Array }, signal?: AbortSignal, reviseFileId?: string) {
  return exclusive(() => processUpload(auth, file, signal, reviseFileId));
}

async function processUpload(auth: AuthContext, file: { name: string; bytes: Uint8Array }, signal?: AbortSignal, reviseFileId?: string) {
  // A revised version for one File: only for a Declined / Changes-requested File of this company.
  let revisionName: string | null = null;
  if (reviseFileId) {
    if (!z.string().uuid().safeParse(reviseFileId).success) throw new RevisionError("That File doesn't exist.");
    const [f] = await db
      .select({ status: schema.files.status, client: schema.files.clientLegalName, templateName: schema.templates.name })
      .from(schema.files)
      .leftJoin(schema.templates, eq(schema.templates.id, schema.files.templateId))
      .where(and(eq(schema.files.id, reviseFileId), eq(schema.files.companyId, auth.company.id)));
    if (!f) throw new RevisionError("That File doesn't exist.");
    if (f.status !== "declined" && f.status !== "changes_requested") throw new RevisionError("Only a declined File, or one with changes requested, can get a revised version.");
    revisionName = `${f.templateName ?? "Agreement"} (revised for ${f.client})`.slice(0, 120);
  }
  // The uploader may have given up while this waited in line: don't do the work for nobody.
  const check = () => {
    if (signal?.aborted) throw new AbortedError("upload abandoned");
  };
  check();
  const prepared = await prepareDocument(file.bytes); // throws UploadError with a user-facing message
  check();
  const t0 = Date.now();
  const layout = await extractLayout(prepared.pdf);
  check();
  const detection = detectFields(layout, { firmName: auth.company.name });
  // Revision: match the new fields to the previous version's (by meaning, not position) and
  // carry over the previous version's signers' roles and order.
  let revision: { fields: FieldDef[]; roles: RoleDef[]; match: Record<string, unknown> } | null = null;
  if (reviseFileId) {
    const [prev] = await db
      .select({ fields: schema.fileDocuments.fields, roles: schema.fileDocuments.roles, pdfKey: schema.fileDocuments.pdfKey })
      .from(schema.files)
      .innerJoin(schema.fileDocuments, eq(schema.fileDocuments.id, schema.files.currentDocumentId))
      .where(and(eq(schema.files.id, reviseFileId), eq(schema.files.companyId, auth.company.id)));
    if (prev) {
      const prevLayout = await extractLayout(new Uint8Array(await getObject(prev.pdfKey)));
      const m = matchFields(prev.fields, prevLayout, detection.fields, layout);
      revision = {
        fields: m.fields,
        roles: prev.roles,
        match: {
          clean: m.clean,
          summary: m.summary,
          flagged: m.matches.filter((x) => x.status !== "matched").map((x) => ({ id: x.field.id, status: x.status })),
          missing: m.missing.map((f) => ({ label: f.label, type: f.type, roleKey: f.roleKey })),
        },
      };
    }
  }
  const detectMs = Date.now() - t0;
  // AI second opinion (new agreements only; a revision is matched to its previous version).
  // At most one call; any failure leaves the rules' result as it is.
  const ai = revision ? null : await reviewNewAgreement(auth, layout, detection.fields, signal);
  check();
  const fields = revision?.fields ?? (ai?.status === "ok" ? ai.fields : detection.fields);

  const templateId = randomUUID();
  const base = `${auth.company.id}/templates/${templateId}/v1`;
  const sourceKey = `${base}/source.${EXT[prepared.source.kind]}`;
  const pdfKey = `${base}/document.pdf`;
  await putObject(sourceKey, file.bytes, prepared.source.mime);
  await putObject(pdfKey, prepared.pdf, "application/pdf");

  const name = revisionName ?? cleanName(file.name);
  await db.transaction(async (tx) => {
    await tx.insert(schema.templates).values({ id: templateId, companyId: auth.company.id, name, createdById: auth.user.id, revisionForFileId: reviseFileId ?? null });
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
      roles: revision?.roles ?? detection.roles,
      fields,
      detection: {
        method: "rules",
        outcome: detection.outcome,
        warnings: detection.warnings,
        stats: detection.stats,
        notes: prepared.notes,
        conversionMs: prepared.conversionMs ?? null,
        detectMs,
        detectedCount: detection.fields.length,
        ...(revision ? { match: revision.match } : {}),
        ...(ai ? { ai: ai.status === "ok" ? { status: "ok", model: ai.model, summary: ai.summary, terms: ai.terms } : { status: ai.status, reason: ai.reason } } : {}),
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
    if (ai?.status === "ok")
      await tx.insert(schema.events).values({
        companyId: auth.company.id,
        actorType: "system",
        type: "template.ai_reviewed",
        data: { templateId, model: ai.model, ...ai.summary, termsFound: Object.values(ai.terms).filter((t) => t.found).length },
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
      setupDoneAt: schema.templates.setupDoneAt,
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
    .where(and(eq(schema.templates.companyId, auth.company.id), isNull(schema.templates.revisionForFileId)))
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
  ai: z.object({ suggestion: z.string().max(200), confidence: z.number().min(0).max(1) }).optional(),
});

export const saveSchema = z.object({
  /** The PDF the editor was showing; a save against an older PDF (e.g. before a signature page was appended) is rejected. */
  pdfSha256: z.string().length(64).optional(),
  name: z.string().trim().min(1).max(120),
  countersign: z.boolean(),
  /** "Firm signs when sending" (firm first) vs "Firm countersigns after the client". */
  firmFirst: z.boolean().optional().default(false),
  fields: z.array(fieldSchema).max(500),
  /** Firm fields kept aside while the firm doesn't sign (omitted = unchanged). */
  parkedFields: z.array(fieldSchema).max(500).optional(),
});

export { rolesFor, validateFields };

export async function saveTemplate(auth: AuthContext, templateId: string, input: z.infer<typeof saveSchema>) {
  const t = await getTemplate(auth, templateId);
  if (!t) return null;
  if (input.pdfSha256 && input.pdfSha256 !== t.version.pdfSha256) return { stale: true as const };
  const roles = rolesFor(input.countersign, input.firmFirst);
  const fields: FieldDef[] = input.fields
    .filter((f) => f.page <= t.version.pageCount)
    .map((f) => ({ ...f, x: Math.min(f.x, 1 - f.w), y: Math.min(f.y, 1 - f.h), roleKey: hasNoSigner(f.type) ? null : f.roleKey }));
  await db.transaction(async (tx) => {
    const parked = input.parkedFields?.filter((f) => f.page <= t.version.pageCount);
    await tx.update(schema.templateVersions).set({ fields, roles, ...(parked ? { parkedFields: parked } : {}) }).where(and(eq(schema.templateVersions.id, t.version.id), eq(schema.templateVersions.companyId, auth.company.id)));
    // Audit: a person confirmed (or edited) a field the AI review proposed or disputed.
    const before = new Map(t.version.fields.map((f) => [f.id, f]));
    for (const f of fields) {
      const prev = before.get(f.id);
      if (!f.ai || !f.reviewed || !prev || prev.reviewed) continue;
      await tx.insert(schema.events).values({
        companyId: auth.company.id,
        actorType: "user",
        actorId: auth.user.id,
        actorLabel: auth.user.name,
        type: "template.ai_suggestion_confirmed",
        data: { templateId, fieldId: f.id, type: f.type, roleKey: f.roleKey, label: f.label, aiSuggested: f.ai.suggestion, changed: prev.type !== f.type || prev.roleKey !== f.roleKey },
      });
    }
    await tx
      .update(schema.templates)
      .set({ name: input.name, updatedAt: new Date() })
      .where(and(eq(schema.templates.id, templateId), eq(schema.templates.companyId, auth.company.id)));
  });
  return { fields, roles, problems: validateFields(fields, roles, t.version.pageCount) };
}

// ---------- remove an appended signature page ----------

/**
 * Undoes "append a signature page": rebuilds the PDF from the original upload
 * (always kept), drops the fields that came with the page or were placed on it,
 * keeps every other field. Goes through the processing queue (DOCX re-converts).
 */
export function removeSignaturePageFromTemplate(auth: AuthContext, templateId: string) {
  return exclusive(async () => {
    const t = await getTemplate(auth, templateId);
    if (!t) return null;
    if (!t.version.signaturePageAppended) return { notAppended: true as const };
    const prepared = await prepareDocument(new Uint8Array(await getObject(t.version.sourceKey)));
    const pdfKey = `${auth.company.id}/templates/${templateId}/v${t.version.version}/document-${Date.now()}.pdf`;
    await putObject(pdfKey, prepared.pdf, "application/pdf");
    const before = t.version.fields ?? [];
    const fields = before.filter((f) => f.source !== "appended" && f.page <= prepared.pages.length);
    await db.transaction(async (tx) => {
      await tx
        .update(schema.templateVersions)
        .set({ pdfKey, pdfSha256: prepared.pdfSha256, pages: prepared.pages, pageCount: prepared.pages.length, fields, signaturePageAppended: false })
        .where(and(eq(schema.templateVersions.id, t.version.id), eq(schema.templateVersions.companyId, auth.company.id)));
      await tx.update(schema.templates).set({ updatedAt: new Date() }).where(eq(schema.templates.id, templateId));
      await tx.insert(schema.events).values({
        companyId: auth.company.id,
        actorType: "user",
        actorId: auth.user.id,
        actorLabel: auth.user.name,
        type: "template.signature_page_removed",
        data: { templateId, fieldsRemoved: before.length - fields.length },
      });
    });
    await deleteObjects([t.version.pdfKey]).catch(() => undefined);
    return { pageCount: prepared.pages.length, fieldsRemoved: before.length - fields.length };
  });
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

// ---------- editor helpers: firm-side detection, snapping a hand-placed field ----------

/** Page layouts per PDF (immutable per sha), cached per process: detection and snapping reuse them. */
const layoutCache = new Map<string, Promise<Awaited<ReturnType<typeof extractLayout>>>>();
async function templateLayout(auth: AuthContext, templateId: string) {
  const t = await getTemplate(auth, templateId);
  if (!t) return null;
  let p = layoutCache.get(t.version.pdfSha256);
  if (!p) {
    if (layoutCache.size > 20) layoutCache.clear();
    p = getObject(t.version.pdfKey).then((b) => extractLayout(new Uint8Array(b)));
    layoutCache.set(t.version.pdfSha256, p);
    p.catch(() => layoutCache.delete(t.version.pdfSha256));
  }
  return { t, layout: await p };
}

/** "Firm signs too" turned on for the first time: the firm's fields as detection finds them. */
export async function detectFirmFields(auth: AuthContext, templateId: string): Promise<FieldDef[] | null> {
  const r = await templateLayout(auth, templateId);
  if (!r) return null;
  return detectFields(r.layout, { firmName: auth.company.name }).fields.filter((f) => f.roleKey === "firm");
}

export const snapSchema = z.object({ page: z.number().int().min(1), x: num01, y: num01, w: z.number().min(0.005).max(1), h: z.number().min(0.005).max(1), type: z.enum(FIELD_TYPES) });

/** A hand-placed field near a blank snaps onto it; it never sits over printed text. Null = leave it as placed. */
export async function snapField(auth: AuthContext, templateId: string, input: z.infer<typeof snapSchema>) {
  const r = await templateLayout(auth, templateId);
  if (!r) return null;
  return snapPlacement(r.layout[input.page - 1], input);
}

/** The firm finished setting the template up (Done, or created a File): it's no longer a Draft. */
export async function markTemplateDone(auth: AuthContext, templateId: string) {
  if (!z.string().uuid().safeParse(templateId).success) return false;
  const r = await db
    .update(schema.templates)
    .set({ setupDoneAt: new Date() })
    .where(and(eq(schema.templates.id, templateId), eq(schema.templates.companyId, auth.company.id), isNull(schema.templates.setupDoneAt)))
    .returning({ id: schema.templates.id });
  return r.length > 0;
}

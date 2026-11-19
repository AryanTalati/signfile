import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { countersignRequestEmail } from "@/lib/email/templates";
import { recordEmail } from "@/lib/email/outbox";
import type { FieldDef } from "@/lib/fields/types";
import { hasNoSigner } from "@/lib/fields/types";
import { getObject } from "@/lib/storage";
import { signLink } from "./service";

/**
 * Public signing, authorized only by the recipient's link token. Nothing here
 * uses a session: every lookup starts from the token and stays inside that
 * recipient's File and company.
 */

export type SigningState =
  | "sign" // can sign now
  | "signed" // this signer already signed (link opened again)
  | "waiting" // an earlier signer hasn't signed yet
  | "completed" // everyone signed
  | "expired"
  | "voided"
  | "replaced" // forwarded or superseded: this link no longer works
  | "declined"
  | "changes_requested";

const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

export async function loadSigning(token: string) {
  if (!TOKEN.test(token)) return null;
  const [row] = await db
    .select({ recipient: schema.recipients, file: schema.files, company: { id: schema.companies.id, name: schema.companies.name, brandColor: schema.companies.brandColor } })
    .from(schema.recipients)
    .innerJoin(schema.files, and(eq(schema.files.id, schema.recipients.fileId), eq(schema.files.companyId, schema.recipients.companyId)))
    .innerJoin(schema.companies, eq(schema.companies.id, schema.recipients.companyId))
    .where(eq(schema.recipients.token, token))
    .limit(1);
  if (!row) return null;
  const { recipient: r, file } = row;
  let fileStatus = file.status;

  // Lazily expire: past expiry and still out for signature.
  if ((fileStatus === "sent" || fileStatus === "partially_signed") && file.expiresAt && file.expiresAt < new Date()) {
    await db.transaction(async (tx) => {
      const n = await tx
        .update(schema.files)
        .set({ status: "expired", updatedAt: new Date() })
        .where(and(eq(schema.files.id, file.id), inArray(schema.files.status, ["sent", "partially_signed"])))
        .returning({ id: schema.files.id });
      if (n.length) await tx.insert(schema.events).values({ companyId: file.companyId, fileId: file.id, actorType: "system", type: "file.expired", data: { expiresAt: file.expiresAt?.toISOString() } });
    });
    fileStatus = "expired";
  }

  const state: SigningState =
    fileStatus === "voided"
      ? "voided"
      : fileStatus === "expired"
        ? "expired"
        : r.status === "revoked" || r.status === "forwarded" || r.documentId !== file.currentDocumentId
          ? "replaced"
          : r.status === "signed"
            ? fileStatus === "completed"
              ? "completed"
              : "signed"
            : fileStatus === "completed"
              ? "completed"
              : r.status === "declined"
                ? "declined"
                : r.status === "changes_requested"
                  ? "changes_requested"
                  : r.status === "waiting"
                    ? "waiting"
                    : "sign";

  return { state, recipient: r, file: { ...file, status: fileStatus }, company: row.company };
}

export type SigningContext = NonNullable<Awaited<ReturnType<typeof loadSigning>>>;

/** Everything the signing UI needs: document, this signer's fields, values already on the page. */
export async function signingView(ctx: SigningContext) {
  const [doc] = await db.select().from(schema.fileDocuments).where(eq(schema.fileDocuments.id, ctx.recipient.documentId)).limit(1);
  const others = await db
    .select({ roleKey: schema.recipients.roleKey, values: schema.recipients.values, signedAt: schema.recipients.signedAt })
    .from(schema.recipients)
    .where(and(eq(schema.recipients.fileId, ctx.file.id), eq(schema.recipients.documentId, ctx.recipient.documentId), eq(schema.recipients.status, "signed")))
    .orderBy(asc(schema.recipients.signingOrder));
  const mine = doc.fields.filter((f) => f.roleKey === ctx.recipient.roleKey);
  const firmValues = ctx.file.firmValues ?? {};
  // Read-only values shown on the page: firm-filled values + earlier signers' values.
  const shown: Record<string, string> = {};
  for (const f of doc.fields) {
    if (f.type === "firm_fill") shown[f.id] = firmValues[f.firmFillKey ?? f.id] ?? "";
    // agreement_date stays empty until the last party signs (then it's stamped at sealing).
  }
  for (const o of others) for (const [k, v] of Object.entries(o.values ?? {})) shown[k] = String(v);
  const pages = doc.pages.map((p, i) => ({ page: i + 1, width: p.rotation % 180 ? p.height : p.width, height: p.rotation % 180 ? p.width : p.height }));
  const prefill: Record<string, string> = {};
  for (const f of mine) {
    if (f.type === "full_name") prefill[f.id] = ctx.recipient.name;
    if (f.type === "title") prefill[f.id] = ctx.recipient.title ?? "";
    if (f.type === "company") prefill[f.id] = ctx.recipient.roleKey === "firm" ? ctx.company.name : ctx.file.clientLegalName;
  }
  return { documentSha: doc.pdfSha256, pages, fields: doc.fields, mine, shown, prefill };
}

export async function signingPdf(ctx: SigningContext) {
  const [doc] = await db.select({ pdfKey: schema.fileDocuments.pdfKey }).from(schema.fileDocuments).where(eq(schema.fileDocuments.id, ctx.recipient.documentId)).limit(1);
  return getObject(doc.pdfKey);
}

/** First open of an active link: mark viewed (once) and log it. */
export async function markViewed(ctx: SigningContext, meta: { ip: string | null; userAgent: string | null }) {
  if (ctx.state !== "sign" || ctx.recipient.status !== "active") return;
  await db.transaction(async (tx) => {
    const n = await tx
      .update(schema.recipients)
      .set({ status: "viewed", viewedAt: new Date() })
      .where(and(eq(schema.recipients.id, ctx.recipient.id), eq(schema.recipients.status, "active")))
      .returning({ id: schema.recipients.id });
    if (n.length)
      await tx.insert(schema.events).values({
        companyId: ctx.file.companyId,
        fileId: ctx.file.id,
        recipientId: ctx.recipient.id,
        actorType: "recipient",
        actorId: ctx.recipient.id,
        actorLabel: ctx.recipient.name,
        type: "recipient.viewed",
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
  });
}

export const CONSENT_TEXT =
  "I agree to use electronic records and signatures for this agreement, and that my electronic signature is the legal equivalent of my handwritten signature. I can ask for a paper copy, and can withdraw this consent before signing by closing this page.";

export async function recordConsent(ctx: SigningContext, meta: { ip: string | null; userAgent: string | null }) {
  if (ctx.state !== "sign") return false;
  if (ctx.recipient.consentAt) return true;
  await db.transaction(async (tx) => {
    await tx.update(schema.recipients).set({ consentAt: new Date() }).where(eq(schema.recipients.id, ctx.recipient.id));
    await tx.insert(schema.events).values({
      companyId: ctx.file.companyId,
      fileId: ctx.file.id,
      recipientId: ctx.recipient.id,
      actorType: "recipient",
      actorId: ctx.recipient.id,
      actorLabel: ctx.recipient.name,
      type: "recipient.consented",
      data: { text: CONSENT_TEXT },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });
  return true;
}

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

export const submitSchema = z.object({
  values: z.record(z.string(), z.string().max(400_000)),
  timezone: z.string().max(64).optional(),
});

export class SigningError extends Error {}

/**
 * Applies this signer's values and signs. Row-locked so a double submit (link
 * open twice, double click) can't sign twice. Activates the next signer, or
 * completes the File when this was the last one.
 */
export async function submitSigning(
  ctx: SigningContext,
  input: z.infer<typeof submitSchema>,
  meta: { ip: string | null; userAgent: string | null },
  baseUrl: string,
) {
  const view = await signingView(ctx);
  // Defense in depth: the UI only offers this signer's fields, but never trust the client.
  // A value for any other field (another signer's, firm-filled, system) rejects the whole submit.
  const ownIds = new Set(view.mine.filter((f) => !hasNoSigner(f.type)).map((f) => f.id));
  const foreign = Object.keys(input.values).filter((k) => !ownIds.has(k));
  if (foreign.length) throw new SigningError("You can only fill in your own fields.");
  const values: Record<string, string> = {};
  const now = new Date();
  for (const f of view.mine) {
    if (hasNoSigner(f.type)) continue;
    if (f.type === "date_signed") {
      values[f.id] = formatSignedDate(now, input.timezone);
      continue;
    }
    const raw = (input.values[f.id] ?? "").trim();
    if (f.type === "signature" || f.type === "initials") {
      if (raw && !PNG_DATA_URL.test(raw)) throw new SigningError("That signature couldn't be read. Please sign again.");
      if (raw.length > 300_000) throw new SigningError("That signature is too large. Please sign again.");
    } else if (f.type === "checkbox") {
      if (raw && raw !== "true") throw new SigningError("Invalid checkbox value.");
    } else if (raw.length > 300) throw new SigningError(`"${f.label}" is too long.`);
    if (f.required && !raw) throw new SigningError(`Please complete "${f.label}".`);
    if (raw) values[f.id] = raw;
  }

  const tz = input.timezone && /^[A-Za-z_+\-/0-9]{1,64}$/.test(input.timezone) ? input.timezone : null;
  return db.transaction(async (tx) => {
    // Lock this signer's row; re-check state inside the lock.
    const locked = await tx.execute(sql`select status, consent_at from recipients where id = ${ctx.recipient.id} for update`);
    const cur = locked[0] as { status: string; consent_at: Date | null } | undefined;
    if (!cur || (cur.status !== "active" && cur.status !== "viewed")) throw new SigningError("This link has already been used.");
    if (!cur.consent_at) throw new SigningError("Please agree to sign electronically first.");

    await tx
      .update(schema.recipients)
      .set({ status: "signed", signedAt: now, values, ip: meta.ip, userAgent: meta.userAgent, timezone: tz })
      .where(eq(schema.recipients.id, ctx.recipient.id));
    await tx.insert(schema.events).values({
      companyId: ctx.file.companyId,
      fileId: ctx.file.id,
      recipientId: ctx.recipient.id,
      actorType: "recipient",
      actorId: ctx.recipient.id,
      actorLabel: ctx.recipient.name,
      type: "recipient.signed",
      data: { role: ctx.recipient.roleKey, email: ctx.recipient.email, title: ctx.recipient.title, fields: Object.keys(values).length, timezone: tz, documentSha256: view.documentSha },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // Next signer in order, if any.
    const [next] = await tx
      .select()
      .from(schema.recipients)
      .where(and(eq(schema.recipients.fileId, ctx.file.id), eq(schema.recipients.documentId, ctx.recipient.documentId), eq(schema.recipients.status, "waiting")))
      .orderBy(asc(schema.recipients.signingOrder))
      .limit(1);
    if (next) {
      await tx.update(schema.recipients).set({ status: "active" }).where(eq(schema.recipients.id, next.id));
      await tx.update(schema.files).set({ status: "partially_signed", updatedAt: now }).where(eq(schema.files.id, ctx.file.id));
      await tx.insert(schema.events).values({
        companyId: ctx.file.companyId,
        fileId: ctx.file.id,
        recipientId: next.id,
        actorType: "system",
        type: "recipient.activated",
        data: { name: next.name, email: next.email, role: next.roleKey },
      });
      const [t] = ctx.file.templateId ? await tx.select({ name: schema.templates.name }).from(schema.templates).where(eq(schema.templates.id, ctx.file.templateId)) : [];
      const email = countersignRequestEmail({
        brand: { name: ctx.company.name, color: ctx.company.brandColor },
        recipientName: next.name,
        documentName: t?.name ?? "the agreement",
        clientLegalName: ctx.file.clientLegalName,
        link: signLink(baseUrl, next.token),
      });
      await recordEmail(tx, { companyId: ctx.file.companyId, fileId: ctx.file.id, recipientId: next.id, kind: "countersign_request", toEmail: next.email, toName: next.name, ...email });
      return { completed: false, nextName: next.name };
    }

    await tx.update(schema.files).set({ status: "completed", completedAt: now, updatedAt: now }).where(eq(schema.files.id, ctx.file.id));
    await tx.insert(schema.events).values({ companyId: ctx.file.companyId, fileId: ctx.file.id, actorType: "system", type: "file.completed", data: {} });
    return { completed: true, nextName: null };
  });
}

/** "November 20, 2026" in the signer's time zone (falls back to UTC). */
export function formatSignedDate(d: Date, tz?: string | null) {
  try {
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: tz || "UTC" });
  } catch {
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  }
}

export type SigningField = FieldDef;

/**
 * One-click countersign: the logged-in user named on this signer slot signs with their saved
 * signature. Consent is recorded as usual, values are built on the server (saved signature and
 * initials, name/title/company prefilled), then the normal signing path runs (same locks, events).
 * Throws SigningError if a required field can't be filled automatically: the UI falls back.
 */
export async function quickSign(
  ctx: SigningContext,
  user: { id: string; title: string | null },
  saved: { signature: string; initials: string },
  meta: { ip: string | null; userAgent: string | null },
  baseUrl: string,
  timezone?: string,
) {
  if (ctx.state !== "sign") throw new SigningError("This link can't be signed right now.");
  if (!ctx.recipient.userId || ctx.recipient.userId !== user.id) throw new SigningError("Only the countersigner named on this File can use their saved signature.");
  const view = await signingView(ctx);
  const values: Record<string, string> = {};
  for (const f of view.mine) {
    if (hasNoSigner(f.type) || f.type === "date_signed") continue;
    if (f.type === "signature") values[f.id] = saved.signature;
    else if (f.type === "initials") values[f.id] = saved.initials;
    else if (view.prefill[f.id]) values[f.id] = view.prefill[f.id];
    else if (f.type === "title" && user.title) values[f.id] = user.title;
    else if (f.required) throw new SigningError(`"${f.label}" needs to be filled in by hand.`);
  }
  await recordConsent(ctx, meta);
  const fresh = await loadSigning(ctx.recipient.token);
  if (!fresh || fresh.state !== "sign") throw new SigningError("This link can't be signed right now.");
  const out = await submitSigning(fresh, { values, timezone }, meta, baseUrl);
  await db.insert(schema.events).values({
    companyId: ctx.file.companyId,
    fileId: ctx.file.id,
    recipientId: ctx.recipient.id,
    actorType: "user",
    actorId: user.id,
    actorLabel: ctx.recipient.name,
    type: "recipient.signed_with_saved_signature",
    data: {},
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return out;
}

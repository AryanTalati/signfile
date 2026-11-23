import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { db, schema } from "@/lib/db/client";
import { recordEmail } from "@/lib/email/outbox";
import { signedCopyCcEmail } from "@/lib/email/templates";
import { sha256 } from "@/lib/pdf/prepare";
import { deleteObjects, getObject, putObject } from "@/lib/storage";
import { formatFirmValue, formatSignedDate } from "@/lib/fields/format";
import { signedTitle } from "@/lib/fields/signer-details";
import { stampAll } from "@/lib/pdf/stamp";
import { validTimeZone } from "@/lib/time";
import { appendCertificate } from "@/lib/pdf/certificate";

/**
 * Sealing: stamp every value onto the agreement, append the audit certificate,
 * store the final PDF and its SHA-256. Deterministic (no AI, no network beyond
 * storage), runs once per File under a row lock, in the same request as the
 * last signature.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function sealFile(fileId: string, baseUrl: string): Promise<{ finalSha256: string; alreadySealed: boolean }> {
  {
    // Read and build OUTSIDE any transaction: the heavy work (download, layout, stamping,
    // upload) must not hold a pooled connection or a row lock. The short write transaction
    // at the end re-checks under a row lock, so a File is still sealed exactly once.
    const tx = db;
    const [file] = await tx.select().from(schema.files).where(eq(schema.files.id, fileId));
    if (!file) throw new Error("File not found");
    if (file.finalPdfKey && file.finalSha256) return { finalSha256: file.finalSha256, alreadySealed: true };
    if (file.status !== "completed") throw new Error("Only completed Files can be sealed");

    const [doc] = await tx.select().from(schema.fileDocuments).where(eq(schema.fileDocuments.id, file.currentDocumentId!));
    const signers = await tx
      .select()
      .from(schema.recipients)
      .where(and(eq(schema.recipients.fileId, fileId), eq(schema.recipients.documentId, doc.id), eq(schema.recipients.status, "signed")))
      .orderBy(asc(schema.recipients.signingOrder));
    const events = await tx.select().from(schema.events).where(eq(schema.events.fileId, fileId)).orderBy(asc(schema.events.id));
    const [company] = await tx.select({ name: schema.companies.name, timezone: schema.companies.timezone }).from(schema.companies).where(eq(schema.companies.id, file.companyId));
    const [template] = file.templateId ? await tx.select({ name: schema.templates.name }).from(schema.templates).where(eq(schema.templates.id, file.templateId)) : [];

    const original = await getObject(doc.pdfKey);
    if (sha256(original) !== doc.pdfSha256) throw new Error("Stored agreement doesn't match its recorded SHA-256; refusing to seal");

    const pdf = await PDFDocument.load(original, { updateMetadata: false });
    // Flatten any existing form so nothing stays editable in the sealed copy.
    try {
      pdf.getForm().flatten();
    } catch {
      /* no form */
    }
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const dingbats = await pdf.embedFont(StandardFonts.ZapfDingbats);

    // Values for every field: signers' own, firm-filled, and the agreement date.
    const lastSigner = signers.at(-1);
    const completedAt = file.completedAt ?? new Date();
    const values: Record<string, string> = {};
    for (const s of signers) Object.assign(values, s.values ?? {});
    for (const f of doc.fields) {
      if (f.type === "firm_fill") values[f.id] = formatFirmValue((file.firmValues ?? {})[f.firmFillKey ?? f.id] ?? "");
      if (f.type === "agreement_date") values[f.id] = formatSignedDate(completedAt, lastSigner?.timezone);
    }
    const [serif, mono] = await Promise.all([pdf.embedFont(StandardFonts.TimesRoman), pdf.embedFont(StandardFonts.Courier)]);
    await stampAll(pdf, original, doc.pages, doc.fields, values, { font, dingbats, serif, mono });

    // Automatic countersigns: when the signer authorized them (their consent to sign).
    const autoAuthorized = new Map<string, Date>();
    for (const e of events)
      if (e.type === "recipient.auto_countersigned" && e.recipientId && typeof e.data?.authorizedAt === "string") autoAuthorized.set(e.recipientId, new Date(e.data.authorizedAt));
    await appendCertificate(pdf, {
      font,
      bold,
      fileId,
      documentName: template?.name ?? doc.sourceFilename,
      firm: company?.name ?? "",
      client: file.clientLegalName,
      reference: file.reference,
      completedAt,
      firmTimezone: validTimeZone(company?.timezone),
      sourceSha256: doc.sourceSha256,
      documentSha256: doc.pdfSha256,
      documentVersion: doc.versionNo,
      verifyUrl: `${baseUrl}/verify`,
      signers: signers.map((s) => ({
        autoAuthorizedAt: autoAuthorized.get(s.id) ?? null,
        name: s.name,
        email: s.email,
        title: signedTitle(doc.fields, s.roleKey, s.values ?? {}),
        role: s.roleKey === "firm" ? `Signed for ${company?.name ?? "the firm"}` : `Signed for ${file.clientLegalName}`,
        ip: s.ip,
        userAgent: s.userAgent,
        timezone: s.timezone,
        consentAt: s.consentAt,
        signedAt: s.signedAt,
        signature: Object.entries(s.values ?? {}).find(([k, val]) => typeof val === "string" && val.startsWith("data:image/png") && doc.fields.find((x) => x.id === k)?.type === "signature")?.[1] as string | undefined,
      })),
      events: eventsForSignedVersion(events).map((e) => ({ at: e.createdAt, type: e.type, actor: e.actorLabel ?? e.actorType, ip: e.ip, data: e.data })),
    });

    pdf.setTitle(`${template?.name ?? "Agreement"} (signed)`);
    pdf.setProducer("signfile");
    pdf.setModificationDate(completedAt);
    const final = await pdf.save();
    const finalSha256 = sha256(final);
    const finalKey = `${file.companyId}/files/${fileId}/final/signed-${fileId}-${Date.now().toString(36)}.pdf`;
    await putObject(finalKey, final, "application/pdf");
    const pageCount = pdf.getPageCount();

    return db.transaction(async (wtx) => {
      const [cur] = await wtx.select().from(schema.files).where(eq(schema.files.id, fileId)).for("update");
      if (cur.finalPdfKey && cur.finalSha256) {
        // Someone else sealed it meanwhile: keep theirs, discard ours.
        await deleteObjects([finalKey]).catch(() => undefined);
        return { finalSha256: cur.finalSha256, alreadySealed: true };
      }
      await wtx.update(schema.files).set({ finalPdfKey: finalKey, finalSha256, updatedAt: new Date() }).where(and(eq(schema.files.id, fileId), isNull(schema.files.finalPdfKey)));
      await wtx.insert(schema.events).values({ companyId: file.companyId, fileId, actorType: "system", type: "file.sealed", data: { finalSha256, pages: pageCount, documentSha256: doc.pdfSha256 } });
      await emailSignedCopy(wtx, { file, signers, firm: company?.name ?? "", documentName: template?.name ?? "the agreement", finalKey, baseUrl });
      return { finalSha256, alreadySealed: false };
    });
  }
}

// ---------- signed-copy emails ----------

async function emailSignedCopy(
  tx: Tx,
  o: { file: typeof schema.files.$inferSelect; signers: (typeof schema.recipients.$inferSelect)[]; firm: string; documentName: string; finalKey: string; baseUrl: string },
) {
  for (const s of o.signers) {
    const link = `${o.baseUrl}/api/sign/${s.token}/download`;
    await recordEmail(tx, {
      companyId: o.file.companyId,
      fileId: o.file.id,
      recipientId: s.id,
      kind: "signed_copy",
      toEmail: s.email,
      toName: s.name,
      subject: `Signed: "${o.documentName}"`,
      html: `<p>Hi ${s.name.split(" ")[0]},</p><p>Everyone has signed <strong>${o.documentName}</strong> (${o.firm} and ${o.file.clientLegalName}). The signed copy with its certificate of completion is attached, and you can also <a href="${link}">download it here</a>.</p>`,
      text: `Everyone has signed "${o.documentName}". The signed copy is attached. Download it again: ${link}`,
      attachments: [{ filename: `${o.documentName} - signed.pdf`.replace(/[^\w .()-]+/g, "_"), storageKey: o.finalKey }],
    });
  }
  // "Send the signed copy to": the same email and PDF, no link (they have no signing token).
  const cc = o.file.ccEmails ?? [];
  if (!cc.length) return;
  const mail = signedCopyCcEmail({ documentName: o.documentName, firm: o.firm, clientLegalName: o.file.clientLegalName });
  for (const to of cc)
    await recordEmail(tx, {
      companyId: o.file.companyId,
      fileId: o.file.id,
      kind: "signed_copy_cc",
      toEmail: to,
      ...mail,
      attachments: [{ filename: `${o.documentName} - signed.pdf`.replace(/[^\w .()-]+/g, "_"), storageKey: o.finalKey }],
    });
  await tx.insert(schema.events).values({ companyId: o.file.companyId, fileId: o.file.id, actorType: "system", type: "file.signed_copy_cc", data: { to: cc } });
}

export async function getFinalPdf(file: { finalPdfKey: string | null }) {
  return file.finalPdfKey ? getObject(file.finalPdfKey) : null;
}

/**
 * The certificate describes only the version that was signed: events from the last
 * revision onward (plus the File's creation). Earlier versions stay in the File's timeline.
 */
function eventsForSignedVersion<T extends { id: number; type: string }>(events: T[]): T[] {
  const lastRevision = [...events].reverse().find((e) => e.type === "file.revised");
  if (!lastRevision) return events;
  return events.filter((e) => e.type === "file.created" || e.id >= lastRevision.id);
}

import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { PDFDocument, PDFFont, rgb, StandardFonts } from "pdf-lib";
import { db, schema } from "@/lib/db/client";
import { recordEmail } from "@/lib/email/outbox";
import { sha256 } from "@/lib/pdf/prepare";
import { deleteObjects, getObject, putObject } from "@/lib/storage";
import { formatFirmValue, formatSignedDate } from "@/lib/fields/format";
import { signedTitle } from "@/lib/fields/signer-details";
import { stampAll } from "@/lib/pdf/stamp";
import { utcAndLocal, validTimeZone } from "@/lib/time";
import { eventLabel } from "./event-labels";

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
        viewedAt: s.viewedAt,
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

// ---------- certificate ----------

interface CertSigner {
  name: string;
  email: string;
  title: string | null;
  role: string;
  ip: string | null;
  userAgent: string | null;
  timezone: string | null;
  consentAt: Date | null;
  viewedAt: Date | null;
  signedAt: Date | null;
  /** Set for an automatic countersign: when the signer authorized it. */
  autoAuthorizedAt: Date | null;
  signature?: string;
}

/** UTC first, then local time in `tz` ("2026-11-20 23:19:37 UTC / Nov 20, 2026, 4:19:37 PM MST"). */
const when = (d: Date | null, tz: string | null) => (d ? utcAndLocal(d, tz) : "-");

async function appendCertificate(
  pdf: PDFDocument,
  c: {
    font: PDFFont;
    bold: PDFFont;
    fileId: string;
    documentName: string;
    firm: string;
    client: string;
    reference: string | null;
    completedAt: Date;
    /** Shown next to UTC for the completion time, the event log and signers without their own zone. */
    firmTimezone: string | null;
    sourceSha256: string;
    documentSha256: string;
    documentVersion: number;
    verifyUrl: string;
    signers: CertSigner[];
    events: { at: Date; type: string; actor: string; ip: string | null; data: Record<string, unknown> }[];
  },
) {
  const W = 612, H = 792, M = 54;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const grey = rgb(0.38, 0.38, 0.38);
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const ensure = (h: number) => {
    if (y - h < M) newPage();
  };
  const text = (s: string, x: number, size = 9, f = c.font, color = rgb(0, 0, 0)) => page.drawText(s, { x, y: y - size, size, font: f, color });
  const row = (label: string, value: string) => {
    for (const [i, line] of wrapText(value, c.font, 9, W - 2 * M - 150).entries()) {
      ensure(13);
      if (i === 0) text(label, M, 9, c.bold, grey);
      text(line, M + 150, 9);
      y -= 13;
    }
  };

  text("Certificate of Completion", M, 18, c.bold);
  y -= 26;
  text("This certificate is part of the signed document above. It records who signed, when, and how.", M, 9, c.font, grey);
  y -= 22;
  row("File ID", c.fileId);
  row("Document", `${c.documentName} (version ${c.documentVersion})`);
  row("Between", `${c.firm} and ${c.client}`);
  if (c.reference) row("Reference", c.reference);
  row("Status", `Completed ${when(c.completedAt, c.firmTimezone)}`);
  row("Source file SHA-256", c.sourceSha256);
  row("Agreement PDF SHA-256", c.documentSha256);
  row("Signed PDF SHA-256", `Recorded when sealed; check this file at ${c.verifyUrl}`);
  y -= 8;

  for (const s of c.signers) {
    ensure(150);
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 14;
    text(s.name, M, 11, c.bold);
    y -= 15;
    row("Role", s.role);
    row("Email", s.email);
    if (s.title) row("Title", s.title);
    // Each signer's own browser time zone; the firm's for signers without one.
    const tz = s.timezone ?? c.firmTimezone;
    if (s.autoAuthorizedAt) {
      // Signed by the system on their standing instruction: say so, and show where and when they gave it.
      const at = s.autoAuthorizedAt;
      row("Method", "Automatic countersign using saved signature");
      row("Authorized", [when(at, tz), `IP ${s.ip ?? "not recorded"}`, `browser ${(s.userAgent ?? "not recorded").slice(0, 200)}`].join(", "));
      row("Agreed to e-sign", when(at, tz));
      row("Signed", when(s.signedAt, tz));
      if (tz) row("Time zone", `${tz} (${c.firm}'s time zone)`);
    } else {
      row("Agreed to e-sign", when(s.consentAt, tz));
      row("Signed", when(s.signedAt, tz));
      if (tz) row("Time zone", s.timezone ? `${s.timezone} (their browser at signing)` : `${tz} (${c.firm}'s time zone)`);
      row("IP address", s.ip ?? "not recorded");
      row("Browser", (s.userAgent ?? "not recorded").slice(0, 220));
    }
    if (s.signature) {
      const img = await pdf.embedPng(Buffer.from(s.signature.split(",")[1], "base64"));
      const scale = Math.min(180 / img.width, 36 / img.height);
      ensure(44);
      text("Signature", M, 9, c.bold, grey);
      page.drawImage(img, { x: M + 150, y: y - img.height * scale, width: img.width * scale, height: img.height * scale });
      y -= Math.max(img.height * scale, 12) + 8;
    }
    y -= 6;
  }

  ensure(40);
  y -= 6;
  text(c.firmTimezone ? `Event log (UTC / ${c.firmTimezone})` : "Event log (UTC)", M, 11, c.bold);
  y -= 18;
  for (const e of c.events) {
    // The revision note can quote the earlier version's change request: it stays in the audit
    // trail and timeline, but the certificate describes only the signed version.
    const data = e.type === "file.revised" ? { ...e.data, note: null } : e.data;
    const line = `${when(e.at, c.firmTimezone)}  ${eventLabel({ type: e.type, actorLabel: e.actor, data })}${e.ip ? `  ·  IP ${e.ip}` : ""}`;
    for (const l of wrapText(line, c.font, 8, W - 2 * M)) {
      ensure(11);
      text(l, M, 8);
      y -= 11;
    }
  }
}

function wrapText(s: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > max && line) {
      out.push(line);
      line = word;
    } else line = next;
    // Hard-break very long tokens (hashes, user agents).
    while (font.widthOfTextAtSize(line, size) > max) {
      let i = line.length;
      while (i > 1 && font.widthOfTextAtSize(line.slice(0, i), size) > max) i--;
      out.push(line.slice(0, i));
      line = line.slice(i);
    }
  }
  if (line) out.push(line);
  return out;
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

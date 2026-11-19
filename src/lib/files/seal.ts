import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { degrees, PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
import { db, schema } from "@/lib/db/client";
import { recordEmail } from "@/lib/email/outbox";
import type { FieldDef, PageInfo } from "@/lib/fields/types";
import { sha256 } from "@/lib/pdf/prepare";
import { getObject, putObject } from "@/lib/storage";
import { formatSignedDate } from "./signing";

/**
 * Sealing: stamp every value onto the agreement, append the audit certificate,
 * store the final PDF and its SHA-256. Deterministic (no AI, no network beyond
 * storage), runs once per File under a row lock, in the same request as the
 * last signature.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function sealFile(fileId: string, baseUrl: string): Promise<{ finalSha256: string; alreadySealed: boolean }> {
  return db.transaction(async (tx) => {
    // Lock the File row: concurrent completions/downloads can't seal twice.
    const [file] = await tx.select().from(schema.files).where(eq(schema.files.id, fileId)).for("update");
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
    const [company] = await tx.select({ name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, file.companyId));
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
      if (f.type === "firm_fill") values[f.id] = (file.firmValues ?? {})[f.firmFillKey ?? f.id] ?? "";
      if (f.type === "agreement_date") values[f.id] = formatSignedDate(completedAt, lastSigner?.timezone);
    }
    const pages = pdf.getPages();
    for (const f of doc.fields) {
      const v = values[f.id];
      if (!v) continue;
      const page = pages[f.page - 1];
      if (!page) continue;
      await stampField(pdf, page, doc.pages[f.page - 1], f, v, { font, dingbats });
    }

    await appendCertificate(pdf, {
      font,
      bold,
      fileId,
      documentName: template?.name ?? doc.sourceFilename,
      firm: company?.name ?? "",
      client: file.clientLegalName,
      reference: file.reference,
      completedAt,
      sourceSha256: doc.sourceSha256,
      documentSha256: doc.pdfSha256,
      documentVersion: doc.versionNo,
      verifyUrl: `${baseUrl}/verify`,
      signers: signers.map((s) => ({
        name: s.name,
        email: s.email,
        title: s.title,
        role: s.roleKey === "firm" ? `Signed for ${company?.name ?? "the firm"}` : `Signed for ${file.clientLegalName}`,
        ip: s.ip,
        userAgent: s.userAgent,
        timezone: s.timezone,
        consentAt: s.consentAt,
        viewedAt: s.viewedAt,
        signedAt: s.signedAt,
        signature: Object.entries(s.values ?? {}).find(([k, val]) => typeof val === "string" && val.startsWith("data:image/png") && doc.fields.find((x) => x.id === k)?.type === "signature")?.[1] as string | undefined,
      })),
      events: events.map((e) => ({ at: e.createdAt, type: e.type, actor: e.actorLabel ?? e.actorType, ip: e.ip })),
    });

    pdf.setTitle(`${template?.name ?? "Agreement"} (signed)`);
    pdf.setProducer("signfile");
    pdf.setModificationDate(completedAt);
    const final = await pdf.save();
    const finalSha256 = sha256(final);
    const finalKey = `${file.companyId}/files/${fileId}/final/signed-${fileId}.pdf`;
    await putObject(finalKey, final, "application/pdf");

    await tx.update(schema.files).set({ finalPdfKey: finalKey, finalSha256, updatedAt: new Date() }).where(and(eq(schema.files.id, fileId), isNull(schema.files.finalPdfKey)));
    await tx.insert(schema.events).values({ companyId: file.companyId, fileId, actorType: "system", type: "file.sealed", data: { finalSha256, pages: pdf.getPageCount(), documentSha256: doc.pdfSha256 } });
    await emailSignedCopy(tx, { file, signers, firm: company?.name ?? "", documentName: template?.name ?? "the agreement", finalKey, baseUrl });
    return { finalSha256, alreadySealed: false };
  });
}

// ---------- stamping ----------

/** Maps a point on the displayed page (top-left origin, points) to PDF user space for the page's rotation. */
function toUser(info: PageInfo, dx: number, dy: number): [number, number] {
  const { width: w, height: h } = info;
  switch (info.rotation) {
    case 90:
      return [dy, dx];
    case 180:
      return [w - dx, dy];
    case 270:
      return [w - dy, h - dx];
    default:
      return [dx, h - dy];
  }
}

async function stampField(pdf: PDFDocument, page: PDFPage, info: PageInfo, f: FieldDef, value: string, fonts: { font: PDFFont; dingbats: PDFFont }) {
  const W = info.rotation % 180 ? info.height : info.width; // displayed size
  const H = info.rotation % 180 ? info.width : info.height;
  const bx = f.x * W, by = f.y * H, bw = f.w * W, bh = f.h * H;
  const rot = degrees(info.rotation);

  if (value.startsWith("data:image/png")) {
    const img = await pdf.embedPng(Buffer.from(value.split(",")[1], "base64"));
    const scale = Math.min(bw / img.width, bh / img.height);
    const iw = img.width * scale, ih = img.height * scale;
    // Bottom-left of the image, in displayed space: rests on the field's line.
    const [x, y] = toUser(info, bx, by + bh);
    page.drawImage(img, { x, y, width: iw, height: ih, rotate: rot });
    return;
  }
  if (f.type === "checkbox") {
    if (value !== "true") return;
    const size = Math.min(bh, bw) * 0.9;
    const [x, y] = toUser(info, bx + (bw - size * 0.8) / 2, by + bh - (bh - size) / 2 - size * 0.1);
    page.drawText("4", { x, y, size, font: fonts.dingbats, rotate: rot }); // ✔ in ZapfDingbats
    return;
  }
  // Text: rests on the line, ≤ 11 pt, shrinks to fit the box width.
  let size = Math.min(bh * 0.8, 11);
  const text = value.replace(/\s+/g, " ").trim();
  while (size > 5 && fonts.font.widthOfTextAtSize(text, size) > bw - 2) size -= 0.5;
  const baseline = by + bh - Math.max(1.5, size * 0.2);
  const [x, y] = toUser(info, bx + 1, baseline);
  page.drawText(fit(text, fonts.font, size, bw - 2), { x, y, size, font: fonts.font, rotate: rot, color: rgb(0.05, 0.05, 0.1) });
}

function fit(text: string, font: PDFFont, size: number, max: number) {
  if (font.widthOfTextAtSize(text, size) <= max) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > max) t = t.slice(0, -1);
  return t + "…";
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
  signature?: string;
}

const utc = (d: Date | null) => (d ? d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC") : "-");
function local(d: Date | null, tz: string | null) {
  if (!d || !tz) return "";
  try {
    return `${d.toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "long" })} (${tz})`;
  } catch {
    return "";
  }
}

const EVENT_TEXT: Record<string, string> = {
  "file.created": "File created",
  "file.sent": "Sent for signature",
  "recipient.viewed": "Opened the signing link",
  "recipient.consented": "Agreed to sign electronically (ESIGN/UETA)",
  "recipient.signed": "Signed",
  "recipient.signed_with_saved_signature": "Used their saved signature",
  "recipient.activated": "Next signer's link activated",
  "file.completed": "All parties signed",
  "file.expired": "Links expired",
};

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
    sourceSha256: string;
    documentSha256: string;
    documentVersion: number;
    verifyUrl: string;
    signers: CertSigner[];
    events: { at: Date; type: string; actor: string; ip: string | null }[];
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
  row("Status", `Completed ${utc(c.completedAt)}`);
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
    row("Agreed to e-sign", [utc(s.consentAt), local(s.consentAt, s.timezone)].filter(Boolean).join(" / "));
    row("Signed", [utc(s.signedAt), local(s.signedAt, s.timezone)].filter(Boolean).join(" / "));
    row("IP address", s.ip ?? "not recorded");
    row("Browser", (s.userAgent ?? "not recorded").slice(0, 220));
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
  text("Event log (UTC)", M, 11, c.bold);
  y -= 18;
  for (const e of c.events) {
    const line = `${utc(e.at)}  ${EVENT_TEXT[e.type] ?? e.type}  ·  ${e.actor}${e.ip ? `  ·  IP ${e.ip}` : ""}`;
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
      text: `Everyone has signed "${o.documentName}". Download the signed copy: ${link}`,
    });
  }
  void o.finalKey;
}

export async function getFinalPdf(file: { finalPdfKey: string | null }) {
  return file.finalPdfKey ? getObject(file.finalPdfKey) : null;
}

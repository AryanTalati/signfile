/**
 * Turns an uploaded agreement (PDF, DOCX, DOC, ODT, RTF) into the PDF that
 * signers will see, or rejects it with a clear, user-facing reason.
 *
 *   sniff type (magic bytes, not the extension) -> size limit -> convert
 *   office docs with LibreOffice -> reject password-protected PDFs -> strip
 *   permission-only encryption with qpdf -> repair malformed PDFs with qpdf
 *   -> read page sizes and rotation.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { PageInfo } from "@/lib/fields/types";
import { convertToPdf, ConversionError } from "./convert";
import { loadPdf } from "./extract";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PAGES = 300;

export type UploadErrorCode = "too_large" | "unsupported_type" | "empty" | "encrypted" | "unreadable" | "too_many_pages" | "conversion_failed";

export class UploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export type SourceKind = "pdf" | "docx" | "doc" | "odt" | "rtf";

export interface PreparedDocument {
  pdf: Uint8Array;
  pdfSha256: string;
  source: { kind: SourceKind; mime: string; sha256: string; bytes: number };
  pages: PageInfo[];
  notes: string[];
  conversionMs?: number;
}

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const MIME: Record<SourceKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
};

export function sniff(bytes: Uint8Array): SourceKind | null {
  const head = Buffer.from(bytes.subarray(0, 2048));
  if (head.includes(Buffer.from("%PDF-"))) return "pdf";
  if (head[0] === 0x50 && head[1] === 0x4b) {
    // ZIP: DOCX has word/ parts; ODT declares its mimetype.
    const s = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 64 * 1024))).toString("latin1");
    if (s.includes("application/vnd.oasis.opendocument.text")) return "odt";
    if (s.includes("word/") || s.includes("[Content_Types].xml")) return "docx";
    return null;
  }
  if (head.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "doc";
  if (head.subarray(0, 5).toString() === "{\\rtf") return "rtf";
  return null;
}

const DAMAGED = "We couldn't read that PDF. It may be damaged. Try exporting it again from the original app.";

export async function prepareDocument(input: Uint8Array): Promise<PreparedDocument> {
  if (!input.length) throw new UploadError("empty", "That file is empty.");
  if (input.length > MAX_UPLOAD_BYTES) throw new UploadError("too_large", `That file is ${(input.length / 1048576).toFixed(1)} MB. The limit is 25 MB.`);
  const kind = sniff(input);
  if (!kind) throw new UploadError("unsupported_type", "Upload a PDF or Word document (.pdf, .docx, .doc, .odt or .rtf).");

  const notes: string[] = [];
  let pdf = input;
  let conversionMs: number | undefined;
  if (kind !== "pdf") {
    try {
      const r = await convertToPdf(Buffer.from(input), kind);
      pdf = new Uint8Array(r.pdf);
      conversionMs = r.durationMs;
      notes.push(`Converted from ${kind.toUpperCase()} in ${(r.durationMs / 1000).toFixed(1)} s.`);
    } catch (e) {
      const detail = e instanceof ConversionError ? e.message : String(e);
      throw new UploadError("conversion_failed", `We couldn't convert that document to PDF. If it's password-protected, remove the password and try again. (${detail})`);
    }
  }

  // 1. Can it be opened at all? pdf.js tells us if a password is required.
  let numPages: number;
  try {
    const doc = await loadPdf(pdf);
    numPages = doc.numPages;
    await doc.loadingTask.destroy();
  } catch (e) {
    if ((e as Error)?.name === "PasswordException")
      throw new UploadError("encrypted", "This PDF is password-protected. Remove the password (open it and save a copy without one), then upload it again.");
    const repaired = await qpdf(pdf, []).catch(() => null);
    if (!repaired) throw new UploadError("unreadable", DAMAGED);
    pdf = repaired;
    notes.push("Repaired a damaged PDF structure.");
    const doc = await loadPdf(pdf).catch(() => {
      throw new UploadError("unreadable", DAMAGED);
    });
    numPages = doc.numPages;
    await doc.loadingTask.destroy();
  }
  if (numPages > MAX_PAGES) throw new UploadError("too_many_pages", `That document has ${numPages} pages. The limit is ${MAX_PAGES}.`);
  if (numPages < 1) throw new UploadError("unreadable", "That PDF has no pages.");

  // 2. Opens without a password but encrypted (permission restrictions): strip them so it can be stamped.
  let lib: PDFDocument;
  try {
    lib = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch (e) {
    if ((e as Error)?.name === "EncryptedPDFError" || /encrypt/i.test(String((e as Error)?.message))) {
      try {
        pdf = await qpdf(pdf, ["--decrypt"]);
      } catch (err) {
        throw new UploadError("encrypted", `This PDF has security restrictions we couldn't remove. Save an unrestricted copy and upload that. (${(err as Error).message})`);
      }
      notes.push("Removed permission restrictions (the PDF had no open password).");
    } else {
      pdf = await qpdf(pdf, []).catch(() => {
        throw new UploadError("unreadable", DAMAGED);
      });
      notes.push("Repaired a damaged PDF structure.");
    }
    lib = await PDFDocument.load(pdf, { updateMetadata: false });
  }

  const pages: PageInfo[] = lib.getPages().map((p) => {
    const { width, height } = p.getSize();
    const r = ((p.getRotation().angle % 360) + 360) % 360;
    return { width, height, rotation: ([0, 90, 180, 270].includes(r) ? r : 0) as PageInfo["rotation"] };
  });

  return {
    pdf,
    pdfSha256: sha256(pdf),
    source: { kind, mime: MIME[kind], sha256: sha256(input), bytes: input.length },
    pages,
    notes,
    conversionMs,
  };
}

/** Runs qpdf on a buffer and returns the output PDF. */
async function qpdf(input: Uint8Array, args: string[]): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "qpdf-"));
  try {
    const src = path.join(dir, "in.pdf");
    const out = path.join(dir, "out.pdf");
    await writeFile(src, input);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.env.QPDF_PATH || "qpdf", [...args, src, out], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      child.stderr.on("data", (d) => (err += d));
      const t = setTimeout(() => child.kill("SIGKILL"), 30_000);
      child.on("error", (e) => {
        clearTimeout(t);
        reject(new Error(`qpdf unavailable: ${e.message}`));
      });
      // qpdf exits 3 for "succeeded with warnings" (typical for repairs).
      child.on("close", (code) => {
        clearTimeout(t);
        if (code === 0 || code === 3) resolve();
        else reject(new Error(err.trim().split("\n").pop() || `qpdf exited ${code}`));
      });
    });
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

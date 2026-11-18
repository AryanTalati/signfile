/**
 * Small text-layout helper on top of pdf-lib for generating test agreements.
 * Coordinates are pdf-lib's (origin bottom-left, points).
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, degrees } from "pdf-lib";

export const LETTER: [number, number] = [612, 792];
/** Fixed metadata date so regenerated fixtures are byte-identical. */
export const FIXED_DATE = new Date("2026-01-01T00:00:00Z");
export const A4: [number, number] = [595.28, 841.89];

export class Writer {
  page!: PDFPage;
  y = 0;
  font!: PDFFont;
  bold!: PDFFont;
  pageNo = 0;
  onNewPage?: (w: Writer) => void;

  private constructor(
    readonly doc: PDFDocument,
    readonly size: [number, number],
    readonly margin: number,
  ) {}

  static async create(opts: { size?: [number, number]; margin?: number; serif?: boolean } = {}) {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.setCreationDate(FIXED_DATE);
    doc.setModificationDate(FIXED_DATE);
    const w = new Writer(doc, opts.size ?? LETTER, opts.margin ?? 72);
    w.font = await doc.embedFont(opts.serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
    w.bold = await doc.embedFont(opts.serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
    doc.setTitle("Test agreement (generated)");
    doc.setProducer("signfile test generator");
    w.newPage();
    return w;
  }

  get width() {
    return this.size[0] - 2 * this.margin;
  }

  newPage() {
    this.page = this.doc.addPage(this.size);
    this.pageNo++;
    this.y = this.size[1] - this.margin;
    this.onNewPage?.(this);
  }

  ensure(h: number) {
    if (this.y - h < this.margin + 30) this.newPage();
  }

  gap(h: number) {
    this.y -= h;
  }

  wrap(text: string, size: number, font = this.font, maxWidth = this.width): string[] {
    const lines: string[] = [];
    for (const para of text.split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }

  para(text: string, opts: { size?: number; bold?: boolean; align?: "left" | "center"; after?: number; indent?: number } = {}) {
    const size = opts.size ?? 10.5;
    const font = opts.bold ? this.bold : this.font;
    const indent = opts.indent ?? 0;
    for (const line of this.wrap(text, size, font, this.width - indent)) {
      this.ensure(size * 1.4);
      const tw = font.widthOfTextAtSize(line, size);
      const x = opts.align === "center" ? this.margin + (this.width - tw) / 2 : this.margin + indent;
      this.page.drawText(line, { x, y: this.y - size, size, font });
      this.y -= size * 1.4;
    }
    this.y -= opts.after ?? 6;
  }

  heading(text: string, size = 12) {
    this.ensure(size * 3);
    this.gap(6);
    this.para(text, { size, bold: true, after: 4 });
  }

  /** Text at an absolute position on the current page. */
  text(s: string, x: number, y: number, opts: { size?: number; bold?: boolean; rotate?: number } = {}) {
    this.page.drawText(s, {
      x,
      y,
      size: opts.size ?? 10,
      font: opts.bold ? this.bold : this.font,
      rotate: opts.rotate ? degrees(opts.rotate) : undefined,
    });
  }

  /** A vector line (not text): what many real PDFs use for signature lines. */
  line(x1: number, y1: number, x2: number, y2: number, thickness = 0.75) {
    this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color: rgb(0, 0, 0) });
  }

  rect(x: number, y: number, w: number, h: number) {
    this.page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: 0.75 });
  }
}

const CLAUSE_TEXT = [
  "Each party shall perform its obligations under this Agreement diligently, in a professional manner and in accordance with generally accepted industry standards. Each party shall promptly notify the other of any circumstance likely to delay or prevent performance.",
  "Neither party shall be liable for any failure or delay caused by events beyond its reasonable control, provided it gives prompt notice and uses reasonable efforts to resume performance.",
  "All amounts are exclusive of applicable taxes. Undisputed invoices are payable within thirty (30) days of receipt. Disputed amounts shall be notified in writing within fifteen (15) days, with reasons.",
  "Each party shall keep the other party's Confidential Information confidential and use it only to perform this Agreement. This obligation survives for three (3) years after termination.",
  "Upon payment in full, the Provider assigns to the Customer all rights in the Deliverables, excluding the Provider's pre-existing materials, tools and know-how, which are licensed to the Customer on a non-exclusive, perpetual basis.",
  "Except for breaches of confidentiality or indemnity obligations, each party's aggregate liability is limited to the fees paid in the twelve (12) months preceding the claim.",
  "This Agreement is governed by the laws of the State of Delaware. Any dispute shall first be escalated to senior management of each party for good-faith resolution for thirty (30) days.",
];

export const CLAUSE_TITLES = [
  "Services",
  "Force Majeure",
  "Fees and Invoicing",
  "Confidentiality",
  "Intellectual Property",
  "Limitation of Liability",
  "Governing Law",
  "Term and Termination",
  "Non-Solicitation",
  "Data Protection",
  "Insurance",
  "Notices",
  "Assignment",
  "Entire Agreement",
];

/** Deterministic boilerplate clause text so fixtures are stable across runs. */
export function clause(i: number): string {
  return CLAUSE_TEXT[i % CLAUSE_TEXT.length];
}

export function clauses(w: Writer, n: number, start = 0) {
  for (let i = 0; i < n; i++) {
    const k = start + i;
    w.heading(`${k + 1}. ${CLAUSE_TITLES[k % CLAUSE_TITLES.length]}`, 11);
    w.para(`${k + 1}.1 ${clause(k)}`);
    w.para(`${k + 1}.2 ${clause(k + 3)}`);
  }
}

/** DOCX test agreements (converted to PDF by LibreOffice at upload time). */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { CLAUSE_TITLES, clause } from "./layout";

const p = (text: string, opts: { bold?: boolean; after?: number; before?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
  new Paragraph({
    alignment: opts.align,
    spacing: { after: opts.after ?? 160, before: opts.before ?? 0 },
    children: [new TextRun({ text, bold: opts.bold })],
  });

const clauseParas = (n: number, style: "numbered" | "roman" = "numbered") =>
  Array.from({ length: n }, (_, i) => {
    const label = style === "roman" ? `${toRoman(i + 1)}.` : `${i + 1}.`;
    return [
      new Paragraph({ heading: HeadingLevel.HEADING_2, text: `${label} ${CLAUSE_TITLES[i]}` }),
      p(clause(i)),
      p(clause(i + 2)),
    ];
  }).flat();

function toRoman(n: number) {
  const map: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
  return s;
}

const bordered = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
};

const tc = (text: string, opts: { bold?: boolean; width?: number; height?: number; span?: number } = {}) =>
  new TableCell({
    width: { size: opts.width ?? 25, type: WidthType.PERCENTAGE },
    columnSpan: opts.span,
    children: [
      new Paragraph({
        spacing: { before: 60, after: opts.height ?? 60 },
        children: [new TextRun({ text, bold: opts.bold })],
      }),
    ],
  });

/**
 * Signature blocks as a bordered 4-column table: label | empty cell | label | empty cell.
 * No underscores anywhere: the "line" is a table cell border.
 */
export async function docxTableBlocks(firm: string, client: string) {
  const sigRow = (label: string, tall = false) =>
    new TableRow({
      children: [tc(label, { width: 18 }), tc("", { width: 32, height: tall ? 600 : 60 }), tc(label, { width: 18 }), tc("", { width: 32, height: tall ? 600 : 60 })],
    });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, text: "Client Services Agreement" }),
        p(`This agreement is made between ${firm} (the "Provider") and ${client} (the "Client"). TEST DOCUMENT - NOT A REAL AGREEMENT.`),
        ...clauseParas(8),
        new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Schedule 1 - Fees" }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: bordered,
          rows: [
            new TableRow({ children: [tc("Phase", { bold: true, width: 50 }), tc("Fee (USD)", { bold: true, width: 50 })] }),
            new TableRow({ children: [tc("Discovery & data audit", { width: 50 }), tc("6,000", { width: 50 })] }),
            new TableRow({ children: [tc("Agent build & integration", { width: 50 }), tc("18,000", { width: 50 })] }),
            new TableRow({ children: [tc("Managed support (monthly)", { width: 50 }), tc("2,500", { width: 50 })] }),
          ],
        }),
        p("EXECUTION", { bold: true, before: 400 }),
        p("Executed by the authorised representatives of the parties on the dates written below."),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: bordered,
          rows: [
            new TableRow({ children: [tc(`For and on behalf of ${firm.toUpperCase()}`, { bold: true, span: 2, width: 50 }), tc(`For and on behalf of the CLIENT, ${client}`, { bold: true, span: 2, width: 50 })] }),
            sigRow("Authorised signatory", true),
            sigRow("Full name"),
            sigRow("Position"),
            sigRow("Date"),
          ],
        }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

/**
 * UK-style execution clauses with dot leaders instead of underscores, a
 * witness line (not a party signer), and the word "signature" inside body text.
 */
export async function docxDotLeaders(firm: string, client: string) {
  const dots = ".".repeat(60);
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, text: "Consultancy Agreement" }),
        p(`DATED: ${dots.slice(0, 25)}`),
        p("PARTIES", { bold: true }),
        p(`(1) ${firm}, a company incorporated in Colorado (the "Consultant"); and`),
        p(`(2) ${client}, a company incorporated in Delaware (the "Company").`),
        p("TEST DOCUMENT - NOT A REAL AGREEMENT.", { bold: true }),
        ...clauseParas(7, "roman"),
        new Paragraph({ heading: HeadingLevel.HEADING_2, text: "VIII. Counterparts and Electronic Signature" }),
        p("This Agreement may be executed in counterparts. An electronic signature has the same effect as a handwritten signature, and the parties consent to signing by electronic means."),
        p("This Agreement has been entered into on the date stated at the beginning of it.", { before: 300 }),
        p(`SIGNED by ${dots}`, { before: 300, after: 60 }),
        p(`for and on behalf of ${client.toUpperCase()}`, { after: 60 }),
        p(`Director ${dots}`, { after: 300 }),
        p(`Witness signature ${dots}`, { after: 60 }),
        p(`Witness name ${dots}`, { after: 400 }),
        p(`SIGNED by ${dots}`, { after: 60 }),
        p(`for and on behalf of ${firm.toUpperCase()}`, { after: 60 }),
        p(`Director ${dots}`),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

/** Word document whose Effective Date was typed in as underlined text (no blank left). */
export async function docxFilledDate(firm: string, client: string) {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, text: "Services Agreement" }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun("This Services Agreement is made as of "),
            new TextRun({ text: "October 22, 2026", underline: {} }),
            new TextRun(` (the "Effective Date") by and between ${firm} (the "Provider") and ${client} (the "Client"). TEST DOCUMENT - NOT A REAL AGREEMENT.`),
          ],
        }),
        ...clauseParas(4),
        p("SIGNATURES", { bold: true, before: 300 }),
        p(`CLIENT: ${client}`, { bold: true }),
        p("Signature: ______________________________", { after: 60 }),
        p("Name: _________________________________", { after: 300 }),
        p(firm.toUpperCase(), { bold: true }),
        p("Signature: ______________________________", { after: 60 }),
        p("Name: _________________________________"),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

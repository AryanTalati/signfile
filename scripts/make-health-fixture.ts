/**
 * Generates fixtures/health/sample-agreement.docx: a realistic multi-page
 * services agreement (fictional parties) used by /api/health?deep=1 to prove
 * LibreOffice DOCX->PDF conversion works within the Render instance's memory.
 *
 * Run: npx tsx scripts/make-health-fixture.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const FIRM = "Example Consulting LLC";
const CLIENT = "Acme Test Corporation";

const lorem =
  "The parties agree that the obligations described in this section apply for the duration of the Term and survive termination to the extent necessary to give them effect. Each party shall act in good faith, keep the other reasonably informed, and promptly notify the other of any circumstance that could materially affect performance. Nothing in this section limits any other right or remedy available under this Agreement or applicable law.";

const sections: [string, string[]][] = [
  ["Definitions", [
    "“Services” means the AI consulting, integration and support services described in each Statement of Work.",
    "“Deliverables” means all reports, code, models, configurations and documentation produced for Client under this Agreement.",
    "“Confidential Information” means any non-public information disclosed by one party to the other, whether orally or in writing.",
  ]],
  ["Scope of Services", [lorem, lorem]],
  ["Fees and Payment", [
    "Client shall pay the fees set out in Schedule A. Invoices are issued monthly in arrears and are due within thirty (30) days of the invoice date.",
    "Late amounts accrue interest at the lesser of 1.0% per month or the maximum rate permitted by law.",
    lorem,
  ]],
  ["Term and Termination", [lorem, "Either party may terminate this Agreement on thirty (30) days’ written notice.", lorem]],
  ["Confidentiality", [lorem, lorem]],
  ["Intellectual Property", [
    "Upon full payment, Firm assigns to Client all right, title and interest in the Deliverables, excluding Firm’s pre-existing materials and general know-how.",
    lorem,
  ]],
  ["Data Protection", [lorem, lorem]],
  ["Warranties and Disclaimers", [lorem, "EXCEPT AS EXPRESSLY STATED, THE SERVICES ARE PROVIDED “AS IS”.", lorem]],
  ["Limitation of Liability", [lorem, lorem]],
  ["General", [lorem, lorem, lorem]],
];

const cell = (text: string, bold = false) =>
  new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
  });

const noBorders = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

const sigRows = ["By: ______________________________", "Name: ____________________________", "Title: _____________________________", "Date: _____________________________"];

const doc = new Document({
  creator: "signfile test fixtures",
  title: "Master Services Agreement (test fixture)",
  sections: [
    {
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun("Page "), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun(" of "), new TextRun({ children: [PageNumber.TOTAL_PAGES] })],
          })],
        }),
      },
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, text: "MASTER SERVICES AGREEMENT" }),
        new Paragraph({
          spacing: { after: 240 },
          text: `This Master Services Agreement (the “Agreement”) is entered into as of the Effective Date by and between ${FIRM} (“Firm”) and ${CLIENT} (“Client”). TEST DOCUMENT — NOT A REAL AGREEMENT.`,
        }),
        ...sections.flatMap(([title, paras], i) => [
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: `${i + 1}. ${title}` }),
          ...paras.map((p, j) => new Paragraph({ spacing: { after: 160 }, text: `${i + 1}.${j + 1} ${p}` })),
        ]),
        new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, text: "Schedule A — Fees" }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: [cell("Item", true), cell("Amount (USD)", true)] }),
            new TableRow({ children: [cell("Discovery workshop"), cell("4,000.00")] }),
            new TableRow({ children: [cell("Implementation (monthly retainer)"), cell("12,500.00")] }),
            new TableRow({ children: [cell("Support (per hour)"), cell("185.00")] }),
          ],
        }),
        new Paragraph({ spacing: { before: 480, after: 240 }, text: "IN WITNESS WHEREOF, the parties have executed this Agreement as of the Effective Date." }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: noBorders,
          rows: [
            new TableRow({ children: [cell(FIRM.toUpperCase(), true), cell(`CLIENT: ${CLIENT.toUpperCase()}`, true)] }),
            ...sigRows.map((r) => new TableRow({ children: [cell(r), cell(r)] })),
          ],
        }),
      ],
    },
  ],
});

const out = path.join(process.cwd(), "fixtures/health/sample-agreement.docx");
mkdirSync(path.dirname(out), { recursive: true });
Packer.toBuffer(doc).then((buf) => {
  writeFileSync(out, buf);
  console.log(`wrote ${out} (${buf.length} bytes)`);
});

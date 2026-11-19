/**
 * Generates varied test agreements the field detector was NOT designed around,
 * plus a ground-truth manifest used by detector tests and the E2E test.
 *
 *   npm run gen:agreements            -> fixtures/agreements/*.{pdf,docx} + manifest.json
 *
 * Every fixture is fictional test data. Each PDF is self-checked after writing
 * (page count, text layer present/absent, rotation, encryption) so a fixture
 * can't silently stop testing what it claims to.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { docxDotLeaders, docxFilledDate, docxTableBlocks } from "./docx-fixtures";
import { encryptedPdf } from "./encrypt";
import {
  pdfAcroForm,
  pdfDateBlanks,
  pdfDrawnLines,
  pdfLarge,
  pdfMultipageInitials,
  pdfNoSignatureArea,
  pdfRotated,
  pdfScanSource,
  pdfTwoColumn,
} from "./pdf-fixtures";
import { toScanned } from "./scan";

type Role = "client" | "firm";
type PageRef = number | "last";

export interface FixtureExpectation {
  file: string;
  format: "pdf" | "docx";
  description: string;
  firmName: string;
  clientName: string;
  /** fields: detector should find fields; append: offer "append a signature page"; reject: upload must fail with rejectCode. */
  outcome: "fields" | "append" | "reject";
  rejectCode?: "encrypted";
  /** Minimum signature fields the detector must find, by role and page. */
  signatures?: { role: Role; page: PageRef }[];
  /** Field types each party's signature block should contain (the eval reports found vs expected per type). */
  blocks?: { role: Role | "none"; page: PageRef; types: string[] }[];
  /** Field types that must NOT be detected (e.g. blanks already filled in). role "none" = no-signer fields. */
  absent?: { role?: Role | "none"; page: PageRef; types: string[] }[];
  initials?: { role: Role; pages: number[] }[];
  /** Things a naive detector gets wrong on this file. */
  traps?: string[];
  /** Filled in by the self-check. */
  check?: { pages: number; textChars: number; rotations: number[]; sizeKb: number };
}

const OUT = path.join(process.cwd(), "fixtures/agreements");
const ASTRA = "Astra AI";

type Gen = { exp: Omit<FixtureExpectation, "check">; make: () => Promise<Uint8Array | Buffer> };

const fixtures: Gen[] = [
  {
    exp: {
      file: "pdf-date-blanks.pdf", format: "pdf", firmName: ASTRA, clientName: "Initech Test Co.",
      description: "Empty date blanks in body text: 'made as of ____ (the \"Effective Date\")', 'Dated: ____', 'Signed this ___ day of ____, 2026'.",
      outcome: "fields",
      blocks: [
        { role: "none", page: 1, types: ["agreement_date", "firm_fill"] },
        { role: "none", page: "last", types: ["firm_fill"] },
        { role: "client", page: "last", types: ["signature", "full_name", "date_signed"] },
        { role: "firm", page: "last", types: ["signature", "full_name", "date_signed"] },
      ],
      traps: ["Effective Date blank -> 'Agreement date' (automatic); other date blanks -> 'Filled by you'", "'Signed this ___ day of' is a date, not a signature line", "Date fields are medium confidence and flagged for review"],
    },
    make: () => pdfDateBlanks(ASTRA, "Initech Test Co.", false),
  },
  {
    exp: {
      file: "pdf-prefilled-blanks.pdf", format: "pdf", firmName: ASTRA, clientName: "Initech Test Co.",
      description: "Same document with values already typed over the blanks (DocuSign/Word-filled): dates and the client's printed name.",
      outcome: "fields",
      blocks: [
        { role: "client", page: "last", types: ["signature", "date_signed"] },
        { role: "firm", page: "last", types: ["signature", "full_name", "date_signed"] },
      ],
      absent: [
        { role: "none", page: 1, types: ["agreement_date", "firm_fill"] },
        { role: "none", page: "last", types: ["agreement_date", "firm_fill"] },
        { role: "client", page: "last", types: ["full_name"] },
      ],
      traps: ["A blank with text over it is filled: no field"],
    },
    make: () => pdfDateBlanks(ASTRA, "Initech Test Co.", true),
  },
  {
    exp: {
      file: "docx-filled-date.docx", format: "docx", firmName: ASTRA, clientName: "Hooli Test Systems",
      description: "Word document where the Effective Date was typed in as underlined text.",
      outcome: "fields",
      blocks: [
        { role: "client", page: "last", types: ["signature", "full_name"] },
        { role: "firm", page: "last", types: ["signature", "full_name"] },
      ],
      absent: [{ role: "none", page: 1, types: ["agreement_date", "firm_fill"] }],
      traps: ["Underlined typed text renders as text on a line: filled, no field"],
    },
    make: () => docxFilledDate(ASTRA, "Hooli Test Systems"),
  },
  {
    exp: {
      file: "docx-table-blocks.docx", format: "docx", firmName: ASTRA, clientName: "Globex Test Industries Ltd",
      description: "DOCX; signature blocks are a bordered table (label cell + empty cell), no underscores; also has a fee table.",
      outcome: "fields",
      blocks: [{ role: "firm", page: "last", types: ["signature", "full_name", "title", "date_signed"] }, { role: "client", page: "last", types: ["signature", "full_name", "title", "date_signed"] }],
      signatures: [{ role: "firm", page: "last" }, { role: "client", page: "last" }],
      traps: ["Signature 'line' is a table cell border, not text or a path under a label", "Fee table cells must not become fields", "Labels are 'Authorised signatory' / 'Position', not 'Signature' / 'Title'"],
    },
    make: () => docxTableBlocks(ASTRA, "Globex Test Industries Ltd"),
  },
  {
    exp: {
      file: "docx-dot-leaders.docx", format: "docx", firmName: "Example Consulting LLC", clientName: "Umbrella Test Holdings Inc.",
      description: "DOCX; UK-style 'SIGNED by ......' execution clauses with dot leaders; party named on the line AFTER the signature line.",
      outcome: "fields",
      blocks: [{ role: "client", page: "last", types: ["signature", "signature"] }, { role: "firm", page: "last", types: ["signature", "signature"] }],
      signatures: [{ role: "client", page: "last" }, { role: "firm", page: "last" }],
      traps: ["Dot leaders, not underscores", "Role appears below the line ('for and on behalf of')", "Witness lines are not a party signer", "'electronic signature' appears in clause body text", "'DATED: .....' on page 1 is not a signer field"],
    },
    make: () => docxDotLeaders("Example Consulting LLC", "Umbrella Test Holdings Inc."),
  },
  {
    exp: {
      file: "pdf-drawn-lines.pdf", format: "pdf", firmName: ASTRA, clientName: "Initech Test Co.",
      description: "Signature lines are vector paths with labels BELOW them; stacked CLIENT then firm blocks.",
      outcome: "fields",
      blocks: [{ role: "client", page: "last", types: ["signature", "date_signed", "full_name", "title"] }, { role: "firm", page: "last", types: ["signature", "date_signed", "full_name", "title"] }],
      signatures: [{ role: "client", page: "last" }, { role: "firm", page: "last" }],
      traps: ["No underscore text at all", "Label is below the line, not to the left"],
    },
    make: () => pdfDrawnLines(ASTRA, "Initech Test Co."),
  },
  {
    exp: {
      file: "pdf-two-column.pdf", format: "pdf", firmName: "Northwind Example Labs", clientName: "Hooli Test Systems",
      description: "Two signature blocks side by side: PROVIDER (left) and CUSTOMER (right), 'By: ____' style.",
      outcome: "fields",
      blocks: [{ role: "firm", page: "last", types: ["signature", "full_name", "title", "date_signed"] }, { role: "client", page: "last", types: ["signature", "full_name", "title", "date_signed"] }],
      signatures: [{ role: "firm", page: "last" }, { role: "client", page: "last" }],
      traps: ["Firm isn't the demo company, so role must come from PROVIDER/CUSTOMER", "Same row holds both parties' fields", "'By:' means signature"],
    },
    make: () => pdfTwoColumn("Northwind Example Labs", "Hooli Test Systems"),
  },
  {
    exp: {
      file: "pdf-multipage-initials.pdf", format: "pdf", firmName: ASTRA, clientName: "Vandelay Test Imports",
      description: "6 pages, empty initials boxes in every page footer for both parties; signatures on the last page.",
      outcome: "fields",
      blocks: [{ role: "client", page: 6, types: ["signature", "date_signed"] }, { role: "firm", page: 6, types: ["signature", "date_signed"] }],
      signatures: [{ role: "client", page: 6 }, { role: "firm", page: 6 }],
      initials: [{ role: "client", pages: [1, 2, 3, 4, 5, 6] }, { role: "firm", pages: [1, 2, 3, 4, 5, 6] }],
      traps: ["Initials targets are drawn rectangles", "Repeated footer on every page"],
    },
    make: () => pdfMultipageInitials(ASTRA, "Vandelay Test Imports"),
  },
  {
    exp: {
      file: "pdf-scanned.pdf", format: "pdf", firmName: ASTRA, clientName: "Soylent Test Foods",
      description: "Image-only scan (skewed, noisy JPEG pages), no text layer.",
      outcome: "append",
      traps: ["No text to detect from; must offer 'append a signature page', not dead-end"],
    },
    make: async () => toScanned(await pdfScanSource(ASTRA, "Soylent Test Foods")),
  },
  {
    exp: {
      file: "pdf-rotated.pdf", format: "pdf", firmName: ASTRA, clientName: "Stark Test Logistics",
      description: "Page 2 is a landscape page with /Rotate 90 whose content displays upright as portrait.",
      outcome: "fields",
      blocks: [{ role: "client", page: 2, types: ["signature", "full_name", "title", "date_signed"] }, { role: "firm", page: 2, types: ["signature", "full_name", "title", "date_signed"] }],
      signatures: [{ role: "client", page: 2 }, { role: "firm", page: 2 }],
      traps: ["Field coordinates must be in displayed space; stamping must undo the rotation"],
    },
    make: () => pdfRotated(ASTRA, "Stark Test Logistics"),
  },
  {
    exp: {
      file: "pdf-no-signature-area.pdf", format: "pdf", firmName: ASTRA, clientName: "Wayne Test Enterprises",
      description: "Engagement letter with no signature lines or labels; says 'please sign' in body text.",
      outcome: "append",
      traps: ["'Please sign' and 'Sincerely' must not produce fields"],
    },
    make: () => pdfNoSignatureArea(ASTRA, "Wayne Test Enterprises"),
  },
  {
    exp: {
      file: "pdf-acroform.pdf", format: "pdf", firmName: "Example Dev Studio", clientName: "Cyberdyne Test Systems",
      description: "Existing AcroForm text fields (customer_signature, developer_date, ...) and a checkbox.",
      outcome: "fields",
      blocks: [{ role: "client", page: "last", types: ["signature", "full_name", "date_signed"] }, { role: "firm", page: "last", types: ["signature", "full_name", "date_signed"] }],
      signatures: [{ role: "client", page: "last" }, { role: "firm", page: "last" }],
      traps: ["Existing form widgets must be used or flattened, not left editable in the sealed PDF", "DEVELOPER = firm, CUSTOMER = client"],
    },
    make: () => pdfAcroForm("Example Dev Studio", "Cyberdyne Test Systems"),
  },
  {
    exp: {
      file: "pdf-large.pdf", format: "pdf", firmName: ASTRA, clientName: "Massive Test Dynamic",
      description: "~150 pages, several MB (incompressible images), signatures on the last page.",
      outcome: "fields",
      blocks: [{ role: "client", page: "last", types: ["signature", "full_name", "date_signed"] }, { role: "firm", page: "last", types: ["signature", "full_name", "date_signed"] }],
      signatures: [{ role: "client", page: "last" }, { role: "firm", page: "last" }],
      traps: ["Upload, detection, rendering and sealing must stay fast and within memory"],
    },
    make: () => pdfLarge(ASTRA, "Massive Test Dynamic"),
  },
  {
    exp: {
      file: "pdf-encrypted-password.pdf", format: "pdf", firmName: ASTRA, clientName: "Test Client",
      description: "Requires a password to open (RC4 40-bit, user password 'test').",
      outcome: "reject", rejectCode: "encrypted",
      traps: ["Must show a clear message, not a crash or a blank editor"],
    },
    make: async () => encryptedPdf({ userPassword: "test", ownerPassword: "owner", lines: ["SERVICES AGREEMENT (TEST)", "Client signature: ____________________"] }),
  },
  {
    exp: {
      file: "pdf-encrypted-permissions.pdf", format: "pdf", firmName: ASTRA, clientName: "Test Client",
      description: "Opens without a password but is encrypted with permission restrictions (owner password only).",
      outcome: "fields",
      blocks: [{ role: "client", page: 1, types: ["signature", "date_signed"] }],
      signatures: [{ role: "client", page: 1 }],
      traps: ["Opens fine in viewers, so rejecting it would surprise users; strip restrictions before stamping"],
    },
    make: async () => encryptedPdf({ userPassword: "", ownerPassword: "owner", lines: ["SERVICES AGREEMENT (TEST)", "", "CLIENT", "", "Signature: ____________________", "", "Date: ____________"] }),
  },
];

async function inspectPdf(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  let textChars = 0;
  const rotations: number[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    rotations.push(page.rotate);
    const tc = await page.getTextContent();
    textChars += tc.items.reduce((n, it) => n + ("str" in it ? it.str.trim().length : 0), 0);
  }
  return { pages: doc.numPages, textChars, rotations };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const manifest: FixtureExpectation[] = [];
  const problems: string[] = [];

  for (const { exp, make } of fixtures) {
    const bytes = await make();
    writeFileSync(path.join(OUT, exp.file), bytes);
    const sizeKb = Math.round(bytes.length / 1024);
    const entry: FixtureExpectation = { ...exp };

    if (exp.format === "pdf") {
      if (exp.rejectCode === "encrypted") {
        const err = await inspectPdf(new Uint8Array(bytes)).then(() => null, (e: Error) => e);
        if (err?.name !== "PasswordException") problems.push(`${exp.file}: expected a PasswordException, got ${err?.name ?? "no error"}`);
      } else {
        const check = { ...(await inspectPdf(new Uint8Array(bytes))), sizeKb };
        entry.check = check;
        if (exp.outcome === "append" && exp.file.includes("scanned") && check.textChars > 0) problems.push(`${exp.file}: scan has a text layer`);
        if (exp.outcome === "fields" && check.textChars === 0) problems.push(`${exp.file}: no text layer`);
        if (exp.file.includes("rotated") && check.rotations[1] !== 90) problems.push(`${exp.file}: page 2 not rotated`);
        if (exp.file.includes("large") && sizeKb < 3000) problems.push(`${exp.file}: only ${sizeKb} KB`);
      }
    }
    manifest.push(entry);
    console.log(`  ${exp.file.padEnd(34)} ${String(sizeKb).padStart(6)} KB  ${entry.check ? `${entry.check.pages}p, ${entry.check.textChars} chars` : ""}`);
  }

  writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (problems.length) {
    console.error("\nSelf-check failed:\n" + problems.map((p) => `  - ${p}`).join("\n"));
    process.exit(1);
  }
  console.log(`\n${manifest.length} fixtures + manifest.json written to ${path.relative(process.cwd(), OUT)}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

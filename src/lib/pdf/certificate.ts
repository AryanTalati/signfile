/**
 * The audit certificate appended to a sealed PDF. Pure: pdf-lib only (no DB, no storage),
 * so its layout is unit-tested (tests/unit/certificate.test.ts).
 *
 * Layout rules: a typical File (two signers, a dozen events) fits on one page. Blocks are
 * never split (a signer, one event); if more is left than fits, it continues on a new page
 * headed "Certificate of Completion (continued)", and a page never carries a single line.
 */
import { type PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import { eventLabel } from "@/lib/files/event-labels";
import { utcAndLocal } from "@/lib/time";
import { uaSummary } from "@/lib/http/user-agent";

export interface CertSigner {
  name: string;
  email: string;
  title: string | null;
  role: string;
  ip: string | null;
  userAgent: string | null;
  timezone: string | null;
  consentAt: Date | null;
  signedAt: Date | null;
  /** Set for an automatic countersign: when the signer authorized it. */
  autoAuthorizedAt: Date | null;
  signature?: string;
}

export interface CertData {
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
}

/** Events whose IP is the signer block's own (shown there), so the log line stays short. */
const IP_IN_SIGNER_BLOCK = new Set(["recipient.auto_countersigned", "recipient.signed_with_saved_signature"]);

const W = 612, H = 792, M = 50;
const LABEL_W = 118;
const ROW = 11.5; // 8.5 pt rows
const EVENT = 10; // 7.5 pt event lines
const grey = rgb(0.38, 0.38, 0.38);

const when = (d: Date | null, tz: string | null) => (d ? utcAndLocal(d, tz) : "-");

type Line = { h: number; draw: (page: PDFPage, y: number) => void };
/** A group of lines that's never split across pages. `keepWithNext` lines move with the next block (headings). */
type Block = { lines: Line[]; keepWithNext?: boolean };

/** Appends the certificate pages; returns how many. */
export async function appendCertificate(pdf: PDFDocument, c: CertData): Promise<number> {
  const f = c.font, b = c.bold;
  const textLine = (s: string, size: number, font: PDFFont, color = rgb(0, 0, 0), x = M, gapAfter = 0): Line => ({
    h: size + 3 + gapAfter,
    draw: (p, y) => p.drawText(s, { x, y: y - size, size, font, color }),
  });
  const rows = (label: string, value: string): Line[] =>
    wrapText(value, f, 8.5, W - 2 * M - LABEL_W).map((v, i) => ({
      h: ROW,
      draw: (p, y) => {
        if (i === 0) p.drawText(label, { x: M, y: y - 8.5, size: 8.5, font: b, color: grey });
        p.drawText(v, { x: M + LABEL_W, y: y - 8.5, size: 8.5, font: f });
      },
    }));

  const blocks: Block[] = [];
  blocks.push({
    lines: [
      textLine("Certificate of Completion", 16, b, undefined, M, 4),
      textLine("This certificate is part of the signed document above. It records who signed, when, and how.", 8.5, f, grey, M, 6),
      ...rows("File ID", c.fileId),
      ...rows("Document", `${c.documentName} (version ${c.documentVersion})`),
      ...rows("Between", `${c.firm} and ${c.client}`),
      ...(c.reference ? rows("Reference", c.reference) : []),
      ...rows("Status", `Completed ${when(c.completedAt, c.firmTimezone)}`),
      ...rows("Source file SHA-256", c.sourceSha256),
      ...rows("Agreement PDF SHA-256", c.documentSha256),
      ...rows("Signed PDF SHA-256", `Recorded when sealed; check this file at ${c.verifyUrl}`),
    ],
  });

  for (const s of c.signers) {
    const lines: Line[] = [
      { h: 8, draw: (p, y) => p.drawLine({ start: { x: M, y: y - 3 }, end: { x: W - M, y: y - 3 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) }) },
      textLine(s.name, 10, b, undefined, M, 1),
      ...rows("Role", s.role),
      ...rows("Email", s.email),
      ...(s.title ? rows("Title", s.title) : []),
    ];
    // Each signer's own browser time zone; the firm's for signers without one. Named once, on the Signed line.
    const tz = s.timezone ?? c.firmTimezone;
    const zone = tz ? ` (${s.timezone ? s.timezone : `${tz}, ${c.firm}'s time zone`})` : "";
    const browser = uaSummary(s.userAgent);
    if (s.autoAuthorizedAt) {
      // Signed by the system on their standing instruction: say so, and show where and when they gave it.
      lines.push(
        ...rows("Method", "Automatic countersign using saved signature"),
        ...rows("Authorized", `${when(s.autoAuthorizedAt, tz)}, IP ${s.ip ?? "not recorded"}, browser ${browser}`),
        ...rows("Agreed to e-sign", when(s.autoAuthorizedAt, tz)),
        ...rows("Signed", when(s.signedAt, tz) + zone),
      );
    } else {
      lines.push(...rows("Agreed to e-sign", when(s.consentAt, tz)), ...rows("Signed", when(s.signedAt, tz) + zone), ...rows("IP address, browser", `${s.ip ?? "not recorded"}, ${browser}`));
    }
    if (s.signature) {
      const img = await pdf.embedPng(Buffer.from(s.signature.split(",")[1], "base64"));
      const scale = Math.min(160 / img.width, 26 / img.height);
      const ih = img.height * scale;
      lines.push({
        h: Math.max(ih, ROW) + 2,
        draw: (p, y) => {
          p.drawText("Signature", { x: M, y: y - 8.5, size: 8.5, font: b, color: grey });
          p.drawImage(img, { x: M + LABEL_W, y: y - ih, width: img.width * scale, height: ih });
        },
      });
    }
    blocks.push({ lines });
  }

  blocks.push({ lines: [{ h: 4, draw: () => undefined }, textLine(c.firmTimezone ? `Event log (UTC / ${c.firmTimezone})` : "Event log (UTC)", 10, b, undefined, M, 2)], keepWithNext: true });
  for (const e of c.events) {
    // The revision note can quote the earlier version's change request: it stays in the audit
    // trail and timeline, but the certificate describes only the signed version.
    const data = e.type === "file.revised" ? { ...e.data, note: null } : e.data;
    const inAdvance = e.type === "recipient.consented" && !!e.data?.inAdvance;
    const ip = e.ip && !IP_IN_SIGNER_BLOCK.has(e.type) && !inAdvance ? `  ·  IP ${e.ip}` : "";
    const line = `${when(e.at, c.firmTimezone)}  ${eventLabel({ type: e.type, actorLabel: e.actor, data })}${ip}`;
    blocks.push({ lines: wrapText(line, f, 7.5, W - 2 * M).map((l) => ({ h: EVENT, draw: (p, y) => p.drawText(l, { x: M, y: y - 7.5, size: 7.5, font: f }) })) });
  }

  return paginate(pdf, blocks, c);
}

function paginate(pdf: PDFDocument, blocks: Block[], c: CertData) {
  const height = (bl: Block[]) => bl.reduce((n, x) => n + x.lines.reduce((m, l) => m + l.h, 0), 0);
  let pages = 0;
  let i = 0;
  while (i < blocks.length) {
    const page = pdf.addPage([W, H]);
    pages++;
    let y = H - M;
    if (pages > 1) {
      page.drawText("Certificate of Completion (continued)", { x: M, y: y - 12, size: 12, font: c.bold });
      page.drawText(`File ID ${c.fileId}`, { x: M, y: y - 25, size: 8, font: c.font, color: grey });
      y -= 36;
    }
    // How many blocks fit; a heading stays with what follows it.
    const room = y - M;
    let n = 0, used = 0;
    while (i + n < blocks.length && used + height([blocks[i + n]]) <= room) used += height([blocks[i + n++]]);
    while (n > 0 && blocks[i + n - 1].keepWithNext && i + n < blocks.length) n--;
    // Never leave a single line alone on the next page: take one block back so it has company.
    const rest = blocks.slice(i + n);
    if (n > 1 && rest.length && rest.reduce((k, x) => k + x.lines.length, 0) === 1) n--;
    if (n === 0) n = 1; // a block taller than a page: draw it anyway rather than loop
    for (const bl of blocks.slice(i, i + n))
      for (const l of bl.lines) {
        l.draw(page, y);
        y -= l.h;
      }
    i += n;
  }
  return pages;
}

export function wrapText(s: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > max && line) {
      out.push(line);
      line = word;
    } else line = next;
    // Hard-break very long tokens (hashes, URLs).
    while (font.widthOfTextAtSize(line, size) > max) {
      let k = line.length;
      while (k > 1 && font.widthOfTextAtSize(line.slice(0, k), size) > max) k--;
      out.push(line.slice(0, k));
      line = line.slice(k);
    }
  }
  if (line) out.push(line);
  return out;
}

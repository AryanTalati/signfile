/**
 * Fallback for documents where detection finds nothing (scans, unusual
 * layouts): append a clean signature page with one block per signing party,
 * and return exact fields for it. Deterministic, no AI.
 */
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { FieldDef, PageInfo, RoleDef } from "@/lib/fields/types";

export interface AppendResult {
  pdf: Uint8Array;
  pages: PageInfo[];
  fields: FieldDef[];
}

export async function appendSignaturePage(
  pdfBytes: Uint8Array,
  opts: { documentName: string; roles: RoleDef[]; partyNames?: Partial<Record<string, string>> },
): Promise<AppendResult> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Match the document's displayed page size (portrait), defaulting to US Letter.
  const last = doc.getPages().at(-1);
  let [W, H] = [612, 792];
  if (last) {
    const { width, height } = last.getSize();
    const rot = last.getRotation().angle % 180 !== 0;
    [W, H] = rot ? [height, width] : [width, height];
    if (W > H) [W, H] = [H, W];
  }
  const page = doc.addPage([W, H]);
  const M = 64;
  const grey = rgb(0.35, 0.35, 0.35);
  // pdf-lib uses bottom-left origin; we track `top` distance from the top edge.
  const text = (s: string, x: number, top: number, size = 10, f = font, color = rgb(0, 0, 0)) => page.drawText(s, { x, y: H - top - size, size, font: f, color });

  text("SIGNATURE PAGE", M, 64, 16, bold);
  const intro = `This signature page is part of and incorporated into: ${opts.documentName}. By signing below, each party agrees to that document.`;
  let top = 92;
  for (const line of wrap(intro, font, 10, W - 2 * M)) {
    text(line, M, top, 10, font, grey);
    top += 14;
  }
  top += 24;

  const fields: FieldDef[] = [];
  const pageNo = doc.getPageCount();
  const rows: [string, FieldDef["type"]][] = [
    ["Signature", "signature"],
    ["Name", "full_name"],
    ["Title", "title"],
    ["Date", "date_signed"],
  ];
  const lineW = Math.min(300, W - 2 * M - 70);
  const roles = [...opts.roles].sort((a, b) => a.order - b.order);

  for (const role of roles) {
    const party = opts.partyNames?.[role.key];
    text(role.kind === "client" ? "CLIENT" : "FIRM", M, top, 9, bold, grey);
    if (party) text(party, M + 52, top, 10, bold);
    top += 30;
    for (const [label, type] of rows) {
      const rowH = type === "signature" ? 44 : 32;
      const lineY = top + rowH - 8; // from top
      text(label, M, lineY - 12, 10);
      page.drawLine({ start: { x: M + 70, y: H - lineY }, end: { x: M + 70 + lineW, y: H - lineY }, thickness: 0.75, color: grey });
      const h = type === "signature" ? 32 : 16;
      fields.push({
        id: `sp_${role.key}_${type}`,
        page: pageNo,
        x: round((M + 72) / W),
        y: round((lineY - h - 1) / H),
        w: round((type === "signature" ? Math.min(240, lineW) : Math.min(220, lineW)) / W),
        h: round(h / H),
        type,
        roleKey: role.key,
        label: type === "signature" ? "Signature" : type === "full_name" ? "Full name" : type === "date_signed" ? "Date signed" : "Title",
        required: true,
        confidence: 1,
        source: "appended",
      });
      top += rowH;
    }
    top += 28;
  }

  const pdf = await doc.save();
  const pages: PageInfo[] = doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    const r = ((p.getRotation().angle % 360) + 360) % 360;
    return { width, height, rotation: ([0, 90, 180, 270].includes(r) ? r : 0) as PageInfo["rotation"] };
  });
  return { pdf, pages, fields };
}

const round = (n: number) => Math.round(n * 10000) / 10000;

function wrap(s: string, font: { widthOfTextAtSize(t: string, n: number): number }, size: number, max: number) {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > max && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

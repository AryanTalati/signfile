/**
 * Stamping values onto a PDF. Pure (no DB, no request context) so sealing and
 * verification scripts run exactly the same code.
 */
import { degrees, type PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import type { FieldDef, PageInfo } from "@/lib/fields/types";
import { fitToPage } from "./detect";
import { extractLayout } from "./extract";


/**
 * Stamps every value. Each field is first fitted to the clear space on the actual page
 * (fitToPage), so stamped content never covers printed text, even for fields frozen into a
 * File before a geometry fix, or placed by hand.
 */
export async function stampAll(
  pdf: PDFDocument,
  original: Uint8Array,
  pagesInfo: PageInfo[],
  fields: FieldDef[],
  values: Record<string, string>,
  fonts: { font: PDFFont; dingbats: PDFFont },
) {
  const layout = await extractLayout(new Uint8Array(original));
  const pages = pdf.getPages();
  for (const raw of fields) {
    const v = values[raw.id];
    if (!v) continue;
    const page = pages[raw.page - 1];
    if (!page) continue;
    await stampField(pdf, page, pagesInfo[raw.page - 1], fitToPage(layout[raw.page - 1], raw), v, fonts);
  }
}

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


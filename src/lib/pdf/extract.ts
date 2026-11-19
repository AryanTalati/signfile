/**
 * Extracts page geometry from a PDF for field detection: text items,
 * horizontal/vertical line segments, rectangles and existing form widgets.
 *
 * All coordinates are in PDF points on the page AS DISPLAYED (rotation
 * applied), origin top-left, y down. That's the same space the editor and the
 * stored FieldDefs use (as fractions), so rotated pages need no special cases
 * downstream. Pure: no DB, no storage.
 */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export interface TextItem {
  str: string;
  x: number; // left
  y: number; // top
  w: number;
  h: number; // ~font size
  baseline: number;
}

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Widget extends Rect {
  name: string;
  kind: "text" | "checkbox" | "signature" | "other";
}

export interface PageLayout {
  page: number; // 1-based
  width: number; // displayed
  height: number;
  rotation: 0 | 90 | 180 | 270;
  items: TextItem[];
  hLines: Seg[]; // horizontal, x1 < x2
  vLines: Seg[]; // vertical, y1 < y2
  boxes: Rect[]; // closed rectangles (initials boxes, empty form boxes)
  widgets: Widget[];
}

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// pdfjs DrawOPS codes inside constructPath data (pdf.js v5+).
const MOVE = 0,
  LINE = 1,
  CURVE = 2,
  QUAD = 3,
  CLOSE = 4;

export async function loadPdf(data: Uint8Array) {
  return pdfjs.getDocument({ data: data.slice(), verbosity: 0, disableFontFace: true, useSystemFonts: false }).promise;
}

export async function extractLayout(data: Uint8Array, opts: { maxPages?: number } = {}): Promise<PageLayout[]> {
  const doc = await loadPdf(data);
  try {
    const pages: PageLayout[] = [];
    const n = Math.min(doc.numPages, opts.maxPages ?? doc.numPages);
    for (let p = 1; p <= n; p++) pages.push(await extractPage(await doc.getPage(p)));
    return pages;
  } finally {
    await doc.loadingTask.destroy();
  }
}

async function extractPage(page: pdfjs.PDFPageProxy): Promise<PageLayout> {
  const viewport = page.getViewport({ scale: 1 });
  const vt = viewport.transform as Matrix;
  const rotation = (((page.rotate % 360) + 360) % 360) as 0 | 90 | 180 | 270;

  // ---- text ----
  const items: TextItem[] = [];
  const tc = await page.getTextContent();
  for (const it of tc.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const t = mul(vt, it.transform as Matrix);
    // Only text that reads left-to-right on the displayed page.
    if (Math.abs(t[1]) > 0.01 * Math.abs(t[0]) || t[0] <= 0) continue;
    const size = Math.hypot(t[2], t[3]) || it.height || 10;
    const w = it.width * (Math.hypot(t[0], t[1]) / Math.hypot(it.transform[0], it.transform[1]) || 1);
    items.push({ str: it.str, x: t[4], y: t[5] - size, w, h: size, baseline: t[5] });
  }

  // ---- vector paths (track the CTM through save/restore/transform) ----
  const hLines: Seg[] = [];
  const vLines: Seg[] = [];
  const boxes: Rect[] = [];
  const ops = await page.getOperatorList();
  const O = pdfjs.OPS;
  const paintOps = new Set<number>([O.stroke, O.closeStroke, O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) ctm = mul(ctm, args as Matrix);
    else if (fn === O.constructPath) {
      const [paint, pathArgs] = args as [number, (ArrayLike<number> | null)[]];
      if (!paintOps.has(paint)) continue; // clip paths etc.
      const data = pathArgs?.[0];
      if (!data) continue;
      collectPath(data, mul(vt, ctm), hLines, vLines, boxes);
    }
  }

  // ---- existing form widgets ----
  const widgets: Widget[] = [];
  for (const a of await page.getAnnotations()) {
    if (a.subtype !== "Widget" || !a.rect) continue;
    // Hidden (flag 2) or no-view (flag 32) widgets aren't real fields (DocuSign leaves these behind).
    if (a.hidden || ((a.annotationFlags ?? 0) & (2 | 32))) continue;
    const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]);
    const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]);
    const wx = Math.min(x1, x2), wy = Math.min(y1, y2), ww = Math.abs(x2 - x1), wh = Math.abs(y2 - y1);
    // Degenerate or off-page widgets (zero-size leftovers at a page corner) aren't fields either.
    if (ww < 8 || wh < 6 || wx < -1 || wy < -1 || wx + ww > viewport.width + 1 || wy + wh > viewport.height + 1) continue;
    const kind = a.fieldType === "Sig" ? "signature" : a.fieldType === "Tx" ? "text" : a.checkBox ? "checkbox" : "other";
    widgets.push({ name: String(a.fieldName ?? ""), kind, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
  }

  return {
    page: page.pageNumber,
    width: viewport.width,
    height: viewport.height,
    rotation,
    items: items.sort((a, b) => a.baseline - b.baseline || a.x - b.x),
    hLines: dedupeSegs(hLines, "h"),
    vLines: dedupeSegs(vLines, "v"),
    boxes,
    widgets,
  };
}

/** Splits a path into subpaths; emits axis-aligned segments and closed rectangles. */
function collectPath(data: ArrayLike<number>, m: Matrix, hLines: Seg[], vLines: Seg[], boxes: Rect[]) {
  let sub: [number, number][] = [];
  const flush = (closed: boolean) => {
    if (sub.length >= 2) handleSubpath(sub, closed, hLines, vLines, boxes);
    sub = [];
  };
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    if (op === MOVE) {
      flush(false);
      sub.push(apply(m, data[i], data[i + 1]));
      i += 2;
    } else if (op === LINE) {
      sub.push(apply(m, data[i], data[i + 1]));
      i += 2;
    } else if (op === CURVE) {
      sub.push(apply(m, data[i + 4], data[i + 5]));
      i += 6;
    } else if (op === QUAD) {
      sub.push(apply(m, data[i + 2], data[i + 3]));
      i += 4;
    } else if (op === CLOSE) {
      flush(true);
    } else break; // unknown op: stop rather than misread
  }
  flush(false);
}

function handleSubpath(pts: [number, number][], closed: boolean, hLines: Seg[], vLines: Seg[], boxes: Rect[]) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs),
    y = Math.min(...ys),
    w = Math.max(...xs) - x,
    h = Math.max(...ys) - y;

  // A thin filled/stroked rectangle is a line (common for table borders and Word underlines).
  if (h <= 2.5 && w >= 8) return void hLines.push({ x1: x, y1: y + h / 2, x2: x + w, y2: y + h / 2 });
  if (w <= 2.5 && h >= 8) return void vLines.push({ x1: x + w / 2, y1: y, x2: x + w / 2, y2: y + h });

  // Axis-aligned 4-corner closed shape: a box.
  const axisAligned = pts.every(([px, py]) => (Math.abs(px - x) < 1 || Math.abs(px - x - w) < 1) && (Math.abs(py - y) < 1 || Math.abs(py - y - h) < 1));
  if ((closed || pts.length >= 4) && axisAligned && w >= 8 && h >= 8) {
    boxes.push({ x, y, w, h });
    // Box edges also act as lines (table cells drawn as rectangles).
    hLines.push({ x1: x, y1: y, x2: x + w, y2: y }, { x1: x, y1: y + h, x2: x + w, y2: y + h });
    vLines.push({ x1: x, y1: y, x2: x, y2: y + h }, { x1: x + w, y1: y, x2: x + w, y2: y + h });
    return;
  }

  // Polyline: keep each axis-aligned segment.
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1];
    const [bx, by] = pts[k];
    if (Math.abs(ay - by) < 1 && Math.abs(ax - bx) >= 8) hLines.push({ x1: Math.min(ax, bx), y1: ay, x2: Math.max(ax, bx), y2: ay });
    else if (Math.abs(ax - bx) < 1 && Math.abs(ay - by) >= 8) vLines.push({ x1: ax, y1: Math.min(ay, by), x2: ax, y2: Math.max(ay, by) });
  }
}

/** Merges duplicate/overlapping collinear segments (tables often draw each border twice). */
function dedupeSegs(segs: Seg[], dir: "h" | "v"): Seg[] {
  const key = (s: Seg) => (dir === "h" ? s.y1 : s.x1);
  const lo = (s: Seg) => (dir === "h" ? s.x1 : s.y1);
  const hi = (s: Seg) => (dir === "h" ? s.x2 : s.y2);
  const sorted = [...segs].sort((a, b) => key(a) - key(b) || lo(a) - lo(b));
  const out: Seg[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(key(prev) - key(s)) < 1.5 && lo(s) <= hi(prev) + 1) {
      if (dir === "h") prev.x2 = Math.max(prev.x2, s.x2);
      else prev.y2 = Math.max(prev.y2, s.y2);
    } else out.push({ ...s });
  }
  return out;
}

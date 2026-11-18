/**
 * Turns a text PDF into an image-only "scanned" PDF: each page is rendered to
 * a bitmap, given a slight skew, grey paper tone and speckle noise, and
 * re-embedded as a JPEG. The result has no text layer at all.
 */
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { FIXED_DATE } from "./layout";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export async function toScanned(pdfBytes: Uint8Array, opts: { dpi?: number; skewDeg?: number; seed?: number } = {}) {
  const dpi = opts.dpi ?? 130;
  const scale = dpi / 72;
  let seed = opts.seed ?? 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const src = await pdfjs.getDocument({ data: pdfBytes.slice(), verbosity: 0 }).promise;
  const out = await PDFDocument.create({ updateMetadata: false });
  out.setCreationDate(FIXED_DATE);
  out.setModificationDate(FIXED_DATE);

  for (let p = 1; p <= src.numPages; p++) {
    const page = await src.getPage(p);
    const viewport = page.getViewport({ scale });
    const w = Math.ceil(viewport.width);
    const h = Math.ceil(viewport.height);

    const flat = createCanvas(w, h);
    const fctx = flat.getContext("2d");
    fctx.fillStyle = "#fff";
    fctx.fillRect(0, 0, w, h);
    await page.render({ canvas: flat as unknown as HTMLCanvasElement, canvasContext: fctx as unknown as CanvasRenderingContext2D, viewport }).promise;

    // Paper tone + skew, like a sheet fed slightly crooked.
    const scan = createCanvas(w, h);
    const ctx = scan.getContext("2d");
    ctx.fillStyle = "#f2f0ea";
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate((((opts.skewDeg ?? 0.8) * (p % 2 ? 1 : -0.6)) * Math.PI) / 180);
    ctx.translate(-w / 2, -h / 2);
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(flat, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    // Speckle noise.
    ctx.fillStyle = "rgba(60,60,60,0.35)";
    for (let i = 0; i < (w * h) / 900; i++) ctx.fillRect(rand() * w, rand() * h, 1 + rand(), 1 + rand());

    const jpg = await scan.encode("jpeg", 70);
    const img = await out.embedJpg(jpg);
    const pdfW = viewport.width / scale;
    const pdfH = viewport.height / scale;
    out.addPage([pdfW, pdfH]).drawImage(img, { x: 0, y: 0, width: pdfW, height: pdfH });
  }
  out.setProducer("signfile test generator (simulated scan)");
  return out.save();
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

export interface DisplayPage {
  page: number;
  /** Displayed size in PDF points (rotation applied). */
  width: number;
  height: number;
}

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist").then((m) => {
    // Copied into public/ by `npm run copy-pdf-worker` (prebuild/predev), same pdfjs-dist version.
    m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return m;
  });
  return pdfjsPromise;
}

/**
 * Renders PDF pages as canvases, lazily (only pages near the viewport), at
 * the container's width. Children are drawn over each page in a positioned
 * layer whose size matches the page exactly, so overlays can use percentages.
 */
export function PdfPages({
  url,
  pages,
  overlay,
  onPageRef,
}: {
  url: string;
  pages: DisplayPage[];
  overlay: (page: DisplayPage) => ReactNode;
  onPageRef?: (page: number, el: HTMLDivElement | null) => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setDoc(null);
    setError(null);
    loadPdfjs()
      .then((pdfjs) => pdfjs.getDocument({ url, withCredentials: true }).promise)
      .then((d) => {
        loaded = d;
        if (!cancelled) setDoc(d);
      })
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
      void loaded?.loadingTask.destroy();
    };
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-4">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Couldn&apos;t load the document: {error}</p>}
      {pages.map((p) => (
        <div
          key={p.page}
          ref={(el) => onPageRef?.(p.page, el)}
          data-page={p.page}
          className="relative w-full max-w-[900px] bg-white shadow-sm ring-1 ring-border"
          style={{ aspectRatio: `${p.width} / ${p.height}` }}
        >
          <PageCanvas doc={doc} page={p.page} />
          <div className="absolute inset-0">{overlay(p)}</div>
          <span className="pointer-events-none absolute -left-1 top-1 -translate-x-full pr-2 text-xs text-muted max-sm:hidden">{p.page}</span>
        </div>
      ))}
    </div>
  );
}

function PageCanvas({ doc, page }: { doc: PDFDocumentProxy | null; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);

  // Only render pages near the viewport.
  useEffect(() => {
    const el = canvas.current?.parentElement;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "800px 0px" });
    io.observe(el);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!doc || !visible || !width || !canvas.current) return;
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    let cancelled = false;
    (async () => {
      const p = await doc.getPage(page);
      if (cancelled || !canvas.current) return;
      const base = p.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = p.getViewport({ scale: (width / base.width) * dpr });
      const c = canvas.current;
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      task = p.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, visible, width, page]);

  return <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-label={`Page ${page}`} />;
}

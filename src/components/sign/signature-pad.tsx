"use client";

import { useEffect, useRef, useState } from "react";

/** Draw or type a signature; returns a trimmed PNG data URL. */
export function SignaturePad({ kind, defaultName, onDone, onCancel }: { kind: "signature" | "initials"; defaultName: string; onDone: (png: string) => void; onCancel: () => void }) {
  const [tab, setTab] = useState<"type" | "draw">("type");
  const initials = defaultName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const [typed, setTyped] = useState(kind === "initials" ? initials : defaultName);
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const drawn = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    if (tab !== "draw" || !canvas.current) return;
    const c = canvas.current;
    const dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    c.width = r.width * dpr;
    c.height = r.height * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    let last: { x: number; y: number } | null = null;
    const pos = (e: PointerEvent) => ({ x: e.clientX - r.left, y: e.clientY - r.top });
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      last = pos(e);
    };
    const move = (e: PointerEvent) => {
      if (!last) return;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      if (!drawn.current) {
        drawn.current = true;
        setHasInk(true);
      }
    };
    const up = () => (last = null);
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
    };
  }, [tab]);

  function clear() {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    drawn.current = false;
    setHasInk(false);
  }

  async function finish() {
    if (tab === "draw") return onDone(trim(canvas.current!));
    const family = (root.current && getComputedStyle(root.current).getPropertyValue("--font-sig").trim()) || "cursive";
    await document.fonts?.load(`600 64px ${family}`).catch(() => undefined);
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 220;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#111";
    ctx.font = `600 ${kind === "initials" ? 110 : 96}px ${family}, cursive`;
    ctx.textBaseline = "middle";
    ctx.fillText(typed.trim(), 20, 115);
    onDone(trim(c));
  }

  const canFinish = tab === "draw" ? hasInk : typed.trim().length > 0;
  return (
    <div ref={root} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={kind === "initials" ? "Add your initials" : "Add your signature"}>
      <div className="w-full max-w-lg rounded-t-2xl bg-surface p-4 sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{kind === "initials" ? "Your initials" : "Your signature"}</h2>
          <div className="flex rounded-lg border border-border p-0.5 text-sm" role="tablist">
            {(["type", "draw"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={`rounded-md px-3 py-1 ${tab === t ? "bg-brand text-white" : ""}`}>
                {t === "type" ? "Type" : "Draw"}
              </button>
            ))}
          </div>
        </div>
        {tab === "type" ? (
          <div className="mt-3">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={kind === "initials" ? "Initials" : "Full name"} className="w-full rounded-lg border border-border px-3 py-2 text-base" maxLength={60} />
            <div className="mt-3 flex h-24 items-center overflow-hidden rounded-lg border border-dashed border-border px-4 text-5xl" style={{ fontFamily: "var(--font-sig), cursive", fontWeight: 600 }}>
              {typed}
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <canvas ref={canvas} className="h-40 w-full touch-none rounded-lg border border-dashed border-border bg-white" aria-label="Draw here" data-testid="draw-canvas" />
            <button type="button" onClick={clear} className="mt-1 text-sm text-muted hover:underline">
              Clear
            </button>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">By selecting Adopt and sign, you agree this is your electronic signature{kind === "initials" ? " (initials)" : ""}.</p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm">
            Cancel
          </button>
          <button type="button" disabled={!canFinish} onClick={finish} className="flex-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
            Adopt and sign
          </button>
        </div>
      </div>
    </div>
  );
}

/** Crops transparent margins so the signature fills its box. */
function trim(c: HTMLCanvasElement): string {
  const ctx = c.getContext("2d")!;
  const { width: w, height: h } = c;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x1 = w, y1 = h, x2 = 0, y2 = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
  if (x2 <= x1 || y2 <= y1) return c.toDataURL("image/png");
  const pad = 6;
  const out = document.createElement("canvas");
  out.width = Math.min(x2 - x1 + pad * 2, 900);
  out.height = Math.min(y2 - y1 + pad * 2, 300);
  out.getContext("2d")!.drawImage(c, x1 - pad, y1 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

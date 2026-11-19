"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, ButtonLink, Card } from "@/components/ui";
import { FIELD_META, PALETTE, ROLE_COLORS } from "@/lib/fields/meta";
import { needsReview, type FieldDef, type FieldType } from "@/lib/fields/types";
import { rolesFor, validateFields } from "@/lib/fields/validate";
import { PdfPages, type DisplayPage } from "./pdf-pages";

export interface EditorProps {
  templateId: string;
  pdfSha256: string;
  initialName: string;
  pdfUrl: string;
  pages: DisplayPage[];
  initialFields: FieldDef[];
  initialCountersign: boolean;
  signaturePageAppended: boolean;
  detection: { outcome?: string; warnings?: string[]; notes?: string[]; detectedCount?: number } | null;
  firmName: string;
  isNew: boolean;
}

type Save = { state: "saved" | "dirty" | "saving" | "error"; message?: string };
const uid = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function FieldEditor(props: EditorProps) {
  const router = useRouter();
  const [name, setName] = useState(props.initialName);
  const [fields, setFields] = useState<FieldDef[]>(props.initialFields);
  const [countersign, setCountersign] = useState(props.initialCountersign);
  const [selected, setSelected] = useState<string | null>(null);
  const [armed, setArmed] = useState<FieldType | null>(null);
  const [lastRole, setLastRole] = useState<"client" | "firm">("client");
  const [save, setSave] = useState<Save>({ state: "saved" });
  const [appending, setAppending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const history = useRef<FieldDef[][]>([]);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const first = useRef(true);
  const appendingRef = useRef(false);
  // Autosave bookkeeping: one request in flight at a time, always sending the latest state.
  const latest = useRef({ name, countersign, fields });
  latest.current = { name, countersign, fields };
  const rev = useRef(0); // bumped on every edit
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  // ---- mutations (with undo) ----
  const commit = useCallback((next: FieldDef[] | ((prev: FieldDef[]) => FieldDef[])) => {
    setFields((prev) => {
      history.current.push(prev);
      if (history.current.length > 60) history.current.shift();
      return typeof next === "function" ? next(prev) : next;
    });
  }, []);
  const update = useCallback((id: string, patch: Partial<FieldDef>, record = true) => {
    const apply = (prev: FieldDef[]) => prev.map((f) => (f.id === id ? { ...f, ...patch, reviewed: true } : f));
    if (record) commit(apply);
    else setFields(apply);
  }, [commit]);
  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (prev) setFields(prev);
  }, []);
  const remove = useCallback((id: string) => {
    commit((prev) => prev.filter((f) => f.id !== id));
    setSelected(null);
  }, [commit]);

  // ---- autosave ----
  // Saves are serialized: if one is in flight, the next runs right after it with the
  // latest state, so an older request can never land after (and overwrite) a newer one.
  // "Saved" is shown only when the server has the latest revision.
  const saveNow = useCallback((): Promise<void> => {
    if (appendingRef.current) return Promise.resolve(); // never race the append
    if (inFlight.current) {
      again.current = true;
      return inFlight.current;
    }
    const run = (async () => {
      do {
        again.current = false;
        const sent = rev.current;
        const { name: n, countersign: c, fields: f } = latest.current;
        setSave({ state: "saving" });
        try {
          const res = await fetch(`/api/templates/${props.templateId}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pdfSha256: props.pdfSha256, name: n.trim() || "Untitled agreement", countersign: c, fields: f }),
          });
          if (res.status === 401) return router.push(`/login?next=/templates/${props.templateId}`);
          if (res.status === 409) return router.refresh();
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? "Save failed");
          setSave({ state: rev.current === sent ? "saved" : "dirty" });
          if (rev.current !== sent) again.current = true;
        } catch (e) {
          setSave({ state: "error", message: (e as Error).message });
          return;
        }
      } while (again.current && !appendingRef.current);
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, [props.templateId, props.pdfSha256, router]);

  useEffect(() => {
    if (first.current) {
      first.current = false; // nothing to save on load; validation runs client-side
      return;
    }
    rev.current++;
    setSave({ state: "dirty" });
    const t = setTimeout(() => void saveNow(), 700);
    return () => clearTimeout(t);
  }, [fields, name, countersign, saveNow]);

  const problems = useMemo(() => validateFields(fields, rolesFor(countersign), props.pages.length), [fields, countersign, props.pages.length]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save.state === "dirty" || save.state === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.state]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key === "Escape") {
        setArmed(null);
        setSelected(null);
        return;
      }
      const f = fields.find((x) => x.id === selected);
      if (!f) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove(f.id);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const copy = { ...f, id: uid(), y: clamp(f.y + f.h + 0.01, 0, 1 - f.h), source: "manual" as const, confidence: 1 };
        commit((prev) => [...prev, copy]);
        setSelected(copy.id);
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 0.01 : 0.002;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        update(f.id, { x: clamp(f.x + dx, 0, 1 - f.w), y: clamp(f.y + dy, 0, 1 - f.h) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fields, selected, undo, remove, update, commit]);

  // ---- placing a new field ----
  function placeAt(page: DisplayPage, fx: number, fy: number, keepArmed: boolean) {
    if (!armed) return;
    const meta = FIELD_META[armed];
    const w = Math.min(meta.w / page.width, 0.9);
    const h = Math.min(meta.h / page.height, 0.5);
    const f: FieldDef = {
      id: uid(),
      page: page.page,
      x: clamp(fx - w / 2, 0, 1 - w),
      y: clamp(fy - h / 2, 0, 1 - h),
      w,
      h,
      type: armed,
      roleKey: armed === "firm_fill" ? null : countersign ? lastRole : "client",
      label: meta.label,
      required: armed !== "checkbox" && armed !== "text",
      confidence: 1,
      source: "manual",
      ...(armed === "firm_fill" ? { firmFillKey: `fill_${Date.now().toString(36)}` } : {}),
    };
    commit((prev) => [...prev, f]);
    setSelected(f.id);
    if (!keepArmed) setArmed(null);
  }

  // ---- drag / resize ----
  function startDrag(e: React.PointerEvent, f: FieldDef, mode: "move" | "resize") {
    e.stopPropagation();
    e.preventDefault();
    setSelected(f.id);
    const el = pageEls.current.get(f.page);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const start = { ...f };
    let moved = false;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / rect.width;
      const dy = (ev.clientY - sy) / rect.height;
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return;
      if (!moved) {
        moved = true;
        history.current.push(fields);
      }
      if (mode === "move") update(f.id, { x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) }, false);
      else update(f.id, { w: clamp(start.w + dx, 0.015, 1 - start.x), h: clamp(start.h + dy, 0.008, 1 - start.y) }, false);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  // ---- signers ----
  function toggleCountersign(on: boolean) {
    if (!on) {
      const firm = fields.filter((f) => f.roleKey === "firm");
      if (firm.length && !window.confirm(`Turn off countersigning? The ${firm.length} firm field${firm.length > 1 ? "s" : ""} will be removed.`)) return;
      commit((prev) => prev.filter((f) => f.roleKey !== "firm"));
      setLastRole("client");
    }
    setCountersign(on);
  }

  async function appendPage() {
    setAppending(true);
    await saveNow();
    appendingRef.current = true; // pause autosave until the editor remounts with the new PDF
    const res = await fetch(`/api/templates/${props.templateId}/signature-page`, { method: "POST" });
    setAppending(false);
    if (!res.ok) {
      appendingRef.current = false;
      const data = await res.json().catch(() => ({}));
      setBanner(data.error ?? "Couldn't add the signature page.");
      return;
    }
    router.refresh(); // remounts the editor with the new PDF and fields
  }

  function scrollTo(f: FieldDef) {
    setSelected(f.id);
    pageEls.current.get(f.page)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const sel = fields.find((f) => f.id === selected) ?? null;
  const flagged = fields.filter(needsReview);
  const counts = { client: fields.filter((f) => f.roleKey === "client").length, firm: fields.filter((f) => f.roleKey === "firm").length };
  const noFields = fields.length === 0;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* ---- main column ---- */}
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            aria-label="Template name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-semibold hover:border-border focus:border-brand focus:bg-surface focus:outline-none"
          />
          <SaveBadge save={save} onRetry={saveNow} />
        </div>

        {/* palette */}
        <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-border bg-background/95 px-4 py-2 backdrop-blur" role="toolbar" aria-label="Add a field">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <span className="mr-1 shrink-0 text-xs font-medium text-muted">Add:</span>
            {PALETTE.map((t) => (
              <button
                key={t}
                type="button"
                title={FIELD_META[t].hint}
                aria-pressed={armed === t}
                onClick={() => setArmed(armed === t ? null : t)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${armed === t ? "border-brand bg-brand text-white" : "border-border bg-surface hover:border-neutral-400"}`}
              >
                {FIELD_META[t].label}
              </button>
            ))}
          </div>
          {armed && (
            <p className="mt-1 text-xs text-brand" role="status">
              Click on the page to place a <strong>{FIELD_META[armed].label}</strong> field. Shift-click to place several. Esc to cancel.
            </p>
          )}
        </div>

        {props.isNew && !noFields && (
          <div className="mb-3">
            <Alert tone="info">
              We found <strong>{fields.length}</strong> field{fields.length === 1 ? "" : "s"}
              {flagged.length ? (
                <>
                  , <strong>{flagged.length}</strong> marked ⚠ for you to check
                </>
              ) : null}
              . Drag to move, drag the corner to resize, click a field to change its type or signer.
            </Alert>
          </div>
        )}
        {noFields && (
          <div className="mb-3">
            <Card className="border-amber-300 bg-amber-50 p-4">
              <p className="font-medium text-amber-900">
                {props.signaturePageAppended ? "No fields yet." : "We didn't find any signature fields in this document."}
              </p>
              <p className="mt-1 text-sm text-amber-900/80">
                {props.detection?.outcome === "no_text" ? "It looks scanned (no selectable text). " : ""}
                Add a signature page at the end, or place the fields yourself.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {!props.signaturePageAppended && (
                  <Button onClick={appendPage} disabled={appending}>
                    {appending ? "Adding page…" : "Append a signature page"}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setArmed("signature")}>
                  Place fields myself
                </Button>
              </div>
            </Card>
          </div>
        )}
        {banner && (
          <div className="mb-3">
            <Alert>{banner}</Alert>
          </div>
        )}

        <div
          className={armed ? "cursor-crosshair" : ""}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <PdfPages
            url={props.pdfUrl}
            pages={props.pages}
            onPageRef={(n, el) => (el ? pageEls.current.set(n, el) : pageEls.current.delete(n))}
            overlay={(page) => (
              <div
                className="absolute inset-0"
                data-testid={`page-${page.page}`}
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (armed) {
                    const r = e.currentTarget.getBoundingClientRect();
                    placeAt(page, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.shiftKey);
                  } else setSelected(null);
                }}
              >
                {fields
                  .filter((f) => f.page === page.page)
                  .map((f) => (
                    <FieldBox key={f.id} f={f} selected={f.id === selected} onPointerDown={(e, mode) => startDrag(e, f, mode)} />
                  ))}
              </div>
            )}
          />
        </div>
      </div>

      {/* ---- side panel ---- */}
      <aside className="flex w-full shrink-0 flex-col gap-3 lg:sticky lg:top-4 lg:w-80">
        {sel ? (
          <Inspector
            f={sel}
            countersign={countersign}
            firmName={props.firmName}
            onChange={(patch) => {
              if (patch.roleKey === "client" || patch.roleKey === "firm") setLastRole(patch.roleKey);
              update(sel.id, patch);
            }}
            onDelete={() => remove(sel.id)}
            onClose={() => setSelected(null)}
          />
        ) : (
          <Card className="p-4 text-sm text-muted">Select a field to change its type or signer. Pick a type above, then click the page to add one.</Card>
        )}

        <Card className="p-4">
          <h2 className="text-sm font-semibold">Signers</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> Client <span className="ml-auto text-muted">{counts.client} fields</span>
            </li>
            <li className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${countersign ? "bg-violet-600" : "bg-neutral-300"}`} /> {props.firmName} countersigns
              <span className="ml-auto text-muted">{countersign ? `${counts.firm} fields` : "off"}</span>
            </li>
          </ul>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={countersign} onChange={(e) => toggleCountersign(e.target.checked)} />
            Firm countersigns after the client
          </label>
        </Card>

        {flagged.length > 0 && (
          <Card className="p-4" data-testid="review-list">
            <h2 className="text-sm font-semibold">
              Check {flagged.length} field{flagged.length > 1 ? "s" : ""} <span className="text-amber-600">⚠</span>
            </h2>
            <p className="mt-1 text-xs text-muted">We weren&apos;t sure about these. Move or edit them, or confirm they&apos;re right.</p>
            <ul className="mt-2 divide-y divide-border">
              {flagged.map((f) => (
                <li key={f.id} className="flex items-center gap-2 py-2 text-sm">
                  <button type="button" onClick={() => scrollTo(f)} className="min-w-0 flex-1 text-left hover:underline" title={f.reason}>
                    <span className="font-medium">{f.label}</span> <span className="text-muted">· p{f.page} · {f.roleKey ?? "you"}</span>
                    <span className="block text-xs text-amber-700">{Math.round(f.confidence * 100)}% sure</span>
                  </button>
                  <button type="button" onClick={() => update(f.id, { reviewed: true })} className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-neutral-50">
                    Looks right
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="p-4">
          {problems.length > 0 ? (
            <div className="mb-3 space-y-1" data-testid="problems">
              {problems.map((p) => (
                <p key={p} className="text-sm text-red-700">
                  • {p}
                </p>
              ))}
            </div>
          ) : (
            <p className="mb-3 text-sm text-green-700" data-testid="ready">
              ✓ Ready to send
            </p>
          )}
          {!props.signaturePageAppended && !noFields && (
            <button type="button" onClick={appendPage} disabled={appending} className="mb-3 text-sm text-brand hover:underline disabled:opacity-60">
              {appending ? "Adding signature page…" : "+ Append a signature page instead"}
            </button>
          )}
          <ButtonLink href="/templates" variant="secondary" className="w-full">
            Done
          </ButtonLink>
          {props.detection?.notes?.length ? <p className="mt-3 text-xs text-muted">{props.detection.notes.join(" ")}</p> : null}
        </Card>
      </aside>
    </div>
  );
}

function FieldBox({ f, selected, onPointerDown }: { f: FieldDef; selected: boolean; onPointerDown: (e: React.PointerEvent, mode: "move" | "resize") => void }) {
  const c = ROLE_COLORS[f.roleKey ?? "none"] ?? ROLE_COLORS.none;
  const flag = needsReview(f);
  const showConf = f.source !== "manual" && f.source !== "appended";
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${f.label} field for ${f.roleKey ?? "you"}${flag ? ", needs review" : ""}`}
      data-testid="field"
      data-field-type={f.type}
      data-role={f.roleKey ?? "none"}
      data-flagged={flag ? "true" : "false"}
      title={f.reason ? `${f.label} · ${Math.round(f.confidence * 100)}% · ${f.reason}` : f.label}
      onPointerDown={(e) => onPointerDown(e, "move")}
      className={`group absolute select-none touch-none rounded-[3px] ${selected ? "z-10 ring-2 ring-offset-1" : ""}`}
      style={{
        left: `${f.x * 100}%`,
        top: `${f.y * 100}%`,
        width: `${f.w * 100}%`,
        height: `${f.h * 100}%`,
        background: c.bg,
        border: `1.5px ${flag ? "dashed" : "solid"} ${flag ? "#d97706" : c.border}`,
        cursor: "move",
        // ring color
        ["--tw-ring-color" as string]: c.border,
      }}
    >
      <span className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-1 text-[10px] font-medium leading-none sm:text-[11px]" style={{ color: c.text }}>
        {f.type === "checkbox" ? "☐" : f.label}
      </span>
      {(showConf || flag) && (
        <span
          className={`pointer-events-none absolute -top-2 right-0 translate-y-[-50%] rounded px-1 text-[9px] font-semibold leading-tight ${flag ? "bg-amber-500 text-white" : "bg-white/90 text-neutral-600 ring-1 ring-neutral-200"}`}
          data-testid="confidence"
        >
          {flag ? "⚠ " : ""}
          {Math.round(f.confidence * 100)}%
        </span>
      )}
      <span
        aria-hidden
        onPointerDown={(e) => onPointerDown(e, "resize")}
        data-testid="resize-handle"
        className={`absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border bg-white ${selected ? "" : "opacity-0 group-hover:opacity-100"}`}
        style={{ borderColor: c.border }}
      />
    </div>
  );
}

function Inspector({
  f,
  countersign,
  firmName,
  onChange,
  onDelete,
  onClose,
}: {
  f: FieldDef;
  countersign: boolean;
  firmName: string;
  onChange: (p: Partial<FieldDef>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const editableLabel = f.type === "text" || f.type === "firm_fill" || f.type === "checkbox";
  return (
    <Card className="p-4" data-testid="inspector">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Field</h2>
        <button type="button" onClick={onClose} className="text-sm text-muted hover:text-foreground" aria-label="Close">
          ✕
        </button>
      </div>

      <p className="mt-3 text-xs font-medium text-muted">Type</p>
      <div className="mt-1 flex flex-wrap gap-1" role="radiogroup" aria-label="Field type">
        {PALETTE.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={f.type === t}
            onClick={() =>
              onChange({
                type: t,
                label: editableLabel && (t === "text" || t === "firm_fill" || t === "checkbox") ? f.label : FIELD_META[t].label,
                roleKey: t === "firm_fill" ? null : (f.roleKey ?? "client"),
                required: t !== "checkbox" && t !== "text",
                ...(t === "firm_fill" && !f.firmFillKey ? { firmFillKey: `fill_${Date.now().toString(36)}` } : {}),
              })
            }
            className={`rounded-md border px-2 py-1 text-xs ${f.type === t ? "border-brand bg-brand text-white" : "border-border hover:border-neutral-400"}`}
          >
            {FIELD_META[t].label}
          </button>
        ))}
      </div>

      {f.type !== "firm_fill" ? (
        <>
          <p className="mt-3 text-xs font-medium text-muted">Filled by</p>
          <div className="mt-1 grid grid-cols-2 gap-1" role="radiogroup" aria-label="Signer">
            {(["client", "firm"] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={f.roleKey === r}
                disabled={r === "firm" && !countersign}
                onClick={() => onChange({ roleKey: r })}
                className={`rounded-md border px-2 py-1.5 text-sm disabled:opacity-40 ${f.roleKey === r ? `${ROLE_COLORS[r].chip} border-transparent text-white` : "border-border hover:border-neutral-400"}`}
              >
                {r === "client" ? "Client" : firmName}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-muted">You fill this in when you create a File (e.g. fee or start date). It&apos;s stamped onto the document before sending.</p>
      )}

      {editableLabel && (
        <label className="mt-3 block text-xs font-medium text-muted">
          Label
          <input
            value={f.label}
            maxLength={60}
            onChange={(e) => onChange({ label: e.target.value || "Text" })}
            className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm text-foreground focus:border-brand focus:outline-none"
          />
        </label>
      )}

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.required} onChange={(e) => onChange({ required: e.target.checked })} /> Required
      </label>

      {f.source !== "manual" && (
        <p className="mt-3 text-xs text-muted" data-testid="field-confidence">
          {f.source === "appended" ? "Added with the signature page." : `Detected · ${Math.round(f.confidence * 100)}% sure${f.reviewed ? " · checked" : ""}`}
          {f.reason ? <span className="block">{f.reason}</span> : null}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        {needsReview(f) && (
          <Button variant="secondary" className="flex-1 py-1.5" onClick={() => onChange({ reviewed: true })}>
            Looks right
          </Button>
        )}
        <Button variant="danger" className="flex-1 py-1.5" onClick={onDelete}>
          Delete
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted">Arrow keys nudge · ⌘D duplicate · ⌘Z undo · Delete removes</p>
    </Card>
  );
}

function SaveBadge({ save, onRetry }: { save: Save; onRetry: () => void }) {
  if (save.state === "error")
    return (
      <button type="button" onClick={onRetry} className="text-sm text-red-700 underline" title={save.message}>
        Not saved, retry
      </button>
    );
  return (
    <span className="text-sm text-muted" role="status" data-testid="save-state">
      {save.state === "saving" ? "Saving…" : save.state === "dirty" ? "Unsaved changes" : "All changes saved"}
    </span>
  );
}

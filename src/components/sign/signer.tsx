"use client";

import { useMemo, useRef, useState } from "react";
import { PdfPages, type DisplayPage } from "@/components/editor/pdf-pages";
import type { FieldDef } from "@/lib/fields/types";
import { SignaturePad } from "./signature-pad";

interface Props {
  token: string;
  brand: { name: string; color: string };
  documentName: string;
  clientLegalName: string;
  recipient: { name: string; role: "client" | "firm" };
  consented: boolean;
  consentText: string;
  pages: DisplayPage[];
  fields: FieldDef[];
  myRole: string;
  shown: Record<string, string>;
  prefill: Record<string, string>;
  /** Present when the logged-in user is this signer (countersigner). */
  quick: { savedSignature: string | null } | null;
}

const INPUT_TYPES = new Set(["full_name", "title", "company", "text"]);
const isImage = (v: string) => v.startsWith("data:image/");

export function Signer(p: Props) {
  const [consented, setConsented] = useState(p.consented);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(p.prefill);
  const [adopted, setAdopted] = useState<{ signature?: string; initials?: string }>({});
  const [pad, setPad] = useState<{ field: FieldDef } | null>(null);
  const [sheet, setSheet] = useState<{ field: FieldDef; value: string } | null>(null);
  const [done, setDone] = useState<{ completed: boolean; nextName: string | null } | null>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());

  const mine = useMemo(
    () => p.fields.filter((f) => f.roleKey === p.myRole && f.type !== "firm_fill" && f.type !== "agreement_date").sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x),
    [p.fields, p.myRole],
  );
  const todo = mine.filter((f) => f.type !== "date_signed" && f.required && !(values[f.id] ?? "").trim());
  const fillable = mine.filter((f) => f.type !== "date_signed");
  const doneCount = fillable.filter((f) => (values[f.id] ?? "").trim()).length;

  async function quickSign() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/sign/${p.token}/quick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(`${data.error ?? "That didn't work."} You can sign the usual way below.`);
    setDone(data);
  }

  async function consent() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/sign/${p.token}/consent`, { method: "POST" });
    setBusy(false);
    if (res.ok) setConsented(true);
    else setError((await res.json().catch(() => ({}))).error ?? "Something went wrong. Please reload the page.");
  }

  function open(f: FieldDef) {
    setError(null);
    if (f.type === "signature" || f.type === "initials") {
      const a = adopted[f.type];
      if (a && !values[f.id]) return setValues((v) => ({ ...v, [f.id]: a })); // one tap once adopted
      return setPad({ field: f });
    }
    if (f.type === "checkbox") return setValues((v) => ({ ...v, [f.id]: v[f.id] === "true" ? "" : "true" }));
    if (INPUT_TYPES.has(f.type)) return setSheet({ field: f, value: values[f.id] ?? "" });
  }

  function next() {
    const f = todo[0];
    if (!f) return;
    pageEls.current.get(f.page)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => open(f), 250);
  }

  async function finish() {
    setBusy(true);
    setError(null);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await fetch(`/api/sign/${p.token}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values, timezone }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong. Please try again.");
    setDone(data);
    window.scrollTo({ top: 0 });
  }

  const header = (
    <header className="sticky top-0 z-30 border-b-4 bg-surface px-4 py-3" style={{ borderColor: p.brand.color }}>
      <div className="mx-auto flex max-w-[900px] items-center gap-3">
        <span className="font-semibold">{p.brand.name}</span>
        <span className="min-w-0 truncate text-sm text-muted">{p.documentName}</span>
      </div>
    </header>
  );

  if (done)
    return (
      <main className="min-h-dvh" style={{ ["--brand" as string]: p.brand.color }}>
        {header}
        <div className="mx-auto mt-16 max-w-md px-4 text-center" data-testid="sign-done">
          <h1 className="text-2xl font-semibold">You&apos;ve signed</h1>
          <p className="mt-3 text-muted">
            Thanks, {p.recipient.name.split(" ")[0]}.{" "}
            {done.completed ? `Everyone has signed. ${p.brand.name} will send all parties the signed copy.` : `${done.nextName ?? p.brand.name} signs next. You'll get the signed copy when it's complete.`}
          </p>
          {done.completed && (
            <a href={`/api/sign/${p.token}/download`} className="mt-5 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white" data-testid="signer-download">
              Download the signed copy
            </a>
          )}
        </div>
      </main>
    );

  if (!consented)
    return (
      <main className="min-h-dvh" style={{ ["--brand" as string]: p.brand.color }}>
        {header}
        <div className="mx-auto mt-10 max-w-lg px-4">
          <div className="rounded-xl border border-border bg-surface p-6">
            <p className="text-sm text-muted">{p.recipient.role === "firm" ? "Countersign" : `For ${p.clientLegalName}`}</p>
            <h1 className="mt-1 text-xl font-semibold">{p.documentName}</h1>
            <p className="mt-2 text-sm">
              {p.brand.name} asked you, {p.recipient.name}, to review and sign this agreement.
            </p>
            <div className="mt-4 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-700">
              <p className="font-medium">Electronic signature consent</p>
              <p className="mt-1">{p.consentText}</p>
            </div>
            {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
            {p.quick?.savedSignature && (
              <div className="mt-4 rounded-lg border border-border p-3" data-testid="quick-sign">
                <p className="text-sm font-medium">Countersign with your saved signature</p>
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
                <img src={p.quick.savedSignature} alt="Your saved signature" className="mt-2 h-10 max-w-56 object-contain object-left" />
                <p className="mt-2 text-xs text-muted">Your name, title and today&apos;s date are filled in for you.</p>
                <button type="button" onClick={quickSign} disabled={busy} className="mt-3 w-full rounded-lg bg-brand px-4 py-3 font-medium text-white disabled:opacity-60">
                  {busy ? "Signing…" : "I agree, sign with my saved signature"}
                </button>
              </div>
            )}
            {p.quick && !p.quick.savedSignature && (
              <p className="mt-3 text-xs text-muted">
                Tip: save your signature in <a href="/settings" className="underline">Settings</a> to countersign in one click next time.
              </p>
            )}
            <button
              type="button"
              onClick={consent}
              disabled={busy}
              className={`mt-4 w-full rounded-lg px-4 py-3 font-medium disabled:opacity-60 ${p.quick?.savedSignature ? "border border-border" : "bg-brand text-white"}`}
            >
              {busy ? "One moment…" : p.quick?.savedSignature ? "Review and sign the usual way" : "I agree, review the agreement"}
            </button>
          </div>
        </div>
      </main>
    );

  return (
    <main className="min-h-dvh pb-28" style={{ ["--brand" as string]: p.brand.color }}>
      {header}
      <div className="mx-auto max-w-[900px] px-2 py-4 sm:px-4">
        <PdfPages
          url={`/api/sign/${p.token}/pdf`}
          pages={p.pages}
          onPageRef={(n, el) => (el ? pageEls.current.set(n, el) : pageEls.current.delete(n))}
          overlay={(page) => (
            <div className="absolute inset-0" style={{ containerType: "size" }}>
              {p.fields
                .filter((f) => f.page === page.page)
                .map((f) => {
                  const mineField = f.roleKey === p.myRole && f.type !== "firm_fill" && f.type !== "agreement_date";
                  const v = mineField ? values[f.id] ?? "" : p.shown[f.id] ?? "";
                  // Values rest on the field's line: bottom-aligned, normal type size (≤ 11 pt), never
                  // taller than the field box (which detection keeps clear of printed text).
                  const fontPt = Math.min(f.h * page.height * 0.8, 11);
                  const style = { left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, fontSize: `${(fontPt / page.height) * 100}cqh` };
                  const content =
                    f.type === "checkbox" ? (v === "true" ? "✓" : "") : f.type === "date_signed" && mineField ? "" : isImage(v) ? (
                      // eslint-disable-next-line @next/next/no-img-element -- inline data URL, nothing to optimize
                      <img src={v} alt="Signature" className="h-full w-full object-contain object-left-bottom" />
                    ) : (
                      v
                    );
                  if (!mineField)
                    return v ? (
                      <div key={f.id} data-testid="stamped-value" className="pointer-events-none absolute flex items-end overflow-hidden whitespace-nowrap px-0.5 pb-px leading-none text-neutral-900" style={style}>
                        {content}
                      </div>
                    ) : null;
                  const empty = f.type !== "date_signed" && !v.trim();
                  return (
                    <button
                      key={f.id}
                      type="button"
                      data-testid={`sign-field-${f.type}`}
                      onClick={() => open(f)}
                      disabled={f.type === "date_signed"}
                      title={f.type === "date_signed" ? "The date is added automatically when you sign" : undefined}
                      className={`absolute flex items-end overflow-hidden whitespace-nowrap rounded-[3px] px-0.5 pb-px text-left leading-none ${empty ? "animate-pulse border-2 border-dashed" : f.type === "date_signed" ? "border border-dashed" : "border border-transparent hover:border-dashed"}`}
                      style={{ ...style, borderColor: empty ? p.brand.color : f.type === "date_signed" ? `${p.brand.color}66` : undefined, background: empty ? `${p.brand.color}22` : "transparent", color: empty ? p.brand.color : "#111" }}
                      aria-label={f.type === "date_signed" ? "Date signed: added automatically when you sign" : `${f.label}${empty ? " (required)" : ""}`}
                    >
                      {empty ? (f.type === "signature" ? "Sign here" : f.type === "initials" ? "Initial" : f.label) : content}
                    </button>
                  );
                })}
            </div>
          )}
        />
      </div>

      {/* guided bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[900px] items-center gap-3">
          <span className="text-sm text-muted" data-testid="sign-progress">
            {doneCount} of {fillable.length} done
          </span>
          {error && <span className="min-w-0 flex-1 truncate text-sm text-red-700">{error}</span>}
          <div className="ml-auto flex gap-2">
            {todo.length > 0 ? (
              <button type="button" onClick={next} className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white">
                {doneCount === 0 ? "Start" : "Next field"}
              </button>
            ) : (
              <button type="button" onClick={finish} disabled={busy} className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60">
                {busy ? "Signing…" : "Finish and sign"}
              </button>
            )}
          </div>
        </div>
      </div>

      {pad && (
        <SignaturePad
          kind={pad.field.type === "initials" ? "initials" : "signature"}
          defaultName={p.recipient.name}
          onCancel={() => setPad(null)}
          onDone={(png) => {
            const kind = pad.field.type === "initials" ? "initials" : "signature";
            setAdopted((a) => ({ ...a, [kind]: png }));
            setValues((v) => ({ ...v, [pad.field.id]: png }));
            setPad(null);
          }}
        />
      )}
      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={sheet.field.label}>
          <form
            className="w-full max-w-md rounded-t-2xl bg-surface p-4 sm:rounded-2xl"
            onSubmit={(e) => {
              e.preventDefault();
              setValues((v) => ({ ...v, [sheet.field.id]: sheet.value.trim() }));
              setSheet(null);
            }}
          >
            <label className="block text-sm font-medium">
              {sheet.field.label}
              <input autoFocus value={sheet.value} maxLength={300} onChange={(e) => setSheet({ ...sheet, value: e.target.value })} className="mt-2 w-full rounded-lg border border-border px-3 py-2.5 text-base" />
            </label>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setSheet(null)} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm">
                Cancel
              </button>
              <button type="submit" className="flex-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white">
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

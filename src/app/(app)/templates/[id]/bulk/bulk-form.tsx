"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card } from "@/components/ui";
import { autoMap, type Column, parseCsv } from "@/lib/bulk/core";

type PreviewRow = { rowNo: number; status: "ready" | "invalid" | "duplicate" | "already_sent"; reasons: string[]; values: { clientLegalName: string; signerName: string; signerEmail: string }; previous: { fileId: string; at: string } | null };
type Preview = { rows: PreviewRow[]; counts: { total: number; ready: number; invalid: number; duplicate: number; already_sent: number }; resultCsv: string };

const STATUS: Record<PreviewRow["status"], string> = { ready: "Ready", invalid: "Invalid", duplicate: "Duplicate", already_sent: "Already sent" };

export function BulkForm({ templateId, columns }: { templateId: string; columns: Column[] }) {
  const router = useRouter();
  const [csv, setCsv] = useState<{ text: string; name: string; headers: string[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resend, setResend] = useState<number[]>([]);
  const [sendNow, setSendNow] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function onFile(f: File | undefined) {
    setPreview(null);
    setConfirming(false);
    setError(null);
    if (!f) return setCsv(null);
    const text = await f.text();
    const headers = parseCsv(text)[0] ?? [];
    setCsv({ text, name: f.name, headers });
    setMapping(autoMap(headers, columns));
    setResend([]);
  }

  const body = (r = resend) => JSON.stringify({ csv: csv!.text, filename: csv!.name, mapping, resend: r, sendNow });

  async function validate(r = resend) {
    setBusy(true);
    setError(null);
    setConfirming(false);
    const res = await fetch(`/api/templates/${templateId}/bulk/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: body(r) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Couldn't read that CSV.");
    setPreview(data);
  }

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/templates/${templateId}/bulk/start`, { method: "POST", headers: { "content-type": "application/json" }, body: body() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      return setError(data.error ?? "Couldn't start the bulk send.");
    }
    router.push(`/bulk/${data.batchId}`);
  }

  function toggleResend(rowNo: number, on: boolean) {
    const next = on ? [...resend, rowNo] : resend.filter((n) => n !== rowNo);
    setResend(next);
    void validate(next);
  }

  function downloadValidation() {
    const url = URL.createObjectURL(new Blob([preview!.resultCsv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `validation-${csv!.name.replace(/\.csv$/i, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ready = preview?.counts.ready ?? 0;
  const skipped = preview ? preview.counts.total - ready : 0;

  return (
    <div className="flex flex-col gap-4">
      <Card
        className={`flex flex-col gap-3 p-5 transition ${dragging ? "border-brand bg-brand/5" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void onFile(e.dataTransfer.files?.[0]);
        }}
        data-testid="csv-drop"
      >
        <p className="text-sm font-medium">CSV file</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition hover:border-neutral-400 focus-within:ring-2 focus-within:ring-brand/30">
            Choose CSV file
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="bulk-upload" />
          </label>
          <span className="min-w-0 truncate text-sm text-muted" data-testid="csv-name">
            {csv ? csv.name : "or drop it here"}
          </span>
        </div>
        {csv && (
          <div className="mt-2" data-testid="mapping">
            <p className="text-sm font-medium">Match your CSV columns</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {columns.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm">
                  <span className="w-40 shrink-0">
                    {c.label}
                    {c.required ? <span className="text-red-700"> *</span> : null}
                  </span>
                  <select
                    aria-label={`CSV column for ${c.label}`}
                    data-testid={`map-${c.key}`}
                    value={mapping[c.key] ?? -1}
                    onChange={(e) => {
                      setMapping({ ...mapping, [c.key]: Number(e.target.value) });
                      setPreview(null);
                    }}
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5"
                  >
                    <option value={-1}>(not in this CSV)</option>
                    {csv.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={() => void validate()} disabled={busy} data-testid="validate">
                {busy && !preview ? "Checking…" : "Validate (nothing is sent)"}
              </Button>
            </div>
          </div>
        )}
        {error && <Alert>{error}</Alert>}
      </Card>

      {preview && (
        <Card className="flex flex-col gap-3 p-5" data-testid="preview">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm" data-testid="preview-summary">
              <strong>{ready}</strong> ready to send{skipped ? <>, <strong>{skipped}</strong> will be skipped</> : null}.
            </p>
            <button type="button" onClick={downloadValidation} className="text-sm text-brand underline" data-testid="validation-csv">
              Download validation result (CSV)
            </button>
          </div>
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-neutral-50 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Signer</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.rows.map((r) => (
                  <tr key={r.rowNo} data-testid="preview-row" data-status={r.status} className={r.status === "ready" ? "" : "bg-amber-50/60"}>
                    <td className="px-3 py-2 text-muted">{r.rowNo}</td>
                    <td className="px-3 py-2">{r.values.clientLegalName || "—"}</td>
                    <td className="px-3 py-2">
                      {r.values.signerName || "—"} <span className="block text-xs text-muted">{r.values.signerEmail}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={r.status === "ready" ? "text-green-700" : "text-amber-800"}>{STATUS[r.status]}</span>
                      {r.reasons.length > 0 && <span className="block text-xs text-muted" data-testid="row-reason">{r.reasons.join("; ")}</span>}
                      {(r.status === "already_sent" || resend.includes(r.rowNo)) && (
                        <label className="mt-1 flex items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={resend.includes(r.rowNo)} onChange={(e) => toggleResend(r.rowNo, e.target.checked)} data-testid={`resend-${r.rowNo}`} />
                          Resend
                        </label>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} data-testid="bulk-send-now" />
            Send immediately (off: save each File as a Draft)
          </label>
          {ready > 0 &&
            (confirming ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm" data-testid="confirm-panel">
                <span>
                  {sendNow ? `Send ${ready} File${ready === 1 ? "" : "s"} now? Each client gets a signing email.` : `Create ${ready} draft File${ready === 1 ? "" : "s"}? Nothing is emailed.`}
                </span>
                <Button onClick={() => void start()} disabled={busy} data-testid="confirm-start">
                  {busy ? "Starting…" : sendNow ? "Yes, send them" : "Yes, create drafts"}
                </Button>
                <button type="button" className="text-sm underline" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <Button className="self-start" onClick={() => setConfirming(true)} disabled={busy} data-testid="start">
                {sendNow ? `Send ${ready} File${ready === 1 ? "" : "s"}` : `Create ${ready} draft${ready === 1 ? "" : "s"}`}
              </Button>
            ))}
        </Card>
      )}
    </div>
  );
}

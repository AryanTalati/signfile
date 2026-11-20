"use client";

import { useState } from "react";

type Mode = null | "changes" | "decline";

/** "Request changes" / "Decline to sign" for a signer who hasn't signed. */
export function RespondActions({ token, firmName, onDone }: { token: string; firmName: string; onDone: (state: "declined" | "changes_requested") => void }) {
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (mode === "decline" && !confirm) return setConfirm(true);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/sign/${token}/${mode === "decline" ? "decline" : "request-changes"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong.");
    onDone(mode === "decline" ? "declined" : "changes_requested");
  }

  return (
    <>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
        <button type="button" onClick={() => (setMode("changes"), setConfirm(false), setError(null))} className="text-muted underline hover:text-foreground">
          Request changes
        </button>
        <button type="button" onClick={() => (setMode("decline"), setConfirm(false), setError(null))} className="text-muted underline hover:text-red-700">
          Decline to sign
        </button>
      </div>
      {mode && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={mode === "decline" ? "Decline to sign" : "Request changes"}>
          <div className="w-full max-w-md rounded-t-2xl bg-surface p-4 sm:rounded-2xl">
            <h2 className="font-semibold">{mode === "decline" ? "Decline to sign" : "Request changes"}</h2>
            <p className="mt-1 text-sm text-muted">
              {mode === "decline"
                ? `Signing stops for everyone and all parties are emailed your reason. ${firmName} would need to send a new version.`
                : `Signing is paused and ${firmName} gets your message. You'll get a new link if they send a revised version.`}
            </p>
            <label className="mt-3 block text-sm font-medium">
              {mode === "decline" ? "Reason (required)" : "What needs to change? (required)"}
              <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={4} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-base" />
            </label>
            {confirm && mode === "decline" && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="decline-confirm">
                Are you sure? This can&apos;t be undone from your side.
              </p>
            )}
            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setMode(null)} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || text.trim().length < 3}
                onClick={submit}
                className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 ${mode === "decline" ? "bg-red-600" : "bg-brand"}`}
              >
                {busy ? "Sending…" : mode === "decline" ? (confirm ? "Yes, decline" : "Decline") : "Send request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Off by default. Only the signer can turn it on, for their own signature, with explicit consent. */
export function AutoCountersign({ on, since, consentText }: { on: boolean; since: string | null; consentText: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(enabled: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/me/auto-countersign", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled, consent: enabled ? agree : undefined }) });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't save. Try again.");
    setOpen(false);
    setAgree(false);
    router.refresh();
  }

  return (
    <div className="mt-5 border-t border-border pt-4" data-testid="auto-countersign">
      <p className="text-sm font-medium">Countersign automatically after all other signers</p>
      {on ? (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-green-700" data-testid="auto-countersign-status">
            On{since ? ` since ${new Date(since).toLocaleDateString()}` : ""}. Agreements where you countersign complete and seal as soon as the client signs.
          </span>
          <button type="button" disabled={busy} onClick={() => set(false)} className="rounded-lg border border-border px-3 py-1.5 text-sm">
            Turn off
          </button>
        </div>
      ) : !open ? (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
          <span data-testid="auto-countersign-status">Off. You countersign each agreement yourself.</span>
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground">
            Turn on…
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" aria-label="I authorize automatic countersigning" />
            <span>{consentText}</span>
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={!agree || busy} onClick={() => set(true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Turn on automatic countersigning
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

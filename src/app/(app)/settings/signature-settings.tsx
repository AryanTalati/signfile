"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignaturePad } from "@/components/sign/signature-pad";

export function SignatureSettings({ name, saved, adoptText }: { name: string; saved: { signature: string; initials: string } | null; adoptText: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "signature" | "initials" | "confirm">("idle");
  const [draft, setDraft] = useState<{ signature?: string; initials?: string }>({});
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/me/signature", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't save. Try again.");
    setStep("idle");
    setDraft({});
    setAgree(false);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm("Remove your saved signature? You'll sign the usual way until you save a new one.")) return;
    await fetch("/api/me/signature", { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="mt-4" data-testid="signature-settings">
      {saved && step === "idle" && (
        <div className="flex flex-wrap items-end gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
          <img src={saved.signature} alt="Your saved signature" className="h-14 max-w-60 object-contain object-left" />
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
          <img src={saved.initials} alt="Your saved initials" className="h-10 max-w-24 object-contain object-left" />
        </div>
      )}
      {step === "confirm" && draft.signature && draft.initials && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-6">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
            <img src={draft.signature} alt="New signature" className="h-14 max-w-60 object-contain object-left" />
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
            <img src={draft.initials} alt="New initials" className="h-10 max-w-24 object-contain object-left" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
            <span>{adoptText}</span>
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={!agree || busy} onClick={save} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busy ? "Saving…" : "Save my signature"}
            </button>
            <button type="button" onClick={() => setStep("idle")} className="rounded-lg border border-border px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
      {step === "idle" && (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => setStep("signature")} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
            {saved ? "Change signature" : "Set up my signature"}
          </button>
          {saved && (
            <button type="button" onClick={remove} className="rounded-lg border border-border px-4 py-2 text-sm">
              Remove
            </button>
          )}
        </div>
      )}
      {step === "signature" && (
        <SignaturePad kind="signature" defaultName={name} onCancel={() => setStep("idle")} onDone={(png) => (setDraft((d) => ({ ...d, signature: png })), setStep("initials"))} />
      )}
      {step === "initials" && (
        <SignaturePad kind="initials" defaultName={name} onCancel={() => setStep("idle")} onDone={(png) => (setDraft((d) => ({ ...d, initials: png })), setStep("confirm"))} />
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Alert, Button, Card } from "@/components/ui";

type Result = { sha256: string; result: "sealed" | "unsigned_original" | "no_match"; firm?: string; completedAt?: string; signers?: number };

export function VerifyForm() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function check(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setError(null);
    setRes(null);
    const body = new FormData();
    body.append("file", f);
    const r = await fetch("/api/verify", { method: "POST", body });
    const data = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(data.error ?? "Couldn't check that file.");
    setRes(data);
  }
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col items-center gap-3 border-2 border-dashed p-8 text-center">
        <p className="font-medium">{busy ? "Checking…" : "Choose the signed PDF"}</p>
        <label className="cursor-pointer rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white">
          Choose file
          <input type="file" accept="application/pdf,.pdf" className="sr-only" data-testid="verify-input" onChange={(e) => check(e.target.files?.[0])} />
        </label>
      </Card>
      {error && <Alert>{error}</Alert>}
      {res?.result === "sealed" && (
        <Alert tone="success">
          <p className="font-medium" data-testid="verify-result">
            Verified: this is an unaltered signed copy.
          </p>
          <p className="mt-1 text-sm">
            Sealed by signfile for {res.firm} on {res.completedAt ? new Date(res.completedAt).toUTCString() : ""}, signed by {res.signers} part{res.signers === 1 ? "y" : "ies"}.
          </p>
          <p className="mt-1 break-all font-mono text-xs">SHA-256 {res.sha256}</p>
        </Alert>
      )}
      {res?.result === "unsigned_original" && (
        <Alert tone="info">
          <p className="font-medium" data-testid="verify-result">
            This is the unsigned original sent for signature, not the signed copy.
          </p>
        </Alert>
      )}
      {res?.result === "no_match" && (
        <Alert>
          <p className="font-medium" data-testid="verify-result">
            No match. This file isn&apos;t a document sealed by signfile, or it has been changed.
          </p>
          <p className="mt-1 break-all font-mono text-xs">SHA-256 {res.sha256}</p>
        </Alert>
      )}
      <Button type="button" variant="ghost" className="self-start" onClick={() => setRes(null)}>
        Check another file
      </Button>
    </div>
  );
}

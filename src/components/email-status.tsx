"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const LABEL: Record<string, string> = { sent: "Sent", failed: "Failed", captured: "Captured (not sent)", skipped: "Captured (not sent)", queued: "Sending…" };
const CLS: Record<string, string> = { sent: "text-green-700", failed: "text-red-700", captured: "text-muted", skipped: "text-muted", queued: "text-amber-700" };

/** An email's delivery status, with the reason for failed/captured and a retry for failed. */
export function EmailStatus({ id, status, error }: { id: string; status: string; error: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="email-status" data-status={status}>
      <span className={`font-medium ${CLS[status] ?? ""}`}>{LABEL[status] ?? status}</span>
      {(status === "failed" || status === "captured" || status === "skipped") && error && <span className="text-muted">({error})</span>}
      {status === "failed" && (
        <button
          type="button"
          disabled={busy}
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            setBusy(true);
            const r = await fetch(`/api/outbox/${id}/retry`, { method: "POST" });
            const d = await r.json().catch(() => ({}));
            setBusy(false);
            setMsg(r.ok ? (d.result === "sent" ? "Sent" : "Still failing") : (d.error ?? "Retry failed"));
            router.refresh();
          }}
          className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-neutral-50 disabled:opacity-60"
          data-testid="email-retry"
        >
          {busy ? "Retrying…" : "Retry"}
        </button>
      )}
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </span>
  );
}

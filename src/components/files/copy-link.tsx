"use client";

import { useState } from "react";

export function CopyLink({ url, label = "Copy link" }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input readOnly value={url} aria-label="Signing link" onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-md border border-border bg-neutral-50 px-2 py-1.5 font-mono text-xs" data-testid="signing-link" />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard?.writeText(url).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50"
      >
        {copied ? "Copied" : label}
      </button>
    </div>
  );
}

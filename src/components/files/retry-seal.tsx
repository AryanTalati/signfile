"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RetrySeal({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/files/${fileId}/seal`, { method: "POST" });
        setBusy(false);
        router.refresh();
      }}
      className="rounded-lg border border-border px-3 py-2 text-sm"
    >
      {busy ? "Sealing…" : "Retry sealing"}
    </button>
  );
}

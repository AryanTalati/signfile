"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While a run is in progress, poll its status (which also resumes it after a restart) and refresh when it changes. */
export function BatchProgress({ id, running, done }: { id: string; running: boolean; done: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/bulk/${id}`).catch(() => null);
      const d = res?.ok ? await res.json() : null;
      if (!d) return;
      const n = (d.counts?.sent ?? 0) + (d.counts?.draft ?? 0) + (d.counts?.failed ?? 0);
      if (d.status !== "running" || n !== done) router.refresh();
    }, 1500);
    return () => clearInterval(t);
  }, [id, running, done, router]);
  return null;
}

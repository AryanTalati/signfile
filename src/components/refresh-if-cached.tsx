"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Render ids this tab has already shown. */
const seen = new Set<string>();

/**
 * Back/forward (and some quick re-visits) show the router's cached copy of a page, e.g. the
 * Templates list from before an upload. Each server render gets a unique `renderId`; if this
 * exact render was already shown, it's a cached copy, so fetch the page fresh once. No clocks
 * involved, so it can't loop.
 */
export function RefreshIfCached({ renderId }: { renderId: string }) {
  const router = useRouter();
  useEffect(() => {
    if (seen.has(renderId)) router.refresh();
    else seen.add(renderId);
  }, [renderId, router]);
  return null;
}

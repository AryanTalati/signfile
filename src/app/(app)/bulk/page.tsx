import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { Card } from "@/components/ui";
import { requireAuth } from "@/lib/auth/session";
import { listBatches } from "@/lib/bulk/service";
import { batchSummary as summary } from "@/lib/bulk/core";

export const metadata: Metadata = { title: "Bulk sends · signfile" };

export default async function BulkHistoryPage() {
  const auth = await requireAuth();
  const batches = await listBatches(auth);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Bulk sends</h1>
        <p className="mt-1 text-sm text-muted">Every CSV run, with its result. Start one from a template: open it and choose Bulk send from CSV.</p>
      </div>
      {batches.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted">No bulk sends yet.</Card>
      ) : (
        <Card className="divide-y divide-border">
          {batches.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3" data-testid="batch-history-row">
              <Link href={`/bulk/${b.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {b.templateName} <span className="font-normal text-muted">· {b.filename}</span>
              </Link>
              <span className="text-sm text-muted">
                <LocalTime iso={b.createdAt.toISOString()} />
              </span>
              <span className="text-sm">{b.status === "running" ? "Sending…" : summary(b.counts)}</span>
              <a href={`/api/bulk/${b.id}/result.csv`} className="text-sm text-brand underline">
                Result CSV
              </a>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

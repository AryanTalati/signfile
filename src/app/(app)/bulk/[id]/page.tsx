import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { Card } from "@/components/ui";
import { requireAuth } from "@/lib/auth/session";
import { batchSummary as summary } from "@/lib/bulk/core";
import { getBatch } from "@/lib/bulk/service";
import { BatchProgress } from "./progress";

export const metadata: Metadata = { title: "Bulk send · signfile" };

const ROW_STATUS: Record<string, string> = { pending: "Waiting", sent: "Sent", draft: "Draft", skipped: "Skipped", failed: "Failed" };

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const b = await getBatch(auth, (await params).id);
  if (!b) notFound();
  const { batch, rows } = b;
  const c = batch.counts;
  const running = batch.status === "running";
  const done = (c.sent ?? 0) + (c.draft ?? 0) + (c.failed ?? 0);
  const toDo = done + (c.pending ?? 0);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <BatchProgress id={batch.id} running={running} done={done} />
      <div>
        <Link href="/bulk" className="text-sm text-muted hover:underline">
          ← Bulk sends
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{batch.templateName}</h1>
        <p className="mt-1 text-sm text-muted">
          {batch.filename} · <LocalTime iso={batch.createdAt.toISOString()} />
        </p>
      </div>
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium" data-testid="batch-status">
            {running ? `Sending… ${done} of ${toDo}` : "Finished"}
          </p>
          <p className="text-sm text-muted" data-testid="batch-summary">
            {summary(c)}
          </p>
          {running && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100">
              <div className="h-full bg-brand transition-all" style={{ width: `${toDo ? Math.round((done / toDo) * 100) : 0}%` }} />
            </div>
          )}
        </div>
        <a href={`/api/bulk/${batch.id}/result.csv`} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-neutral-50" data-testid="result-csv">
          Download result CSV
        </a>
      </Card>
      <Card className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-muted">
            <tr>
              <th className="px-3 py-2">Row</th>
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Signer</th>
              <th className="px-3 py-2">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const v = r.values as { clientLegalName?: string; signerName?: string; signerEmail?: string };
              return (
                <tr key={r.rowNo} data-testid="batch-row" data-status={r.status}>
                  <td className="px-3 py-2 text-muted">{r.rowNo}</td>
                  <td className="px-3 py-2">{v.clientLegalName || "—"}</td>
                  <td className="px-3 py-2">
                    {v.signerName || "—"} <span className="block text-xs text-muted">{v.signerEmail}</span>
                  </td>
                  <td className="px-3 py-2">
                    {r.fileId ? (
                      <Link href={`/files/${r.fileId}`} className="text-brand underline">
                        {ROW_STATUS[r.status]}
                      </Link>
                    ) : (
                      ROW_STATUS[r.status]
                    )}
                    {r.reason && <span className="block text-xs text-muted">{r.reason}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

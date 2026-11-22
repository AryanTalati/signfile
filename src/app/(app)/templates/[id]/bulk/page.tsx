import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card } from "@/components/ui";
import { requireAuth } from "@/lib/auth/session";
import { bulkSetup } from "@/lib/bulk/service";
import { BulkForm } from "./bulk-form";

export const metadata: Metadata = { title: "Bulk send · signfile" };

export default async function BulkSendPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const setup = await bulkSetup(auth, (await params).id);
  if (!setup) notFound();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link href={`/templates/${setup.template.id}`} className="text-sm text-muted hover:underline">
          ← {setup.template.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Bulk send from CSV</h1>
        <p className="mt-1 text-sm text-muted">One File per client row, each sent like a normal File. Nothing is sent until you check the preview and confirm.</p>
      </div>
      {setup.problems.length > 0 && (
        <Alert>
          This template isn&apos;t ready to send: {setup.problems[0]}{" "}
          <Link className="underline" href={`/templates/${setup.template.id}`}>
            Fix the fields
          </Link>
        </Alert>
      )}
      <Card className="p-5" data-testid="expected-columns">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Columns for this template</h2>
          <a href={`/api/templates/${setup.template.id}/bulk/csv-template`} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-neutral-50" data-testid="csv-template">
            Download CSV template for this template
          </a>
        </div>
        <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {setup.columns.map((c) => (
            <li key={c.key}>
              <code className="text-xs">{c.key}</code> <span className="text-muted">{c.label}{c.required ? "" : " (optional)"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          external_id (optional) tells two rows for the same person apart and is how a re-upload is recognised. A row that already produced a File in the last 90 days is skipped unless you tick Resend.
        </p>
      </Card>
      {setup.problems.length === 0 && <BulkForm templateId={setup.template.id} columns={setup.columns} />}
    </div>
  );
}

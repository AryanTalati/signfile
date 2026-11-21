import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Card } from "@/components/ui";
import { requireAuth } from "@/lib/auth/session";
import { needsReview } from "@/lib/fields/types";
import { listTemplates } from "@/lib/templates/service";
import { randomUUID } from "node:crypto";
import { RefreshIfCached } from "@/components/refresh-if-cached";

export const metadata: Metadata = { title: "Templates · signfile" };

export default async function TemplatesPage() {
  const auth = await requireAuth();
  const templates = await listTemplates(auth);
  return (
    <div className="flex flex-col gap-6">
      <RefreshIfCached renderId={randomUUID()} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Templates</h1>
          <p className="mt-1 text-sm text-muted">Your client agreements, with their signature fields set up once.</p>
        </div>
        <ButtonLink href="/templates/new">Upload agreement</ButtonLink>
      </div>
      {templates.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="font-medium">No templates yet</p>
          <p className="mt-1 text-sm text-muted">Upload your client agreement (PDF or Word). We&apos;ll find the signature fields for you to check.</p>
          <ButtonLink href="/templates/new" className="mt-4">
            Upload agreement
          </ButtonLink>
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {templates.map((t) => {
            const review = t.fields.filter(needsReview).length;
            return (
              <Link key={t.id} href={`/templates/${t.id}`} data-testid="template-row" className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-neutral-50">
                <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                {!t.setupDoneAt && (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700" data-testid="template-draft" title="Uploaded but not finished. Open it to check the fields, then press Done.">
                    Draft
                  </span>
                )}
                <span className="text-sm text-muted">
                  {t.pageCount} page{t.pageCount === 1 ? "" : "s"} · {t.fields.length} field{t.fields.length === 1 ? "" : "s"}
                </span>
                {review > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{review} to review</span>}
                {t.fields.length === 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">No fields</span>}
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}

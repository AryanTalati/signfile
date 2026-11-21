import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { requireAuth } from "@/lib/auth/session";
import { getFile } from "@/lib/files/service";
import { getTemplate } from "@/lib/templates/service";
import { validateFields } from "@/lib/fields/validate";
import { SendRevisionForm } from "./send-form";

export const metadata: Metadata = { title: "Revised version · SignFile" };

type Match = { clean: boolean; summary: { previous: number; matched: number; low: number; added: number; missing: number }; flagged: { id: string; status: "low" | "new" }[]; missing: { label: string; type: string; roleKey: string | null }[] };
const who = (r: string | null) => (r === "firm" ? "your firm" : r === "client" ? "client" : "filled by you");

export default async function RevisePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ template?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const { template } = await searchParams;
  const [data, t] = await Promise.all([getFile(auth, id), template ? getTemplate(auth, template) : null]);
  if (!data || !t || t.template.revisionForFileId !== id) notFound();
  const v = t.version;
  const match = (v.detection as { match?: Match } | null)?.match;
  const flaggedIds = new Set((match?.flagged ?? []).map((f) => f.id));
  const toReview = v.fields.filter((f) => flaggedIds.has(f.id) && !f.reviewed);
  const reviewed = v.fields.filter((f) => flaggedIds.has(f.id) && f.reviewed);
  const problems = validateFields(v.fields, v.roles ?? [], v.pageCount);
  const knownKeys = new Set(Object.keys(data.file.firmValues ?? {}));
  const newFirmFills = v.fields.filter((f) => f.type === "firm_fill" && !knownKeys.has(f.firmFillKey ?? f.id));
  // Pre-fill "What changed?" with the signer's change request (or decline reason).
  const asked = data.recipients.find((r) => r.documentId === data.file.currentDocumentId && (r.changeComment || r.declineReason));
  const prefill = asked?.changeComment ?? asked?.declineReason ?? "";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <Link href={`/files/${id}`} className="text-sm text-muted hover:underline">
          ← {data.file.clientLegalName}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Send the revised version</h1>
        <p className="mt-1 text-sm text-muted">Same signers, order and values as before. Fields were matched to the previous version by their labels and surrounding text.</p>
      </div>

      <Card className="p-4" data-testid="match-summary">
        {match?.clean ? (
          <p className="font-medium text-green-800">All fields matched. Nothing to review.</p>
        ) : (
          <>
            <p className="font-medium" data-testid="match-status">{toReview.length ? "Check the highlighted fields before sending." : "All flagged fields reviewed."}</p>
            <ul className="mt-2 space-y-1 text-sm" data-testid="flagged-fields">
              {toReview.map((f) => (
                <li key={f.id} data-testid="flagged-field">
                  <span className="font-medium">{f.label}</span> <span className="text-muted">({who(f.roleKey)}, page {f.page})</span>{" "}
                  <span className="text-amber-700">{match?.flagged.find((x) => x.id === f.id)?.status === "new" ? "new in this version" : "possible match, check its position"}</span>
                </li>
              ))}
              {reviewed.map((f) => (
                <li key={f.id} className="text-muted">
                  {f.label} ({who(f.roleKey)}): reviewed
                </li>
              ))}
              {match?.missing.map((m, i) => (
                <li key={`m${i}`} className="text-muted" data-testid="missing-field">
                  {m.label} ({who(m.roleKey)}): not found in the new version
                </li>
              ))}
            </ul>
            {toReview.length > 0 && (
              <Link href={`/templates/${t.template.id}?focus=1`} className="mt-3 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white" data-testid="review-flagged">
                Review the highlighted fields
              </Link>
            )}
          </>
        )}
        <p className="mt-2 text-xs">
          <Link href={`/templates/${t.template.id}`} className="text-muted underline" data-testid="review-all">
            Review fields
          </Link>
        </p>
      </Card>

      <SendRevisionForm
        fileId={id}
        templateId={t.template.id}
        prefill={prefill}
        newFirmFills={newFirmFills.map((f) => ({ key: f.firmFillKey ?? f.id, label: f.label }))}
        blocked={toReview.length > 0 ? `Review the ${toReview.length} flagged field${toReview.length > 1 ? "s" : ""} first.` : problems[0] ?? null}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { ButtonLink, Card } from "@/components/ui";
import { requireAuth } from "@/lib/auth/session";
import { validateFields } from "@/lib/fields/validate";
import { listCountersigners } from "@/lib/files/service";
import { isFirmFirst } from "@/lib/fields/validate";
import { getSavedSignature } from "@/lib/users/signature";
import { getTemplate, listTemplates } from "@/lib/templates/service";
import { NewFileForm } from "./new-file-form";
import type { Terms } from "@/lib/ai/review";
import { termOfferFor } from "@/lib/ai/term-offers";
import { isDateFill } from "@/lib/fields/format";

export const metadata: Metadata = { title: "New File · signfile" };

export default async function NewFilePage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const auth = await requireAuth();
  const { template: wanted } = await searchParams;
  const templates = await listTemplates(auth);
  if (!templates.length)
    return (
      <Card className="mx-auto max-w-xl p-10 text-center">
        <p className="font-medium">Upload your agreement first</p>
        <p className="mt-1 text-sm text-muted">A File sends one of your templates to a client.</p>
        <ButtonLink href="/templates/new" className="mt-4">
          Upload agreement
        </ButtonLink>
      </Card>
    );
  const selectedId = wanted && templates.some((t) => t.id === wanted) ? wanted : templates[0].id;
  const [t, team, saved] = await Promise.all([getTemplate(auth, selectedId), listCountersigners(auth), getSavedSignature(auth.user.id)]);
  const v = t!.version;
  const ai = (v.detection as { ai?: { status?: string; terms?: Terms } } | null)?.ai;
  const terms = ai?.status === "ok" && ai.terms ? ai.terms : null;
  const problems = validateFields(v.fields, v.roles ?? [], v.pageCount);
  const firmFill = v.fields
    .filter((f) => f.type === "firm_fill")
    .map((f) => ({ key: f.firmFillKey ?? f.id, label: f.label, required: f.required }))
    .filter((f, i, all) => all.findIndex((x) => x.key === f.key) === i)
    // A key term from the AI review that could fill it, offered for the firm to accept.
    .map((f) => ({ ...f, offer: termOfferFor(f, terms, isDateFill(f)) }));
  const countersign = (v.roles ?? []).some((r) => r.kind === "firm");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">New File</h1>
        <p className="mt-1 text-sm text-muted">Send your agreement to a client. You&apos;ll get the signing link right away.</p>
      </div>
      <NewFileForm
        templates={templates.map((x) => ({ id: x.id, name: x.name }))}
        templateId={selectedId}
        problems={problems}
        firmFill={firmFill}
        countersign={countersign}
        firmFirst={isFirmFirst(v.roles)}
        mySavedSignature={saved?.signature ?? null}
        team={team}
        defaultCountersignerId={auth.user.id}
      />
    </div>
  );
}

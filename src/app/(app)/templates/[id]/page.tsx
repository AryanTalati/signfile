import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FieldEditor } from "@/components/editor/field-editor";
import { requireAuth } from "@/lib/auth/session";
import { getTemplate } from "@/lib/templates/service";

export const metadata: Metadata = { title: "Set up fields · signfile" };

export default async function TemplateEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const { new: isNew } = await searchParams;
  const t = await getTemplate(auth, id);
  if (!t) notFound();
  const v = t.version;
  // Displayed page size: swap width/height for pages rotated 90/270.
  const pages = v.pages.map((p, i) => ({ page: i + 1, width: p.rotation % 180 ? p.height : p.width, height: p.rotation % 180 ? p.width : p.height }));
  return (
    <FieldEditor
      key={v.pdfSha256}
      templateId={t.template.id}
      pdfSha256={v.pdfSha256}
      initialName={t.template.name}
      pdfUrl={`/api/templates/${t.template.id}/pdf?v=${v.pdfSha256.slice(0, 12)}`}
      pages={pages}
      initialFields={v.fields}
      initialCountersign={(v.roles ?? []).some((r) => r.kind === "firm")}
      signaturePageAppended={v.signaturePageAppended}
      detection={v.detection as { outcome?: string; warnings?: string[]; notes?: string[] } | null}
      firmName={auth.company.name}
      isNew={isNew === "1"}
    />
  );
}

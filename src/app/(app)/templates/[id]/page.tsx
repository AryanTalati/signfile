import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FieldEditor } from "@/components/editor/field-editor";
import { requireAuth } from "@/lib/auth/session";
import { getTemplate } from "@/lib/templates/service";
import { isFirmFirst } from "@/lib/fields/validate";
import { db, schema } from "@/lib/db/client";
import { and, eq } from "drizzle-orm";

export const metadata: Metadata = { title: "Set up fields · signfile" };

export default async function TemplateEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string; focus?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const { new: isNew, focus } = await searchParams;
  const t = await getTemplate(auth, id);
  if (!t) notFound();
  const v = t.version;
  const [rev] = t.template.revisionForFileId
    ? await db.select({ id: schema.files.id, client: schema.files.clientLegalName }).from(schema.files).where(and(eq(schema.files.id, t.template.revisionForFileId), eq(schema.files.companyId, auth.company.id)))
    : [];
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
      initialParked={v.parkedFields ?? []}
      initialCountersign={(v.roles ?? []).some((r) => r.kind === "firm")}
      initialFirmFirst={isFirmFirst(v.roles)}
      signaturePageAppended={v.signaturePageAppended}
      detection={v.detection as { outcome?: string; warnings?: string[]; notes?: string[] } | null}
      firmName={auth.company.name}
      isNew={isNew === "1"}
      reviseFile={rev ?? null}
      focusIds={
        focus && rev
          ? ((v.detection as { match?: { flagged?: { id: string }[] } } | null)?.match?.flagged ?? []).map((f) => f.id).filter((fid) => v.fields.some((x) => x.id === fid && !x.reviewed))
          : null
      }
    />
  );
}

import { fail, authOr401 } from "@/lib/http/respond";
import { getTemplatePdf } from "@/lib/templates/service";

export const runtime = "nodejs";

/** The template's current PDF, for the editor. Company-scoped. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const pdf = await getTemplatePdf(auth, id);
  if (!pdf) return fail(404, "Template not found.");
  return new Response(new Uint8Array(pdf.bytes), {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "private, max-age=3600",
      etag: `"${pdf.sha256}"`,
      "x-content-type-options": "nosniff",
    },
  });
}

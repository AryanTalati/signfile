import { headerTemplateCsv } from "@/lib/bulk/core";
import { bulkSetup } from "@/lib/bulk/service";
import { authOr401, fail } from "@/lib/http/respond";

export const runtime = "nodejs";

/** The exact header row for this template (signer columns + one per "Filled by you" field), with one example line. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const setup = await bulkSetup(auth, (await params).id);
  if (!setup) return fail(404, "Template not found.");
  const name = setup.template.name.replace(/[^\w.-]+/g, "-").slice(0, 60) || "template";
  return new Response(headerTemplateCsv(setup.columns), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}-bulk-send.csv"`, "cache-control": "private, no-store" },
  });
}

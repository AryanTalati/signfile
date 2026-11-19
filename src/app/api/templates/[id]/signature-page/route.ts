import { fail, json, authOr401 } from "@/lib/http/respond";
import { appendSignaturePageToTemplate } from "@/lib/templates/service";

export const runtime = "nodejs";

/** Append a signature page (fallback when detection finds nothing). */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const out = await appendSignaturePageToTemplate(auth, id);
  if (!out) return fail(404, "Template not found.");
  if ("alreadyAppended" in out) return fail(409, "A signature page was already added to this template.");
  return json(out);
}

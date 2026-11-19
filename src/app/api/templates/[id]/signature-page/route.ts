import { fail, json, authOr401 } from "@/lib/http/respond";
import { appendSignaturePageToTemplate, BusyError, removeSignaturePageFromTemplate } from "@/lib/templates/service";

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

/** Remove the appended signature page (undo). */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  try {
    const out = await removeSignaturePageFromTemplate(auth, id);
    if (!out) return fail(404, "Template not found.");
    if ("notAppended" in out) return fail(409, "This template has no added signature page.");
    return json(out);
  } catch (e) {
    if (e instanceof BusyError) return fail(503, e.message, { code: "busy" });
    console.error("remove signature page failed", e);
    return fail(500, "Couldn't remove the signature page. Please try again.");
  }
}

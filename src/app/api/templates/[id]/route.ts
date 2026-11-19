import { fail, json, authOr401 } from "@/lib/http/respond";
import { saveSchema, saveTemplate } from "@/lib/templates/service";

export const runtime = "nodejs";

/** Save the template's name, signers and fields (editor autosave). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Those fields couldn't be saved.", { issues: parsed.error.issues.slice(0, 5) });
  const out = await saveTemplate(auth, id, parsed.data);
  if (!out) return fail(404, "Template not found.");
  if ("stale" in out) return fail(409, "This template changed in another window. Reloading the latest version.", { stale: true });
  return json(out);
}

import { authOr401, json } from "@/lib/http/respond";
import { markTemplateDone } from "@/lib/templates/service";

export const runtime = "nodejs";

/** Done (or Create a File) in the editor: the template stops being a Draft. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  await markTemplateDone(auth, (await params).id);
  return json({ ok: true });
}

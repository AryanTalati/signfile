import { getAuth, requestMeta } from "@/lib/auth/session";
import { loadSigning, quickSign, SigningError } from "@/lib/files/signing";
import { appUrl } from "@/lib/http/app-url";
import { fail, json } from "@/lib/http/respond";
import { getSavedSignature } from "@/lib/users/signature";

export const runtime = "nodejs";

/** One-click countersign with the logged-in user's saved signature. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const auth = await getAuth();
  if (!auth) return fail(401, "Log in to sign with your saved signature.");
  const ctx = await loadSigning(token);
  if (!ctx || ctx.file.companyId !== auth.company.id) return fail(404, "This link isn't valid.");
  const saved = await getSavedSignature(auth.user.id);
  if (!saved) return fail(409, "You haven't saved a signature yet.");
  const body = (await req.json().catch(() => ({}))) as { timezone?: string };
  try {
    return json(await quickSign(ctx, { id: auth.user.id, title: auth.user.title }, saved, await requestMeta(), await appUrl(), typeof body.timezone === "string" ? body.timezone.slice(0, 64) : undefined));
  } catch (e) {
    if (e instanceof SigningError) return fail(422, e.message);
    console.error("quick sign failed", e);
    return fail(500, "Something went wrong. Please sign the usual way.");
  }
}

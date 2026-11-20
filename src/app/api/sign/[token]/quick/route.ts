import { getAuth, requestMeta } from "@/lib/auth/session";
import { autoCountersign, loadSigning, quickSign, SigningError } from "@/lib/files/signing";
import { appUrl } from "@/lib/http/app-url";
import { sealFile } from "@/lib/files/seal";
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
    const base = await appUrl();
    const out = await quickSign(ctx, { id: auth.user.id, title: auth.user.title }, saved, await requestMeta(), base, typeof body.timezone === "string" ? body.timezone.slice(0, 64) : undefined);
    if (out.autoCountersign && (await autoCountersign(out.autoCountersign, base))?.completed) out.completed = true;
    if (out.completed) await sealFile(ctx.file.id, base).catch((e) => console.error("sealing failed", ctx.file.id, e));
    return json(out);
  } catch (e) {
    if (e instanceof SigningError) return fail(422, e.message);
    console.error("quick sign failed", e);
    return fail(500, "Something went wrong. Please sign the usual way.");
  }
}

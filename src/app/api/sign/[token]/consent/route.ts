import { requestMeta } from "@/lib/auth/session";
import { loadSigning, recordConsent } from "@/lib/files/signing";
import { fail, json } from "@/lib/http/respond";

export const runtime = "nodejs";

/** Records the signer's ESIGN/UETA consent (time, IP, user agent) before they can sign. */
export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await loadSigning(token);
  if (!ctx) return fail(404, "This link isn't valid.");
  if (!(await recordConsent(ctx, await requestMeta()))) return fail(409, "This link can't be signed right now.", { state: ctx.state });
  return json({ ok: true });
}

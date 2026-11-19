import { requestMeta } from "@/lib/auth/session";
import { loadSigning, SigningError, submitSchema, submitSigning } from "@/lib/files/signing";
import { appUrl } from "@/lib/http/app-url";
import { fail, json } from "@/lib/http/respond";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await loadSigning(token);
  if (!ctx) return fail(404, "This link isn't valid.");
  if (ctx.state !== "sign") return fail(409, "This link can't be signed right now.", { state: ctx.state });
  const parsed = submitSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Something was wrong with that submission. Please try again.");
  try {
    const out = await submitSigning(ctx, parsed.data, await requestMeta(), await appUrl());
    return json(out);
  } catch (e) {
    if (e instanceof SigningError) return fail(422, e.message);
    console.error("signing failed", e);
    return fail(500, "Something went wrong saving your signature. Please try again.");
  }
}

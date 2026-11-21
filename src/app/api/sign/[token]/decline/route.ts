import { requestMeta } from "@/lib/auth/session";
import { declineSigning, reasonSchema, RespondError } from "@/lib/files/respond";
import { loadSigning } from "@/lib/files/signing";
import { appUrl } from "@/lib/http/app-url";
import { fail, json } from "@/lib/http/respond";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await loadSigning(token);
  if (!ctx) return fail(404, "This link isn't valid.");
  if (ctx.state !== "sign") return fail(409, "This link can't be used right now.", { state: ctx.state });
  const parsed = reasonSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Please add a message.");
  try {
    await declineSigning(ctx, parsed.data.text, await requestMeta(), await appUrl());
    return json({ ok: true });
  } catch (e) {
    if (e instanceof RespondError) return fail(409, e.message);
    console.error("decline failed", e);
    return fail(500, "Something went wrong. Please try again.");
  }
}

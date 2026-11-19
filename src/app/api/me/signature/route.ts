import { authOr401, fail, json } from "@/lib/http/respond";
import { removeSignature, saveSignature, savedSignatureSchema } from "@/lib/users/signature";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const parsed = savedSignatureSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "That signature couldn't be saved. Please try again.");
  await saveSignature(auth, parsed.data);
  return json({ ok: true });
}

export async function DELETE() {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  await removeSignature(auth);
  return json({ ok: true });
}

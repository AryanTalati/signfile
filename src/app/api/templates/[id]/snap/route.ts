import { authOr401, fail, json } from "@/lib/http/respond";
import { snapField, snapSchema } from "@/lib/templates/service";

export const runtime = "nodejs";

/** Where a hand-placed field should go: onto the nearby blank, never over printed text. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const parsed = snapSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Invalid placement.");
  return json({ placement: await snapField(auth, (await params).id, parsed.data) });
}

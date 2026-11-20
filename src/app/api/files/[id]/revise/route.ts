import { z } from "zod";
import { reviseAndResend, ReviseError } from "@/lib/files/revise";
import { appUrl } from "@/lib/http/app-url";
import { authOr401, fail, json } from "@/lib/http/respond";

export const runtime = "nodejs";

/** Send the reviewed revised version as the File's next version. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const body = z.object({ templateId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return fail(400, "Missing revised version.");
  try {
    return json(await reviseAndResend(auth, id, body.data.templateId, await appUrl()));
  } catch (e) {
    if (e instanceof ReviseError) return fail(409, e.message);
    console.error("revise failed", e);
    return fail(500, "Couldn't send the revised version. Please try again.");
  }
}

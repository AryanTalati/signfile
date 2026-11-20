import { z } from "zod";
import { authOr401, fail, json } from "@/lib/http/respond";
import { setAutoCountersign } from "@/lib/users/signature";

export const runtime = "nodejs";

/** The logged-in user turns automatic countersigning on (with explicit consent) or off, for themselves only. */
export async function PUT(req: Request) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const body = z.object({ enabled: z.boolean(), consent: z.boolean().optional() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return fail(400, "Invalid request.");
  if (body.data.enabled && body.data.consent !== true) return fail(400, "Please confirm the authorization first.");
  if (!(await setAutoCountersign(auth, body.data.enabled))) return fail(409, "Save your signature first.");
  return json({ ok: true });
}

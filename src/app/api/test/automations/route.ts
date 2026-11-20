import { z } from "zod";
import { getAuth } from "@/lib/auth/session";
import { runAutomations } from "@/lib/files/automations";
import { appUrl } from "@/lib/http/app-url";
import { fail, json } from "@/lib/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEST ONLY: runs the reminder/expiry sweep for one of the caller's Files at a given "now"
 * (mocked time). Exists only when E2E_HOOKS=1, which is set for the local Docker test run and
 * never on Render; otherwise it's a 404.
 */
export async function POST(req: Request) {
  if (process.env.E2E_HOOKS !== "1") return fail(404, "Not found.");
  const auth = await getAuth();
  if (!auth) return fail(401, "Log in.");
  const body = z.object({ fileId: z.string().uuid(), now: z.string().datetime() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return fail(400, "fileId and now (ISO) required.");
  const out = await runAutomations({ now: new Date(body.data.now), baseUrl: await appUrl(), fileId: body.data.fileId, companyId: auth.company.id });
  return json(out);
}

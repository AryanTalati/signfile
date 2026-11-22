import { BulkError, bulkInputSchema, startBulk } from "@/lib/bulk/service";
import { kickBatch } from "@/lib/bulk/worker";
import { appUrl } from "@/lib/http/app-url";
import { authOr401, fail, json } from "@/lib/http/respond";

export const runtime = "nodejs";

/** The firm confirmed the preview: re-validate, store the run, and send in the background. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const parsed = bulkInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  try {
    const batchId = await startBulk(auth, (await params).id, parsed.data, await appUrl());
    kickBatch(batchId);
    return json({ batchId });
  } catch (e) {
    if (e instanceof BulkError) return fail(400, e.message);
    throw e;
  }
}

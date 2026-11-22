import { getBatch } from "@/lib/bulk/service";
import { kickBatch } from "@/lib/bulk/worker";
import { authOr401, fail, json } from "@/lib/http/respond";

export const runtime = "nodejs";

/** Progress of a run. Opening an unfinished run resumes it (e.g. after a restart). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const b = await getBatch(auth, (await params).id);
  if (!b) return fail(404, "Not found.");
  if (b.batch.status === "running") kickBatch(b.batch.id);
  return json({ status: b.batch.status, counts: b.batch.counts });
}

import { batchResultCsv, getBatch } from "@/lib/bulk/service";
import { appUrl } from "@/lib/http/app-url";
import { authOr401, fail } from "@/lib/http/respond";

export const runtime = "nodejs";

/** The run's result CSV: every input row + file_status, file_link, skip_reason. Re-downloadable anytime. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const b = await getBatch(auth, (await params).id);
  if (!b) return fail(404, "Not found.");
  return new Response(batchResultCsv(b, await appUrl()), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="bulk-result-${b.batch.createdAt.toISOString().slice(0, 10)}-${b.batch.id.slice(0, 8)}.csv"`, "cache-control": "private, no-store" },
  });
}

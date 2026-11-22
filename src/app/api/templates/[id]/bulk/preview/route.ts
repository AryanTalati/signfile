import { BulkError, bulkInputSchema, previewBulk } from "@/lib/bulk/service";
import { appUrl } from "@/lib/http/app-url";
import { authOr401, fail, json } from "@/lib/http/respond";

export const runtime = "nodejs";

/** Validate only: maps and checks every row and returns the preview. Creates and sends nothing. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const parsed = bulkInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  try {
    const p = await previewBulk(auth, (await params).id, parsed.data, await appUrl());
    return json({ ...p, rows: p.rows.map((r) => ({ rowNo: r.rowNo, status: r.status, reasons: r.reasons, values: r.values, previous: r.previous ?? null })) });
  } catch (e) {
    if (e instanceof BulkError) return fail(400, e.message);
    throw e;
  }
}

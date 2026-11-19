import { getFile } from "@/lib/files/service";
import { getFinalPdf, sealFile } from "@/lib/files/seal";
import { appUrl } from "@/lib/http/app-url";
import { authOr401, fail } from "@/lib/http/respond";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

/** The sealed, signed PDF (seals on demand if completed but not yet sealed). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const data = await getFile(auth, id);
  if (!data) return fail(404, "File not found.");
  if (data.file.status !== "completed") return fail(409, "This File isn't fully signed yet.");
  let file = data.file;
  if (!file.finalPdfKey) {
    await sealFile(file.id, await appUrl());
    [file] = await db.select().from(schema.files).where(eq(schema.files.id, file.id));
  }
  const bytes = await getFinalPdf(file);
  if (!bytes) return fail(500, "The signed copy isn't available yet.");
  const name = `${data.templateName} - ${file.clientLegalName} - signed.pdf`.replace(/[^\w .()-]+/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" },
  });
}

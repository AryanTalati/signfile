import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getFinalPdf, sealFile } from "@/lib/files/seal";
import { loadSigning } from "@/lib/files/signing";
import { appUrl } from "@/lib/http/app-url";
import { fail } from "@/lib/http/respond";

export const runtime = "nodejs";

/** A signer's copy of the sealed PDF, via their own link, once everyone has signed. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await loadSigning(token);
  if (!ctx || ctx.recipient.status !== "signed" || ctx.file.status !== "completed") return fail(404, "The signed copy isn't available.");
  let file = ctx.file;
  if (!file.finalPdfKey) {
    await sealFile(file.id, await appUrl());
    [file] = (await db.select().from(schema.files).where(eq(schema.files.id, file.id))) as (typeof file)[];
  }
  const bytes = await getFinalPdf(file);
  if (!bytes) return fail(404, "The signed copy isn't available yet.");
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="signed-agreement.pdf"`, "cache-control": "private, no-store", "referrer-policy": "no-referrer" },
  });
}

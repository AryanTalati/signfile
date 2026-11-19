import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fail, json } from "@/lib/http/respond";
import { MAX_UPLOAD_BYTES, sha256 } from "@/lib/pdf/prepare";

export const runtime = "nodejs";

/**
 * Public: does this PDF exactly match a document sealed by signfile? Hash-only lookup;
 * reveals just enough to confirm authenticity (firm, completion date, signer count).
 */
export async function POST(req: Request) {
  let bytes: Uint8Array;
  try {
    const f = (await req.formData()).get("file");
    if (!(f instanceof File) || !f.size) return fail(400, "Choose a PDF to check.");
    if (f.size > MAX_UPLOAD_BYTES) return fail(413, "That file is over 25 MB.");
    bytes = new Uint8Array(await f.arrayBuffer());
  } catch {
    return fail(400, "Choose a PDF to check.");
  }
  const hash = sha256(bytes);
  const [sealed] = await db
    .select({ completedAt: schema.files.completedAt, firm: schema.companies.name, fileId: schema.files.id })
    .from(schema.files)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.files.companyId))
    .where(eq(schema.files.finalSha256, hash))
    .limit(1);
  if (sealed) {
    const signers = await db.select({ id: schema.recipients.id }).from(schema.recipients).where(and(eq(schema.recipients.fileId, sealed.fileId), eq(schema.recipients.status, "signed")));
    return json({ sha256: hash, result: "sealed", firm: sealed.firm, completedAt: sealed.completedAt, signers: signers.length });
  }
  const [orig] = await db.select({ id: schema.fileDocuments.id }).from(schema.fileDocuments).where(eq(schema.fileDocuments.pdfSha256, hash)).orderBy(desc(schema.fileDocuments.createdAt)).limit(1);
  if (orig) return json({ sha256: hash, result: "unsigned_original" });
  return json({ sha256: hash, result: "no_match" });
}

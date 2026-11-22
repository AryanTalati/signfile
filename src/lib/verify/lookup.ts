import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";

/** What /verify shows: just enough to confirm authenticity (firm, completion date, signer count). */
export type VerifyResult = { sha256: string; result: "sealed" | "unsigned_original" | "no_match"; firm?: string; completedAt?: string | Date | null; signers?: number };

async function sealedResult(where: ReturnType<typeof eq>, hash: string | null): Promise<VerifyResult | null> {
  const [sealed] = await db
    .select({ completedAt: schema.files.completedAt, firm: schema.companies.name, fileId: schema.files.id, finalSha256: schema.files.finalSha256 })
    .from(schema.files)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.files.companyId))
    .where(where)
    .limit(1);
  if (!sealed?.finalSha256) return null;
  const signers = await db.select({ id: schema.recipients.id }).from(schema.recipients).where(and(eq(schema.recipients.fileId, sealed.fileId), eq(schema.recipients.status, "signed")));
  return { sha256: hash ?? sealed.finalSha256, result: "sealed", firm: sealed.firm, completedAt: sealed.completedAt, signers: signers.length };
}

/** An uploaded PDF, by its SHA-256. */
export async function verifyByHash(hash: string): Promise<VerifyResult> {
  const sealed = await sealedResult(eq(schema.files.finalSha256, hash), hash);
  if (sealed) return sealed;
  const [orig] = await db.select({ id: schema.fileDocuments.id }).from(schema.fileDocuments).where(eq(schema.fileDocuments.pdfSha256, hash)).orderBy(desc(schema.fileDocuments.createdAt)).limit(1);
  return { sha256: hash, result: orig ? "unsigned_original" : "no_match" };
}

/**
 * /verify?file=<id>: the same result as uploading that File's sealed PDF (read-only). A File that
 * doesn't exist or isn't sealed yet is "no_match"; nothing else is revealed.
 */
export async function verifyByFileId(fileId: string): Promise<VerifyResult> {
  if (!z.string().uuid().safeParse(fileId).success) return { sha256: "", result: "no_match" };
  return (await sealedResult(eq(schema.files.id, fileId), null)) ?? { sha256: "", result: "no_match" };
}

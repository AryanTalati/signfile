import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AuthContext } from "@/lib/auth/session";
import { db, schema } from "@/lib/db/client";

const KIND_LABEL: Record<string, string> = {
  sign_request: "Signing request",
  countersign_request: "Countersign request",
  firm_sign_first: "Sign to send",
  signed_copy: "Signed copy",
  resend: "Signing request (resent)",
  voided: "Agreement voided",
};
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k;

export async function listOutbox(auth: AuthContext) {
  return db
    .select({
      id: schema.outbox.id,
      kind: schema.outbox.kind,
      toEmail: schema.outbox.toEmail,
      toName: schema.outbox.toName,
      subject: schema.outbox.subject,
      status: schema.outbox.status,
      error: schema.outbox.error,
      createdAt: schema.outbox.createdAt,
      fileId: schema.outbox.fileId,
      client: schema.files.clientLegalName,
    })
    .from(schema.outbox)
    .leftJoin(schema.files, eq(schema.files.id, schema.outbox.fileId))
    .where(eq(schema.outbox.companyId, auth.company.id))
    .orderBy(desc(schema.outbox.createdAt))
    .limit(300);
}

export async function getOutboxEmail(auth: AuthContext, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await db
    .select({ email: schema.outbox, client: schema.files.clientLegalName })
    .from(schema.outbox)
    .leftJoin(schema.files, eq(schema.files.id, schema.outbox.fileId))
    .where(and(eq(schema.outbox.id, id), eq(schema.outbox.companyId, auth.company.id)))
    .limit(1);
  return row ?? null;
}

/** Links in an email body (signing link, download link), for copying. */
export function linksIn(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s"'<>]+/g) ?? [])];
}

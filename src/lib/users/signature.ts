import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AuthContext } from "@/lib/auth/session";
import { requestMeta } from "@/lib/auth/session";
import { db, schema } from "@/lib/db/client";

const png = z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Invalid image").max(300_000);
export const savedSignatureSchema = z.object({ signature: png, initials: png });

export const ADOPT_TEXT =
  "I adopt this signature and these initials as my electronic signature. When I choose to sign with them, they have the same legal effect as my handwritten signature, under the U.S. ESIGN Act and UETA. Each use still requires me to choose to sign.";

export async function getSavedSignature(userId: string) {
  const [u] = await db
    .select({ signature: schema.users.savedSignature, initials: schema.users.savedInitials, at: schema.users.savedSignatureAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return u?.signature ? { signature: u.signature, initials: u.initials ?? u.signature, at: u.at } : null;
}

export async function saveSignature(auth: AuthContext, input: z.infer<typeof savedSignatureSchema>) {
  const { ip, userAgent } = await requestMeta();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ savedSignature: input.signature, savedInitials: input.initials, savedSignatureAt: new Date() })
      .where(and(eq(schema.users.id, auth.user.id), eq(schema.users.companyId, auth.company.id)));
    await tx.insert(schema.events).values({
      companyId: auth.company.id,
      actorType: "user",
      actorId: auth.user.id,
      actorLabel: auth.user.name,
      type: "user.signature_adopted",
      data: { consent: ADOPT_TEXT },
      ip,
      userAgent,
    });
  });
}

export async function removeSignature(auth: AuthContext) {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ savedSignature: null, savedInitials: null, savedSignatureAt: null })
      .where(and(eq(schema.users.id, auth.user.id), eq(schema.users.companyId, auth.company.id)));
    await tx.insert(schema.events).values({ companyId: auth.company.id, actorType: "user", actorId: auth.user.id, actorLabel: auth.user.name, type: "user.signature_removed" });
  });
}

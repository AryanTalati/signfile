"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { db, schema } from "@/lib/db/client";

const detailsSchema = z.object({ name: z.string().trim().min(2, "Enter your name.").max(120), title: z.string().trim().max(120) });

export type DetailsState = { error?: string; ok?: boolean };

export async function saveDetailsAction(_: DetailsState, fd: FormData): Promise<DetailsState> {
  const auth = await requireAuth();
  const parsed = detailsSchema.safeParse({ name: fd.get("name"), title: fd.get("title") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db
    .update(schema.users)
    .set({ name: parsed.data.name, title: parsed.data.title || null })
    .where(and(eq(schema.users.id, auth.user.id), eq(schema.users.companyId, auth.company.id)));
  revalidatePath("/settings");
  return { ok: true };
}

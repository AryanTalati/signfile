"use server";
import { validTimeZone } from "@/lib/time";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireAuth } from "@/lib/auth/session";
import { parseReminderDays } from "@/lib/files/reminders";
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

export type RemindersState = { error?: string; ok?: boolean };

/** Firm-wide reminder schedule and link expiry (admins only). */
export async function saveRemindersAction(_: RemindersState, fd: FormData): Promise<RemindersState> {
  const auth = await requireAdmin();
  const days = parseReminderDays(String(fd.get("reminderDays") ?? ""));
  if (!days) return { error: "Reminder days: up to 5 whole numbers between 1 and 60, like 2, 5." };
  const finalDays = Number(fd.get("finalReminderDays") ?? 0);
  if (!Number.isInteger(finalDays) || finalDays < 0 || finalDays > 30) return { error: "Final reminder: a whole number of days from 0 to 30 (0 = none)." };
  const expiry = Number(fd.get("linkExpiryDays") ?? 30);
  if (!Number.isInteger(expiry) || expiry < 1 || expiry > 365) return { error: "Links expire after 1 to 365 days." };
  if (finalDays >= expiry) return { error: "The final reminder must come before the links expire." };
  const timezone = validTimeZone(String(fd.get("timezone") ?? ""));
  await db
    .update(schema.companies)
    .set({ remindersEnabled: fd.get("remindersEnabled") === "on", reminderDays: days, finalReminderDays: finalDays, linkExpiryDays: expiry, ...(timezone ? { timezone } : {}) })
    .where(eq(schema.companies.id, auth.company.id));
  revalidatePath("/settings");
  return { ok: true };
}

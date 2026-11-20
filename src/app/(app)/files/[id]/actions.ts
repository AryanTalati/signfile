"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth/session";
import { FileActionError, resendSigningEmail, voidFile } from "@/lib/files/actions";
import { appUrl } from "@/lib/http/app-url";
import { FileInputError, sendDraft } from "@/lib/files/service";
import { redirect } from "next/navigation";

export type ActionState = { error?: string; ok?: string };

export async function voidAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const fileId = String(fd.get("fileId") ?? "");
  try {
    const { notified } = await voidFile(auth, fileId, String(fd.get("reason") ?? ""));
    revalidatePath(`/files/${fileId}`);
    return { ok: `Voided. ${notified} signer${notified === 1 ? "" : "s"} notified.` };
  } catch (e) {
    if (e instanceof FileActionError) return { error: e.message };
    console.error("void failed", e);
    return { error: "Couldn't void this File. Please try again." };
  }
}

export async function resendAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const fileId = String(fd.get("fileId") ?? "");
  try {
    const { sent } = await resendSigningEmail(auth, fileId, await appUrl());
    revalidatePath(`/files/${fileId}`);
    return { ok: `Resent to ${sent.join(" and ")}.` };
  } catch (e) {
    if (e instanceof FileActionError) return { error: e.message };
    console.error("resend failed", e);
    return { error: "Couldn't resend. Please try again." };
  }
}

export async function sendDraftAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const fileId = String(fd.get("fileId") ?? "");
  try {
    await sendDraft(auth, fileId, await appUrl());
  } catch (e) {
    if (e instanceof FileInputError) return { error: e.message };
    console.error("send draft failed", e);
    return { error: "Couldn't send. Please try again." };
  }
  redirect(`/files/${fileId}?sent=1`);
}

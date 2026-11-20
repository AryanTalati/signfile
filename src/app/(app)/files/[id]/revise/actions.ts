"use server";

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/session";
import { reviseAndResend, ReviseError } from "@/lib/files/revise";
import { appUrl } from "@/lib/http/app-url";

export type SendState = { error?: string };

export async function sendRevisionAction(_: SendState, fd: FormData): Promise<SendState> {
  const auth = await requireAuth();
  const fileId = String(fd.get("fileId") ?? "");
  const templateId = String(fd.get("templateId") ?? "");
  const firmValues: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("firm:") && typeof v === "string") firmValues[k.slice(5)] = v.trim();
  if (Object.values(firmValues).some((v) => !v)) return { error: "Fill in every new 'Filled by you' value." };
  try {
    await reviseAndResend(auth, fileId, templateId, await appUrl(), { note: String(fd.get("note") ?? ""), firmValues });
  } catch (e) {
    if (e instanceof ReviseError) return { error: e.message };
    console.error("send revision failed", e);
    return { error: "Couldn't send the revised version. Please try again." };
  }
  redirect(`/files/${fileId}?revised=1`);
}

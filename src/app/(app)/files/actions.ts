"use server";

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/session";
import { createAndSendFile, createFileSchema, FileInputError } from "@/lib/files/service";
import { appUrl } from "@/lib/http/app-url";

export interface CreateFileState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

export async function createFileAction(_: CreateFileState, fd: FormData): Promise<CreateFileState> {
  const auth = await requireAuth();
  const values: Record<string, string> = {};
  const firmValues: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    values[k] = v;
    if (k.startsWith("firm:")) firmValues[k.slice(5)] = v;
  }
  const parsed = createFileSchema.safeParse({
    templateId: values.templateId,
    clientLegalName: values.clientLegalName,
    reference: values.reference,
    signerName: values.signerName,
    signerTitle: values.signerTitle,
    signerEmail: values.signerEmail,
    countersignerId: values.countersignerId || undefined,
    signNow: values.signNow === "on",
    firmValues,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors, values };
  }
  let fileId: string;
  let signNowError: string | null = null;
  try {
    ({ fileId, signNowError } = await createAndSendFile(auth, parsed.data, await appUrl()));
  } catch (e) {
    if (e instanceof FileInputError) return e.field ? { fieldErrors: { [e.field]: e.message }, values } : { error: e.message, values };
    console.error("create file failed", e);
    return { error: "Something went wrong sending this File. Please try again.", values };
  }
  redirect(`/files/${fileId}?sent=1${signNowError ? `&signNowError=${encodeURIComponent(signNowError)}` : ""}`);
}

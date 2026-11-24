"use server";

import { z } from "zod";
import { requestMeta } from "@/lib/auth/session";
import { requestPasswordReset, resetPassword } from "@/lib/auth/password-reset";
import { RESET_REQUESTED_MESSAGE } from "@/lib/auth/reset-token";
import { appUrl } from "@/lib/http/app-url";

export interface ResetRequestState {
  done?: string;
  error?: string;
  email?: string;
}

export async function requestResetAction(_: ResetRequestState, fd: FormData): Promise<ResetRequestState> {
  const email = String(fd.get("email") ?? "").trim();
  if (!z.string().email().max(254).safeParse(email).success) return { error: "Enter a valid email.", email };
  const { ip } = await requestMeta();
  try {
    const r = await requestPasswordReset({ email, ip, baseUrl: await appUrl() });
    if (r.status === "rate_limited") return { error: "Too many reset requests from this network. Wait an hour and try again.", email };
  } catch (e) {
    // Same answer as success: an error must not reveal whether the account exists. Never log the token.
    console.error("password reset request failed", (e as Error).message);
  }
  return { done: RESET_REQUESTED_MESSAGE };
}

export interface ResetState {
  done?: boolean;
  error?: string;
  fieldError?: string;
  expired?: boolean;
}

export async function resetPasswordAction(_: ResetState, fd: FormData): Promise<ResetState> {
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { fieldError: "The two passwords don't match." };
  const r = await resetPassword(fd.get("token"), password);
  if (r.ok) return { done: true };
  if (r.field === "password") return { fieldError: r.error };
  return { error: r.error, expired: true };
}

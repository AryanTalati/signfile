import type { Metadata } from "next";
import { checkResetToken } from "@/lib/auth/password-reset";
import { ResetPasswordForm } from "./reset-password-form";

// The token is in the URL: never send it on as a Referer, never cache the page.
export const metadata: Metadata = { title: "Choose a new password · signfile", referrer: "no-referrer", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token: raw } = await searchParams;
  const token = Array.isArray(raw) ? raw[0] : raw;
  const state = await checkResetToken(token);
  return <ResetPasswordForm token={state === "valid" ? token! : null} />;
}

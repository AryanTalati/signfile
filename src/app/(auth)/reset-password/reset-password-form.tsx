"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, ButtonLink, Card, Field } from "@/components/ui";
import { resetPasswordAction, type ResetState } from "../reset-actions";

/** `token` is null when the link is invalid, expired or already used (checked on the server). */
export function ResetPasswordForm({ token }: { token: string | null }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPasswordAction, {});

  if (state.done)
    return (
      <Card className="p-6" data-testid="reset-done">
        <h1 className="mb-2 text-xl font-semibold">Password changed</h1>
        <p className="text-sm text-muted">You&apos;ve been signed out everywhere. Log in with your new password.</p>
        <ButtonLink href="/login" className="mt-4 w-full">
          Log in
        </ButtonLink>
      </Card>
    );

  if (!token || state.expired)
    return (
      <Card className="p-6" data-testid="reset-invalid">
        <h1 className="mb-2 text-xl font-semibold">This link can&apos;t be used</h1>
        <p className="text-sm text-muted">Reset links work once and expire after 1 hour. Ask for a new one.</p>
        <ButtonLink href="/forgot-password" className="mt-4 w-full">
          Get a new link
        </ButtonLink>
      </Card>
    );

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-6">
        <h1 className="mb-5 text-xl font-semibold">Choose a new password</h1>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          {state.error && <Alert>{state.error}</Alert>}
          <Field label="New password" name="password" type="password" autoComplete="new-password" required minLength={10} hint="At least 10 characters." error={state.fieldError} />
          <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save new password"}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-muted">
        <Link className="font-medium text-brand hover:underline" href="/login">
          Back to log in
        </Link>
      </p>
    </div>
  );
}

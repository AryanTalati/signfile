"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import { requestResetAction, type ResetRequestState } from "../reset-actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ResetRequestState, FormData>(requestResetAction, {});
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-6">
        <h1 className="mb-2 text-xl font-semibold">Reset your password</h1>
        {state.done ? (
          <div data-testid="reset-requested">
            <Alert tone="success">{state.done}</Alert>
            <p className="mt-3 text-sm text-muted">Check your inbox and spam folder. You can ask again if it doesn&apos;t arrive.</p>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-4">
            <p className="text-sm text-muted">Enter your account email. We&apos;ll send a link to choose a new password.</p>
            {state.error && <Alert>{state.error}</Alert>}
            <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
      </Card>
      <p className="text-center text-sm text-muted">
        <Link className="font-medium text-brand hover:underline" href="/login">
          Back to log in
        </Link>
      </p>
    </div>
  );
}

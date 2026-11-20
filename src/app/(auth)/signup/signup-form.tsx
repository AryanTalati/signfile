"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import { TimeZoneInput } from "@/components/time-zone-input";
import { signupAction, type FormState } from "../actions";

export function SignupForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(signupAction, {});
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Create your company</h1>
        <p className="mb-5 mt-1 text-sm text-muted">You&apos;ll be the admin. You can invite your team after.</p>
        <form action={action} className="flex flex-col gap-4" noValidate>
          {state.error && <Alert>{state.error}</Alert>}
          <TimeZoneInput />
          <Field label="Company name" name="companyName" autoComplete="organization" required defaultValue={v.companyName} error={fe.companyName} />
          <Field label="Your name" name="name" autoComplete="name" required defaultValue={v.name} error={fe.name} />
          <Field label="Work email" name="email" type="email" autoComplete="email" required defaultValue={v.email} error={fe.email} />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            error={fe.password}
            hint="At least 10 characters."
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create company"}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link className="font-medium text-brand hover:underline" href="/login">
          Log in
        </Link>
      </p>
    </div>
  );
}

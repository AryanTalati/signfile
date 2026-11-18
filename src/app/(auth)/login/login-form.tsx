"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import { loginAction, type FormState } from "../actions";

export function LoginForm({ next, demo }: { next?: string; demo: { email: string; password: string } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  const form = useRef<HTMLFormElement>(null);

  function useDemo() {
    const f = form.current!;
    (f.elements.namedItem("email") as HTMLInputElement).value = demo.email;
    (f.elements.namedItem("password") as HTMLInputElement).value = demo.password;
    f.requestSubmit();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-6">
        <h1 className="mb-5 text-xl font-semibold">Log in</h1>
        <form ref={form} action={action} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next ?? ""} />
          {state.error && <Alert>{state.error}</Alert>}
          <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
          <Field label="Password" name="password" type="password" autoComplete="current-password" required />
          <Button type="submit" disabled={pending}>
            {pending ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </Card>

      <Card className="border-dashed p-4 text-sm">
        <p className="font-medium">Trying signfile?</p>
        <p className="mt-1 text-muted">
          Demo company <strong className="text-foreground">Astra AI</strong>: <code>{demo.email}</code> / <code>{demo.password}</code>
        </p>
        <Button type="button" variant="secondary" className="mt-3 w-full" onClick={useDemo} disabled={pending}>
          Log in to the demo
        </Button>
      </Card>

      <p className="text-center text-sm text-muted">
        New to signfile?{" "}
        <Link className="font-medium text-brand hover:underline" href="/signup">
          Create your company
        </Link>
      </p>
    </div>
  );
}

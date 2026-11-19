"use client";

import { useActionState } from "react";
import { Button, Field } from "@/components/ui";
import { saveDetailsAction, type DetailsState } from "./actions";

export function DetailsForm({ name, title }: { name: string; title: string }) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(saveDetailsAction, {});
  return (
    <form action={action} className="mt-4 flex flex-col gap-3">
      <Field label="Your name" name="name" defaultValue={name} required />
      <Field label="Your title" name="title" defaultValue={title} hint="Pre-filled when you countersign." />
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} className="py-2">
          {pending ? "Saving…" : "Save details"}
        </Button>
        {state.ok && <span className="text-sm text-green-700">Saved</span>}
      </div>
    </form>
  );
}

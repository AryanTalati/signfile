"use client";

import { useActionState } from "react";
import { Button, Field } from "@/components/ui";
import { saveRemindersAction, type RemindersState } from "./actions";

export function RemindersForm(p: { enabled: boolean; days: string; finalDays: number; expiry: number }) {
  const [state, action, pending] = useActionState<RemindersState, FormData>(saveRemindersAction, {});
  return (
    <form action={action} className="mt-4 flex flex-col gap-3" data-testid="reminders-form">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="remindersEnabled" defaultChecked={p.enabled} />
        Send automatic reminders
      </label>
      <Field label="Remind after (days)" name="reminderDays" defaultValue={p.days} hint="Days after it becomes each signer's turn, e.g. 2, 5." />
      <Field label="Final reminder (days before the link expires)" name="finalReminderDays" type="number" min={0} max={30} defaultValue={String(p.finalDays)} hint="0 = no final reminder." />
      <Field label="Links expire after (days)" name="linkExpiryDays" type="number" min={1} max={365} defaultValue={String(p.expiry)} hint="Applies to Files sent from now on. You're emailed when a File expires." />
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} className="py-2">
          {pending ? "Saving…" : "Save reminders"}
        </Button>
        {state.ok && <span className="text-sm text-green-700">Saved</span>}
      </div>
    </form>
  );
}

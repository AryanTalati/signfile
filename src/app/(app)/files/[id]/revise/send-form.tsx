"use client";

import { useActionState } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import { sendRevisionAction, type SendState } from "./actions";

export function SendRevisionForm({ fileId, templateId, prefill, newFirmFills, blocked }: { fileId: string; templateId: string; prefill: string; newFirmFills: { key: string; label: string }[]; blocked: string | null }) {
  const [state, action, pending] = useActionState<SendState, FormData>(sendRevisionAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="fileId" value={fileId} />
      <input type="hidden" name="templateId" value={templateId} />
      {newFirmFills.length > 0 && (
        <Card className="flex flex-col gap-3 p-4">
          <p className="text-sm font-medium">New values to fill in</p>
          {newFirmFills.map((f) => (
            <Field key={f.key} label={f.label} name={`firm:${f.key}`} required />
          ))}
        </Card>
      )}
      <label className="text-sm font-medium">
        What changed? <span className="font-normal text-muted">(optional; goes in the email to the signers and the audit trail)</span>
        <textarea name="note" defaultValue={prefill} maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-base sm:text-sm" data-testid="what-changed" />
      </label>
      {state.error && <Alert>{state.error}</Alert>}
      {blocked && <p className="text-sm text-amber-800">{blocked}</p>}
      <Button type="submit" disabled={pending || !!blocked} className="self-start" data-testid="send-revision">
        {pending ? "Sending…" : "Send revised version"}
      </Button>
    </form>
  );
}

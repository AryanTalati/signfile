"use client";

import { useActionState } from "react";
import { sendDraftAction, type ActionState } from "@/app/(app)/files/[id]/actions";
import { Card } from "@/components/ui";

export function SendDraft({ fileId, firstSigner }: { fileId: string; firstSigner: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(sendDraftAction, {});
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4" data-testid="draft">
      <div className="min-w-0 flex-1">
        <p className="font-medium">Draft: not sent yet</p>
        <p className="text-sm text-muted">No signing links or emails have gone out. Sending emails {firstSigner} their link.</p>
        {state.error && <p className="mt-1 text-sm text-red-700">{state.error}</p>}
      </div>
      <form action={action}>
        <input type="hidden" name="fileId" value={fileId} />
        <button disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60" data-testid="send-draft">
          {pending ? "Sending…" : "Send now"}
        </button>
      </form>
    </Card>
  );
}

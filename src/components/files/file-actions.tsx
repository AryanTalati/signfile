"use client";

import { useActionState, useState } from "react";
import { resendAction, voidAction, type ActionState } from "@/app/(app)/files/[id]/actions";
import { Card } from "@/components/ui";

export function FileActions({ fileId, canResend, canVoid, waitingOn, expired = false }: { fileId: string; canResend: boolean; canVoid: boolean; waitingOn: string | null; expired?: boolean }) {
  const [resend, resendFormAction, resending] = useActionState<ActionState, FormData>(resendAction, {});
  const [voided, voidFormAction, voiding] = useActionState<ActionState, FormData>(voidAction, {});
  const [showVoid, setShowVoid] = useState(false);
  if (!canResend && !canVoid) return null;
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="file-actions">
      <h2 className="text-sm font-semibold">Actions</h2>
      <div className="flex flex-wrap gap-2">
        {canResend && (
          <form action={resendFormAction}>
            <input type="hidden" name="fileId" value={fileId} />
            <button disabled={resending} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-60">
              {resending ? "Resending…" : expired ? `Extend and resend to ${waitingOn ?? "signer"}` : `Resend to ${waitingOn ?? "signer"}`}
            </button>
          </form>
        )}
        {canVoid && !showVoid && (
          <button type="button" onClick={() => setShowVoid(true)} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">
            Void this File
          </button>
        )}
      </div>
      {resend.error && <p className="text-sm text-red-700">{resend.error}</p>}
      {resend.ok && <p className="text-sm text-green-700">{resend.ok}</p>}
      {canVoid && showVoid && (
        <form action={voidFormAction} className="flex flex-col gap-2 rounded-lg border border-red-200 p-3">
          <input type="hidden" name="fileId" value={fileId} />
          <label className="text-sm font-medium">
            Why are you voiding it? <span className="font-normal text-muted">(kept in the audit trail; signers aren&apos;t shown the reason)</span>
            <textarea name="reason" required minLength={3} maxLength={500} rows={2} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-base sm:text-sm" />
          </label>
          <p className="text-xs text-muted">All signing links stop working and everyone who received one is emailed.</p>
          <div className="flex gap-2">
            <button disabled={voiding} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {voiding ? "Voiding…" : "Void File"}
            </button>
            <button type="button" onClick={() => setShowVoid(false)} className="rounded-lg border border-border px-3 py-2 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}
      {voided.error && <p className="text-sm text-red-700">{voided.error}</p>}
      {voided.ok && <p className="text-sm text-green-700">{voided.ok}</p>}
    </Card>
  );
}

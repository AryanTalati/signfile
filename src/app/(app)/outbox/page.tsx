import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { requireAuth } from "@/lib/auth/session";
import { kindLabel, listOutbox } from "@/lib/email/list";
import { sendingEnabled } from "@/lib/email/outbox";
import { EmailStatus } from "@/components/email-status";

export const metadata: Metadata = { title: "Outbox · signfile" };

export default async function OutboxPage() {
  const auth = await requireAuth();
  const emails = await listOutbox(auth);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Outbox</h1>
        <p className="mt-1 text-sm text-muted">Every email SignFile generated for your Files, and whether it was sent.</p>
        {!sendingEnabled() && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="sending-off">
            Sending is off in this environment: emails are captured here instead. Open one to copy its signing link.
          </p>
        )}
      </div>
      {emails.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted">No emails yet. They appear here when you send a File.</Card>
      ) : (
        <Card className="divide-y divide-border" data-testid="outbox-list">
          {emails.map((m) => (
            <div key={m.id} className="flex flex-col gap-0.5 px-4 py-3 hover:bg-neutral-50 sm:flex-row sm:items-center sm:gap-4" data-testid="outbox-row">
              <Link href={`/outbox/${m.id}`} className="block min-w-0 flex-1" data-testid="outbox-open">
              <span className="block min-w-0">
                <span className="block truncate font-medium">{m.subject}</span>
                <span className="block truncate text-sm text-muted">
                  To {m.toName ? `${m.toName} <${m.toEmail}>` : m.toEmail}
                  {m.client ? ` · ${m.client}` : ""}
                </span>
              </span>
              </Link>
              <span className="shrink-0 text-xs text-muted">
                {kindLabel(m.kind)} · <EmailStatus id={m.id} status={m.status} error={m.error} /> · <LocalTime iso={m.createdAt.toISOString()} />
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

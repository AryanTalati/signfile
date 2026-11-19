import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { requireAuth } from "@/lib/auth/session";
import { kindLabel, listOutbox } from "@/lib/email/list";

export const metadata: Metadata = { title: "Outbox · signfile" };

const STATUS: Record<string, string> = { skipped: "Not sent (outbox only)", queued: "Queued", sent: "Sent", failed: "Failed" };

export default async function OutboxPage() {
  const auth = await requireAuth();
  const emails = await listOutbox(auth);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Outbox</h1>
        <p className="mt-1 text-sm text-muted">
          Every email signfile generated for your Files. Email delivery isn&apos;t set up yet, so nothing is sent: open an email to copy its signing link.
        </p>
      </div>
      {emails.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted">No emails yet. They appear here when you send a File.</Card>
      ) : (
        <Card className="divide-y divide-border" data-testid="outbox-list">
          {emails.map((m) => (
            <Link key={m.id} href={`/outbox/${m.id}`} className="flex flex-col gap-0.5 px-4 py-3 hover:bg-neutral-50 sm:flex-row sm:items-center sm:gap-4" data-testid="outbox-row">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.subject}</span>
                <span className="block truncate text-sm text-muted">
                  To {m.toName ? `${m.toName} <${m.toEmail}>` : m.toEmail}
                  {m.client ? ` · ${m.client}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted">
                {kindLabel(m.kind)} · {STATUS[m.status] ?? m.status} · <LocalTime iso={m.createdAt.toISOString()} />
              </span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

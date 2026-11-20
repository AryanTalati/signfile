import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { CopyLink } from "@/components/files/copy-link";
import { LocalTime } from "@/components/local-time";
import { requireAuth } from "@/lib/auth/session";
import { getOutboxEmail, kindLabel, linksIn } from "@/lib/email/list";
import { EmailStatus } from "@/components/email-status";

export const metadata: Metadata = { title: "Email · signfile" };

export default async function OutboxEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const row = await getOutboxEmail(auth, id);
  if (!row) notFound();
  const m = row.email;
  const links = linksIn(m.text);
  return (
    <div className="flex flex-col gap-4">
      <Link href="/outbox" className="text-sm text-muted hover:underline">
        ← Outbox
      </Link>
      <div>
        <h1 className="text-xl font-semibold" data-testid="email-subject">
          {m.subject}
        </h1>
        <p className="mt-1 text-sm text-muted">
          To {m.toName ? `${m.toName} <${m.toEmail}>` : m.toEmail} · {kindLabel(m.kind)} · <LocalTime iso={m.createdAt.toISOString()} />
          {m.fileId && (
            <>
              {" · "}
              <Link className="underline" href={`/files/${m.fileId}`}>
                {row.client ?? "File"}
              </Link>
            </>
          )}
        </p>
        <p className="mt-1 text-sm">
          <EmailStatus id={m.id} status={m.status} error={m.error} />
          {m.sentAt && (
            <span className="text-muted">
              {" "}
              · sent <LocalTime iso={m.sentAt.toISOString()} />
            </span>
          )}
        </p>
      </div>
      {links.length > 0 && (
        <Card className="flex flex-col gap-2 p-4" data-testid="email-links">
          <p className="text-sm font-medium">Links in this email</p>
          {links.map((l) => (
            <CopyLink key={l} url={l} />
          ))}
        </Card>
      )}
      <Card className="overflow-hidden">
        {/* The email exactly as it would be sent, isolated from the app (no scripts, no same-origin). */}
        <iframe title="Email body" srcDoc={m.html} sandbox="" className="h-[520px] w-full bg-white" data-testid="email-body" />
      </Card>
    </div>
  );
}

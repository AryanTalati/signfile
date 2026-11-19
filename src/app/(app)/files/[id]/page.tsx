import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card } from "@/components/ui";
import { CopyLink } from "@/components/files/copy-link";
import { FileStatus } from "@/components/files/status";
import { requireAuth } from "@/lib/auth/session";
import { getFile, signLink } from "@/lib/files/service";
import { appUrl } from "@/lib/http/app-url";

export const metadata: Metadata = { title: "File · signfile" };

const EVENT_LABEL: Record<string, string> = {
  "file.created": "File created",
  "file.sent": "Sent for signature",
};

const RECIPIENT_STATUS: Record<string, string> = {
  waiting: "Waiting for earlier signer",
  active: "Link sent, not opened",
  viewed: "Opened",
  signed: "Signed",
  declined: "Declined",
  changes_requested: "Requested changes",
  forwarded: "Forwarded",
  revoked: "Link revoked",
};

const fmt = (d: Date | null) => (d ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "");

export default async function FilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; signNowError?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const { sent, signNowError } = await searchParams;
  const data = await getFile(auth, id);
  if (!data) notFound();
  const { file, recipients, events, emails, templateName } = data;
  const base = await appUrl();
  const live = recipients.filter((r) => r.status === "active" || r.status === "viewed");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard" className="text-sm text-muted hover:underline">
          ← Files
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{file.clientLegalName}</h1>
          <FileStatus status={file.status} waitingOn={live[0]?.roleKey ?? null} />
        </div>
        <p className="mt-1 text-sm text-muted">
          {templateName}
          {file.reference ? ` · Ref ${file.reference}` : ""} · Sent {fmt(file.sentAt)}
        </p>
      </div>

      {signNowError && <Alert>Couldn&apos;t sign while sending: {signNowError}</Alert>}
      {sent && live[0] && live[0].userId !== auth.user.id && (
        <Alert tone="success">
          <p className="font-medium">Sent. Share this link with {live[0].name}:</p>
          <div className="mt-2">
            <CopyLink url={signLink(base, live[0].token)} />
          </div>
          <p className="mt-2 text-xs">The email is in your outbox below. Email delivery isn&apos;t set up yet, so share the link directly.</p>
        </Alert>
      )}

      <Card className="divide-y divide-border">
        <h2 className="px-4 py-3 text-sm font-semibold">Signers</h2>
        {recipients.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 px-4 py-3" data-testid={`recipient-${r.roleKey}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">{r.roleKey === "firm" ? "Countersigns" : "Client"}</span>
              <span className="font-medium">{r.name}</span>
              {r.title && <span className="text-sm text-muted">{r.title}</span>}
              <span className="text-sm text-muted">{r.email}</span>
              <span className="ml-auto text-sm" data-testid="recipient-status">
                {RECIPIENT_STATUS[r.status] ?? r.status}
              </span>
            </div>
            {(r.status === "active" || r.status === "viewed") && r.userId === auth.user.id && (
              <a href={`/sign/${r.token}`} className="self-start rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white" data-testid="countersign-now">
                Countersign now
              </a>
            )}
            {(r.status === "active" || r.status === "viewed") && <CopyLink url={signLink(base, r.token)} />}
          </div>
        ))}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="px-4 py-3 text-sm font-semibold">Timeline</h2>
          <ol className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.id} className="px-4 py-2.5 text-sm">
                <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
                <span className="text-muted"> · {e.actorLabel ?? e.actorType}</span>
                <span className="block text-xs text-muted">{fmt(e.createdAt)}</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <h2 className="px-4 py-3 text-sm font-semibold">Emails</h2>
          <ul className="divide-y divide-border">
            {emails.map((m) => (
              <li key={m.id} className="px-4 py-2.5 text-sm">
                <span className="font-medium">{m.subject}</span>
                <span className="block text-xs text-muted">
                  To {m.toName ? `${m.toName} <${m.toEmail}>` : m.toEmail} · {m.status === "skipped" ? "Not sent (outbox only)" : m.status} · {fmt(m.createdAt)}
                </span>
              </li>
            ))}
            {!emails.length && <li className="px-4 py-2.5 text-sm text-muted">None yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Alert, ButtonLink, Card } from "@/components/ui";
import { FileStatus } from "@/components/files/status";
import { requireAuth } from "@/lib/auth/session";
import { listAwaitingMe, listFiles } from "@/lib/files/service";

export const metadata: Metadata = { title: "Files · signfile" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const auth = await requireAuth();
  const { user, company } = auth;
  const { welcome } = await searchParams;
  const [files, awaiting] = await Promise.all([listFiles(auth), listAwaitingMe(auth)]);
  return (
    <div className="flex flex-col gap-6">
      {welcome && <Alert tone="success">Welcome to signfile, {user.name.split(" ")[0]}. {company.name} is set up.</Alert>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Files</h1>
          <p className="mt-1 text-sm text-muted">Every client agreement you send, and where it stands.</p>
        </div>
        <ButtonLink href="/files/new">New File</ButtonLink>
      </div>
      {awaiting.length > 0 && (
        <Card className="border-violet-200 bg-violet-50 p-4" data-testid="awaiting-me">
          <p className="font-medium text-violet-900">Waiting for your countersignature</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {awaiting.map((a) => (
              <li key={a.fileId} className="flex items-center gap-3 text-sm">
                <Link href={`/files/${a.fileId}`} className="min-w-0 flex-1 truncate hover:underline">
                  {a.clientLegalName} has signed
                </Link>
                <a href={`/sign/${a.token}`} className="rounded-md bg-violet-700 px-3 py-1 text-xs font-medium text-white">
                  Countersign now
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {files.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="font-medium">No Files yet</p>
          <p className="mt-1 text-sm text-muted">Upload your client agreement as a template, then create a File to send it.</p>
          <div className="mt-4 flex justify-center gap-2">
            <ButtonLink href="/templates/new" variant="secondary">
              Upload agreement
            </ButtonLink>
            <ButtonLink href="/files/new">New File</ButtonLink>
          </div>
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {files.map((f) => (
            <Link key={f.id} href={`/files/${f.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-neutral-50">
              <span className="min-w-0 flex-1 truncate font-medium">{f.clientLegalName}</span>
              <span className="text-sm text-muted">
                {f.templateName ?? "Agreement"}
                {f.reference ? ` · ${f.reference}` : ""}
              </span>
              <FileStatus status={f.status} />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

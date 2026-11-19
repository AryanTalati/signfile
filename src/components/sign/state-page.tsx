import type { SigningState } from "@/lib/files/signing";

const COPY: Record<Exclude<SigningState, "sign">, (o: { brand: string; doc: string; name: string; exp: string }) => { title: string; body: string }> = {
  signed: (o) => ({ title: "You've signed", body: `Thanks, ${o.name.split(" ")[0]}. ${o.brand} will send everyone the signed copy once all parties have signed.` }),
  completed: (o) => ({ title: "This agreement is fully signed", body: `Everyone has signed "${o.doc}". ${o.brand} sends the final signed copy to all parties.` }),
  waiting: (o) => ({ title: "Not ready for you yet", body: `"${o.doc}" is waiting on another signer first. You'll get your link when it's your turn.` }),
  expired: (o) => ({ title: "This link has expired", body: `The signing link for "${o.doc}" expired${o.exp ? ` on ${o.exp}` : ""}. Ask ${o.brand} to send you a new one.` }),
  voided: (o) => ({ title: "This agreement was cancelled", body: `${o.brand} cancelled "${o.doc}", so it can no longer be signed. Contact them if you think this is a mistake.` }),
  replaced: (o) => ({ title: "This link was replaced", body: `This link for "${o.doc}" no longer works: it was forwarded or a newer version was sent. Use the most recent email from ${o.brand}, or ask them for a new link.` }),
  declined: (o) => ({ title: "You declined this agreement", body: `${o.brand} has been told. Contact them if you've changed your mind.` }),
  changes_requested: (o) => ({ title: "You requested changes", body: `${o.brand} has your comments and will send a revised version.` }),
};

export function StatePage({ state, brand, documentName, recipientName, expiresAt, downloadUrl }: { state: Exclude<SigningState, "sign">; brand: { name: string; color: string }; documentName: string; recipientName: string; expiresAt: string | null; downloadUrl?: string }) {
  const exp = expiresAt ? new Date(expiresAt).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" }) : "";
  const c = COPY[state]({ brand: brand.name, doc: documentName, name: recipientName, exp });
  return (
    <main className="flex min-h-dvh flex-col" style={{ ["--brand" as string]: brand.color }}>
      <header className="border-b-4 bg-surface px-4 py-3 font-semibold" style={{ borderColor: brand.color }}>
        {brand.name}
      </header>
      <div className="mx-auto mt-16 w-full max-w-md px-4 text-center" data-testid={`sign-state-${state}`}>
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="mt-3 text-muted">{c.body}</p>
        {state === "completed" && downloadUrl && (
          <a href={downloadUrl} className="mt-5 inline-block rounded-lg px-5 py-2.5 text-sm font-medium text-white" style={{ background: brand.color }} data-testid="signer-download">
            Download the signed copy
          </a>
        )}
      </div>
    </main>
  );
}

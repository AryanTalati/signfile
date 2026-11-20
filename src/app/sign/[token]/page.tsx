import type { Metadata } from "next";
import { Caveat } from "next/font/google";
import { notFound } from "next/navigation";
import { getAuth, requestMeta } from "@/lib/auth/session";
import { getSavedSignature } from "@/lib/users/signature";
import { and as andOp } from "drizzle-orm";

/** True only if every signed-copy email for this File was actually sent. */
async function signedCopyAllSent(fileId: string) {
  const rows = await db.select({ status: schema.outbox.status }).from(schema.outbox).where(andOp(eq(schema.outbox.fileId, fileId), eq(schema.outbox.kind, "signed_copy")));
  return rows.length > 0 && rows.every((r) => r.status === "sent");
}
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { CONSENT_TEXT, loadSigning, markViewed, signingView } from "@/lib/files/signing";
import { Signer } from "@/components/sign/signer";
import { StatePage } from "@/components/sign/state-page";

const sigFont = Caveat({ subsets: ["latin"], weight: ["600"], variable: "--font-sig" });

export const metadata: Metadata = { title: "Review and sign", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await loadSigning(token);
  if (!ctx) notFound();
  const brand = { name: ctx.company.name, color: ctx.company.brandColor };

  if (ctx.state !== "sign") {
    const [t] = ctx.file.templateId ? await db.select({ name: schema.templates.name }).from(schema.templates).where(eq(schema.templates.id, ctx.file.templateId)) : [];
    return (
      <StatePage
        state={ctx.state}
        brand={brand}
        documentName={t?.name ?? "Agreement"}
        recipientName={ctx.recipient.name}
        expiresAt={ctx.file.expiresAt?.toISOString() ?? null}
        downloadUrl={ctx.state === "completed" && ctx.recipient.status === "signed" ? `/api/sign/${token}/download` : undefined}
        copyEmailed={ctx.state === "completed" ? await signedCopyAllSent(ctx.file.id) : false}
      />
    );
  }

  await markViewed(ctx, await requestMeta());
  const view = await signingView(ctx);
  // One-click countersign: only for the logged-in user named on this signer slot.
  const auth = await getAuth();
  const isMe = !!auth && !!ctx.recipient.userId && auth.user.id === ctx.recipient.userId && auth.company.id === ctx.file.companyId;
  const saved = isMe ? await getSavedSignature(auth!.user.id) : null;
  const [t] = ctx.file.templateId ? await db.select({ name: schema.templates.name }).from(schema.templates).where(eq(schema.templates.id, ctx.file.templateId)) : [];
  return (
    <div className={sigFont.variable}>
      <Signer
        token={token}
        brand={brand}
        documentName={t?.name ?? "Agreement"}
        clientLegalName={ctx.file.clientLegalName}
        recipient={{ name: ctx.recipient.name, role: ctx.recipient.roleKey === "firm" ? "firm" : "client" }}
        consented={!!ctx.recipient.consentAt}
        consentText={CONSENT_TEXT}
        pages={view.pages}
        fields={view.fields}
        myRole={ctx.recipient.roleKey}
        shown={view.shown}
        prefill={view.prefill}
        quick={isMe ? { savedSignature: saved?.signature ?? null } : null}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { Caveat } from "next/font/google";
import { notFound } from "next/navigation";
import { requestMeta } from "@/lib/auth/session";
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
    return <StatePage state={ctx.state} brand={brand} documentName={t?.name ?? "Agreement"} recipientName={ctx.recipient.name} expiresAt={ctx.file.expiresAt?.toISOString() ?? null} />;
  }

  await markViewed(ctx, await requestMeta());
  const view = await signingView(ctx);
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
      />
    </div>
  );
}

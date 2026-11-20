import type { Metadata } from "next";
import { Caveat } from "next/font/google";
import { Card } from "@/components/ui";
import { requireAuth } from "@/lib/auth/session";
import { ADOPT_TEXT, getSavedSignature } from "@/lib/users/signature";
import { DetailsForm } from "./details-form";
import { SignatureSettings } from "./signature-settings";
import { RemindersForm } from "./reminders-form";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";

const sigFont = Caveat({ subsets: ["latin"], weight: ["600"], variable: "--font-sig" });
export const metadata: Metadata = { title: "Settings · signfile" };

export default async function SettingsPage() {
  const auth = await requireAuth();
  const [saved, [company]] = await Promise.all([
    getSavedSignature(auth.user.id),
    db
      .select({ enabled: schema.companies.remindersEnabled, days: schema.companies.reminderDays, finalDays: schema.companies.finalReminderDays, expiry: schema.companies.linkExpiryDays })
      .from(schema.companies)
      .where(eq(schema.companies.id, auth.company.id)),
  ]);
  return (
    <div className={`mx-auto flex max-w-2xl flex-col gap-6 ${sigFont.variable}`}>
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted">{auth.company.name}</p>
      </div>
      <Card className="p-5">
        <h2 className="font-semibold">Your details</h2>
        <DetailsForm name={auth.user.name} title={auth.user.title ?? ""} />
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold">Your signature</h2>
        <p className="mt-1 text-sm text-muted">Save it once, then countersign a client&apos;s agreement with one click. You still choose to sign each time.</p>
        <SignatureSettings name={auth.user.name} saved={saved ? { signature: saved.signature, initials: saved.initials } : null} adoptText={ADOPT_TEXT} />
      </Card>
      {auth.user.role === "admin" && company && (
        <Card className="p-5">
          <h2 className="font-semibold">Reminders and expiry</h2>
          <p className="mt-1 text-sm text-muted">For your whole firm. Reminders go to whoever&apos;s turn it is and stop once the File is signed, voided, declined or has changes requested.</p>
          <RemindersForm enabled={company.enabled} days={(company.days ?? []).join(", ")} finalDays={company.finalDays} expiry={company.expiry} />
        </Card>
      )}
    </div>
  );
}

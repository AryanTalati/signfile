import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/ui";

export const metadata: Metadata = { title: "Privacy · SignFile" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-12">
      <Link href="/" className="text-xl">
        <Wordmark />
      </Link>
      <h1 className="text-2xl font-semibold">Privacy</h1>
      <p>
        SignFile is a <strong>test project</strong> built for a technical assessment. It isn&apos;t a commercial service. Please use <strong>test data only</strong>: made-up names,
        test email addresses and sample documents, never real personal information or real agreements.
      </p>
      <h2 className="text-lg font-semibold">What we store</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Uploaded documents and the signed PDFs produced from them.</li>
        <li>Account details (name, email, title) and, for each signer: name, email, title, signature image, IP address, browser, and the times they viewed, agreed to sign and signed. This is the audit trail that makes an electronic signature verifiable.</li>
        <li>Copies of the emails SignFile sends.</li>
      </ul>
      <p>This data is stored only to run the demo. It isn&apos;t sold or shared, and it isn&apos;t used to train AI models.</p>
      <h2 className="text-lg font-semibold">Deletion</h2>
      <p>Documents, signer details and accounts can be deleted on request. Ask the person who invited you, or the firm that sent you a document, and it will be removed.</p>
      <p className="text-sm text-muted">
        <Link href="/verify" className="underline">
          Verify a signed document
        </Link>
      </p>
    </main>
  );
}

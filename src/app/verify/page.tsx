import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/ui";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Verify a signed document · signfile" };

export default function VerifyPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-4 py-12">
      <Link href="/" className="text-xl">
        <Wordmark />
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Verify a signed document</h1>
        <p className="mt-1 text-muted">Check that a PDF is exactly the signed copy signfile sealed: not edited, not a different version. The file is hashed (SHA-256) and compared; it isn&apos;t stored.</p>
      </div>
      <VerifyForm />
    </main>
  );
}

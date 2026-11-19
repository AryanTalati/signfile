import { redirect } from "next/navigation";
import { ButtonLink, Wordmark } from "@/components/ui";
import { getAuth } from "@/lib/auth/session";

export default async function Home() {
  if (await getAuth()) redirect("/dashboard");
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-4 py-12">
      <Wordmark className="text-3xl" />
      <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Get your client agreement signed on every File.</h1>
      <p className="text-lg text-muted">
        Upload any agreement, PDF or Word. signfile finds the signature fields, sends it, collects the client&apos;s signature and your
        countersignature, and gives you a sealed PDF with an audit certificate.
      </p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/signup">Create your company</ButtonLink>
        <ButtonLink href="/login" variant="secondary">
          Log in or try the demo
        </ButtonLink>
      </div>
      <a href="/verify" className="text-sm text-muted underline">
        Verify a signed document
      </a>
    </main>
  );
}

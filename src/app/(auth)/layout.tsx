import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/ui";
import { getAuth } from "@/lib/auth/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getAuth()) redirect("/dashboard");
  return (
    <main className="flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center">
      <Link href="/" className="mb-8 text-2xl">
        <Wordmark />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

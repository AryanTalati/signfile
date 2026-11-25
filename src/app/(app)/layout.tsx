import Link from "next/link";
import { Wordmark } from "@/components/ui";
import { requireAuth } from "@/lib/auth/session";
import { logoutAction } from "../(auth)/actions";

const nav = [
  { href: "/dashboard", label: "Files" },
  { href: "/templates", label: "Templates" },
  { href: "/bulk", label: "Bulk sends" },
  { href: "/outbox", label: "Outbox" },
  { href: "/settings", label: "Settings" },
  { href: "/verify", label: "Verify" }, // the public /verify page, reachable from inside the app
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, company } = await requireAuth();
  return (
    <div className="min-h-dvh" style={{ ["--brand" as string]: company.brandColor }}>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2 text-lg">
            <Wordmark />
            <span className="text-muted">/</span>
            <span className="text-base font-medium">{company.name}</span>
          </Link>
          <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-neutral-100 hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{user.name}</span>
            <form action={logoutAction}>
              <button className="rounded-md px-2 py-1 text-muted hover:bg-neutral-100 hover:text-foreground">Log out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}

import type { Metadata } from "next";
import { Alert, Card } from "@/components/ui";
import { requireAuth } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Files · signfile" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { user, company } = await requireAuth();
  const { welcome } = await searchParams;
  return (
    <div className="flex flex-col gap-6">
      {welcome && <Alert tone="success">Welcome to signfile, {user.name.split(" ")[0]}. {company.name} is set up.</Alert>}
      <div>
        <h1 className="text-2xl font-semibold">Files</h1>
        <p className="mt-1 text-sm text-muted">Every client agreement you send, and where it stands.</p>
      </div>
      <Card className="p-10 text-center">
        <p className="font-medium">No Files yet</p>
        <p className="mt-1 text-sm text-muted">Upload your client agreement as a template, then create a File to send it.</p>
      </Card>
    </div>
  );
}

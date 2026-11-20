import type { Metadata } from "next";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Upload agreement · signfile" };

export default async function NewTemplatePage({ searchParams }: { searchParams: Promise<{ reviseFile?: string }> }) {
  const { reviseFile } = await searchParams;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Upload your agreement</h1>
        <p className="mt-1 text-sm text-muted">
          PDF or Word. We&apos;ll find where each party signs, initials and dates. You check the fields before anything is sent.
        </p>
      </div>
      {reviseFile && (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900" data-testid="revise-banner">
          Upload the revised agreement for this File. You&apos;ll review its fields, then resend it to the signers.
        </p>
      )}
      <UploadForm reviseFile={reviseFile} />
    </div>
  );
}

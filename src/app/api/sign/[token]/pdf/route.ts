import { loadSigning, signingPdf } from "@/lib/files/signing";
import { fail } from "@/lib/http/respond";

export const runtime = "nodejs";

/** The document for a signer. Only while the link is usable (or after they signed). */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await loadSigning(token);
  if (!ctx || !["sign", "signed", "waiting"].includes(ctx.state)) return fail(404, "This link isn't available.");
  const bytes = await signingPdf(ctx);
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "application/pdf", "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" },
  });
}

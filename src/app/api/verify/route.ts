import { fail, json } from "@/lib/http/respond";
import { MAX_UPLOAD_BYTES, sha256 } from "@/lib/pdf/prepare";
import { verifyByFileId, verifyByHash } from "@/lib/verify/lookup";

export const runtime = "nodejs";

/**
 * Public: does this PDF exactly match a document sealed by signfile? Hash-only lookup;
 * reveals just enough to confirm authenticity (firm, completion date, signer count).
 */
export async function POST(req: Request) {
  let bytes: Uint8Array;
  try {
    const f = (await req.formData()).get("file");
    if (!(f instanceof File) || !f.size) return fail(400, "Choose a PDF to check.");
    if (f.size > MAX_UPLOAD_BYTES) return fail(413, "That file is over 25 MB.");
    bytes = new Uint8Array(await f.arrayBuffer());
  } catch {
    return fail(400, "Choose a PDF to check.");
  }
  return json(await verifyByHash(sha256(bytes)));
}

/** GET /api/verify?file=<id>: the same result as uploading that File's sealed PDF. Read-only. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("file") ?? "";
  return json(await verifyByFileId(id));
}

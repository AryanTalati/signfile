import { fail, json, authOr401 } from "@/lib/http/respond";
import { MAX_UPLOAD_BYTES, UploadError } from "@/lib/pdf/prepare";
import { AbortedError, BusyError, createTemplateFromUpload, RevisionError } from "@/lib/templates/service";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Upload an agreement (multipart field "file"); returns the new template id and detection summary. */
export async function POST(req: Request) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 64 * 1024) return fail(413, "That file is over 25 MB.", { code: "too_large" });

  let file: File | null = null;
  let reviseFile: string | undefined;
  try {
    const form = await req.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
    const r = form.get("reviseFile");
    reviseFile = typeof r === "string" && r ? r : undefined;
  } catch {
    return fail(400, "Upload a file.", { code: "empty" });
  }
  if (!file || file.size === 0) return fail(400, "Upload a file.", { code: "empty" });

  try {
    const { templateId, detection } = await createTemplateFromUpload(auth, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, req.signal, reviseFile);
    return json({ id: templateId, outcome: detection.outcome, fields: detection.fields.length, warnings: detection.warnings }, 201);
  } catch (e) {
    if (e instanceof UploadError) return fail(422, e.message, { code: e.code });
    if (e instanceof RevisionError) return fail(409, e.message);
    if (e instanceof BusyError) return fail(503, e.message, { code: "busy" });
    if (e instanceof AbortedError) return new Response(null, { status: 499 });
    console.error("template upload failed", e);
    return fail(500, "Something went wrong processing that document. Please try again.");
  }
}

import { z } from "zod";
import { retryOutbox } from "@/lib/email/outbox";
import { authOr401, fail, json } from "@/lib/http/respond";

export const runtime = "nodejs";

/** Retry a failed email (sends now and reports the result). */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail(404, "Email not found.");
  const result = await retryOutbox(auth.company.id, id);
  if (!result) return fail(409, "Only failed emails can be retried.");
  return json({ result });
}

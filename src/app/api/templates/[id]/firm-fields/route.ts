import { authOr401, fail, json } from "@/lib/http/respond";
import { detectFirmFields } from "@/lib/templates/service";

export const runtime = "nodejs";

/** "Firm signs too" turned on with no firm fields yet: detect the firm's side of the signature block. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const fields = await detectFirmFields(auth, (await params).id);
  if (!fields) return fail(404, "Template not found.");
  return json({ fields });
}

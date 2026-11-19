import { getFile } from "@/lib/files/service";
import { sealFile } from "@/lib/files/seal";
import { appUrl } from "@/lib/http/app-url";
import { authOr401, fail, json } from "@/lib/http/respond";

export const runtime = "nodejs";

/** Retry sealing a completed File (normally sealing happens with the last signature). */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authOr401();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const data = await getFile(auth, id);
  if (!data) return fail(404, "File not found.");
  if (data.file.status !== "completed") return fail(409, "This File isn't fully signed yet.");
  try {
    return json(await sealFile(data.file.id, await appUrl()));
  } catch (e) {
    console.error("seal retry failed", e);
    return fail(500, "Sealing failed. Please try again.");
  }
}

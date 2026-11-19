import "server-only";
import { getAuth, type AuthContext } from "@/lib/auth/session";

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

/** Route-handler auth: the signed-in context, or a 401 response to return. */
export async function authOr401(): Promise<AuthContext | Response> {
  const auth = await getAuth();
  return auth ?? fail(401, "Your session has ended. Log in again.");
}

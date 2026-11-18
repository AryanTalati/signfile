import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/lib/db/client";

const COOKIE = "sf_session";
const TTL_DAYS = 30;
const RENEW_WITHIN_DAYS = 15;
const DAY = 86_400_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface AuthContext {
  user: { id: string; email: string; name: string; title: string | null; role: "admin" | "member" };
  company: { id: string; name: string; slug: string; brandColor: string; logoKey: string | null };
  sessionId: string;
}

export async function requestMeta() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 500) ?? null };
}

/** Creates a session row and sets the cookie. Only the token's hash is stored. */
export async function startSession(userId: string, companyId: string) {
  const token = randomBytes(32).toString("base64url");
  const { ip, userAgent } = await requestMeta();
  const expiresAt = new Date(Date.now() + TTL_DAYS * DAY);
  await db.insert(schema.sessions).values({ id: sha256(token), userId, companyId, expiresAt, ip, userAgent });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  jar.delete(COOKIE);
}

/** The signed-in user and their company, or null. Cached per request. */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const id = sha256(token);
  const [row] = await db
    .select({
      sessionId: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
      user: {
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        title: schema.users.title,
        role: schema.users.role,
      },
      company: {
        id: schema.companies.id,
        name: schema.companies.name,
        slug: schema.companies.slug,
        brandColor: schema.companies.brandColor,
        logoKey: schema.companies.logoKey,
      },
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    // Join on the session's company AND the user's company: a session can never cross tenants.
    .innerJoin(schema.companies, and(eq(schema.companies.id, schema.sessions.companyId), eq(schema.companies.id, schema.users.companyId)))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;

  // Sliding expiry: extend in the background when less than half the TTL is left.
  if (row.expiresAt.getTime() - Date.now() < RENEW_WITHIN_DAYS * DAY) {
    void db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() + TTL_DAYS * DAY) })
      .where(eq(schema.sessions.id, id))
      .catch(() => undefined);
  }
  return { user: row.user, company: row.company, sessionId: row.sessionId };
});

/** For pages and actions behind login. Redirects to /login if signed out. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

export async function requireAdmin(): Promise<AuthContext> {
  const auth = await requireAuth();
  if (auth.user.role !== "admin") redirect("/dashboard?error=admin-only");
  return auth;
}

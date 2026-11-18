"use server";

import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { passwordProblem, verifyPassword } from "@/lib/auth/password";
import { endSession, requestMeta, startSession } from "@/lib/auth/session";
import { clearFailures, isThrottled, loginKeys, recordFailure } from "@/lib/auth/throttle";
import { createCompanyWithAdmin, EmailTakenError, normalizeEmail } from "@/lib/companies/create";
import { db, schema } from "@/lib/db/client";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

/** Only allow same-site relative redirects after login. */
function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

const signupSchema = z.object({
  companyName: z.string().trim().min(2, "Enter your company's name.").max(120),
  name: z.string().trim().min(2, "Enter your name.").max(120),
  email: z.string().trim().email("Enter a valid email."),
  password: z.string(),
});

export async function signupAction(_: FormState, fd: FormData): Promise<FormState> {
  const values = { companyName: str(fd, "companyName"), name: str(fd, "name"), email: str(fd, "email") };
  const parsed = signupSchema.safeParse({ ...values, password: str(fd, "password") });
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
  const pw = passwordProblem(str(fd, "password"));
  if (pw) fieldErrors.password = pw;
  if (Object.keys(fieldErrors).length || !parsed.success) return { fieldErrors, values };

  try {
    const { companyId, userId } = await createCompanyWithAdmin(parsed.data);
    await startSession(userId, companyId);
  } catch (e) {
    if (e instanceof EmailTakenError) return { fieldErrors: { email: "An account with that email already exists. Log in instead." }, values };
    console.error("signup failed", e);
    return { error: "Something went wrong creating your account. Please try again.", values };
  }
  redirect("/dashboard?welcome=1");
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = normalizeEmail(str(fd, "email"));
  const password = str(fd, "password");
  const values = { email };
  if (!email || !password) return { error: "Enter your email and password.", values };

  const { ip } = await requestMeta();
  const keys = loginKeys(ip, email);
  if (isThrottled(keys)) return { error: "Too many attempts. Wait 15 minutes and try again.", values };

  const [user] = await db
    .select({ id: schema.users.id, companyId: schema.users.companyId, passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`)
    .limit(1);

  if (!(await verifyPassword(user?.passwordHash ?? null, password))) {
    recordFailure(keys);
    return { error: "That email and password don't match.", values };
  }
  clearFailures(keys);
  await startSession(user.id, user.companyId);
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(sql`${schema.users.id} = ${user.id}`);
  redirect(safeNext(str(fd, "next")));
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

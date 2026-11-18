import "server-only";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { db, schema } from "@/lib/db/client";

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "company"
  );
}

export class EmailTakenError extends Error {
  constructor() {
    super("An account with that email already exists.");
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Creates a company and its first admin in one transaction. The admin is also
 * the company's default countersigner until they pick someone else.
 */
export async function createCompanyWithAdmin(input: {
  companyName: string;
  name: string;
  email: string;
  password: string;
  title?: string | null;
  brandColor?: string;
  slug?: string;
}) {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const base = input.slug ?? slugify(input.companyName);

  // Two signups can race for the same slug (or email). On a unique violation,
  // retry with a random slug suffix; a duplicate email is reported as taken.
  for (let attempt = 0; ; attempt++) {
    try {
      return await insertCompany(input, email, passwordHash, base, attempt);
    } catch (e) {
      const v = uniqueViolation(e);
      if (v?.includes("email")) throw new EmailTakenError();
      if (v?.includes("slug") && attempt < 3) continue;
      throw e;
    }
  }
}

/** Constraint name if `e` (or its cause, as Drizzle wraps driver errors) is a unique violation. */
function uniqueViolation(e: unknown): string | null {
  for (let cur = e as { code?: string; constraint_name?: string; cause?: unknown } | undefined; cur; cur = cur.cause as typeof cur) {
    if (cur.code === "23505") return cur.constraint_name ?? "";
  }
  return null;
}

async function insertCompany(
  input: Parameters<typeof createCompanyWithAdmin>[0],
  email: string,
  passwordHash: string,
  base: string,
  attempt: number,
) {
  return db.transaction(async (tx) => {
    const taken = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email}`)
      .limit(1);
    if (taken.length) throw new EmailTakenError();

    // Slug: name-based, with a numeric suffix if it's taken.
    const existing = await tx
      .select({ slug: schema.companies.slug })
      .from(schema.companies)
      .where(sql`${schema.companies.slug} = ${base} or ${schema.companies.slug} like ${base + "-%"}`);
    const used = new Set(existing.map((r) => r.slug));
    let slug = base;
    for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
    if (attempt > 0) slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;

    const [company] = await tx
      .insert(schema.companies)
      .values({ name: input.companyName.trim(), slug, ...(input.brandColor ? { brandColor: input.brandColor } : {}) })
      .returning();
    const [user] = await tx
      .insert(schema.users)
      .values({
        companyId: company.id,
        email,
        name: input.name.trim(),
        title: input.title?.trim() || null,
        role: "admin",
        passwordHash,
      })
      .returning({ id: schema.users.id });
    await tx.update(schema.companies).set({ defaultCountersignerId: user.id }).where(eq(schema.companies.id, company.id));
    await tx.insert(schema.events).values({
      companyId: company.id,
      actorType: "user",
      actorId: user.id,
      actorLabel: input.name.trim(),
      type: "company.created",
      data: { slug },
    });
    return { companyId: company.id, userId: user.id, slug };
  });
}

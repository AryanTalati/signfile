/**
 * Seeds the public demo company "Astra AI" and its demo login (test data only).
 * Idempotent: re-running resets the demo password and branding, and never
 * duplicates rows.
 *
 *   npm run seed
 */
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createCompanyWithAdmin } from "@/lib/companies/create";
import { db, schema } from "@/lib/db/client";
import { DEMO } from "@/lib/demo";

const TEAM = [{ email: "jordan.lee@astra-ai.example", name: "Jordan Lee", title: "Engagement Manager", role: "member" as const }];

async function main() {
  const [existing] = await db
    .select({ id: schema.users.id, companyId: schema.users.companyId })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${DEMO.email}`)
    .limit(1);

  let companyId: string;
  if (existing) {
    companyId = existing.companyId;
    await db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(DEMO.password), name: DEMO.name, title: DEMO.title, role: "admin" })
      .where(eq(schema.users.id, existing.id));
    await db.update(schema.companies).set({ name: DEMO.companyName, brandColor: DEMO.brandColor }).where(eq(schema.companies.id, companyId));
    console.log(`demo admin exists; password and branding reset (company ${companyId})`);
  } else {
    ({ companyId } = await createCompanyWithAdmin({
      companyName: DEMO.companyName,
      name: DEMO.name,
      title: DEMO.title,
      email: DEMO.email,
      password: DEMO.password,
      brandColor: DEMO.brandColor,
      slug: DEMO.slug,
      timezone: "America/Denver",
    }));
    console.log(`created demo company ${DEMO.companyName} (${companyId})`);
  }

  for (const m of TEAM) {
    const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${m.email}`).limit(1);
    if (u) continue;
    await db.insert(schema.users).values({ ...m, companyId, passwordHash: await hashPassword(DEMO.password) });
    console.log(`added team member ${m.name}`);
  }
  console.log(`\ndemo login: ${DEMO.email} / ${DEMO.password}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

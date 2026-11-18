/**
 * One-shot setup: runs pending migrations, then ensures the private storage
 * bucket exists. Safe to re-run.
 *
 *   npm run db:setup
 *
 * Note: local dev and Render share one Supabase project, so this migrates
 * production. Run it BEFORE pushing code that needs the new schema.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { ensureBucket, storageSelfTest } from "@/lib/storage";

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (or MIGRATION_DATABASE_URL) is not set");
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const t = Date.now();
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
    const [{ n }] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    console.log(`migrations: ${n} applied (${Date.now() - t} ms)`);
  } finally {
    await sql.end();
  }
  console.log(`bucket: ${await ensureBucket()}`);
  const st = await storageSelfTest();
  console.log(`storage round-trip: ${st.ok ? "ok" : "FAILED"} (${st.ms} ms)`);
  if (!st.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

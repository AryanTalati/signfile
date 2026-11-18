import { existsSync } from "node:fs";
import postgres from "postgres";
import { E2E_DOMAIN } from "./helpers";

/** Purges every company created by E2E signups (users @signfile-e2e.example). */
export default async function teardown() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (!process.env.DATABASE_URL) return;
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const rows = await sql`select distinct company_id from users where email like ${"%@" + E2E_DOMAIN}`;
    for (const r of rows) await sql`select purge_company(${r.company_id})`;
    if (rows.length) console.log(`teardown: purged ${rows.length} E2E test companies`);
  } finally {
    await sql.end();
  }
}

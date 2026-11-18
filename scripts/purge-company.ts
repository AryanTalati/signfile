/**
 * Deletes a whole company through purge_company() (the only path past the
 * insert-only events trigger), its storage objects, and logs it to
 * deletion_log. Dry run by default.
 *
 *   npm run purge:company -- <company-id>            # preview only
 *   npm run purge:company -- <company-id> --confirm  # delete
 *
 * Refuses to touch the seeded demo company.
 */
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { DEMO } from "../src/lib/demo";

const [cid, flag] = process.argv.slice(2);
const confirm = flag === "--confirm";

async function main() {
  if (!/^[0-9a-f-]{36}$/.test(cid ?? "")) throw new Error("usage: purge-company <company-uuid> [--confirm]");
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const [co] = await sql`select id, name, slug from companies where id = ${cid}`;
    if (!co) throw new Error(`no company ${cid}`);
    if (co.slug === DEMO.slug) throw new Error("refusing to purge the seeded demo company");

    const users = await sql`select id, name, role from users where company_id = ${cid}`;
    const tables = ["users", "sessions", "user_invites", "templates", "template_versions", "files", "file_documents", "recipients", "events", "outbox"];
    console.log(`company ${co.id}  "${co.name}" (${co.slug})`);
    console.log(`users: ${users.map((u) => `${u.name} [${u.role}]`).join(", ") || "none"}`);
    for (const t of tables) {
      const [{ n }] = await sql`select count(*)::int n from ${sql(t)} where company_id = ${cid}`;
      console.log(`  ${t.padEnd(18)} ${n}`);
    }
    const storage = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }).storage.from(
      process.env.STORAGE_BUCKET || "signfile",
    );
    const keys = await listAll(storage, cid);
    console.log(`  storage objects    ${keys.length}`);

    if (!confirm) {
      console.log("\nDRY RUN: nothing deleted. Re-run with --confirm to delete.");
      return;
    }
    if (keys.length) {
      for (let i = 0; i < keys.length; i += 100) {
        const { error } = await storage.remove(keys.slice(i, i + 100));
        if (error) throw new Error(`storage delete failed: ${error.message}`);
      }
    }
    const [{ counts }] = await sql`select purge_company(${cid}) as counts`;
    console.log(`\nDELETED. purge_company returned: ${JSON.stringify(counts)}`);
    const [log] = await sql`select scope, file_count, counts, created_at from deletion_log where company_id = ${cid} order by created_at desc limit 1`;
    console.log(`deletion_log: ${JSON.stringify(log)}`);
  } finally {
    await sql.end();
  }
}

async function listAll(storage: ReturnType<ReturnType<typeof createClient>["storage"]["from"]>, prefix: string): Promise<string[]> {
  const { data, error } = await storage.list(prefix, { limit: 1000 });
  if (error) throw new Error(error.message);
  const out: string[] = [];
  for (const item of data ?? []) {
    const path = `${prefix}/${item.name}`;
    if (item.id) out.push(path);
    else out.push(...(await listAll(storage, path))); // folder
  }
  return out;
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});

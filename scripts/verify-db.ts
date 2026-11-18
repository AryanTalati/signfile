/**
 * Verifies the DB security baseline against the real database. All test rows
 * are created inside a transaction that is rolled back.
 *   npm run db:verify
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);
class Rollback extends Error {}

async function expectError(tx: postgres.TransactionSql, name: string, q: () => Promise<unknown>, match: RegExp) {
  await tx`savepoint s`;
  try {
    await q();
    check(name, false, "no error raised");
  } catch (e) {
    check(name, match.test((e as Error).message), (e as Error).message);
  }
  await tx`rollback to savepoint s`;
}

async function main() {
  const rls = await sql`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
                        where n.nspname='public' and c.relkind='r' order by relname`;
  const noRls = rls.filter((r) => !r.relrowsecurity).map((r) => r.relname);
  check(`RLS enabled on all ${rls.length} public tables`, noRls.length === 0, noRls.join(", "));

  const grants = await sql`select table_name, grantee, privilege_type from information_schema.role_table_grants
                           where table_schema='public' and grantee in ('anon','authenticated')`;
  check("anon/authenticated have no table privileges", grants.length === 0, grants.map((g) => `${g.grantee}:${g.table_name}`).join(", "));

  try {
    await sql.begin(async (tx) => {
      const [co] = await tx`insert into companies (name, slug) values ('Verify Co', ${"verify-" + Date.now()}) returning id`;
      const [f] = await tx`insert into files (company_id, client_legal_name) values (${co.id}, 'Verify Client Inc') returning id`;
      await tx`insert into files (company_id, client_legal_name) values (${co.id}, 'Other Client')`;
      await tx`insert into events (company_id, file_id, actor_type, type) values (${co.id}, ${f.id}, 'system', 'file.created')`;

      await expectError(tx, "events: UPDATE refused", () => tx`update events set type='x' where file_id=${f.id}`, /append-only/);
      await expectError(tx, "events: DELETE refused", () => tx`delete from events where file_id=${f.id}`, /append-only/);
      await expectError(tx, "events: cascade from deleting a File refused", () => tx`delete from files where id=${f.id}`, /append-only/);

      const [{ n }] = await tx`select purge_client_files(${co.id}, 'VERIFY CLIENT INC', null) as n`;
      const [{ left }] = await tx`select count(*)::int as left from events where file_id=${f.id}`;
      const [{ others }] = await tx`select count(*)::int as others from files where company_id=${co.id}`;
      const [log] = await tx`select client_name_sha256, file_count from deletion_log where company_id=${co.id}`;
      check("purge_client_files deletes the client's Files + events (case-insensitive)", n === 1 && left === 0, `deleted=${n}, events left=${left}`);
      check("purge leaves other clients' Files alone", others === 1);
      check("deletion_log row is PII-free (hash only)", log?.file_count === 1 && /^[0-9a-f]{64}$/.test(log.client_name_sha256));

      const [{ flag }] = await tx`select coalesce(current_setting('signfile.allow_purge', true), '') as flag`;
      check("purge flag is off again after purge", flag !== "on", `flag='${flag}'`);
      await tx`insert into events (company_id, actor_type, type) values (${co.id}, 'system', 'probe')`;
      await expectError(tx, "events: DELETE still refused after purge", () => tx`delete from events where company_id=${co.id}`, /append-only/);
      const [co2] = await tx`insert into companies (name, slug) values ('Verify Co 2', ${"verify2-" + Date.now()}) returning id`;
      await tx`insert into users (company_id, email, name, password_hash) values (${co2.id}, ${"verify-" + Date.now() + "@signfile-e2e.example"}, 'Verify User', 'x')`;
      await tx`insert into events (company_id, actor_type, type) values (${co2.id}, 'system', 'probe')`;
      const [{ counts }] = await tx`select purge_company(${co2.id}) as counts`;
      const [plog] = await tx`select scope, counts from deletion_log where company_id=${co2.id}`;
      const [{ gone }] = await tx`select count(*)::int as gone from companies where id=${co2.id}`;
      check("purge_company deletes the company and logs counts that outlive it", gone === 0 && plog?.scope === "company" && plog.counts.users === 1 && plog.counts.events === 1 && counts.users === 1);
      check("deletion_log counts hold numbers only", Object.values(plog?.counts ?? { x: "?" }).every((v) => typeof v === "number"));
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  const [{ leftovers }] = await sql`select count(*)::int as leftovers from companies where slug like 'verify-%'`;
  check("test data rolled back", leftovers === 0);

  for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
  await sql.end();
  if (results.some(([, ok]) => !ok)) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

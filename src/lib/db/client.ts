import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * App database client. DATABASE_URL is Supabase's session pooler (port 5432).
 * prepare:false is kept (works in either pooler mode).
 *
 * Created lazily (so `next build` works without DATABASE_URL) and cached on
 * globalThis (so dev hot reload doesn't leak connections).
 */
type DB = PostgresJsDatabase<typeof schema>;
const g = globalThis as unknown as { __sfDb?: { sql: ReturnType<typeof postgres>; db: DB } };

function instance() {
  if (!g.__sfDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // Session pooler: every client connection holds one of the pool's server connections
    // (Supabase default pool size: 15 per role+db). Budget in DECISIONS.md: 3 here + 1 health
    // check per process, so a deploy overlap plus local tools stays under 15.
    const max = Math.min(Math.max(Number(process.env.DB_POOL_MAX) || 3, 1), 10);
    const sql = postgres(url, { prepare: false, max, idle_timeout: 20, max_lifetime: 60 * 30, connect_timeout: 10 });
    g.__sfDb = { sql, db: drizzle(sql, { schema }) };
  }
  return g.__sfDb;
}

export const db: DB = new Proxy({} as DB, {
  get: (_, prop) => Reflect.get(instance().db, prop),
});

export type { DB };
export { schema };

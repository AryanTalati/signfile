import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * App database client. DATABASE_URL is Supabase's transaction pooler, which
 * doesn't support prepared statements, so prepare:false is mandatory.
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
    const sql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 });
    g.__sfDb = { sql, db: drizzle(sql, { schema }) };
  }
  return g.__sfDb;
}

export const db: DB = new Proxy({} as DB, {
  get: (_, prop) => Reflect.get(instance().db, prop),
});

export type { DB };
export { schema };

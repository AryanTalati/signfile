import "server-only";
import postgres from "postgres";

// Tiny dedicated client for the health check. The app's Drizzle client
// (added with the schema) is separate so a stuck app pool never hides
// whether the database itself is reachable.
let sql: ReturnType<typeof postgres> | null = null;

function client() {
  if (!process.env.DATABASE_URL) return null;
  sql ??= postgres(process.env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
    prepare: false, // required for Supabase's transaction pooler
  });
  return sql;
}

export async function pingDatabase(): Promise<{ ok: boolean; ms?: number; error?: string; configured: boolean }> {
  const db = client();
  if (!db) return { ok: false, configured: false, error: "DATABASE_URL not set" };
  const started = Date.now();
  try {
    await Promise.race([
      db`select 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 5s")), 5000)),
    ]);
    return { ok: true, configured: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, configured: true, error: err instanceof Error ? err.message : String(err) };
  }
}

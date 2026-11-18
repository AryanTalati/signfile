export const dynamic = "force-dynamic";

/**
 * Render's health check. Deliberately does not touch the database: a brief
 * Supabase blip shouldn't make Render restart the app. Uptime monitoring of
 * the DB goes through /api/health.
 */
export function GET() {
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

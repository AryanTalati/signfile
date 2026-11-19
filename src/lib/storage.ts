import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Binary storage (agreement PDFs, sources, sealed PDFs, logos) in a private
 * Supabase Storage bucket. Only the server touches it, with the secret key;
 * browsers get short-lived signed URLs or bytes streamed through our routes.
 * Keys are always prefixed with the company id: `${companyId}/...`.
 */
let client: SupabaseClient | null = null;

function supabase() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

export const bucket = () => process.env.STORAGE_BUCKET || "signfile";

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string) {
  const { error } = await supabase().storage.from(bucket()).upload(key, body, { contentType, upsert: false });
  if (error) throw new Error(`storage upload failed for ${key}: ${error.message}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const { data, error } = await supabase().storage.from(bucket()).download(key);
  if (error || !data) throw new Error(`storage download failed for ${key}: ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Server-side copy within the bucket (used to snapshot a template's PDF into a File). */
export async function copyObject(from: string, to: string) {
  const { error } = await supabase().storage.from(bucket()).copy(from, to);
  if (error) throw new Error(`storage copy failed ${from} -> ${to}: ${error.message}`);
}

export async function deleteObjects(keys: string[]) {
  for (let i = 0; i < keys.length; i += 100) {
    const { error } = await supabase().storage.from(bucket()).remove(keys.slice(i, i + 100));
    if (error) throw new Error(`storage delete failed: ${error.message}`);
  }
}

/** Creates the private bucket if it doesn't exist. Used by `npm run db:setup`. */
export async function ensureBucket() {
  const s = supabase().storage;
  const { data } = await s.getBucket(bucket());
  if (data) {
    if (data.public) throw new Error(`bucket ${bucket()} exists but is PUBLIC; make it private in Supabase`);
    return "exists" as const;
  }
  const { error } = await s.createBucket(bucket(), { public: false, fileSizeLimit: "50MB" });
  if (error) throw new Error(`could not create bucket ${bucket()}: ${error.message}`);
  return "created" as const;
}

/** Round-trips a tiny object to prove storage works. */
export async function storageSelfTest() {
  const key = `_health/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const started = Date.now();
  await putObject(key, Buffer.from("ok"), "text/plain");
  const back = (await getObject(key)).toString();
  await deleteObjects([key]);
  return { ok: back === "ok", ms: Date.now() - started };
}

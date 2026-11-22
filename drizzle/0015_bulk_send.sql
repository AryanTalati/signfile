-- Bulk send: one batch per confirmed CSV run, one row per CSV line.
CREATE TABLE IF NOT EXISTS "bulk_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "template_id" uuid REFERENCES "templates"("id") ON DELETE SET NULL,
  "template_name" text NOT NULL,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "filename" text NOT NULL,
  "headers" jsonb NOT NULL,
  "send_now" boolean NOT NULL DEFAULT true,
  "status" text NOT NULL DEFAULT 'running',
  "counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- IP / user agent of the person who confirmed the run (recorded on each File's audit events).
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_batches_company_idx" ON "bulk_batches" ("company_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bulk_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "batch_id" uuid NOT NULL REFERENCES "bulk_batches"("id") ON DELETE CASCADE,
  "row_no" integer NOT NULL,
  -- Idempotency key: template + signer email + optional external_id. Same key in a recent batch = already sent.
  "row_key" text NOT NULL,
  "client_legal_name" text NOT NULL DEFAULT '',
  "cells" jsonb NOT NULL,
  "values" jsonb NOT NULL,
  "status" text NOT NULL,
  "reason" text,
  "file_id" uuid REFERENCES "files"("id") ON DELETE SET NULL,
  "processed_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bulk_rows_batch_row_uq" ON "bulk_rows" ("batch_id", "row_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_rows_key_idx" ON "bulk_rows" ("company_id", "row_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_rows_pending_idx" ON "bulk_rows" ("batch_id", "row_no") WHERE "status" = 'pending';
--> statement-breakpoint
ALTER TABLE "bulk_batches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bulk_rows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "bulk_batches", "bulk_rows" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "bulk_batches", "bulk_rows" FROM authenticated; END IF;
END $$;
--> statement-breakpoint
-- Per-client deletion also removes that client's bulk rows (they hold the CSV line).
CREATE OR REPLACE FUNCTION purge_client_files(p_company_id uuid, p_client_legal_name text, p_user_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('signfile.allow_purge', 'on', true);
  DELETE FROM bulk_rows WHERE company_id = p_company_id AND lower(client_legal_name) = lower(p_client_legal_name);
  WITH d AS (
    DELETE FROM files
    WHERE company_id = p_company_id AND lower(client_legal_name) = lower(p_client_legal_name)
    RETURNING 1
  ) SELECT count(*) INTO n FROM d;
  PERFORM set_config('signfile.allow_purge', 'off', true);
  INSERT INTO deletion_log (company_id, deleted_by_user_id, client_name_sha256, file_count)
  VALUES (p_company_id, p_user_id, encode(sha256(convert_to(lower(p_client_legal_name), 'UTF8')), 'hex'), n);
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_client_files(uuid, text, uuid) FROM PUBLIC;

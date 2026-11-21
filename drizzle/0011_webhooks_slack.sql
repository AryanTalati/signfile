-- Outgoing webhooks and Slack: one URL each per firm, both off until a URL is saved.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "webhook_url" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "webhook_secret" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "webhook_events" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "slack_webhook_url" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "slack_events" jsonb NOT NULL DEFAULT '["file.signed","file.completed","file.declined","file.changes_requested","file.expired"]'::jsonb;
--> statement-breakpoint
-- One row per POST (webhook or Slack). The body is stored so a retry sends exactly the same
-- bytes. Deleted with its File (per-client deletion) and with its company.
CREATE TABLE IF NOT EXISTS "deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "file_id" uuid REFERENCES "files"("id") ON DELETE CASCADE,
  "target" text NOT NULL,
  "event" text NOT NULL,
  "body" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz,
  "response_status" integer,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deliveries_company_idx" ON "deliveries" ("company_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deliveries_due_idx" ON "deliveries" ("next_attempt_at") WHERE "status" = 'pending';
--> statement-breakpoint
ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "deliveries" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "deliveries" FROM authenticated; END IF;
END $$;

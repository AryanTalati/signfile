-- Reminders and expiry run on the health-ping sweep. Per-firm schedule; each reminder is an
-- outbox row tagged with its schedule slot, and the unique index makes a slot send at most once
-- per signer even if two sweeps overlap.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "reminders_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "reminder_days" jsonb NOT NULL DEFAULT '[2,5]'::jsonb;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "final_reminder_days" integer NOT NULL DEFAULT 2;
--> statement-breakpoint
-- When it became this signer's turn (reminders count from here).
ALTER TABLE "recipients" ADD COLUMN IF NOT EXISTS "activated_at" timestamptz;
--> statement-breakpoint
UPDATE "recipients" SET "activated_at" = "created_at" WHERE "activated_at" IS NULL AND "status" IN ('active', 'viewed');
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN IF NOT EXISTS "reminder_slot" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outbox_reminder_slot_uq" ON "outbox" ("recipient_id", "reminder_slot") WHERE "reminder_slot" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_open_expiry_idx" ON "files" ("expires_at") WHERE "status" IN ('sent', 'partially_signed');

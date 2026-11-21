-- A template is a Draft until the firm finishes setting it up (Done, or creates a File from it).
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "setup_done_at" timestamptz;
--> statement-breakpoint
-- Existing templates were all set up before drafts existed.
UPDATE "templates" SET "setup_done_at" = "updated_at" WHERE "setup_done_at" IS NULL;

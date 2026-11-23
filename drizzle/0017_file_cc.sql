-- "Send the signed copy to": up to 5 people per File who don't sign but get the signed-copy email.
-- Stored on the File row, so deleting the File (per-client purge) removes them.
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "cc_emails" text[] NOT NULL DEFAULT '{}';

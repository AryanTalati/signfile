-- A revised agreement uploaded for one File (after "Request changes" or "Decline") is a hidden,
-- File-specific template: the firm's standard template is never changed by one client's negotiation.
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "revision_for_file_id" uuid REFERENCES "files"("id") ON DELETE SET NULL;

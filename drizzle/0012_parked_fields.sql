-- Firm fields set aside while "Firm signs too" is off: kept exactly (incl. manual edits) so
-- turning it back on restores them. Never copied into a File.
ALTER TABLE "template_versions" ADD COLUMN IF NOT EXISTS "parked_fields" jsonb NOT NULL DEFAULT '[]'::jsonb;

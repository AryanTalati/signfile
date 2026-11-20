-- "Countersign automatically after all other signers": a standing instruction the signer gives
-- for their own saved signature. Null = off (the default). The IP/UA are where they turned it on.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auto_countersign_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auto_countersign_ip" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auto_countersign_ua" text;

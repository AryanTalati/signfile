-- MIND sync: push each completed File into the firm's MIND knowledge graph. Off until a firm
-- saves its MIND API key and turns it on. The key is used only to call MIND; never shown back or logged.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "mind_api_key" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "mind_enabled" boolean NOT NULL DEFAULT false;

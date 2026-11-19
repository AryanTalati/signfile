ALTER TABLE "users" ADD COLUMN "saved_signature" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "saved_initials" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "saved_signature_at" timestamp with time zone;
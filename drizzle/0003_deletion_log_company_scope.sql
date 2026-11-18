ALTER TABLE "deletion_log" DROP CONSTRAINT "deletion_log_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "deletion_log" ALTER COLUMN "client_name_sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deletion_log" ADD COLUMN "scope" text DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "deletion_log" ADD COLUMN "counts" jsonb DEFAULT '{}'::jsonb NOT NULL;
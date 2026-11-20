-- The firm's time zone (IANA), shown next to UTC on certificates. Null = UTC only.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "timezone" text;

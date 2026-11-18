-- Deletes a whole company (account deletion, and cleanup of E2E test
-- companies). Like purge_client_files(), it's the only way past the
-- append-only trigger on events, and the flag is transaction-local.
CREATE OR REPLACE FUNCTION purge_company(p_company_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('signfile.allow_purge', 'on', true);
  WITH d AS (DELETE FROM companies WHERE id = p_company_id RETURNING 1) SELECT count(*) INTO n FROM d;
  PERFORM set_config('signfile.allow_purge', 'off', true);
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_company(uuid) FROM PUBLIC;

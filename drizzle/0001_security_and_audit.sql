-- Security baseline, append-only audit log, and the per-client purge path.

-- 1. RLS on every table, no policies. The server connects as the table owner
--    (bypasses RLS). Supabase's API roles get nothing, even if the Data API is
--    switched on later.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','users','sessions','user_invites','templates','template_versions',
                           'files','file_documents','recipients','events','outbox','deletion_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- 2. files.current_document_id -> file_documents (added here: the two tables reference each other).
ALTER TABLE "files" ADD CONSTRAINT "files_current_document_id_fk"
  FOREIGN KEY ("current_document_id") REFERENCES "file_documents"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- 3. events is append-only. UPDATE is always refused. DELETE (including
--    cascades from files/recipients) is refused unless purge_client_files()
--    has set the transaction-local flag. TRUNCATE is refused.
CREATE OR REPLACE FUNCTION events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('signfile.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'events is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER events_no_update_delete BEFORE UPDATE OR DELETE ON "events"
  FOR EACH ROW EXECUTE FUNCTION events_append_only();
--> statement-breakpoint
CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON "events"
  FOR EACH STATEMENT EXECUTE FUNCTION events_append_only();
--> statement-breakpoint

-- 4. Per-client deletion: hard-deletes every File (and, by cascade, its
--    documents, recipients, events, outbox rows) for one client of one
--    company, and records a PII-free deletion_log row. Storage objects are
--    removed by the app, which reads their keys first.
CREATE OR REPLACE FUNCTION purge_client_files(p_company_id uuid, p_client_legal_name text, p_user_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('signfile.allow_purge', 'on', true);
  WITH d AS (
    DELETE FROM files
    WHERE company_id = p_company_id AND lower(client_legal_name) = lower(p_client_legal_name)
    RETURNING 1
  ) SELECT count(*) INTO n FROM d;
  PERFORM set_config('signfile.allow_purge', 'off', true);
  INSERT INTO deletion_log (company_id, deleted_by_user_id, client_name_sha256, file_count)
  VALUES (p_company_id, p_user_id, encode(sha256(convert_to(lower(p_client_legal_name), 'UTF8')), 'hex'), n);
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_client_files(uuid, text, uuid) FROM PUBLIC;

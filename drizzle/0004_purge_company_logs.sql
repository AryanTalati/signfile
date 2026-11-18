-- purge_company() now records what it removed in deletion_log (scope
-- 'company', row counts only, no PII). The log row survives because
-- deletion_log.company_id no longer references companies (0003).
DROP FUNCTION IF EXISTS purge_company(uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purge_company(p_company_id uuid, p_deleted_by uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id) THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
    'companies', 1,
    'users',             (SELECT count(*) FROM users             WHERE company_id = p_company_id),
    'sessions',          (SELECT count(*) FROM sessions          WHERE company_id = p_company_id),
    'user_invites',      (SELECT count(*) FROM user_invites      WHERE company_id = p_company_id),
    'templates',         (SELECT count(*) FROM templates         WHERE company_id = p_company_id),
    'template_versions', (SELECT count(*) FROM template_versions WHERE company_id = p_company_id),
    'files',             (SELECT count(*) FROM files             WHERE company_id = p_company_id),
    'file_documents',    (SELECT count(*) FROM file_documents    WHERE company_id = p_company_id),
    'recipients',        (SELECT count(*) FROM recipients        WHERE company_id = p_company_id),
    'events',            (SELECT count(*) FROM events            WHERE company_id = p_company_id),
    'outbox',            (SELECT count(*) FROM outbox            WHERE company_id = p_company_id)
  ) INTO c;

  PERFORM set_config('signfile.allow_purge', 'on', true);
  DELETE FROM companies WHERE id = p_company_id;
  PERFORM set_config('signfile.allow_purge', 'off', true);

  INSERT INTO deletion_log (company_id, scope, deleted_by_user_id, client_name_sha256, file_count, counts)
  VALUES (p_company_id, 'company', (SELECT id FROM users WHERE id = p_deleted_by), NULL, (c->>'files')::int, c);
  RETURN c;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_company(uuid, uuid) FROM PUBLIC;

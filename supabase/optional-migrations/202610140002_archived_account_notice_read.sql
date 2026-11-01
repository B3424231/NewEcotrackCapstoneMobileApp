-- Apply after the authentication and cross-system access migrations.
-- Allows an authenticated archived account to read its own notice only.
-- Active profile, hardware, command and mutation policies stay unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
 IF to_regclass('public.staff') IS NULL
  OR to_regprocedure('auth.uid()') IS NULL THEN
  RAISE EXCEPTION 'Install account authentication and staff access policies first';
 END IF;
END $$;

DROP POLICY IF EXISTS staff_archive_notice_read ON public.staff;
CREATE POLICY staff_archive_notice_read ON public.staff
 FOR SELECT TO authenticated
 USING (
  auth_user_id = auth.uid()
  AND (is_archived IS TRUE OR lower(coalesce(status,'')) = 'archived')
 );

COMMENT ON POLICY staff_archive_notice_read ON public.staff IS
 'Verified archived accounts may read their own saved archive notice. No new column grants, mutations, controller access or active profile access.';
COMMIT;

-- Apply AFTER desktop cloud hardware/controller registration migrations and
-- the mobile auth + assigned staff hardware-read migrations. Repeatable.
-- Existing hardware command RPCs and credential table grants stay unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
 IF to_regprocedure('public.ecotrack_staff_id()') IS NULL
   OR to_regclass('ecotrack_private.device_credentials') IS NULL THEN
  RAISE EXCEPTION 'Install authentication and cloud controller registration first';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ecotrack_require_controller_registration(p_device_id text,p_setup jsonb DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE staff_id text; assigned_room text; target text; controller public.nodes%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 IF coalesce(p_device_id,'') !~ '^esp32s3-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Invalid controller identity'; END IF;
 IF public.ecotrack_is_admin() IS TRUE THEN RETURN NULL; END IF;
 staff_id := public.ecotrack_staff_id();
 SELECT s.room_id INTO assigned_room FROM public.staff s WHERE s.id=staff_id;
 IF staff_id IS NULL OR assigned_room IS NULL OR NOT EXISTS(SELECT 1 FROM public.rooms WHERE id=assigned_room) THEN
  RAISE EXCEPTION 'An active account with a specific assigned room is required' USING ERRCODE='42501';
 END IF;
 IF p_setup IS NOT NULL AND p_setup->>'room_id' IS DISTINCT FROM assigned_room THEN
  RAISE EXCEPTION 'Register controllers only in your assigned room' USING ERRCODE='42501';
 END IF;
 SELECT c.node_id INTO target FROM ecotrack_private.device_credentials c WHERE c.device_id=p_device_id;
 IF target IS NULL THEN SELECT s.node_id INTO target FROM public.ecotrack_device_state s WHERE s.device_id=p_device_id; END IF;
 IF target IS NULL THEN SELECT n.id INTO target FROM public.nodes n WHERE n.name=p_device_id; END IF;
 IF target IS NOT NULL THEN
  SELECT * INTO controller FROM public.nodes WHERE id=target;
  IF controller.id IS NULL OR controller.room_id IS DISTINCT FROM assigned_room THEN
   RAISE EXCEPTION 'This controller is outside your assigned room' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.aircons a
      WHERE (a.controller_node_id=target OR a.node_id IN(target,p_device_id,controller.name))
        AND a.room_id IS DISTINCT FROM assigned_room) THEN
   RAISE EXCEPTION 'A linked air conditioner is outside your assigned room' USING ERRCODE='42501';
  END IF;
 END IF;
 IF p_setup->>'assignment_mode'='existing' AND NOT EXISTS(
     SELECT 1 FROM public.aircons a WHERE a.id=p_setup->>'aircon_id' AND a.room_id=assigned_room) THEN
  RAISE EXCEPTION 'Select an air conditioner in your assigned room' USING ERRCODE='42501';
 END IF;
 RETURN assigned_room;
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_require_controller_registration(text,jsonb) FROM PUBLIC,anon,authenticated;

-- Update only the authorization guard in each installed version. All existing
-- validation, locking, token hashing and fresh-heartbeat checks are preserved.
-- Unknown definitions cause a rollback instead of a permissive fallback.
DO $$
DECLARE signature text; definition text; revised text; replacement text; original_guard text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.ecotrack_validate_controller_assignment(text,jsonb)',
  'public.ecotrack_prepare_controller_registration(text)',
  'public.ecotrack_finish_controller_registration(text,text,jsonb)',
  'public.ecotrack_controller_registration_status(text)'
 ] LOOP
  IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'Missing prerequisite: %',signature; END IF;
  definition:=pg_get_functiondef(to_regprocedure(signature));
  IF position('ecotrack_require_controller_registration' IN definition)=0 THEN
   replacement:=CASE WHEN signature LIKE '%validate_controller_assignment%' OR signature LIKE '%finish_controller_registration%'
     THEN 'PERFORM public.ecotrack_require_controller_registration(p_device_id,p_setup);'
     ELSE 'PERFORM public.ecotrack_require_controller_registration(p_device_id);' END;
   original_guard:='IF auth.uid() IS NULL OR NOT public.ecotrack_is_admin() THEN RAISE EXCEPTION ''Administrator required'' USING ERRCODE=''42501''; END IF;';
   revised:=replace(definition,original_guard,replacement);
   IF revised=definition THEN
    original_guard:='IF auth.uid() IS NULL OR NOT public.ecotrack_is_admin() THEN RAISE EXCEPTION ''Admin access required''; END IF;';
    revised:=replace(definition,original_guard,replacement);
   END IF;
   IF revised=definition THEN RAISE EXCEPTION 'Unrecognized registration guard: %',signature; END IF;
   IF signature LIKE '%prepare_controller_registration%' THEN
    original_guard:='VALUES(p_device_id,''offline'',NULL,NULL,NULL,NULL,NULL,NULL,5,''Seconds'')';
    IF position(original_guard IN revised)=0 THEN RAISE EXCEPTION 'Unrecognized registration draft insert'; END IF;
    revised:=replace(revised,original_guard,
      'VALUES(p_device_id,''offline'',public.ecotrack_require_controller_registration(p_device_id),NULL,NULL,NULL,NULL,NULL,5,''Seconds'')');
   END IF;
   EXECUTE revised;
  END IF;
 END LOOP;
END $$;
-- Historical admin_verified_* field names are retained for compatibility;
-- their saved auth.uid() now identifies the authorized staff/admin registrar.
NOTIFY pgrst,'reload schema';
COMMIT;

-- Live connection diagnostics for active staff in their specific assigned room.
-- All configuration, IR, registration, credential and general command rules stay intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
DO $$ BEGIN
 IF to_regclass('public.ecotrack_device_commands') IS NULL
   OR to_regclass('public.ecotrack_device_state') IS NULL
   OR to_regclass('public.nodes') IS NULL
   OR to_regclass('public.staff') IS NULL
   OR to_regclass('public.rooms') IS NULL
   OR to_regprocedure('public.ecotrack_staff_id()') IS NULL
   OR to_regprocedure('public.ecotrack_is_admin()') IS NULL
   OR to_regprocedure('public.ecotrack_can_access_room(text)') IS NULL
   OR to_regprocedure('public.ecotrack_cloud_request(text,text,jsonb,uuid)') IS NULL THEN
  RAISE EXCEPTION 'Install EcoTrack authentication and cloud hardware migrations first';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ecotrack_ping_controller(p_node_id text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE controller public.nodes%ROWTYPE; heartbeat public.ecotrack_device_state%ROWTYPE;
 command public.ecotrack_device_commands%ROWTYPE; checked_at timestamptz;
BEGIN
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Sign in to test a controller connection' USING ERRCODE='42501';
 END IF;
 IF p_request_id IS NULL OR nullif(btrim(p_node_id),'') IS NULL THEN
  RAISE EXCEPTION 'A controller identity and request ID are required' USING ERRCODE='22023';
 END IF;
 -- Serialize against concurrent controller reassignment and other queued requests.
 SELECT * INTO controller FROM public.nodes WHERE id=p_node_id FOR UPDATE;
 IF controller.id IS NULL OR (public.ecotrack_is_admin() IS NOT TRUE AND NOT EXISTS(
   SELECT 1 FROM public.staff worker
   JOIN public.rooms room ON room.id=worker.room_id
   WHERE worker.id=public.ecotrack_staff_id()
     AND worker.room_id=controller.room_id
     AND worker.room_id NOT IN ('ALL','all_rooms')
     AND public.ecotrack_can_access_room(controller.room_id)
 )) THEN
  RAISE EXCEPTION 'Test connections only for controllers in your active assigned room' USING ERRCODE='42501';
 END IF;

 SELECT * INTO command FROM public.ecotrack_device_commands WHERE id=p_request_id;
 IF command.id IS NULL THEN
  checked_at:=clock_timestamp();
  SELECT * INTO heartbeat FROM public.ecotrack_device_state WHERE node_id=controller.id;
  IF heartbeat.node_id IS NULL THEN
   RAISE EXCEPTION 'Complete Bluetooth and cloud registration for this controller first';
  END IF;
  IF heartbeat.sleeping_until>checked_at THEN
   RAISE EXCEPTION 'This controller is sleeping. Wake it before testing its connection';
  END IF;
  IF heartbeat.last_seen IS NULL OR heartbeat.last_seen<checked_at-interval '45 seconds'
    OR heartbeat.last_seen>checked_at+interval '5 seconds' THEN
   RAISE EXCEPTION 'This controller is offline. Wait for a fresh heartbeat';
  END IF;
  INSERT INTO public.ecotrack_device_commands(id,node_id,kind,payload,created_by,expires_at)
   VALUES(p_request_id,controller.id,'ping','{}'::jsonb,auth.uid(),checked_at+interval '20 seconds')
   ON CONFLICT(id) DO NOTHING RETURNING * INTO command;
  -- Another caller may have used this UUID on a different controller concurrently.
  IF command.id IS NULL THEN
   SELECT * INTO command FROM public.ecotrack_device_commands WHERE id=p_request_id;
  END IF;
 END IF;
 IF command.id IS NULL OR command.node_id IS DISTINCT FROM controller.id
   OR command.kind IS DISTINCT FROM 'ping' OR command.payload IS DISTINCT FROM '{}'::jsonb
   OR command.created_by IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Connection request ID conflict' USING ERRCODE='42501';
 END IF;
 -- A queued row is a receipt, never an acknowledgement from the controller.
 RETURN to_jsonb(command);
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_ping_controller(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_ping_controller(text,uuid) TO authenticated;

-- Existing installed clients use ecotrack_cloud_request for diagnostics. Move its
-- original function unchanged, retaining its owner, body and configured search_path,
-- and expose only this narrow ping dispatch in front of the original admin guard.
CREATE SCHEMA IF NOT EXISTS ecotrack_private;
REVOKE ALL ON SCHEMA ecotrack_private FROM PUBLIC,anon,authenticated;
DO $$
DECLARE source text;
BEGIN
 IF to_regprocedure('ecotrack_private.ecotrack_admin_cloud_request(text,text,jsonb,uuid)') IS NULL THEN
  SELECT prosrc INTO source FROM pg_proc WHERE oid='public.ecotrack_cloud_request(text,text,jsonb,uuid)'::regprocedure;
  IF position('ecotrack_private.ecotrack_admin_cloud_request' IN source)>0 THEN
   RAISE EXCEPTION 'The original administrator command function is missing';
  END IF;
  ALTER FUNCTION public.ecotrack_cloud_request(text,text,jsonb,uuid) RENAME TO ecotrack_admin_cloud_request;
  ALTER FUNCTION public.ecotrack_admin_cloud_request(text,text,jsonb,uuid) SET SCHEMA ecotrack_private;
 ELSE
  SELECT prosrc INTO source FROM pg_proc WHERE oid='public.ecotrack_cloud_request(text,text,jsonb,uuid)'::regprocedure;
  IF position('ecotrack_private.ecotrack_admin_cloud_request' IN source)=0
    OR position('public.ecotrack_ping_controller' IN source)=0 THEN
   RAISE EXCEPTION 'The cloud command function changed after the ping update; review the installed version before applying';
  END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION ecotrack_private.ecotrack_admin_cloud_request(text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.ecotrack_cloud_request(p_node_id text,p_kind text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_kind='ping' THEN
  IF p_payload IS DISTINCT FROM '{}'::jsonb THEN
   RAISE EXCEPTION 'A connection test accepts only an empty ping payload' USING ERRCODE='22023';
  END IF;
  RETURN public.ecotrack_ping_controller(p_node_id,p_request_id);
 END IF;
 RETURN ecotrack_private.ecotrack_admin_cloud_request(p_node_id,p_kind,p_payload,p_request_id);
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_cloud_request(text,text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_cloud_request(text,text,jsonb,uuid) TO authenticated;

-- Poll only the caller's own ping receipt, while their active room still matches.
-- Existing administrator read policy and all table write grants are unchanged.
ALTER TABLE public.ecotrack_device_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ecotrack_device_commands_assigned_staff_ping_read ON public.ecotrack_device_commands;
CREATE POLICY ecotrack_device_commands_assigned_staff_ping_read
 ON public.ecotrack_device_commands FOR SELECT TO authenticated
 USING (
  kind='ping' AND created_by=auth.uid()
  AND EXISTS (
   SELECT 1 FROM public.nodes controller
   JOIN public.staff worker ON worker.id=public.ecotrack_staff_id()
   JOIN public.rooms room ON room.id=worker.room_id
   WHERE controller.id=ecotrack_device_commands.node_id
     AND controller.room_id=worker.room_id
     AND worker.room_id NOT IN ('ALL','all_rooms')
     AND public.ecotrack_can_access_room(controller.room_id)
  )
 );
NOTIFY pgrst,'reload schema';
COMMIT;

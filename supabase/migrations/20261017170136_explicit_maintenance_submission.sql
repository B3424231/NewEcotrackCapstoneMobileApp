-- Item edits persist progress quietly. Only explicit report saves submit/notify.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
DO $patch$
DECLARE definition text; old_text text; new_text text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n') INTO definition FROM pg_proc
 WHERE oid=to_regprocedure('public.ecotrack_mutate_maintenance(text,timestamptz,text,text,jsonb,boolean,text,text)');
 IF definition IS NULL THEN RAISE EXCEPTION 'Install maintenance transactions first'; END IF;
 old_text:=$old$    v_status := 'For Verification';$old$;
 new_text:=$new$    v_status := case when p_submit_repair or p_status = 'For Verification' or v_report.status = 'For Verification'
      then 'For Verification' else 'In Progress' end;$new$;
 IF position(old_text IN definition)>0 THEN definition:=replace(definition,old_text,new_text);
 ELSIF position(new_text IN definition)=0 THEN RAISE EXCEPTION 'Review maintenance summary derivation before applying'; END IF;
 old_text:=$old$      v_parent_status := 'For Verification';$old$;
 new_text:=$new$      v_parent_status := case when v_parent.status = 'For Verification' then 'For Verification' else 'In Progress' end;$new$;
 IF position(old_text IN definition)>0 THEN definition:=replace(definition,old_text,new_text);
 ELSIF position(new_text IN definition)=0 THEN RAISE EXCEPTION 'Review repair parent derivation before applying'; END IF;
 old_text:=$old$  -- Serializes identical retries even if the first request has not committed.$old$;
 new_text:=$new$  if current_setting('ecotrack.maintenance_save_mode',true) = 'item' then
    v_request := v_request || jsonb_build_object('save_mode','item');
  end if;
  -- Serializes identical retries even if the first request has not committed.$new$;
 IF position('jsonb_build_object(''save_mode'',''item'')' IN definition)=0 THEN
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Review maintenance retry contract before applying'; END IF;
  definition:=replace(definition,old_text,new_text);
 END IF;
 old_text:=$old$  v_is_repair := v_report.id like 'REP-%'$old$;
 new_text:=$new$  if current_setting('ecotrack.maintenance_save_mode',true) = 'item' and v_report.status = 'For Verification' then
    raise exception 'This checklist was submitted. Wait for administrator review.' using errcode = '22023';
  end if;
  v_is_repair := v_report.id like 'REP-%'$new$;
 IF position('This checklist was submitted. Wait for administrator review.' IN definition)=0 THEN
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Review maintenance submission guard before applying'; END IF;
  definition:=replace(definition,old_text,new_text);
 END IF;
 EXECUTE definition;

 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n') INTO definition FROM pg_proc
 WHERE oid=to_regprocedure('public.fn_sync_maintenance_to_mobile_notifications()');
 IF definition IS NULL THEN RAISE EXCEPTION 'Install maintenance notification delivery first'; END IF;
 old_text:=$old$    v_old := to_jsonb(old);$old$;
 new_text:=$new$    v_old := to_jsonb(old);
    if current_setting('ecotrack.maintenance_save_mode',true) = 'item'
      and v_row->>'staff_id' is not distinct from v_old->>'staff_id' then return new; end if;$new$;
 IF position('current_setting(''ecotrack.maintenance_save_mode'',true) = ''item''' IN definition)=0 THEN
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Review maintenance notification trigger before applying'; END IF;
  definition:=replace(definition,old_text,new_text);
 END IF;
 -- Match only the original unchanged-status guard, not the new quiet-item guard.
 old_text:=$old$    if v_row->>'status' is not distinct from v_old->>'status'
      and v_row->>'staff_id' is not distinct from v_old->>'staff_id' then return new; end if;$old$;
 new_text:=$new$    if v_row->>'status' is not distinct from v_old->>'status'
      and v_row->>'staff_id' is not distinct from v_old->>'staff_id'
      and not (coalesce(current_setting('ecotrack.maintenance_save_mode',true),'') = 'submit'
        and coalesce(current_setting('ecotrack.maintenance_save_report',true),'') = new.id::text) then return new; end if;$new$;
 IF position(old_text IN definition)>0 THEN definition:=replace(definition,old_text,new_text);
 ELSIF position('ecotrack.maintenance_save_report' IN definition)=0 THEN RAISE EXCEPTION 'Review final-save notification guard before applying'; END IF;
 EXECUTE definition;
END $patch$;

CREATE OR REPLACE FUNCTION public.ecotrack_save_maintenance_item(
 p_report_id text,p_expected_updated timestamptz,p_operation_id text,p_tasks jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; previous_mode text:=coalesce(current_setting('ecotrack.maintenance_save_mode',true),'');
BEGIN
 PERFORM set_config('ecotrack.maintenance_save_mode','item',true);
 result:=public.ecotrack_mutate_maintenance(p_report_id,p_expected_updated,p_operation_id,null,p_tasks,false);
 PERFORM set_config('ecotrack.maintenance_save_mode',previous_mode,true);
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('ecotrack.maintenance_save_mode',previous_mode,true);
 RAISE;
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_save_maintenance_item(text,timestamptz,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_save_maintenance_item(text,timestamptz,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.ecotrack_update_maintenance_report(
 p_report_id text,p_expected_updated timestamptz,p_operation_id text,p_status text,p_tasks jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; previous_mode text:=coalesce(current_setting('ecotrack.maintenance_save_mode',true),'');
 previous_report text:=coalesce(current_setting('ecotrack.maintenance_save_report',true),'');
BEGIN
 PERFORM set_config('ecotrack.maintenance_save_mode','submit',true);
 PERFORM set_config('ecotrack.maintenance_save_report',p_report_id,true);
 result:=public.ecotrack_mutate_maintenance(p_report_id,p_expected_updated,p_operation_id,p_status,p_tasks,false);
 PERFORM set_config('ecotrack.maintenance_save_mode',previous_mode,true);
 PERFORM set_config('ecotrack.maintenance_save_report',previous_report,true);
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('ecotrack.maintenance_save_mode',previous_mode,true);
 PERFORM set_config('ecotrack.maintenance_save_report',previous_report,true);
 RAISE;
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_update_maintenance_report(text,timestamptz,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_update_maintenance_report(text,timestamptz,text,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

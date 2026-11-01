-- Repairs desktop public-client access without exposing table credentials.
begin;
do $$ declare t text; cols text; allowed text; p record; begin
  foreach t in array array['staff','administrators'] loop
    execute format('alter table public.%I enable row level security',t);
    select string_agg(quote_ident(column_name),',') into cols from information_schema.columns where table_schema='public' and table_name=t;
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('revoke select (%s),insert (%s),update (%s),references (%s) on public.%I from public,anon,authenticated',cols,cols,cols,cols,t);
    select string_agg(quote_ident(column_name),',') into cols from information_schema.columns where table_schema='public' and table_name=t and column_name<>'password';
    execute format('grant select (%s) on public.%I to authenticated',cols,t);
    select string_agg(quote_ident(column_name),',') into allowed from information_schema.columns where table_schema='public' and table_name=t and column_name=any(
      case when t='staff' then array['name','email','phone','role','status','room_id','room_name','floor_name','building_name','assignment','assignment_scope','assigned_floor_id','assigned_building_id','is_archived','force_logout','archive_reason','archive_notes','archived_at','is_active','is_online','online_status','last_active','updated']
      else array['username','location','session_timeout','avatar','avatar_url','photo_url','updated'] end);
    if allowed is not null then execute format('grant update (%s) on public.%I to authenticated',allowed,t); end if;
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop execute format('drop policy %I on public.%I',p.policyname,t); end loop;
  end loop;
end $$;
create policy staff_read on public.staff for select to authenticated using(public.ecotrack_is_admin() or id=public.ecotrack_staff_id());
create policy staff_admin_update on public.staff for update to authenticated using(public.ecotrack_is_admin()) with check(public.ecotrack_is_admin());
create policy administrator_read on public.administrators for select to authenticated using(public.ecotrack_is_admin());
create policy administrator_self_update on public.administrators for update to authenticated using(public.ecotrack_is_admin() and auth_user_id=auth.uid()) with check(public.ecotrack_is_admin() and auth_user_id=auth.uid());

create or replace function public.ecotrack_admin_list_staff() returns jsonb
language plpgsql security definer set search_path='' as $$ begin
  if not public.ecotrack_is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(s)-'password' order by s.name),'[]'::jsonb) from public.staff s);
end $$;
revoke all on function public.ecotrack_admin_list_staff() from public,anon;
grant execute on function public.ecotrack_admin_list_staff() to authenticated;

-- Keep the existing recursive desktop deletion feature behind server authorization.
create or replace function public.delete_maintenance_reports(report_ids text[]) returns table(id text)
language plpgsql security definer set search_path='' as $$ declare deletion_ids text[]; begin
  if not public.ecotrack_is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if report_ids is null or cardinality(report_ids) not between 1 and 100 then raise exception 'Invalid report selection'; end if;
  with recursive descendants as (
    select r.id as report_id from public.maintenance_reports r where r.id=any(report_ids)
    union select child.id from public.maintenance_reports child join descendants parent on child.parent_report_id=parent.report_id
  ) select array_agg(report_id) into deletion_ids from descendants;
  if deletion_ids is null then return; end if;
  delete from public.mobile_notifications n where n.related_report_id=any(deletion_ids);
  update public.maintenance_reports r set linked_repair_id=null where r.linked_repair_id=any(deletion_ids);
  return query delete from public.maintenance_reports r where r.id=any(deletion_ids) returning r.id;
end $$;
revoke all on function public.delete_maintenance_reports(text[]) from public,anon;
grant execute on function public.delete_maintenance_reports(text[]) to authenticated;

-- Desired commands are separate from measured power/temperature telemetry.
alter table public.aircons add column if not exists desired_state jsonb;
create or replace function public.ecotrack_set_aircon_intent(p_aircon_id text,p_state jsonb,p_protocol text default null) returns jsonb
language plpgsql security definer set search_path='' as $$ declare ac public.aircons%rowtype; begin
  select * into ac from public.aircons where id=p_aircon_id for update;
  if not found or auth.uid() is null or not public.ecotrack_can_manage_device(ac.room_id) then raise exception 'Controller access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_state) is distinct from 'object' or p_state-array['power','temp','mode','fan','swing','turbo','eco']<>'{}'::jsonb
    or coalesce(p_state->>'power','') not in ('on','off','true','false') or jsonb_typeof(p_state->'temp') is distinct from 'number'
    or (p_state->>'temp')::numeric not between 16 and 32 or coalesce(p_state->>'mode','') not in ('cool','dry','fan','auto','heat')
    or coalesce(p_state->>'fan','') not in ('low','medium','high','auto','quiet','silent','turbo') then raise exception 'Invalid controller state'; end if;
  if p_protocol is not null and p_protocol !~ '^[A-Za-z0-9_ -]{1,64}$' then raise exception 'Invalid controller protocol'; end if;
  update public.aircons set desired_state=p_state,protocol=coalesce(p_protocol,protocol),protocol_name=coalesce(p_protocol,protocol_name),updated_at=clock_timestamp() where id=ac.id;
  return jsonb_build_object('id',ac.id,'desired_state',p_state);
end $$;
revoke all on function public.ecotrack_set_aircon_intent(text,jsonb,text) from public,anon;
grant execute on function public.ecotrack_set_aircon_intent(text,jsonb,text) to authenticated;
commit;

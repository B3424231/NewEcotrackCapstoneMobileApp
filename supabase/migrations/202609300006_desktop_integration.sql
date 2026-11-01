-- Desktop/mobile control data share Supabase. No telemetry table is created,
-- read, granted, migrated, or modified by this integration.
begin;
alter table public.administrators add column if not exists location text default '', add column if not exists session_timeout integer default 30;
alter table public.administrators alter column password drop not null;
alter table public.administrators alter column password drop default;
alter table public.maintenance_reports add column if not exists created_date text, add column if not exists photo_url text, add column if not exists photos jsonb default '[]';
alter table public.staff add column if not exists assignment_scope text not null default 'room' check(assignment_scope in ('room','floor','building','all')),
 add column if not exists assigned_floor_id text references public.floors(id) on delete set null,
 add column if not exists assigned_building_id text references public.buildings(id) on delete set null;
create or replace function public.ecotrack_can_access_room(p_room_id text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.ecotrack_is_admin() or exists(select 1 from public.staff s join public.rooms r on r.id=p_room_id left join public.floors f on f.id=r.floor_id
 where s.id=public.ecotrack_staff_id() and (s.room_id=r.id or s.assignment_scope='all'
 or (s.assignment_scope='floor' and s.assigned_floor_id=r.floor_id)
 or (s.assignment_scope='building' and s.assigned_building_id=f.building_id)));
$$;
create or replace function public.ecotrack_can_manage_device(p_room_id text) returns boolean
language sql stable security definer set search_path='' as $$ select public.ecotrack_can_access_room(p_room_id); $$;

-- Administration stays authenticated. Credential/Auth subject columns cannot be
-- edited through general-purpose desktop forms, even by authenticated staff.
do $$ declare t text; p record; cols text; begin
 foreach t in array array['buildings','floors','rooms','staff','rules','rule_nodes','notifications','system_config','analytics_snapshots','system_logs'] loop
  if to_regclass('public.'||t) is null then continue; end if;
  execute format('alter table public.%I enable row level security',t);
  if t in ('rules','rule_nodes','system_config','analytics_snapshots','system_logs') then
   execute format('revoke all on public.%I from public,anon,authenticated',t);
   for p in select policyname from pg_policies where schemaname='public' and tablename=t loop execute format('drop policy %I on public.%I',p.policyname,t); end loop;
  end if;
  if t='staff' then
    select string_agg(quote_ident(column_name),',') into cols from information_schema.columns where table_schema='public' and table_name=t
      and column_name=any(array['name','email','phone','role','status','room_id','room_name','floor_name','building_name','assignment','assignment_scope','assigned_floor_id','assigned_building_id','is_archived','force_logout','archive_reason','archive_notes','archived_at','is_active','is_online','online_status','updated']);
    execute format('grant update (%s) on public.staff to authenticated',cols);
    execute 'create policy desktop_staff_update on public.staff for update to authenticated using(public.ecotrack_is_admin()) with check(public.ecotrack_is_admin())';
  else
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('create policy desktop_admin_manage on public.%I for all to authenticated using(public.ecotrack_is_admin()) with check(public.ecotrack_is_admin())',t);
  end if;
 end loop;
end $$;

-- A mapped user's sign-in email is owned by Auth, not editable table metadata.
create or replace function public.ecotrack_guard_staff_identity() returns trigger
language plpgsql set search_path='' as $$ begin
 if old.auth_user_id is not null and new.email is distinct from old.email
 and new.email is distinct from (select email from auth.users where id=old.auth_user_id) then
   raise exception 'Change a mapped account email through verified Auth confirmation.' using errcode='22023';
 end if;
 return new;
end $$;
-- Run as definer solely to compare Auth email; no client can invoke the trigger.
alter function public.ecotrack_guard_staff_identity() security definer;
revoke all on function public.ecotrack_guard_staff_identity() from public,anon,authenticated;
create trigger ecotrack_staff_identity_guard before update of email on public.staff for each row execute function public.ecotrack_guard_staff_identity();

create or replace function public.ecotrack_update_admin_profile(p_name text,p_location text) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
 if not public.ecotrack_is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 120 or length(coalesce(p_location,''))>250 then raise exception 'Invalid profile'; end if;
 update public.administrators set username=btrim(p_name),location=coalesce(p_location,''),updated=clock_timestamp() where auth_user_id=auth.uid();
 return public.ecotrack_my_profile() || jsonb_build_object('location',p_location);
end $$;

create or replace function public.ecotrack_desktop_device_batch(p_operations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare op jsonb; result jsonb:='[]'; begin
 if not public.ecotrack_is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
 if jsonb_typeof(p_operations) is distinct from 'array' or jsonb_array_length(p_operations) not between 1 and 100 then raise exception 'Invalid device batch'; end if;
 for op in select value from jsonb_array_elements(p_operations) loop
   result:=result||jsonb_build_array(public.ecotrack_device_mutation(op->>'operation',op->>'id',coalesce(op->'payload','{}')));
 end loop;
 return result;
end $$;

create or replace function public.ecotrack_admin_save_report(p_record jsonb,p_expected_updated timestamptz,p_parent_expected timestamptz,p_operation_id text,p_create boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.maintenance_reports%rowtype; parent public.maintenance_reports%rowtype;
 v_id text:=p_record->>'id'; v_parent text; v_task text; v_staff public.staff%rowtype;
 v_request jsonb; v_prior public.ecotrack_maintenance_operations%rowtype; v_result jsonb; v_now timestamptz:=clock_timestamp();
 v_tasks jsonb; v_input jsonb; v_item jsonb; v_count integer; v_approved boolean;
begin
 if not public.ecotrack_is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_create is null or jsonb_typeof(p_record) is distinct from 'object' or v_id is null or length(v_id) not between 1 and 160
 or p_operation_id is null or length(p_operation_id) not between 1 and 100 then raise exception 'Invalid report operation'; end if;
 v_request:=jsonb_build_object('desktop',p_record,'expected',p_expected_updated,'parent_expected',p_parent_expected,'create',p_create);
 perform pg_advisory_xact_lock(hashtextextended('desktop-report:'||v_id,0));
 if p_create and p_record->>'aircon_id' is not null then perform pg_advisory_xact_lock(hashtextextended('dispatch-controller:'||(p_record->>'aircon_id'),0)); end if;
 select * into v_prior from public.ecotrack_maintenance_operations where actor_id=auth.uid() and operation_id=p_operation_id;
 if found then
   if v_prior.request is distinct from v_request then raise exception 'Operation key already used for different content'; end if;
   return v_prior.result;
 end if;
 v_parent:=coalesce(nullif(p_record->>'parent_report_id',''),nullif(p_record->'issue'->>'parentReportId',''));
 perform id from public.maintenance_reports where id in (v_id,v_parent) order by id for update;
 select * into r from public.maintenance_reports where id=v_id;
 if p_create and found then raise exception 'Report already exists' using errcode='23505'; end if;
 if not p_create and (not found or r.updated is distinct from p_expected_updated) then raise exception 'Report changed. Refresh and retry.' using errcode='40001'; end if;
 if not p_create and p_record->>'status' in ('Completed','Verified') and r.status not in ('Completed','Verified') then
   perform public.ecotrack_verify_maintenance(v_id,p_expected_updated,p_operation_id||'-approve',true,coalesce(p_record->>'verification_remarks',''));
 elsif not p_create and r.status='For Verification' and p_record->>'status' in ('In Progress','Needs Repair','Need Rework') then
   perform public.ecotrack_verify_maintenance(v_id,p_expected_updated,p_operation_id||'-reject',false,coalesce(nullif(p_record->>'verification_remarks',''),'Further work requested by administrator'));
 else
   select * into v_staff from public.staff where id=p_record->>'staff_id' and not is_archived;
   if not found then raise exception 'Select an active worker by immutable staff ID'; end if;
   if p_record->>'room_id' is not null and not exists(select 1 from public.rooms where id=p_record->>'room_id') then raise exception 'Selected room does not exist'; end if;
   if p_record->>'aircon_id' is not null and not exists(select 1 from public.nodes where id=p_record->>'aircon_id') then raise exception 'Selected controller does not exist'; end if;
   if p_create then
     if jsonb_typeof(p_record->'tasks') is distinct from 'array' or jsonb_array_length(p_record->'tasks')=0 then raise exception 'Assign at least one checklist item'; end if;
     if (select count(distinct t->>'id') from jsonb_array_elements(p_record->'tasks') t)<>jsonb_array_length(p_record->'tasks') then raise exception 'Checklist IDs must be unique'; end if;
     select jsonb_agg(t || jsonb_build_object('status','Not Started','repaired',false,'verified',false,'isRepaired',false,'verifiedAt',null) order by ord)
       into v_tasks from jsonb_array_elements(p_record->'tasks') with ordinality a(t,ord);
     if v_parent is not null then
       select * into parent from public.maintenance_reports where id=v_parent;
       if not found or parent.updated is distinct from p_parent_expected then raise exception 'Parent report changed. Refresh and retry.' using errcode='40001'; end if;
       v_task:=coalesce(nullif(p_record->'issue'->>'parentTaskId',''),nullif(p_record->>'parent_task_id',''));
       select count(*) into v_count from jsonb_array_elements(parent.tasks) t where t->>'id'=v_task and t->>'status'='Needs Repair' and nullif(t->>'linkedRepairId','') is null;
       if v_count<>1 then raise exception 'Select one unlinked defective parent checklist item'; end if;
       select jsonb_agg(case when t->>'id'=v_task then t||jsonb_build_object('status','Under Repair','linkedRepairId',v_id,'repaired',false,'verified',false) else t end order by ord)
         into parent.tasks from jsonb_array_elements(parent.tasks) with ordinality a(t,ord);
       update public.maintenance_reports set tasks=parent.tasks,status=case when exists(select 1 from jsonb_array_elements(parent.tasks) t where t->>'status'='Needs Repair') then 'Needs Repair' else 'Under Repair' end,
         linked_repair_id=v_id,updated=greatest(v_now,coalesce(updated,'-infinity')+interval '1 microsecond') where id=v_parent;
     elsif exists(select 1 from public.maintenance_reports where aircon_id=p_record->>'aircon_id' and status not in ('Completed','Verified')) then
       raise exception 'The controller already has an active maintenance report';
     end if;
     insert into public.maintenance_reports(id,staff_id,staff_name,aircon_id,aircon_name,aircon_type,room_id,room_name,type,priority,due_date,created_date,status,description,tasks,issue,parent_report_id,created,updated,timeline)
     values(v_id,v_staff.id,v_staff.name,p_record->>'aircon_id',p_record->>'aircon_name',p_record->>'aircon_type',p_record->>'room_id',p_record->>'room_name',coalesce(p_record->>'type','Preventive Maintenance'),coalesce(p_record->>'priority','Medium'),p_record->>'due_date',p_record->>'created_date','Pending',p_record->>'description',v_tasks,p_record->'issue',v_parent,v_now,v_now,
       jsonb_build_array(jsonb_build_object('title','Maintenance dispatched by administrator','actor_id',auth.uid(),'time',v_now,'done',true)));
   else
     -- Metadata edits preserve worker proofs, links and server workflow state.
     -- Per-item sign-off is only allowed on an already completed unlinked task.
     v_tasks:=r.tasks;
     if jsonb_typeof(p_record->'tasks')='array' then
       v_tasks:='[]';
       for v_item in select value from jsonb_array_elements(r.tasks) loop
         select value into v_input from jsonb_array_elements(p_record->'tasks') where value->>'id'=v_item->>'id';
         if v_item->>'status'='Completed' and nullif(v_item->>'linkedRepairId','') is null and v_input->>'verified'='true' then
           v_item:=v_item||jsonb_build_object('verified',true,'verifiedAt',v_now);
         end if;
         v_tasks:=v_tasks||jsonb_build_array(v_item);
       end loop;
     end if;
     update public.maintenance_reports set staff_id=v_staff.id,staff_name=v_staff.name,priority=coalesce(p_record->>'priority',priority),due_date=p_record->>'due_date',description=p_record->>'description',tasks=v_tasks,
       updated=greatest(v_now,coalesce(updated,'-infinity')+interval '1 microsecond') where id=v_id;
   end if;
 end if;
 select jsonb_build_object('report',to_jsonb(x),'parent',case when x.parent_report_id is not null then (select to_jsonb(p) from public.maintenance_reports p where p.id=x.parent_report_id) else null end)
 into v_result from public.maintenance_reports x where id=v_id;
 insert into public.ecotrack_maintenance_operations(actor_id,operation_id,request,result) values(auth.uid(),p_operation_id,v_request,v_result);
 return v_result;
end $$;

create or replace function public.ecotrack_admin_delete_reports(p_reports jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$ declare row jsonb; stored public.maintenance_reports%rowtype; begin
 if not public.ecotrack_is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
 if jsonb_typeof(p_reports) is distinct from 'array' or jsonb_array_length(p_reports)>100 then raise exception 'Invalid report selection'; end if;
 for row in select value from jsonb_array_elements(p_reports) order by value->>'id' loop
   select * into stored from public.maintenance_reports where id=row->>'id' for update;
   if not found or stored.updated is distinct from (row->>'updated')::timestamptz then raise exception 'Report changed. Refresh and retry.' using errcode='40001'; end if;
   if stored.status<>'Pending' or stored.parent_report_id is not null or stored.linked_repair_id is not null then raise exception 'Only unstarted, unlinked reports can be deleted'; end if;
   delete from public.maintenance_reports where id=stored.id;
 end loop;
 return p_reports;
end $$;
revoke all on function public.ecotrack_update_admin_profile(text,text),public.ecotrack_desktop_device_batch(jsonb),public.ecotrack_admin_save_report(jsonb,timestamptz,timestamptz,text,boolean),public.ecotrack_admin_delete_reports(jsonb) from public,anon;
grant execute on function public.ecotrack_update_admin_profile(text,text),public.ecotrack_desktop_device_batch(jsonb),public.ecotrack_admin_save_report(jsonb,timestamptz,timestamptz,text,boolean),public.ecotrack_admin_delete_reports(jsonb) to authenticated;
commit;

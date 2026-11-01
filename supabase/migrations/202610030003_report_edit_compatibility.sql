-- Preserve desktop metadata and pending checklist edits through the versioned RPC.
begin;
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
 elsif not p_create and p_record->>'update_progress'='true' then
   -- Existing desktop checklist actions use the same validated workflow as mobile.
   select jsonb_agg(t||jsonb_build_object('photoUris',coalesce(t->'photoUris','[]'::jsonb)))
     into v_tasks from jsonb_array_elements(p_record->'tasks') t;
   perform public.ecotrack_update_maintenance_report(v_id,p_expected_updated,p_operation_id||'-progress',p_record->>'status',v_tasks);
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
       if jsonb_array_length(p_record->'tasks')=0 or
          (select count(distinct nullif(t->>'id','')) from jsonb_array_elements(p_record->'tasks') t)<>jsonb_array_length(p_record->'tasks') then
         raise exception 'Checklist IDs must be unique and nonempty';
       end if;
       -- Never discard evidence, progress or repair relationships when a template changes.
       if exists(select 1 from jsonb_array_elements(r.tasks) t where
         (coalesce(t->>'status','Not Started')<>'Not Started' or nullif(t->>'linkedRepairId','') is not null
          or nullif(t->>'photoUri','') is not null or jsonb_array_length(coalesce(t->'photoUris','[]'))>0)
         and not exists(select 1 from jsonb_array_elements(p_record->'tasks') x where x->>'id'=t->>'id')) then
         raise exception 'Checklist items with progress or evidence must be retained';
       end if;
       v_tasks:='[]';
       for v_input in select value from jsonb_array_elements(p_record->'tasks') loop
         select value into v_item from jsonb_array_elements(r.tasks) where value->>'id'=v_input->>'id';
         if not found then
           v_item:=jsonb_build_object('id',v_input->'id','name',v_input->>'name','status','Not Started','notes','','verified',false,'repaired',false);
         elsif v_input ? 'name' then
           v_item:=v_item||jsonb_build_object('name',v_input->>'name');
         end if;
         if v_item->>'status'='Completed' and nullif(v_item->>'linkedRepairId','') is null and v_input->>'verified'='true' then
           v_item:=v_item||jsonb_build_object('verified',true,'verifiedAt',v_now);
         end if;
         v_tasks:=v_tasks||jsonb_build_array(v_item);
       end loop;
     end if;
     if nullif(p_record->>'aircon_id','') is distinct from r.aircon_id and p_record ? 'aircon_id' then
       perform pg_advisory_xact_lock(hashtextextended('dispatch-controller:'||(p_record->>'aircon_id'),0));
       if exists(select 1 from public.maintenance_reports where aircon_id=p_record->>'aircon_id' and id<>v_id and status not in ('Completed','Verified')) then
         raise exception 'The controller already has an active maintenance report';
       end if;
       if r.parent_report_id is not null or r.linked_repair_id is not null then raise exception 'Linked reports must retain their controller'; end if;
     end if;
     update public.maintenance_reports set staff_id=v_staff.id,staff_name=v_staff.name,priority=coalesce(p_record->>'priority',priority),due_date=p_record->>'due_date',description=p_record->>'description',tasks=v_tasks,
       aircon_id=case when p_record ? 'aircon_id' then p_record->>'aircon_id' else aircon_id end,
       aircon_name=coalesce(p_record->>'aircon_name',aircon_name),aircon_type=coalesce(p_record->>'aircon_type',aircon_type),
       room_id=case when p_record ? 'room_id' then p_record->>'room_id' else room_id end,
       room_name=coalesce(p_record->>'room_name',room_name),type=coalesce(p_record->>'type',type),
       issue=case when p_record->'issue' is not null and p_record->'issue'<>'null'::jsonb then
         coalesce(issue,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('component',p_record->'issue'->>'component','notes',p_record->'issue'->>'notes')) else issue end,
       updated=greatest(v_now,coalesce(updated,'-infinity')+interval '1 microsecond') where id=v_id;
   end if;
 end if;
 select jsonb_build_object('report',to_jsonb(x),'parent',case when x.parent_report_id is not null then (select to_jsonb(p) from public.maintenance_reports p where p.id=x.parent_report_id) else null end)
 into v_result from public.maintenance_reports x where id=v_id;
 insert into public.ecotrack_maintenance_operations(actor_id,operation_id,request,result) values(auth.uid(),p_operation_id,v_request,v_result);
 return v_result;
end $$;

commit;

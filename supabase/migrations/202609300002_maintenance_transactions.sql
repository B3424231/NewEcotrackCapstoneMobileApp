-- Prerequisites: reviewed maintenance_reports schema and the auth/RLS migration.
-- Apply on an identified disposable test project first. No client fallback writes.
begin;

create table if not exists public.ecotrack_maintenance_operations (
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null check (length(operation_id) between 1 and 128),
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, operation_id)
);
alter table public.ecotrack_maintenance_operations enable row level security;
revoke all on public.ecotrack_maintenance_operations from public, anon, authenticated;

-- All mutations, including repair submission, enter this one transaction. The
-- function is private to its owner; only the reviewed wrappers are callable.
create or replace function public.ecotrack_mutate_maintenance(
  p_report_id text,
  p_expected_updated timestamptz,
  p_operation_id text,
  p_status text,
  p_tasks jsonb,
  p_submit_repair boolean,
  p_verification text default null,
  p_verification_remarks text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_staff text := public.ecotrack_staff_id();
  v_admin boolean := coalesce(public.ecotrack_is_admin(), false);
  v_request jsonb;
  v_previous public.ecotrack_maintenance_operations%rowtype;
  v_report public.maintenance_reports%rowtype;
  v_parent public.maintenance_reports%rowtype;
  v_parent_id text;
  v_tasks jsonb;
  v_parent_tasks jsonb := '[]'::jsonb;
  v_task jsonb;
  v_input jsonb;
  v_id text;
  v_link text;
  v_status text;
  v_task_status text;
  v_parent_status text;
  v_is_repair boolean;
  v_match boolean;
  v_matches integer := 0;
  v_idx bigint;
  v_now timestamptz;
  v_parent_now timestamptz;
  v_issue jsonb;
  v_parent_issue jsonb;
  v_result jsonb;
begin
  if v_actor is null or (not v_admin and v_staff is null) then
    raise exception 'Sign in with an active maintenance account.' using errcode = '42501';
  end if;
  if p_verification is not null and (not v_admin or p_verification not in ('approve', 'reject')) then
    raise exception 'Administrator authorization is required for verification.' using errcode = '42501';
  end if;
  if p_verification = 'reject' and btrim(coalesce(p_verification_remarks, '')) = '' then
    raise exception 'Explain the required corrective work when rejecting a report.' using errcode = '22023';
  end if;
  if p_report_id is null or btrim(p_report_id) = '' or p_operation_id is null
    or length(p_operation_id) not between 1 and 128 then
    raise exception 'A report and retry operation ID are required.' using errcode = '22023';
  end if;
  v_request := jsonb_build_object('report', p_report_id, 'version', p_expected_updated,
    'status', p_status, 'tasks', p_tasks, 'submit_repair', p_submit_repair,
    'verification', p_verification, 'verification_remarks', p_verification_remarks);
  -- Serializes identical retries even if the first request has not committed.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_operation_id, 0));
  select * into v_previous from public.ecotrack_maintenance_operations
    where actor_id = v_actor and operation_id = p_operation_id;
  if found then
    if v_previous.request <> v_request then
      raise exception 'This operation ID was already used with different changes.' using errcode = '22023';
    end if;
    return v_previous.result;
  end if;

  select * into v_report from public.maintenance_reports where id = p_report_id;
  if not found or (not v_admin and v_report.staff_id::text is distinct from v_staff) then
    raise exception 'Report is unavailable or is assigned to another account.' using errcode = '42501';
  end if;
  v_parent_id := nullif(v_report.parent_report_id::text, '');
  if v_parent_id = p_report_id then
    raise exception 'A repair cannot be its own parent.' using errcode = '22023';
  end if;
  -- Ordered locks prevent two child submissions from racing or deadlocking when
  -- they share a parent. A parent edit must acquire this same parent row lock.
  perform id from public.maintenance_reports
    where id in (p_report_id, v_parent_id) order by id for update;
  select * into v_report from public.maintenance_reports where id = p_report_id;
  if not found or (not v_admin and v_report.staff_id::text is distinct from v_staff) then
    raise exception 'Report is unavailable or assignment changed.' using errcode = '42501';
  end if;
  if nullif(v_report.parent_report_id::text, '') is distinct from v_parent_id then
    raise exception 'Repair relationship changed. Refresh and retry.' using errcode = '40001';
  end if;
  if v_report.updated is distinct from p_expected_updated then
    raise exception 'Report changed since the screen was loaded.' using errcode = '40001';
  end if;
  if v_report.status in ('Completed', 'Verified') then
    raise exception 'Approved reports cannot be edited through the maintenance workflow.' using errcode = '22023';
  end if;
  if p_verification is not null and v_report.status <> 'For Verification' then
    raise exception 'Only reports submitted for verification can be approved or rejected.' using errcode = '22023';
  end if;
  v_is_repair := v_report.id like 'REP-%' or coalesce(v_report.type, '') ~* '(repair|corrective)';
  if p_submit_repair and not v_is_repair then
    raise exception 'Only corrective repair orders can use repair submission.' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('Pending', 'In Progress', 'Needs Repair', 'Under Repair', 'For Verification') then
    raise exception 'Only administrator verification can approve a report.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_report.tasks::jsonb) is distinct from 'array' or jsonb_array_length(v_report.tasks::jsonb) = 0 then
    raise exception 'This report has no assigned checklist.' using errcode = '22023';
  end if;
  v_now := greatest(clock_timestamp(), coalesce(v_report.updated, '-infinity') + interval '1 microsecond');
  v_tasks := v_report.tasks::jsonb;
  if p_submit_repair and exists (select 1 from jsonb_array_elements(v_tasks) t where coalesce(t->>'status', '') <> 'Completed') then
    raise exception 'Complete every repair checklist item before submitting.' using errcode = '22023';
  end if;
  if p_tasks is not null then
    if jsonb_typeof(p_tasks) is distinct from 'array' then
      raise exception 'Checklist changes must be an array.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_tasks) <> jsonb_array_length(v_tasks)
      or (select count(distinct t->>'id') from jsonb_array_elements(p_tasks) t) <> jsonb_array_length(v_tasks) then
      raise exception 'Assigned checklist items cannot be added, removed or duplicated.' using errcode = '22023';
    end if;
    v_tasks := '[]'::jsonb;
    for v_task, v_idx in select value, ordinality from jsonb_array_elements(v_report.tasks::jsonb) with ordinality loop
      v_id := coalesce(nullif(v_task->>'id', ''), v_idx::text);
      select value into v_input from jsonb_array_elements(p_tasks) where value->>'id' = v_id;
      if not found or jsonb_typeof(v_input) <> 'object' then
        raise exception 'The assigned checklist changed. Refresh and retry.' using errcode = '40001';
      end if;
      v_link := coalesce(nullif(v_task->>'linkedRepairId', ''), nullif(v_task->>'linked_repair_id', ''),
        nullif(v_task->>'repairId', ''), nullif(v_task->>'repair_id', ''));
      v_task_status := v_input->>'status';
      if v_task_status is null or v_task_status not in ('Not Started', 'In Progress', 'Completed', 'Needs Repair', 'Under Repair', 'For Verification') then
        raise exception 'Invalid checklist status.' using errcode = '22023';
      end if;
      -- Linked repairs and approval metadata belong to server transitions, never
      -- to arbitrary JSON supplied by the mobile app. Preserve unknown task keys.
      if v_link is not null then
        if v_task_status is distinct from v_task->>'status' then
          raise exception 'Linked repair state changed. Refresh the report.' using errcode = '40001';
        end if;
      elsif v_task_status in ('Under Repair', 'For Verification') and v_task_status is distinct from v_task->>'status' then
        raise exception 'Repair dispatch and verification status are server controlled.' using errcode = '22023';
      end if;
      if v_is_repair and v_task_status not in ('Not Started', 'In Progress', 'Completed') then
        raise exception 'Repair checklist items must be completed before submission.' using errcode = '22023';
      end if;
      if v_task_status = 'Needs Repair' and btrim(coalesce(nullif(v_input->>'problemDescription', ''), v_input->>'notes', '')) = '' then
        raise exception 'Describe the defect before marking it Needs Repair.' using errcode = '22023';
      end if;
      if jsonb_typeof(v_input->'photoUris') is distinct from 'array' then
        raise exception 'Checklist photo references must be an array.' using errcode = '22023';
      end if;
      if exists (
        select 1 from jsonb_array_elements((v_input->'photoUris') ||
          case when nullif(v_input->>'photoUri','') is null then '[]'::jsonb else jsonb_build_array(v_input->'photoUri') end) photo
        where jsonb_typeof(photo) <> 'string' or not (
          -- An existing reference can be retained, but cannot confer access to a new object.
          coalesce(photo #>> '{}' = v_task->>'photoUri',false) or coalesce(v_task->'photoUris','[]'::jsonb) @> jsonb_build_array(photo)
          or exists(select 1 from storage.objects o where o.bucket_id in ('photos','maintenance-photos')
            and split_part(o.name,'/',1)=auth.uid()::text
            and photo #>> '{}' = 'storage://'||o.bucket_id||'/'||o.name))) then
        raise exception 'Upload checklist photos to your private storage folder before saving.' using errcode = '22023';
      end if;
      v_tasks := v_tasks || jsonb_build_array(v_task || jsonb_build_object(
        'id', v_id, 'status', v_task_status, 'notes', coalesce(v_input->>'notes', ''),
        'problemDescription', coalesce(v_input->>'problemDescription', ''),
        'photoUri', v_input->'photoUri', 'photoUris', v_input->'photoUris',
        'updated', v_now, 'updated_at', v_now));
    end loop;
  end if;

  if p_verification = 'approve' then
    if exists (select 1 from jsonb_array_elements(v_tasks) t where coalesce(t->>'status', '') not in ('Completed', 'For Verification')) then
      raise exception 'All checklist tasks must be ready before approval.' using errcode = '22023';
    end if;
    -- Child submissions/approvals also lock this parent, so their state cannot
    -- change while this parent is being approved. Missing children fail closed.
    if exists (select 1 from jsonb_array_elements(v_tasks) t
      cross join lateral (select coalesce(nullif(t->>'linkedRepairId', ''), nullif(t->>'linked_repair_id', ''),
        nullif(t->>'repairId', ''), nullif(t->>'repair_id', '')) as repair_id) link
      where link.repair_id is not null and not exists (select 1 from public.maintenance_reports child
        where child.id = link.repair_id and child.status in ('Completed', 'Verified'))) then
      raise exception 'Approve every linked corrective repair before approving its parent checklist.' using errcode = '22023';
    end if;
    select jsonb_agg(t || jsonb_build_object('status', 'Completed', 'verified', true,
      'verifiedAt', v_now, 'verifiedBy', v_actor, 'repaired', case when v_is_repair or
        coalesce(t->>'linkedRepairId', t->>'linked_repair_id', t->>'repairId', t->>'repair_id') is not null then true else coalesce((t->>'repaired')::boolean, false) end,
      'updated', v_now, 'updated_at', v_now)) into v_tasks from jsonb_array_elements(v_tasks) t;
  elsif p_verification = 'reject' then
    select jsonb_agg(t || case when coalesce(nullif(t->>'linkedRepairId', ''), nullif(t->>'linked_repair_id', ''),
      nullif(t->>'repairId', ''), nullif(t->>'repair_id', '')) is null then
      jsonb_build_object('status', 'In Progress', 'verified', false, 'verifiedAt', null, 'repaired', false,
        'isRepaired', false, 'updated', v_now, 'updated_at', v_now) else '{}'::jsonb end)
      into v_tasks from jsonb_array_elements(v_tasks) t;
  end if;

  -- Derive the summary from authoritative tasks, so a forged requested status
  -- cannot hide incomplete tasks or defects. For Verification is never approval.
  if p_verification = 'approve' then
    v_status := 'Completed';
  elsif p_verification = 'reject' then
    v_status := 'In Progress';
  elsif exists (select 1 from jsonb_array_elements(v_tasks) t where t->>'status' = 'Under Repair') then
    v_status := 'Under Repair';
  elsif exists (select 1 from jsonb_array_elements(v_tasks) t where t->>'status' = 'Needs Repair') then
    v_status := 'Needs Repair';
  elsif not exists (select 1 from jsonb_array_elements(v_tasks) t where coalesce(t->>'status', '') not in ('Completed', 'For Verification')) then
    v_status := 'For Verification';
  elsif exists (select 1 from jsonb_array_elements(v_tasks) t where t->>'status' in ('In Progress', 'Completed', 'For Verification')) then
    v_status := 'In Progress';
  else
    v_status := 'Pending';
  end if;
  if (p_submit_repair or p_status = 'For Verification') and v_status <> 'For Verification' then
    raise exception 'Complete every required checklist item before submitting.' using errcode = '22023';
  end if;

  v_issue := v_report.issue::jsonb;
  if exists (select 1 from jsonb_array_elements(v_tasks) t where t->>'status' in ('Needs Repair', 'Under Repair', 'For Verification')) then
    select coalesce(v_issue, '{}'::jsonb) || jsonb_build_object(
      'component', string_agg(coalesce(t->>'name', t->>'title', t->>'id'), ', '),
      'components', jsonb_agg(coalesce(t->>'name', t->>'title', t->>'id')),
      'notes', string_agg(coalesce(t->>'name', t->>'title', t->>'id') || ': ' || coalesce(nullif(t->>'problemDescription', ''), t->>'notes', ''), ' • '),
      'reported_by_id', v_staff, 'reported_by_auth_id', v_actor, 'reported_at', v_now)
    into v_issue from jsonb_array_elements(v_tasks) t where t->>'status' in ('Needs Repair', 'Under Repair', 'For Verification');
  elsif not v_is_repair then
    v_issue := null;
  end if;

  if v_is_repair and v_parent_id is not null then
    select * into v_parent from public.maintenance_reports where id = v_parent_id;
    if not found then
      raise exception 'The parent maintenance report is missing. Nothing was submitted.' using errcode = '22023';
    end if;
    if v_parent.status in ('Completed', 'Verified') then
      raise exception 'An approved parent report cannot be changed by a repair submission.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_parent.tasks::jsonb) is distinct from 'array' then
      raise exception 'The parent checklist is invalid.' using errcode = '22023';
    end if;
    v_parent_now := greatest(v_now, coalesce(v_parent.updated, '-infinity') + interval '1 microsecond');
    for v_task, v_idx in select value, ordinality from jsonb_array_elements(v_parent.tasks::jsonb) with ordinality loop
      v_link := coalesce(nullif(v_task->>'linkedRepairId', ''), nullif(v_task->>'linked_repair_id', ''),
        nullif(v_task->>'repairId', ''), nullif(v_task->>'repair_id', ''));
      v_match := v_link = p_report_id or (v_link is null and
        coalesce(nullif(v_task->>'id', ''), v_idx::text) = coalesce(v_report.issue->>'parentTaskId', v_report.issue->>'taskId'));
      if coalesce(v_match, false) then
        v_matches := v_matches + 1;
        v_task := v_task || jsonb_build_object('status', case when v_status = 'Completed' then 'Completed'
          when v_status = 'For Verification' then 'For Verification' else 'Under Repair' end,
          'repaired', v_status = 'Completed', 'isRepaired', v_status = 'Completed', 'verified', v_status = 'Completed',
          'verifiedAt', case when v_status = 'Completed' then v_parent_now else null end,
          'linkedRepairId', p_report_id, 'updated', v_parent_now, 'updated_at', v_parent_now);
      end if;
      v_parent_tasks := v_parent_tasks || jsonb_build_array(v_task);
    end loop;
    if v_matches = 0 then
      raise exception 'The repair has no explicit parent checklist link. Ask an administrator to link its task ID.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(v_parent_tasks) t where t->>'status' = 'Under Repair') then
      v_parent_status := 'Under Repair';
    elsif exists (select 1 from jsonb_array_elements(v_parent_tasks) t where t->>'status' = 'Needs Repair') then
      v_parent_status := 'Needs Repair';
    elsif jsonb_array_length(v_parent_tasks) > 0 and not exists
      (select 1 from jsonb_array_elements(v_parent_tasks) t where coalesce(t->>'status', '') not in ('Completed', 'For Verification')) then
      v_parent_status := 'For Verification';
    else
      v_parent_status := 'In Progress';
    end if;
    select coalesce(v_parent.issue::jsonb, '{}'::jsonb) || jsonb_build_object(
      'component', string_agg(coalesce(t->>'name', t->>'title', t->>'id'), ', '),
      'components', jsonb_agg(coalesce(t->>'name', t->>'title', t->>'id')))
    into v_parent_issue from jsonb_array_elements(v_parent_tasks) t
      where t->>'status' in ('Needs Repair', 'Under Repair', 'For Verification');
    update public.maintenance_reports set tasks = v_parent_tasks, status = v_parent_status,
      issue = v_parent_issue, updated = v_parent_now,
      timeline = jsonb_build_array(jsonb_build_object('title', case when v_status = 'Completed'
        then 'Repair #' || p_report_id || ' approved by administrator' when p_verification = 'reject'
        then 'Repair #' || p_report_id || ' requires corrective work' when v_status = 'For Verification'
        then 'Repair #' || p_report_id || ' submitted for administrator verification'
        else 'Repair #' || p_report_id || ' updated' end, 'time', v_parent_now,
        'actor_id', v_actor, 'operation_id', p_operation_id, 'done', true)) || coalesce(timeline::jsonb, '[]'::jsonb)
      where id = v_parent_id returning updated into v_parent_now;
  end if;

  update public.maintenance_reports set tasks = v_tasks, status = v_status, issue = v_issue, updated = v_now,
    verification_remarks = case when p_verification is not null then p_verification_remarks else verification_remarks end,
    timeline = jsonb_build_array(jsonb_build_object('title', case when v_status = 'Completed' then 'Checklist approved by administrator'
      when p_verification = 'reject' then 'Checklist requires corrective work: ' || p_verification_remarks when v_status = 'For Verification'
      then 'Checklist submitted for administrator verification' else 'Maintenance checklist updated' end,
      'time', v_now, 'actor_id', v_actor, 'operation_id', p_operation_id, 'done', true)) || coalesce(timeline::jsonb, '[]'::jsonb)
    where id = p_report_id returning updated into v_now;
  v_result := jsonb_strip_nulls(jsonb_build_object('success', true, 'updated', v_now, 'status', v_status,
    'updatedParentId', v_parent_id, 'parentStatus', v_parent_status, 'parentUpdated', v_parent_now));
  insert into public.ecotrack_maintenance_operations(actor_id, operation_id, request, result)
    values(v_actor, p_operation_id, v_request, v_result);
  return v_result;
end;
$$;
revoke all on function public.ecotrack_mutate_maintenance(text,timestamptz,text,text,jsonb,boolean,text,text) from public, anon, authenticated;

create or replace function public.ecotrack_update_maintenance_report(
  p_report_id text, p_expected_updated timestamptz, p_operation_id text, p_status text, p_tasks jsonb
) returns jsonb language sql security definer set search_path = '' as $$
  select public.ecotrack_mutate_maintenance(p_report_id, p_expected_updated, p_operation_id, p_status, p_tasks, false);
$$;
create or replace function public.ecotrack_submit_repair(
  p_repair_id text, p_expected_updated timestamptz, p_operation_id text
) returns jsonb language sql security definer set search_path = '' as $$
  select public.ecotrack_mutate_maintenance(p_repair_id, p_expected_updated, p_operation_id, 'For Verification', null, true);
$$;
create or replace function public.ecotrack_verify_maintenance(
  p_report_id text, p_expected_updated timestamptz, p_operation_id text, p_approved boolean, p_remarks text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_approved is null then raise exception 'Choose approve or reject.' using errcode = '22023'; end if;
  return public.ecotrack_mutate_maintenance(p_report_id, p_expected_updated, p_operation_id, null, null, false,
    case when p_approved then 'approve' else 'reject' end, p_remarks);
end;
$$;
revoke all on function public.ecotrack_update_maintenance_report(text,timestamptz,text,text,jsonb) from public, anon;
revoke all on function public.ecotrack_submit_repair(text,timestamptz,text) from public, anon;
revoke all on function public.ecotrack_verify_maintenance(text,timestamptz,text,boolean,text) from public, anon;
grant execute on function public.ecotrack_update_maintenance_report(text,timestamptz,text,text,jsonb) to authenticated;
grant execute on function public.ecotrack_submit_repair(text,timestamptz,text) to authenticated;
grant execute on function public.ecotrack_verify_maintenance(text,timestamptz,text,boolean,text) to authenticated;

-- Workers cannot bypass version checks by using direct REST table writes.
-- The auth migration must supply appropriate administrator policies; a role
-- grant is deliberately not restored here because authenticated includes staff.
revoke insert, update, delete on public.maintenance_reports from anon, authenticated;
commit;

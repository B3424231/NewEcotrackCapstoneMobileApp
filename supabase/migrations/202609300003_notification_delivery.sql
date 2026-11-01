-- Per-recipient notification state and transaction-generated maintenance events.
-- Requires 202609300001 and 202609300002. Review on an identified test database first.
-- No push worker, device-token registry, or recurring reminder scheduler is installed here.
begin;

alter table public.mobile_notifications
  add column if not exists event_key text,
  add column if not exists event_payload jsonb,
  add column if not exists is_broadcast boolean not null default false,
  add column if not exists aircon_type text,
  add column if not exists verification_remarks text;

-- Only an explicit legacy broadcast marker is treated as a broadcast. Ambiguous names
-- remain administrator-only until an operator maps their immutable staff_id.
update public.mobile_notifications set is_broadcast = true
where staff_id is null and staff_name = 'All Staff';
update public.mobile_notifications n set staff_id = s.id
from public.staff s
where n.staff_id is null and not n.is_broadcast and n.staff_name = s.name
  and (select count(*) from public.staff other where other.name = n.staff_name) = 1;
update public.mobile_notifications set event_key = 'legacy:' || id where event_key is null;
update public.mobile_notifications set created_at = coalesce(updated_at, now()) where created_at is null;
alter table public.mobile_notifications alter column event_key set not null;
alter table public.mobile_notifications alter column created_at set not null;
create unique index if not exists mobile_notifications_event_key_unique on public.mobile_notifications(event_key);
create index if not exists mobile_notifications_recipient_page on public.mobile_notifications(staff_id, created_at desc, id desc);
create index if not exists mobile_notifications_broadcast_page on public.mobile_notifications(created_at desc, id desc) where is_broadcast;

-- Existing orphan references must be inventoried before VALIDATE CONSTRAINT. New
-- events cannot introduce additional invalid staff IDs.
alter table public.mobile_notifications drop constraint if exists mobile_notifications_staff_id_fkey;
alter table public.mobile_notifications add constraint mobile_notifications_staff_id_fkey
  foreign key (staff_id) references public.staff(id) on delete restrict not valid;

create table if not exists public.mobile_notification_state (
  notification_id text not null references public.mobile_notifications(id) on delete cascade,
  recipient_auth_user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz,
  snooze_until timestamptz,
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (notification_id, recipient_auth_user_id)
);
create index if not exists mobile_notification_state_recipient on public.mobile_notification_state(recipient_auth_user_id, notification_id);

-- Historical broadcast read/snooze flags cannot be attributed to one person. Leave
-- their personal state empty. Preserve unambiguously targeted legacy state only.
insert into public.mobile_notification_state(notification_id, recipient_auth_user_id, read_at, snooze_until)
select n.id, s.auth_user_id, case when n.is_read then coalesce(n.updated_at, n.created_at) end,
  case when n.is_snoozed then n.snooze_until end
from public.mobile_notifications n join public.staff s on s.id = n.staff_id
where not n.is_broadcast and s.auth_user_id is not null and (n.is_read or n.is_snoozed)
on conflict do nothing;

-- Drop every prior notification policy, including legacy permissive policy names.
do $$ declare p record; begin
  for p in select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('mobile_notifications','mobile_notification_state')
  loop execute format('drop policy %I on public.%I', p.policyname, p.tablename); end loop;
end $$;
alter table public.mobile_notifications enable row level security;
alter table public.mobile_notification_state enable row level security;
revoke all on public.mobile_notifications, public.mobile_notification_state from public, anon, authenticated;
grant select on public.mobile_notifications, public.mobile_notification_state to authenticated;

create or replace function public.ecotrack_notification_visible(p_staff_id text, p_broadcast boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    public.ecotrack_is_admin() or (
      public.ecotrack_staff_id() is not null and (p_broadcast or p_staff_id = public.ecotrack_staff_id())
    )
  )
$$;
revoke all on function public.ecotrack_notification_visible(text,boolean) from public, anon;
grant execute on function public.ecotrack_notification_visible(text,boolean) to authenticated;
create policy notification_event_read on public.mobile_notifications for select to authenticated
  using (public.ecotrack_notification_visible(staff_id,is_broadcast));
create policy notification_personal_state_read on public.mobile_notification_state for select to authenticated
  using (recipient_auth_user_id = auth.uid() and exists (
    select 1 from public.mobile_notifications n where n.id = notification_id
      and public.ecotrack_notification_visible(n.staff_id,n.is_broadcast)
  ));

create or replace function public.ecotrack_list_notifications(
  p_limit integer default 60, p_before_created_at timestamptz default null, p_before_id text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_items jsonb; v_count integer; v_last jsonb;
begin
  if auth.uid() is null or not (public.ecotrack_is_admin() or public.ecotrack_staff_id() is not null) then
    raise exception 'Authenticated profile required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Invalid notification cursor or page size' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(q.item order by q.created_at desc,q.id desc), '[]'::jsonb) into v_items
  from (
    select n.id,n.created_at, to_jsonb(n) || jsonb_build_object(
      'is_read', s.read_at is not null,
      'is_snoozed', coalesce(s.snooze_until > now(), false),
      'snooze_until', s.snooze_until
    ) as item
    from public.mobile_notifications n left join public.mobile_notification_state s
      on s.notification_id = n.id and s.recipient_auth_user_id = auth.uid()
    where public.ecotrack_notification_visible(n.staff_id,n.is_broadcast)
      and s.archived_at is null
      and (p_before_created_at is null or (n.created_at,n.id) < (p_before_created_at,p_before_id))
    order by n.created_at desc,n.id desc limit p_limit + 1
  ) q;
  v_count := jsonb_array_length(v_items);
  if v_count > p_limit then
    v_items := v_items - p_limit;
    v_last := v_items -> (p_limit - 1);
  end if;
  return jsonb_build_object('items',v_items,'next_cursor',case when v_count > p_limit then
    jsonb_build_object('created_at',v_last->>'created_at','id',v_last->>'id') else null end);
end $$;

create or replace function public.ecotrack_set_notification_state(
  p_ids text[], p_action text, p_snooze_minutes integer default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_requested integer; v_now timestamptz := now();
begin
  if auth.uid() is null or not (public.ecotrack_is_admin() or public.ecotrack_staff_id() is not null) then
    raise exception 'Authenticated profile required' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 1000
    or exists (select 1 from unnest(p_ids) i where i is null or btrim(i) = '')
    or p_action is null or p_action not in ('read','unread','archive','snooze','unsnooze') then
    raise exception 'Invalid notification operation' using errcode = '22023';
  end if;
  if p_action = 'snooze' and (p_snooze_minutes is null or p_snooze_minutes < 1 or p_snooze_minutes > 10080) then
    raise exception 'Invalid snooze duration' using errcode = '22023';
  end if;
  select count(distinct i) into v_requested from unnest(p_ids) i;
  select count(*) into v_count from public.mobile_notifications n
    where n.id = any(p_ids) and public.ecotrack_notification_visible(n.staff_id,n.is_broadcast);
  if v_count <> v_requested then
    raise exception 'Notification missing or inaccessible' using errcode = '42501';
  end if;
  insert into public.mobile_notification_state as current_state
    (notification_id,recipient_auth_user_id,read_at,snooze_until,archived_at,updated_at)
  select distinct i,auth.uid(),case when p_action = 'read' then v_now end,
    case when p_action = 'snooze' then v_now + make_interval(mins => p_snooze_minutes) end,
    case when p_action = 'archive' then v_now end,v_now from unnest(p_ids) i
  on conflict (notification_id,recipient_auth_user_id) do update set
    read_at = case when p_action = 'read' then v_now when p_action = 'unread' then null else current_state.read_at end,
    snooze_until = case when p_action = 'snooze' then excluded.snooze_until when p_action = 'unsnooze' then null else current_state.snooze_until end,
    archived_at = case when p_action = 'archive' then v_now else current_state.archived_at end,
    updated_at = v_now;
  return v_count;
end $$;

create or replace function public.ecotrack_mark_all_notifications_read()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null or not (public.ecotrack_is_admin() or public.ecotrack_staff_id() is not null) then
    raise exception 'Authenticated profile required' using errcode = '42501';
  end if;
  insert into public.mobile_notification_state as current_state(notification_id,recipient_auth_user_id,read_at)
  select n.id,auth.uid(),now() from public.mobile_notifications n
    left join public.mobile_notification_state s on s.notification_id = n.id and s.recipient_auth_user_id = auth.uid()
    where public.ecotrack_notification_visible(n.staff_id,n.is_broadcast) and s.archived_at is null and s.read_at is null
  on conflict (notification_id,recipient_auth_user_id) do update
    set read_at = excluded.read_at,updated_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Only administrators can author ad-hoc events. A stable key makes network retries
-- idempotent; reuse of a key for different content is rejected instead of overwriting.
create or replace function public.ecotrack_create_notification(p_payload jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare v_key text; v_id text; v_staff text; v_broadcast boolean; v_name text;
  v_existing public.mobile_notifications%rowtype;
begin
  if auth.uid() is null or not public.ecotrack_is_admin() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or nullif(btrim(p_payload->>'event_key'),'') is null
    or length(p_payload->>'event_key') > 200
    or nullif(btrim(p_payload->>'title'),'') is null or length(p_payload->>'title') > 500
    or nullif(btrim(p_payload->>'message'),'') is null or length(p_payload->>'message') > 10000 then
    raise exception 'Invalid notification event' using errcode = '22023';
  end if;
  if coalesce(p_payload->>'type','system') not in ('task_assigned','task_reminder','overdue_alert','urgent_repair','preventive_routine','controller_alert','sensor_alert','status_update','system')
    or coalesce(p_payload->>'priority','medium') not in ('critical','urgent','high','medium','low')
    or coalesce(p_payload->>'category','system') not in ('task','maintenance','device','sensor','system') then
    raise exception 'Invalid notification classification' using errcode = '22023';
  end if;
  v_key := 'manual:' || (p_payload->>'event_key');
  v_staff := nullif(btrim(p_payload->>'staff_id'),'');
  v_broadcast := coalesce((p_payload->>'is_broadcast')::boolean,false);
  if (v_broadcast and v_staff is not null) or (not v_broadcast and v_staff is null) then
    raise exception 'Exactly one recipient or broadcast is required' using errcode = '22023';
  end if;
  if v_staff is not null then
    select name into v_name from public.staff where id = v_staff;
    if not found then raise exception 'Unknown staff recipient' using errcode = '22023'; end if;
  else v_name := 'All Staff'; end if;
  -- Serialize equal event keys across concurrent clients; do not change existing events.
  perform pg_advisory_xact_lock(hashtextextended(v_key,0));
  select * into v_existing from public.mobile_notifications where event_key = v_key;
  if found then
    if v_existing.event_payload is distinct from p_payload then
      raise exception 'Event key already used for different content' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  v_id := 'mob_' || gen_random_uuid()::text;
  insert into public.mobile_notifications(id,event_key,event_payload,staff_id,staff_name,is_broadcast,title,message,type,priority,category,
    related_report_id,aircon_id,aircon_name,aircon_type,location,due_date,verification_remarks)
  values (v_id,v_key,p_payload,v_staff,v_name,v_broadcast,p_payload->>'title',p_payload->>'message',
    coalesce(p_payload->>'type','system'),coalesce(p_payload->>'priority','medium'),coalesce(p_payload->>'category','system'),
    p_payload->>'related_report_id',p_payload->>'aircon_id',p_payload->>'aircon_name',p_payload->>'aircon_type',
    p_payload->>'location',p_payload->>'due_date',p_payload->>'verification_remarks');
  return v_id;
end $$;

-- Replace the known legacy trigger. Status/assignment events are inserted in the
-- same transaction as their report. Checklist edits without a transition stay quiet.
create or replace function public.fn_sync_maintenance_to_mobile_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb := to_jsonb(new); v_old jsonb; v_key text; v_type text; v_title text;
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    if v_row->>'status' is not distinct from v_old->>'status'
      and v_row->>'staff_id' is not distinct from v_old->>'staff_id' then return new; end if;
  end if;
  -- An unresolved assignment is visible to administrators only, never a broadcast.
  v_key := 'maintenance:' || new.id::text || ':' || (v_row->>'updated') || ':'
    || coalesce(v_row->>'status','') || ':' || coalesce(v_row->>'staff_id','unassigned');
  if v_key is null then raise exception 'Maintenance event requires report version'; end if;
  v_type := case when tg_op = 'INSERT' or v_row->>'staff_id' is distinct from v_old->>'staff_id' then 'task_assigned'
    when v_row->>'status' = 'Needs Repair' then 'urgent_repair' else 'status_update' end;
  v_title := case v_type when 'task_assigned' then 'New Maintenance Task Assigned'
    when 'urgent_repair' then 'URGENT: Defect / Repair Needed' else 'Maintenance Status Updated' end;
  insert into public.mobile_notifications(id,event_key,staff_id,staff_name,is_broadcast,title,message,type,priority,category,
    related_report_id,aircon_id,aircon_name,aircon_type,location,due_date,verification_remarks)
  values ('mob_' || gen_random_uuid()::text,v_key,nullif(v_row->>'staff_id',''),v_row->>'staff_name',false,v_title,
    'Report ' || new.id::text || ' at ' || coalesce(v_row->>'room_name','Assigned Area') || '. Status: ' || coalesce(v_row->>'status','Assigned') || '.',
    v_type,case when v_type = 'urgent_repair' then 'critical' else 'medium' end,'maintenance',new.id::text,
    v_row->>'aircon_id',v_row->>'aircon_name',v_row->>'aircon_type',v_row->>'room_name',v_row->>'due_date',v_row->>'verification_remarks')
  on conflict (event_key) do nothing;
  return new;
end $$;
drop trigger if exists trg_maintenance_to_mobile_notif on public.maintenance_reports;
create trigger trg_maintenance_to_mobile_notif after insert or update on public.maintenance_reports
  for each row execute function public.fn_sync_maintenance_to_mobile_notifications();
revoke all on function public.fn_sync_maintenance_to_mobile_notifications() from public, anon, authenticated;

revoke all on function public.ecotrack_list_notifications(integer,timestamptz,text),
  public.ecotrack_set_notification_state(text[],text,integer),public.ecotrack_mark_all_notifications_read(),
  public.ecotrack_create_notification(jsonb) from public,anon;
grant execute on function public.ecotrack_list_notifications(integer,timestamptz,text),
  public.ecotrack_set_notification_state(text[],text,integer),public.ecotrack_mark_all_notifications_read(),
  public.ecotrack_create_notification(jsonb) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mobile_notifications') then
      alter publication supabase_realtime add table public.mobile_notifications;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mobile_notification_state') then
      alter publication supabase_realtime add table public.mobile_notification_state;
    end if;
  end if;
end $$;
commit;

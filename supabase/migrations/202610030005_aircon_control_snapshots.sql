-- Capture settings at ingestion time; never derive an AC mode from room temperature.
begin;
alter table public.aircons add column if not exists command_id uuid;
alter table public.aircons add column if not exists command_status text;
alter table public.aircons add column if not exists command_status_at timestamptz;
alter table public.aircons add column if not exists commanded_at timestamptz;
alter table public.aircons add column if not exists reported_state jsonb;
alter table public.aircons add column if not exists reported_at timestamptz;
alter table public.telemetry add column if not exists aircon_id text;
alter table public.telemetry add column if not exists control_snapshot jsonb;

-- Retain the validated, authorized intent RPC and extend its result atomically.
create or replace function public.ecotrack_set_aircon_intent(p_aircon_id text,p_state jsonb,p_protocol text default null) returns jsonb
language plpgsql security definer set search_path='' as $$ declare ac public.aircons%rowtype; begin
  select * into ac from public.aircons where id=p_aircon_id for update;
  if not found or auth.uid() is null or not public.ecotrack_can_manage_device(ac.room_id) then raise exception 'Controller access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_state) is distinct from 'object' or p_state-array['power','temp','mode','fan','swing','turbo','eco']<>'{}'::jsonb
    or coalesce(p_state->>'power','') not in ('on','off','true','false') or jsonb_typeof(p_state->'temp') is distinct from 'number'
    or (p_state->>'temp')::numeric not between 16 and 32 or coalesce(p_state->>'mode','') not in ('cool','dry','fan','auto','heat')
    or coalesce(p_state->>'fan','') not in ('low','medium','high','auto','quiet','silent','turbo') then raise exception 'Invalid controller state'; end if;
  if p_protocol is not null and p_protocol !~ '^[A-Za-z0-9_ -]{1,64}$' then raise exception 'Invalid controller protocol'; end if;
  update public.aircons set desired_state=p_state,command_id=gen_random_uuid(),command_status='queued',commanded_at=clock_timestamp(),command_status_at=clock_timestamp(),
    protocol=coalesce(p_protocol,protocol),protocol_name=coalesce(p_protocol,protocol_name),updated_at=clock_timestamp()
    where id=ac.id returning * into ac;
  return jsonb_build_object('id',ac.id,'desired_state',ac.desired_state,'command_id',ac.command_id,'command_status',ac.command_status,'commanded_at',ac.commanded_at);
end $$;

create or replace function public.ecotrack_ack_aircon_intent(p_aircon_id text,p_command_id uuid,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$ declare ac public.aircons%rowtype; begin
  select * into ac from public.aircons where id=p_aircon_id for update;
  if not found or auth.uid() is null or not public.ecotrack_can_manage_device(ac.room_id) then raise exception 'Controller access denied' using errcode='42501'; end if;
  if p_status is null or p_status not in ('transmitted','failed') or p_command_id is null then raise exception 'Invalid command delivery status'; end if;
  if ac.command_id is distinct from p_command_id then raise exception 'Command superseded' using errcode='40001'; end if;
  if ac.command_status not in ('queued',p_status) then raise exception 'Command already settled' using errcode='40001'; end if;
  update public.aircons set command_status=p_status,command_status_at=clock_timestamp(),updated_at=clock_timestamp() where id=ac.id;
  return jsonb_build_object('id',ac.id,'command_id',ac.command_id,'command_status',p_status);
end $$;
revoke all on function public.ecotrack_ack_aircon_intent(text,uuid,text) from public,anon;
grant execute on function public.ecotrack_ack_aircon_intent(text,uuid,text) to authenticated;

-- Actual feedback may only be supplied by the authenticated ingestion service.
create or replace function public.ecotrack_report_aircon_state(p_aircon_id text,p_state jsonb,p_observed_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$ begin
  if auth.role() is distinct from 'service_role' then raise exception 'Ingestion service required' using errcode='42501'; end if;
  if jsonb_typeof(p_state) is distinct from 'object' or coalesce(p_state->>'power','') not in ('on','off','true','false')
    or p_observed_at is null or p_observed_at>clock_timestamp()+interval '1 minute' then raise exception 'Invalid observed state'; end if;
  update public.aircons set reported_state=p_state,reported_at=p_observed_at,updated_at=clock_timestamp()
    where id=p_aircon_id and (reported_at is null or p_observed_at>reported_at);
end $$;
revoke all on function public.ecotrack_report_aircon_state(text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.ecotrack_report_aircon_state(text,jsonb,timestamptz) to service_role;

create or replace function public.ecotrack_snapshot_aircon_control() returns trigger
language plpgsql security definer set search_path='' as $$
declare matches text[]; ac public.aircons%rowtype; observed_at timestamptz;
begin
  -- Bind by an exact ID/name relationship, never room or fuzzy name matching.
  select array_agg(distinct a.id) into matches from public.aircons a
    left join public.nodes n on n.id=a.node_id or n.id=a.controller_node_id
    where a.node_id=new.node_id or a.controller_node_id=new.node_id or n.name=new.node_id;
  new.aircon_id=null; new.control_snapshot=null;
  if cardinality(matches) is distinct from 1 then return new; end if;
  select * into ac from public.aircons where id=matches[1];
  observed_at=coalesce(new.created::timestamptz,clock_timestamp());
  new.aircon_id=ac.id;
  new.control_snapshot=jsonb_strip_nulls(jsonb_build_object(
    'desired_state',case when ac.commanded_at<=observed_at then ac.desired_state end,
    'command_id',case when ac.commanded_at<=observed_at then ac.command_id end,
    'command_status',case when ac.commanded_at<=observed_at then case when ac.command_status_at<=observed_at then ac.command_status else 'queued' end end,
    'commanded_at',case when ac.commanded_at<=observed_at then ac.commanded_at end,
    'reported_state',case when ac.reported_at<=observed_at then ac.reported_state end,
    'reported_at',case when ac.reported_at<=observed_at then ac.reported_at end));
  return new;
end $$;
drop trigger if exists ecotrack_telemetry_control_snapshot on public.telemetry;
create trigger ecotrack_telemetry_control_snapshot before insert on public.telemetry
  for each row execute function public.ecotrack_snapshot_aircon_control();
revoke all on function public.ecotrack_snapshot_aircon_control() from public,anon,authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='aircons')
  then alter publication supabase_realtime add table public.aircons; end if;
end $$;
notify pgrst,'reload schema';
commit;

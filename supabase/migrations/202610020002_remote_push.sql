begin;
create table if not exists public.staff_push_tokens (
  token text primary key, auth_user_id uuid not null references auth.users(id) on delete cascade,
  staff_id text not null references public.staff(id) on delete cascade,
  platform text not null check(platform in ('android','ios')),
  critical_enabled boolean not null default true, maintenance_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.ecotrack_push_deliveries (
  id uuid primary key default gen_random_uuid(), notification_id text not null references public.mobile_notifications(id) on delete cascade,
  token text not null references public.staff_push_tokens(token) on delete cascade,
  status text not null default 'pending' check(status in ('pending','receipt','delivered','failed')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(), lease_until timestamptz,
  ticket_id text, last_error text, unique(notification_id,token)
);
create index if not exists push_deliveries_pending on public.ecotrack_push_deliveries(next_attempt_at) where status in ('pending','receipt');
alter table public.staff_push_tokens enable row level security;
alter table public.ecotrack_push_deliveries enable row level security;
revoke all on public.staff_push_tokens,public.ecotrack_push_deliveries from public,anon,authenticated;
grant all on public.staff_push_tokens,public.ecotrack_push_deliveries to service_role;

create or replace function public.ecotrack_register_push_token(p_token text,p_platform text,p_critical boolean default true,p_maintenance boolean default true) returns void
language plpgsql security definer set search_path='' as $$ declare worker text:=public.ecotrack_staff_id(); begin
  if worker is null then raise exception 'Active technician account required' using errcode='42501'; end if;
  if p_token is null or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$' or p_platform not in ('android','ios')
    or p_critical is null or p_maintenance is null then raise exception 'Invalid push registration'; end if;
  insert into public.staff_push_tokens(token,auth_user_id,staff_id,platform,critical_enabled,maintenance_enabled,updated_at)
  values(p_token,auth.uid(),worker,p_platform,p_critical,p_maintenance,clock_timestamp())
  on conflict(token) do update set auth_user_id=excluded.auth_user_id,staff_id=excluded.staff_id,platform=excluded.platform,
    critical_enabled=excluded.critical_enabled,maintenance_enabled=excluded.maintenance_enabled,updated_at=excluded.updated_at;
  -- Remove unsent work belonging to a previous device account before rebinding.
  delete from public.ecotrack_push_deliveries d using public.mobile_notifications n
    where d.token=p_token and n.id=d.notification_id and not(n.is_broadcast or n.staff_id=worker);
end $$;
create or replace function public.ecotrack_unregister_push_token(p_token text) returns void
language sql security definer set search_path='' as $$ delete from public.staff_push_tokens where token=p_token and auth_user_id=auth.uid(); $$;
revoke all on function public.ecotrack_register_push_token(text,text,boolean,boolean),public.ecotrack_unregister_push_token(text) from public,anon;
grant execute on function public.ecotrack_register_push_token(text,text,boolean,boolean),public.ecotrack_unregister_push_token(text) to authenticated;

create or replace function public.ecotrack_enqueue_mobile_push() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  insert into public.ecotrack_push_deliveries(notification_id,token)
    select new.id,t.token from public.staff_push_tokens t join public.staff s on s.id=t.staff_id and s.auth_user_id=t.auth_user_id
    where not s.is_archived and not s.force_logout and lower(coalesce(s.status,'')) not in ('archived','deactivated','disabled')
      and t.updated_at>clock_timestamp()-interval '60 days' and (s.auth_valid_after is null or t.updated_at>s.auth_valid_after)
      and (new.is_broadcast or new.staff_id=s.id)
      and case when new.priority in ('critical','urgent','high') or new.type in ('urgent_repair','overdue_alert') then t.critical_enabled else t.maintenance_enabled end
    on conflict(notification_id,token) do nothing;
  return new;
end $$;
drop trigger if exists ecotrack_mobile_push_enqueue on public.mobile_notifications;
create trigger ecotrack_mobile_push_enqueue after insert on public.mobile_notifications for each row execute function public.ecotrack_enqueue_mobile_push();
revoke all on function public.ecotrack_enqueue_mobile_push() from public,anon,authenticated;

create or replace function public.ecotrack_claim_push_deliveries(p_limit integer default 100) returns setof public.ecotrack_push_deliveries
language plpgsql security definer set search_path='' as $$ begin
  if auth.role()<>'service_role' then raise exception 'Push worker required' using errcode='42501'; end if;
  return query with selected as (
    select d.id from public.ecotrack_push_deliveries d where d.status in ('pending','receipt') and d.next_attempt_at<=clock_timestamp()
      and (d.lease_until is null or d.lease_until<clock_timestamp()) order by d.next_attempt_at limit least(greatest(p_limit,1),100) for update skip locked
  ) update public.ecotrack_push_deliveries d set lease_until=clock_timestamp()+interval '2 minutes',attempts=d.attempts+1
    from selected s where d.id=s.id returning d.*;
end $$;
revoke all on function public.ecotrack_claim_push_deliveries(integer) from public,anon,authenticated;
grant execute on function public.ecotrack_claim_push_deliveries(integer) to service_role;
commit;

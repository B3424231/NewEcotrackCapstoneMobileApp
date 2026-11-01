-- A database-triggered invocation receives one short-lived wake capability.
-- No persistent webhook credential is stored in either application.
begin;
create table if not exists public.ecotrack_push_wake_tokens (
  nonce uuid primary key default gen_random_uuid(),
  expires_at timestamptz not null default (now()+interval '10 minutes')
);
alter table public.ecotrack_push_wake_tokens enable row level security;
revoke all on public.ecotrack_push_wake_tokens from public,anon,authenticated;
grant all on public.ecotrack_push_wake_tokens to service_role;
create or replace function public.ecotrack_authorize_push_worker(p_nonce uuid) returns boolean
language plpgsql security definer set search_path='' as $$ declare accepted boolean; begin
  if auth.role()<>'service_role' then raise exception 'Push worker required' using errcode='42501'; end if;
  delete from public.ecotrack_push_wake_tokens where expires_at<=clock_timestamp();
  delete from public.ecotrack_push_wake_tokens where nonce=p_nonce returning true into accepted;
  return coalesce(accepted,false);
end $$;
revoke all on function public.ecotrack_authorize_push_worker(uuid) from public,anon,authenticated;
grant execute on function public.ecotrack_authorize_push_worker(uuid) to service_role;
commit;

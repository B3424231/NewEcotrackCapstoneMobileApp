-- Reject missing JWT roles as well as non-worker roles. Existing RPC signatures,
-- execution grants, queue claims and single-use wake semantics are preserved.
begin;
create or replace function public.ecotrack_authorize_push_worker(p_nonce uuid) returns boolean
language plpgsql security definer set search_path='' as $$ declare accepted boolean; begin
  if auth.role() is distinct from 'service_role' then raise exception 'Push worker required' using errcode='42501'; end if;
  delete from public.ecotrack_push_wake_tokens where expires_at<=clock_timestamp();
  delete from public.ecotrack_push_wake_tokens where nonce=p_nonce returning true into accepted;
  return coalesce(accepted,false);
end $$;

create or replace function public.ecotrack_claim_push_deliveries(p_limit integer default 100) returns setof public.ecotrack_push_deliveries
language plpgsql security definer set search_path='' as $$ begin
  if auth.role() is distinct from 'service_role' then raise exception 'Push worker required' using errcode='42501'; end if;
  return query with selected as (
    select d.id from public.ecotrack_push_deliveries d where d.status in ('pending','receipt') and d.next_attempt_at<=clock_timestamp()
      and (d.lease_until is null or d.lease_until<clock_timestamp()) order by d.next_attempt_at limit least(greatest(p_limit,1),100) for update skip locked
  ) update public.ecotrack_push_deliveries d set lease_until=clock_timestamp()+interval '2 minutes',attempts=d.attempts+1
    from selected s where d.id=s.id returning d.*;
end $$;
commit;

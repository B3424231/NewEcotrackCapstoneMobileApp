-- Apply after the remote-push migration and Edge Function deployment.
-- Uses single-use, expiring wake tokens; no API secret or user password belongs
-- in this file or in either application bundle.
-- First deployment: SELECT vault.create_secret(
-- 'https://<project-ref>.supabase.co/functions/v1/deliver-mobile-push',
-- 'ecotrack_push_worker_url'); Re-running setup preserves that configuration.
begin;
do $$ declare worker_url text; begin
  select decrypted_secret into worker_url from vault.decrypted_secrets where name='ecotrack_push_worker_url';
  if worker_url is null or worker_url !~ '^https?://[^/?#[:space:]]+/functions/v1/deliver-mobile-push$' then
    raise exception 'Configure ecotrack_push_worker_url in Vault for this project before running setup';
  end if;
end $$;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create or replace function public.ecotrack_wake_push_worker() returns void
language plpgsql security definer set search_path='' as $$ declare wake_nonce uuid; worker_url text; begin
  if not exists(select 1 from public.ecotrack_push_deliveries where status in ('pending','receipt') and next_attempt_at<=clock_timestamp()
    and (lease_until is null or lease_until<clock_timestamp())) then return; end if;
  select decrypted_secret into worker_url from vault.decrypted_secrets where name='ecotrack_push_worker_url';
  if worker_url is null or worker_url !~ '^https?://[^/?#[:space:]]+/functions/v1/deliver-mobile-push$' then
    raise exception 'Configure ecotrack_push_worker_url in Vault for this project before sending push';
  end if;
  delete from public.ecotrack_push_wake_tokens where expires_at<=clock_timestamp();
  insert into public.ecotrack_push_wake_tokens default values returning nonce into wake_nonce;
  perform net.http_post(url:=worker_url,
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||wake_nonce),body:='{}'::jsonb);
end $$;
revoke all on function public.ecotrack_wake_push_worker() from public,anon,authenticated;
create or replace function public.ecotrack_wake_push_after_enqueue() returns trigger
language plpgsql security definer set search_path='' as $$ begin perform public.ecotrack_wake_push_worker(); return null; end $$;
revoke all on function public.ecotrack_wake_push_after_enqueue() from public,anon,authenticated;
drop trigger if exists ecotrack_push_worker_dispatch on public.ecotrack_push_deliveries;
create trigger ecotrack_push_worker_dispatch after insert on public.ecotrack_push_deliveries for each statement execute function public.ecotrack_wake_push_after_enqueue();
do $$ begin
  if not exists(select 1 from cron.job where jobname='ecotrack-mobile-push-retry') then
    perform cron.schedule('ecotrack-mobile-push-retry','* * * * *','select public.ecotrack_wake_push_worker()');
  end if;
end $$;
commit;

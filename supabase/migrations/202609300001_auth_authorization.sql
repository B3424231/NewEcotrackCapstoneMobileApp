-- Coordinated cutover: apply on a disposable copy, then provision existing Auth
-- users with the operator script before allowing app traffic. Legacy anonymous clients
-- (including desktop/firmware) intentionally lose direct access after this file.
begin;

alter table public.staff
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists is_archived boolean not null default false,
  add column if not exists force_logout boolean not null default false,
  add column if not exists archive_reason text,
  add column if not exists archive_notes text,
  add column if not exists archived_at timestamptz,
  add column if not exists role text default 'HVAC / Aircon Technician',
  add column if not exists avatar text default 'default',
  add column if not exists photo_url text,
  add column if not exists avatar_url text,
  add column if not exists assignment text default 'Unassigned',
  add column if not exists room_name text,
  add column if not exists floor_name text,
  add column if not exists building_name text,
  add column if not exists last_active timestamptz,
  add column if not exists is_online boolean default false;
alter table public.administrators
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists is_archived boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists phone text,
  add column if not exists avatar text default 'default',
  add column if not exists photo_url text,
  add column if not exists avatar_url text;
alter table public.maintenance_reports add column if not exists staff_id text;
alter table public.staff add column if not exists auth_valid_after timestamptz not null default '-infinity';
alter table public.administrators add column if not exists auth_valid_after timestamptz not null default '-infinity';
-- A later successful login must not reactivate tokens issued before forced logout.
create or replace function public.ecotrack_revoke_profile_sessions() returns trigger
language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)->>'force_logout'='true' and to_jsonb(old)->>'force_logout' is distinct from 'true')
 or (new.is_archived and not old.is_archived)
 or (to_jsonb(new)->>'is_active'='false' and to_jsonb(old)->>'is_active' is distinct from 'false') then
   new.auth_valid_after := greatest(new.auth_valid_after,clock_timestamp());
 end if;
 return new;
end $$;
create trigger ecotrack_staff_session_cutoff before update on public.staff for each row execute function public.ecotrack_revoke_profile_sessions();
create trigger ecotrack_admin_session_cutoff before update on public.administrators for each row execute function public.ecotrack_revoke_profile_sessions();
revoke all on function public.ecotrack_revoke_profile_sessions() from public,anon,authenticated;
create or replace function public.ecotrack_session_valid(p_after timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from auth.sessions s
 where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid() and s.created_at>p_after);
$$;
revoke all on function public.ecotrack_session_valid(timestamptz) from public,anon;
grant execute on function public.ecotrack_session_valid(timestamptz) to authenticated;
alter table public.staff add column if not exists phone_digits text generated always as (regexp_replace(phone,'[^0-9]','','g')) stored;
alter table public.administrators add column if not exists phone_digits text generated always as (regexp_replace(phone,'[^0-9]','','g')) stored;

create table if not exists public.ecotrack_auth_attempts (
 key text primary key, started_at timestamptz not null, attempts integer not null
);
alter table public.ecotrack_auth_attempts enable row level security;
revoke all on public.ecotrack_auth_attempts from public,anon,authenticated;
create or replace function public.ecotrack_auth_attempt(p_key text) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
 if length(p_key)<>64 then return false; end if;
 insert into public.ecotrack_auth_attempts(key,started_at,attempts) values(p_key,clock_timestamp(),1)
 on conflict(key) do update set
 attempts=case when ecotrack_auth_attempts.started_at < clock_timestamp()-interval '15 minutes' then 1 else ecotrack_auth_attempts.attempts+1 end,
 started_at=case when ecotrack_auth_attempts.started_at < clock_timestamp()-interval '15 minutes' then clock_timestamp() else ecotrack_auth_attempts.started_at end
 returning attempts into v_count;
 return v_count <= 10;
end $$;
revoke all on function public.ecotrack_auth_attempt(text) from public,anon,authenticated;
grant execute on function public.ecotrack_auth_attempt(text) to service_role;

-- Do not guess relationships when two workers have the same display name.
update public.maintenance_reports r set staff_id = s.id
from public.staff s where r.staff_id is null and lower(btrim(r.staff_name)) = lower(btrim(s.name))
and (select count(*) from public.staff x where lower(btrim(x.name)) = lower(btrim(r.staff_name))) = 1;
alter table public.maintenance_reports drop constraint if exists maintenance_reports_staff_id_fkey;
alter table public.maintenance_reports add constraint maintenance_reports_staff_id_fkey
  foreign key(staff_id) references public.staff(id) on delete restrict not valid;
create index if not exists maintenance_reports_staff_idx on public.maintenance_reports(staff_id);

-- Existing duplicates cause an explicit deployment failure; no user data is erased.
update public.staff set email=lower(btrim(email)) where email is distinct from lower(btrim(email));
update public.administrators set email=lower(btrim(email)) where email is distinct from lower(btrim(email));
create unique index if not exists staff_normalized_email_unique on public.staff(lower(btrim(email))) where nullif(btrim(email),'') is not null;
create unique index if not exists staff_normalized_phone_unique on public.staff(regexp_replace(phone,'[^0-9]','','g')) where nullif(regexp_replace(phone,'[^0-9]','','g'),'') is not null;
create unique index if not exists admin_normalized_email_unique on public.administrators(lower(btrim(email))) where nullif(btrim(email),'') is not null;

create or replace function public.ecotrack_staff_id() returns text
language sql stable security definer set search_path = '' as $$
 select s.id::text from public.staff s where s.auth_user_id = auth.uid()
 and not s.is_archived and not s.force_logout
 and public.ecotrack_session_valid(s.auth_valid_after)
 and lower(coalesce(s.status,'')) not in ('archived','deactivated','disabled') limit 1;
$$;
create or replace function public.ecotrack_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.administrators a where a.auth_user_id = auth.uid() and not a.is_archived and a.is_active and public.ecotrack_session_valid(a.auth_valid_after));
$$;
create or replace function public.ecotrack_can_access_room(p_room_id text) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and (public.ecotrack_is_admin() or exists(
   select 1 from public.staff s where s.id = public.ecotrack_staff_id() and s.room_id = p_room_id));
$$;
revoke all on function public.ecotrack_staff_id(), public.ecotrack_is_admin(), public.ecotrack_can_access_room(text) from public, anon;
grant execute on function public.ecotrack_staff_id(), public.ecotrack_is_admin(), public.ecotrack_can_access_room(text) to authenticated;

-- Remove all old policies on application tables; permissive policies combine with
-- OR, so merely adding a restrictive-looking policy would leave old bypasses.
do $$ declare p record; t text; cols text; begin
 foreach t in array array['staff','administrators','rooms','floors','buildings','nodes','aircons','maintenance_reports','mobile_notifications','notifications'] loop
   if to_regclass('public.'||t) is null then continue; end if;
   execute format('alter table public.%I enable row level security', t);
   execute format('revoke all on public.%I from public, anon, authenticated',t);
   for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
     execute format('drop policy %I on public.%I',p.policyname,t);
   end loop;
   if t in ('staff','administrators') then
     select string_agg(quote_ident(column_name),',') into cols from information_schema.columns
     where table_schema='public' and table_name=t and column_name not in ('password','password_hash');
     execute format('grant select (%s) on public.%I to authenticated',cols,t);
   else execute format('grant select on public.%I to authenticated',t); end if;
 end loop;
end $$;
create policy staff_read on public.staff for select to authenticated using (auth_user_id=auth.uid() or public.ecotrack_is_admin());
create policy admin_read on public.administrators for select to authenticated using (auth_user_id=auth.uid());
create policy room_read on public.rooms for select to authenticated using (public.ecotrack_can_access_room(id));
create policy floor_read on public.floors for select to authenticated using (public.ecotrack_is_admin() or exists(select 1 from public.rooms r where r.floor_id=floors.id and public.ecotrack_can_access_room(r.id)));
create policy building_read on public.buildings for select to authenticated using (public.ecotrack_is_admin() or exists(select 1 from public.floors f join public.rooms r on r.floor_id=f.id where f.building_id=buildings.id and public.ecotrack_can_access_room(r.id)));
create policy node_read on public.nodes for select to authenticated using (public.ecotrack_can_access_room(room_id));
create policy aircon_read on public.aircons for select to authenticated using (public.ecotrack_can_access_room(room_id));
create policy maintenance_read on public.maintenance_reports for select to authenticated using (public.ecotrack_is_admin() or staff_id=public.ecotrack_staff_id());
-- Generic legacy alerts are admin-only until a stable room/recipient relation exists.
create policy legacy_notification_read on public.notifications for select to authenticated using (public.ecotrack_is_admin());

create or replace function public.ecotrack_my_profile() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.staff%rowtype; a public.administrators%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into a from public.administrators where auth_user_id=auth.uid();
 if found then
   if not public.ecotrack_is_admin() then raise exception 'Active account session required' using errcode='42501'; end if;
   return jsonb_build_object('id',a.id,'authUserId',auth.uid(),'name',a.username,'email',a.email,'phone',coalesce(a.phone,''),'role','Facility Administrator','userType','admin','avatar',a.avatar,'photoUrl',coalesce(a.photo_url,a.avatar_url),'assignment','Unassigned');
 end if;
 select * into s from public.staff where auth_user_id=auth.uid();
 if not found or public.ecotrack_staff_id() is null then
   raise exception 'Active account profile required' using errcode='42501';
 end if;
 return jsonb_build_object('id',s.id,'authUserId',auth.uid(),'name',s.name,'email',s.email,'phone',coalesce(s.phone,''),'role',s.role,'userType','staff','avatar',s.avatar,'photoUrl',coalesce(s.photo_url,s.avatar_url),'assignment',coalesce(s.assignment,'Unassigned'));
end $$;

create or replace function public.ecotrack_update_profile(p_name text,p_phone text,p_avatar text,p_photo_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id text := public.ecotrack_staff_id();
begin
 if auth.uid() is null or (not public.ecotrack_is_admin() and v_id is null) then raise exception 'Active profile required' using errcode='42501'; end if;
 if p_name is null or p_avatar is null or length(btrim(p_name)) not between 1 and 120 or length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')) not between 7 and 15
 or p_avatar not in ('default','male','female','custom') then raise exception 'Invalid profile fields' using errcode='22023'; end if;
 if p_photo_url is not null and (p_photo_url not like 'storage://avatars/'||auth.uid()::text||'/%' or not exists(select 1 from storage.objects where bucket_id='avatars' and name=substring(p_photo_url from 19))) then
   raise exception 'Avatar must be an owned storage object' using errcode='22023'; end if;
 if public.ecotrack_is_admin() then
   update public.administrators set username=btrim(p_name),phone=btrim(p_phone),avatar=p_avatar,photo_url=p_photo_url,avatar_url=p_photo_url,updated=clock_timestamp() where auth_user_id=auth.uid();
 else
   update public.staff set name=btrim(p_name),phone=btrim(p_phone),avatar=p_avatar,photo_url=p_photo_url,avatar_url=p_photo_url,updated=clock_timestamp() where id=v_id;
 end if;
 return public.ecotrack_my_profile();
end $$;

create or replace function public.ecotrack_set_presence(p_online boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if public.ecotrack_staff_id() is null then return; end if;
 update public.staff set is_online=p_online,status=case when p_online then 'Online' else 'Offline' end,last_active=clock_timestamp(),updated=clock_timestamp()
 where id=public.ecotrack_staff_id();
end $$;

-- Only server-controlled app_metadata may link an existing profile. A public
-- signup cannot claim an administrator or existing worker using their email.
create or replace function public.ecotrack_on_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_profile text := new.raw_app_meta_data->>'ecotrack_profile_id'; v_kind text := new.raw_app_meta_data->>'ecotrack_account_type';
begin
 if v_profile is not null then
   if v_kind='admin' then
     update public.administrators set auth_user_id=new.id where id=v_profile and auth_user_id is null and lower(email)=lower(new.email);
   elsif v_kind='staff' then
     update public.staff set auth_user_id=new.id where id=v_profile and auth_user_id is null and lower(email)=lower(new.email);
   else raise exception 'Invalid provisioned profile type'; end if;
   if not found then raise exception 'Provisioned profile could not be linked'; end if;
 else
   if length(btrim(coalesce(new.raw_user_meta_data->>'full_name',''))) not between 1 and 120
   or length(regexp_replace(coalesce(new.raw_user_meta_data->>'phone',''),'[^0-9]','','g')) not between 7 and 15 then
     raise exception 'A valid name and phone are required for registration'; end if;
   if exists(select 1 from public.administrators where lower(email)=lower(new.email)) then raise exception 'Account already exists'; end if;
   insert into public.staff(id,auth_user_id,name,email,phone,role,assignment,status,created,updated)
   values ('staff_'||replace(new.id::text,'-',''),new.id,btrim(new.raw_user_meta_data->>'full_name'),lower(new.email),new.raw_user_meta_data->>'phone','HVAC / Aircon Technician','Unassigned','Active',now(),now());
 end if;
 return new;
end $$;
drop trigger if exists ecotrack_auth_user_created on auth.users;
create trigger ecotrack_auth_user_created after insert on auth.users for each row execute function public.ecotrack_on_auth_user_created();
create or replace function public.ecotrack_on_auth_email_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.staff set email=lower(new.email),updated=clock_timestamp() where auth_user_id=new.id;
 update public.administrators set email=lower(new.email),updated=clock_timestamp() where auth_user_id=new.id;
 return new;
end $$;
drop trigger if exists ecotrack_auth_email_changed on auth.users;
create trigger ecotrack_auth_email_changed after update of email on auth.users for each row
 when(old.email is distinct from new.email) execute function public.ecotrack_on_auth_email_changed();
revoke all on function public.ecotrack_on_auth_email_changed() from public,anon,authenticated;
revoke all on function public.ecotrack_on_auth_user_created() from public,anon,authenticated;
revoke all on function public.ecotrack_my_profile(), public.ecotrack_update_profile(text,text,text,text), public.ecotrack_set_presence(boolean) from public,anon;
grant execute on function public.ecotrack_my_profile(), public.ecotrack_update_profile(text,text,text,text), public.ecotrack_set_presence(boolean) to authenticated;

-- Private buckets. New objects are immutable and owned by their Auth subject.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('avatars','avatars',false,10485760,array['image/jpeg','image/png','image/webp','image/gif']),
('photos','photos',false,20971520,array['image/jpeg','image/png','image/webp','image/gif']),
('maintenance-photos','maintenance-photos',false,20971520,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Restrictive guards neutralize old permissive policies for these three buckets
-- without dropping policies or grants belonging to unrelated applications.
grant select,insert,delete on storage.objects to authenticated;
create or replace function public.ecotrack_can_read_image(p_bucket text,p_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.ecotrack_is_admin() or (public.ecotrack_staff_id() is not null and (
 split_part(p_name,'/',1)=auth.uid()::text or exists (
   select 1 from public.maintenance_reports r cross join lateral jsonb_array_elements(coalesce(r.tasks::jsonb,'[]'::jsonb)) t
   where r.staff_id=public.ecotrack_staff_id() and (
     t->>'photoUri'='storage://'||p_bucket||'/'||p_name or
     coalesce(t->'photoUris','[]'::jsonb) @> jsonb_build_array('storage://'||p_bucket||'/'||p_name)))));
$$;
revoke all on function public.ecotrack_can_read_image(text,text) from public,anon;
grant execute on function public.ecotrack_can_read_image(text,text) to authenticated;
create policy ecotrack_storage_anon_guard on storage.objects as restrictive for all to anon
 using(bucket_id not in ('avatars','photos','maintenance-photos')) with check(bucket_id not in ('avatars','photos','maintenance-photos'));
create policy ecotrack_storage_read_guard on storage.objects as restrictive for select to authenticated using (
 bucket_id not in ('avatars','photos','maintenance-photos') or public.ecotrack_can_read_image(bucket_id,name));
create policy ecotrack_storage_insert_guard on storage.objects as restrictive for insert to authenticated with check (
 bucket_id not in ('avatars','photos','maintenance-photos') or ((public.ecotrack_is_admin() or public.ecotrack_staff_id() is not null)
 and split_part(name,'/',1)=auth.uid()::text and name !~ '(^|/)\.\.(/|$)'));
create policy ecotrack_storage_update_guard on storage.objects as restrictive for update to authenticated
 using(bucket_id not in ('avatars','photos','maintenance-photos')) with check(bucket_id not in ('avatars','photos','maintenance-photos'));
create policy ecotrack_storage_delete_guard on storage.objects as restrictive for delete to authenticated using (
 bucket_id not in ('avatars','photos','maintenance-photos') or (bucket_id='avatars' and split_part(name,'/',1)=auth.uid()::text
 and (public.ecotrack_is_admin() or public.ecotrack_staff_id() is not null)));
create policy ecotrack_storage_read on storage.objects for select to authenticated using (bucket_id in ('avatars','photos','maintenance-photos'));
create policy ecotrack_storage_insert on storage.objects for insert to authenticated with check (bucket_id in ('avatars','photos','maintenance-photos'));
create policy ecotrack_storage_delete on storage.objects for delete to authenticated using (bucket_id='avatars');
commit;

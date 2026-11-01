-- Link profiles only after trusted Auth metadata has been committed by GoTrue.
-- Public signup metadata still grants no authority to an existing profile.
begin;
create or replace function public.ecotrack_on_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_metadata jsonb; v_profile text; v_kind text;
begin
 -- GoTrue applies admin app_metadata after INSERT, inside the same transaction.
 select raw_app_meta_data into v_metadata from auth.users where id=new.id;
 if not found then return new; end if;
 v_profile:=v_metadata->>'ecotrack_profile_id';
 v_kind:=v_metadata->>'ecotrack_account_type';
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
create constraint trigger ecotrack_auth_user_created after insert on auth.users
 deferrable initially deferred for each row execute function public.ecotrack_on_auth_user_created();
commit;

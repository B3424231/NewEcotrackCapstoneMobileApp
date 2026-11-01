-- Requires migrations 001-003 and the supplied nodes/aircons/rooms schema.
-- Validate on a disposable database before deployment. No network/hardware effects.
-- Legacy node_id remains a name for desktop compatibility; controller_node_id is
-- the immutable relationship used by these transactions.
begin;

alter table public.aircons add column if not exists controller_node_id text
  references public.nodes(id) on delete set null;
create index if not exists aircons_controller_node_idx on public.aircons(controller_node_id);

update public.aircons a set controller_node_id = n.id
from public.nodes n
where a.controller_node_id is null and (a.node_id = n.id or a.node_id = n.name)
  and (select count(*) from public.nodes candidate where candidate.id = a.node_id or candidate.name = a.node_id) = 1;

create or replace function public.ecotrack_can_manage_device(p_room_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    coalesce(public.ecotrack_is_admin(), false) or exists (
      select 1 from public.staff s
      where s.id = public.ecotrack_staff_id() and s.room_id = p_room_id
    )
  );
$$;
revoke all on function public.ecotrack_can_manage_device(text) from public, anon, authenticated;

create or replace function public.ecotrack_device_room(p_value text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_room text; v_name text; v_count integer;
begin
  if p_value is null or btrim(p_value) in ('', 'unassigned') then return null; end if;
  if left(p_value, 7) <> 'custom:' then
    select id into v_room from public.rooms where id = p_value;
    if v_room is null then raise exception 'Selected room does not exist.'; end if;
    return v_room;
  end if;
  v_name := btrim(substr(p_value, 8));
  if length(v_name) not between 1 and 120 then raise exception 'A valid room name is required.'; end if;
  select count(*), min(id) into v_count, v_room from public.rooms where lower(btrim(name)) = lower(v_name);
  if v_count > 1 then raise exception 'Room name is ambiguous. Select an existing room ID.'; end if;
  if v_count = 1 then return v_room; end if;
  if public.ecotrack_is_admin() is not true then raise exception 'Only an administrator can create rooms.' using errcode = '42501'; end if;
  v_room := 'room_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.rooms(id, name, node_limit, created, updated) values (v_room, v_name, 10, now(), now());
  return v_room;
end;
$$;
revoke all on function public.ecotrack_device_room(text) from public, anon, authenticated;

create or replace function public.ecotrack_device_mutation(p_operation text, p_id text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_node public.nodes%rowtype;
  v_aircon public.aircons%rowtype;
  v_previous_node public.nodes%rowtype;
  v_exists boolean;
  v_room text;
  v_count integer;
  v_asset text;
  v_patch jsonb;
begin
  if auth.uid() is null or (public.ecotrack_is_admin() is not true and public.ecotrack_staff_id() is null) then
    raise exception 'An authorized account is required.' using errcode = '42501';
  end if;
  if p_id is null or length(btrim(p_id)) not between 1 and 160 or jsonb_typeof(p_payload) <> 'object' or p_payload is null then
    raise exception 'A valid identifier and object payload are required.';
  end if;
  if p_payload - array['name','room_id','aircon_type','brand','mac_address','ip_address','wifi_ssid','protocol_name','asset_tag','node_id','model','wake_time','sleep_time','interval_val','interval_unit'] <> '{}'::jsonb then
    raise exception 'Unsupported device fields. Telemetry and ownership cannot be changed here.';
  end if;
  -- Consistent lock ordering also covers room resolution and name-based legacy links.
  perform pg_advisory_xact_lock(hashtextextended('ecotrack_device_mutation', 0));

  if p_operation in ('save_node', 'update_node', 'delete_node') then
    select * into v_node from public.nodes where id = p_id for update;
    v_exists := found;
    if p_operation <> 'save_node' and not v_exists then raise exception 'Device no longer exists.'; end if;
    if v_exists and not public.ecotrack_can_manage_device(v_node.room_id) then
      raise exception 'Device access denied.' using errcode = '42501';
    end if;
    if v_exists and exists (select 1 from public.aircons where
      (controller_node_id = v_node.id or (controller_node_id is null and node_id in (v_node.id, v_node.name)))
      and not public.ecotrack_can_manage_device(room_id)) then
      raise exception 'A linked AC is outside your assigned room.' using errcode = '42501';
    end if;
    if v_exists and exists (select 1 from public.aircons a where a.controller_node_id is null
      and a.node_id in (v_node.id, v_node.name)
      and (select count(*) from public.nodes n where n.id = a.node_id or n.name = a.node_id) <> 1) then
      raise exception 'A legacy controller link is ambiguous. Resolve it before editing this device.';
    end if;
    if p_operation = 'delete_node' then
      -- Preserve AC inventory records, but remove both old and canonical links.
      update public.aircons set controller_node_id = null, node_id = null, status = 'offline', updated_at = now()
        where controller_node_id = v_node.id or (controller_node_id is null and node_id in (v_node.id, v_node.name));
      delete from public.nodes where id = v_node.id;
      return jsonb_build_object('deleted', true, 'id', v_node.id);
    end if;
    v_previous_node := v_node;
    if p_payload ? 'room_id' then v_room := public.ecotrack_device_room(p_payload->>'room_id');
    else v_room := v_node.room_id; end if;
    if not public.ecotrack_can_manage_device(v_room) then raise exception 'Room access denied.' using errcode = '42501'; end if;
    v_patch := (p_payload - array['asset_tag','node_id','model','room_id']) || jsonb_build_object('room_id', v_room);
    select * into v_node from jsonb_populate_record(v_node, v_patch);
    if v_node.name is null or length(btrim(v_node.name)) not between 1 and 120 then raise exception 'Device name is required.'; end if;
    v_node.name := btrim(v_node.name);
    if v_node.interval_val is not null and v_node.interval_val <= 0 then raise exception 'Telemetry interval must be positive.'; end if;
    if v_exists then
      update public.nodes set name = v_node.name, room_id = v_room, aircon_type = v_node.aircon_type,
        brand = v_node.brand, mac_address = v_node.mac_address, ip_address = v_node.ip_address,
        wifi_ssid = v_node.wifi_ssid, protocol_name = v_node.protocol_name,
        wake_time = v_node.wake_time, sleep_time = v_node.sleep_time,
        interval_val = v_node.interval_val, interval_unit = v_node.interval_unit, updated = now()
      where id = p_id returning * into v_node;
    else
      insert into public.nodes(id, name, room_id, aircon_type, brand, mac_address, ip_address, wifi_ssid, protocol_name, status, install_date)
      values (p_id, v_node.name, v_room, v_node.aircon_type, v_node.brand, v_node.mac_address, v_node.ip_address,
        v_node.wifi_ssid, v_node.protocol_name, 'offline', current_date::text) returning * into v_node;
    end if;
    update public.aircons set controller_node_id = v_node.id, node_id = v_node.name,
      room_id = v_room, brand = coalesce(nullif(v_node.brand, ''), 'Unspecified'),
      aircon_type = v_node.aircon_type, model = v_node.aircon_type,
      protocol = v_node.protocol_name, protocol_name = v_node.protocol_name, updated_at = now()
    where controller_node_id = v_node.id or
      (controller_node_id is null and node_id in (v_node.id, v_previous_node.name));
    if p_operation = 'save_node' then
      select count(*) into v_count from public.aircons where controller_node_id = v_node.id;
      if v_count > 1 then raise exception 'Multiple ACs reference this controller. Resolve the inventory before commissioning.'; end if;
      select * into v_aircon from public.aircons where controller_node_id = v_node.id;
      if not found then
        v_asset := coalesce(nullif(btrim(p_payload->>'asset_tag'), ''), 'AC-' || v_node.id);
        if exists(select 1 from public.aircons where asset_tag = v_asset) then
          raise exception 'AC asset tag is already registered. Edit that controller instead.';
        end if;
        insert into public.aircons(asset_tag, brand, model, aircon_type, room_id, node_id, controller_node_id, protocol, protocol_name, status)
        values (v_asset, coalesce(nullif(v_node.brand, ''), 'Unspecified'), v_node.aircon_type, v_node.aircon_type,
          v_room, v_node.name, v_node.id, v_node.protocol_name, v_node.protocol_name, 'offline') returning * into v_aircon;
      end if;
    end if;
    return jsonb_build_object('node', to_jsonb(v_node), 'aircon', to_jsonb(v_aircon));
  elsif p_operation in ('save_aircon', 'delete_aircon') then
    select count(*) into v_count from public.aircons where id = p_id or asset_tag = p_id;
    if v_count > 1 then raise exception 'AC identifier is ambiguous.'; end if;
    select * into v_aircon from public.aircons where id = p_id or asset_tag = p_id for update;
    v_exists := found;
    if v_exists and not public.ecotrack_can_manage_device(v_aircon.room_id) then
      raise exception 'AC access denied.' using errcode = '42501';
    end if;
    if p_operation = 'delete_aircon' then
      if not v_exists then raise exception 'AC no longer exists.'; end if;
      delete from public.aircons where id = v_aircon.id;
      -- The node remains a registered physical controller; no cascade deletion.
      return jsonb_build_object('deleted', true, 'id', v_aircon.id);
    end if;
    v_room := public.ecotrack_device_room(p_payload->>'room_id');
    if not public.ecotrack_can_manage_device(v_room) then raise exception 'Room access denied.' using errcode = '42501'; end if;
    if nullif(btrim(p_payload->>'brand'), '') is null then raise exception 'AC brand is required.'; end if;
    if nullif(btrim(p_payload->>'node_id'), '') is not null then
      select count(*) into v_count from public.nodes where id = p_payload->>'node_id' or name = p_payload->>'node_id';
      if v_count <> 1 then raise exception 'Select exactly one registered controller node.'; end if;
      select * into v_node from public.nodes where id = p_payload->>'node_id' or name = p_payload->>'node_id' for update;
      if not public.ecotrack_can_manage_device(v_node.room_id) then raise exception 'Controller access denied.' using errcode = '42501'; end if;
      if exists(select 1 from public.aircons where
        (controller_node_id = v_node.id or (controller_node_id is null and node_id in (v_node.id, v_node.name)))
        and id is distinct from v_aircon.id) then
        raise exception 'Controller is already assigned to another AC.';
      end if;
      update public.nodes set room_id = v_room, brand = btrim(p_payload->>'brand'), aircon_type = p_payload->>'aircon_type',
        protocol_name = p_payload->>'protocol_name', updated = now() where id = v_node.id returning * into v_node;
    end if;
    if v_exists then
      update public.aircons set brand = btrim(p_payload->>'brand'), model = p_payload->>'model',
        aircon_type = p_payload->>'aircon_type', room_id = v_room, node_id = v_node.name, controller_node_id = v_node.id,
        protocol = p_payload->>'protocol_name', protocol_name = p_payload->>'protocol_name', updated_at = now()
      where id = v_aircon.id returning * into v_aircon;
    else
      insert into public.aircons(asset_tag, brand, model, aircon_type, room_id, node_id, controller_node_id, protocol, protocol_name, status)
      values (p_id, btrim(p_payload->>'brand'), p_payload->>'model', p_payload->>'aircon_type', v_room, v_node.name, v_node.id,
        p_payload->>'protocol_name', p_payload->>'protocol_name', 'offline') returning * into v_aircon;
    end if;
    return jsonb_build_object('aircon', to_jsonb(v_aircon), 'node', to_jsonb(v_node));
  else
    raise exception 'Unknown device operation.';
  end if;
end;
$$;

revoke all on function public.ecotrack_device_mutation(text, text, jsonb) from public, anon;
grant execute on function public.ecotrack_device_mutation(text, text, jsonb) to authenticated;
-- Old public policies must not permit bypassing the atomic mutation boundary.
revoke insert, update, delete on public.nodes, public.aircons from public, anon, authenticated;

commit;

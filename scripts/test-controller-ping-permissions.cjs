'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
const colleague = '10000000-0000-4000-8000-000000000003';
const admin = '10000000-0000-4000-8000-000000000004';
const outsider = '10000000-0000-4000-8000-000000000005';
let db, legacyCommandProperties;

async function owner(sql, args = []) {
  await db.exec('reset role');
  return db.query(sql, args);
}
async function asUser(user, sql, args = []) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']);
  await db.query("select set_config('request.jwt.claim.session_id',$1,false)", [user || '']);
  await db.exec(user ? 'set role authenticated' : 'set role anon');
  return db.query(sql, args);
}
async function ping(user, node = 'node-one', id = randomUUID()) {
  const result = await asUser(user, 'select public.ecotrack_ping_controller($1::text,$2::uuid) as receipt', [node, id]);
  return result.rows[0].receipt;
}
async function command(user, kind) {
  return asUser(user, 'select public.ecotrack_cloud_request($1::text,$2::text,$3::jsonb,$4::uuid) as receipt',
    ['node-one', kind, {}, randomUUID()]);
}
async function refreshHeartbeat(node = 'node-one') {
  await owner('update public.ecotrack_device_state set last_seen=clock_timestamp(),sleeping_until=null where node_id=$1', [node]);
}

before(async () => {
  // Disposable PostgreSQL only: no live credentials, controllers, or network calls.
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth;
    create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz not null default clock_timestamp());
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true)) $$;
    create table public.rooms(id text primary key,name text);
    create table public.staff(id text primary key,auth_user_id uuid,room_id text,status text default 'active',
      is_archived boolean not null default false,force_logout boolean not null default false,
      auth_valid_after timestamptz not null default '-infinity');
    create table public.administrators(auth_user_id uuid,is_archived boolean not null default false,
      is_active boolean not null default true,auth_valid_after timestamptz not null default '-infinity');
    create table public.nodes(id text primary key,name text,room_id text references public.rooms(id));
    create table public.ecotrack_device_state(node_id text primary key references public.nodes(id),
      device_id text,last_seen timestamptz,sleeping_until timestamptz,rssi integer);
    create table public.ecotrack_device_commands(
      id uuid primary key default gen_random_uuid(),node_id text not null references public.nodes(id),
      kind text not null check(kind in ('ping','learn_ir','configure','ac_intent')),
      payload jsonb not null default '{}',status text not null default 'queued',created_by uuid not null,
      created_at timestamptz not null default now(),expires_at timestamptz not null,
      claimed_at timestamptz,acknowledged_at timestamptz,result jsonb);
    insert into public.rooms values('room-one','Room 1'),('room-two','Room 2'),('ALL','All Rooms'),('all_rooms','All Rooms Legacy');
    insert into public.nodes values('node-one','Controller 1','room-one'),('node-peer','Controller Peer','room-one'),
      ('node-two','Controller 2','room-two'),('node-unassigned','Unassigned Controller',null),
      ('node-broad','Broad Scope Controller','ALL'),('node-broad-legacy','Legacy Broad Scope Controller','all_rooms');
    insert into public.ecotrack_device_state(node_id,device_id,last_seen,rssi)
      select id,'esp32s3-'||lpad(row_number() over(order by id)::text,12,'0'),clock_timestamp(),-63 from public.nodes;
    insert into public.staff(id,auth_user_id,room_id) values('alice','${alice}','room-one'),('bob','${bob}','room-two'),
      ('colleague','${colleague}','room-one');
    insert into public.administrators(auth_user_id) values('${admin}');
    insert into auth.sessions(id,user_id) values('${alice}','${alice}'),('${bob}','${bob}'),
      ('${colleague}','${colleague}'),('${admin}','${admin}'),('${outsider}','${outsider}');
  `);
  // Use the actual account/session helpers, including forced-logout session cutoffs.
  const authSql = fs.readFileSync('supabase/migrations/202609300001_auth_authorization.sql', 'utf8');
  for (const name of ['ecotrack_session_valid', 'ecotrack_staff_id', 'ecotrack_is_admin', 'ecotrack_can_access_room']) {
    const definition = authSql.match(new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\$\\$;', 'i'));
    assert.ok(definition, 'Actual authorization helper must exist: ' + name);
    await db.exec(definition[0]);
  }
  await db.exec(`
    grant usage on schema public,auth to authenticated,anon;
    grant select on public.rooms,public.staff,public.nodes,public.ecotrack_device_state,public.ecotrack_device_commands to authenticated;
    alter table public.rooms enable row level security;
    alter table public.staff enable row level security;
    alter table public.nodes enable row level security;
    alter table public.ecotrack_device_state enable row level security;
    alter table public.ecotrack_device_commands enable row level security;
    create policy room_read on public.rooms for select to authenticated using(public.ecotrack_can_access_room(id));
    create policy staff_read on public.staff for select to authenticated using(id=public.ecotrack_staff_id() or public.ecotrack_is_admin());
    create policy node_read on public.nodes for select to authenticated using(public.ecotrack_can_access_room(room_id));
    create policy ecotrack_device_state_admin_read on public.ecotrack_device_state for select to authenticated using(public.ecotrack_is_admin());
    create policy ecotrack_device_commands_admin_read on public.ecotrack_device_commands for select to authenticated using(public.ecotrack_is_admin());
    -- Existing command guard fixture: the new migration must leave its definition unchanged.
    create function public.ecotrack_cloud_request(p_node_id text,p_kind text,p_payload jsonb,p_request_id uuid)
      returns jsonb language plpgsql security definer set search_path='' as $$
    declare queued public.ecotrack_device_commands%rowtype;
    begin
      if auth.uid() is null or not public.ecotrack_is_admin() then
        raise exception 'Administrator required' using errcode='42501';
      end if;
      insert into public.ecotrack_device_commands(id,node_id,kind,payload,created_by,expires_at)
        values(p_request_id,p_node_id,p_kind,p_payload,auth.uid(),clock_timestamp()+interval '20 seconds') returning * into queued;
      return to_jsonb(queued);
    end $$;
    revoke all on function public.ecotrack_cloud_request(text,text,jsonb,uuid) from public,anon;
    grant execute on function public.ecotrack_cloud_request(text,text,jsonb,uuid) to authenticated;
  `);
  legacyCommandProperties = (await db.query("select oid,prosrc,prosecdef,proconfig,proowner from pg_proc where oid='public.ecotrack_cloud_request(text,text,jsonb,uuid)'::regprocedure")).rows[0];
  await db.exec(fs.readFileSync('supabase/migrations/202610110001_assigned_staff_hardware_read.sql', 'utf8'));
  const migration = fs.readFileSync('supabase/migrations/202610170001_assigned_staff_controller_ping.sql', 'utf8');
  await db.exec(migration);
  await db.exec(migration);
});
after(async () => { await db?.close(); });

test('active staff queues only an empty ping in their assigned room and receives the real command identity', async () => {
  await refreshHeartbeat();
  const heartbeat = (await owner("select * from public.ecotrack_device_state where node_id='node-one'")).rows[0];
  const id = randomUUID(), receipt = await ping(alice, 'node-one', id);
  assert.equal(receipt.id, id); assert.equal(receipt.node_id, 'node-one'); assert.equal(receipt.kind, 'ping');
  assert.deepEqual(receipt.payload, {}); assert.equal(receipt.created_by, alice); assert.equal(receipt.status, 'queued');
  assert.equal(receipt.result, null); assert.equal(receipt.acknowledged_at, null);
  const lifetime = Date.parse(receipt.expires_at) - Date.parse(receipt.created_at);
  assert.ok(lifetime >= 19000 && lifetime <= 21000);
  assert.deepEqual((await owner("select * from public.ecotrack_device_state where node_id='node-one'")).rows[0], heartbeat);
});

test('staff can poll their own ping and its acknowledgement but cannot read another same-room caller or a control command', async () => {
  const receipt = await ping(alice);
  assert.equal((await asUser(alice, 'select status from public.ecotrack_device_commands where id=$1', [receipt.id])).rows[0].status, 'queued');
  assert.equal((await asUser(colleague, 'select * from public.ecotrack_device_commands where id=$1', [receipt.id])).rows.length, 0);
  assert.equal((await asUser(bob, 'select * from public.ecotrack_device_commands where id=$1', [receipt.id])).rows.length, 0);
  const ack = { success: true, command_id: receipt.id, rssi: -63 };
  await owner("update public.ecotrack_device_commands set status='completed',result=$2::jsonb,acknowledged_at=clock_timestamp() where id=$1", [receipt.id, ack]);
  assert.deepEqual((await asUser(alice, 'select result from public.ecotrack_device_commands where id=$1', [receipt.id])).rows[0].result, ack);
  const hidden = randomUUID();
  await owner("insert into public.ecotrack_device_commands(id,node_id,kind,created_by,expires_at) values($1,'node-one','configure',$2,clock_timestamp()+interval '1 minute')", [hidden, alice]);
  assert.equal((await asUser(alice, 'select * from public.ecotrack_device_commands where id=$1', [hidden])).rows.length, 0);
});

test('anonymous, unlinked, unassigned, cross-room and nonexistent-controller requests are denied', async () => {
  for (const [user, node] of [[null, 'node-one'], [outsider, 'node-one'], [alice, 'node-two'], [bob, 'node-one'], [alice, 'node-unassigned'], [alice, 'missing-node']]) {
    await assert.rejects(ping(user, node), error => error.code === '42501');
  }
  await owner("update public.staff set room_id=null where id='alice'");
  try { await assert.rejects(ping(alice), error => error.code === '42501'); }
  finally { await owner("update public.staff set room_id='room-one' where id='alice'"); }
});

test('legacy broad room tokens cannot authorize diagnostic commands even when matching a node room', async () => {
  for (const [room, node] of [['ALL', 'node-broad'], ['all_rooms', 'node-broad-legacy']]) {
    await owner("update public.staff set room_id=$1 where id='alice'", [room]);
    try { await assert.rejects(ping(alice, node), error => error.code === '42501'); }
    finally { await owner("update public.staff set room_id='room-one' where id='alice'"); }
  }
});

test('archived, disabled, forced-logout and revoked-session staff cannot queue or poll pings', async () => {
  const receipt = await ping(alice);
  for (const mutation of ['is_archived=true', 'force_logout=true', "status='disabled'", "auth_valid_after=clock_timestamp()+interval '1 hour'"]) {
    await owner("update public.staff set " + mutation + " where id='alice'");
    try {
      await assert.rejects(ping(alice), error => error.code === '42501');
      assert.equal((await asUser(alice, 'select * from public.ecotrack_device_commands where id=$1', [receipt.id])).rows.length, 0);
    } finally {
      await owner("update public.staff set is_archived=false,force_logout=false,status='active',auth_valid_after='-infinity' where id='alice'");
    }
  }
});

test('room reassignment immediately revokes old ping reads and queue access', async () => {
  const receipt = await ping(alice);
  await owner("update public.staff set room_id='room-two' where id='alice'");
  try {
    assert.equal((await asUser(alice, 'select * from public.ecotrack_device_commands where id=$1', [receipt.id])).rows.length, 0);
    await assert.rejects(ping(alice), error => error.code === '42501');
    await refreshHeartbeat('node-two');
    assert.equal((await ping(alice, 'node-two')).node_id, 'node-two');
  } finally { await owner("update public.staff set room_id='room-one' where id='alice'"); }
  await owner("update public.nodes set room_id='room-two' where id='node-one'");
  try {
    assert.equal((await asUser(alice, 'select * from public.ecotrack_device_commands where id=$1', [receipt.id])).rows.length, 0);
    await assert.rejects(ping(alice), error => error.code === '42501');
  } finally { await owner("update public.nodes set room_id='room-one' where id='node-one'"); }
});

test('request IDs are idempotent only for the same caller, controller, empty payload and ping kind', async () => {
  const id = randomUUID(), receipt = await ping(alice, 'node-one', id);
  assert.deepEqual(await ping(alice, 'node-one', id), receipt);
  assert.equal((await owner('select count(*)::integer as count from public.ecotrack_device_commands where id=$1', [id])).rows[0].count, 1);
  await assert.rejects(ping(colleague, 'node-one', id), error => error.code === '42501');
  await assert.rejects(ping(alice, 'node-peer', id), error => error.code === '42501');
  for (const [kind, payload] of [['configure', {}], ['ping', { aircon_id: 'unexpected-control-payload' }]]) {
    const conflict = randomUUID();
    await owner("insert into public.ecotrack_device_commands(id,node_id,kind,payload,created_by,expires_at) values($1,'node-one',$2,$3,$4,clock_timestamp()+interval '1 minute')", [conflict, kind, payload, alice]);
    await assert.rejects(ping(alice, 'node-one', conflict), error => error.code === '42501');
  }
});

test('sleeping, stale and future-clock heartbeats cannot queue a new ping', async () => {
  for (const [mutation, message] of [
    ["sleeping_until=clock_timestamp()+interval '1 minute'", /sleeping/],
    ["last_seen=clock_timestamp()-interval '46 seconds'", /fresh heartbeat/],
    ["last_seen=clock_timestamp()+interval '6 seconds'", /fresh heartbeat/],
    ['last_seen=null', /fresh heartbeat/],
  ]) {
    await refreshHeartbeat();
    await owner("update public.ecotrack_device_state set " + mutation + " where node_id='node-one'");
    const id = randomUUID();
    await assert.rejects(ping(alice, 'node-one', id), message);
    assert.equal((await owner('select id from public.ecotrack_device_commands where id=$1', [id])).rows.length, 0);
  }
  await refreshHeartbeat();
  await assert.rejects(ping(alice, 'node-one', null), error => error.code === '22023');
  await assert.rejects(ping(alice, ''), error => error.code === '22023');
});

test('staff cannot acknowledge commands, alter hardware state, or bypass the existing admin command guard', async () => {
  const receipt = await ping(alice);
  await assert.rejects(asUser(alice, "update public.ecotrack_device_commands set status='completed',result='{}' where id=$1", [receipt.id]), error => error.code === '42501');
  await assert.rejects(asUser(alice, 'delete from public.ecotrack_device_commands where id=$1', [receipt.id]), error => error.code === '42501');
  await assert.rejects(asUser(alice, "insert into public.ecotrack_device_commands(node_id,kind,created_by,expires_at) values('node-one','ping',$1,clock_timestamp()+interval '20 seconds')", [alice]), error => error.code === '42501');
  await assert.rejects(asUser(alice, "update public.ecotrack_device_state set last_seen=clock_timestamp() where node_id='node-one'"), error => error.code === '42501');
  for (const kind of ['configure', 'learn_ir', 'ac_intent']) await assert.rejects(command(alice, kind), error => error.code === '42501');
  for (const user of [alice, admin, null]) await assert.rejects(asUser(user,
    "select ecotrack_private.ecotrack_admin_cloud_request('node-one','configure','{}',$1::uuid)", [randomUUID()]), error => error.code === '42501');
  const unchanged = (await owner("select oid,prosrc,prosecdef,proconfig,proowner from pg_proc where oid='ecotrack_private.ecotrack_admin_cloud_request(text,text,jsonb,uuid)'::regprocedure")).rows[0];
  assert.deepEqual(unchanged, legacyCommandProperties);
});

test('already installed clients can ping through the old endpoint, while arbitrary payloads and foreign rooms remain denied', async () => {
  const receipt = (await command(alice, 'ping')).rows[0].receipt;
  assert.equal(receipt.kind, 'ping'); assert.equal(receipt.node_id, 'node-one'); assert.equal(receipt.created_by, alice);
  assert.equal(receipt.status, 'queued'); assert.equal(receipt.result, null); assert.deepEqual(receipt.payload, {});
  assert.equal((await asUser(alice, 'select id from public.ecotrack_device_commands where id=$1', [receipt.id])).rows[0].id, receipt.id);
  await assert.rejects(command(bob, 'ping'), error => error.code === '42501');
  await assert.rejects(command(null, 'ping'), error => error.code === '42501');
  for (const payload of [{ state: { power: 'on' } }, { aircon_id: 'ac-one' }, [], null]) {
    await assert.rejects(asUser(alice,
      "select public.ecotrack_cloud_request('node-one','ping',$1::jsonb,$2::uuid)", [payload, randomUUID()]), error => error.code === '22023');
  }
});

test('active administrators retain campus-wide diagnostics and every existing command permission', async () => {
  for (const node of ['node-one', 'node-two', 'node-unassigned']) {
    await refreshHeartbeat(node);
    assert.equal((await ping(admin, node)).node_id, node);
  }
  for (const kind of ['configure', 'learn_ir', 'ac_intent']) assert.equal((await command(admin, kind)).rows[0].receipt.kind, kind);
  const active = await ping(admin);
  assert.equal((await asUser(admin, 'select id from public.ecotrack_device_commands where id=$1', [active.id])).rows.length, 1);
  await owner('update public.administrators set is_active=false');
  try { await assert.rejects(ping(admin), error => error.code === '42501'); }
  finally { await owner('update public.administrators set is_active=true'); }
});

const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');let db;
const alice='00000000-0000-4000-8000-000000000001',bob='00000000-0000-4000-8000-000000000002',admin='00000000-0000-4000-8000-000000000003',outsider='00000000-0000-4000-8000-000000000004';
before(async()=>{
 db=new PGlite();await db.exec("\n CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE SCHEMA auth;\n CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;\n CREATE TABLE public.staff(id text primary key,auth_user_id uuid,room_id text,is_archived boolean default false,force_logout boolean default false,status text default 'active');\n CREATE TABLE public.administrators(auth_user_id uuid,is_active boolean default true);\n CREATE TABLE public.nodes(id text primary key,room_id text);\n CREATE TABLE public.ecotrack_device_state(node_id text primary key references public.nodes(id),device_id text,last_seen timestamptz,latest_ir jsonb);\n CREATE TABLE public.ecotrack_device_commands(id text primary key,node_id text);\n CREATE FUNCTION public.ecotrack_staff_id() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT s.id FROM public.staff s WHERE s.auth_user_id=auth.uid() AND NOT s.is_archived AND NOT s.force_logout AND lower(s.status) NOT IN ('archived','deactivated','disabled') LIMIT 1 $$;\n CREATE FUNCTION public.ecotrack_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.administrators a WHERE a.auth_user_id=auth.uid() AND a.is_active) $$;\n CREATE FUNCTION public.ecotrack_can_access_room(p_room_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT auth.uid() IS NOT NULL AND (public.ecotrack_is_admin() OR EXISTS(SELECT 1 FROM public.staff s WHERE s.id=public.ecotrack_staff_id() AND s.room_id=p_room_id)) $$;\n ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;\n ALTER TABLE public.ecotrack_device_state ENABLE ROW LEVEL SECURITY;\n ALTER TABLE public.ecotrack_device_commands ENABLE ROW LEVEL SECURITY;\n GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;\n GRANT SELECT ON public.nodes,public.ecotrack_device_state,public.ecotrack_device_commands TO authenticated;\n CREATE POLICY node_read ON public.nodes FOR SELECT TO authenticated USING(public.ecotrack_can_access_room(room_id));\n CREATE POLICY ecotrack_device_state_admin_read ON public.ecotrack_device_state FOR SELECT TO authenticated USING(public.ecotrack_is_admin());\n CREATE POLICY ecotrack_device_commands_admin_read ON public.ecotrack_device_commands FOR SELECT TO authenticated USING(public.ecotrack_is_admin());\n INSERT INTO public.staff VALUES('s1','00000000-0000-4000-8000-000000000001','r1',false,false,'active'),('s2','00000000-0000-4000-8000-000000000002','r2',false,false,'active');\n INSERT INTO public.administrators VALUES('00000000-0000-4000-8000-000000000003',true);\n INSERT INTO public.nodes VALUES('n1','r1'),('n2','r2'),('n3',null);\n INSERT INTO public.ecotrack_device_state VALUES('n1','esp32s3-111111111111',now(),'{\"state\":{\"power\":false}}'),('n2','esp32s3-222222222222',now(),'{}'),('n3','esp32s3-333333333333',now(),'{}');\n INSERT INTO public.ecotrack_device_commands VALUES('command1','n1');\n");
 const sql=fs.readFileSync('supabase/migrations/202610110001_assigned_staff_hardware_read.sql','utf8');
 await db.exec(sql);await db.exec(sql);
});
after(async()=>db.close());
async function owner(sql){await db.exec('reset role');return db.exec(sql);}
async function asUser(id,sql){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec(id?'set role authenticated':'set role anon');return db.query(sql);}
test('staff sees only current-room hardware, including heartbeat and remote OFF',async()=>{
 const a=await asUser(alice,'select * from public.ecotrack_device_state order by node_id');
 assert.deepEqual(a.rows.map(x=>x.node_id),['n1']);assert.equal(a.rows[0].latest_ir.state.power,false);assert.ok(a.rows[0].last_seen);
 assert.deepEqual((await asUser(bob,'select node_id from public.ecotrack_device_state')).rows.map(x=>x.node_id),['n2']);
});
test('cross-room direct reads and unlinked accounts return no status',async()=>{
 assert.equal((await asUser(alice,"select * from public.ecotrack_device_state where node_id='n2'")).rows.length,0);
 assert.equal((await asUser(outsider,'select * from public.ecotrack_device_state')).rows.length,0);
});
test('admin keeps all reads and anonymous users are denied',async()=>{
 assert.equal((await asUser(admin,'select * from public.ecotrack_device_state')).rows.length,3);
 await assert.rejects(asUser(null,'select * from public.ecotrack_device_state'),e=>e.code==='42501');
});
test('reassignment immediately revokes old room and allows new room',async()=>{
 await owner("update public.staff set room_id='r2' where id='s1'");
 assert.deepEqual((await asUser(alice,'select node_id from public.ecotrack_device_state')).rows.map(x=>x.node_id),['n2']);
 await owner("update public.staff set room_id='r1' where id='s1'");
});
test('unassigned, archived, forced-logout and disabled staff cannot read status',async()=>{
 for(const update of ["room_id=null","is_archived=true","force_logout=true","status='disabled'"]){
  await owner("update public.staff set "+update+" where id='s1'");
  assert.equal((await asUser(alice,'select * from public.ecotrack_device_state')).rows.length,0);
  await owner("update public.staff set room_id='r1',is_archived=false,force_logout=false,status='active' where id='s1'");
 }
});
test('status stays read-only and commands stay administrator-only',async()=>{
 await assert.rejects(asUser(alice,"update public.ecotrack_device_state set last_seen=now() where node_id='n1'"),e=>e.code==='42501');
 await assert.rejects(asUser(alice,"insert into public.ecotrack_device_commands values('bad','n1')"),e=>e.code==='42501');
 assert.equal((await asUser(alice,'select * from public.ecotrack_device_commands')).rows.length,0);
 assert.equal((await asUser(admin,'select * from public.ecotrack_device_commands')).rows.length,1);
});

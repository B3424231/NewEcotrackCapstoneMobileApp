'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const mobile = process.env.ECOTRACK_MOBILE_ROOT || path.resolve(__dirname, '..');
const desktop = process.env.ECOTRACK_DESKTOP_ROOT || path.resolve(mobile, '..', 'EcoTrackDesktopDashboardNew-main-control');
const { PGlite } = require(path.join(mobile, 'node_modules/@electric-sql/pglite'));
const admin = '11111111-1111-4111-8111-111111111111', alice = '22222222-2222-4222-8222-222222222222', bob = '33333333-3333-4333-8333-333333333333', outsider = '44444444-4444-4444-8444-444444444444';
let db;
const frame = { protocol: 'DAIKIN216', raw_data: '3500,1750,450,1300', raw_count: 4, state: { power: false, temp: 23 } };
function migration(root, relative, overlay) {
 const staged = overlay && path.join(overlay, relative);
 return fs.readFileSync(staged && fs.existsSync(staged) ? staged : path.join(root, relative), 'utf8').replace(/^\uFEFF/, '');
}
async function owner(sql, args=[]) { await db.exec('reset role'); return db.query(sql,args); }
async function asUser(id,sql,args=[]) {
 await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id || '']);
 await db.exec(id ? 'set role authenticated' : 'set role anon'); return db.query(sql,args);
}
async function rpc(id,name,args,casts) {
 return (await asUser(id,`select public.${name}(${args.map((_,i)=>'$'+(i+1)+'::'+casts[i]).join(',')}) as result`,args)).rows[0].result;
}
const save = (user, ac, name='POWER_OFF', capture=frame) => rpc(user,'ecotrack_save_ir_code',[ac,name,capture,'mobile'],['text','text','jsonb','text']);
before(async()=>{
 db = new PGlite();
 await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;
 CREATE TABLE public.staff(id text primary key,auth_user_id uuid,room_id text,status text default 'active',is_archived boolean default false,force_logout boolean default false);
 CREATE TABLE public.administrators(auth_user_id uuid,is_active boolean default true);
 CREATE FUNCTION public.ecotrack_staff_id() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT id FROM public.staff WHERE auth_user_id=auth.uid() AND status='active' AND NOT is_archived AND NOT force_logout $$;
 CREATE FUNCTION public.ecotrack_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.administrators WHERE auth_user_id=auth.uid() AND is_active) $$;
 CREATE TABLE public.rooms(id text primary key,name text);
 CREATE FUNCTION public.ecotrack_can_access_room(p_room_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.ecotrack_is_admin() OR EXISTS(SELECT 1 FROM public.staff s WHERE s.id=public.ecotrack_staff_id() AND s.room_id=p_room_id) $$;
 CREATE TABLE public.nodes(id text primary key default ('node_'||gen_random_uuid()),name text unique not null,status text default 'offline',room_id text references public.rooms(id),brand text,aircon_type text,protocol_name text,temp numeric,rssi numeric,battery numeric,ip_address text,wifi_ssid text,wake_time text,sleep_time text,interval_val integer,interval_unit text,created timestamptz default now(),updated timestamptz default now());
 CREATE TABLE public.aircons(id text primary key default gen_random_uuid()::text,asset_tag text unique,brand text,model text,aircon_type text,room_id text,node_id text,controller_node_id text,protocol text,protocol_name text,status text,desired_state jsonb,command_id uuid,command_status text,command_status_at timestamptz,commanded_at timestamptz,reported_state jsonb,reported_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
 CREATE TABLE public.telemetry(id text primary key,node_id text,sensor_name text,room_name text,aircon_type text,temperature numeric,pressure numeric,battery numeric,rssi numeric,status text,created timestamptz,interval_seconds numeric,ac_on boolean);
 GRANT SELECT ON public.aircons,public.nodes TO authenticated;
 ALTER TABLE public.aircons ENABLE ROW LEVEL SECURITY;
 CREATE POLICY aircon_read ON public.aircons FOR SELECT TO authenticated USING(public.ecotrack_can_access_room(room_id));
 INSERT INTO public.rooms VALUES('r1','Room One'),('r2','Room Two');
 INSERT INTO public.staff(id,auth_user_id,room_id) VALUES('s1','${alice}','r1'),('s2','${bob}','r2');
 INSERT INTO public.administrators VALUES('${admin}',true);
 INSERT INTO public.aircons(id,asset_tag,room_id,brand,protocol_name) VALUES('ac-one','AC One','r1','Daikin','DAIKIN216'),('ac-two','AC Two','r2','Daikin','DAIKIN216');
 `);
 for(const file of ['supabase_cloud_hardware_migration.sql','supabase_controller_registration_migration.sql','supabase_controller_details_migration.sql','supabase_aircon_names_migration.sql'])
  await db.exec(migration(desktop,file,process.env.ECOTRACK_DESKTOP_OVERLAY));
 await db.exec(migration(mobile,'supabase/optional-migrations/202610140001_staff_controller_registration.sql',process.env.ECOTRACK_MOBILE_OVERLAY));
 const sql=migration(desktop,'supabase_ir_code_sync_migration.sql',process.env.ECOTRACK_DESKTOP_OVERLAY);
 await db.exec(sql); await db.exec(sql);
});
after(async()=>{ await db?.close(); });

test('staff saves and reads actual codes only in their assigned room; admin reads both rooms',async()=>{
 const one=await save(alice,'ac-one'), two=await save(bob,'ac-two');
 assert.equal(one.raw_data,frame.raw_data); assert.equal(one.protocol,'DAIKIN216');
 assert.deepEqual((await asUser(alice,'select aircon_id from public.ecotrack_ir_codes')).rows.map(row=>row.aircon_id),['ac-one']);
 assert.deepEqual((await asUser(bob,'select aircon_id from public.ecotrack_ir_codes')).rows.map(row=>row.aircon_id),['ac-two']);
 assert.equal((await asUser(admin,'select * from public.ecotrack_ir_codes')).rows.length,2);
 await assert.rejects(save(alice,'ac-two'),error=>error.code==='42501');
 assert.equal(two.aircon_id,'ac-two');
});
test('anonymous, unlinked, archived and forced-logout accounts cannot write or read saved codes',async()=>{
 await assert.rejects(save(null,'ac-one'),error=>error.code==='42501');
 await assert.rejects(save(outsider,'ac-one'),error=>error.code==='42501');
 assert.equal((await asUser(outsider,'select * from public.ecotrack_ir_codes')).rows.length,0);
 await assert.rejects(asUser(null,'select * from public.ecotrack_ir_codes'),error=>error.code==='42501');
 for(const flag of ['is_archived=true','force_logout=true',"status='disabled'"]){
  await owner('update public.staff set '+flag+" where id='s1'");
  await assert.rejects(save(alice,'ac-one'),error=>error.code==='42501');
  assert.equal((await asUser(alice,'select * from public.ecotrack_ir_codes')).rows.length,0);
  await owner("update public.staff set is_archived=false,force_logout=false,status='active' where id='s1'");
 }
});
test('direct table writes cannot bypass capture validation or access checks',async()=>{
 await assert.rejects(asUser(admin,"update public.ecotrack_ir_codes set raw_data='fake'"),error=>error.code==='42501');
 await assert.rejects(asUser(alice,'select public.ecotrack_can_write_ir_code($1)',['ac-one']),error=>error.code==='42501');
});
test('named-code replacement retains identity and creator; invalid timings leave the saved code intact',async()=>{
 const before=await save(alice,'ac-one','POWER_OFF');
 const after=await save(admin,'ac-one','POWER_OFF',{...frame,raw_data:'4000,2000,500'});
 assert.equal(before.id,after.id); assert.equal(after.created_by,alice); assert.equal(after.updated_by,admin);
 for(const raw_data of ['', '0,1,1', '1,1', '1000001,1,1', '1,-2,3']) await assert.rejects(save(alice,'ac-one','POWER_OFF',{...frame,raw_data}));
 assert.equal((await asUser(alice,"select raw_data from public.ecotrack_ir_codes where id=$1",[after.id])).rows[0].raw_data,'4000,2000,500');
});
test('reassignment revokes old-room codes without moving or deleting stored data',async()=>{
 await owner("update public.staff set room_id='r2' where id='s1'");
 try {
 assert.deepEqual((await asUser(alice,'select aircon_id from public.ecotrack_ir_codes')).rows.map(row=>row.aircon_id),['ac-two']);
 await assert.rejects(save(alice,'ac-one'),error=>error.code==='42501');
 } finally { await owner("update public.staff set room_id='r1' where id='s1'"); }
});
test('the real registration finalizer saves profile and capture in one transaction for assigned staff',async()=>{
 const device='esp32s3-001122334455';
 const prepared=await rpc(alice,'ecotrack_prepare_controller_registration',[device],['text']);
 const node=prepared.node.id;
 await owner('update public.ecotrack_device_state set last_seen=clock_timestamp() where node_id=$1',[node]);
 const setup={controller_name:'Registered from mobile',assignment_mode:'new',asset_tag:'New AC',aircon_name:'New AC',room_id:'r1',brand:'Daikin',aircon_type:'Split',protocol_name:'DAIKIN216'};
 const saved=await rpc(alice,'ecotrack_finish_controller_registration_with_ir',[node,device,setup,frame],['text','text','jsonb','jsonb']);
 assert.equal(saved.ir_code.command_type,'REMOTE_CAPTURE'); assert.equal(saved.ir_code.aircon_id,saved.aircon.id);
 assert.equal(saved.aircon.protocol_name,'DAIKIN216'); assert.equal(saved.node.protocol_name,'DAIKIN216');
 assert.equal(saved.ir_code.raw_data,frame.raw_data);
 const before=copyResult(saved);
 await assert.rejects(rpc(alice,'ecotrack_finish_controller_registration_with_ir',[node,device,{...setup,controller_name:'Must roll back'}, {...frame,raw_data:'invalid'}],['text','text','jsonb','jsonb']),/captured IR timings/);
 assert.equal((await owner('select name from public.nodes where id=$1',[node])).rows[0].name,before.node.name);
 assert.equal((await owner('select count(*)::integer as count from public.ecotrack_ir_codes where aircon_id=$1',[saved.aircon.id])).rows[0].count,1);
});
function copyResult(value){return JSON.parse(JSON.stringify(value));}
test('registration cannot save a capture against a different selected protocol',async()=>{
 await assert.rejects(rpc(alice,'ecotrack_finish_controller_registration_with_ir',['missing','esp32s3-001122334455',{protocol_name:'DAIKIN64'},frame],['text','text','jsonb','jsonb']),/differs/);
});
test('foreign-room deletion is denied and authorized deletion is confirmed',async()=>{
 await assert.rejects(rpc(alice,'ecotrack_delete_ir_code',['ac-two','POWER_OFF'],['text','text']),error=>error.code==='42501');
 const saved=await save(alice,'ac-one','TEMP_UP');
 const deleted=await rpc(alice,'ecotrack_delete_ir_code',['ac-one','TEMP_UP'],['text','text']);
 assert.equal(deleted.id,saved.id); assert.equal(deleted.deleted,true);
 assert.equal((await rpc(alice,'ecotrack_delete_ir_code',['ac-one','TEMP_UP'],['text','text'])).deleted,false);
});

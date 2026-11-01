const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const prefix=fs.readFileSync('scripts/test-backend.cjs','utf8').split('const service = h =>')[0];
const harness=vm.runInNewContext(prefix+';harness;',{require,console,process,Response,Blob,URL,Date,Uint8Array,ArrayBuffer,setTimeout,clearTimeout});
const observed=new Date(Date.now()-5000).toISOString();
function fixture(extra={}){return {nodes:[{id:'controller-real',name:'Renamed controller',room_id:'r1',temp:0,rotation_rpm:0,rotation_quality:'ok',last_measurement_at:observed,updated:new Date().toISOString(),device_mode:'both',monitor_aircon_id:'aircon-real',...extra}],aircons:[{id:'aircon-real',name:'Renamed AC',room_id:'r1',controller_node_id:'controller-real'}],rooms:[{id:'r1',name:'Lab'}],maintenance_reports:[{id:'maintenance-real',aircon_id:'aircon-real',aircon_name:'Previous AC name',status:'In Progress',priority:'High'}]};}
function setup(data){const h=harness(call=>({data:(data[call.table]||[]).filter(row=>call.ops.filter(op=>op[0]==='eq').every(op=>row[op[1]]===op[2])),error:null}));return {h,svc:h.load('src/services/supabase.ts')};}

test('cold mobile home uses persistent measurement time and exact linked AC maintenance ID',async()=>{
 const {svc}=setup(fixture());const rows=await svc.fetchLiveSensors('r1');
 assert.equal(rows.length,1);assert.equal(rows[0].measurementAt,observed);assert.equal(rows[0].ventTemp,'0.0 °C');assert.equal(rows[0].rotation_rpm,0);
 assert.equal(rows[0].activeReportId,'maintenance-real');assert.equal(rows[0].maintenancePriority,'High');
});
test('current readings survive an empty archived telemetry queue without querying the queue',async()=>{
 const {svc,h}=setup(fixture());const rows=await svc.fetchLiveSensorReadings(['controller-real'],{'controller-real':'aircon-real'});
 assert.equal(rows[0].measurement_at,observed);assert.equal(rows[0].temp,0);assert.equal(rows[0].rotation_quality,'ok');
 assert.equal(h.calls.some(call=>call.table==='telemetry'),false);
});
test('a newly persisted missing or faulty sample clears prior usable values',async()=>{
 const {svc,h}=setup(fixture({temp:null,rotation_rpm:null,rotation_quality:'fault'}));
 const rows=await svc.fetchLiveSensorReadings(['controller-real']);
 const apply=h.load('src/services/home-controller-state.ts').applyHomeControllerState;
 const item={id:'controller-real',name:'Device',status:'optimal',measurementAt:new Date(Date.parse(observed)-5000).toISOString(),ventTemp:'21.0 °C',rotation_rpm:800};
 const value=apply(item,rows[0]);assert.equal(value.ventTemp,'—');assert.equal(value.rotation_rpm,null);assert.equal(value.measurementAt,observed);
});
test('matching names cannot attach another AC maintenance report to a linked device',async()=>{
 const data=fixture();data.maintenance_reports=[{id:'foreign',aircon_id:'another-ac',aircon_name:'Renamed controller',status:'In Progress'}];
 assert.equal((await setup(data).svc.fetchLiveSensors('r1'))[0].activeReportId,undefined);
});

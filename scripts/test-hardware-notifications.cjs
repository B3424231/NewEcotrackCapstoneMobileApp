const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript');
const desktop=process.env.ECOTRACK_DESKTOP_ROOT || path.resolve(__dirname,'../../EcoTrackDesktopDashboardNew-main-control');
const source=fs.readFileSync(path.join(desktop,'public/js/global-notifications.js'),'utf8');
function fixture(hour=23,minute=30){
 let now=new Date(2026,9,14,hour,minute).getTime();
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const store=new Map(),writes=[],shown=[];let hardware=[];let failure=false;let reads=0;
 const node={id:'node-one',name:'AC-Controller-1',room_id:'room-one',wake_time:'06:00',sleep_time:'22:00',temp:30,battery:3.8};
 const context={Date:Clock,console:{log(){},warn(){},error(){}},AbortController,
   localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
   document:{addEventListener(){},getElementById:()=>null,querySelector:()=>null},
   setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
   addEventListener(){},dispatchEvent(){},CustomEvent:class{constructor(name,value){this.type=name;this.detail=value?.detail;}}};
 const client={from(table){let insert=null;const query={select(){return this;},eq(){return this;},not(){return this;},order(){return this;},
   insert(rows){insert=rows;return this;},maybeSingle(){return this;},
   then(resolve,reject){if(table==='ecotrack_device_state'){reads++;return Promise.resolve({data:hardware,error:failure?new Error('offline API'):null}).then(resolve,reject);}
    if(insert){writes.push(...insert);return Promise.resolve({data:{id:'saved-'+writes.length},error:failure?new Error('write failed'):null}).then(resolve,reject);}
    const data=table==='nodes'?[node]:table==='rooms'?[{id:'room-one',name:'Room 1'}]:[];
    return Promise.resolve({data,error:null}).then(resolve,reject);}};return query;}};
 context.supabaseClient=client;context.window=context;vm.createContext(context);vm.runInContext(source,context);
 context.triggerGlobalNotification=(content)=>shown.push(content);
 context.getActiveRulesAndNodes=async()=>({rules:[{id:'rule-one',enabled:true,type:'temperature',condition:'above',value:25,duration:0}],
   ruleNodes:[],nodes:[node],rooms:[{id:'room-one'}],nodeMap:{[node.name]:node,[node.id]:node}});
 return {context,node,store,writes,shown,setHardware:rows=>{hardware=rows;},advance:ms=>{now+=ms;},fail:()=>{failure=true;},
   state:extra=>({node_id:node.id,last_seen:new Clock().toISOString(),...extra}),get reads(){return reads;}};
}
for(const kind of ['missing','stale','future','offline'])test(kind+' hardware never creates a scheduled wake or sleep notification',async()=>{
 const f=fixture();let row=f.state();
 if(kind==='stale'||kind==='offline')row.last_seen=new Date(Date.parse(row.last_seen)-90000).toISOString();
 if(kind==='future')row.last_seen=new Date(Date.parse(row.last_seen)+60000).toISOString();
 f.setHardware(kind==='missing'?[]:[row]);await f.context.checkControlSchedules(true);
 assert.equal(f.writes.length,0);assert.equal(f.shown.length,0);assert.equal(f.store.size,0);
});
test('clock due for sleep but online hardware does not become Sleeping',async()=>{
 const f=fixture();f.setHardware([f.state()]);await f.context.checkControlSchedules(true);assert.equal(f.writes.length,0);
});
test('controller-reported sleep creates one sleep alert and no wake alert',async()=>{
 const f=fixture();f.setHardware([f.state({sleeping_until:new Date(f.context.Date.now()+3600000).toISOString()})]);
 await f.context.checkControlSchedules(true);await f.context.checkControlSchedules(true);
 assert.equal(f.writes.length,1);assert.match(f.writes[0].content,/has reported scheduled sleep/);assert.equal(f.shown.length,1);
});
test('a sleep timestamp with no valid hardware heartbeat is not accepted',async()=>{
 const f=fixture();f.setHardware([{node_id:f.node.id,sleeping_until:new Date(f.context.Date.now()+3600000).toISOString()}]);
 await f.context.checkControlSchedules(true);assert.equal(f.writes.length,0);
});
test('fresh hardware in active schedule emits one wake alert',async()=>{
 const f=fixture(12);f.setHardware([f.state()]);await f.context.checkControlSchedules(true);await f.context.checkControlSchedules(true);
 assert.equal(f.writes.length,1);assert.match(f.writes[0].content,/is online during its wake schedule/);
});
test('missing schedule configuration does not invent wake and sleep defaults',async()=>{
 const f=fixture(12);f.node.wake_time=null;f.node.sleep_time=null;f.setHardware([f.state()]);
 await f.context.checkControlSchedules(true);assert.equal(f.writes.length,0);
});
test('overnight wake windows and midnight settings are supported',async()=>{
 const f=fixture(1);f.node.wake_time='22:00';f.node.sleep_time='06:00';f.setHardware([f.state()]);
 await f.context.checkControlSchedules(true);assert.equal(f.writes.length,1);assert.match(f.writes[0].content,/is online/);
 assert.equal(f.context.to24HourHHMM('00:00'),'00:00');
});
test('offline rule evaluation clears old violation timers without triggering stale readings',async()=>{
 const f=fixture();f.store.set('ecoTrack_violation_start_rule-one_AC-Controller-1','1');f.store.set('ecoTrack_alert_triggered_rule-one_AC-Controller-1','1');
 f.setHardware([f.state({last_seen:new Date(f.context.Date.now()-90000).toISOString()})]);
 await f.context.evaluateTelemetryAgainstRules({id:f.node.id,name:f.node.name,temp:99,battery:0});
 assert.equal(f.writes.length,0);assert.equal(f.store.has('ecoTrack_violation_start_rule-one_AC-Controller-1'),false);
 assert.equal(f.store.has('ecoTrack_alert_triggered_rule-one_AC-Controller-1'),false);
});
test('genuine fresh online temperature violation still triggers',async()=>{
 const f=fixture(12);f.setHardware([f.state()]);await f.context.evaluateTelemetryAgainstRules({id:f.node.id,name:f.node.name,temp:30});
 assert.equal(f.writes.length,1);assert.equal(f.shown.length,1);assert.match(f.writes[0].content,/Temperature went above/);
});
test('sleeping hardware does not generate a stale temperature rule alert',async()=>{
 const f=fixture();f.setHardware([f.state({sleeping_until:new Date(f.context.Date.now()+3600000).toISOString()})]);
 await f.context.evaluateTelemetryAgainstRules({id:f.node.id,name:f.node.name,temp:99});assert.equal(f.writes.length,0);
});
test('null temperature is not treated as a measured zero',async()=>{
 const f=fixture(12);f.setHardware([f.state()]);f.context.getActiveRulesAndNodes=async()=>({rules:[{id:'r',enabled:true,type:'temperature',condition:'below',value:20,duration:0}],nodeMap:{[f.node.id]:f.node},ruleNodes:[],nodes:[f.node]});
 await f.context.evaluateTelemetryAgainstRules({id:f.node.id,temp:null,temperature:null});assert.equal(f.writes.length,0);
});
test('hardware requests coalesce and failed refresh cannot reuse old evidence',async()=>{
 const f=fixture(12);f.setHardware([f.state()]);await Promise.all([f.context.getNotificationHardwareStates(),f.context.getNotificationHardwareStates()]);
 assert.equal(f.reads,1);f.advance(6001);f.fail();const states=await f.context.getNotificationHardwareStates();assert.deepEqual(Object.keys(states),[]);
});
test('notification monitor can start before the database client becomes ready',async()=>{
 const f=fixture(12),client=f.context.supabaseClient;f.context.supabaseClient=null;
 assert.deepEqual(Object.keys(await f.context.getNotificationHardwareStates()),[]);
 f.context.supabaseClient=client;f.setHardware([f.state()]);assert.equal(Object.keys(await f.context.getNotificationHardwareStates()).length,1);
});
function diagnostics(){
 const src=fs.readFileSync(path.join(desktop,'public/js/maintenance-modal.js'),'utf8');
 const ast=ts.createSourceFile('maintenance.js',src,ts.ScriptTarget.Latest,true);assert.equal(ast.parseDiagnostics.length,0);
 const functions=[];function visit(n){if(ts.isFunctionDeclaration(n)&&['formatBatteryDisplay','maintenanceControllerDiagnostics','currentMaintenanceControllers'].includes(n.name?.text))functions.push(n.getText(ast));ts.forEachChild(n,visit);}visit(ast);
 const c=vm.createContext({Date});vm.runInContext(functions.join('\n'),c);return c;
}
test('maintenance unknown measurements never become 24C, 101.3kPa or 100%',()=>{
 const c=diagnostics(),now=Date.now(),empty=c.maintenanceControllerDiagnostics({}, {last_seen:new Date(now).toISOString()},now);
 assert.equal(empty.state,'Online');for(const reading of Object.values(empty.controls)){assert.equal(reading.val,'Unavailable');assert.equal(reading.code,'unknown');}
});
test('maintenance distinguishes real offline, sleeping and online hardware while retaining measured zero',()=>{
 const c=diagnostics(),now=Date.now(),measurements={temp:0,pressure:101,battery:0,rssi:-70},seen=new Date(now).toISOString();
 let result=c.maintenanceControllerDiagnostics(measurements,{last_seen:seen},now);assert.equal(result.state,'Online');assert.equal(result.controls.temp.val,'0°C');assert.equal(result.controls.battery.val,'0%');
 result=c.maintenanceControllerDiagnostics(measurements,{last_seen:new Date(now-90000).toISOString()},now);assert.equal(result.state,'Offline');assert.equal(result.controls.temp.code,'offline');
 result=c.maintenanceControllerDiagnostics(measurements,{last_seen:seen,sleeping_until:new Date(now+3600000).toISOString()},now);assert.equal(result.state,'Sleeping');
});

function controllerStore() {
 const src=fs.readFileSync(path.join(desktop,'public/js/maintenance-modal.js'),'utf8');
 const ast=ts.createSourceFile('maintenance.js',src,ts.ScriptTarget.Latest,true),functions=[];let proxy;
 function walk(n){if(ts.isFunctionDeclaration(n)&&['formatBatteryDisplay','maintenanceControllerDiagnostics','currentMaintenanceControllers','getAirconsDatabase'].includes(n.name?.text))functions.push(n.getText(ast));if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='AIRCONS_DATABASE')proxy=n.initializer.getText(ast);ts.forEachChild(n,walk);}walk(ast);
 const state={last_seen:new Date().toISOString(),battery:3.8,rssi:-70};
 const node={name:'Actual Controller',db_id:'node-db',cloud_state:state,temp:23};
 const c=vm.createContext({Date,localStorage:{getItem:()=>null},window:{EcoTrackAirconSystem:{
  AirconProfileManager:{getAll:()=>[{device_id:'AC-ASSET',name:'Equipment Name',node_id:'physical-node'}]},
  NodeService:{getNode:id=>{assert.ok(id,'Never look up an undefined controller identity');return id==='physical-node'?node:null;}}
 }}});
 vm.runInContext('let _nodesAirconCache=[];'+functions.join('\n')+';globalThis.controllers='+proxy+';',c);
 return c;
}
test('maintenance fallback resolves controller metadata instead of the equipment name',()=>{
 const c=controllerStore(),rows=c.getAirconsDatabase();assert.equal(rows[0].id,'AC-ASSET');assert.equal(rows[0].nodeName,'Actual Controller');assert.equal(rows[0].nodeId,'node-db');assert.equal(rows[0].state,'Online');assert.equal(rows[0].controls.temp.val,'23°C');assert.equal(rows[0].controls.pressure.val,'Unavailable');
});
test('maintenance controller proxy supports iteration without converting a Symbol to a number',()=>{
 const c=controllerStore();const rows=Array.from(c.controllers);assert.equal(rows.length,1);assert.equal(rows[0].id,'AC-ASSET');assert.equal(c.controllers.find(row=>row.id==='AC-ASSET').nodeName,'Actual Controller');
});

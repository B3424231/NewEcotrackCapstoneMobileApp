const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve('../EcoTrackDesktopDashboardNew-main-control/public/js/node-sync.js'),'utf8');
const good={id:'cmd-1',node_id:'db-node',kind:'ac_intent',payload:{aircon_id:'db-ac'},status:'completed',result:{success:true,command_id:'cmd-1',delivery_status:'transmitted'}};
function fixture({receipt=good,timeout=false}={}){
 let now=Date.parse('2026-10-04T06:00:00+08:00'),profiles,hold;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const node={id:'db-node',name:'node-1',room_id:'room-1',wake_time:'06:00',sleep_time:'22:00',status:'online',temp:25};
 const profile={aircon_id:'db-ac',device_id:'AC-1',node_id:'db-node',state:{power:true},control_snapshot:{command_id:'cmd-1',command_status:'queued',desired_state:{power:'on'},reported_state:null}};
 profiles=[profile];const reads=[],writes=[],updates=[];
 const sb={from(table){const q={select(){return q},not(){return q},eq(){return q},maybeSingle(){return q},update(){return q},then(resolve,reject){return Promise.resolve().then(async()=>{
  if(table==='ecotrack_device_commands'){reads.push(table);if(hold)await hold();return {data:typeof receipt==='function'?receipt():receipt};}
  return {data:table==='nodes'?[node]:null};}).then(resolve,reject);}};return q;}};
 const window={supabaseClient:sb,EcoTrackAirconSystem:{AirconProfileManager:{getAll:()=>profiles,updateState:(_id,state,snapshot)=>{updates.push({state,snapshot});profile.control_snapshot=snapshot;}}},dispatchEvent(){}};
 const ctx=vm.createContext({window,Date:Clock,console,AbortController,clearTimeout,document:{readyState:'loading',addEventListener(){}},setTimeout:timeout?(fn)=>setTimeout(fn,5):()=>undefined,setInterval(){},CustomEvent:class{},fetch:async(_url,o)=>{writes.push(JSON.parse(o.body));return {ok:true,json:async()=>({id:'saved'})};}});
 vm.runInContext(source,ctx);
 return {api:window.EcoTrackNodeSync,node,profile,reads,writes,updates,setTime:t=>now=Date.parse(t),setProfiles:v=>profiles=v,setWait:v=>hold=v};
}
test('UTC+8 sleep boundaries are inclusive at wake, exclusive at sleep, including overnight and legacy schedules',()=>{
 const f=fixture(),awake=t=>f.api.isNodeWithinOperatingWindow(f.node,Date.parse(`2026-10-04T${t}+08:00`));
 assert.equal(awake('03:00:00'),false);assert.equal(awake('05:59:59'),false);assert.equal(awake('06:00:00'),true);assert.equal(awake('21:59:59'),true);assert.equal(awake('22:00:00'),false);
 f.node.wake_time='22:00';f.node.sleep_time='06:00';assert.equal(awake('03:00:00'),true);assert.equal(awake('06:00:00'),false);assert.equal(awake('22:00:00'),true);
 for(const [wake,sleep] of [[null,null],['bad','06:00'],['25:00','06:00'],['06:00','06:00']]){f.node.wake_time=wake;f.node.sleep_time=sleep;assert.equal(awake('03:00:00'),true);}
});

test('background polling never mints sensor history from a cached node, awake or asleep',async()=>{
 const f=fixture();for(const t of ['03:00:00','06:00:00','06:01:00','22:00:00']){f.setTime('2026-10-04T'+t+'+08:00');await f.api.stepBackgroundTelemetryCadence();}assert.equal(f.writes.length,0);
});
test('matching authenticated cloud receipt marks transmission without confirming physical power',async()=>{
 const f=fixture();await f.api.reconcilePendingCommandReceipt(f.node);assert.equal(f.reads.length,1);assert.equal(f.updates.length,1);
 assert.equal(f.profile.control_snapshot.command_status,'transmitted');assert.equal(f.profile.control_snapshot.reported_state,null);assert.deepEqual(Object.keys(f.updates[0].state),[]);
});
test('mismatched or incomplete receipt cannot acknowledge another command or device',async()=>{
 for(const receipt of [{...good,id:'old'},{...good,node_id:'other'},{...good,kind:'configure'},{...good,payload:{aircon_id:'other'}},{...good,result:{...good.result,command_id:'other'}},{...good,result:{success:true,command_id:'cmd-1'}},{...good,status:'queued'}]){
 const f=fixture({receipt});await f.api.reconcilePendingCommandReceipt(f.node);assert.equal(f.updates.length,0);assert.equal(f.profile.control_snapshot.command_status,'queued');}
});
test('authenticated failed and expired commands surface failed delivery',async()=>{
 for(const status of ['failed','expired']){const f=fixture({receipt:{...good,status}});await f.api.reconcilePendingCommandReceipt(f.node);assert.equal(f.profile.control_snapshot.command_status,'failed');assert.equal(f.profile.control_snapshot.reported_state,null);}
});
test('unbound and ambiguous profiles never request a receipt',async()=>{
 for(const profiles of [[],[{},{}]]){const f=fixture();f.setProfiles(profiles.map(()=>({...f.profile})));await f.api.reconcilePendingCommandReceipt(f.node);assert.equal(f.reads.length,0);}
});
test('pending cloud reads are throttled, while a new command gets its own check',async()=>{
 const f=fixture({receipt:null});await f.api.reconcilePendingCommandReceipt(f.node);await f.api.reconcilePendingCommandReceipt(f.node);assert.equal(f.reads.length,1);
 f.setTime('2026-10-04T06:00:05+08:00');await f.api.reconcilePendingCommandReceipt(f.node);assert.equal(f.reads.length,2);
 f.profile.control_snapshot.command_id='cmd-new';await f.api.reconcilePendingCommandReceipt(f.node);assert.equal(f.reads.length,3);
});
test('an in-flight receipt cannot overlap or restore a superseded command',async()=>{
 const f=fixture();let release;f.setWait(()=>new Promise(r=>release=r));const pending=f.api.reconcilePendingCommandReceipt(f.node);await new Promise(setImmediate);
 f.setTime('2026-10-04T06:00:10+08:00');await f.api.reconcilePendingCommandReceipt(f.node);assert.equal(f.reads.length,1);
 f.profile.control_snapshot={...f.profile.control_snapshot,command_id:'cmd-new'};release();await pending;assert.equal(f.updates.length,0);
});

test('a hung receipt releases the read guard and ignores a late success',async()=>{
 const f=fixture({timeout:true});let release;f.setWait(()=>new Promise(r=>release=r));
 await f.api.stepBackgroundTelemetryCadence();assert.equal(f.updates.length,0);
 f.setTime('2026-10-04T06:00:20+08:00');f.setWait(null);
 await f.api.stepBackgroundTelemetryCadence();assert.equal(f.updates.length,1);
 release();await new Promise(setImmediate);assert.equal(f.updates.length,1);
});

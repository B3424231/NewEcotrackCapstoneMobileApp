const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=process.env.ECOTRACK_CONTROL_SOURCE_ROOT || path.resolve('../EcoTrackDesktopDashboardNew-main-control');
const scheduler=fs.readFileSync(process.env.ECOTRACK_SCHEDULER_SOURCE || path.join(root,'public/js/scheduler.js'),'utf8');
const tree=ts.createSourceFile('scheduler.js',scheduler,ts.ScriptTarget.Latest,true);
const names=['normalizeScheduleTime','nodeSleepNote','schedulerSelectedSettings','getSchedulerTargetTemperature','getSchedulerPowerMode','getSchedulerControlSnapshot','getSchedulerControlMode','refreshSchedulerControlModes','createTableRow','formatTimeDisplay'];
const functions=[];
const find=node=>{if(ts.isFunctionDeclaration(node) && names.includes(node.name?.text))functions.push(node.getText(tree));ts.forEachChild(node,find);};find(tree);
function fixture() {
  const storage={};
  const localStorage={getItem:key=>storage[key]??null,setItem:(key,value)=>storage[key]=String(value),removeItem:key=>delete storage[key]};
  let profiles=[];
  const context=vm.createContext({window:{EcoTrackAirconSystem:{AirconProfileManager:{getAll:()=>profiles}}},Date,console,AbortController,
    localStorage,schedulerAirconRecords:null,scheduleDrafts:new Map(),scheduleDeliveries:new Map(),savedRooms:{},currentRoomNodes:[],document:{querySelectorAll:()=>[]}});
  vm.runInContext(fs.readFileSync(path.join(root,'public/js/aircon-state.js'),'utf8'),context);
  vm.runInContext(functions.join('\n'),context);
  const node={id:'node-1',name:'node-1',pb_id:'db-node',status:'online',temp:24,intervalVal:30,intervalUnit:'Seconds'};
  const snapshot={desired_state:{power:'on',mode:'cool',fan:'quiet',temp:24},commanded_at:'2026-10-04T00:00:00Z'};
  profiles=[{aircon_id:'db-ac',device_id:'AC-1',node_id:'node-1',control_snapshot:snapshot}];
  return {context,node,profiles,snapshot};
}
test('Control Schedules shows the same operating mode and blower speed as Aircon Control',()=>{
  const f=fixture();
  assert.match(f.context.createTableRow(f.node),/>COOL \/ QUIET FAN</);
  f.snapshot.desired_state.mode='fan';f.snapshot.desired_state.fan='high';
  assert.match(f.context.createTableRow(f.node),/>FAN \/ HIGH FAN</);
  f.snapshot.desired_state.mode='dry';
  assert.match(f.context.createTableRow(f.node),/>DRY \/ HIGH FAN</);
});
test('schedule state uses current desired settings, rejecting ambiguous or missing bindings',()=>{
  const f=fixture();
  assert.equal(typeof f.context.getSchedulerControlMode,'function');
  f.context.schedulerAirconRecords=[{id:'db-ac',node_id:'db-node',desired_state:{power:'on',mode:'heat',fan:'low'},commanded_at:'2026-10-04T00:01:00Z'}];
  assert.equal(f.context.getSchedulerControlMode(f.node),'HEAT / LOW FAN');
  f.snapshot.commanded_at='2026-10-04T00:02:00Z';
  assert.equal(f.context.getSchedulerControlMode(f.node),'COOL / QUIET FAN','A fresh local command is visible before the cloud refresh');
  f.context.schedulerAirconRecords.push({id:'other',controller_node_id:'node-1',desired_state:{mode:'auto',fan:'auto'}});
  assert.equal(f.context.getSchedulerControlMode(f.node),'—');
  f.context.schedulerAirconRecords=[];
  assert.equal(f.context.getSchedulerControlMode(f.node),'—','Stale cached profiles cannot recreate a deleted binding');
});

test('a verified controller without a command shows its selected control settings',()=>{
  const f=fixture();
  f.profiles[0].control_snapshot={desired_state:null,reported_state:null};
  f.profiles[0].state={power:false,mode:'fan',fan:'quiet',temperature:24};
  f.context.schedulerAirconRecords=[{id:'db-ac',node_id:'db-node',desired_state:null,reported_state:null}];
  assert.equal(f.context.getSchedulerControlMode(f.node),'FAN / QUIET FAN');
  f.profiles[0].state.mode='cool';f.profiles[0].state.fan='auto';
  assert.equal(f.context.getSchedulerControlMode(f.node),'COOL / AUTO FAN');
  assert.equal(f.context.schedulerAirconRecords[0].desired_state,null,'Displaying settings must not enqueue a control command');
  assert.equal(f.profiles[0].control_snapshot.reported_state,null,'Configuration must not become actual device feedback');
});
test('live mode refresh changes the label without replacing schedule edits',()=>{
  const f=fixture();const label={dataset:{schedulerControlMode:'node-1'},textContent:''};
  f.context.document.querySelectorAll=selector=>selector==='[data-scheduler-control-mode]'?[label]:[];
  f.context.document.getElementById=()=>{throw new Error('Refreshing mode must not rebuild schedule inputs');};
  f.context.savedRooms={room:{nodes:[f.node]}};
  assert.equal(typeof f.context.refreshSchedulerControlModes,'function');
  f.context.refreshSchedulerControlModes();
  assert.equal(label.textContent,'COOL / QUIET FAN');
  f.snapshot.desired_state.fan='high';f.context.refreshSchedulerControlModes();
  assert.equal(label.textContent,'COOL / HIGH FAN');
});
test('rapid mode and fan commands retain both settings in the full cloud state',async()=>{
  const f=fixture(),context=f.context;
  context.window={localStorage:context.localStorage};
  Object.assign(context,{setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){}});
  vm.runInContext(fs.readFileSync(path.join(root,'public/js/aircon-system.js'),'utf8'),context);
  const {NodeService,AirconProfileManager,CommandManager}=context.window.EcoTrackAirconSystem;
  await NodeService.saveNode({node_id:'node-1',db_id:'db-node',name:'node-1',status:'Connected'});
  context.localStorage.setItem('ecoTrack_aircons',JSON.stringify([{device_id:'AC-1',aircon_id:'db-ac',node_id:'node-1',brand:'Daikin',protocol_name:'DAIKIN2',status:'online',state:{power:true,temperature:24,mode:'cool',fan:'quiet'}}]));
  const intents=[];
  context.window.supabaseClient={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:'db-ac'}})})};
  context.window.EcoTrackHardwareCloud={describe:()=> 'online',control:async(node,payload)=>{intents.push(JSON.parse(JSON.stringify(payload)));await new Promise(setImmediate);return {command_id:'cmd-'+intents.length,commanded_at:new Date().toISOString()};}};
  context.fetch=async()=>{throw Error('Do not send direct LAN commands');};
  const results=await Promise.all([CommandManager.dispatch({device_id:'AC-1',command:'MODE',value:'dry'}),CommandManager.dispatch({device_id:'AC-1',command:'FAN',value:'high'})]);
  assert.ok(results.every(result=>result.success),JSON.stringify(results));
  assert.equal(intents.length,2);assert.equal(intents.at(-1).state.mode,'dry');assert.equal(intents.at(-1).state.fan,'high');
  assert.equal(AirconProfileManager.getById('AC-1').control_snapshot.command_status,'queued');
  assert.equal(AirconProfileManager.getById('AC-1').control_snapshot.reported_state,undefined);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const desktop = process.env.ECOTRACK_DESKTOP_ROOT || path.resolve('..','EcoTrackDesktopDashboardNew-main-control');
const moduleObject = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/aircon-state.ts','utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: moduleObject.exports, module: moduleObject, Date });
const mobile = moduleObject.exports;
const context = vm.createContext({ window: {}, console, Date });
vm.runInContext(fs.readFileSync(path.join(desktop,'public/js/aircon-state.js'),'utf8'),context);
const browser = context.window.EcoTrackAirconState;
const source = fs.readFileSync(path.join(desktop,'public/js/logs.js'),'utf8');
const parsed = ts.createSourceFile('logs.js',source,ts.ScriptTarget.Latest,true);
const functions = [];
function visit(node) { if(ts.isFunctionDeclaration(node) && ['getConfirmedAcOnState','getDisplayAcState'].includes(node.name?.text)) functions.push(node.getText(parsed)); ts.forEachChild(node,visit); }
visit(parsed); vm.runInContext(functions.join('\n'),context);
const desired = (mode='cool',fan='quiet',power='on') => ({desired_state:{power,mode,fan,temp:24},command_status:'transmitted',commanded_at:'2026-10-03T10:00:00Z'});

test('COOL and quiet/high fan remain cooling requests on desktop and mobile',()=>{
  for(const fan of ['quiet','high','auto']) {
    const snapshot=desired('cool',fan);
    assert.equal(mobile.describeAirconState(snapshot).label,'COOLING REQUESTED');
    assert.equal(mobile.describeAirconState(snapshot).confirmed,false);
    assert.equal(mobile.describeAirconState(snapshot).fanLabel,fan.toUpperCase()+' FAN');
    assert.equal(browser.describeAirconState(snapshot).summary,mobile.describeAirconState(snapshot).summary);
    const log={controlSnapshot:snapshot,status:'online',temperature:30};
    assert.equal(context.getDisplayAcState(log),mobile.describeAirconState(snapshot).summary);
    assert.equal(context.getConfirmedAcOnState(log),null,'A transmitted IR command is not measured power');
  }
});
test('all modes, off, queued and failed retain explicit command semantics',()=>{
  for(const [mode,label] of Object.entries({fan:'FAN REQUESTED',dry:'DRY REQUESTED',heat:'HEATING REQUESTED',auto:'AUTO REQUESTED'})) {
    assert.equal(mobile.describeAirconState(desired(mode)).label,label);
  }
  assert.equal(mobile.describeAirconState(desired('cool','auto','off')).label,'POWER OFF REQUESTED');
  for(const status of ['queued','failed']) assert.match(mobile.describeAirconState({...desired(),command_status:status}).summary,new RegExp(status.toUpperCase()));
});
test('reported mode takes priority only when feedback is newer than the command',()=>{
  const snapshot={...desired(),reported_state:{power:'on',mode:'fan',fan:'high'},reported_at:'2026-10-03T09:59:00Z'};
  assert.equal(mobile.describeAirconState(snapshot).label,'COOLING REQUESTED');
  snapshot.reported_at='2026-10-03T10:00:01Z';
  assert.equal(mobile.describeAirconState(snapshot).label,'FAN ONLY');
  snapshot.reported_state={power:'on',mode:'cool',fan:'quiet'};
  assert.equal(mobile.describeAirconState(snapshot).label,'COOL MODE');
  snapshot.reported_state.compressor_active=true;
  assert.equal(mobile.describeAirconState(snapshot).label,'ACTIVE COOLING');
  assert.equal(context.getConfirmedAcOnState({controlSnapshot:snapshot,status:'online'}),true);
});
test('historical snapshots remain unchanged and scalar feedback remains usable',()=>{
  const historical=JSON.stringify(desired());
  const latest=desired('fan','high');
  assert.equal(context.getDisplayAcState({control_snapshot:historical,temperature:27}),mobile.describeAirconState(historical).summary);
  assert.equal(context.getDisplayAcState({controlSnapshot:latest,temperature:20}),mobile.describeAirconState(latest).summary);
  for(const temperature of [18,26,35]) assert.equal(context.getDisplayAcState({temperature,status:'online'}),'STATE NOT RECORDED');
  assert.equal(context.getDisplayAcState({ac_on:false,temperature:20}),'OFF');
  assert.equal(context.getDisplayAcState({ac_state:'fan only',temperature:20}),'FAN ONLY');
  assert.equal(mobile.parseAirconSnapshot('broken'),null);
});

test('logs show captured selected settings without confirming operation or replacing device feedback',()=>{
  const snapshot={configured_state:{power:true,mode:'cool',fan:'quiet'},configured_at:'2026-10-04T01:00:00Z'};
  const description=mobile.describeAirconState(snapshot);
  assert.equal(description.summary,'COOL SETTINGS · QUIET FAN');
  assert.equal(description.confirmed,false);assert.equal(description.power,null);
  assert.equal(browser.describeAirconState(snapshot).summary,description.summary);
  assert.equal(context.getDisplayAcState({controlSnapshot:snapshot,status:'online'}),description.summary);
  assert.equal(context.getConfirmedAcOnState({controlSnapshot:snapshot,status:'online'}),null);
  assert.equal(context.getDisplayAcState({controlSnapshot:snapshot,ac_on:false,status:'online'}),'OFF');
  assert.equal(context.getDisplayAcState({controlSnapshot:snapshot,ac_state:'fan only',status:'online'}),'FAN ONLY');
  const command={...snapshot,...desired('dry','high')};
  assert.equal(browser.describeAirconState(command).label,'DRY REQUESTED');
  const feedback={...snapshot,reported_state:{power:true,mode:'cool',fan:'low',compressor_active:true}};
  assert.equal(browser.describeAirconState(feedback).label,'ACTIVE COOLING');
  assert.equal(context.getDisplayAcState({control_snapshot:{},status:'online'}),'STATE NOT RECORDED');
  assert.equal(context.getDisplayAcState({control_snapshot:null,status:'online'}),'STATE NOT RECORDED');
});

test('telemetry saves immutable settings only for a verified linked controller with no saved command',async()=>{
  const payloads=[];
  const ac={aircon_id:'ac-1',node_id:'node-1',control_snapshot:{desired_state:null,reported_state:null},
    state:{power:true,mode:'cool',fan:'quiet',temperature:24}};
  let profiles=[ac];
  const window={EcoTrackAirconSystem:{AirconProfileManager:{getAll:()=>profiles}},dispatchEvent(){}};
  const sync=vm.createContext({window,document:{readyState:'loading',addEventListener(){}},Date,console,
    CustomEvent:class{},setTimeout(){},setInterval(){},
    fetch:async(_url,options)=>{const payload=JSON.parse(options.body);payloads.push(payload);return {ok:true,json:async()=>({...payload,id:'saved'})};}});
  vm.runInContext(fs.readFileSync(path.join(desktop,'public/js/node-sync.js'),'utf8'),sync);
  const save=window.EcoTrackNodeSync.saveNodeTelemetryToSqlite;
  const packet=name=>({id:name,temp:24,status:'online',room_name:'Room',aircon_type:'Split Type'});
  await save(packet('node-1'));
  const first=payloads[0];
  assert.deepEqual(first.control_snapshot.configured_state,{mode:'cool',fan:'quiet',temp:24});
  assert.ok(Number.isFinite(Date.parse(first.control_snapshot.configured_at)));
  assert.equal(first.aircon_id,'ac-1');assert.equal(first.ac_on,undefined);
  assert.equal(ac.control_snapshot.configured_state,undefined,'Saving a log must not mutate the live profile');
  ac.state.mode='fan';ac.state.fan='high';
  assert.equal(context.getDisplayAcState({control_snapshot:first.control_snapshot}),'COOL SETTINGS · QUIET FAN','A later selection cannot rewrite a saved row');
  // Each packet uses a distinct node to avoid the per-node save debounce.
  ac.node_id='node-2';ac.control_snapshot=desired('dry','medium');
  await save(packet('node-2'));assert.equal(payloads[1].control_snapshot.configured_state,undefined);
  assert.equal(context.getDisplayAcState({control_snapshot:payloads[1].control_snapshot}),'DRY REQUESTED · MEDIUM FAN · TRANSMITTED');
  ac.node_id='node-3';ac.control_snapshot=null;
  await save(packet('node-3'));assert.equal(payloads[2].control_snapshot,null);
  ac.node_id='node-4';ac.control_snapshot={};
  profiles=[ac,{...ac,aircon_id:'ac-2'}];
  await save(packet('node-4'));assert.equal(payloads[3].control_snapshot,null);
  profiles=[ac];ac.node_id='node-5';
  await save({...packet('node-5'),control_snapshot:null});assert.equal(payloads[4].control_snapshot,null,'An explicit packet snapshot cannot be replaced with current settings');
  ac.node_id='node-6';
  await save({...packet('node-6'),control_snapshot:{}});assert.deepEqual(payloads[5].control_snapshot,{});
});

test('actual export snapshot retains confirmed physical power and keeps command-only readings unknown',()=>{
  const definitions = [];
  function collect(node) {
    if (ts.isFunctionDeclaration(node) && ['reportNumber', 'reportText', 'buildLogsReportSnapshot'].includes(node.name?.text)) definitions.push(node.getText(parsed));
    ts.forEachChild(node, collect);
  }
  collect(parsed); assert.equal(definitions.length, 3, 'Actual report snapshot functions must be exercised');
  const reported = state => ({controlSnapshot:{reported_state:state,reported_at:'2026-10-03T10:01:00Z',command_status:'transmitted'},status:'online'});
  const logs = [
    reported({power:'on',mode:'cool',fan:'quiet',compressor_active:true}),
    reported({power:'on',mode:'fan',fan:'high'}),
    reported({power:'off',mode:'cool',fan:'quiet'}),
    reported({power:'on',mode:'cool',compressor_active:false}),
    {controlSnapshot:desired(),status:'online'},
    {controlSnapshot:desired('fan','high'),status:'online'},
    {controlSnapshot:desired('cool','quiet','off'),status:'online'},
    {temperature:18,status:'online'},
  ];
  const reportContext = vm.createContext({ window: { EcoTrackAirconState: browser }, Date, Intl,
    getConfirmedAcOnState: context.getConfirmedAcOnState,
    getEnergyPredictionForExport: () => null, getActiveTariffRate: () => null,
    getFilteredLogs: () => logs.map((log, index) => ({ ...log, nodeId: 'node-' + index, timestamp: '2026-10-17T10:00:00Z' })),
    getRecordedClimateModes: () => ({ mode: 'Unavailable', fan: 'Unavailable' }), getRecordedSpecialFunctions: () => 'Unavailable',
    getAnalyticsNodeId: log => log.nodeId, getRecordedClimateSettings: () => null,
    getBatteryPercentage: value => value, calculateEnergyCost: () => null,
    getAnalyticsChartSeries: () => [], getUtilityProvider: () => 'Unavailable', getDateRangeText: () => 'October 17, 2026',
    locationMap: {}, controlNameMap: {}, globalAirconMap: {}, globalInstallDateMap: {},
    currentPeriod: 'daily', currentNodeFilter: '', startTimeFilter: '', endTimeFilter: '',
  });
  vm.runInContext(definitions.join('\n'), reportContext);
  const report = reportContext.buildLogsReportSnapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(report.rows.map(row => row.power))), [true, true, false, true, null, null, null, null]);
  assert.equal(report.unknown, 4); assert.equal(report.kwh, null); assert.equal(report.runtime, null);
  assert.ok(report.notes.some(note => note.includes('unknown physical AC power')));
});

test('desktop state binding requires one explicit controller and one aircon owner',()=>{
  const system = fs.readFileSync(path.join(desktop,'public/js/aircon-system.js'),'utf8');
  const tree = ts.createSourceFile('aircon-system.js',system,ts.ScriptTarget.Latest,true);
  let resolver;
  const find = node => { if(ts.isFunctionDeclaration(node) && node.name?.text==='resolveRegisteredAirconNode') resolver=node.getText(tree); ts.forEachChild(node,find); };
  find(tree);
  assert.ok(resolver,'Registered controller resolver must exist');
  vm.runInContext(resolver,context);
  const nodes=[{id:'db-1',name:'node-1',room_id:'room-1'},{id:'db-2',name:'node-2',room_id:'room-1'}];
  const ac={id:'ac-1',node_id:'db-1',controller_node_id:'db-1',room_id:'room-1'};
  assert.equal(context.resolveRegisteredAirconNode(ac,[ac],nodes),nodes[0]);
  const byName={...ac,node_id:'node-1',controller_node_id:'db-1'};
  assert.equal(context.resolveRegisteredAirconNode(byName,[byName],nodes),nodes[0]);
  const roomOnly={id:'ac-2',room_id:'room-1',asset_tag:'node-1'};
  assert.equal(context.resolveRegisteredAirconNode(roomOnly,[roomOnly],nodes),null,'Room or tag similarity must not supply a state');
  assert.equal(context.resolveRegisteredAirconNode(ac,[ac,{id:'ac-2',controller_node_id:'node-1'}],nodes),null,'Duplicate owners remain unconfirmed');
  const conflicting={...ac,controller_node_id:'db-2'};
  assert.equal(context.resolveRegisteredAirconNode(conflicting,[conflicting],nodes),null,'Conflicting links remain unconfirmed');
});

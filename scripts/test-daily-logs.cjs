const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sourcePath = process.env.ECOTRACK_LOGS_SOURCE || path.resolve('../EcoTrackDesktopDashboardNew-main-control/public/js/logs.js');
const source = fs.readFileSync(sourcePath,'utf8');
const tree = ts.createSourceFile('logs.js',source,ts.ScriptTarget.Latest,true);
const names = ['getPeriodDateKey','getDefaultDateKey','getAvailableDateKeys','getPeriodDateLabel',
  'populateDateRangeOptions','getFilteredLogs','setupEventListeners','fetchLogsFromDB','getTelemetryRevision','pollLatestTelemetry'];
const functions = [];
const collect = node => { if(ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) functions.push(node.getText(tree)); ts.forEachChild(node,collect); };
collect(tree);

function fixture() {
  let now = new Date(2026,9,3,23,17).getTime();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  let records = [{id:'old',node_id:'node-1',sensor_name:'Controller 1',created:new Clock().toISOString()}];
  const listeners = new Map(), timers = new Map(), rendered = [], fetchOptions = [];
  let timerId=0;
  const date = {dataset:{},value:'',addEventListener:(_,handler)=>listeners.set('date',handler)};
  const reset = {addEventListener:(_,handler)=>listeners.set('reset',handler)};
  const context = vm.createContext({Date:Clock,console,currentPeriod:'daily',selectedDateKey:'',currentPage:1,
    nodeDataLogs:[],currentNodeFilter:'',startTimeFilter:'',endTimeFilter:'',controlNameMap:{},locationMap:{},globalAirconMap:{},pb:null,
    window:{addEventListener:(name,handler)=>listeners.set(name,handler),ECOTRACK_CONFIG:{backendUrl:'http://backend'}},
    document:{getElementById:id=>id==='dateRangeSelect'?date:id==='resetAllFiltersBtn'?reset:null,querySelectorAll:()=>[]},
    setTimeout:(handler)=>{const id=++timerId;timers.set(id,handler);return id;},clearTimeout:id=>timers.delete(id),
    loadRoomMap:async()=>{},
    fetch:async(url,options)=>{fetchOptions.push(options);return {ok:true,json:async()=>({totalItems:records.length,items:url.includes('perPage=1')?records.slice(0,1):records})};},
  });
  const start=source.indexOf('let telemetryRefreshPending');
  const end=source.indexOf('// Helper to get actual aircon fleet count',start);
  vm.runInContext(source.slice(start,end)+'\n'+functions.join('\n'),context);
  context.render=()=>{context.populateDateRangeOptions();rendered.push(context.getFilteredLogs().map(log=>log.id));};
  context.setupEventListeners();
  return {context,date,rendered,fetchOptions,listeners,
    advance:ms=>{now+=ms;},
    add:()=>{records=[{id:'new',node_id:'node-1',sensor_name:'Controller 1',created:new Clock().toISOString()},...records];},
    replace:()=>{records=[{id:'replacement',node_id:'node-1',sensor_name:'Controller 1',created:new Clock().toISOString()}];},
    flush:async()=>{for(const [id,handler] of [...timers]) {timers.delete(id);handler();} await new Promise(setImmediate);},
  };
}

test('Daily Logs follows new entries across midnight instead of freezing at 11:17 PM',async()=>{
  const f=fixture();
  await f.context.fetchLogsFromDB();f.context.render();
  assert.equal(f.date.value,'2026-10-03');
  f.context.currentPage=4;
  f.advance(48*60*1000);f.add();
  f.listeners.get('ecotrack:telemetry-saved')();await f.flush();
  assert.equal(f.date.value,'2026-10-04');
  assert.equal(f.context.currentPage,1,'A new date starts on the newest page');
  assert.deepEqual(Array.from(f.rendered.at(-1)),['new']);
});

test('an automatically selected older date starts following when the first current-day entry arrives',async()=>{
  const f=fixture();f.advance(48*60*1000);
  await f.context.fetchLogsFromDB();f.context.render();
  assert.equal(f.date.value,'2026-10-03');
  f.add();f.listeners.get('ecotrack:telemetry-saved')();await f.flush();
  assert.equal(f.date.value,'2026-10-04');
});

test('manual historical dates stay fixed and resetting filters resumes live updates',async()=>{
  const f=fixture();await f.context.fetchLogsFromDB();
  f.advance(48*60*1000);f.add();await f.context.fetchLogsFromDB();f.context.render();
  f.listeners.get('date')({target:{value:'2026-10-03'}});
  const renders=f.rendered.length;
  f.advance(60000);f.add();f.listeners.get('ecotrack:telemetry-saved')();await f.flush();
  assert.equal(f.date.value,'2026-10-03');assert.equal(f.rendered.length,renders);
  f.listeners.get('reset')();
  f.listeners.get('ecotrack:telemetry-saved')();await f.flush();
  assert.equal(f.date.value,'2026-10-04');
});

test('polling detects a newer row when the record count stays the same',async()=>{
  const f=fixture();await f.context.fetchLogsFromDB();f.context.render();
  f.advance(60000);f.replace();
  assert.equal(typeof f.context.pollLatestTelemetry,'function');
  await f.context.pollLatestTelemetry();await f.flush();
  assert.deepEqual(Array.from(f.rendered.at(-1)),['replacement']);
  assert.ok(f.fetchOptions.every(options=>options?.cache==='no-store'),'Live reads must bypass stale HTTP cache');
});

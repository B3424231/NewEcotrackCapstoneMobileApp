const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
process.env.TZ='Asia/Singapore';
const source=fs.readFileSync(process.env.ECOTRACK_LOGS_SOURCE || path.resolve('../EcoTrackDesktopDashboardNew-main-control/public/js/logs.js'),'utf8');
const section=(start,end)=>{const offset=source.indexOf(start);assert.ok(offset>=0,start);const finish=source.indexOf(end,offset);assert.ok(finish>offset,end);return source.slice(offset,finish);};
const tree=ts.createSourceFile('logs.js',source,ts.ScriptTarget.Latest,true);
const names=['getPeriodDateKey','getPreviousPeriodDateKey','getDefaultDateKey'];
const functions=tree.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text)).map(node=>node.getText(tree));
const flush=()=>new Promise(setImmediate);
const settings=(temp=24)=>({power:true,temp,mode:'cool',fan:'medium',eco:false,turbo:false,swing_vertical:false,quiet:false,swing_horizontal:false,display:true});
const reading=(time,acOn,extra={})=>({nodeId:'node-1',timestamp:new Date(`2026-10-04T${time}+08:00`),temperature:25,status:'online',intervalSeconds:3600,controlSnapshot:{reported_state:settings(),reported_at:'2026-10-04T00:00:00+08:00'},...(acOn===undefined?{}:{acOn}),...extra});
function fixture({fleet=11,now=null,fetch=async()=>({ok:true,json:async()=>({kwh:2})})}={}){
 const elements=new Map(),charts=[],requests=[];
 class Clock extends Date {constructor(...args){super(...(args.length?args:now?[Date.parse(now)]:[]));}static now(){return now?Date.parse(now):Date.now();}}
 const context=vm.createContext({Date:Clock,AbortController,setTimeout,clearTimeout,console,BACKEND_URL:'http://backend',currentPeriod:'daily',selectedDateKey:'2026-10-04',currentPage:1,
  currentNodeFilter:'',startTimeFilter:'',endTimeFilter:'',currentEvaluatedKwh:null,currentEvaluatedCost:null,currentAnalyticsResult:null,
  nodeDataLogs:[],globalNodeRecords:[],controlNameMap:{},window:{},getActiveTariffRate:()=>10,getAirconFleetCount:()=>({total:fleet,online:fleet}),
  getDateRangeText:()=> 'October 4, 2026',getFilteredLogs:()=>context.nodeDataLogs,
  fetch:async(url,options)=>{
   const meta={model:'random_forest',output_unit:'kWh',horizon_hours:1,training_data_type:'research_informed_estimates',physical_accuracy_validated:false,environment_scenarios:[{scenario_id:'lab_hot'}]};
   if(url.includes('prediction-features'))return {ok:true,json:async()=>meta};
   const body=JSON.parse(options.body);assert.equal(body.model,'random_forest');assert.equal(body.scenario_id,'lab_hot');requests.push(body);
   const response=await fetch(url,options);return {ok:response.ok,json:async()=>({...meta,prediction_status:'research_estimate',scenario_id:'lab_hot',...(response.json?await response.json():{error:'offline'})})};
  },
  document:{documentElement:{classList:{contains:()=>true}},getElementById:id=>{
   if(!elements.has(id))elements.set(id,{textContent:'previous',innerHTML:'',style:{},className:'',classList:{contains:()=>true,toggle(){}},
    getContext:()=>({createLinearGradient:()=>({addColorStop(){}})})});return elements.get(id);
  }},Chart:class{constructor(canvas,configuration){this.data=configuration.data;this.options=configuration.options;this.updates=[];charts.push(this);}update(mode){this.updates.push(mode);}destroy(){throw Error('Do not destroy charts');}}
 });
 context.window=context;
 vm.runInContext(fs.readFileSync(path.resolve('../EcoTrackDesktopDashboardNew-main-control/public/js/aircon-state.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.resolve('../EcoTrackDesktopDashboardNew-main-control/public/js/energy-prediction.js'),'utf8'),context);
 vm.runInContext(section('function calculateEnergyCost(', 'function saveTariffSettings('),context);
 vm.runInContext(functions.join('\n'),context);
 vm.runInContext(section('function getConfirmedAcOnState(', '// Helper: Calculate previous period'),context);
 vm.runInContext(section('let currentPredictionSession', '// Convert 24-hour'),context);
 vm.runInContext(section('let energyTrendChartInstance','// ─── ENERGY CONSUMPTION PREDICTION'),context);
 vm.runInContext('selectedEnergyScenario="lab_hot"',context);
 const text=id=>elements.get(id)?.textContent;
 const run=async logs=>{context.nodeDataLogs=logs;await context.predictEnergyConsumption({totalRecords:logs.length,onlineNodes:`${fleet}/${fleet}`},logs);};
 return {context,elements,charts,requests,text,run};
}


const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const total=values=>values.reduce((sum,v)=>sum+(v??0),0);
test('unknown-only connectivity and requested controls do not invent confirmed power',async()=>{
 const f=fixture();await f.run([reading('06:00:00',undefined,{controlSnapshot:{desired_state:settings(),command_status:'queued'}})]);
 assert.equal(f.requests.length,0);assert.equal(f.context.currentEvaluatedKwh,null);assert.equal(f.text('kpiActiveUnits'),'Unavailable');
 assert.ok(f.charts[0].data.datasets[0].data.every(v=>v===null));
});
test('empty and invalid selections are unavailable',async()=>{
 const f=fixture();for(const rows of [[],[reading('06:00:00',true,{timestamp:'invalid'})],[reading('06:00:00',true,{eventType:'schedule_updated'})]]){
 await f.run(rows);assert.equal(f.context.currentEvaluatedKwh,null);assert.equal(f.requests.length,0);}
});
test('confirmed OFF yields zero excluding standby and leaves unobserved buckets empty',async()=>{
 const f=fixture({fleet:1});await f.run([reading('01:25:00',false,{controlSnapshot:null})]);
 assert.equal(f.context.currentEvaluatedKwh,0);assert.equal(f.requests.length,0);assert.equal(f.text('kpiActiveUnits'),'0');
 assert.equal(f.charts[0].data.datasets[0].data[0],0);assert.equal(f.charts[0].data.datasets[0].data[8],null);
});
test('a valid zero model result stays zero',async()=>{
 const f=fixture({fleet:1,fetch:async()=>({ok:true,json:async()=>({kwh:0})})});await f.run([reading('06:00:00',true)]);
 assert.equal(f.requests.length,1);assert.equal(f.context.currentEvaluatedKwh,0);assert.equal(f.text('kpiActiveUnits'),'1');
});
test('partial confirmed coverage counts ON, OFF and unknown separately',async()=>{
 const f=fixture();await f.run([reading('06:00:00',true),reading('06:00:00',false,{nodeId:'n2',controlSnapshot:null}),reading('06:00:00',undefined,{nodeId:'n3',controlSnapshot:null})]);
 near(f.context.currentEvaluatedKwh,2);assert.equal(f.text('kpiIdleUnits'),'1 confirmed off · 9 unknown');assert.match(f.text('analyticsDataStatus'),/Partial estimate/);
});
test('latest OFF or unknown feedback is not overridden by historical ON',async()=>{
 const f=fixture({fleet:1});for(const power of [false,undefined]){await f.run([reading('06:00:00',true),reading('06:30:00',power,{controlSnapshot:null})]);
 assert.equal(f.text('kpiActiveUnits'),power===false?'0':'Unavailable');assert.ok(f.context.currentAnalyticsResult.runtime.totalRuntimeSum>0);}
});
test('ambient temperature is not substituted for the commanded setpoint',async()=>{
 const f=fixture({fleet:1});await f.run([reading('06:00:00',true,{temperature:null})]);
 assert.equal(f.requests[0].settings.setpoint_c,24);assert.equal(Object.hasOwn(f.requests[0],'avg_temp'),false);near(f.context.currentEvaluatedKwh,2);
});
test('incomplete control functions block prediction instead of becoming assumed OFF',async()=>{
 const f=fixture({fleet:1});const row=reading('06:00:00',true);delete row.controlSnapshot.reported_state.eco;
 await f.run([row]);assert.equal(f.requests.length,0);assert.equal(f.context.currentEvaluatedKwh,null);
});
test('chart buckets conserve energy when an interval crosses a boundary',async()=>{
 const f=fixture({fleet:1,fetch:async()=>({ok:true,json:async()=>({kwh:8})})});
 await f.run([reading('01:29:00',true,{intervalSeconds:120}),reading('01:31:00',false,{controlSnapshot:null})]);
 const values=f.charts[0].data.datasets[0].data;near(values[0],8/60);near(values[1],8/60);near(total(values),8/30);near(total(f.charts[1].data.datasets[0].data),80/30);
});
test('previous-period cost uses that periods actual controls and hours',async()=>{
 const f=fixture({fleet:1,fetch:async(_u,o)=>({ok:true,json:async()=>({kwh:JSON.parse(o.body).settings.setpoint_c===24?8:4})})});
 const rows=[reading('06:00:00',true)],prior=reading('06:00:00',true,{timestamp:new Date('2026-10-03T06:00:00+08:00'),controlSnapshot:{reported_state:settings(26)}});
 f.context.nodeDataLogs=[...rows,prior];await f.context.predictEnergyConsumption({},rows);
 near(f.context.currentAnalyticsResult.previous.kwh,4);assert.equal(f.text('costVariance'),'+₱40.00');
 await f.run(rows);assert.equal(f.text('costPrevPeriod'),'Unavailable');
});
test('late predictions cannot overwrite a new unavailable selection',async()=>{
 let release;const f=fixture({fleet:1,fetch:()=>new Promise(r=>release=r)});
 const pending=f.run([reading('06:00:00',true)]);await flush();await f.run([]);release({ok:true,json:async()=>({kwh:99})});await pending;
 assert.equal(f.context.currentEvaluatedKwh,null);assert.equal(f.charts.length,3);
});
test('model failures remain unavailable; concurrency is at most three',async()=>{
 let active=0,peak=0;const f=fixture({fetch:async()=>{active++;peak=Math.max(peak,active);await flush();active--;return {ok:false};}});
 await f.run(Array.from({length:11},(_,i)=>reading('06:00:00',true,{nodeId:'n'+i,controlSnapshot:{reported_state:settings(16+i)}})));
 assert.equal(f.requests.length,11);assert.equal(peak,3);assert.equal(f.context.currentEvaluatedKwh,null);
});
test('aliases and duplicate readings cannot double-count energy',async()=>{
 const f=fixture({fleet:1});f.context.globalNodeRecords=[{id:'db',name:'node-1'}];
 await f.run([reading('06:00:00',true),reading('06:00:00',true,{nodeId:'db'})]);
 near(f.context.currentEvaluatedKwh,2);assert.equal(f.requests.length,1);assert.equal(f.text('kpiActiveUnits'),'1');
});
test('daily, weekly, monthly and yearly chart totals equal the estimate',async()=>{
 const f=fixture({fleet:1});for(const [period,key,size] of [['daily','2026-10-04',9],['weekly','2026-09-28',7],['monthly','2026-10',4],['yearly','2026',12]]){
 f.context.currentPeriod=period;f.context.selectedDateKey=key;await f.run([reading('06:00:00',true)]);
 const values=f.charts[0].data.datasets[0].data;assert.equal(values.length,size);near(total(values),2);}
 assert.equal(f.charts.length,3);
});
function forecast(){const f=fixture({fleet:1});f.context.globalNodeRecords=[{id:'node-1',wake_time:'06:00',sleep_time:'22:00'}];
 f.rows=[reading('03:00:00',undefined,{controlSnapshot:{desired_state:settings(),command_status:'queued'}})];return f;}
test('a complete schedule and requested state produce an explicitly labeled projection',async()=>{
 const f=forecast();await f.run(f.rows);near(f.context.currentEvaluatedKwh,32);assert.equal(f.text('kpiEnergyLabel'),'FORECAST ENERGY');
 assert.equal(f.text('kpiRuntimeVal'),'16.0');assert.equal(f.context.getConfirmedAcOnState(f.rows[0]),null);assert.equal(f.rows[0].controlSnapshot.command_status,'queued');
});
test('missing schedule or power cannot produce a projection',async()=>{
 for(const alter of [f=>f.context.globalNodeRecords=[],f=>delete f.rows[0].controlSnapshot.desired_state.power]){
 const f=forecast();alter(f);await f.run(f.rows);assert.equal(f.requests.length,0);assert.equal(f.context.currentEvaluatedKwh,null);}
});
test('requested OFF yields a zero schedule projection without confirming physical OFF',async()=>{
 const f=forecast();f.rows[0].controlSnapshot.desired_state.power=false;await f.run(f.rows);
 assert.equal(f.context.currentEvaluatedKwh,0);assert.equal(f.requests.length,0);assert.equal(f.context.getConfirmedAcOnState(f.rows[0]),null);
});
test('overnight schedules, time filters and calendar lengths bound projections',async()=>{
 const f=forecast();Object.assign(f.context.globalNodeRecords[0],{wake_time:'22:00',sleep_time:'06:00'});
 for(const [period,key,hours] of [['daily','2026-10-04',8],['weekly','2026-09-28',56],['monthly','2026-10',248],['yearly','2026',2920]]){
 f.context.currentPeriod=period;f.context.selectedDateKey=key;await f.run(f.rows);near(f.context.currentEvaluatedKwh,hours*2);near(total(f.charts[0].data.datasets[0].data),hours*2);}
 f.context.currentPeriod='daily';f.context.selectedDateKey='2026-10-04';f.context.startTimeFilter='02:00';f.context.endTimeFilter='04:00';await f.run(f.rows);near(f.context.currentEvaluatedKwh,4);
});
test('confirmed reported controls take precedence over schedule projections',async()=>{
 const f=forecast();await f.run([reading('06:00:00',true,{intervalSeconds:30})]);near(f.context.currentEvaluatedKwh,2/120);assert.equal(f.context.currentAnalyticsResult.forecast,false);
});
test('failed forecast requests cannot fall back to invented power rates',async()=>{
 const f=fixture({fleet:1,fetch:async()=>({ok:false})});f.context.globalNodeRecords=[{id:'node-1',wake_time:'06:00',sleep_time:'22:00'}];
 await f.run([reading('03:00:00',undefined,{controlSnapshot:{desired_state:settings()}})]);assert.equal(f.context.currentEvaluatedKwh,null);
});
test('missing cadence produces no energy while OFF evidence remains genuine zero',async()=>{
 const f=fixture({fleet:1});await f.run([reading('06:00:00',true,{intervalSeconds:null})]);assert.equal(f.requests.length,0);assert.equal(f.context.currentEvaluatedKwh,null);
 assert.equal(f.text('kpiRuntimeVal'),'Unavailable');
 await f.run([reading('06:00:00',false,{intervalSeconds:null,controlSnapshot:null})]);assert.equal(f.context.currentEvaluatedKwh,0);
});
test('no selected environment scenario cannot quietly become a default',async()=>{
 const f=forecast();vm.runInContext('selectedEnergyScenario=""',f.context);await f.run(f.rows);assert.equal(f.requests.length,0);assert.equal(f.context.currentEvaluatedKwh,null);
});
test('a projection is not a validated change against past confirmed consumption',async()=>{
 const f=forecast(),prior=reading('06:00:00',true,{timestamp:new Date('2026-10-03T06:00:00+08:00')});
 f.context.nodeDataLogs=[...f.rows,prior];await f.context.predictEnergyConsumption({},f.rows);assert.equal(f.context.currentAnalyticsResult.previous.complete,true);
 assert.equal(f.text('costVariance'),'Unavailable');assert.equal(f.text('kpiEnergyTrend'),'Unavailable');
});

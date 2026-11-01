const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fixtureSource=fs.readFileSync(path.join(__dirname,'test-energy-analytics.cjs'),'utf8').split("test('unknown-only")[0];
const {fixture,reading,source,tree,ts}=vm.runInNewContext(fixtureSource+'\n({fixture,reading,source,tree,ts})',{require,process,setImmediate,AbortController,console});
const plain=value=>JSON.parse(JSON.stringify(value));
function load(f,names){
 const nodes=tree.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text));
 assert.equal(nodes.length,names.length);vm.runInContext(nodes.map(node=>node.getText(tree)).join('\n'),f.context);
}
function auditFixture(options={}){
 const f=fixture(options);load(f,['calculateStats','computeConsumptionRankings','getBatteryPercentage','exportExcelLogs','exportLogs','addExtraPdfSections']);
 Object.assign(f.context,{globalAirconMap:{},globalInstallDateMap:{},locationMap:{},selectedAlgorithm:'xgb',ALGO_TO_MODEL:{xgb:'xgboost'},getUtilityProvider:()=> 'Test utility',getTargetBudget:()=>1000});
 return f;
}
function installExports(f){
 const pdf={texts:[],tables:[],saved:[],charts:[]},sheets=[];
 const errors=[];
 f.context.console={...console,error:(...args)=>errors.push(args),warn:(...args)=>errors.push(args)};
 f.context.window.EcoToast={success(){},info(){},warning(){},error:message=>errors.push(message)};
 f.context.window.electron={invoke:async()=>({success:true,data:[]})};f.context.sb=null;
 const canvas=()=>({style:{},getContext:()=>({}),toDataURL:()=> 'data:image/png;base64,AA==',click(){},remove(){},setAttribute(){}});
 f.context.document.createElement=canvas;
 f.context.document.body={appendChild(){},removeChild(){}};
 f.context.setTimeout=callback=>{callback();return 1;};
 f.context.URL={createObjectURL:()=> 'blob:test',revokeObjectURL(){}};f.context.Blob=Blob;
 f.context.Chart=class {constructor(_ctx,config){pdf.charts.push(config);}destroy(){}};
 f.context.window.jspdf={jsPDF:class {
  constructor(){let pages=1;
   const target={internal:{pageSize:{getWidth:()=>297,getHeight:()=>210},getNumberOfPages:()=>pages},
    addPage(){pages++;},text:value=>pdf.texts.push(value),splitTextToSize:value=>[value],getTextWidth:()=>30,
    autoTable(config){pdf.tables.push(config);this.lastAutoTable={finalY:(config.startY||20)+15};},save:filename=>pdf.saved.push(filename)};
   return new Proxy(target,{get:(obj,key)=>key in obj?obj[key]:()=>{}});
  }
 }};
 class Sheet {
  constructor(name){this.name=name;this.rows=new Map();this.cells=new Map();this.columns=Array.from({length:11},()=>({eachCell(){}}));sheets.push(this);}
  mergeCells(){}getCell(key){if(!this.cells.has(key))this.cells.set(key,{});return this.cells.get(key);}
  getRow(key){if(!this.rows.has(key)){const cells=new Map();this.rows.set(key,{cells,getCell(index){if(!cells.has(index))cells.set(index,{});return cells.get(index);},eachCell(fn){for(const [index,cell]of cells)fn(cell,index);}});}return this.rows.get(key);}
  addRow(values){const row=this.getRow(this.rows.size+1);row.values=values;values.forEach((value,index)=>{row.getCell(index+1).value=value;});return row;}
 }
 f.context.ExcelJS={Workbook:class {constructor(){this.xlsx={writeBuffer:async()=>Buffer.alloc(0)};}addWorksheet(name){return new Sheet(name);}}};
 return {pdf,sheets,errors};
}
const job=(log,kwh)=>({id:log.nodeId,logs:[log],kwh});
test('rankings use evaluated energy rather than off-packet frequency and retain real category sums',()=>{
 const f=auditFixture(),a=reading('06:00:00',true,{nodeId:'a',buildingName:'main',roomName:'room a',floorName:'1',controlName:'A'}),
 b=reading('06:00:00',true,{nodeId:'b',buildingName:'main',roomName:'room b',floorName:'2',controlName:'B'}),off=reading('06:00:00',false,{nodeId:'idle',buildingName:'idle'});
 f.context.nodeDataLogs=Array.from({length:1000},()=>off);
 const result={kwh:40,nodes:[job(a,30),job(b,10),{logs:f.context.nodeDataLogs,kwh:0},job({...off,nodeId:'unknown'},null)]};
 const ranks=f.context.computeConsumptionRankings(result);
 assert.deepEqual(plain(ranks.controls),[{name:'A',share:75,kwh:30,cost:300},{name:'B',share:25,kwh:10,cost:100}]);
 assert.equal(ranks.buildings.length,1);assert.equal(ranks.buildings[0].kwh,40);assert.equal(ranks.rooms[0].name,'Room A');
 assert.equal(f.context.computeConsumptionRankings({kwh:null,nodes:[]}).totalKwh,null);
 assert.equal(f.context.computeConsumptionRankings({kwh:0,nodes:[job(off,0)]}).controls.length,0);
});
test('temperature statistics exclude invalid values and never coerce blanks into zero degrees',()=>{
 const f=auditFixture();f.context.nodeDataLogs=[null,undefined,'',' ',NaN,Infinity,25,'27'].map(temperature=>reading('06:00:00',true,{temperature}));
 assert.equal(f.context.calculateStats().avgTemp,26);f.context.nodeDataLogs=f.context.nodeDataLogs.slice(0,6);assert.equal(f.context.calculateStats().avgTemp,'--');
});
test('missing sensors use a labeled saved setpoint in forecasts without changing raw telemetry',async()=>{
 const f=auditFixture({fleet:1,now:'2026-10-04T03:00:00+08:00'});
 f.context.globalNodeRecords=[{id:'node-1',name:'node-1',wake_time:'06:00',sleep_time:'22:00'}];
 const log=reading('03:00:00',undefined,{temperature:null,controlSnapshot:{configured_state:{mode:'cool',temp:27}}});await f.run([log]);
 assert.equal(f.requests[0].avg_temp,27);assert.match(f.text('analyticsDataStatus'),/Temperature missing.*saved setpoint/);
 assert.equal(log.temperature,null);assert.equal(f.context.getConfirmedAcOnState(log),null);assert.match(f.context.getAnalyticsExportData().temperatureAssumptions,/saved setpoint/);
});
test('chart scales stay finite and zero usage has no peak; missing tooltip values remain unavailable',async()=>{
 const f=auditFixture({fleet:1});for(const values of [[],[null,NaN,Infinity]])assert.equal(f.context.getFiniteChartMaximum(values,5,10),10);
 await f.run([reading('01:00:00',false)]);
 assert.ok(f.charts[1].data.datasets[0].backgroundColor.every(color=>color!=='#f59e0b'));
 for(const chart of f.charts){const label=chart.options.plugins.tooltip.callbacks.label;
  for(const raw of [null,NaN,undefined])assert.match(label({raw,dataset:chart.data.datasets[0]}),/Unavailable/);
  assert.doesNotMatch(label({raw:0,dataset:chart.data.datasets[0]}),/Unavailable/);
 }
 await f.run([reading('06:00:00',true)]);assert.ok(f.charts[1].data.datasets[0].backgroundColor.includes('#f59e0b'));
 await f.run([]);assert.ok(f.charts[1].data.datasets[0].backgroundColor.every(color=>color!=='#f59e0b'));
 for(const chart of f.charts)for(const scale of Object.values(chart.options.scales))if('max'in scale)assert.ok(Number.isFinite(scale.max));
});
test('comparison colors reflect decreases and increases only when coverage supports comparison',async()=>{
 const f=auditFixture({fleet:1});await f.run([reading('06:00:00',true)]);
 const r=f.context.currentAnalyticsResult;r.previous={complete:true,kwh:4,cost:40,runtime:1};
 f.context.updateKpiCardsTrends('daily',false,2,20,0.5);assert.match(f.elements.get('kpiEnergyTrend').className,/emerald/);
 f.context.updateKpiCardsTrends('daily',false,8,80,2);assert.match(f.elements.get('kpiCostTrend').className,/rose/);
 r.previous.complete=false;f.context.updateKpiCardsTrends('daily',false,8,80,2);assert.match(f.elements.get('kpiCostTrend').className,/slate/);
});
test('PDF and Excel exports preserve unavailable energy, missing temperatures and unknown power ratios',async()=>{
 const f=auditFixture({fleet:1}),log=reading('03:00:00',undefined,{temperature:null,battery:80,rssi:-50});await f.run([log]);
 const out=installExports(f);await f.context.exportExcelLogs();await f.context.exportLogs();
 assert.deepEqual(out.errors,[]);assert.equal(out.pdf.saved.length,1);
 const summary=out.sheets[0];const kpiRows=[...summary.rows.values()].map(row=>[...row.cells.values()].map(cell=>cell.value));
 assert.ok(kpiRows.some(row=>row[0]==='Estimated Energy'&&row[1]==='Unavailable'));
 assert.ok(kpiRows.some(row=>row[0]==='Estimated Electricity Cost'&&row[1]==='Unavailable'));
 const aggregation=out.pdf.tables.find(table=>table.head?.[0]?.includes('AC Active (%)'));assert.ok(aggregation);
 assert.equal(aggregation.body[0][3],'Unavailable');
 const all=JSON.stringify(out.pdf.tables)+JSON.stringify(out.pdf.texts);assert.doesNotMatch(all,/NaN|Infinity|null kWh/);
 assert.ok(out.pdf.charts[0].data.datasets.every(dataset=>dataset.data.every(value=>value===null)));
});
test('PDF uses the evaluated chart series, real prior estimates, state variants and identical room totals',async()=>{
 const f=auditFixture({fleet:2});
 const logs=[reading('01:29:00',true,{intervalSeconds:120,battery:80,rssi:-50,buildingName:'Main',floorName:'1',roomName:'A'}),reading('01:31:00',false,{battery:80,rssi:-50,buildingName:'Main',floorName:'1',roomName:'A'}),
 reading('06:00:00',undefined,{nodeId:'node-2',ac_on:1,battery:80,rssi:-50,buildingName:'Main',floorName:'1',roomName:'B'})];
 await f.run(logs);const r=f.context.currentAnalyticsResult;r.previous={complete:true,nodes:r.nodes,kwh:r.kwh,cost:r.cost};
 const expected=plain(f.charts[0].data.datasets[0].data),count=f.requests.length,out=installExports(f);await f.context.exportLogs();
 assert.deepEqual(out.errors,[]);assert.equal(out.pdf.saved.length,1);assert.equal(f.requests.length,count,'PDF must not issue independent energy predictions');
 assert.deepEqual(plain(out.pdf.charts[1].data.datasets[0].data),expected);
 assert.deepEqual(plain(out.pdf.charts[1].data.datasets[1].data),expected);
 const agg=out.pdf.tables.find(table=>table.head?.[0]?.includes('AC Active (%)'));assert.equal(agg.body.find(row=>row[0]==='node-2')[3],'100%');
 const ranking=out.pdf.tables.find(table=>table.head?.[0]?.includes('Rank'));assert.equal(ranking.body.length,2);
 assert.equal(ranking.body.reduce((sum,row)=>sum+parseFloat(row[4]),0),r.kwh);
});
test('genuine zero remains zero in PDF and Excel even if displayed totals are stale',async()=>{
 const f=auditFixture({fleet:1});await f.run([reading('03:00:00',false,{temperature:25,battery:80,rssi:-50})]);
 f.elements.get('energyConsumption').textContent='99 kWh';const out=installExports(f);await f.context.exportExcelLogs();await f.context.exportLogs();
 assert.deepEqual(out.errors,[]);assert.equal(out.pdf.saved.length,1);
 assert.ok(out.pdf.texts.flat().includes('0.0 kWh'));assert.ok(out.pdf.texts.flat().includes('PHP 0.00'));
 const rows=[...out.sheets[0].rows.values()].map(row=>[...row.cells.values()].map(cell=>cell.value));assert.ok(rows.some(row=>row[0]==='Estimated Energy'&&row[1]==='0.0'));
 const agg=out.pdf.tables.find(table=>table.head?.[0]?.includes('AC Active (%)'));assert.equal(agg.body[0][3],'0%');
});

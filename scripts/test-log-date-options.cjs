const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync(process.env.ECOTRACK_LOGS_SOURCE || path.resolve('../EcoTrackDesktopDashboardNew-main-control/public/js/logs.js'),'utf8');
const tree=ts.createSourceFile('logs.js',source,ts.ScriptTarget.Latest,true);
const names=['getPeriodDateKey','getPeriodDateLabel','getDefaultDateKey','getAvailableDateKeys','populateDateRangeOptions','setupEventListeners'];
const functions=[];
const visit=node=>{if(ts.isFunctionDeclaration(node)&&names.includes(node.name?.text))functions.push(node.getText(tree));ts.forEachChild(node,visit);};visit(tree);

function fixture(days=5000) {
 const now=new Date(2026,9,4,1,40).getTime();
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const listeners=new Map(),date={dataset:{},value:'',innerHTML:'',addEventListener:(name,fn)=>listeners.set('date:'+name,fn)};
 const picker={style:{display:'none'},value:'',min:'',max:'',validity:'',focused:false,
  setCustomValidity(message){this.validity=message;},reportValidity(){this.reported=true;},focus(){this.focused=true;},
  showPicker(){throw Error('Native picker unavailable');},addEventListener:(name,fn)=>listeners.set('picker:'+name,fn)};
 const context=vm.createContext({Date:Clock,console,nodeDataLogs:[],currentPeriod:'daily',selectedDateKey:'2026-10-04',
  followLatestLogPeriod:false,currentPage:5,currentNodeFilter:'node-1',startTimeFilter:'01:15',endTimeFilter:'02:15',
  window:{},document:{getElementById:id=>id==='dateRangeSelect'?date:id==='historyDatePicker'?picker:null,querySelectorAll:()=>[]}});
 vm.runInContext(functions.join('\n'),context);
 for(let i=0;i<days;i++){const timestamp=new Clock();timestamp.setDate(timestamp.getDate()-i);context.nodeDataLogs.push({id:'row-'+i,nodeId:'node-1',timestamp});}
 let renders=0;context.render=()=>{renders++;context.populateDateRangeOptions();};
 context.setupEventListeners();context.populateDateRangeOptions();
 const options=()=>Array.from(date.innerHTML.matchAll(/<option value="([^"]+)"/g),match=>match[1]);
 return {context,date,picker,listeners,options,renders:()=>renders};
}

test('date dropdown has at most seven dates and one calendar choice after years of records',()=>{
 const f=fixture();assert.equal(f.options().length,8);
 assert.deepEqual(f.options().slice(0,2),['2026-10-04','2026-10-03']);
 assert.equal(f.options().at(-1),'__older__');
 for(let i=1;i<=20;i++){
  f.context.nodeDataLogs.push({timestamp:new Date(2026,9,4+i)});
  f.context.populateDateRangeOptions();assert.equal(f.options().length,8);
  assert.ok(f.options().includes('2026-10-04'),'The selected date remains available within the fixed cap');
 }
});

test('calendar opens without changing filters and chooses older records without growing the list',()=>{
 const f=fixture();f.listeners.get('date:change')({target:{value:'__older__'}});
 assert.equal(f.picker.style.display,'');assert.equal(f.picker.focused,true);
 assert.equal(f.context.selectedDateKey,'2026-10-04');assert.equal(f.renders(),0);
 f.picker.value='2025-06-12';f.listeners.get('picker:change')();
 assert.equal(f.context.selectedDateKey,'2025-06-12');assert.equal(f.context.followLatestLogPeriod,false);
 assert.equal(f.context.currentPage,1);assert.equal(f.picker.style.display,'none');
 assert.equal(f.options().length,8);assert.ok(f.options().includes('2025-06-12'));
 assert.equal(f.context.currentNodeFilter,'node-1');assert.equal(f.context.startTimeFilter,'01:15');assert.equal(f.context.endTimeFilter,'02:15');
});

test('an explicit unrecorded calendar date stays selected so analytics can show its empty state',()=>{
 const f=fixture(8);f.listeners.get('date:change')({target:{value:'__older__'}});
 f.picker.value='2020-01-01';f.listeners.get('picker:change')();
 assert.equal(f.context.selectedDateKey,'2020-01-01');assert.equal(f.context.currentPage,1);
 assert.equal(f.context.followLatestLogPeriod,false);assert.equal(f.date.value,'2020-01-01');
 assert.equal(f.picker.validity,'');assert.equal(f.picker.style.display,'none');assert.equal(f.renders(),1);
 assert.ok(f.options().includes('2020-01-01'));assert.ok(f.options().length<=8);
 f.listeners.get('picker:input')();assert.equal(f.picker.validity,'');
});

test('calendar chooses the corresponding week, month or year while keeping each dropdown bounded',()=>{
 for(const [period,expected] of [['weekly','2025-06-09'],['monthly','2025-06'],['yearly','2025']]){
  const f=fixture();f.context.window.setPeriod(period);
  assert.ok(f.options().length<=8,period);
  f.listeners.get('date:change')({target:{value:'__older__'}});
  f.picker.value='2025-06-12';f.listeners.get('picker:change')();
  assert.equal(f.context.selectedDateKey,expected);assert.ok(f.options().length<=8);
 }
});

test('short history remains a simple dropdown without a redundant calendar choice',()=>{
 const f=fixture(4);assert.equal(f.options().length,4);assert.equal(f.options().includes('__older__'),false);
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=process.env.ECOTRACK_MOBILE_ROOT || path.resolve(__dirname,'..');
const projectRequire=require('node:module').createRequire(path.join(root,'package.json'));
const ts=require(path.join(root,'node_modules/typescript'));
function harness(){const prefix=fs.readFileSync(path.join(root,'scripts/test-cloud-hardware-integration.cjs'),'utf8').split('\ntest(')[0];return vm.runInNewContext(prefix+';harness;', {require:projectRequire,console})(()=>({data:[],error:null}));}
const at='2026-10-11T08:00:00Z',later='2026-10-11T08:00:02Z';
test('requested target snapshots update setpoint while preserving measured outlet temperature and unknown power',()=>{
 const {applyHomeControllerState}=harness().load(path.join(root,'src/services/home-controller-state.ts'));
 const item={id:'node',name:'AC',roomId:'room',ventTemp:'18.0 °C',settingsSnapshot:{configured_state:{temp:22}}};
 const next=applyHomeControllerState(item,{node_id:'node',device_id:'',control_snapshot:{desired_state:{temp:24},commanded_at:at}});
 assert.equal(next.setpoint,24);assert.equal(next.ventTemp,'18.0 °C');assert.equal(next.powerFeedback,undefined);
 const older=applyHomeControllerState(next,{node_id:'node',device_id:'',control_snapshot:{desired_state:{temp:20},commanded_at:'2026-10-11T07:59:00Z'}});
 assert.equal(older.setpoint,24);
});
test('full inventory fetch merges independent settings clocks rather than heartbeat freshness',()=>{
 const {applyHomeControllerState,mergeHomeControllerFetch}=harness().load(path.join(root,'src/services/home-controller-state.ts'));
 const item={id:'node',name:'Old name',roomId:'room',settingsSnapshot:{desired_state:{temp:22},commanded_at:at}};
 const current=applyHomeControllerState({...item,settingsSnapshot:{desired_state:{temp:26},commanded_at:later}});
 const merged=mergeHomeControllerFetch([{...item,name:'New name'}],[current])[0];
 assert.equal(merged.name,'New name');assert.equal(merged.setpoint,26);
 const fresh=mergeHomeControllerFetch([{...item,settingsSnapshot:{desired_state:{temp:27},commanded_at:'2026-10-11T08:00:03Z'}}],[current])[0];
 assert.equal(fresh.setpoint,27);
});
function render(file,item){
 const h=harness(),react={useMemo:fn=>fn(),useRef:value=>({current:value}),useEffect(){},useState:value=>[value,()=>{}],createElement:(type,props,...children)=>({type,props:{...props,children}})};
 const style={create:x=>x,absoluteFill:{}},module={exports:{}};
 const mocks={react,'react-native':{View:'View',Pressable:'Pressable',Animated:{View:'AnimatedView'},ScrollView:'ScrollView',StyleSheet:style},'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'expo-router':{router:{push(){}}},'./themed-text':{ThemedText:'Text'},'./app-icon':{AppIcon:'Icon'},'./location-icon':{LocationIcon:'Icon'},'@/context/settings-context':{useSettings:()=>({colors:{},effectiveTheme:'light',formatTemperatureDisplay:n=>n+' °C'})},'@/context/auth-context':{useAuth:()=>({userId:'test',userType:'staff'})},'@/constants/theme':{Colors:{light:{},dark:{}}},'@/services/supabase':{supabase:{}},'@/services/controller-display':h.load(path.join(root,'src/services/controller-display.ts')),'@/services/airflow-pressure':h.load(path.join(root,'src/services/airflow-pressure.ts')),'@/services/sensor-readings':h.load(path.join(root,'src/services/sensor-readings.ts'))};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,{module,exports:module.exports,require:name=>{assert(name in mocks,name);return mocks[name];}});
 const component=module.exports.AcControllerCard || module.exports.AcControllerDetailSheet;
 const tree=component({controller:item,onPress(){},visible:true,onClose(){},slideAnim:0});
 const text=value=>value==null?'':typeof value==='object'?Array.isArray(value)?value.map(text).join(' '):text(value.props?.children):String(value);
 return text(tree);
}
test('actual card and its details keep Temperature label and show target 24 instead of outlet 18',()=>{
 for(const file of ['src/components/sensor-card.tsx','src/components/sensor-detail-sheet.tsx']){
  const item={id:'node',name:'AC',deviceMode:'both',setpoint:24,ventTemp:'18.0 °C',rotation_rpm:600,rotation_quality:'ok',sensorConfig:{airflow_reference:{rpm:1200}}};
  const text=render(file,item);assert.match(text,/Temperature\s+24 °C/);assert.match(text,/AC target setpoint/);assert.doesNotMatch(text,/18\.0|18 °C/);assert.match(text,/50%/);
  const missing=render(file,{...item,setpoint:undefined});assert.match(missing,/Temperature\s+Unavailable/);assert.doesNotMatch(missing,/18\.0|18 °C/);
 }
});
test('scoped fallback reads the linked desktop AC target even without a new sensor measurement',async()=>{
 const prefix=fs.readFileSync(path.join(root,'scripts/test-backend.cjs'),'utf8').split('const service = h =>')[0];
 const make=vm.runInNewContext(prefix+';harness;', {require:projectRequire,console,process,Response,Blob,URL,Date,Uint8Array,ArrayBuffer,setTimeout,clearTimeout});
 const h=make(call=>({data:call.table==='aircons'?[{id:'ac',desired_state:{temp:25},commanded_at:later}]:call.table==='nodes'?[{id:'node',temp:18,updated:later}]:[],error:null}));
 const rows=await h.load(path.join(root,'src/services/supabase.ts')).fetchLiveSensorReadings(['node'],{node:'ac'});
 assert.equal(rows.length,1);assert.equal(rows[0].control_snapshot.desired_state.temp,25);
 const query=h.calls.find(call=>call.table==='aircons');assert(query.ops.some(op=>op[0]==='in'&&op[1]==='id'&&op[2].length===1&&op[2][0]==='ac'));
});

test('an in-flight fallback cannot apply the previous assigned AC target to the current card',()=>{
 const source=fs.readFileSync(path.join(root,'src/app/index.tsx'),'utf8');
 const begin=source.indexOf('.then(results => {'),end=source.indexOf(').catch(',begin);
 assert(begin>=0&&end>begin);
 const callback=source.slice(begin+6,end),home=harness().load(path.join(root,'src/services/home-controller-state.ts'));
 let output;
 const module={exports:{}};
 const current=home.applyHomeControllerState({id:'node',roomId:'room',airconId:'new-ac',settingsSnapshot:{configured_state:{temp:26}}});
 vm.runInNewContext(ts.transpileModule('exports.apply='+callback,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,disposed:false,refresh:{isActive:()=>true},isSessionCurrent:()=>true,airconIds:{node:'old-ac'},setControllers:fn=>{output=fn([current]);},applyHomeControllerState:home.applyHomeControllerState});
 module.exports.apply([{status:'fulfilled',value:[]},{status:'fulfilled',value:[{node_id:'node',device_id:'',control_snapshot:{desired_state:{temp:24},commanded_at:at}}]}]);
 assert.equal(output[0].setpoint,26);
});
test('foreground fallback preserves measured fields and old target on a denied current-settings read',async()=>{
 const prefix=fs.readFileSync(path.join(root,'scripts/test-backend.cjs'),'utf8').split('const service = h =>')[0];
 const make=vm.runInNewContext(prefix+';harness;', {require:projectRequire,console,process,Response,Blob,URL,Date,Uint8Array,ArrayBuffer,setTimeout,clearTimeout});
 const h=make(call=>call.table==='aircons'?{data:null,error:{message:'Denied'}}:{data:call.table==='nodes'?[{id:'node',temp:18,updated:later}]:[],error:null});
 const row=(await h.load(path.join(root,'src/services/supabase.ts')).fetchLiveSensorReadings(['node'],{node:'ac'}))[0];
 assert.equal(row.temp,18);assert.equal(row.control_snapshot,undefined);
 const home=harness().load(path.join(root,'src/services/home-controller-state.ts'));
 const item=home.applyHomeControllerState({id:'node',airconId:'ac',settingsSnapshot:{desired_state:{temp:24},commanded_at:at}});
 assert.equal(home.applyHomeControllerState(item,row).setpoint,24);
});

test('a fresh inventory configuration is not overwritten by its previous untimestamped defaults',()=>{
 const {applyHomeControllerState,mergeHomeControllerFetch}=harness().load(path.join(root,'src/services/home-controller-state.ts'));
 const old=applyHomeControllerState({id:'node',roomId:'room',airconId:'ac',settingsSnapshot:{configured_state:{temp:22}}});
 const fetched=applyHomeControllerState({...old,settingsSnapshot:{configured_state:{temp:24}}});
 assert.equal(mergeHomeControllerFetch([fetched],[old])[0].setpoint,24);
});

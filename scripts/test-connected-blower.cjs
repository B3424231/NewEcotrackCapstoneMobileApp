const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),SSR=require('react-dom/server'),Web=require('react-native-web');
const now=Date.parse('2026-10-26T10:00:00Z'),at=new Date(now).toISOString(),cache=new Map();
class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));}static now(){return now;} }
const colors={text:'#111827',textSecondary:'#64748b',emerald:'#047857',border:'#ddd',panelBorder:'#ddd',background:'#fff',backgroundElement:'#fff',success:'#047857',warning:'#d97706',textMuted:'#94a3b8'};
function load(file){
 file=path.resolve(file);if(!path.extname(file))file+='.ts';if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 const req=name=>{
  if(name==='react')return React;
  if(name==='react-native')return Web;
  if(name==='react-native-safe-area-context')return {SafeAreaView:Web.View};
  if(name==='expo-router')return {router:{push(){}}};
  if(name==='@/context/settings-context')return {useSettings:()=>({effectiveTheme:'light',colors,formatTemperatureDisplay:x=>x+' °C'})};
  if(name==='@/context/auth-context')return {useAuth:()=>({userType:'staff',userId:'fixture'})};
  if(name==='@/constants/theme')return {Colors:{light:colors,dark:colors}};
  if(name.includes('themed-text'))return {ThemedText:({children,...props})=>React.createElement(Web.Text,props,children)};
  if(name.includes('app-icon'))return {AppIcon:()=>null};
  if(name.includes('location-icon'))return {LocationIcon:()=>null};
  if(name==='@/services/supabase')return {supabase:{}};
  if(name.startsWith('@/'))return load(path.resolve('src',name.slice(2)));
  if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name));
  throw Error('Unexpected '+name);
 };
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:req,Date:Clock,console,AbortController,setTimeout,clearTimeout},{filename:file});return module.exports;
}
const airflow=load('src/services/airflow-pressure.ts'),display=load('src/services/controller-display.ts');
const item={id:'monitor',name:'Test device',deviceMode:'monitoring',rotation_rpm:600,rotation_quality:'ok',measurementAt:at,reportIntervalSeconds:5,sensorConfig:{airflow_reference:{rpm:1200}},settingsSnapshot:{desired_state:{fan:'auto',mode:'dry'},commanded_at:at}};
test('measured blower reading is independent of Auto, Low, Medium or High setting',()=>{
 for(const fan of ['auto','low','medium','high']){
  const reading=display.blowerFanReading({...item,settingsSnapshot:{desired_state:{fan},commanded_at:at}},now);
  assert.equal(reading.value,'600 RPM');assert.match(reading.detail,new RegExp(fan,'i'));
 }
 assert.equal(display.blowerFanReading({...item,rotation_rpm:900},now).value,'900 RPM');
 assert.equal(display.blowerFanReading({...item,rotation_rpm:0},now).value,'0 RPM');
 assert.equal(display.blowerFanReading({...item,rotation_rpm:0},now).value,'0 RPM');
});
test('missing, invalid, stale, future, and wrong-quality values stay unavailable',()=>{
 for(const patch of [{rotation_rpm:null},{rotation_rpm:-1},{rotation_quality:'fault'},{rotation_quality:'out_of_range'},{measurementAt:undefined},{measurementAt:new Date(now-16000).toISOString()},{measurementAt:new Date(now+6000).toISOString()}]){
  const reading=display.blowerFanReading({...item,...patch},now);assert.equal(reading.value,'—');assert.doesNotMatch(reading.detail,/600 RPM/);
 }
 const uncalibrated=display.blowerFanReading({...item,sensorConfig:null},now);assert.equal(uncalibrated.value,'600 RPM');
});
test('Analytics raw RPM average is weighted by real valid samples, independent of reference settings',()=>{
 const groups=[{node_id:'a',rotation_avg:600,rotation_count:2},{node_id:'b',rotation_avg:1200,rotation_count:1}];
 assert.equal(airflow.airflowRpmAverage(groups),800);assert.equal(airflow.airflowRpmAverage([{node_id:'a',rotation_avg:0,rotation_count:2}]),0);
 assert.equal(airflow.airflowRpmAverage([{node_id:'a',rotation_avg:-1,rotation_count:2}]),null);
 assert.equal(airflow.airflowRpmAverage([]),null);
});
test('RPM formatting preserves real zero and rejects invalid values without requiring a reference',()=>{
 assert.equal(airflow.airflowRpmText(600,'ok'),'600 RPM');assert.equal(airflow.airflowRpmText(0,'ok'),'0 RPM');
 for(const value of [null,undefined,NaN,Infinity,-1,'600'])assert.equal(airflow.airflowRpmText(value,'ok'),'—');
 assert.equal(airflow.airflowRpmText(600,'fault'),'—');assert.equal(airflow.airflowPercent(600,'ok',{airflow_reference:{rpm:1200}}),50);
});

test('actual mobile card and details display current fan with measured RPM and unchanged labels',()=>{
 const Card=load('src/components/sensor-card.tsx').AcControllerCard,Detail=load('src/components/sensor-detail-sheet.tsx').AcControllerDetailSheet;
 for(const Component of [Card,Detail]){
  const html=SSR.renderToStaticMarkup(React.createElement(Component,{controller:item,onPress(){},visible:true,onClose(){},slideAnim:new Web.Animated.Value(0)}));
  assert.match(html,/Airflow Indicator \(RPM\)/);assert.match(html,/600 RPM/);assert.match(html,/Auto/);assert.match(html,/Aircon state/);assert.match(html,/Dry/);
 }
});

test('Home labels measured wheel RPM as Blower Fan Speed while keeping fan setting separate',()=>{
 const Card=load('src/components/sensor-card.tsx').AcControllerCard;
 const render=patch=>SSR.renderToStaticMarkup(React.createElement(Card,{controller:{...item,...patch},onPress(){}}));
 for(const deviceMode of ['monitoring','both']){
  const html=render({deviceMode});
  assert.match(html,/Airflow Indicator \(RPM\)/);
  assert.match(html,/Blower Fan Speed: 600 RPM/);
  assert.match(html,/>Auto</,'The selected fan setting remains a separate value');
 }
 assert.match(render({rotation_rpm:0}),/Blower Fan Speed: 0 RPM/);
 assert.match(render({sensorConfig:null}),/Blower Fan Speed: 600 RPM/);
 for(const patch of [{rotation_rpm:null},{rotation_rpm:NaN},{rotation_rpm:Infinity},{rotation_rpm:'600'},{rotation_rpm:-1},{rotation_quality:'fault'},{rotation_quality:'missing'},{rotation_quality:'out_of_range'},{measurementAt:undefined},{measurementAt:new Date(now-16000).toISOString()},{measurementAt:new Date(now+6000).toISOString()}]){
  const html=render(patch);
  assert.match(html,/Blower Fan Speed: Unavailable/);
  assert.doesNotMatch(html,/600 RPM/,'Unavailable readings never display a fabricated measurement');
 }
 assert.doesNotMatch(render({deviceMode:'controller'}),/Blower Fan Speed:|Airflow Indicator \(RPM\)/,'Controller-only cards do not claim a measurement');
});

if(process.env.ECOTRACK_BLOWER_VISUAL_DIR){
 const out=path.resolve(process.env.ECOTRACK_BLOWER_VISUAL_DIR);fs.mkdirSync(out,{recursive:true});
 const Card=load('src/components/sensor-card.tsx').AcControllerCard,Detail=load('src/components/sensor-detail-sheet.tsx').AcControllerDetailSheet;
 for(const width of [320,390])for(const [kind,Component] of [['card',Card],['details',Detail]]){
  const key='blower-'+kind+'-'+width;
  Web.AppRegistry.registerComponent(key,()=>()=>React.createElement(Web.View,{style:{width,height:844,padding:kind==='card'?16:0,backgroundColor:'#eefbf4',position:'relative'}},
   React.createElement(Component,{controller:item,onPress(){},visible:true,onClose(){},slideAnim:new Web.Animated.Value(0)})));
  const app=Web.AppRegistry.getApplication(key),html=SSR.renderToStaticMarkup(app.element),css=SSR.renderToStaticMarkup(app.getStyleElement());
  fs.writeFileSync(path.join(out,key+'.html'),'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+css+'<style>html,body{margin:0}</style>'+html);
 }
 console.log('Rendered isolated mobile card/details fixtures with real React Native Web styles.');
}

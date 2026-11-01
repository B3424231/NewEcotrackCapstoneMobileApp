const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript'),React=require('react'),Web=require('react-native-web'),SSR=require('react-dom/server');
const out=path.resolve('C:/Users/reygay/Documents/Codex/2026-10-16/with-x20/work/ecotrack-app-update/mobile-visual');fs.mkdirSync(out,{recursive:true});
let theme='dark',scale=1;
let palettes;
const cache=new Map();
function load(file){
 file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 const req=name=>{
  if(name==='react')return React;
  if(name==='@/global.css')return {};
  if(name==='@/constants/theme')return load('src/constants/theme.ts');
  if(name==='@/services/sensor-readings')return load('src/services/sensor-readings.ts');
  if(name==='react-native')return Web;
  if(name==='react-native-safe-area-context')return {SafeAreaView:({children,style})=>React.createElement(Web.View,{style},children)};
  if(name==='expo-router')return {router:{push(){}}};
  if(name==='@/context/settings-context')return {useSettings:()=>({effectiveTheme:theme,colors:palettes[theme],formatTemperatureDisplay:n=>n.toFixed(1)+' °C'})};
  if(name.includes('themed-text'))return {ThemedText:({style,children,...rest})=>{
   const s=Web.StyleSheet.flatten([{fontSize:16,lineHeight:24,fontWeight:500},style])||{};
   return React.createElement(Web.Text,{...rest,style:{...s,fontSize:s.fontSize*scale,lineHeight:s.lineHeight*scale}},children);
  }};
  if(name.includes('app-icon'))return {AppIcon:({size=14,color='#10b981'})=>React.createElement(Web.View,{style:{width:size,height:size,borderRadius:4,borderWidth:2,borderColor:color}})};
  if(name.includes('location-icon'))return {LocationIcon:({size=14,color='#10b981'})=>React.createElement(Web.View,{style:{width:size,height:size,borderRadius:8,borderWidth:2,borderColor:color}})};
  if(name==='@/services/controller-display')return load('src/services/controller-display.ts');
  if(name.startsWith('./'))return load(path.resolve(path.dirname(file),name+'.ts'));
  throw Error('Unexpected visual dependency '+name);
 };
 vm.runInNewContext(code,{module,exports:module.exports,require:req,console,Date});return module.exports;
}
palettes=load('src/constants/theme.ts').Colors;
const Picker=load('src/components/ac-device-type-picker.tsx').AcDeviceTypePicker;
const Card=load('src/components/sensor-card.tsx').AcControllerCard,Detail=load('src/components/sensor-detail-sheet.tsx').AcControllerDetailSheet,Steps=load('src/components/controller-registration-steps.tsx').ControllerRegistrationSteps;
const item={id:'node-fixture',name:'Ac Controller 1',connectionState:'online',powerSetting:'off',operatingMode:'heat',fanMode:'auto',setpoint:16,status:'optimal',statusLabel:'Online',building:'IC building',floor:'Floor 1',room:'Room 1',location:'Room 1',associatedAc:'TCL Split Type (Inverter)',acType:'Split Type (Inverter)',deviceMode:'both',rotation_rpm:75.5,rotation_quality:'ok',ventTemp:'24.5 °C',serialNumber:'esp32s3-9cd20604a7ac',lastSeen:'2026-10-11T09:50:00Z',settingsSnapshot:{reported_state:{power:false,mode:'heat',temp:16,fan:'auto'},reported_at:'2026-10-11T09:50:00Z'},specialFunctions:['Vertical swing','Horizontal swing','Turbo'],battery:'â€”'};
let n=0;const files=[];
for(const variant of [{theme:'dark',width:390,scale:1},{theme:'light',width:390,scale:1},{theme:'dark',width:320,scale:1.35},{theme:'light',width:320,scale:1.35}]){
 theme=variant.theme;scale=variant.scale;
 for(const kind of ['card','details','registration','missing']){
  const component=()=>React.createElement(Web.View,{style:{width:variant.width,height:844,backgroundColor:theme==='dark'?'#0b0f19':'#eefbf4',position:'relative',padding:kind==='details'?0:16}},
   kind==='card'||kind==='missing'?React.createElement(Card,{controller:kind==='missing'?{...item,deviceMode:'monitoring',rotation_rpm:null,ventTemp:undefined,settingsSnapshot:undefined}:item,onPress(){}}):kind==='details'?React.createElement(Detail,{visible:true,controller:item,onClose(){},slideAnim:new Web.Animated.Value(0)}):
   React.createElement(Web.View,null,React.createElement(Steps,{phase:'naming'}),['monitoring','both','controller'].map(value=>React.createElement(Web.View,{key:value,style:{marginBottom:22}},React.createElement(Picker,{value,onChange(){}})))));
  const key='fixture'+(++n);Web.AppRegistry.registerComponent(key,()=>component);const app=Web.AppRegistry.getApplication(key);
  const html=SSR.renderToStaticMarkup(app.element),css=SSR.renderToStaticMarkup(app.getStyleElement());
  const filename=[kind,theme,variant.width,'font'+variant.scale].join('-')+'.html';files.push(filename);
  fs.writeFileSync(path.join(out,filename),'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mobile temperature and rotation QA fixture</title>'+css+'<style>html,body{margin:0;background:#64748b}#root{width:'+variant.width+'px;height:844px;position:relative;margin:auto;overflow:hidden}</style><div id="root">'+html+'</div>');
 }
}
fs.writeFileSync(path.join(out,'index.html'),'<h1>Mobile temperature and rotation QA fixtures â€” no live account data</h1>'+files.map(x=>'<p><a href="'+x+'">'+x+'</a></p>').join(''));
console.log(JSON.stringify({fixtures:files.length,output:out,notes:'Real component JSX and React Native Web styles; fixture data, stub icons and safe-area wrapper. Physical phone behavior untested.'}));

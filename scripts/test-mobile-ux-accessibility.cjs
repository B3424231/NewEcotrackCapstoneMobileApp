'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {createRequire} = require('node:module');
const root = process.env.ECOTRACK_MOBILE_ROOT || process.cwd();
const req = createRequire(path.join(root, 'package.json')), ts = req('typescript');
let theme = 'light', navigated = [];
const element = (type, props, ...children) => ({type, props:props || {}, children: children.length ? children.flat(Infinity) : [props?.children].flat(Infinity)});
const React = {createElement:element,useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useEffect(){},useMemo:fn=>fn()};
const flatten = styles => Object.assign({}, ...[styles].flat(Infinity).filter(Boolean));
const Web = {View:'View',Pressable:'Pressable',ScrollView:'ScrollView',Platform:{OS:'android',select:value=>value.android || value.default},StyleSheet:{create:value=>value,flatten,absoluteFill:{}},Animated:{View:'AnimatedView'}};
const cache = new Map();
function load(relative) {
  const file = path.join(root,relative); if(cache.has(file)) return cache.get(file).exports;
  const module = {exports:{}};cache.set(file,module);
  const resolve = name => {
    if(name==='react') return React;
    if(name==='react/jsx-runtime') return {jsx:(type,props)=>element(type,props),jsxs:(type,props)=>element(type,props),Fragment:'Fragment'};
    if(name==='react-native') return Web;
    if(name==='expo-image') return {Image:'Image'};
    if(name==='expo-router') return {router:{replace:route=>navigated.push(route),push:route=>navigated.push(route)}};
    if(name==='react-native-safe-area-context') return {SafeAreaView:'SafeAreaView'};
    if(name.endsWith('themed-text')) return {ThemedText:'Text'};
    if(name.endsWith('app-icon')) return {AppIcon:'Icon'};
    if(name==='@/context/auth-context') return {useAuth:()=>({userName:'Test',userId:'test',userType:'staff',isAuthenticated:true})};
    if(name==='@/context/settings-context') return {useSettings:()=>({effectiveTheme:theme,colors:load('src/constants/theme.ts').Colors[theme],formatTemperatureDisplay:v=>String(v)})};
    if(name.endsWith('use-mobile-notifications')) return {useMobileNotifications:()=>({items:[]})};
    if(name==='@/services/supabase') return {fetchLiveMaintenanceReports:async()=>[],subscribeToMaintenanceReports:()=>()=>{}};
    if(name==='@/constants/custom-icons') return {getColoredSvgUri:()=>'',ICON_HOME:'',ICON_MAINTENANCE:'',ICON_DEVICES:''};
    if(name.endsWith('.png')) return {};
    if(name.endsWith('.css')) return {};
    let target = name.startsWith('@/') ? path.join('src',name.slice(2)) : name.startsWith('.') ? path.relative(root,path.resolve(path.dirname(file),name)) : null;
    if(target){if(!path.extname(target))target+=fs.existsSync(path.join(root,target+'.ts'))?'.ts':'.tsx';return load(target);}
    throw Error('Unexpected test dependency '+name);
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module,exports:module.exports,require:resolve,console,Date});
  return module.exports;
}
const nodes = tree => Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.children)]:[];
const text = tree => Array.isArray(tree)?tree.map(text).join(' '):tree&&typeof tree==='object'?text(tree.children):tree==null||typeof tree==='boolean'?'':String(tree);
const Navbar = load('src/components/floating-navbar.tsx').FloatingBottomNavbar;
test('all five navigation destinations expose named tabs, exactly one selection, and preserve routes including aliases',()=>{
  for(const [current,selected] of [['home','Home'],['sensor-location','Home'],['maintenance','Maintenance'],['devices','Devices'],['aircons','Devices'],['notifications','Notification'],['profile','Profile']]){
    const tree=Navbar({currentPage:current}),all=nodes(tree),tabs=all.filter(n=>n.props.accessibilityRole==='tab');
    assert.equal(tabs.length,5,'every destination must expose tab semantics');
    assert(all.some(n=>n.props.accessibilityRole==='tablist'));
    assert.deepEqual(tabs.filter(n=>n.props.accessibilityState?.selected).map(n=>n.props.accessibilityLabel),[selected]);
    navigated=[];
    for(const [index,label] of ['Home','Maintenance','Devices','Notification','Profile'].entries()){
      const tab=tabs[index];assert.equal(tab.props.accessibilityLabel,label);tab.props.onPress();
    }
    assert.deepEqual(navigated,['/','/Maintenance','/devices','/notification','/profile']);
  }
});
const Details = load('src/components/sensor-detail-sheet.tsx').AcControllerDetailSheet;
const lum=hex=>{const channels=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
test('detail-sheet connection text meets 4.5:1 for every existing state in both themes',()=>{
  const labels={online:'Online',sleeping:'Sleeping',offline:'Offline',unavailable:'Status unavailable'};
  for(theme of ['light','dark']) for(const state of Object.keys(labels)){
    const tree=Details({visible:true,controller:{id:'test',name:'Test device',connectionState:state},onClose(){},slideAnim:0});
    const status=nodes(tree).find(n=>n.type==='Text'&&text(n)===labels[state]);assert(status);
    const colors=load('src/constants/theme.ts').Colors[theme],color=flatten(status.props.style).color;
    assert(contrast(color,colors.backgroundElement)>=4.5,`${theme} ${state}: ${color} contrast ${contrast(color,colors.backgroundElement)}`);
  }
});
const deviceText=fs.readFileSync(path.join(root,'src/app/devices.tsx'),'utf8');
const source=ts.createSourceFile('devices.tsx',deviceText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let emptyNode,filterNode;
function visit(node){if(ts.isJsxElement(node)&&node.openingElement.attributes.getText(source).includes('styles.emptyStateCard'))emptyNode=node;if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='filteredDevices')filterNode=node;ts.forEachChild(node,visit);}visit(source);
assert(emptyNode&&filterNode);
function emptyState(input){
  const state={devices:[],searchQuery:'',activeFilter:'all',userType:'staff',...input};
  const context={exports:{},React,View:'View',ThemedText:'Text',Pressable:'Pressable',AppIcon:'Icon',isDark:false,effectiveTheme:'light',UiColors:load('src/constants/theme.ts').Colors,colors:load('src/constants/theme.ts').Colors.light,styles:new Proxy({}, {get:()=>({})}),openingRegistration:false,handleStartAddDevice(){},...state,setSearchQuery:value=>state.searchQuery=value,setActiveFilter:value=>state.activeFilter=value};
  vm.runInNewContext(ts.transpileModule('exports.render=()=>('+emptyNode.getText(source)+');',{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText,context);
  return {tree:context.exports.render(),state};
}
test('an empty status filter names the filter and Show all devices restores the existing inventory',()=>{
  const inventory=[{id:'1',name:'Room AC',deviceId:'D1',status:'offline'}];
  for(const [activeFilter,title] of [['connected','No Online AC Devices'],['offline','No Offline AC Devices']]){
    const result=emptyState({devices:inventory,activeFilter,searchQuery:''});
    assert(text(result.tree).includes(title));assert(!text(result.tree).includes('No AC Devices Registered'));
    const button=nodes(result.tree).find(n=>n.props.accessibilityLabel==='Show all devices');assert(button);button.props.onPress();
    assert.equal(result.state.activeFilter,'all');assert.equal(result.state.searchQuery,'');
    const context={exports:{},...result.state};
    vm.runInNewContext(ts.transpileModule('const '+filterNode.getText(source)+';exports.filtered=filteredDevices;',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
    assert.equal(context.exports.filtered.length,1);
  }
});
test('search no-match and genuine empty inventory keep distinct copy and recovery actions',()=>{
  const result=emptyState({devices:[{id:'1'}],searchQuery:'not present',activeFilter:'offline'});
  assert(text(result.tree).includes('No Matching AC Devices'));
  const recovery=nodes(result.tree).find(n=>n.props.accessibilityLabel==='Show all devices');assert(recovery,'search no-match must provide recovery');recovery.props.onPress();
  assert.equal(result.state.searchQuery,'');assert.equal(result.state.activeFilter,'all');
  for(const userType of ['admin','staff']){
    const empty=emptyState({devices:[],activeFilter:'connected',userType});
    assert(text(empty.tree).includes('No AC Devices Registered'));
    assert(!nodes(empty.tree).some(n=>n.props.accessibilityLabel==='Show all devices'));
    assert(nodes(empty.tree).some(n=>n.props.accessibilityLabel==='Add first device'));
  }
});

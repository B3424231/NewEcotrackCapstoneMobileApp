'use strict';
// Production JSX and styles on react-native-web with isolated report fixtures. No native build or writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const React=require('react'),Web=require('react-native-web'),SSR=require('react-dom/server'),ts=require('typescript');
const {chromium}=require('C:/Users/reygay/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out=path.resolve('reports/maintenance-repair-20261104/mobile-ui');fs.mkdirSync(out,{recursive:true});
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
function evaluate(code,context){const module={exports:{}};vm.runInNewContext(compile(code),{module,exports:module.exports,React,...context});return module.exports;}
const theme=evaluate(fs.readFileSync('src/constants/theme.ts','utf8'),{require:n=>n==='react-native'?Web:{}});
const status=evaluate(fs.readFileSync('src/services/maintenance-status.ts','utf8'),{});
const raw=fs.readFileSync('src/app/Maintenance.tsx','utf8'),parsed=ts.createSourceFile('Maintenance.tsx',raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function find(predicate){let result;function visit(n){if(!result&&predicate(n))result=n;ts.forEachChild(n,visit);}visit(parsed);assert(result);return result.getText(parsed);}
const parent=find(n=>ts.isJsxElement(n)&&n.openingElement.attributes.getText(parsed)==='style={styles.checklistItemsList}'&&n.getText(parsed).includes('activeReport.items.map'));
const repair=find(n=>ts.isJsxElement(n)&&n.openingElement.attributes.getText(parsed)==='style={styles.checklistItemsList}'&&n.getText(parsed).includes('repairItems.map'));
const repairProgress=find(n=>ts.isJsxElement(n)&&n.openingElement.attributes.getText(parsed)==='style={styles.progressCard}'&&n.getText(parsed).includes('Repair progress'));
const submit=find(n=>ts.isJsxElement(n)&&n.openingElement.attributes.getText(parsed)==='style={styles.submitSection}'&&n.getText(parsed).includes('isRepairVerified'));
const stylesDeclaration=find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(parsed)==='createStyles'));
const createStyles=evaluate(stylesDeclaration+';module.exports=createStyles;',{StyleSheet:Web.StyleSheet,Platform:Web.Platform,Spacing:theme.Spacing,SCREEN_WIDTH:414,SCREEN_HEIGHT:900});
const old=fs.readFileSync('reports/maintenance-repair-20261104/before/Maintenance.tsx','utf8');
const navbar=s=>s.slice(s.indexOf('<FloatingBottomNavbar'),s.indexOf('/>',s.indexOf('<FloatingBottomNavbar'))+2);
assert(navbar(raw));assert.equal(navbar(raw),navbar(old),'Navbar JSX must remain byte-for-byte unchanged');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),checks=[];
try{for(const mode of ['light','dark'])for(const width of [320,414])for(const scale of [1,1.3]){
 const colors=theme.Colors[mode],styles=createStyles(colors);
 const activeReport={id:'MR-2026-001',status:'Under Repair',items:[{id:'1',title:'checking the attachment in the iot with a long descriptive checklist title',status:'Under Repair',linkedRepairId:'REP-7912',photoUris:['fixture-photo'],remarks:'Original technician notes remain readable.'}]};
 const targetRepair={id:'REP-7912',status:'In Progress',items:['Safety Isolation & Electrical Power Lockout','Diagnostic Inspection & Defect Root-Cause Confirmation','Execute Repair, Part Replacement, or Component Overhaul','System Reassembly, Functional Test, and Telemetry Validation'].map((title,i)=>({id:String(i),title,status:'Completed'}))};
 const context={React,View:Web.View,Pressable:Web.Pressable,ThemedText:props=>React.createElement(Web.Text,{...props,style:[{color:colors.text},props.style,{fontFamily:'Arial'},scale===1.3?{fontSize:18,lineHeight:25}:{}]}),AppIcon:()=>React.createElement(Web.Text,{'aria-hidden':true,style:{color:colors.textSecondary}},'✓'),
  styles,colors,UiColors:theme.Colors,effectiveTheme:mode,isDark:mode==='dark',activeReport,targetRepair,reports:[targetRepair],repairItems:targetRepair.items,
  isRepairVerified:false,isRepairSubmitted:false,isRepairReady:true,repairPhase:'Ready to submit',repairDoneCount:4,repairPercentage:100,isSubmitting:false,...status,
  getStatusColor:s=>theme.getStatusPalette(s,colors),handleOpenItemEditor(){},handleOpenRepairPage(){},handleToggleTaskCheck(){},setPendingRepairToSubmit(){},setConfirmRepairModalVisible(){}};
 for(const kind of ['parent','repair']){
  const Fixture=evaluate('module.exports=function(){return (<View style={{padding:16,backgroundColor:colors.background}}>'+ (kind==='parent'?parent:repairProgress+repair+submit) +'</View>)};',context);
  const key=kind+mode+width+scale;Web.AppRegistry.registerComponent(key,()=>Fixture);const app=Web.AppRegistry.getApplication(key);
  const html='<!doctype html><meta charset="utf-8">'+SSR.renderToStaticMarkup(app.getStyleElement())+'<style>html,body{margin:0;background:'+colors.background+'}</style>'+SSR.renderToStaticMarkup(app.element);
  const page=await browser.newPage({viewport:{width,height:1000}});await page.route('**/*',r=>r.abort());await page.setContent(html);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  if(kind==='parent'){
   const action=page.getByRole('button',{name:'Open repair REP-7912'});assert(await action.isVisible());const box=await action.boundingBox();assert(box.height>=44);
   assert.equal(((await page.locator('body').innerText()).match(/REP-7912/g)||[]).length,1);
  }else{assert(await page.getByRole('button',{name:'Submit repair for verification'}).isVisible());assert(await page.getByText('4 of 4 done',{exact:true}).isVisible());assert(await page.getByRole('progressbar',{name:'Repair progress'}).evaluate(el=>Math.abs(el.firstElementChild.getBoundingClientRect().width-el.getBoundingClientRect().width)<1));assert.equal(await page.getByText('Done',{exact:true}).count(),4);assert.equal(await page.locator('body').evaluate(el=>[...el.querySelectorAll('*')].some(n=>getComputedStyle(n).textDecorationLine.includes('line-through'))),false);}
  await page.screenshot({path:path.join(out,key+'.png'),fullPage:true});fs.writeFileSync(path.join(out,key+'.html'),html);checks.push(key);await page.close();
 }
}}finally{await browser.close();}
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',checks,navbarUnchanged:true,nativeBuild:false,liveWrites:false},null,2));console.log('PASS '+checks.length+' production JSX layout scenarios; navbar unchanged');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});

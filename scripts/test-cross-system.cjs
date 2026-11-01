const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const desktop=process.env.ECOTRACK_DESKTOP_ROOT || path.resolve('..','EcoTrackDesktopDashboardNew-main-control');
const read=file=>fs.readFileSync(file==='src/main.js' && process.env.ECOTRACK_DESKTOP_MAIN_SOURCE || path.join(desktop,file),'utf8');
const extract=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)+start.length));

function repairClassification() {
 const file=process.env.ECOTRACK_DESKTOP_MAINTENANCE_FILE;
 const source=file?fs.readFileSync(file,'utf8'):read('public/js/maintenance-modal.js');
 const parsed=ts.createSourceFile('maintenance-modal.js',source,ts.ScriptTarget.Latest,true);
 const names=new Set(['isActualRepairTask','formatMaintenanceUpdateTime','isComponentInIssue',
  'normalizeReport','isReportSubmittedForVerification','deduplicateReports','getChildRepairReportsFor','getRepairReportForTask']);
 const functions=[];
 function visit(node){if(ts.isFunctionDeclaration(node)&&names.has(node.name?.text))functions.push(node.getText(parsed));ts.forEachChild(node,visit);}
 visit(parsed);assert.equal(functions.length,names.size);
 const context=vm.createContext({console,Date,getReports:()=>[]});
 vm.runInContext(functions.join('\n'),context);return context;
}

test('desktop repair classification never treats a parent downward link as a repair order',()=>{
 const c=repairClassification();
 for(const report of [null,{id:'MR-2026-002',type:'Maintenance Check',linked_repair_id:'REP-5665'},
  {id:'MR-2',linkedRepairId:'REP-2'}, {id:'REPORT-1'},
  {id:'MR-3',type:'Routine inspection with repair follow-up'}, {id:'MR-4',parentReportId:' '}]) {
  assert.equal(c.isActualRepairTask(report),false,JSON.stringify(report));
 }
 for(const report of [{id:' rep-5665 ',type:'Preventive Maintenance'}, {id:'RWK-legacy'},
  {id:'child',parent_report_id:'MR-1'}, {id:'child',parentReportId:'MR-1'},
  {id:'child',linkedParentId:'MR-1'}, {id:'legacy',type:'Corrective Repair'}, {id:'legacy',type:'Repair Task'}]) {
  assert.equal(c.isActualRepairTask(report),true,JSON.stringify(report));
 }
});

test('desktop parent keeps its five tasks and only the defective task links to the child repair',()=>{
 const c=repairClassification();
 const names=['Aircon Cleaning','Temperature Inspection','Pressure Inspection','Energy Inspection','Wiring Inspection'];
 const parent=c.normalizeReport({id:'MR-2026-002',type:'Maintenance Check',linked_repair_id:'REP-5665',
  tasks:names.map((name,index)=>({id:String(index+1),name,status:index===0?'Completed':'Not Started',
   ...(index===0?{linkedRepairId:'REP-5665',repaired:true,verified:true}:{} )}))});
 const child=c.normalizeReport({id:'REP-5665',parent_report_id:parent.id,parent_task_id:'1',
  parent_task_name:names[0],status:'Verified',tasks:[{id:'fix',name:'Clean AC',status:'Completed',verified:true}]});
 assert.equal(c.isActualRepairTask(parent),false);assert.equal(c.isActualRepairTask(child),true);
 assert.deepEqual(Array.from(parent.tasks,task=>task.name),names);
 assert.deepEqual(Array.from(parent.tasks,task=>task.status),['Completed','Not Started','Not Started','Not Started','Not Started']);
 const children=c.getChildRepairReportsFor(parent,[parent,child]);
 assert.equal(children.length,1);assert.equal(children[0].id,'REP-5665');
 assert.equal(c.getRepairReportForTask(parent,parent.tasks[0],[parent,child]).id,'REP-5665');
 for(const task of parent.tasks.slice(1))assert.equal(c.getRepairReportForTask(parent,task,[parent,child]),null);
 assert.equal(c.getChildRepairReportsFor(child,[parent,child]).length,0);
});

test('desktop recognizes an explicitly parented legacy child even without a repair type or REP id',()=>{
 const c=repairClassification();
 const parent=c.normalizeReport({id:'MR-parent',type:'Inspection',tasks:[{id:'1',name:'Cleaning',status:'Not Started'}]});
 const child=c.normalizeReport({id:'legacy-child',parent_report_id:parent.id,parent_task_id:'1',tasks:[{id:'fix',name:'Fix',status:'Completed'}]});
 assert.equal(c.isActualRepairTask(child),true);
 assert.equal(c.getChildRepairReportsFor(parent,[parent,child])[0].id,'legacy-child');
});

test('every desktop database channel checks trusted caller, real session and admin role',async()=>{
 const source=read('src/main.js'); let handler,executed=0,session=null,identity={id:'admin'},role=false;
 const context=vm.createContext({ipcMain:{handle(_,fn){handler=fn;}},isTrustedDatabaseCaller:event=>event.trusted,
  databaseSessionSync:Promise.resolve(),getSupabaseAdmin:()=>({auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:identity}})},rpc:()=>({then(resolve,reject){return Promise.resolve({data:role,error:null}).then(resolve,reject);}})})});
 vm.runInContext(extract(source,'function registerDatabaseHandler(', '// Identifier lookup'),context);
 context.registerDatabaseHandler('test',()=>{executed++;return {success:true};});
 assert.equal((await handler({trusted:false})).success,false);
 assert.equal((await handler({trusted:true})).success,false);
 session={user:{id:'admin'}};
 assert.equal((await handler({trusted:true})).success,false);
 role=true; identity={id:'other'};
 assert.equal((await handler({trusted:true})).success,false);
 identity={id:'admin'}; assert.equal((await handler({trusted:true})).success,true); assert.equal(executed,1);
 for(const channel of ['staff-create','staff-update','maintenance-save-report','maintenance-delete-reports','node-update-schedule','rule-save','notifications-update']) assert.ok(source.includes(`registerDatabaseHandler('${channel}'`));
});

test('desktop fetch channels authorize with the installed Supabase RPC builder',async()=>{
 const {createClient}=require(path.join(desktop,'node_modules/@supabase/supabase-js'));
 const client=createClient('https://project.example.test','sb_publishable_synthetic',{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:async()=>new Response('true',{status:200,headers:{'Content-Type':'application/json'}})}
 });
 const handlers=new Map(),calls=[];
 const context=vm.createContext({ipcMain:{handle:(channel,handler)=>handlers.set(channel,handler)},
  isTrustedDatabaseCaller:()=>true,databaseSessionSync:Promise.resolve(),
  getSupabaseAdmin:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'admin'}}}}),
   getUser:async()=>({data:{user:{id:'admin'}}})},rpc:client.rpc.bind(client)})});
 vm.runInContext(extract(read('src/main.js'),'function registerDatabaseHandler(', '// Identifier lookup'),context);
 for(const channel of ['maintenance-fetch-reports','scheduler-fetch-data','notifications-fetch-all','notifications-fetch-today','rules-fetch-data']){
  context.registerDatabaseHandler(channel,()=>{calls.push(channel);return {success:true};});
  assert.equal((await handlers.get(channel)({})).success,true,channel);
 }
 assert.equal(calls.length,5);
});

test('desktop denies RPC errors, rejection and non-boolean admin responses without running a handler',async()=>{
 let handler,executed=0,result,transportError=false,syncError=false;
 const context=vm.createContext({ipcMain:{handle:(_,fn)=>{handler=fn;}},isTrustedDatabaseCaller:()=>true,
  databaseSessionSync:Promise.resolve(),getSupabaseAdmin:()=>({
   auth:{getSession:async()=>({data:{session:{user:{id:'admin'}}}}),getUser:async()=>({data:{user:{id:'admin'}}})},
   rpc:()=>{if(syncError)throw Error('RPC construction failed');return {then(resolve,reject){return (transportError?Promise.reject(Error('Network failed')):Promise.resolve(result)).then(resolve,reject);}}}
  })});
 vm.runInContext(extract(read('src/main.js'),'function registerDatabaseHandler(', '// Identifier lookup'),context);
 context.registerDatabaseHandler('test',()=>{executed++;return {success:true};});
 for(result of [{data:false,error:null},{data:null,error:{code:'42501'}},{data:true,error:{code:'42501'}},{data:'true',error:null},{data:[],error:null},null]){
  const response=await handler({});assert.equal(response.success,false);assert.equal(response.code,'42501');
 }
 transportError=true;assert.equal((await handler({})).success,false);
 syncError=true;assert.equal((await handler({})).success,false);
 assert.equal(executed,0);
});

test('preload rejects arbitrary channels and never exports privileged environment keys',async()=>{
 let exposed;
 vm.runInNewContext(read('src/preload.js'),{Buffer,process:{env:{SUPABASE_KEY:'sb_secret_synthetic'}},require:()=>({contextBridge:{exposeInMainWorld(_,value){exposed=value;}},ipcRenderer:{invoke:async()=>true,on(){},removeListener(){}}})});
 assert.ok(exposed.env.SUPABASE_KEY.startsWith('sb_publishable_'));
 await assert.rejects(exposed.invoke('arbitrary-query'),/Unsupported IPC channel/);
});

test('desktop signs mobile storage references and hydrates the rendered image',async()=>{
 const raw='storage://maintenance-photos/worker/proof.png', calls=[],image={src:raw,getAttribute(){return this.src;},setAttribute(_,url){this.src=url;}};
 const client={auth:{onAuthStateChange(){}},storage:{from(bucket){return {async createSignedUrl(file,ttl){calls.push({bucket,file,ttl});return {data:{signedUrl:'https://project.test/private-proof'}};}};}}};
 const context=vm.createContext({window:{},sbClient:client,document:{querySelectorAll:()=>[image]},Date,console});
 vm.runInContext(extract(read('public/js/supabase-client.js'),'  // Keep synchronous image renderers','  if (sbClient) {'),context);
 assert.equal(context.window.ecotrackResolveStorageImage(raw),raw);
 await context.window.ecotrackSignStorageImage(raw); await new Promise(resolve=>setImmediate(resolve));
 assert.equal(image.src,'https://project.test/private-proof'); assert.deepEqual(calls,[{bucket:'maintenance-photos',file:'worker/proof.png',ttl:3600}]);
 assert.equal(context.window.ecotrackResolveStorageImage('https://external.test/proof'),'https://external.test/proof');
 assert.equal(await context.window.ecotrackSignStorageImage('storage://maintenance-photos/../proof'),null);
});

test('desktop save sends original version and propagates conflict without table writes',async()=>{
 let handler,parameters;
 const source=read('src/main.js');
 const context=vm.createContext({registerDatabaseHandler(_,fn){handler=fn;},getSupabaseAdmin:()=>({rpc:async(name,args)=>{assert.equal(name,'ecotrack_admin_save_report');parameters=args;return {error:{code:'40001',message:'Report changed'}};}})});
 vm.runInContext(extract(source,"registerDatabaseHandler('maintenance-save-report'", "registerDatabaseHandler('maintenance-fetch-reports'"),context);
 const result=await handler(null,{record:{id:'MR-test',updated:'edited'},expectedUpdated:'original',parentExpected:'parent',operationId:'stable-retry',isNew:false});
 assert.equal(parameters.p_expected_updated,'original');assert.equal(parameters.p_parent_expected,'parent');assert.equal(parameters.p_operation_id,'stable-retry');assert.equal(parameters.p_create,false);
 assert.equal(result.code,'40001');assert.match(result.error,/refresh/i);
});

test('desktop conflict reloads authoritative reports and retains the conflict message',async()=>{
 const refreshed=[];
 const context=vm.createContext({console,Map,Date,Error,Event:class{},CustomEvent:class{},
  pendingReportOperations:new Map(),reportVersions:new Map([['MR-stale','latest']]),_reportsCache:[],editingReportId:'MR-stale',editingReportVersion:'original',activeEditRepairId:null,
  getSb:()=>({rpc:async(_name,args)=>{assert.equal(args.p_expected_updated,'original');return {error:{code:'40001',message:'Changed'}};}}),
  resolveValidNodeId:()=>null,resolveValidRoomId:()=>null,resolveValidStaffId:()=> 'staff_valid123',
  syncReportsWithLinkedRepairs:items=>items,deduplicateReports:items=>items,normalizeReport:item=>item,
  localStorage:{setItem(){}},window:{dispatchEvent(){},ecotrackAuthReady:Promise.resolve()},
  refreshPageReportsView(){},broadcastMaintenanceChange(){},showToast(){},
  fetchReportsFromSupabase:async(...args)=>refreshed.push(args)});
 vm.runInContext(extract(read('public/js/maintenance-modal.js'),'  async function saveReports(', '  let _nodesAirconCache'),context);
 const report={id:'MR-stale',updated:'latest',type:'Corrective Repair',tasks:[]};
 await assert.rejects(context.saveReports([report],report,false),error=>error.code==='40001'&&/Refresh/.test(error.message));
 assert.deepEqual(refreshed,[[false,true]]);
});

test('browser client discards legacy privileged JWT keys as well as secret keys',()=>{
 const source=extract(read('public/js/supabase-client.js'),'  // 1. CONFIGURATION','  // 2. INITIALIZE');
 for(const key of ['sb_secret_synthetic','header.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature']){
  const cache=new Map([['ecoTrack_supabase_anon_key',key]]),window={};
  vm.runInNewContext(source,{window,console:{warn(){}},atob:value=>Buffer.from(value,'base64').toString(),localStorage:{getItem:k=>cache.get(k),removeItem:k=>cache.delete(k)}});
  assert.ok(window.SUPABASE_KEY.startsWith('sb_publishable_'));assert.equal(cache.has('ecoTrack_supabase_anon_key'),false);
 }
});

test('desktop password form verifies current Auth password and fails closed',async()=>{
 for(const mode of ['ok','wrong','missing']){
  let handler;const updated=[],messages=[];
  const fields={'current-password':{value:'current'},'new-password':{value:'new-password'},'confirm-password':{value:'new-password'},'update-password-btn':{innerHTML:'Update',addEventListener(_,fn){handler=fn;}}};
  const sb=mode==='missing'?null:{auth:{getUser:async()=>({data:{user:{email:'synthetic@example.test'}}}),signInWithPassword:async()=>({error:mode==='wrong'?{message:'Invalid'}:null}),updateUser:async args=>{updated.push(args);return {};}}};
  vm.runInNewContext(extract(read('public/js/profile.js'),'  // Update Password','  // Avatar Upload Logic'),{document:{getElementById:id=>fields[id]},sb,user:{id:'admin'},console:{error(){}},notifyWarning(){},notifyError:message=>messages.push(message),notifySuccess:message=>messages.push(message)});
  await handler();assert.equal(updated.length,mode==='ok'?1:0);
  assert.match(messages[0],mode==='ok'?/successfully/:/Failed/);
 }
});

function pushHarness(rows,{fail=false,ticketError=null,cutoff='-infinity'}={}) {
 const updates=[],deletes=[],requests=[];
 const notifications=[{id:'n1',staff_id:'staff-one',is_broadcast:false,priority:'high',title:'Urgent',message:'Service AC',related_report_id:'MR-1'}];
 const tokens=[{token:'ExpoPushToken[synthetic]',staff_id:'staff-one',auth_user_id:'auth-one',updated_at:new Date().toISOString(),critical_enabled:true,maintenance_enabled:true}];
 const staff=[{id:'staff-one',auth_user_id:'auth-one',status:'active',is_archived:false,force_logout:false,auth_valid_after:cutoff}];
 const client={from(table){let operation='select',payload; const q={select(){return q;},in(){return q;},update(data){operation='update';payload=data;return q;},delete(){operation='delete';return q;},eq(_,id){if(operation==='update')updates.push({id,...payload});if(operation==='delete')deletes.push(id);return q;},then(resolve,reject){return Promise.resolve({data:operation==='select'?({mobile_notifications:notifications,staff_push_tokens:tokens,staff}[table]):null,error:null}).then(resolve,reject);}};return q;}};
 const module={exports:{}};
 const source=fs.readFileSync('supabase/functions/deliver-mobile-push/index.ts','utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:module.exports,module,require:()=>({}),Deno:{env:{get(){return undefined;}},serve(){}},AbortSignal,Date,Response,fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});if(fail)throw Error('Network');return {ok:true,json:async()=>url.endsWith('/send')?{data:ticketError?[{status:'error',details:{error:ticketError}}]:[{status:'ok',id:'ticket-one'}]}:{data:{'ticket-one':{status:'ok'}}}};}});
 return {run:()=>module.exports.deliverBatch(client,rows),updates,deletes,requests};
}
const delivery={id:'d1',notification_id:'n1',token:'ExpoPushToken[synthetic]',status:'pending',attempts:1};
test('remote push sends recipient-specific payload and waits for Expo delivery receipts',async()=>{
 const h=pushHarness([delivery]);await h.run();assert.equal(h.requests[0].body[0].data.notificationId,'n1');assert.equal(h.requests[0].body[0].channelId,'alerts');assert.equal(h.updates[0].status,'receipt');
 const receipt=pushHarness([{...delivery,status:'receipt',ticket_id:'ticket-one'}]);await receipt.run();assert.ok(receipt.requests[0].url.endsWith('/getReceipts'));assert.equal(receipt.updates[0].status,'delivered');
});
test('push retries transient failures, removes invalid tokens and suppresses foreign recipients',async()=>{
 const retry=pushHarness([delivery],{fail:true});await retry.run();assert.equal(retry.updates[0].status,'pending');assert.ok(new Date(retry.updates[0].next_attempt_at)>new Date());
 const invalid=pushHarness([delivery],{ticketError:'DeviceNotRegistered'});await invalid.run();assert.equal(invalid.updates[0].status,'failed');assert.deepEqual(invalid.deletes,[delivery.token]);
 const foreign=pushHarness([{...delivery,notification_id:'foreign'}]);await foreign.run();assert.equal(foreign.requests.length,0);assert.equal(foreign.updates[0].status,'failed');
 const revoked=pushHarness([delivery],{cutoff:new Date(Date.now()+3600000).toISOString()});await revoked.run();assert.equal(revoked.requests.length,0);assert.equal(revoked.updates[0].status,'failed');
});

test('native token registration uses EAS project, current Auth binding and preferences',async()=>{
 const calls=[],cache=new Map(),module={exports:{}};
 const native={getPermissionsAsync:async()=>({status:'granted'}),getExpoPushTokenAsync:async args=>{assert.equal(args.projectId,'synthetic-project');return {data:'ExpoPushToken[synthetic]'};}};
 const requireMock=name=>({
  './supabase':{supabase:{rpc:async(name,args)=>{calls.push({name,args});return {error:null};}}},
  '@react-native-async-storage/async-storage':{setItem:async(key,value)=>cache.set(key,value)},
  'react-native':{Platform:{OS:'android'}},'expo-constants':{default:{expoConfig:{extra:{eas:{projectId:'synthetic-project'}}}}},
  'expo-device':{isDevice:true},'expo-notifications':native
 }[name]);
 const js=ts.transpileModule(fs.readFileSync('src/services/mobile-notifications.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(js,{exports:module.exports,module,require:requireMock,console});
 assert.equal(await module.exports.registerMobilePushToken({critical:true,maintenance:false}),true);
 assert.equal(calls[0].name,'ecotrack_register_push_token');assert.equal(calls[0].args.p_maintenance,false);assert.equal(calls[0].args.staff_id,undefined);
 assert.equal(cache.get('ecotrack_expo_push_token'),'ExpoPushToken[synthetic]');
 native.getPermissionsAsync=async()=>({status:'denied'});
 assert.equal(await module.exports.registerMobilePushToken({critical:true,maintenance:true}),false);assert.equal(calls.length,1);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const read=f=>fs.readFileSync(f,'utf8');
const desktop=path.resolve('..','EcoTrackDesktopDashboardNew-main-control');
const js=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
function load(file,context={}){const module={exports:{}};vm.runInNewContext(js(read(file)),{module,exports:module.exports,require:spec=>spec.startsWith('.')?load(path.resolve(path.dirname(file),spec+'.ts'),context):require(spec),console,Date,setTimeout,clearTimeout,AbortController,...context},{filename:file});return module.exports;}
function declaration(file,name){const source=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.JS);let found;function visit(n){if((ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n))&&n.name?.getText(source)===name)found=n.getText(source);ts.forEachChild(n,visit);}visit(source);assert.ok(found,name);return found;}
function backend(){const prefix=read('scripts/test-backend.cjs').split('const service = h =>')[0].replace('auth: { getUser:','auth: { onAuthStateChange: callback => { client.authListener = callback; }, getUser:');return vm.runInNewContext(prefix+';harness;',{require,console,process,Response,Blob,URL,Date,Uint8Array,ArrayBuffer,setTimeout,clearTimeout});}
function devices(){const prefix=read('scripts/test-device-integration.cjs').split('const ac = h =>')[0];return vm.runInNewContext(prefix+';harness;',{require,console,process,setTimeout,clearTimeout,Date,AbortController});}
const fixture=()=>({staff:[{id:'s1',room_id:'r1',room_name:'Room 1',assignment:'Assigned'}],rooms:[{id:'r1',name:'Room 1',floor_id:'f1',node_limit:10},{id:'r2',name:'Room 2',floor_id:'f1',node_limit:10}],floors:[{id:'f1',name:'Floor 1',building_id:'b1'}],buildings:[{id:'b1',name:'Building 1'}],nodes:[{id:'n1',name:'ESP32 1',room_id:'r1',status:'online',photo_url:JSON.stringify({addedByUserId:'s1'})},{id:'n2',name:'ESP32 2',room_id:'r2',status:'offline'}],aircons:[{id:'a1',node_id:'n1',room_id:'r1',name:'AC 1'},{id:'a2',node_id:'n2',room_id:'r2',name:'AC 2'}],maintenance_reports:[{id:'MR-1',aircon_id:'a1',status:'Completed',tasks:[]}]});
const respond=data=>q=>({data:(data[q.table]||[]).filter(row=>q.ops.filter(o=>o[0]==='eq').every(o=>row[o[1]]===o[2]) && q.ops.filter(o=>o[0]==='gt').every(o=>row[o[1]]>o[2])),error:null});
const clean=x=>JSON.parse(JSON.stringify(x));
const tick=()=>new Promise(r=>setImmediate(r));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('home sharing reduces requests and preserves assigned/universal/unassigned results and Unconfirmed state',async()=>{
 for(const assignment of ['r1','ALL','none']){
  const data=fixture();if(assignment==='ALL')data.staff[0]={id:'s1',room_id:'ALL',assignment:'All Rooms'};if(assignment==='none')data.staff[0]={id:'s1',assignment:'Unassigned'};
  const results=[];
  for(const scoped of [false,true]){
   const h=backend()(respond(data)),svc=h.load('src/services/supabase.ts'),scope=scoped?h.load('src/services/query-utils.ts').createReadScope():undefined;
   const a=await svc.resolveWorkerAssignment('s1',scope);const value=await Promise.all([svc.fetchLiveAcControllers(a.roomId,scope),svc.fetchActiveRoom(a.roomId,scope)]);scope?.assertSuccessful();results.push({value:clean([a,...value]),requests:h.calls.length});
   assert.equal(h.calls.some(c=>c.rpc||c.ops?.some(o=>['update','insert','delete'].includes(o[0]))),false);
  }
  assert.deepEqual(results[1].value,results[0].value);
  if(assignment==='r1'){assert.equal(results[0].requests,27);assert.equal(results[1].requests,14);assert.equal(results[1].value[1].length,1);assert.equal(results[1].value[1][0].connectionState,'unavailable');assert.equal(results[1].value[1][0].powerSetting,undefined);}
 }
});
test('device list and room options share reads without changing registration metadata',async()=>{
 const results=[];
 for(const scoped of [false,true]){const h=devices()({respond:respond(fixture())});const service=h.load('src/services/device-service.ts').DeviceService;const scope=scoped?h.load('src/services/query-utils.ts').createReadScope():undefined;const values=await Promise.all([service.getDevices(scope),service.fetchAvailableRooms(scope)]);scope?.assertSuccessful();results.push({value:clean(values),requests:h.calls.filter(q=>q.table).length});}
 assert.equal(results[0].requests,21);assert.equal(results[1].requests,11);assert.deepEqual(results[1].value,results[0].value);
});
test('scopes remain separate for clients, filters and refreshes, and pagination handles server-shortened pages',async()=>{
 const {createReadScope,fetchAccessibleRows}=load('src/services/query-utils.ts');let reads=0;
 const client={from(){let after='';const q={select(){return q;},order(){return q;},limit(){return q;},gt(_k,v){after=v;return q;},eq(){return q;},then(resolve,reject){reads++;return Promise.resolve({data:[{id:'1'},{id:'2'},{id:'3'}].filter(r=>r.id>after).slice(0,1),error:null}).then(resolve,reject);}};return q;}};
 const scope=createReadScope();const values=await Promise.all([fetchAccessibleRows(client,'nodes','*',undefined,scope),fetchAccessibleRows(client,'nodes','*',undefined,scope)]);assert.equal(reads,4);assert.equal(values[0].data.length,3);
 await fetchAccessibleRows(client,'nodes','*',undefined,createReadScope());assert.equal(reads,8);
 await Promise.all([fetchAccessibleRows(client,'nodes','*',q=>q.eq('room_id','r1'),scope,'r1'),fetchAccessibleRows(client,'nodes','*',q=>q.eq('room_id','r2'),scope,'r2')]);assert.equal(reads,16);
 const other={...client};await fetchAccessibleRows(other,'nodes','*',undefined,scope);assert.equal(reads,20);
 const failed=createReadScope();await failed.run(client,'failure',async()=>({data:null,error:Error('offline')}));assert.throws(()=>failed.assertSuccessful(),/Unable to refresh/);
});
test('fresh refresh scopes see reassignment instead of reusing old hierarchy',async()=>{
 const data=fixture(),h=backend()(respond(data)),svc=h.load('src/services/supabase.ts'),create=h.load('src/services/query-utils.ts').createReadScope;
 assert.equal((await svc.resolveWorkerAssignment('s1',create())).roomId,'r1');data.staff[0].room_id='r2';data.staff[0].room_name='Room 2';assert.equal((await svc.resolveWorkerAssignment('s1',create())).roomId,'r2');
});
test('refreshes serialize overlapping calls, preserve one follow-up, and cancel old-screen commits',async()=>{
 const {createRefreshCoordinator}=load('src/services/refresh-coordinator.ts');let calls=0,active=0,max=0,release;const gate=new Promise(r=>release=r);let commits=0;
 const refresh=createRefreshCoordinator(async current=>{calls++;active++;max=Math.max(max,active);if(calls===1)await gate;if(current())commits++;active--;});
 const p=refresh.refresh();await tick();for(let n=0;n<20;n++)assert.equal(refresh.refresh(),p);release();await p;assert.equal(calls,2);assert.equal(max,1);assert.equal(commits,2);
 let unblock;const canceled=createRefreshCoordinator(async current=>{await new Promise(r=>unblock=r);if(current())commits++;});const pending=canceled.refresh();await tick();canceled.dispose();unblock();await pending;assert.equal(commits,2);
});
test('continuous realtime bursts do not starve refreshes and disposal cancels scheduled work',async()=>{
 let now=0,nextId=0,calls=0;const timers=new Map();
 const {createRefreshCoordinator}=load('src/services/refresh-coordinator.ts',{setTimeout:(fn,ms)=>{const id=++nextId;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)});
 const advance=async target=>{while(true){const due=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();await tick();}now=target;};
 const refresh=createRefreshCoordinator(async()=>{calls++;},10);
 for(let t=0;t<60;t+=2){refresh.schedule();await advance(t+2);}refresh.dispose();assert.ok(calls>=2);
 const canceled=createRefreshCoordinator(async()=>calls++,10);const before=calls;canceled.schedule();canceled.dispose();await advance(now+20);assert.equal(calls,before);
});
test('signed image reuse honors expiry, client boundaries and actual auth invalidation',async()=>{
 let now=1000,calls=0;const clock=class extends Date {static now(){return now;}};const images=load('src/services/private-images.ts',{Date:clock});const client={storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://test.invalid/signed/'+(++calls)},error:null})})}};
 const value='storage://maintenance-photos/task/photo.jpg';const first=await Promise.all([images.displayImage(client,value,'https://test.invalid'),images.displayImage(client,value,'https://test.invalid')]);assert.equal(calls,1);assert.equal(first[0],first[1]);now+=3540_001;await images.displayImage(client,value,'https://test.invalid');assert.equal(calls,2);images.clearImageCache(client);await images.displayImage(client,value,'https://test.invalid');assert.equal(calls,3);
 const h=backend()(),svc=h.load('src/services/supabase.ts');svc.supabase.storage.from=()=>({createSignedUrl:async()=>({data:{signedUrl:'https://test.invalid/'+(++calls)},error:null})});await svc.resolveImageUrl(value);await svc.resolveImageUrl(value);assert.equal(calls,4);svc.supabase.authListener('SIGNED_OUT');await svc.resolveImageUrl(value);assert.equal(calls,5);
});
test('failed image signing is retried rather than cached as success',async()=>{
 const images=load('src/services/private-images.ts');let calls=0;const client={storage:{from:()=>({createSignedUrl:async()=>{calls++;return calls===1?{error:Error('offline')}:{data:{signedUrl:'https://test.invalid/photo'},error:null};},getPublicUrl:()=>({data:{publicUrl:null}})})}};assert.equal(await images.displayImage(client,'storage://photos/x.jpg','https://test.invalid'),null);assert.equal(await images.displayImage(client,'storage://photos/x.jpg','https://test.invalid'),'https://test.invalid/photo');assert.equal(calls,2);
});
function screen(file,name,env){return vm.runInNewContext(js('const '+declaration(file,name)+'; '+name+';'),{console:{error(){}},Date,useCallback:fn=>fn,requestedReportId:env.params?.reportId,...env});}
test('home failed or obsolete reads cannot clear a valid list or change assignment',async()=>{
 const {createReadScope}=load('src/services/query-utils.ts');const changes=[];let fail=false;const set=name=>value=>changes.push([name,value]);
 const env={createReadScope,snapshotUser:{current:'s1'},fetchUser:'s1',userId:'s1',userEmail:'worker@example.invalid',userPhone:'',userName:'Worker',userAssignment:'Room 1',mergeHomeControllerFetch:(fresh)=>fresh,setLoading:set('loading'),setControllers:set('controllers'),setActiveRoom:set('room'),setAssignmentInfo:set('assignment'),setUserAssignment:set('auth'),setFetchError:set('error'),setRefreshing:set('refreshing'),resolveWorkerAssignment:async()=>({isAssigned:true,roomId:'r1',assignmentText:'Room 1'}),fetchLiveAcControllers:async(_r,scope)=>{if(fail)scope.recordError(Error('offline'));return [];},fetchActiveRoom:async()=>({id:'r1'})};
 const fetch=screen('src/app/index.tsx','fetchControllers',env);fail=true;await fetch(()=>true);assert.equal(changes.some(c=>['controllers','room','assignment','auth'].includes(c[0])),false);assert.ok(changes.some(c=>c[0]==='error'));changes.length=0;fail=false;await fetch(()=>false);assert.equal(changes.length,0);
});
test('mobile maintenance keeps a newer confirmed save when an older read finishes',async()=>{
 const {createReadScope}=load('src/services/query-utils.ts');let result;const saved={id:'MR-1',updatedAt:'2026-10-05T08:00:00Z',status:'Completed'};const env={createReadScope,snapshotUser:{current:'s1'},fetchUser:'s1',userName:'Worker',params:{},fetchLiveMaintenanceReports:async()=>[{...saved,updatedAt:'2026-10-05T07:00:00Z',status:'In Progress'}],setReports:fn=>result=fn([saved]),setLoading(){},setSelectedReportId(){},setFetchError(){},setRefreshing(){}};await screen('src/app/Maintenance.tsx','fetchReports',env)(()=>true);assert.equal(result[0].status,'Completed');
});
function desktopReferences(){const f=path.join(desktop,'public/js/aircon-system.js');let now=1000;const src='let referenceCache=null,referenceRead=null,referenceEpoch=0;'+declaration(f,'invalidateReferenceData')+declaration(f,'readReferenceData')+';({readReferenceData,invalidateReferenceData});';return {api:vm.runInNewContext(src,{Date:class extends Date{static now(){return now;}}}),advance:()=>now+=30001};}
test('desktop hierarchy shares reads, refreshes on invalidation/expiry and never caches errors',async()=>{
 const {api,advance}=desktopReferences();let calls=0,fail=false;const client={from:table=>({select:async()=>{calls++;return fail?{error:Error('offline')}:{data:[{id:table}],error:null};}})};
 await Promise.all([api.readReferenceData(client,false),api.readReferenceData(client,false)]);assert.equal(calls,3);await api.readReferenceData(client,false);assert.equal(calls,3);api.invalidateReferenceData();await api.readReferenceData(client,false);assert.equal(calls,6);advance();await api.readReferenceData(client,false);assert.equal(calls,9);fail=true;await assert.rejects(api.readReferenceData(client,true));fail=false;await api.readReferenceData(client,false);assert.equal(calls,15);
});
function desktopReports({hung=false}={}){
 const f=path.join(desktop,'public/js/maintenance-modal.js');const names=['ensureReportReadSession','readMaintenanceRows','performReportsFetch','fetchReportsFromSupabase'];let reads=0,auth,release,aborted=0;const data=[{id:'MR-1',updated:'2026-10-05T07:00:00Z'}];const client={auth:{onAuthStateChange:cb=>auth=cb},from(){reads++;const q={select(){return q;},order(){return q;},abortSignal(signal){signal.addEventListener('abort',()=>aborted++);return q;},then(resolve,reject){return new Promise(r=>release=r).then(resolve,reject);}};return q;}};
 const ctx={getSb:()=>client,document:{getElementById:()=>null},console:{warn(){}},AbortController,clearTimeout,setTimeout:(fn,ms)=>setTimeout(fn,hung?5:ms),window:{dispatchEvent(){}},localStorage:{setItem(){}},Event:class{},CustomEvent:class{},refreshPageReportsView(){},getReportsLocal:()=>[],mergeReportsSafely:d=>d,isMockOrTestReport:()=>false,currentDetailId:null,activeChecklistReportId:null,activeRepairReportId:null};
 const vars='let reportsFetchPromise=null,reportsFetchPending=false,reportsAuthoritativePending=false,reportRowsRead=null,reportReadClient=null,reportAuthVersion=0,reportWriteRevision=0;let _reportsCache=[{id:"OLD",status:"Completed"}];const reportVersions=new Map(),confirmedReportWrites=new Map();';const api=vm.runInNewContext(vars+names.map(n=>declaration(f,n)).join('\n')+';({readMaintenanceRows,performReportsFetch,fetchReportsFromSupabase,getCache:()=>_reportsCache});',ctx);
 return {api,client,get reads(){return reads;},get aborted(){return aborted;},resolve:()=>release({data,error:null}),changeAuth:()=>auth('SIGNED_OUT')};
}
test('desktop maintenance shares reads, times out safely, and ignores late results after auth changes',async()=>{
 const h=desktopReports();const a=h.api.readMaintenanceRows(h.client),b=h.api.readMaintenanceRows(h.client);assert.equal(a,b);await tick();assert.equal(h.reads,1);h.resolve();await a;
 const old=h.api.performReportsFetch(true);await tick();h.changeAuth();h.resolve();await old;assert.equal(h.api.getCache()[0].id,'OLD');
 const slow=desktopReports({hung:true});await slow.api.performReportsFetch(true);assert.equal(slow.aborted,1);assert.equal(slow.api.getCache()[0].id,'OLD');slow.resolve();await tick();assert.equal(slow.api.getCache()[0].id,'OLD');
});
test('server row counts reduce first-load requests without changing home or device results',async()=>{
 const metrics={};
 for(const kind of ['home','devices']){
  const values=[];
  for(const counted of [false,true]){
   const responder=q=>{const result=respond(fixture())(q);return {...result,...(counted?{count:result.data.length}:{})};};
   const h=kind==='home'?backend()(responder):devices()({respond:responder});
   const scope=h.load('src/services/query-utils.ts').createReadScope();
   let value;
   if(kind==='home'){
    const service=h.load('src/services/supabase.ts'),assignment=await service.resolveWorkerAssignment('s1',scope);
    value=[assignment,...await Promise.all([service.fetchLiveAcControllers(assignment.roomId,scope),service.fetchActiveRoom(assignment.roomId,scope)])];
   }else{
    const service=h.load('src/services/device-service.ts').DeviceService;
    value=await Promise.all([service.getDevices(scope),service.fetchAvailableRooms(scope)]);
   }
   scope.assertSuccessful();values.push({value:clean(value),requests:h.calls.filter(q=>q.table).length});
  }
  assert.deepEqual(values[0].value,values[1].value);assert.ok(values[1].requests<values[0].requests);
  metrics[kind]={without_count:values[0].requests,with_count:values[1].requests};
 }
 console.log('Controlled request counts:',JSON.stringify(metrics));
});
test('desktop queued authoritative reload is retained when refreshes overlap',async()=>{
 const h=desktopReports();const p=h.api.fetchReportsFromSupabase(true);await tick();h.api.fetchReportsFromSupabase(true,true);h.resolve();await tick();assert.equal(h.reads,2);h.resolve();await p;assert.equal(h.api.getCache()[0].id,'MR-1');
});
test('desktop startup node sharing ends with the startup scope',async()=>{
 const f=path.join(desktop,'public/js/telemetry-new.js');let reads=0;const sb={from:()=>({select:()=>{reads++;return Promise.resolve({data:[{id:'n1'}],error:null});}})};const fn=vm.runInNewContext(declaration(f,'readStartupNodes')+';readStartupNodes;',{sb});const scope=new Map();await fn(scope);await fn(scope);assert.equal(reads,1);await fn(new Map());assert.equal(reads,2);
});

test('maintenance lists do not wait for photo signing and retry renews signed URLs',async()=>{
 const data=fixture();data.maintenance_reports[0].tasks=[{id:'task1',photos:['storage://maintenance-photos/a.jpg']}];
 const h=backend()(respond(data)),svc=h.load('src/services/supabase.ts');let signs=0;
 svc.supabase.storage.from=()=>({createSignedUrl:async()=>{signs++;return {data:{signedUrl:'https://test.invalid/'+signs},error:null};}});
 const rows=await svc.fetchLiveMaintenanceReports();assert.equal(rows.length,1);assert.equal(signs,0);
 assert.ok(JSON.stringify(rows).includes('storage://maintenance-photos/a.jpg'));
 const uri='storage://maintenance-photos/a.jpg';await svc.resolveImageUrl(uri);await svc.resolveImageUrl(uri);assert.equal(signs,1);
 await svc.resolveImageUrl(uri,true);assert.equal(signs,2);
});

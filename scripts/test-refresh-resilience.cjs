const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,extra={}) { const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,setTimeout,clearTimeout,AbortController,Date,...extra});return module.exports; }
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function lifecycle(state='active'){let listener;return{currentState:state,removed:false,addEventListener(_,fn){listener=fn;return{remove:()=>{this.removed=true;listener=null;}};},set(value){this.currentState=value;listener?.(value);}};}
test('background reads pause, burst events coalesce, and resume performs one current read',async()=>{
 const life=lifecycle('background'),{createRefreshCoordinator}=load('src/services/refresh-coordinator.ts');let reads=0;
 const coordinator=createRefreshCoordinator(async()=>{reads++;},5,life);
 for(let i=0;i<50;i++){coordinator.schedule();await coordinator.refresh();}
 await wait(15);assert.equal(reads,0);assert.equal(coordinator.isActive(),false);
 life.set('active');await wait(15);assert.equal(reads,1);
 coordinator.dispose();assert.equal(life.removed,true);life.set('active');await wait(10);assert.equal(reads,1);
});
test('a read started before backgrounding cannot commit after resume, and one follow-up wins',async()=>{
 const life=lifecycle(),{createRefreshCoordinator}=load('src/services/refresh-coordinator.ts');let release,reads=0;const commits=[];
 const coordinator=createRefreshCoordinator(async current=>{const n=++reads;if(n===1)await new Promise(resolve=>{release=resolve;});if(current())commits.push(n);},1,life);
 const first=coordinator.refresh();await wait(0);life.set('background');for(let i=0;i<10;i++)coordinator.schedule();life.set('active');release();await first;
 assert.equal(reads,2);assert.deepEqual(commits,[2]);coordinator.dispose();
});
test('reference reads are reused, invalidated on edits/account changes, and failed reads are retried',async()=>{
 const query=load('src/services/query-utils.ts');let reads=0,fail=false;
 const client={from(){reads++;const chain={select(){return this},order(){return this},limit(){return this},then(resolve){return Promise.resolve(fail?{data:null,error:{message:'offline'}}:{data:[{id:'r1',name:'Room'}],error:null,count:1}).then(resolve)}};return chain;}};
 assert.equal((await query.fetchAccessibleRows(client,'rooms')).data.length,1);await query.fetchAccessibleRows(client,'rooms');assert.equal(reads,1);
 query.invalidateReferenceRows(client,'rooms');await query.fetchAccessibleRows(client,'rooms');assert.equal(reads,2);
 query.invalidateReferenceRows(client);fail=true;await query.fetchAccessibleRows(client,'rooms');await query.fetchAccessibleRows(client,'rooms');assert.equal(reads,4);
 fail=false;await query.fetchAccessibleRows(client,'rooms');assert.equal(reads,5);
});
test('heartbeat-only node events avoid full reads, while every subscriber receives a metadata change',async()=>{
 const query=load('src/services/query-utils.ts');const original={id:'n1',name:'Lab',room_id:'r1',temp:20,rssi:-60,status:'online',updated:'old'};
 const client={from(){return{select(){return this},order(){return this},limit(){return this},then(resolve){return Promise.resolve({data:[original],error:null,count:1}).then(resolve);}};}};
 await query.fetchAccessibleRows(client,'nodes');
 assert.equal(query.metadataChanged(client,'nodes',{new:{...original,temp:21,rssi:-50,updated:'new',last_measurement_report_id:'new-reading'},commit_timestamp:'event1'}),false);
 const moved={new:{...original,room_id:'r2'},commit_timestamp:'event2'};
 assert.equal(query.metadataChanged(client,'nodes',moved),true);assert.equal(query.metadataChanged(client,'nodes',moved),true,'Other subscribers must not consume each others event');
 assert.equal(query.metadataChanged(client,'nodes',{...moved,commit_timestamp:'event3'}),true,'A failed full read must remain retryable');
});


test('a late reference read cannot repopulate caches after an account or table invalidation',async()=>{
 for(const table of [undefined,'rooms']){
  const query=load('src/services/query-utils.ts');let release,reads=0;
  const client={from(){const first=++reads===1;return{select(){return this},order(){return this},limit(){return this},then(resolve,reject){return (first?new Promise(done=>{release=done;}):Promise.resolve({data:[{id:'new-room',name:'New account room'}],error:null,count:1})).then(resolve,reject);}};}};
  const pending=query.fetchAccessibleRows(client,'rooms');await wait(0);
  query.invalidateReferenceRows(client,table);release({data:[{id:'old-room',name:'Old account room'}],error:null,count:1});await pending;
  assert.equal((await query.fetchAccessibleRows(client,'rooms')).data[0].id,'new-room');assert.equal(reads,2);
 }
});

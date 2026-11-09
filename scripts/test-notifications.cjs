const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const queryUtils = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/query-utils.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: queryUtils, exports: queryUtils.exports, AbortController, setTimeout, clearTimeout });
const measurementDisplay = { exports: {} };
const airflowDisplay = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/airflow-pressure.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: airflowDisplay.exports });
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/sensor-readings.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: measurementDisplay.exports,
  require: name => {
    if (name === './airflow-pressure') return airflowDisplay.exports;
    throw Error(name);
  },
});

function notifications(respond = () => ({ data: 1, error: null })) {
  const calls = [], stored = new Map(), channels = [];
  let directAttempts = 0;
  const client = {
    rpc: async (name, params) => { calls.push({ name, params }); return respond(name, params); },
    from: () => { directAttempts++; throw Error('Client must not access shared notification rows directly'); },
    channel() {
      const channel = { handlers: [], on(_event, filter, callback) { this.handlers.push({filter,callback}); return this; }, subscribe() { return this; } };
      channels.push(channel); return channel;
    },
    removeChannel(channel) { channel.removed = true; },
    auth: { getUser: async () => ({ data: { user: { id: 'auth-alice' } }, error: null }) },
  };
  const source = fs.readFileSync('src/services/mobile-notifications.ts','utf8');
  const js = ts.transpileModule(source,{compilerOptions:{ module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, esModuleInterop:true }}).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js,{
    module,exports:module.exports,Date,console:{ warn(){},error(){} },
    require: name => {
      if (name === './query-utils') return queryUtils.exports;
      if (name === './sensor-readings') return measurementDisplay.exports;
      if (name === './supabase') return { supabase:client, resolveNotificationEquipment: async items => items };
      if (name === '@react-native-async-storage/async-storage') return {
        getItem: async key => stored.get(key) ?? null,
        setItem: async (key,value) => { stored.set(key,value); },
      };
      if (name === '@/utils/notification-emitter') return { NotificationEmitter:{ trigger:()=>{} } };
      throw Error(name);
    },
  });
  return { service:module.exports,calls,stored,channels,get directAttempts() { return directAttempts; } };
}

test('notification fetch never uses a forged display-name recipient', async () => {
  const h = notifications(() => ({ data:{items:[{id:'broadcast',event_key:'e1',created_at:'2026-09-30T00:00:00Z',is_read:false}],next_cursor:null},error:null }));
  const rows = await h.service.fetchLiveMobileNotifications('Another staff member');
  assert.equal(rows[0].eventKey,'e1');
  assert.equal(h.calls[0].name,'ecotrack_list_notifications');
  assert.equal(Object.values(h.calls[0].params).includes('Another staff member'),false);
});

test('pagination forwards the stable timestamp and id cursor and caps page size', async () => {
  const h = notifications(() => ({data:{items:[],next_cursor:{created_at:'2026-09-29T00:00:00Z',id:'n4'}},error:null}));
  const page = await h.service.fetchMobileNotificationPage({createdAt:'2026-09-30T00:00:00Z',id:'n9'},500);
  assert.equal(h.calls[0].params.p_limit,100);
  assert.equal(h.calls[0].params.p_before_id,'n9');
  assert.equal(page.nextCursor.id,'n4');
});

test('notification load fails explicitly if the authenticated RPC is unavailable', async () => {
  const h = notifications(() => ({ data:null,error:{message:'permission denied'} }));
  await assert.rejects(h.service.fetchLiveMobileNotifications('Alice'),/permission denied/);
});

test('broadcast archive and snooze only call recipient-state RPC without identity arguments', async () => {
  const h = notifications();
  assert.equal(await h.service.deleteMobileNotification('broadcast'),true);
  assert.equal(await h.service.snoozeMobileNotification('broadcast',30),true);
  assert.equal(await h.service.unsnoozeMobileNotification('broadcast'),true);
  assert.deepEqual(h.calls.map(c=>c.params.p_action),['archive','snooze','unsnooze']);
  assert.ok(h.calls.every(c=>c.name==='ecotrack_set_notification_state'));
  assert.ok(h.calls.every(c=>!('staff_name' in c.params)&&!('recipient_auth_user_id' in c.params)));
});

test('bulk mutation deduplicates selection and rejects partial success', async () => {
  const h = notifications(() => ({data:1,error:null}));
  assert.equal(await h.service.deleteMultipleMobileNotifications(['n1','n1']),true);
  assert.equal(await h.service.deleteMultipleMobileNotifications(['n1','n2']),false);
  assert.equal(h.calls[0].params.p_ids.length,1);
});

test('mark-all reads broadcasts for authenticated recipient even without a display name', async () => {
  const h = notifications(() => ({data:0,error:null}));
  assert.equal(await h.service.markAllMobileNotificationsAsRead(),true);
  assert.equal(h.calls[0].name,'ecotrack_mark_all_notifications_read');
  assert.equal(h.calls[0].params,undefined);
  assert.equal(h.directAttempts,0);
});

test('single read and unread never attempt writes to shared event rows', async () => {
  const h = notifications();
  assert.equal(await h.service.markMobileNotificationAsRead('n1'),true);
  assert.equal(await h.service.markMobileNotificationAsRead('n1',false),true);
  assert.equal(h.directAttempts,0);
  assert.deepEqual(h.calls.map(call=>call.params.p_action),['read','unread']);
});

const deferred = () => {
  let resolve; const promise = new Promise(done=>{resolve=done;});
  return {promise,resolve};
};
const settle = () => new Promise(resolve=>setImmediate(resolve));
const page = (read=false, ids=['n1']) => ({data:{items:ids.map(id=>({
  id,event_key:id,staff_id:'s1',staff_name:'Previous display name',title:'Task',message:id,
  created_at:'2026-10-03T00:00:00Z',is_read:read,
})),next_cursor:null},error:null});

// Execute the actual feed hook with deterministic lifecycle boundaries so delayed
// Supabase responses and two independent mounted consumers can be tested offline.
function feed(service, initialAccount='staff:s1') {
  const slots=[],effects=[]; let cursor=0,account=initialAccount,disposed=false;
  const react = {
    useState(initial) {
      const index=cursor++;
      if (!(index in slots)) slots[index]=typeof initial==='function'?initial():initial;
      return [slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];
    },
    useRef(current) { const index=cursor++; return slots[index]||(slots[index]={current}); },
    useCallback(callback, deps) {
      const index=cursor++;
      if (!slots[index] || deps.some((dep,i)=>dep!==slots[index].deps[i])) slots[index]={deps,callback};
      return slots[index].callback;
    },
    useEffect(callback,deps) {
      const index=cursor++,previous=slots[index];
      if (!previous || deps.some((dep,i)=>dep!==previous.deps[i])) {
        effects.push(()=>{previous?.cleanup?.();slots[index]={deps,cleanup:callback()};});
      }
    },
  };
  const sessionHook={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/hooks/use-session-page-snapshot.ts','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{module:sessionHook,exports:sessionHook.exports,require:()=>react});
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/hooks/use-mobile-notifications.ts','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{module,exports:module.exports,console:{warn(){}},
    require:name=> {
      if(name==='react') return react;
      if(name==='@/hooks/use-session-page-snapshot') return sessionHook.exports;
      if(name.startsWith('@/services/') && !name.endsWith('mobile-notifications')) {
        const helper={exports:{}};
        vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/'+name.split('/').pop()+'.ts','utf8'),{
          compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
        }).outputText,{module:helper,exports:helper.exports,AbortController,setTimeout,clearTimeout});
        return helper.exports;
      }
      return service;
    }});
  const render=()=>{
    assert.equal(disposed,false); cursor=0;
    const value=module.exports.useMobileNotifications(account);
    effects.splice(0).forEach(effect=>effect()); return value;
  };
  render();
  return {
    get value(){return render();},
    switchAccount(next){account=next;return render();},
    dispose(){disposed=true;slots.forEach(slot=>slot?.cleanup?.());},
  };
}

test('mark-all immediately synchronizes list and badge without a Realtime event', async () => {
  let read=false;
  const h=notifications(name=>{
    if(name==='ecotrack_list_notifications') return page(read,['targeted','broadcast']);
    read=true;return {data:2,error:null};
  });
  const list=feed(h.service),badge=feed(h.service); await settle();
  assert.equal(list.value.items.filter(n=>!n.isRead).length,2);
  assert.equal(badge.value.items.filter(n=>!n.isRead).length,2);
  assert.equal(await h.service.markAllMobileNotificationsAsRead('Forged name'),true);
  assert.ok(list.value.items.every(n=>n.isRead));
  assert.equal(badge.value.items.filter(n=>!n.isRead).length,0);
  assert.equal(list.value.items.length,2);
  assert.equal(h.directAttempts,0);
  list.dispose();badge.dispose();
});

test('a stale load cannot bring unread dots back after a successful mark-all', async () => {
  const loads=[];let delay=false;
  const h=notifications(name=>{
    if(name!=='ecotrack_list_notifications')return {data:1,error:null};
    if(!delay)return page();
    const wait=deferred();loads.push(wait);return wait.promise;
  });
  const list=feed(h.service);await settle();delay=true;
  const oldRefresh=list.value.refresh();
  await settle();
  await h.service.markAllMobileNotificationsAsRead();
  assert.equal(loads.length,1);
  assert.equal(list.value.items[0].isRead,true);
  loads[0].resolve(page(false));await settle();
  assert.equal(list.value.items[0].isRead,true);
  loads[1].resolve(page(true));await oldRefresh;await settle();
  assert.equal(list.value.items[0].isRead,true);
  assert.equal(list.value.refreshing,false);list.dispose();
});

test('responses completing during a mutation are ignored and overlapping writes are blocked', async () => {
  const refresh=deferred(),write=deferred();let delay=false,read=false;
  const h=notifications(name=>name==='ecotrack_list_notifications'
    ?(delay?refresh.promise:page(read)):write.promise);
  const list=feed(h.service);await settle();delay=true;
  const pendingLoad=list.value.refresh();
  await settle();
  const mutation=h.service.markAllMobileNotificationsAsRead();
  assert.equal(list.value.updating,true);
  assert.equal(await h.service.markMobileNotificationAsRead('n1',false),false);
  assert.equal(h.calls.filter(call=>call.name!=='ecotrack_list_notifications').length,1);
  refresh.resolve(page(true));await pendingLoad;await settle();
  assert.equal(list.value.items[0].isRead,false);
  delay=false;read=true;write.resolve({data:1,error:null});await mutation;await settle();
  assert.equal(list.value.items[0].isRead,true);list.dispose();
});

test('a reload failure after mark-all cannot undo the committed list or badge state', async () => {
  let fail=false;
  const h=notifications(name=>{
    if(name==='ecotrack_list_notifications')return fail?{data:null,error:{message:'Timeout'}}:page();
    fail=true;return {data:1,error:null};
  });
  const list=feed(h.service),badge=feed(h.service);await settle();
  assert.equal(await h.service.markAllMobileNotificationsAsRead(),true);await settle();
  assert.equal(list.value.items[0].isRead,true);assert.equal(badge.value.items[0].isRead,true);
  assert.ok(list.value.error);assert.equal(h.directAttempts,0);list.dispose();badge.dispose();
});

test('failed refresh preserves recipient read state and reports an error without a raw-table fallback', async () => {
  let fail=false;
  const h=notifications(name=>name==='ecotrack_list_notifications'
    ?(fail?{data:null,error:{message:'Offline'}}:page(true)):{data:1,error:null});
  const list=feed(h.service);await settle();fail=true;
  await list.value.refresh();
  assert.equal(list.value.items[0].isRead,true);
  assert.ok(list.value.error);assert.equal(list.value.refreshing,false);
  assert.equal(h.directAttempts,0);list.dispose();
  const firstLoad=feed(h.service);await settle();
  assert.equal(firstLoad.value.items.length,0);
  assert.ok(firstLoad.value.error);assert.equal(firstLoad.value.loading,false);firstLoad.dispose();
});

test('failed mutations leave list and badge unread and release the update lock', async () => {
  const h=notifications(name=>name==='ecotrack_list_notifications'?page():{data:null,error:{message:'Denied'}});
  const list=feed(h.service),badge=feed(h.service);await settle();
  assert.equal(await h.service.markAllMobileNotificationsAsRead(),false);
  assert.equal(list.value.items[0].isRead,false);assert.equal(badge.value.items[0].isRead,false);
  assert.equal(list.value.updating,false);list.dispose();badge.dispose();
});

test('refreshes serialize and switching accounts invalidates pending results', async () => {
  const waits=[];
  const h=notifications(()=>{const wait=deferred();waits.push(wait);return wait.promise;});
  const list=feed(h.service);
  await settle();
  const latest=list.value.refresh();
  waits[0].resolve(page(false,['older']));await settle();
  waits[1].resolve(page(true,['latest']));await latest;
  assert.equal(list.value.items[0].id,'latest');
  const oldAccount=list.value.refresh();
  await settle();
  assert.equal(list.switchAccount('staff:s2').items.length,0);
  await settle();
  waits[2].resolve(page(false,['private-to-s1']));await oldAccount;
  assert.equal(list.value.items.length,0);
  waits[3].resolve(page(false,['private-to-s2']));await settle();
  assert.equal(list.value.items[0].id,'private-to-s2');list.dispose();
  assert.ok(h.channels.every(channel=>channel.removed));
});

test('archive removes only selected cards and read changes preserve snooze', async () => {
  const h=notifications();
  const items=[{id:'n1',isRead:false,isSnoozed:true,snoozeUntil:'2026-10-04T00:00:00Z'},{id:'n2',isRead:false}];
  const read=h.service.applyMobileNotificationState(items,{action:'read'});
  assert.equal(read[0].isSnoozed,true);assert.equal(read[0].snoozeUntil,items[0].snoozeUntil);
  const kept=h.service.applyMobileNotificationState(read,{action:'archive',ids:['n1']});
  assert.equal(kept.length,1);assert.equal(kept[0].id,'n2');
});

test('incoming events use server recipient visibility even after a staff display-name change', () => {
  const h=notifications();let incoming;
  const unsubscribe=h.service.subscribeToIncomingNotifications('Renamed technician',item=>{incoming=item;});
  h.channels[0].handlers[0].callback({new:{id:'n1',staff_id:'s1',staff_name:'Previous name'}});
  assert.equal(incoming.id,'n1');unsubscribe();
});

test('mark-all switches Unread to All only after success and preserves other filters', async () => {
  const source=ts.createSourceFile('notification.tsx',fs.readFileSync('src/app/notification.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let handler;
  function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='handleMarkAllRead')handler=node.getText(source);ts.forEachChild(node,visit);}
  visit(source);assert.ok(handler);
  for(const [initial,ok,expected] of [['unread',true,'all'],['unread',false,'unread'],['urgent',true,'urgent']]) {
    let filter=initial;const alerts=[];
    const context=vm.createContext({updating:false,markAllMobileNotificationsAsRead:async()=>ok,
      setActiveFilter:callback=>{filter=callback(filter);},Alert:{alert:(...args)=>alerts.push(args)}});
    vm.runInContext('const '+handler+'; globalThis.invoke=handleMarkAllRead;',context);
    await context.invoke();assert.equal(filter,expected);assert.equal(alerts.length,ok?0:1);
  }
});

test('missing events and malformed snoozes cannot produce success', async () => {
  const h = notifications(() => ({data:0,error:null}));
  assert.equal(await h.service.markMobileNotificationAsRead('missing'),false);
  const count=h.calls.length;
  for (const minutes of [0,-1,1.5,NaN,Infinity,10081]) assert.equal(await h.service.snoozeMobileNotification('n1',minutes),false);
  assert.equal(await h.service.deleteMultipleMobileNotifications(['']),false);
  assert.equal(h.calls.length,count);
});

test('legacy duplicate cleanup cannot erase other recipients event rows', async () => {
  const h = notifications();
  assert.equal(await h.service.cleanDuplicateDbNotifications('Alice'),0);
  assert.equal(h.calls.length,0);
});

test('repeated status transitions with unique event keys remain visible', () => {
  const {service}=notifications();
  const n={id:'1',staffName:'Alice',title:'Status Updated',message:'For Verification',type:'status_update',createdAt:'2026-09-30T00:00:00Z',eventKey:'change:1'};
  const result=service.deduplicateMobileNotifications([n,{...n,id:'2',eventKey:'change:2'}]);
  assert.equal(result.length,2);
});

test('ad-hoc events require retry key and immutable recipient; names cannot authorize creation', async () => {
  const h=notifications(()=>({data:'event-id',error:null}));
  const payload={title:'Task',message:'Check',staffName:'Alice'};
  assert.equal(await h.service.createMobileNotification(payload),false);
  assert.equal(await h.service.createMobileNotification({...payload,eventKey:'dispatch:1'}),false);
  assert.equal(await h.service.createMobileNotification({...payload,eventKey:'dispatch:1',staffId:'s1'}),true);
  assert.equal(h.calls[0].params.p_payload.staff_id,'s1');
  assert.equal(h.calls[0].params.p_payload.staff_name,undefined);
});

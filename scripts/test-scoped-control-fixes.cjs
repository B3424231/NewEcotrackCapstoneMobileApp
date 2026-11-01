const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const desktop = path.resolve('..', 'EcoTrackDesktopDashboardNew-main-control');
const read = file => fs.readFileSync(file, 'utf8');
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
function declaration(file, name) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
  let result;
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(source) === name) result = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(result, name); return result;
}
function bleHarness({ permission = true, state = 'PoweredOn', scanError, devices = [], connect = true, alreadyConnected = false, info, initialize = true, os = 'android' } = {}) {
  const calls = [], stored = new Map(), timers = new Set(); let payload, clock = 0;
  const native = {
    discoverAllServicesAndCharacteristics: async () => calls.push('discover'),
    requestMTU: async value => calls.push(['mtu', value]),
    writeCharacteristicWithResponseForService: async (...args) => { payload = JSON.parse(Buffer.from(args[2], 'base64').toString('utf8')); calls.push(['write', args[1]]); },
    readCharacteristicForService: async () => ({ value: Buffer.from(JSON.stringify(!payload ? { device_id: 'esp32s3-fixture' } : info ? info(payload, calls) : { request_id: payload.request_id, wifi_ssid: payload.ssid, wifi_status: 'connected', ip: '192.168.1.19' })).toString('base64') }),
  };
  const manager = {
    state: async () => state,
    startDeviceScan(_filter, _options, callback) { calls.push('scan'); if (scanError) callback(scanError, null); else devices.forEach(device => callback(null, device)); },
    stopDeviceScan: () => calls.push('stop'),
    connectToDevice: async id => { calls.push(['connect', id]); if (!connect) throw Error('Native connection failure'); return native; },
    isDeviceConnected: async () => alreadyConnected,
    devices: async () => [native],
  };
  const module = { exports: {} };
  vm.runInNewContext(transpile(read('src/services/device-service.ts')), {
    module, exports: module.exports, console, Date: class extends Date { static now() { clock += 10000; return clock; } },
    setTimeout: fn => { const token = {}; timers.add(token); queueMicrotask(() => { if (timers.delete(token)) fn(); }); return token; },
    clearTimeout: token => timers.delete(token),
    require(spec) {
      if (spec === 'react-native') return { Platform: { OS: os, Version: 31 }, PermissionsAndroid: { PERMISSIONS: { BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect', ACCESS_FINE_LOCATION: 'fine', ACCESS_COARSE_LOCATION: 'coarse' }, RESULTS: { GRANTED: 'granted' }, requestMultiple: async () => Object.fromEntries(['scan','connect','fine','coarse'].map(key => [key, permission ? 'granted' : 'denied'])) } };
      if (spec === 'react-native-ble-plx') { if (!initialize) throw Error('Missing native module'); return { BleManager: function() { return manager; } }; }
      if (spec === '@react-native-async-storage/async-storage') return { getItem: async key => stored.get(key) || null, setItem: async (key, value) => stored.set(key,value) };
      if (spec === './supabase') return { supabase: { from: () => ({ select: () => ({ is: async () => ({ data: [] }) }) }) } };
      if (spec === './phone-connectivity' || spec === './web-bluetooth') {
        const helper = { exports: {} };
        vm.runInNewContext(transpile(read('src/services/' + spec.slice(2) + '.ts')), {
          module: helper, exports: helper.exports, setTimeout, clearTimeout,
          require(name) {
            if (name === 'react-native') return { Platform: { OS: os, Version: 31 } };
            if (name === 'expo-intent-launcher') return { startActivityAsync: async () => ({ resultCode: 0 }) };
            throw Error('Unexpected helper dependency ' + name);
          },
        });
        return helper.exports;
      }
      return {};
    },
  });
  return { service: module.exports.BleDeviceService, calls, stored, get payload() { return payload; } };
}
test('BLE scan distinguishes denied permission, disabled radio, initialization, native failure and empty scan', async () => {
  for (const [options, message] of [[{permission:false}, /permissions are required/], [{state:'PoweredOff'}, /disabled/], [{initialize:false}, /initialize/], [{scanError:{errorCode:600}}, /scan failed/], [{scanError:{errorCode:601}}, /Location services/], [{os:'web'}, /installed EcoTrack app/]]) {
    const h = bleHarness(options); await assert.rejects(h.service.scanNearbyDevices(), message);
    assert.ok(!h.calls.some(call => Array.isArray(call) && call[0] === 'connect'));
  }
  assert.equal((await bleHarness().service.scanNearbyDevices()).length, 0);
});
test('BLE discovery preserves two native identifiers independently of displayed/logical names', async () => {
  const devices = ['01','02'].map(suffix => ({ id: `AA:BB:CC:DD:EE:${suffix}`, name: `EcoTrack-node-${suffix}`, rssi:-50 }));
  const h = bleHarness({ devices }); const found = await h.service.scanNearbyDevices();
  assert.equal(found.length, 2);
  for (const item of found) {
    assert.notEqual(item.bleId, item.deviceId);
    const id = await h.service.resolveBleIdentifier(item); assert.equal(id,item.id);
    assert.equal(await h.service.connectBle(id), true);
  }
  assert.deepEqual(h.calls.filter(call => Array.isArray(call) && call[0] === 'connect').map(call=>call[1]), devices.map(item=>item.id));
  assert.equal(await bleHarness({connect:false}).service.connectBle(devices[0].id),false);
});
test('Wi-Fi reconfiguration stops on a failed verified connection and proceeds only with the returned BLE identifier', async () => {
  for (const name of ['handleConnectBleForReconfigure']) {
    const code = 'const ' + declaration('src/app/devices.tsx',name) + '; exports.run=' + name + ';';
    for (const success of [false,true]) {
      const steps = [], errors = [], ids = [], module = { exports: {} };
      const device = { id:'node-1',deviceId:'node-1',name:'EcoTrack-node-1',bleId:'AA:BB:CC:DD:EE:01' };
      vm.runInNewContext(transpile(code), { module,exports:module.exports,Error,
        reconfigAttempt:{current:0},reconfigBleConnection:{current:null},selectedDevice:device, selectedWifiSsid:'',reconfigSelectedSsid:'',triggerHaptic(){},setTargetBleDevice(){},setSelectedDevice(){},setReconfigConnecting(){},setSavedWifiNetworks(){},setSelectedWifiSsid(){},setReconfigWifiNetworks(){},setReconfigSelectedSsid(){},
        setAddStep:step=>steps.push(step),setReconfigStep:step=>steps.push(step),setConnectError:error=>errors.push(error),setReconfigError:error=>errors.push(error),
        BleDeviceService:{connectForWifiReconfigure:async target=>{ids.push(target.bleId);if(!success)throw Error('Connection failed');return target.bleId;},getSavedWifiNetworks:async()=>[]},
      });
      await module.exports.run(device);
      assert.deepEqual(ids,[device.bleId]); assert.equal(steps.includes('wifi'),success);
      assert.equal(errors.some(Boolean),!success);
    }
  }
});
test('Wi-Fi success requires the current request, requested SSID, connected receipt and usable IP', async () => {
  const h = bleHarness({ info: payload => ({ request_id:payload.request_id,wifi_ssid:payload.ssid,wifi_status:'connected',ip:'192.168.1.25',backend_status:'unverified' }) });
  const progress = []; const result = await h.service.configureWifi('AA:BB:CC:DD:EE:01','Café Wi-Fi','testpass',step=>progress.push(step));
  assert.equal(result.success,true); assert.equal(result.ipAddress,'192.168.1.25');
  assert.equal(h.payload.ssid,'Café Wi-Fi'); assert.ok(h.payload.request_id);
  assert.equal(h.calls.find(call=>Array.isArray(call)&&call[0]==='connect')[1],'AA:BB:CC:DD:EE:01');
  assert.deepEqual(progress,[0,1,2,3,4]); assert.equal(h.stored.size,1);
});
test('Wi-Fi received/connecting, old IP, wrong SSID/request, controller failure and invalid credentials never succeed', async () => {
  for (const response of [
    payload=>({request_id:payload.request_id,wifi_ssid:payload.ssid,wifi_status:'received',ip:'192.168.1.25'}),
    payload=>({request_id:payload.request_id,wifi_ssid:payload.ssid,wifi_status:'connecting',ip:'192.168.1.25'}),
    ()=>({ip:'192.168.1.25'}),
    payload=>({request_id:'previous',wifi_ssid:payload.ssid,wifi_status:'connected',ip:'192.168.1.25'}),
    payload=>({request_id:payload.request_id,wifi_ssid:'different',wifi_status:'connected',ip:'192.168.1.25'}),
    payload=>({request_id:payload.request_id,wifi_ssid:payload.ssid,wifi_status:'connected',ip:'0.0.0.0'}),
    payload=>({request_id:payload.request_id,wifi_ssid:payload.ssid,wifi_status:'error',ip:'0.0.0.0'}),
  ]) {
    const h = bleHarness({info:response}); const progress=[];
    const result=await h.service.configureWifi('AA:BB:CC:DD:EE:01','Network','testpass',step=>progress.push(step));
    assert.equal(result.success,false);assert.ok(result.error);assert.equal(h.stored.size,0);assert.ok(!progress.includes(3)&&!progress.includes(4));
  }
  const h=bleHarness();assert.equal((await h.service.configureWifi('native','Network','bad')).success,false);assert.ok(!h.payload);
});
test('Wi-Fi provisioning reuses the selected native connection instead of attempting a duplicate connection',async()=>{
  const h=bleHarness({alreadyConnected:true,connect:false});
  const result=await h.service.configureWifi('AA:BB:CC:DD:EE:01','Network','testpass');
  assert.equal(result.success,true);assert.ok(!h.calls.some(call=>Array.isArray(call)&&call[0]==='connect'));
});
function saveHarness({primary='ok',fallback='ok'}={}) {
  const original={id:'MR-test',status:'For Verification',tasks:[],updated:'original'};
  const writes=[],toasts=[],events=[];
  const record={...original,status:'Completed',updated:'saved'};
  const sb={rpc:async()=>primary==='ok'?{data:{report:record},error:null}:{error:{message:'Primary rejected'}},from(){return {upsert(){writes.push('fallback');return {select(){return {single:async()=>fallback==='ok'?{data:record,error:null}:{error:{message:'Fallback rejected'}}};}};}};}};
  const context=vm.createContext({Map,Date,Error,console:{warn(){},error(){}},Event:class{},CustomEvent:class{},
    pendingReportOperations:new Map(),reportVersions:new Map(),_reportsCache:[structuredClone(original)],editingReportId:null,activeEditRepairId:null,
    getSb:()=>sb,resolveValidNodeId:()=>null,resolveValidRoomId:()=>null,resolveValidStaffId:()=>null,
    normalizeReport:item=>structuredClone(item),deduplicateReports:items=>items,syncReportsWithLinkedRepairs:items=>items,
    localStorage:{setItem:(_key,value)=>writes.push(JSON.parse(value))},window:{ecotrackAuthReady:Promise.resolve(),dispatchEvent:event=>events.push(event)},
    refreshPageReportsView(){},broadcastMaintenanceChange(){},showToast:(...args)=>toasts.push(args)});
  vm.runInContext(declaration(path.join(desktop,'public/js/maintenance-modal.js'),'saveReports'),context);
  return {context,writes,toasts,events,record,original};
}
test('desktop saves commit cache only after primary success or confirmed fallback success',async()=>{
  for(const primary of ['ok','fail']) {
    const h=saveHarness({primary});await h.context.saveReports([h.record],h.record,false);
    assert.equal(h.context._reportsCache[0].status,'Completed');assert.ok(h.events.length);
    assert.equal(h.writes.includes('fallback'),primary==='fail');
  }
});
test('desktop double save failure rejects, preserves prior cache/storage and emits no success event',async()=>{
  const h=saveHarness({primary:'fail',fallback:'fail'});
  await assert.rejects(h.context.saveReports([h.record],h.record,false),/Database did not confirm/);
  assert.equal(h.context._reportsCache[0].status,'For Verification');assert.deepEqual(h.writes,['fallback']);
  assert.equal(h.events.length,0);assert.equal(h.toasts[0][0],'Report not saved');
});
test('desktop repair and maintenance verification buttons stop before parent writes and success on save failure', async()=>{
  const file=path.join(desktop,'public/js/maintenance-modal.js');
  const parsed=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true);
  const handlers=new Map();
  function visit(node){
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='addEventListener'&&node.arguments[1]&&ts.isArrowFunction(node.arguments[1])){
      const expression=node.expression.getText(parsed);
      for(const id of ['btnVerifyRepOrder','btn-detail-verify']) if(expression.includes(id)) handlers.set(id,node.arguments[1].getText(parsed));
    }
    ts.forEachChild(node,visit);
  }visit(parsed);assert.equal(handlers.size,2);
  for(const [id,handler] of handlers){
    const toasts=[],writes=[];const report={id:'REP-4106',parentReportId:'MR-parent',status:'For Verification',tasks:[{id:1,status:'Completed'}],timeline:[]};
    const parent={id:'MR-parent',status:'Under Repair',tasks:[{id:1,status:'Under Repair'}],timeline:[]};
    const context=vm.createContext({report,reports:[report,parent],Date,
      getReports:()=>[report,parent],findReportById:(rows,key)=>rows.find(item=>item.id===key),
      getChildRepairReportsFor:()=>[],isRepairReportDone:()=>true,safeTimelineUnshift:(list,item)=>list.unshift(item),
      saveReports:async(_rows,target)=>{writes.push(target.id);throw Error('Database failed');},
      showToast:(...args)=>toasts.push(args),closeDetailModal(){},renderDetailModalContent(){},refreshPageReportsView(){},
    });vm.runInContext('run='+handler,context);
    await context.run();assert.deepEqual(writes,['REP-4106'],id);assert.equal(toasts.length,0,id);assert.equal(parent.status,'Under Repair',id);
  }
});
test('desktop editing records are detached from the valid cache including nested repair flags',()=>{
  const original={id:'MR-parent',issue:{repaired:false},tasks:[{id:1,repaired:false}]};
  const context=vm.createContext({_reportsCache:[original],deduplicateReports:rows=>rows,JSON,getReportsLocal:()=>[]});
  vm.runInContext(declaration(path.join(desktop,'public/js/maintenance-modal.js'),'getReports'),context);
  const edit=context.getReports()[0];edit.issue.repaired=true;edit.tasks[0].repaired=true;
  assert.equal(original.issue.repaired,false);assert.equal(original.tasks[0].repaired,false);
});
test('missing requested repair never substitutes a completed sibling; valid IDs retain their own data',()=>{
  const source=read('src/app/Maintenance.tsx');
  const start=source.indexOf('          const defaultInfo = getDispatchedRepairInfo(activeReport);',source.indexOf('REPAIR PAGE'));
  const end=source.indexOf('          if (!hasDispatchedRepair',start);
  assert.ok(start>=0&&end>start);
  for(const requested of ['REP-2879','REP-4106']) {
    const context=vm.createContext({activeReport:{id:'MR-parent'},activeRepairId:requested,reports:[{id:'REP-4106',status:'Completed'}],getDispatchedRepairInfo:()=>({hasDispatchedRepair:true,repairId:'REP-4106',linkedRepairReport:{id:'REP-4106',status:'Completed'}})});
    vm.runInContext(source.slice(start,end)+'; result={repairId,targetRepair};',context);
    assert.equal(context.result.repairId,requested);
    assert.equal(context.result.targetRepair?.id,requested==='REP-4106'?'REP-4106':undefined);
  }
});
test('both firmware versions route Wi-Fi separately and leave the IR callback byte-for-byte unchanged',()=>{
  for(const file of [
    'firmware/ecotrack_esp32_s3/ecotrack_esp32_s3.ino',
    path.join(desktop,'firmware/esp32s3_ecotrack_node/esp32s3_ecotrack_node.ino'),
  ]) {
    const source=read(file);
    const callback=source.slice(source.indexOf('class BLECommandCallbacks'),source.indexOf('class BLEServerCallbacksHandler')).trim().replace(/\r\n/g,'\n');
    // Captured from both inspected versions before these scoped fixes.
    assert.equal(crypto.createHash('sha256').update(callback).digest('hex'),'5b7055a0ca6402f7834793e1b91cdee9811ecea38875d26ffa0f36b76716b253');
    assert.match(source,/_pCharWifiConfig->setCallbacks\(new BLEWifiConfigCallbacks\(\)\)/);
    assert.match(source,/_pCharIrTrigger->setCallbacks\(new BLECommandCallbacks\(\)\)/);
    assert.match(source,/WifiProvisioning::receive\(String\(pChar->getValue\(\).c_str\(\)\)\)/);
    assert.match(source,/WiFi.status\(\) == WL_CONNECTED && WiFi.SSID\(\) == String\(_active.ssid\)/);
    assert.match(source,/doc\["backend_status"\] = "unverified"/);
  }
});

test('online controllers and cached/default settings do not become confirmed AC state; valid feedback survives sync', async()=>{
  const cache=new Map([['ecoTrack_aircons',JSON.stringify([{device_id:'AC-3232',node_id:'node-1',state:{power:true,mode:'cool',fan:'auto',temperature:25}}, {device_id:'AC-CACHE',node_id:'cache-node',state:{power:true,mode:'cool',fan:'auto'}}])]]);
  let aircon={id:'ac-1',asset_tag:'AC-3232',node_id:'node-1',brand:'Daikin'};
  const nodes=[{id:'node-1',name:'node-1',status:'online'},{id:'node-2',name:'node-2',status:'online'}];
  const sb={from(table){ const query={select(){return query;},order(){return query;},then(resolve,reject){return Promise.resolve({data:table==='nodes'?nodes:table==='aircons'?[aircon]:[]}).then(resolve,reject);}};return query;}};
  const context=vm.createContext({console,Date,Map,Set,localStorage:{getItem:key=>cache.get(key)||null,setItem:(key,value)=>cache.set(key,value)},window:{supabaseClient:sb},setTimeout(){},clearTimeout(){}});
  const source=read(path.join(desktop,'public/js/aircon-system.js'));
  const module={exports:{}};
  vm.runInNewContext(transpile(read('src/services/aircon-state.ts')),{module,exports:module.exports,Date});
  context.window.EcoTrackAirconState=module.exports;
  Object.assign(context,{isDatabaseSyncing:false,databaseSyncPending:false,databaseReferenceRefreshPending:false,referenceCache:null,referenceRead:null,referenceEpoch:0,databaseAuthVersion:0,AirconEvents:{emit(){}},CapabilityEngine:{resolveProtocolName:()=> 'DAIKIN216',getCapabilities:()=>({})}});
  for(const name of ['normalizeAirconNodeId','isAutoGeneratedTag','deduplicateAirconList','resolveRegisteredAirconNode','invalidateReferenceData','readReferenceData','syncWithDatabase']) vm.runInContext(declaration(path.join(desktop,'public/js/aircon-system.js'),name),context);
  await context.syncWithDatabase();
  let records=JSON.parse(cache.get('ecoTrack_aircons'));
  assert.ok(records.length>=3);
  for(const record of records){assert.equal(record.state.power,null);assert.equal(record.operational_state.classification,'UNCONFIRMED');}
  aircon={...aircon,reported_state:{power:'true',mode:'dry',fan:'low',temp:22},reported_at:'2026-10-05T01:00:00Z'};
  await context.syncWithDatabase();records=JSON.parse(cache.get('ecoTrack_aircons'));
  const confirmed=records.find(item=>item.device_id==='AC-3232');assert.equal(confirmed.state.power,true);assert.equal(confirmed.state.temperature,22);assert.equal(confirmed.state.mode,'dry');assert.equal(confirmed.operational_state.classification,'DRY MODE');
  aircon={...aircon,reported_state:null,reported_at:null,desired_state:{power:true,mode:'cool',temp:24,fan:'auto'},command_status:'transmitted'};
  await context.syncWithDatabase();records=JSON.parse(cache.get('ecoTrack_aircons'));
  const requested=records.find(item=>item.device_id==='AC-3232');assert.equal(requested.state.temperature,24);assert.equal(requested.operational_state.classification,'UNCONFIRMED');
  assert.equal(context.window.EcoTrackAirconState.describeAirconState(requested.control_snapshot).confirmed,false);
  assert.ok(source.includes('state: controlState'));
});

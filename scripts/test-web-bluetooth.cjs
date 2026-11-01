'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const transpile = code => ts.transpileModule(code, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
function loadAdapter() {
  const module={exports:{}};
  vm.runInNewContext(transpile(fs.readFileSync('src/services/web-bluetooth.ts','utf8')), {module,exports:module.exports,btoa,atob,Uint8Array,DataView,Map});
  return module.exports;
}
function fixture({chooseError,connectError,hasGatt=true}={}) {
  const calls=[];
  const bytes=Uint8Array.from([0,123,34,97,34,58,49,125,0]);
  const characteristic={readValue:async()=>new DataView(bytes.buffer,1,7),writeValueWithResponse:async value=>calls.push(['write',Array.from(value)])};
  const gatt={connected:false,connect:async()=>{calls.push('connect');if(connectError)throw connectError;gatt.connected=true;return gatt;},disconnect:()=>{calls.push('disconnect');gatt.connected=false;},getPrimaryService:async uuid=>{calls.push(['service',uuid]);return {getCharacteristic:async uuid=>{calls.push(['characteristic',uuid]);return characteristic;}};}};
  const environment={isSecureContext:true,navigator:{bluetooth:{requestDevice:options=>{calls.push(['chooser',options]);return chooseError?Promise.reject(chooseError):Promise.resolve({id:'browser-private-id',...(hasGatt?{gatt}:{})});}}}};
  return {environment,calls,gatt};
}
test('browser capability checks provide actionable secure-context and unsupported-browser instructions',()=>{
  const {webBluetoothAvailability}=loadAdapter();
  assert.equal(webBluetoothAvailability({isSecureContext:false}).available,false);
  assert.match(webBluetoothAvailability({isSecureContext:false}).message,/HTTPS or localhost/);
  assert.match(webBluetoothAvailability({isSecureContext:true,navigator:{}}).message,/Chrome or Edge/);
  assert.equal(webBluetoothAvailability(fixture().environment).available,true);
});
test('chooser opens within the click call and filters the actual firmware service UUID',async()=>{
  const f=fixture(),manager=loadAdapter().createWebBluetoothManager(f.environment);
  const pending=manager.requestDevice('firmware-service');
  assert.equal(f.calls[0][0],'chooser','No storage/network await may precede requestDevice');
  assert.equal(f.calls[0][1].filters[0].services[0],'firmware-service');
  assert.equal(await pending,'browser-private-id');
});
test('GATT bridge preserves service/characteristic UUIDs, byte offsets and credential bytes',async()=>{
  const f=fixture(),manager=loadAdapter().createWebBluetoothManager(f.environment);
  const id=await manager.requestDevice('service'),device=await manager.connectToDevice(id);
  assert.equal(await manager.isDeviceConnected(id),true);
  await device.discoverAllServicesAndCharacteristics();
  const read=await device.readCharacteristicForService('service','info');
  assert.equal(atob(read.value),'{"a":1}');
  const payload=Buffer.from(JSON.stringify({ssid:'Café',pass:'fixture-password'}));
  await device.writeCharacteristicWithResponseForService('service','wifi',payload.toString('base64'));
  assert.deepEqual(f.calls.find(c=>c[0]==='write')[1],Array.from(payload));
  await manager.cancelDeviceConnection(id);
  assert.equal(await manager.isDeviceConnected(id),false);
});
test('cancelled/denied choosers and missing GATT stop before any credential writes',async()=>{
  for(const [name,message] of [['NotFoundError',/No AC device selected/],['NotAllowedError',/Allow Bluetooth/],['SecurityError',/Allow Bluetooth/]]) {
    const f=fixture({chooseError:Object.assign(Error('blocked'),{name})}),m=loadAdapter().createWebBluetoothManager(f.environment);
    await assert.rejects(m.requestDevice('service'),message);
    assert.equal(f.calls.length,1);
  }
  const f=fixture({hasGatt:false}),m=loadAdapter().createWebBluetoothManager(f.environment);
  await assert.rejects(m.requestDevice('service'),/does not provide Bluetooth GATT/);
  await assert.rejects(m.connectToDevice('unselected'),/Choose the AC device again/);
});
function serviceHarness() {
  const calls=[],module={exports:{}};
  const manager={isDeviceConnected:async()=>true,devices:async()=>[{discoverAllServicesAndCharacteristics:async()=>{},requestMTU:async()=>{}}]};
  vm.runInNewContext(transpile(fs.readFileSync('src/services/device-service.ts','utf8')), {module,exports:module.exports,console,Date,setTimeout,clearTimeout,require:name=>name==='react-native'?{Platform:{OS:'web'}}:name==='./web-bluetooth'?{WebBluetoothManager:manager}:name==='@react-native-async-storage/async-storage'?{getItem:async()=>null,setItem:async()=>{calls.push('saved');}}:{}});
  const service=module.exports.BleDeviceService;
  service.resolveBleIdentifier=async()=>{calls.push('choose');return 'native-id';};
  service.connectBle=async()=>{calls.push('connect');return true;};
  service.disconnectBle=async()=>{calls.push('disconnect');};
  service.readControllerInfo=async()=>({device_id:'esp32s3-correct',cloud_protocol:1});
  service.provisionCloud=async()=>{calls.push('write');return {ip_address:'192.168.1.9'};};
  return {service,calls};
}
test('reconfiguration verifies the firmware identity and disconnects mismatched or failed connections',async()=>{
  const h=serviceHarness();
  assert.equal(await h.service.connectForWifiReconfigure({deviceId:'esp32s3-correct'}),'native-id');
  await assert.rejects(h.service.connectForWifiReconfigure({deviceId:'esp32s3-other'}),/does not match/);
  assert.equal(h.calls.at(-1),'disconnect');
  h.service.connectBle=async()=>false;
  await assert.rejects(h.service.connectForWifiReconfigure({deviceId:'esp32s3-correct'}),/Bluetooth connection failed/);
  assert.equal(h.calls.at(-1),'disconnect');
  assert.equal(h.calls.includes('write'),false);
});
test('Wi-Fi application repeats identity verification before writing credentials and saving success',async()=>{
  const h=serviceHarness();
  const denied=await h.service.configureWifi('native-id','Office','fixture-password',undefined,'esp32s3-other');
  assert.equal(denied.success,false);assert.match(denied.error,/does not match/);assert.equal(h.calls.includes('write'),false);
  const accepted=await h.service.configureWifi('native-id','Office','fixture-password',undefined,'esp32s3-correct');
  assert.equal(accepted.success,true);assert.equal(accepted.ipAddress,'192.168.1.9');
  assert.deepEqual(h.calls,['write','saved']);
});
function handler(name,context) {
  const source=ts.createSourceFile('devices.tsx',fs.readFileSync('src/app/devices.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let declaration;
  function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)===name)declaration=node.getText(source);ts.forEachChild(node,visit);}visit(source);
  assert.ok(declaration,name);
  const module={exports:{}};
  vm.runInNewContext(transpile('const '+declaration+';exports.run='+name),{module,exports:module.exports,...context});
  return module.exports.run;
}
test('closing reconfiguration ignores a late Bluetooth connection and disconnects it',async()=>{
  let complete;const events=[],attempt={current:0},connection={current:null};
  const connect=handler('handleConnectBleForReconfigure',{
    selectedDevice:{deviceId:'esp32s3-correct'},reconfigAttempt:attempt,reconfigBleConnection:connection,
    triggerHaptic(){},setReconfigConnecting(){},setReconfigError(){},
    BleDeviceService:{connectForWifiReconfigure:()=>new Promise(resolve=>{complete=resolve;}),disconnectBle:id=>{events.push(['disconnect',id]);},getSavedWifiNetworks:async()=>{events.push('saved');return [];}},
    setReconfigStep:step=>events.push(step),
  });
  const pending=connect();attempt.current++;complete('browser-id');await pending;
  assert.equal(connection.current,null);assert.deepEqual(events,[['disconnect','browser-id']]);
});
test('closing the dialog ignores late saved-network loading instead of replacing a new selection',async()=>{
  let complete;const events=[],attempt={current:0};
  const open=handler('handleStartReconfigureWifi',{
    reconfigAttempt:attempt,reconfigBleConnection:{current:null},triggerHaptic(){},setSelectedDevice(){},setOptionsModalVisible(){},setDetailsModalVisible(){},
    setReconfigStep(){},setReconfigError(){},setReconfigConnecting(){},setReconfigSelectedSsid:value=>events.push(value),setReconfigWifiPassword(){},setReconfigShowPassword(){},setReconfigVerifyStep(){},setReconfigModalVisible(){},
    BleDeviceService:{getSavedWifiNetworks:()=>new Promise(resolve=>{complete=resolve;})},setReconfigWifiNetworks:()=>events.push('networks'),
  });
  const pending=open({deviceId:'esp32s3-correct'});events.length=0;attempt.current++;complete([{ssid:'Old selection'}]);await pending;
  assert.deepEqual(events,[]);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const themeModule = { exports: {} };
const themeSource = fs.readFileSync('src/constants/theme.ts', 'utf8');
vm.runInNewContext(ts.transpileModule(themeSource.slice(themeSource.indexOf('export const Colors'), themeSource.indexOf('export type ThemeColor')), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: themeModule.exports });
const UiColors = themeModule.exports.Colors;
const airflowDisplay = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/airflow-pressure.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: airflowDisplay.exports });
const measurementDisplay = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/sensor-readings.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: measurementDisplay.exports, require: name => {
  assert.equal(name, './airflow-pressure');
  return airflowDisplay.exports;
} });
const batteryDisplay = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/battery-state.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: batteryDisplay.exports });
const sourceText = fs.readFileSync('src/app/devices.tsx', 'utf8');
const source = ts.createSourceFile('devices.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let result;
  function visit(node) { if (!result && predicate(node)) result = node; if (!result) ts.forEachChild(node, visit); }
  visit(source); assert.ok(result, 'Expected source declaration or UI section'); return result;
}
function declaration(name) {
  const node = find(n => (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) && n.name?.getText(source) === name);
  return (ts.isVariableDeclaration(node) ? 'const ' : '') + node.getText(source) + ';';
}
function evaluate(code, context = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText,
    { module, exports: module.exports, Date, UiColors, effectiveTheme: context.isDark ? 'dark' : 'light', console: { error() {} }, ...measurementDisplay.exports, ...batteryDisplay.exports, deviceMode: 'controller', AcDeviceTypePicker: 'TypePicker', ...context });
  return module.exports;
}
const formatters = evaluate(declaration('formatBatteryPercent') + declaration('formatConnectionLatency') + 'exports.battery = formatBatteryPercent; exports.latency = formatConnectionLatency;');
function renderSection(style, marker, context) {
  const node = find(n => ts.isJsxElement(n) && n.openingElement.attributes.getText(source).includes(`styles.${style}`) && n.getText(source).includes(marker));
  return evaluate(declaration('formatBatteryPercent') + declaration('formatConnectionLatency') + `exports.render = () => (${node.getText(source)});`, {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) }, View: 'View', ThemedText: 'Text', Pressable: 'Button',
    styles: new Proxy({}, { get: (_target, key) => key === 'infoVal' ? { flex: 1 } : {} }), isDark: false, testingConnection: false, testResult: null, ...context,
  }).render();
}
function elements(node) { return node && typeof node === 'object' ? [node, ...(node.props?.children || []).flatMap(elements)] : []; }
function text(node) { return Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props?.children || []) : node == null ? '' : String(node); }
const clean = value => JSON.parse(JSON.stringify(value));
const oldDevice = { id: 'n1', deviceId: 'ESP32-1', name: 'Room 1 AC', brand: 'Daikin', roomId: 'r1', room: 'Room 1', status: 'connected', battery: 85, updated: '2026-10-05T08:00:00Z' };
const rooms = [{ id: 'r1', name: 'Room 1' }, { id: 'r2', name: 'Room 2' }];

test('device battery uses the nodes percentage contract and rejects unavailable or invalid data', () => {
  for (const [value, expected] of [[0, '0%'], [15, '15%'], [85, '85%'], [100, '100%'], [85.6, '86%']]) assert.equal(formatters.battery(value), expected);
  for (const value of [null, undefined, NaN, Infinity, -1, 101]) assert.equal(formatters.battery(value), 'Unavailable');
  const tree = renderSection('infoList', 'Battery Level', { selectedDevice: oldDevice });
  assert.match(text(tree), /85%/); assert.doesNotMatch(text(tree), /Temperature Telemetry|RSSI|dBm|85V/);
});

test('latency is available only from a successful measured probe and has an explicit unavailable state', () => {
  assert.equal(formatters.latency({ online: true, pingMs: 23.7 }), '24 ms');
  assert.equal(formatters.latency({ online: true, pingMs: 0 }), '0 ms');
  for (const result of [null, { online: false, pingMs: 0 }, { online: true, pingMs: NaN }, { online: true, pingMs: -60 }]) assert.equal(formatters.latency(result), 'Unavailable');
  const tree = renderSection('infoList', 'Battery Level', { selectedDevice: { ...oldDevice, rssi: -66 }, testResult: { online: true, pingMs: 24 } });
  assert.match(text(tree), /Connection Latency.*24 ms/); assert.doesNotMatch(text(tree), /66 ms/);
});

test('Monitoring and Both device details display temperature and omit measured rotation', () => {
  for (const deviceMode of ['monitoring', 'both']) {
    const device = { ...oldDevice, deviceMode, temp: 24.5, rotation_rpm: 600, rotation_quality: 'ok', sensorConfig: { airflow_reference: { rpm: 1200 } } };
    const content = text(renderSection('infoList', 'Battery Level', { selectedDevice: device, formatTemperatureDisplay: value => `${value} °C` }));
    assert.match(content, /Temperature.*24.5 °C/);
    assert.doesNotMatch(content, /Airflow|RPM/);
    assert.doesNotMatch(content, /ESP32|MPX5010|Rotation speed/i);
    const missing = text(renderSection('infoList', 'Battery Level', { selectedDevice: { ...device, temp: null, rotation_rpm: null }, formatTemperatureDisplay: value => `${value} °C` }));
    assert.match(missing, /Temperature.*Unavailable/);
    assert.doesNotMatch(missing, /Airflow|RPM/);
  }
});

test('BLE discovery and manual identifiers do not invent milliseconds from RSSI or fixed placeholders', async () => {
  const prefix = fs.readFileSync('scripts/test-scoped-control-fixes.cjs', 'utf8').split('\ntest(')[0];
  const harness = vm.runInNewContext(prefix + ';bleHarness;', { require, console, process, Date, queueMicrotask, setTimeout, clearTimeout });
  const found = await harness({ devices: [{ id: 'AA:BB:CC:DD:EE:01', name: 'EcoTrack-node-1', rssi: -66 }] }).service.scanNearbyDevices();
  assert.equal(found[0].pingMs, null); assert.equal(found[0].bleId, 'AA:BB:CC:DD:EE:01');
  let selected;
  const run = evaluate(declaration('handleSelectManualNode') + 'exports.run = handleSelectManualNode;', {
    Alert: { alert() {} }, handleSelectBleDevice: device => { selected = device; },
  }).run;
  run('node-1'); assert.equal(selected.pingMs, null); assert.equal(selected.deviceId, 'node-1');
});

test('connection UI distinguishes a fresh cloud heartbeat from an unacknowledged ping', () => {
  for (const isDark of [false, true]) {
    const failed = renderSection('testResultBox', 'Cloud AC Device Reached', { isDark, testResult: { online: false, connectionState: 'online', pingMs: null, error: 'Administrator access required.' } });
    assert.match(text(failed), /Cloud Online · Ping Not Confirmed.*recent heartbeat.*Administrator access required/);
    assert.doesNotMatch(text(failed), /Unreachable|acknowledgement verified|0 ms/);
    const success = renderSection('testResultBox', 'Cloud AC Device Reached', { isDark, testResult: { online: true, pingMs: 17 } });
    assert.match(text(success), /Cloud AC Device Reached.*17 ms.*acknowledgement verified/);
    const hardware = renderSection('infoList', 'Battery Level', { isDark, selectedDevice: { ...oldDevice, status: 'offline' } });
    const offline = elements(hardware).find(element => element.type === 'Text' && text(element).trim() === 'Offline');
    assert.ok(offline); assert.equal(offline.props.style.at(-1).flex, 0); assert.equal(offline.props.style.at(-1).color, UiColors[isDark ? 'dark' : 'light'].error);
    const header = renderSection('modalHeader', 'selectedDevice?.deviceId', { isDark, selectedDevice: { ...oldDevice, status: 'offline' } });
    assert.equal(elements(header).find(element => text(element).includes('● Offline') && element.type === 'Text').props.style.color, UiColors[isDark ? 'dark' : 'light'].error);
  }
  const config = text(renderSection('infoList', 'Custom Aircon Name', { selectedDevice: { ...oldDevice, airconName: 'Matrix', protocolName: 'TCL112AC', room: undefined, building: undefined, floor: undefined } }));
  assert.match(config, /Custom Aircon Name Matrix.*IR Protocol TCL112AC.*Room details unavailable/);
  assert.doesNotMatch(config, /PIR \/ Occupancy|Available Offline Slots/);
});

function roomHandler(overrides = {}) {
  const state = { device: oldDevice, devices: [oldDevice], modal: true, saving: false, result: { online: true, pingMs: 12 }, error: null }, calls = [], alerts = [];
  const context = {
    selectedDevice: oldDevice, selectedChangeRoomId: 'r2', changeRoomSearchQuery: 'Room 2', availableRooms: rooms,
    changeRoomAirconName: oldDevice.name, changeRoomAirconBrand: oldDevice.brand, roomSavePending: { current: false }, connectionTestRequest: { current: 0 }, triggerHaptic() {},
    originalRoomMetadata: { current: { name: oldDevice.name, brand: oldDevice.brand } },
    setRoomSaveError: value => { state.error = value; },
    setSavingRoom: value => { state.saving = value; }, setSelectedDevice: value => { state.device = value; }, setDevices: fn => { state.devices = fn(state.devices); },
    setTestResult: value => { state.result = value; }, setTestingConnection() {}, setRoomChangeModalVisible: value => { state.modal = value; }, loadDevices: async () => calls.push(['refresh']),
    Alert: { alert: (...args) => alerts.push(args) }, DeviceService: {
      resolveRoomId: async id => { calls.push(['resolve', id]); return id; },
      updateDevice: async (id, updates) => { calls.push(['update', id, updates]); return { ...oldDevice, ...updates, room: 'Room 2' }; },
    }, ...overrides,
  };
  const handler = evaluate(declaration('handleSaveChangeRoom') + 'exports.run = handleSaveChangeRoom;', context).run;
  return { handler, state, calls, alerts, context };
}

test('room reassignment sends only changed metadata, retains the IR brand/protocol, and displays the confirmed location', async () => {
  const h = roomHandler(); await h.handler();
  const update = h.calls.find(call => call[0] === 'update'); assert.deepEqual(clean(update[2]), { roomId: 'r2' });
  assert.equal(h.state.device.roomId, 'r2'); assert.equal(h.state.devices[0].roomId, 'r2'); assert.equal(h.state.device.brand, 'Daikin');
  assert.equal(h.state.modal, false); assert.equal(h.state.saving, false); assert.equal(h.state.result, null); assert.equal(h.alerts.length, 0);
  const refreshed = roomHandler({ selectedDevice: { ...oldDevice, name: 'Renamed elsewhere', brand: 'Midea' } });
  await refreshed.handler();
  assert.deepEqual(clean(refreshed.calls.find(call => call[0] === 'update')[2]), { roomId: 'r2' });
});

test('unselected typed room text never silently saves the old room; custom and unassigned selections remain explicit', async () => {
  const mismatch = roomHandler({ selectedChangeRoomId: 'r1', changeRoomSearchQuery: 'New Room' }); await mismatch.handler();
  assert.equal(mismatch.calls.length, 0); assert.equal(mismatch.state.modal, true); assert.match(mismatch.state.error, /Choose a room/);
  for (const [id, query] of [['custom:New Room', 'New Room'], [null, '']]) {
    const h = roomHandler({ selectedChangeRoomId: id, changeRoomSearchQuery: query }); await h.handler();
    assert.equal(h.calls.find(call => call[0] === 'update')[2].roomId, id);
  }
  const edited = roomHandler({ changeRoomAirconName: 'New AC Name', changeRoomAirconBrand: 'Midea' }); await edited.handler();
  assert.deepEqual(clean(edited.calls.find(call => call[0] === 'update')[2]), { roomId: 'r2', name: 'New AC Name' });
});

test('failed room writes retain the prior location and repeated update taps cannot send duplicate transactions', async () => {
  const denied = roomHandler({ DeviceService: { resolveRoomId: async id => id, updateDevice: async () => null } }); await denied.handler();
  assert.equal(denied.state.device.roomId, 'r1'); assert.equal(denied.state.modal, true); assert.equal(denied.state.saving, false); assert.match(denied.state.error, /not saved/);
  let finish, writes = 0;
  const waiting = roomHandler({ DeviceService: { resolveRoomId: async id => id, updateDevice: async () => { writes++; return new Promise(resolve => { finish = resolve; }); } } });
  const first = waiting.handler(); await new Promise(resolve => setImmediate(resolve)); await waiting.handler(); assert.equal(writes, 1);
  finish({ ...oldDevice, roomId: 'r2' }); await first; assert.equal(waiting.context.roomSavePending.current, false);
});

function serviceHarness(options, saveTimeoutMs = 15000) {
  const prefix = fs.readFileSync('scripts/test-device-integration.cjs', 'utf8').split('const ac = h =>')[0];
  return vm.runInNewContext(prefix + ';harness;', { require, console, process, setTimeout: (callback, ms) => setTimeout(callback, ms === 15000 ? saveTimeoutMs : ms), clearTimeout, Date, AbortController })(options);
}

test('the device mutation uses its committed node row even when a post-move node read would be unavailable', async () => {
  const committed = { id: 'n1', name: oldDevice.name, status: 'offline', room_id: 'r2', battery: 70, brand: 'Daikin', protocol_name: 'DAIKIN2', updated: '2026-10-05T08:01:00Z' };
  const h = serviceHarness({ respond: q => {
    if (q.rpc) return { data: { node: committed }, error: null };
    if (q.table === 'nodes') throw Error('Post-move node read unavailable');
    return { data: q.ops.some(op => op[0] === 'gt') ? [] : q.table === 'rooms' ? [{ id: 'r2', name: 'Room 2', floor_id: 'f2' }] : q.table === 'floors' ? [{ id: 'f2', name: 'Floor 2', building_id: 'b2' }] : q.table === 'buildings' ? [{ id: 'b2', name: 'Main' }] : [], error: null };
  } });
  const updated = await h.load('src/services/device-service.ts').DeviceService.updateDevice('n1', { roomId: 'r2' });
  assert.ok(updated); assert.equal(updated.roomId, 'r2'); assert.equal(updated.room, 'Room 2'); assert.equal(updated.floor, 'Floor 2'); assert.equal(updated.building, 'Main'); assert.equal(updated.status, 'offline');
  assert.equal(h.calls.some(call => call.table === 'nodes'), false); assert.deepEqual(clean(h.calls[0].args.p_payload), { room_id: 'r2' });
  for (const response of [{ data: null, error: { code: '42501' } }, { data: { node: { id: 'different' } }, error: null }]) {
    const denied = serviceHarness({ respond: () => response });
    assert.equal(await denied.load('src/services/device-service.ts').DeviceService.updateDevice('n1', { roomId: 'r2' }), null);
    assert.equal(denied.calls.length, 1);
  }
});

test('late connection-test results cannot replace another device selection', async () => {
  let finish; const results = [], loading = [], alerts = [], request = { current: 0 };
  const run = evaluate(declaration('handleRunConnectionTest') + 'exports.run = handleRunConnectionTest;', {
    selectedDevice: oldDevice, triggerHaptic() {}, setTestingConnection: value => loading.push(value), setTestResult: value => results.push(value), connectionTestRequest: request,
    BleDeviceService: { testDeviceConnection: () => new Promise(resolve => { finish = resolve; }) }, Alert: { alert: (...args) => alerts.push(args) },
  }).run;
  const pending = run(); request.current++; finish({ online: true, pingMs: 25 }); await pending;
  assert.deepEqual(results, [null]); assert.deepEqual(loading, [true]); assert.equal(alerts.length, 0);
});

test('device refresh updates open status/location, preserves newer confirmed saves, and retains details after read failure', async () => {
  for (const scenario of ['fresh', 'old', 'failed']) {
    let selected = oldDevice, message = null;
    const fresh = { ...oldDevice, roomId: 'r2', room: 'Room 2', status: 'offline', updated: scenario === 'old' ? '2026-10-05T07:59:00Z' : '2026-10-05T08:02:00Z' };
    const run = evaluate(declaration('refreshDeviceData') + 'exports.run = refreshDeviceData;', {
      useCallback: callback => callback, fetchUser: 'user-1', isSessionCurrent:()=>true, startLoading(){},
      commit: change=>change({devices:[oldDevice],availableRooms:rooms}), fail:value=>{message=value;},
      createReadScope: () => ({ assertSuccessful() {} }), fetchDevices: async () => { if (scenario === 'failed') throw Error('offline'); return [fresh]; }, DeviceService: { fetchAvailableRooms: async () => rooms },
      setSelectedDevice: fn => { selected = fn(selected); }, setHasDeviceSnapshot() {}, setDevices() {}, setAvailableRooms() {}, setLoading() {}, setFetchError: value => { message = value; },
      setTestResult() {}, setTestingConnection() {}, connectionTestRequest: { current: 0 },
    }).run;
    await run(() => true);
    assert.equal(selected.roomId, scenario === 'fresh' ? 'r2' : 'r1'); assert.equal(selected.status, scenario === 'fresh' ? 'offline' : 'connected');
    assert.equal(message !== null, scenario === 'failed');
  }
});


test('selecting custom naming again keeps the admin typed air conditioner name', () => {
  let draft = 'East Lab AC';
  const tree = renderSection('inputGroup', 'Available air conditioner', {
    ScrollView: 'Scroll', availableAircons: [], assignmentId: null,
    setAssignmentId() { throw Error('Selection should not reset'); }, setCustomAirconName: value => { draft = value; },
  });
  const choice = elements(tree).find(node => node.type === 'Button');
  assert.equal(choice.props.accessibilityState.selected, true);
  choice.props.onPress();
  assert.equal(draft, 'East Lab AC');
});

test('existing AC selection retains its profile, protocol and deployment independently of the controller name', () => {
  const picked = {}, profile = { id: 'ac-2', airconName: 'West Lab AC', deviceId: 'AC-2', brand: 'Daikin', airconType: 'Cassette Type (Inverter)', roomId: 'r2', protocolName: 'DAIKIN2' };
  const tree = renderSection('inputGroup', 'Available air conditioner', {
    ScrollView: 'Scroll', availableAircons: [profile], assignmentId: 'ac-2', resetRemoteDetection() {},
    setAssignmentId: value => { picked.id = value; },
    setCustomAirconName: value => { picked.name = value; },
    setSelectedBrand: value => { picked.brand = value; },
    setSelectedAirconType: value => { picked.type = value; },
    setSelectedRoomId: value => { picked.room = value; },
    setDetectedRemoteInfo: value => { picked.remote = value; },
  });
  function flatten(node) { return Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? [node, ...flatten(node.props?.children || [])] : []; }
  const choices = flatten(tree).filter(node => node.type === 'Button');
  assert.equal(choices.length, 2);
  assert.equal(choices[0].props.accessibilityState.selected, false);
  assert.equal(choices[1].props.accessibilityState.selected, true);
  choices[1].props.onPress();
  assert.deepEqual(clean(picked), { id: 'ac-2', name: 'West Lab AC', brand: 'Daikin', type: 'Cassette Type (Inverter)', room: 'r2', remote: { brand: 'Daikin', protocol: 'DAIKIN2' } });
});

test('confirmed renames survive failed supplemental reads and require the requested name in the receipt', async () => {
  const committed = { id: 'n1', name: 'East Controller', room_id: 'r1', protocol_name: 'legacy-alias', updated: '2026-10-17T10:00:00Z' };
  const h = serviceHarness({ respond: q => {
    if (q.rpc) return { data: { node: committed }, error: null };
    throw Error('Supplemental network unavailable');
  } });
  const result = await h.load('src/services/device-service.ts').DeviceService.updateDevice('n1', { name: ' East Controller ' }, { ...oldDevice, airconName: 'Matrix', protocolName: 'TCL112AC' });
  assert.equal(result.name, 'East Controller'); assert.equal(result.airconName, 'Matrix'); assert.equal(result.protocolName, 'TCL112AC');
  assert.equal(result.id, 'n1'); assert.equal(h.calls.length, 1);
  assert.deepEqual(clean(h.calls[0].args.p_payload), { name: 'East Controller' });
  const mismatch = serviceHarness({ respond: () => ({ data: { node: { ...committed, name: 'Old name' } }, error: null }) });
  assert.equal(await mismatch.load('src/services/device-service.ts').DeviceService.updateDevice('n1', { name: 'East Controller' }), null);
});

test('manufacturer text edits preserve the exact IR protocol instead of deriving an encoder', async () => {
  const h = serviceHarness({ respond: q => q.rpc
    ? { data: { node: { id: 'n1', name: 'Controller', brand: 'Matrix', protocol_name: 'TCL112AC' } }, error: null }
    : { data: [], error: null } });
  const result = await h.load('src/services/device-service.ts').DeviceService.updateDevice('n1', { brand: 'Matrix' });
  assert.equal(result.protocolName, 'TCL112AC');
  assert.deepEqual(clean(h.calls.find(call => call.rpc).args.p_payload), { brand: 'Matrix' });
});

test('rename save prevents duplicate writes and updates both open details and the list from the confirmed row', async () => {
  const state = { selected: oldDevice, devices: [oldDevice], modal: true, details: false, saving: false }, pending = { current: false };
  let finish, writes = 0;
  const run = evaluate(declaration('handleSaveRename') + 'exports.run = handleSaveRename;', {
    selectedDevice: oldDevice, renameInput: 'New Controller', renameSavePending: pending,
    renameFromDetails: { current: true }, triggerHaptic() {}, setRenameError() {},
    setSavingRename: value => { state.saving = value; },
    setSelectedDevice: value => { state.selected = value; },
    setDevices: fn => { state.devices = fn(state.devices); },
    setRenameModalVisible: value => { state.modal = value; },
    setDetailsModalVisible: value => { state.details = value; }, loadDevices: () => new Promise(() => {}),
    Alert: { alert() { throw Error('Rename should succeed'); } },
    DeviceService: { updateDevice: async () => { writes++; return new Promise(resolve => { finish = resolve; }); } },
  }).run;
  const first = run(); await Promise.resolve(); await run(); assert.equal(writes, 1);
  finish({ ...oldDevice, name: 'New Controller' }); await first;
  assert.equal(state.selected.name, 'New Controller'); assert.equal(state.devices[0].name, 'New Controller');
  assert.equal(state.modal, false); assert.equal(state.details, true); assert.equal(state.saving, false); assert.equal(pending.current, false);
});

test('browser rename errors stay visible in the open dialog and release the save guard', async () => {
  const errors=[],pending={current:false},visible=[],busy=[];
  const run=evaluate(declaration('handleSaveRename')+'exports.run=handleSaveRename;',{
    selectedDevice:oldDevice,renameInput:'New Controller',renameSavePending:pending,renameFromDetails:{current:false},triggerHaptic(){},
    setSavingRename:value=>busy.push(value),setRenameError:value=>errors.push(value),setRenameModalVisible:value=>visible.push(value),
    DeviceService:{updateDevice:async()=>{throw Error('The selected room is unavailable.');}},
    Alert:{alert(){}},
  }).run;
  await run();
  assert.deepEqual(errors,[null,'The selected room is unavailable.']);assert.deepEqual(visible,[]);
  assert.deepEqual(busy,[true,false]);assert.equal(pending.current,false);
});

test('room save closes on the committed row even while background refresh is still pending', async () => {
  const h=roomHandler({loadDevices:()=>new Promise(()=>{})});
  await h.handler();
  assert.equal(h.state.modal,false);assert.equal(h.state.saving,false);assert.equal(h.state.device.roomId,'r2');
});

test('failed room saves show the server error inline and allow a retry',async()=>{
  const h=roomHandler({DeviceService:{resolveRoomId:async()=> 'r2',updateDevice:async()=>{throw Error('Your room assignment changed.');}}});
  await h.handler();
  assert.equal(h.state.error,'Your room assignment changed.');assert.equal(h.state.modal,true);assert.equal(h.state.saving,false);
  assert.equal(h.context.roomSavePending.current,false);
});

test('metadata saves use the confirmed row without waiting for unrelated room or telemetry reads',async()=>{
  const committed={id:'n1',name:'New Controller',room_id:'r2',protocol_name:'TCL112AC'};
  const h=serviceHarness({respond:q=>{if(q.rpc)return {data:{node:committed},error:null};throw Error('Supplemental read must not run');}});
  const result=await h.load('src/services/device-service.ts').DeviceService.updateDevice('n1',{name:'New Controller',roomId:'r2'},{...oldDevice,airconName:'Matrix'},{throwOnError:true});
  assert.equal(result.name,'New Controller');assert.equal(result.roomId,'r2');assert.equal(result.airconName,'Matrix');assert.equal(h.calls.length,1);
});

test('strict saves surface permission and receipt errors; hung saves stop with uncertain confirmation',async()=>{
  for(const [response,message] of [
    [{data:null,error:{code:'42501'}},/active assigned room/],
    [{data:{node:{id:'n1',name:'Old Controller'}},error:null},/did not confirm the new/],
    [{data:{node:{id:'n1',name:'New Controller',room_id:'r1'}},error:null},/did not confirm the selected room/],
  ]) {
    const h=serviceHarness({respond:()=>response});
    await assert.rejects(h.load('src/services/device-service.ts').DeviceService.updateDevice('n1',{name:'New Controller',roomId:'r2'},oldDevice,{throwOnError:true}),message);
  }
  const h=serviceHarness({respond:()=>new Promise(()=>{})},10);
  await assert.rejects(h.load('src/services/device-service.ts').DeviceService.updateDevice('n1',{name:'New Controller'},oldDevice,{throwOnError:true}),/may have saved/);
});

test('both save dialogs render loading indicators and browser-visible errors',()=>{
  for(const [marker,loading,error] of [['Rename AC Device','savingRename','renameError'],['Reassign Room','savingRoom','roomSaveError']]) {
    const tree=renderSection('confirmBox',marker,{
      selectedDevice:oldDevice,renameInput:'New Controller',savingRename:false,renameError:null,roomSaveError:null,
      handleCloseRename(){},handleSaveRename(){},setRenameInput(){},TextInput:'Input',ActivityIndicator:'Spinner',KeyboardAvoidingView:'Keyboard',ScrollView:'Scroll',AppIcon:'Icon',
      savingRoom:false,filteredChangeRooms:[],selectedChangeRoomId:null,changeRoomSearchQuery:'',changeRoomAirconName:'New Controller',isCustomChangeRoomQuery:false,
      setChangeRoomSearchQuery(){},setSelectedChangeRoomId(){},setChangeRoomAirconName(){},triggerHaptic(){},setRoomChangeModalVisible(){},handleSaveChangeRoom(){},
      colors:UiColors.dark,[loading]:true,[error]:'Save could not be confirmed.',
    });
    assert.ok(elements(tree).some(node=>node.type==='Spinner'));assert.match(text(tree),/Saving…/);assert.match(text(tree),/Save could not be confirmed/);
    assert.ok(elements(tree).some(node=>node.type==='Button'&&node.props.accessibilityState?.busy&&node.props.disabled));
  }
});


test('cached device connectivity ages from the original heartbeat without inventing a new timestamp', () => {
  const h = serviceHarness({respond:()=>({data:[],error:null})});
  const service = h.load('src/services/device-service.ts').DeviceService;
  const old = { ...oldDevice, lastSeenAt: new Date(Date.now()-120000).toISOString(), lastSeen:'Just now' };
  const aged = service.refreshConnectionAge(old);
  assert.equal(aged.status,'offline'); assert.equal(aged.wifiStatus,'disconnected'); assert.equal(aged.lastSeen,'2m ago');
  assert.equal(aged.lastSeenAt,old.lastSeenAt);
  const fresh = service.refreshConnectionAge({...old,lastSeenAt:new Date().toISOString()});
  assert.equal(fresh.status,'connected'); assert.equal(fresh.lastSeen,'Just now');
  assert.equal(service.refreshConnectionAge({...old,lastSeenAt:null}).status,'offline');
});

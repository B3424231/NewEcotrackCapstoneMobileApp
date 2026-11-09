const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const prefix = fs.readFileSync('scripts/test-cloud-hardware-integration.cjs', 'utf8').split('\ntest(')[0];
const harness = vm.runInNewContext(prefix + ';harness;', { require, console });
const now = Date.parse('2026-10-11T08:00:00Z');
const at = new Date(now).toISOString();
const config = (percent = 4, extra = {}) => ({ battery_percent_estimate: percent, battery_voltage: 3.4,
  battery_charging: true, battery_charge_state: 'charging', battery_source: 'mock', battery_capacity_mah: 5200, ...extra });
const row = (percent, extra = {}) => ({ node_id: 'n1', device_id: 'esp32s3-111111111111', last_seen: at, applied_config: config(percent), ...extra });
const item = { id: 'n1', name: 'Device', roomId: 'r1', status: 'optimal', battery: '81%' };

test('home consumes explicit heartbeat percentages including zero through five without converting them to volts', () => {
  const h = harness(() => ({ data: [], error: null }));
  const { applyHomeControllerState } = h.load('src/services/home-controller-state.ts');
  for (const percent of [0, 1, 4, 5, 20, 21, 99, 100]) {
    const value = applyHomeControllerState(item, row(percent), now);
    assert.equal(value.battery, percent + '%');
    assert.equal(value.batteryState.voltage, 3.4);
    assert.equal(value.batteryState.observedAt, at);
  }
  assert.equal(applyHomeControllerState(item, { ...row(4), applied_config: {} }, now).battery, '81%');
});

test('charging is explicit, fresh and awake; online status alone cannot invent it', () => {
  const h = harness(() => ({ data: [], error: null }));
  const { applyHomeControllerState } = h.load('src/services/home-controller-state.ts');
  const { batteryReading } = h.load('src/services/controller-display.ts');
  const display = (r, time = now) => { const value = applyHomeControllerState(item, r, time); return batteryReading(value.battery, value.batteryState, value.connectionState === 'online', time); };
  assert.equal(display(row(4)).status, 'Charging');
  assert.equal(display(row(100, { applied_config: config(100, { battery_charging: false, battery_charge_state: 'full' }) })).status, 'Fully charged');
  assert.equal(display(row(20, { applied_config: config(20, { battery_charging: false, battery_charge_state: 'discharging' }) })).status, 'On battery');
  for (const r of [row(4, { applied_config: {} }), row(4, { sleeping_until: new Date(now + 60000).toISOString() }),
    row(4, { last_seen: new Date(now + 5001).toISOString() })]) assert.equal(display(r).status, null);
  assert.equal(display(row(4), now + 45001).status, null);
  assert.equal(display(row(4), now + 45001).text, '4%');
  assert.equal(display(row(4, { applied_config: config(4, { battery_charging: 'true', battery_charge_state: 'unknown' }) })).status, null);
  for (const [percent, extra] of [[20, { battery_charging: false, battery_charge_state: 'full' }],
    [100, { battery_charging: true }], [4, { battery_charge_state: undefined }],
    [4, { battery_charging: false, battery_charge_state: undefined }],
    [100, { battery_charging: undefined, battery_charge_state: 'full' }]]) {
    assert.equal(display(row(percent, { applied_config: config(percent, extra) })).status, null);
  }
});

test('invalid explicit battery values clear the percentage instead of falling back to a previous reading', () => {
  const { applyHomeControllerState } = harness(() => ({})).load('src/services/home-controller-state.ts');
  for (const percent of [null, '4', -1, 101, NaN, Infinity]) assert.equal(applyHomeControllerState(item, row(percent), now).battery, '—');
});

test('home protects newer battery data across delayed heartbeats and full fetches', () => {
  const { applyHomeControllerState, mergeHomeControllerFetch } = harness(() => ({})).load('src/services/home-controller-state.ts');
  const latest = applyHomeControllerState(item, row(21), now);
  const old = row(4, { last_seen: new Date(now - 1000).toISOString() });
  assert.equal(applyHomeControllerState(latest, old, now).battery, '21%');
  const fetched = { ...applyHomeControllerState(item, old, now), name: 'Renamed' };
  const merged = mergeHomeControllerFetch([fetched], [latest])[0];
  assert.equal(merged.name, 'Renamed'); assert.equal(merged.battery, '21%');
  assert.equal(merged.batteryState.observedAt, at);
  assert.equal(mergeHomeControllerFetch([{ ...fetched, roomId: 'r2' }], [latest])[0].battery, '4%');
});

test('device inventory and an open device receive battery changes without a full reload', async () => {
  const h = harness(call => ({ data: call.ops?.some(op => op[0] === 'gt') ? [] : call.table === 'nodes'
    ? [{ id: 'n1', name: 'Room device', battery: 81, room_id: 'r1' }]
    : call.table === 'ecotrack_device_state' ? [row(4)] : [], error: null }));
  const { DeviceService } = h.load('src/services/device-service.ts');
  const devices = await DeviceService.getDevices();
  assert.equal(devices[0].battery, 4);
  const updated = DeviceService.applyHardwareState(devices[0], row(21, { last_seen: new Date(now + 1000).toISOString() }));
  assert.equal(updated.battery, 21); assert.equal(updated.batteryState.charging, true);
  assert.equal(DeviceService.applyHardwareState(updated, row(4)).battery, 21);
});

test('future heartbeats cannot prevent a later valid battery update', () => {
  const h = harness(() => ({})), { DeviceService } = h.load('src/services/device-service.ts');
  const { applyHomeControllerState } = h.load('src/services/home-controller-state.ts');
  const future = row(4, { last_seen: new Date(now + 60000).toISOString() });
  const next = row(22, { last_seen: new Date(now + 1000).toISOString() });
  const home = applyHomeControllerState(applyHomeControllerState(item, future, now), next, now + 1000);
  assert.equal(home.battery, '22%');
  const device = DeviceService.applyHardwareState(DeviceService.applyHardwareState({ id: 'n1' }, future), next);
  assert.equal(device.battery, 22);
});

function deviceFragment(name, context) {
  const ts = require('typescript'), source = ts.createSourceFile('devices.tsx', fs.readFileSync('src/app/devices.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node; ts.forEachChild(node, visit); }; visit(source);
  vm.runInNewContext(ts.transpileModule('exports.value=' + found.initializer.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: context, ...context });
  return context.value;
}

test('device refresh keeps newer heartbeat battery data while accepting renamed metadata', async () => {
  const { DeviceService } = harness(() => ({})).load('src/services/device-service.ts');
  const fresh = { id: 'n1', name: 'Renamed', roomId: 'r1', battery: 4, lastSeenAt: new Date(now - 1000).toISOString() };
  const latest = DeviceService.applyHardwareState({ ...fresh, name: 'Original' }, row(21));
  let data = { devices: [latest] }, selected = latest;
  const context = { DeviceService, useCallback: x => x, isSessionCurrent: () => true, startLoading() {},
    createReadScope: () => ({ assertSuccessful() {} }), fetchDevices: async () => [fresh],
    commit: fn => { data = fn(data); }, setSelectedDevice: fn => { selected = fn(selected); }, fail() {}, console };
  DeviceService.fetchAvailableRooms = async () => [];
  await deviceFragment('refreshDeviceData', context)(() => true);
  for (const value of [data.devices[0], selected]) {
    assert.equal(value.name, 'Renamed'); assert.equal(value.battery, 21); assert.equal(value.batteryState.observedAt, at);
  }
});

test('real home card and detail sheet show ordinary charge labels and suppress stale charging', () => {
  const React = require('react'), SSR = require('react-dom/server'), Web = require('react-native-web');
  const source = fs.readFileSync('scripts/render-temperature-rotation-fixtures.cjs', 'utf8');
  const context = { require, console, exports: {} };
  const loader = source.slice(0, source.indexOf('const Picker=')).replace(/^const out=.*\r?\n/m, '').replace("if(name==='react')", "if(name==='@/services/airflow-pressure')return load('src/services/airflow-pressure.ts');if(name==='@/services/supabase')return {supabase:{}};if(name==='@/context/auth-context')return {useAuth:()=>({userType:'staff',userId:'fixture'})};if(name==='react')");
  vm.runInNewContext(loader + ';exports.load=load;', context);
  const current = new Date().toISOString();
  const batteryState = { percent: 4, voltage: 3.4, charging: true, chargeState: 'charging', observedAt: current, source: 'mock' };
  for (const [file, name] of [['sensor-card.tsx', 'AcControllerCard'], ['sensor-detail-sheet.tsx', 'AcControllerDetailSheet']]) {
    const Component = context.exports.load('src/components/' + file)[name];
    const render = extra => SSR.renderToStaticMarkup(React.createElement(Component, { controller: { ...item, battery: '4%', batteryState, connectionState: 'online', ...extra }, visible: true, onClose() {}, slideAnim: new Web.Animated.Value(0) }));
    assert.match(render(), /Charging/); assert.match(render(), /4%/);
    assert.doesNotMatch(render(), /mock|simulation/i);
    assert.doesNotMatch(render({ connectionState: 'offline' }), /Charging/);
    assert.doesNotMatch(render({ batteryState: { ...batteryState, observedAt: new Date(Date.now() - 45001).toISOString() } }), /Charging/);
    assert.match(render({ battery: '100%', batteryState: { ...batteryState, percent: 100, charging: false, chargeState: 'full' } }), /Fully charged/);
    assert.match(render({ batteryState: { ...batteryState, charging: false, chargeState: 'discharging' } }), /On battery/);
  }
});

function deviceEffect(context) {
  const ts = require('typescript'), source = ts.createSourceFile('devices.tsx', fs.readFileSync('src/app/devices.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  const visit = node => { if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.getText(source).includes('DeviceService.subscribeToDeviceChanges')) effect = node.arguments[0]; ts.forEachChild(node, visit); }; visit(source);
  vm.runInNewContext(ts.transpileModule('exports.effect=' + effect.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports.effect();
}

test('Devices recovers missed battery events for visible devices and stops polling when inactive or disposed', async () => {
  const { DeviceService } = harness(() => ({})).load('src/services/device-service.ts');
  DeviceService.subscribeToDeviceChanges = () => () => {};
  let devices = [{ id: 'n1', roomId: 'r1', battery: 81 }], selected = devices[0], active = true;
  const intervals = new Map(), calls = [], exports = {};
  const context = { exports, DeviceService, refreshDeviceData() {}, isSessionCurrent: () => true, AppState: {},
    refreshRef: { current: null }, visibleDevices: { current: devices },
    createRefreshCoordinator: () => ({ isActive: () => active, refresh() {}, schedule() {}, dispose() {} }),
    CloudHardware: { listUpdates: async (...args) => { calls.push(args); return [row(21)]; } },
    setDevices: fn => { devices = fn(devices); }, setSelectedDevice: fn => { selected = fn(selected); },
    setInterval: (fn, ms) => { intervals.set(ms, fn); return ms; }, clearInterval: id => intervals.delete(id), Date, console };
  const cleanup = deviceEffect(context);
  const poll = [...intervals.entries()].find(([ms]) => ms <= 10000)?.[1];
  assert.ok(poll, 'visible battery recovery must run without manual refresh');
  poll(); await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][0])), ['n1']);
  assert.equal(devices[0].battery, 21); assert.equal(selected.battery, 21);
  active = false; poll(); await new Promise(setImmediate); assert.equal(calls.length, 1);
  cleanup(); assert.equal(intervals.size, 0);
  active = true; poll(); await new Promise(setImmediate); assert.equal(calls.length, 1);
});

test('future inventory hydration recovers through valid fetch and incremental changes without a future polling cursor', async () => {
  let serverRow = row(4, { last_seen: new Date(now + 3600000).toISOString() });
  const h = harness(call => ({ data: call.ops?.some(op => op[0] === 'gt') ? [] : call.table === 'nodes'
    ? [{ id: 'n1', name: 'Room device', battery: 81, room_id: 'r1' }]
    : call.table === 'ecotrack_device_state' ? [serverRow] : [], error: null }));
  const { DeviceService } = h.load('src/services/device-service.ts');
  const first = (await DeviceService.getDevices())[0];
  serverRow = row(22);
  const fetched = (await DeviceService.getDevices())[0];
  const merged = DeviceService.mergeDeviceFetch(fetched, first);
  const next = row(23, { last_seen: new Date(now + 1000).toISOString() });
  const updated = DeviceService.applyHardwareState(merged, next);
  assert.equal(updated.battery, 23);
  assert.equal(updated.lastSeenAt, next.last_seen);
  assert.equal(first.lastSeenAt, null);
  const oldPoisoned = { ...first, lastSeenAt: new Date(now + 3600000).toISOString() };
  assert.equal(DeviceService.applyHardwareState(oldPoisoned, next).battery, 23);
  assert.equal(DeviceService.mergeDeviceFetch(fetched, oldPoisoned).lastSeenAt, at);
  DeviceService.subscribeToDeviceChanges = () => () => {};
  const calls = [], intervals = new Map();
  const cleanup = deviceEffect({ exports: {}, DeviceService, refreshDeviceData() {}, isSessionCurrent: () => true,
    AppState: {}, refreshRef: { current: null }, visibleDevices: { current: [updated] },
    createRefreshCoordinator: () => ({ isActive: () => true, refresh() {}, schedule() {}, dispose() {} }),
    CloudHardware: { listUpdates: async (...args) => { calls.push(args); return []; } },
    setDevices() {}, setSelectedDevice() {}, setInterval: (fn, ms) => { intervals.set(ms, fn); return ms; }, clearInterval: id => intervals.delete(id), Date, console });
  intervals.get(5000)(); await new Promise(setImmediate);
  assert.equal(calls[0][1], '2026-10-11T07:59:01.000Z');
  cleanup();
});

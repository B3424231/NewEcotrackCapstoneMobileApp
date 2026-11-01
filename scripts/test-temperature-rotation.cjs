const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const prefix = fs.readFileSync('scripts/test-cloud-hardware-integration.cjs', 'utf8').split('\ntest(')[0];
const makeHarness = vm.runInNewContext(prefix + ';harness;', { require, console });
const load = file => makeHarness(() => ({ data: [], error: null })).load(file);
const readings = load('src/services/sensor-readings.ts');
const home = load('src/services/home-controller-state.ts');
const now = Date.parse('2026-10-11T08:00:00Z');
const item = { id: 'n1', name: 'Monitor', deviceMode: 'monitoring', roomId: 'r1', status: 'optimal', rotation_rpm: 25.5 };
const row = { node_id: 'n1', device_id: 'esp32s3-111111111111', last_seen: '2026-10-11T08:00:00Z' };

test('rotation preserves measured zero and rejects missing, invalid or failed readings', () => {
  for (const value of [0, 25.5, 1000]) assert.equal(readings.measuredRotation(value), value);
  for (const value of [null, undefined, '', '100', false, -1, NaN, Infinity]) {
    assert.equal(readings.measuredRotation(value), null);
    assert.equal(readings.rotationReading(value), 'Unavailable');
  }
  for (const quality of ['missing', 'fault']) assert.equal(readings.rotationReading(100, quality), 'Unavailable');
  assert.equal(readings.rotationReading(0, 'ok'), 'Reference needed');
  assert.equal(readings.rotationReading(0, 'ok', {airflow_reference:{rpm:1200}}), '0%');
  assert.equal(readings.rotationReading(600, 'ok', {airflow_reference:{rpm:1200}}), '50%');
});

test('Monitoring and Both accept fresh rotation samples without inventing AC power', () => {
  for (const deviceMode of ['monitoring', 'both']) {
    const result = home.applyHomeControllerState({ ...item, deviceMode }, { ...row, rotation_rpm: 40.5, rotation_quality: 'ok' }, now);
    assert.equal(result.rotation_rpm, 40.5);
    assert.equal(result.connectionState, 'online');
    assert.equal(result.powerSetting, undefined);
    assert.equal(home.applyHomeControllerState(result, { ...row, rotation_rpm: null, rotation_quality: 'missing' }, now).rotation_rpm, null);
    assert.equal(home.applyHomeControllerState(result, { ...row, rotation_rpm: 40.5, rotation_quality: 'fault' }, now).rotation_rpm, null);
    assert.equal(home.applyHomeControllerState(result, { ...row, node_id: 'foreign', rotation_rpm: 900 }, now), result);
  }
});

test('late full fetch cannot overwrite a newer measured rotation sample', () => {
  const latest = home.applyHomeControllerState(item, { ...row, rotation_rpm: 85 }, now);
  const old = { ...item, name: 'Renamed monitor', lastSeen: '2026-10-11T07:59:00Z', rotation_rpm: 1 };
  const merged = home.mergeHomeControllerFetch([old], [latest])[0];
  assert.equal(merged.name, 'Renamed monitor');
  assert.equal(merged.rotation_rpm, 85);
});

test('live monitoring mapping retires legacy measurements and uses the explicit monitored AC link', async () => {
  const backendPrefix = fs.readFileSync('scripts/test-backend.cjs', 'utf8').split('const service = h =>')[0];
  const backend = vm.runInNewContext(backendPrefix + ';harness;', { require, console, process, Response, Blob, URL, Date, Uint8Array, ArrayBuffer, setTimeout, clearTimeout });
  const data = {
    nodes: [{ id: 'n1', name: 'ESP32 monitor', room_id: 'r1', device_mode: 'monitoring', monitor_aircon_id: 'ac1', temp: null, rotation_rpm: null, pressure: 5000, sensor_config: { pressure_sensor: 'MPX5010DP' } }],
    rooms: [{ id: 'r1', name: 'Lab', floor_id: 'f1' }], floors: [{ id: 'f1', name: 'Floor', building_id: 'b1' }], buildings: [{ id: 'b1', name: 'Building' }],
    aircons: [{ id: 'ac1', controller_node_id: 'other-controller', name: 'Lab cooling', aircon_type: 'Split' }],
  };
  const h = backend(call => ({ data: (data[call.table] || []).filter(row => call.ops.filter(op => op[0] === 'eq').every(op => row[op[1]] === op[2]) && call.ops.filter(op => op[0] === 'gt').every(op => row[op[1]] > op[2])), error: null }));
  const result = await h.load('src/services/supabase.ts').fetchLiveSensors('r1');
  assert.equal(result.length, 1);
  assert.equal(result[0].rotation_rpm, null);
  assert.equal(result[0].ventTemp, '—');
  assert.equal(result[0].associatedAc, 'Lab cooling · Split');
  assert.equal(result[0].deviceMode, 'monitoring');
  assert.equal(result[0].name, 'Device 1');
  assert.equal(Object.hasOwn(result[0], 'pressure'), false);
  assert.equal(Object.hasOwn(result[0], 'sensor_config'), false);
  assert.doesNotMatch(result[0].details, /within acceptable/);
  assert.doesNotMatch(JSON.stringify(result[0]), /MPX5010DP|5000/);
});

test('visible board labels are functional while actual identifiers are not mutated', () => {
  for (const id of ['esp32s3-9cd20604a7ac', 'ESP32-1', 'MPX5010DP', 'LM393']) {
    assert.doesNotMatch(readings.displayDeviceId(id), /esp32|mpx5010|lm393/i);
    assert.equal(readings.displayDeviceId(id), readings.displayDeviceId(id));
  }
  assert.equal(readings.displayDeviceId('node-7'), 'node-7');
  assert.equal(readings.functionalDeviceText('Reconnect to ESP32-S3; check MCP9808 and LM393.'), 'Reconnect to Device; check Device and Device.');
  const { equipmentDisplayName } = load('src/services/equipment-display.ts');
  assert.equal(equipmentDisplayName('ESP32 1'), undefined);
  assert.equal(equipmentDisplayName('Lab monitor'), 'Lab monitor');
});

test('mobile registration accepts Monitoring and Both, preserving assignment, and rejects other device types', async () => {
  const source = ts.createSourceFile('devices.tsx', fs.readFileSync('src/app/devices.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleSaveNewDevice') declaration = node.getText(source); ts.forEachChild(node, visit); };
  visit(source); assert.ok(declaration);
  for (const deviceMode of ['monitoring', 'both', 'controller', '', 'unsupported']) {
    const calls = [], module = { exports: {} }, capture = { protocol: 'TCL112AC', raw_data: '100,200,300', raw_count: 3 };
    const context = { module, exports: module.exports, deviceMode, installationAttempt: { current: null }, requestId: () => '00000000-0000-4000-8000-000000000001', remoteSniffRequest: { current: { listening: false } }, friendlyName: 'Lab device', selectedBrand: 'TCL', customBrandInput: '', selectedWifiSsid: '', wifiPassword: '', userType: 'admin', userId: 'u1', userEmail: 'fixture@example.test', selectedRoomId: 'r1', selectedAirconType: 'Split', assignmentId: 'ac1', customAirconName: '', detectedRemoteInfo: { protocol: 'TCL112AC', capture }, availableAircons: [{ id: 'ac1', protocolName: 'TCL112AC' }], targetBleDevice: { bleId: 'ble1', deviceId: row.device_id }, triggerHaptic() {}, setSavingDevice() {}, setWifiPassword() {}, setNewlyCreatedDevice() {}, loadDevices: async () => {}, setAddStep() {}, Alert: { alert(...args) { throw Error(args.join(' ')); } }, DeviceService: { registerController: async (...args) => { calls.push(args); return { id: 'n1' }; } }, UserDeviceStorage: { recordUserNode: async () => {} } };
    vm.runInNewContext(ts.transpileModule('const ' + declaration + ';exports.save=handleSaveNewDevice;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    if (deviceMode !== 'monitoring' && deviceMode !== 'both') {
      await assert.rejects(module.exports.save(), /Choose Monitoring Only or Monitoring and Controlling/);
      assert.equal(calls.length, 0, 'An unsupported type must not reach registration');
      continue;
    }
    await module.exports.save();
    assert.equal(calls.length, 1);
    const setup = calls[0][2];
    assert.equal(setup.device_mode, deviceMode); assert.equal(setup.aircon_id, 'ac1');
    assert.equal(calls[0][1], row.device_id);
    assert.deepEqual(JSON.parse(JSON.stringify(setup.sensor_config)), { temperature: true, rotation_rpm: true });
    assert.doesNotMatch(JSON.stringify(setup), /pressure|mpx5010/i);
    assert.equal(calls[0][4]?.raw_data, deviceMode === 'monitoring' ? undefined : capture.raw_data);
  }
});

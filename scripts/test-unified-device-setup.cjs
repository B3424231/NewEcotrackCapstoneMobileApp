const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.ECOTRACK_MOBILE_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const text = fs.readFileSync(path.join(root, 'src/app/devices.tsx'), 'utf8');
const source = ts.createSourceFile('devices.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) { let result; function visit(node) { if (!result && predicate(node)) result = node; if (!result) ts.forEachChild(node, visit); } visit(source); assert.ok(result); return result; }
const mode = find(node => ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.name?.getText(source) === 'deviceMode');
const save = find(node => ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleSaveNewDevice');
const select = find(node => ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleSelectBleDevice');
function run(code, context) { const exports = {}; vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, ...context }); return exports; }
const initial = run('exports.mode = ' + mode.initializer.getText(source) + '[0];', { useState: value => [value, () => {}] }).mode;

test('new devices require no mode selection', () => {
  assert.equal(initial, 'both');
  assert.doesNotMatch(text, /<AcDeviceTypePicker\b|Choose the device type|Choose Monitoring Only/);
});

test('registration submits combined temperature and rotation capabilities without choosing a mode', async () => {
  let request, phase;
  const alerts = [];
  const context = {
    deviceMode: initial, remoteSniffRequest: { current: { listening: false } }, friendlyName: 'Fixture device',
    selectedBrand: 'TCL', customBrandInput: '', selectedWifiSsid: 'fixture', userType: 'admin',
    userId: 'fixture-admin', userEmail: 'fixture@example.invalid', availableAircons: [], assignmentId: null,
    selectedRoomId: 'fixture-room', customAirconName: 'Fixture AC', selectedAirconType: 'Window Type (Inverter)',
    detectedRemoteInfo: { protocol: 'TCL112AC', capture: { fixture: true } }, wifiPassword: 'fixture-only',
    targetBleDevice: { bleId: 'fixture-ble', deviceId: 'fixture-device' }, installationAttempt: { current: null },
    requestId: () => 'fixture-attempt', triggerHaptic() {}, setSavingDevice() {}, setWifiPassword() {}, setNewlyCreatedDevice() {},
    loadDevices: async () => {}, setAddStep: value => { phase = value; },
    UserDeviceStorage: { recordUserNode: async () => {} }, Alert: { alert: (...args) => alerts.push(args) },
    DeviceService: { registerController: async (...args) => { request = args; return { id: 'fixture-result' }; } },
  };
  for (const configured of [initial, 'controller', 'monitoring']) {
    context.deviceMode = configured; request = undefined; phase = undefined; alerts.length = 0;
    const handler = run('const ' + save.getText(source) + '; exports.save = handleSaveNewDevice;', context).save;
    await handler();
    assert.deepEqual(alerts, []);
    assert.ok(request, 'registration must reach the existing service without choosing a mode');
    assert.equal(request[2].device_mode, configured);
    assert.deepEqual(JSON.parse(JSON.stringify(request[2].sensor_config)), configured === 'controller' ? null : { temperature: true, rotation_rpm: true });
    assert.equal(request[2].protocol_name, configured === 'monitoring' ? undefined : 'TCL112AC');
    assert.equal(phase, 'success');
  }
});

test('reconnecting devices preserve every valid stored capability', async () => {
  for (const stored of ['monitoring', 'controller', 'both', undefined]) {
    let restored, failure;
    const context = {
      resetRemoteDetection() {}, triggerHaptic() {}, setTargetBleDevice() {}, setAddStep() {}, setConnectError: value => { failure = value; },
      BleDeviceService: { resolveBleIdentifier: async () => 'fixture-ble', connectBle: async () => true,
        readControllerInfo: async () => ({ cloud_protocol: 1, device_id: 'esp32s3-001122334455', wifi_status: 'connected', ip_address: '127.0.0.1', wifi_ssid: 'fixture' }) },
      CloudHardware: { registrationStatus: async () => ({ node: { device_mode: stored } }) },
      AcControllerService: { getAllAircons: async () => [] }, setAvailableAircons() {}, setRegistrationNodeId() {},
      setDeviceMode: value => { restored = value; }, setAssignmentId() {}, setCustomAirconName() {}, setFriendlyName() {},
      functionalDeviceText: String, setSelectedRoomId() {}, registrationRoomId: null, setSelectedBrand() {}, setSelectedAirconType() {},
      setRegistrationNeedsPassword() {}, setAssignedIp() {}, setSelectedWifiSsid() {},
    };
    await run('const ' + select.getText(source) + ';exports.select = handleSelectBleDevice;', context).select({ id: 'fixture-ble' });
    assert.equal(failure, null);
    assert.equal(restored, stored || 'both');
  }
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

function phone({ os = 'android', version = 36, state = 'PoweredOn', permission = true,
  intent = async () => ({ resultCode: 0 }), wifi = { type: 'cellular', isConnected: true, details: {} }, browser } = {}) {
  const calls = [], loaded = new Map(), listeners = new Set();
  let radio = state;
  const native = { state: async () => radio,
    onStateChange(fn, current) { listeners.add(fn); if (current) fn(radio); return { remove: () => listeners.delete(fn) }; },
    startDeviceScan(_filters, _opts, fn) { calls.push('scan'); fn(null, { id: 'AA:BB:CC:DD:EE:FF', name: 'EcoTrack-controller' }); },
    stopDeviceScan() { calls.push('stop'); },
  };
  const setRadio = value => { radio = value; for (const fn of [...listeners]) fn(value); };
  function load(file) {
    file = path.resolve(file);
    if (loaded.has(file)) return loaded.get(file).exports;
    const module = { exports: {} }; loaded.set(file, module);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText, {
      module, exports: module.exports, Date, Error, console, btoa, atob, Uint8Array, DataView,
      ...(browser || {}), setTimeout: fn => setTimeout(fn, 8), clearTimeout,
      require(spec) {
        if (spec === 'react-native') return { Platform: { OS: os, Version: version }, PermissionsAndroid: {
          PERMISSIONS: { BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect', ACCESS_FINE_LOCATION: 'fine', ACCESS_COARSE_LOCATION: 'coarse' },
          RESULTS: { GRANTED: 'granted' }, requestMultiple: async () => {
            calls.push('permissions'); return Object.fromEntries(['scan', 'connect', 'fine', 'coarse'].map(key => [key, permission ? 'granted' : 'denied']));
          },
        } };
        if (spec === 'react-native-ble-plx') return { BleManager: function () { return native; } };
        if (spec === 'expo-intent-launcher') return { startActivityAsync: async action => { calls.push(action); return intent(action, setRadio); } };
        if (spec === 'expo-location') return { hasServicesEnabledAsync: async () => true, requestForegroundPermissionsAsync: async () => ({ granted: true, android: { accuracy: 'fine' } }) };
        if (spec === 'expo-constants') return { default: { appOwnership: null } };
        if (spec === '@react-native-community/netinfo') return { default: { configure() {}, refresh: async () => { calls.push('wifi-refresh'); return typeof wifi === 'function' ? wifi() : wifi; } } };
        if (spec === '@react-native-async-storage/async-storage') return { getItem: async () => null };
        if (spec === './supabase') return { supabase: { from: () => { calls.push('database'); return { select: () => ({ is: async () => ({ data: [] }), not: () => ({ limit: async () => ({ data: [] }) }) }) }; } } };
        if (spec.startsWith('.')) { const target = path.resolve(path.dirname(file), spec); return load(target + (fs.existsSync(target + '.ts') ? '.ts' : '.js')); }
        throw Error('Unexpected dependency ' + spec);
      },
    }, { filename: file });
    return module.exports;
  }
  return { calls, listeners, setRadio, native, load, service: load('src/services/device-service.ts').BleDeviceService };
}
const bluetoothAction = 'android.bluetooth.adapter.action.REQUEST_ENABLE';
const wifiPanel = 'android.settings.panel.action.WIFI';

test('enabled Bluetooth scans without an enable prompt', async () => {
  const h = phone(); assert.equal((await h.service.scanNearbyDevices()).length, 1);
  assert.ok(h.calls.includes('permissions')); assert.ok(!h.calls.includes(bluetoothAction));
});
test('Android Bluetooth prompt waits for PoweredOn before starting the physical scan', async () => {
  const h = phone({ state: 'PoweredOff', intent: async (_action, change) => {
    setTimeout(() => change('PoweredOn'), 1); return { resultCode: -1 };
  } });
  const pending = h.service.scanNearbyDevices();
  assert.ok(!h.calls.includes('scan'));
  assert.equal((await pending).length, 1);
  assert.ok(h.calls.indexOf('permissions') < h.calls.indexOf(bluetoothAction));
  assert.ok(h.calls.indexOf(bluetoothAction) < h.calls.indexOf('scan'));
  assert.equal(h.listeners.size, 0);
});
test('cancel, denied permissions, unavailable radio and accepted-but-still-off never scan or query fallback nodes', async () => {
  for (const options of [{ state: 'PoweredOff' }, { permission: false }, { state: 'Unsupported' },
    { state: 'Unauthorized' }, { state: 'PoweredOff', intent: async () => ({ resultCode: -1 }) }]) {
    const h = phone(options); await assert.rejects(h.service.scanNearbyDevices());
    assert.ok(!h.calls.includes('scan')); assert.ok(!h.calls.includes('database')); assert.equal(h.listeners.size, 0);
  }
});
test('unknown Bluetooth initialization resolves from the listener and cleans it up', async () => {
  const h = phone({ state: 'Unknown' });
  const pending = h.service.scanNearbyDevices(); setTimeout(() => h.setRadio('PoweredOn'), 1);
  assert.equal((await pending).length, 1); assert.equal(h.listeners.size, 0);
});
test('automatic discovery and iOS never launch Android Bluetooth controls', async () => {
  for (const options of [{ state: 'PoweredOff' }, { os: 'ios', state: 'PoweredOff' }]) {
    const h = phone(options); await assert.rejects(h.service.scanNearbyDevices(false), /disabled/);
    assert.ok(!h.calls.includes(bluetoothAction));
  }
});
test('Wi-Fi Auto Search resumes with the actual connected SSID after the system panel closes', async () => {
  let connected = false;
  const h = phone({ wifi: () => connected ? { type: 'wifi', isConnected: true, details: { ssid: 'Campus 2.4', frequency: 2412 } }
    : { type: 'none', isConnected: false }, intent: async () => { connected = true; return { resultCode: 0 }; } });
  const result = await h.service.getConnectedPhoneWifi(true);
  assert.equal(result.ssid, 'Campus 2.4'); assert.equal(result.isWifi, true);
  assert.equal(h.calls.filter(call => call === wifiPanel).length, 1);
  assert.equal((await h.service.scanWifiNetworks(result))[0].frequency, '2.4 GHz');
});
test('Wi-Fi cancellation never invents a connection or SSID', async () => {
  const h = phone(); const result = await h.service.getConnectedPhoneWifi(true);
  assert.equal(result.ssid, null); assert.equal(result.isWifi, false);
  assert.equal(h.calls.filter(call => call === wifiPanel).length, 1);
});
test('automatic Wi-Fi lookup, an existing Wi-Fi connection, web and iOS do not open Android panels', async () => {
  for (const [options, explicit] of [[{}, false], [{ wifi: { type: 'wifi', isConnected: true, details: { ssid: 'Campus' } } }, true], [{ os: 'ios' }, true], [{ os: 'web' }, true]]) {
    const h = phone(options); await h.service.getConnectedPhoneWifi(explicit);
    assert.ok(!h.calls.some(call => typeof call === 'string' && call.startsWith('android.settings')));
  }
});
test('older Android and vendors without a Wi-Fi panel use the Wi-Fi settings page', async () => {
  for (const options of [{ version: 28 }, { intent: async action => { if (action === wifiPanel) throw Error('Activity not found'); return { resultCode: 0 }; } }]) {
    const h = phone(options); await h.service.getConnectedPhoneWifi(true);
    assert.ok(h.calls.includes('android.settings.WIFI_SETTINGS'));
  }
});
test('reconfiguration requests Bluetooth even when a saved native identifier skips discovery', async () => {
  const h = phone({ state: 'PoweredOff', intent: async (_action, change) => { change('PoweredOn'); return { resultCode: -1 }; } });
  h.service.resolveBleIdentifier = async () => 'AA:BB:CC:DD:EE:FF';
  h.service.connectBle = async () => true;
  h.service.readControllerInfo = async () => ({ device_id: 'esp32s3-correct' });
  assert.equal(await h.service.connectForWifiReconfigure({ deviceId: 'esp32s3-correct' }), 'AA:BB:CC:DD:EE:FF');
  assert.ok(h.calls.includes(bluetoothAction));
});
test('browser registration opens its chooser directly on a tap and reuses that chosen device', async () => {
  let chosen = 0;
  const h = phone({ os: 'web', browser: { isSecureContext: true, navigator: { bluetooth: { requestDevice: async () => {
    chosen++; return { id: 'browser-id', name: 'EcoTrack Nearby', gatt: { connected: false } };
  } } } } });
  assert.equal((await h.service.scanNearbyDevices(false)).length, 0); assert.equal(chosen, 0);
  const pending = h.service.scanNearbyDevices(true); assert.equal(chosen, 1);
  const [device] = await pending;
  assert.equal(device.name, 'EcoTrack Nearby'); assert.equal(device.bleId, 'browser-id');
  assert.equal(await h.service.resolveBleIdentifier(device), 'browser-id'); assert.equal(chosen, 1);
  assert.ok(!h.calls.includes('database'));
});

test('closing either Wi-Fi flow ignores the returning system panel and duplicate searches do not open it twice', async () => {
  const source = ts.createSourceFile('devices.tsx', fs.readFileSync('src/app/devices.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const name of ['handleScanWifiNetworks', 'handleScanReconfigWifi']) {
    let declaration;
    function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) declaration = node.getText(source); ts.forEachChild(node, visit); }
    visit(source); assert.ok(declaration);
    const ref = { current: { id: 0, pending: false } }, events = [], module = { exports: {} };
    let returned, prompts = 0;
    const context = { module, exports: module.exports, wifiSearch: ref, reconfigWifiSearch: ref, console,
      BleDeviceService: { getConnectedPhoneWifi: prompt => { assert.equal(prompt, true); prompts++; return new Promise(resolve => { returned = resolve; }); },
        scanWifiNetworks: async () => { events.push('networks'); return []; } }, alertPhoneWifiUnavailable: () => events.push('alert') };
    for (const setter of new Set(declaration.match(/\bset[A-Z]\w+/g))) context[setter] = value => events.push([setter, value]);
    vm.runInNewContext(ts.transpileModule('const ' + declaration + ';exports.run=' + name, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
    const pending = module.exports.run(true, true);
    await module.exports.run(true, true); assert.equal(prompts, 1);
    ref.current = { id: ref.current.id + 1, pending: false }; events.length = 0;
    returned({ isWifi: true, ssid: 'Late network' }); await pending;
    assert.deepEqual(events, []);
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

// In-memory PostgREST/RPC fixtures only; no database, controller, or network access.
function harness(respond) {
  const calls = [], modules = new Map();
  const client = {
    from(table) {
      const call = { table, operations: [] }; calls.push(call);
      const query = new Proxy({}, { get(_target, name) {
        if (name === 'then') return (resolve, reject) => Promise.resolve().then(() => respond(call)).then(resolve, reject);
        return (...args) => { call.operations.push([name, ...args]); return query; };
      } });
      return query;
    },
    rpc(name, args) {
      const call = { rpc: name, args }; calls.push(call);
      return Promise.resolve().then(() => respond(call));
    },
  };
  function load(filename) {
    filename = path.resolve(filename);
    if (!fs.existsSync(filename)) filename += fs.existsSync(filename + '.ts') ? '.ts' : '.js';
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, allowJs: true },
    }).outputText;
    function requireFixture(spec) {
      if (spec === './supabase') return { supabase: client };
      if (spec === 'react-native') return { Platform: { OS: 'web' }, PermissionsAndroid: {} };
      if (spec === '@react-native-async-storage/async-storage') return { getItem: async () => null, setItem: async () => {} };
      if (spec.startsWith('.')) return load(path.resolve(path.dirname(filename), spec));
      throw Error('Unexpected dependency: ' + spec);
    }
    vm.runInNewContext(code, {
      module, exports: module.exports, require: requireFixture, Date, Error, AbortController,
      setTimeout, clearTimeout, setInterval, clearInterval, crypto: { randomUUID }, console,
    }, { filename });
    return module.exports;
  }
  return { calls, load };
}
const fresh = () => ({ node_id: 'controller-1', device_id: 'esp32s3-9cd20604a7ac', last_seen: new Date().toISOString(), rssi: -71 });
function pingFixture(overrides = {}) {
  let commandId;
  return harness(async call => {
    if (overrides.respond) {
      const result = await overrides.respond(call, commandId);
      if (result !== undefined) return result;
    }
    if (call.table === 'ecotrack_device_state') return { data: fresh(), error: null };
    if (call.rpc) {
      commandId = call.args.p_request_id;
      return { data: { id: commandId, node_id: 'controller-1', kind: 'ping' }, error: null };
    }
    return { data: { node_id: 'controller-1', kind: 'ping', status: 'completed',
      result: { success: true, command_id: commandId, rssi: -63 } }, error: null };
  });
}

test('a matching ping acknowledgement provides measured latency and firmware RSSI without another heartbeat fetch', async () => {
  const h = pingFixture({ respond: async call => {
    if (call.table === 'ecotrack_device_commands') await new Promise(resolve => setTimeout(resolve, 20));
  } });
  const result = await h.load('src/services/device-service.ts').BleDeviceService.testDeviceConnection('controller-1');
  assert.equal(result.online, true);
  assert.equal(result.connectionState, 'online');
  assert.ok(Number.isFinite(result.pingMs) && result.pingMs >= 15);
  assert.match(result.wifiSignal, /-63 dBm/);
  assert.equal(h.calls.filter(call => call.table === 'ecotrack_device_state').length, 1);
  const request = h.calls.find(call => call.rpc);
  assert.equal(request.rpc, 'ecotrack_ping_controller');
  assert.deepEqual(Object.keys(request.args).sort(), ['p_node_id', 'p_request_id']);
});

test('an acknowledged ping succeeds even when an unnecessary follow-up heartbeat read would fail', async () => {
  let heartbeatReads = 0;
  const h = pingFixture({ respond: call => {
    if (call.table === 'ecotrack_device_state' && ++heartbeatReads > 1) throw Error('Follow-up read unavailable');
  } });
  const result = await h.load('src/services/device-service.ts').BleDeviceService.testDeviceConnection('controller-1');
  assert.equal(result.online, true);
  assert.equal(heartbeatReads, 1);
  assert.ok(result.pingMs >= 0);
});

test('fresh-heartbeat request failure stays separate from heartbeat status and never invents a zero latency', async () => {
  const h = pingFixture({ respond: call => call.rpc ? { data: null, error: { code: '42501', message: 'Denied' } } : undefined });
  const result = await h.load('src/services/device-service.ts').BleDeviceService.testDeviceConnection('controller-1');
  assert.equal(result.online, false);
  assert.equal(result.connectionState, 'online');
  assert.equal(result.pingMs, null);
  assert.match(result.error, /active assigned room/i);
  assert.doesNotMatch(result.error, /administrator|admin account/i);
});

test('offline and sleeping controllers are identified before a command can be queued', async () => {
  for (const [connectionState, fields] of [
    ['offline', { last_seen: new Date(Date.now() - 60000).toISOString() }],
    ['sleeping', { sleeping_until: new Date(Date.now() + 60000).toISOString() }],
  ]) {
    const h = pingFixture({ respond: call => call.table === 'ecotrack_device_state'
      ? { data: { ...fresh(), ...fields }, error: null } : undefined });
    const result = await h.load('src/services/device-service.ts').BleDeviceService.testDeviceConnection('controller-1');
    assert.equal(result.connectionState, connectionState);
    assert.equal(result.online, false);
    assert.equal(result.pingMs, null);
    assert.equal(h.calls.some(call => call.rpc), false);
  }
});

test('an unavailable heartbeat read has a deadline and cannot be represented as an offline controller', async () => {
  const h = harness(() => new Promise(() => {}));
  const api = h.load('src/services/cloud-hardware.ts');
  await assert.rejects(api.CloudHardware.request('controller-1', 'ping', {}, 30), error => {
    assert.ok(error instanceof api.CloudHardwareRequestError);
    assert.equal(error.connectionState, 'unknown');
    assert.match(error.message, /timed out/i);
    return true;
  });
  const signal = h.calls[0].operations.find(([name]) => name === 'abortSignal')[1];
  assert.equal(signal.aborted, true);
  assert.equal(h.calls.some(call => call.rpc), false);
});

test('a stalled queue RPC finishes at the request deadline and warns that its command may still be queued', async () => {
  const h = pingFixture({ respond: call => call.rpc ? new Promise(() => {}) : undefined });
  const api = h.load('src/services/cloud-hardware.ts');
  await assert.rejects(api.CloudHardware.request('controller-1', 'ping', {}, 30), error => {
    assert.equal(error.connectionState, 'online');
    assert.match(error.message, /may be queued/);
    return true;
  });
  assert.equal(h.calls.filter(call => call.rpc).length, 1);
});

test('a stalled acknowledgement query is aborted at the shared request deadline', async () => {
  const h = pingFixture({ respond: call => call.table === 'ecotrack_device_commands' ? new Promise(() => {}) : undefined });
  const api = h.load('src/services/cloud-hardware.ts');
  await assert.rejects(api.CloudHardware.request('controller-1', 'ping', {}, 30), error => {
    assert.equal(error.connectionState, 'online');
    assert.match(error.message, /may be queued/);
    return true;
  });
  const call = h.calls.find(call => call.table === 'ecotrack_device_commands');
  assert.equal(call.operations.find(([name]) => name === 'abortSignal')[1].aborted, true);
});

test('a queued command or acknowledgement for another request can never become a successful measured ping', async () => {
  for (const status of ['queued', 'completed']) {
    const h = pingFixture({ respond: call => call.table === 'ecotrack_device_commands' ? {
      data: { node_id: 'controller-1', kind: 'ping', status, result: { success: true, command_id: 'different-request' } }, error: null,
    } : undefined });
    const api = h.load('src/services/cloud-hardware.ts');
    await assert.rejects(api.CloudHardware.request('controller-1', 'ping', {}, 30), error => {
      assert.equal(error.connectionState, 'online');
      assert.match(error.message, status === 'queued' ? /may be queued/ : /acknowledgement/i);
      return true;
    });
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const stage = process.env.ECOTRACK_DESKTOP_PROFILE_STAGE;
const desktop = path.resolve(__dirname, '../../EcoTrackDesktopDashboardNew-main-control');
const core = fs.readFileSync(stage ? path.join(stage, 'desktop-aircon-system-after.js') : path.join(desktop, 'public/js/aircon-system.js'), 'utf8');
const html = fs.readFileSync(stage ? path.join(stage, 'desktop-nodes-after.html') : path.join(desktop, 'public/nodes.html'), 'utf8');
const clean = value => JSON.parse(JSON.stringify(value));
function harness() {
  const storage = new Map(), calls = [];
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)) };
  const window = { localStorage };
  let frame = { success: true, protocol: 'daikin', raw_type: 'DAIKIN216', hex: '0x12' }, identity = 'node-1', failure;
  vm.runInNewContext(core, { window, localStorage, console: { log() {}, warn() {}, error() {} }, Date, AbortController, setTimeout, clearTimeout,
    fetch: async url => { calls.push(url); if (failure) throw failure; return { ok: true, json: async () => url.endsWith('/ping') ? { status: 'online', node_id: identity } : frame }; } });
  const system = window.EcoTrackAirconSystem;
  storage.set('ecoTrack_nodes', JSON.stringify([{ node_id: 'node-1', db_id: 'db-1', name: 'Controller', brand: 'Midea', protocol_name: 'MIDEA', aircon_type: 'Window Type (Inverter)', status: 'Offline', ip_address: '192.168.1.20' }]));
  storage.set('ecoTrack_aircons', JSON.stringify([{ device_id: 'AC-1', node_id: 'node-1', brand: 'Midea', protocol_name: 'MIDEA', state: { power: false } }, { device_id: 'AC-2', node_id: 'node-2', brand: 'Gree' }]));
  return { system, storage, calls, window, setFrame: value => { frame = value; }, setIdentity: value => { identity = value; }, setFailure: value => { failure = value; } };
}
test('desktop detects actual AC decoder families without a raw_data field and preserves exact IR variants', async () => {
  for (const [raw, protocol, brand] of [['DAIKIN216', 'daikin', 'Daikin'], ['MIDEA24', 'midea_ir', 'Midea'], ['GREE', 'gree', 'Gree'], ['CARRIER_AC64', 'carrier', 'Carrier'], ['PANASONIC_AC', 'panasonic', 'Panasonic'], ['SAMSUNG_AC', 'samsung', 'Samsung'], ['MITSUBISHI_HEAVY_152', 'mitsubishi', 'Mitsubishi']]) {
    const h = harness(); h.setFrame({ success: true, protocol, raw_type: raw, hex: '0x1234', brand: 'Incorrect advertised brand' });
    const result = await h.system.ProtocolAdapter.detectRemoteBrand('node-1', '192.168.1.20');
    assert.deepEqual(clean(result), { success: true, brand, protocol: raw });
    assert.equal(h.calls.length, 2); assert.ok(h.calls[0].endsWith('/ping')); assert.ok(h.calls[1].endsWith('/sniff-protocol'));
  }
  const h = harness(); h.setFrame({ success: true, protocol: 'DAIKIN216', raw_type: 'DAIKIN216', hex: '12' });
  assert.equal((await h.system.ProtocolAdapter.detectRemoteBrand('node-1')).protocol, 'DAIKIN216');
  assert.equal((await h.system.ProtocolAdapter.detectRemoteBrand('node-1', 'esp32.local:8080')).brand, 'Daikin');
});
test('desktop rejects guessed defaults, unknown/non-AC decoders, wrong controller, invalid IP and network failure', async () => {
  for (const patch of [{ raw_type: '' }, { raw_type: 'RAW' }, { raw_type: 'UNKNOWN' }, { raw_type: 'NEC' }, { raw_type: 'DAIKIN999' }, { hex: '' }, { protocol: 'midea_ir' }, { success: false }]) {
    const h = harness(); h.setFrame({ success: true, protocol: 'daikin', raw_type: 'DAIKIN216', hex: '12', ...patch });
    assert.equal((await h.system.ProtocolAdapter.detectRemoteBrand('node-1')).success, false);
  }
  const wrong = harness(); wrong.setIdentity('node-2');
  assert.equal((await wrong.system.ProtocolAdapter.detectRemoteBrand('node-1')).success, false); assert.equal(wrong.calls.length, 1);
  for (const ip of ['', '0.0.0.0', '8.8.8.8', 'http://192.168.1.20', '192.168.1.20/ir/intent', '192.168.1.20:99999']) {
    const h = harness(); assert.equal((await h.system.ProtocolAdapter.detectRemoteBrand('node-1', ip)).success, false); assert.equal(h.calls.length, 0);
  }
  for (const failure of [Error('LAN failed'), Object.assign(Error('Timeout'), { name: 'AbortError' })]) {
    const h = harness(); h.setFailure(failure); assert.equal((await h.system.ProtocolAdapter.detectRemoteBrand('node-1')).success, false);
  }
});
const profile = { brand: 'Daikin', aircon_type: 'Floor Mounted AC', protocol_name: 'DAIKIN216' };
test('desktop saves brand/type/exact protocol with the existing atomic RPC and updates only the matching cached profiles', async () => {
  const h = harness(), calls = [];
  h.window.supabaseClient = { rpc: async (name, args) => {
    calls.push([name, clean(args)]);
    const fresh = JSON.parse(h.storage.get('ecoTrack_nodes')); fresh[0].name = 'Refreshed Name'; fresh[0].room_id = 'room-2'; h.storage.set('ecoTrack_nodes', JSON.stringify(fresh));
    return { data: { node: { id: 'db-1', ...args.p_payload } }, error: null };
  } };
  await h.system.NodeService.saveRemoteProfile('node-1', profile);
  assert.deepEqual(calls, [['ecotrack_device_mutation', { p_operation: 'update_node', p_id: 'db-1', p_payload: profile }]]);
  const nodes = JSON.parse(h.storage.get('ecoTrack_nodes')), aircons = JSON.parse(h.storage.get('ecoTrack_aircons'));
  assert.equal(nodes[0].brand, 'Daikin'); assert.equal(nodes[0].status, 'Offline'); assert.equal(nodes[0].protocol_name, 'DAIKIN216');
  assert.equal(nodes[0].name, 'Refreshed Name'); assert.equal(nodes[0].room_id, 'room-2');
  assert.equal(aircons[0].protocol_name, 'DAIKIN216'); assert.deepEqual(aircons[0].state, { power: false }); assert.equal(aircons[1].brand, 'Gree');
});
test('profile lookup resolves a legacy registration ID and denied/missing/mismatched/unconfirmed writes retain the previous caches', async () => {
  const h = harness(); const node = JSON.parse(h.storage.get('ecoTrack_nodes'))[0]; delete node.db_id; h.storage.set('ecoTrack_nodes', JSON.stringify([node]));
  const lookupCalls = [];
  h.window.supabaseClient = { from: table => ({ select: columns => ({ eq: (field, value) => ({ maybeSingle: async () => { lookupCalls.push([table, columns, field, value]); return { data: { id: 'db-1' } }; } }) }) }), rpc: async () => ({ data: { node: { id: 'db-1', ...profile } } }) };
  await h.system.NodeService.saveRemoteProfile('node-1', profile); assert.deepEqual(lookupCalls, [['nodes', 'id', 'name', 'node-1']]);
  for (const response of [{ error: { message: 'Denied' } }, { data: null }, { data: { node: { id: 'wrong', ...profile } } }, { data: { node: { id: 'db-1' } } }]) {
    const denied = harness(), before = [...denied.storage]; denied.window.supabaseClient = { rpc: async () => response };
    await assert.rejects(denied.system.NodeService.saveRemoteProfile('node-1', profile)); assert.deepEqual([...denied.storage], before);
  }
});
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).find(code => code.includes('function listenForRemote'));
const ast = ts.createSourceFile('nodes.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function declaration(name) {
  let found; const visit = node => { if (node.name?.getText(ast) === name && (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node))) found = node; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(found, name); return (ts.isVariableDeclaration(found) ? 'const ' : '') + found.getText(ast) + ';';
}
function uiHarness(detect) {
  const elements = new Map();
  const validIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const element = id => { assert.ok(validIds.has(id), `Missing HTML control ${id}`); if (!elements.has(id)) elements.set(id, { value: '', disabled: false, textContent: '', listeners: {}, classList: { contains: () => false }, addEventListener(type, handler) { this.listeners[type] = handler; } }); return elements.get(id); };
  for (const prefix of ['nodeForm', 'editNode']) { element(prefix === 'nodeForm' ? 'nodeFormId' : 'editNodeIdHidden').value = 'node-1'; element(prefix + 'Ip').value = '192.168.1.20'; element(prefix + 'Brand').value = 'Midea'; element(prefix + 'AirconType').value = 'Floor Mounted AC'; }
  const code = ['remoteCapture', 'remoteFields', 'setRemoteBusy', 'resetRemoteDetection', 'listenForRemote'].map(declaration).join('\n');
  const context = { document: { getElementById: element }, ProtocolAdapter: { detectRemoteBrand: detect }, renderBrandChips() {}, updateConfigSummary() {} };
  vm.createContext(context); vm.runInContext(code + ';this.listen = listenForRemote; this.reset = resetRemoteDetection; this.state = remoteCapture;', context);
  let binding; const visit = node => { if (ts.isForOfStatement(node) && node.expression.getText(ast) === "['register', 'edit']") binding = node; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(binding); vm.runInContext(binding.getText(ast), context);
  return { element, context };
}
test('registration and edit remote controls show real success/failure and keep manual aircon-type choices', async () => {
  for (const kind of ['register', 'edit']) {
    const h = uiHarness(async () => ({ success: true, brand: 'Daikin', protocol: 'DAIKIN216' })); await h.context.listen(kind);
    const prefix = kind === 'register' ? 'nodeForm' : 'editNode';
    assert.equal(h.element(prefix + 'Brand').value, 'Daikin'); assert.equal(h.element(prefix + 'AirconType').value, 'Floor Mounted AC'); assert.equal(h.context.state[kind].protocol, 'DAIKIN216');
    assert.match(h.element(kind + 'RemoteStatus').textContent, /Detected: Daikin.*DAIKIN216/); assert.equal(h.element(kind + 'RemoteBtn').disabled, false);
    const failed = uiHarness(async () => ({ success: false, message: 'No signal captured. Choose brand manually.' })); await failed.context.listen(kind);
    assert.equal(failed.element(prefix + 'Brand').value, 'Midea'); assert.equal(failed.context.state[kind].protocol, null); assert.match(failed.element(kind + 'RemoteStatus').textContent, /No signal captured/);
  }
});
test('late detection cannot overwrite manual selection, a closed/reopened form, changed controller/IP, or send duplicate listens', async () => {
  for (const kind of ['register', 'edit']) for (const action of ['manual', 'close', 'node', 'ip']) {
    let finish, calls = 0; const h = uiHarness(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
    const first = h.context.listen(kind); await h.context.listen(kind); assert.equal(calls, 1);
    const prefix = kind === 'register' ? 'nodeForm' : 'editNode';
    if (action === 'manual') { h.element(prefix + 'Brand').value = 'Samsung'; h.element(prefix + 'Brand').listeners.input(); }
    else if (action === 'close') h.context.reset(kind);
    else if (action === 'node') h.element(kind === 'register' ? 'nodeFormId' : 'editNodeIdHidden').value = 'node-2';
    else h.element(prefix + 'Ip').value = '192.168.1.21';
    finish({ success: true, brand: 'Daikin', protocol: 'DAIKIN216' }); await first;
    assert.notEqual(h.element(prefix + 'Brand').value, 'Daikin'); assert.equal(h.context.state[kind].protocol, null); assert.equal(h.element(kind + 'RemoteBtn').disabled, false);
  }
});
test('Edit Device preserves an unchanged exact protocol, saves new brand/type before success, and stops after denied profile writes', async () => {
  for (const scenario of ['unchanged', 'detected', 'manual', 'denied']) {
    const h = uiHarness(async () => ({ success: true, brand: 'Daikin', protocol: 'DAIKIN216' })), calls = [], messages = [];
    const select = { value: 'r1', selectedIndex: 0, options: [{ text: 'Room 1' }] };
    const node = { node_id: 'node-1', db_id: 'db-1', brand: 'Midea', protocol_name: 'MIDEA24' };
    Object.assign(h.context, {
      saveEditBtn: h.element('saveEditNodeBtn'), editBldSelect: select, editFlrSelect: select, editRoomSelect: select,
      editCustomBldInput: {}, editCustomFlrInput: {}, editCustomRoomInput: {},
      NodeService: { getNode: () => node, saveRemoteProfile: async (_id, value) => { calls.push(['profile', clean(value)]); if (scenario === 'denied') throw Error('Denied'); }, editDevice: async (_id, value) => calls.push(['edit', clean(value)]) },
      AirconProfileManager: { getAll: () => [] }, CapabilityEngine: { resolveProtocolName: brand => brand === 'Samsung' ? 'samsung' : 'midea_ir' },
      closeEditNodeModal: () => calls.push(['close']), renderNodes: () => calls.push(['render']), window: { EcoToast: { show: (...args) => messages.push(args) } }, console: { error() {} },
    });
    h.element('editNodeName').value = 'Controller';
    if (scenario === 'detected') await h.context.listen('edit');
    if (scenario === 'manual') { h.element('editNodeBrand').value = 'Samsung'; h.element('editNodeBrand').listeners.input(); }
    vm.runInContext(declaration('handleSaveEditNode') + ';this.save = handleSaveEditNode;', h.context); await h.context.save();
    assert.equal(calls[0][0], 'profile'); assert.equal(calls[0][1].aircon_type, 'Floor Mounted AC');
    assert.equal(calls[0][1].protocol_name, scenario === 'detected' ? 'DAIKIN216' : scenario === 'manual' ? 'samsung' : 'MIDEA24');
    if (scenario === 'denied') { assert.equal(calls.length, 1); assert.equal(messages[0][1], 'error'); }
    else { assert.equal(calls[1][0], 'edit'); assert.equal(calls[2][0], 'close'); assert.equal(messages[0][1], 'success'); }
    assert.equal(h.element('saveEditNodeBtn').disabled, false);
  }
});

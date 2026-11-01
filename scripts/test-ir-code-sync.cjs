'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const mobile = process.env.ECOTRACK_MOBILE_ROOT || path.resolve(__dirname, '..');
const desktop = process.env.ECOTRACK_DESKTOP_ROOT || path.resolve(mobile, '..', 'EcoTrackDesktopDashboardNew-main-control');
const ts = require(path.join(mobile, 'node_modules/typescript'));
const copy = value => JSON.parse(JSON.stringify(value));
function sourcePath(file) {
  for (const [root, overlay] of [[mobile, process.env.ECOTRACK_MOBILE_OVERLAY], [desktop, process.env.ECOTRACK_DESKTOP_OVERLAY]]) {
    const relative = path.relative(root, file);
    if (overlay && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      const candidate = path.join(overlay, relative);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return file;
}
function read(file) { return fs.readFileSync(sourcePath(file), 'utf8'); }
const raw = '3500,1750,450,1300';
const capture = { protocol: 'DAIKIN216', raw_data: raw, raw_count: 4, sequence: 8, state: { power: false, temp: 23, mode: 'cool', fan: 'low' } };
const setup = { controller_name: 'Mobile controller', assignment_mode: 'existing', aircon_id: 'ac-1', room_id: 'r1', brand: 'Daikin', aircon_type: 'Split', protocol_name: 'DAIKIN216' };
function harness() {
  let now = Date.now(), sequence = 0;
  const calls = [], channels = [], loaded = new Map();
  const db = {
    aircons: [{ id: 'ac-1', asset_tag: 'AC / 01', name: 'Mobile AC', brand: 'Daikin', model: 'Split', room_id: 'r1', protocol_name: 'DAIKIN216', protocol: 'DAIKIN216', controller_node_id: 'n1', node_id: 'n1' }],
    nodes: [{ id: 'n1', name: 'Mobile controller', room_id: 'r1', protocol_name: 'DAIKIN216' }],
    rooms: [{ id: 'r1', name: 'Lab', floor_id: 'f1' }], floors: [{ id: 'f1', name: 'Ground', building_id: 'b1' }], buildings: [{ id: 'b1', name: 'East' }],
    ecotrack_device_state: [{ node_id: 'n1', device_id: 'esp32s3-001122334455', last_seen: new Date(now).toISOString(), capabilities: { ir_receiver: true, ir_transmitter: true } }],
    ecotrack_ir_codes: [], ecotrack_device_commands: [],
  };
  const state = { failRpc: null, mismatch: false, unavailable: false };
  function saveCode(args) {
    let row = db.ecotrack_ir_codes.find(row => row.aircon_id === args.p_aircon_id && row.command_type === args.p_command_type);
    const stored = { aircon_id: args.p_aircon_id, command_type: args.p_command_type, protocol: args.p_capture.protocol,
      raw_data: args.p_capture.raw_data, capture: copy(args.p_capture), source_platform: args.p_source, updated_at: new Date(now).toISOString() };
    delete stored.capture.raw_data;
    if (row) Object.assign(row, stored);
    else { row = { id: 'code-' + (++sequence), created_at: new Date(now).toISOString(), ...stored }; db.ecotrack_ir_codes.push(row); }
    return copy(row);
  }
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'fixture-user' } } } }), onAuthStateChange(fn) { client.authChanged = fn; } },
    from(table) {
      const filters = [];
      let after = null, limit = null, columns = '*';
      const query = {
        select(value) { columns = value; return query; }, order() { return query; }, limit(value) { limit = value; return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        or(value) { const match = [...value.matchAll(/(?:id|asset_tag)\.eq\."((?:\\.|[^"])*)"/g)][0];
          const exact = match?.[1].replace(/\\(.)/g, '$1'); filters.push(row => row.id === exact || row.asset_tag === exact); return query; },
        gt(key, value) { after = [key, value]; return query; }, abortSignal() { return query; },
        async maybeSingle() { const result = await execute(); return { ...result, data: result.data?.[0] || null }; },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        if (table === 'ecotrack_ir_codes' && state.unavailable) return { data: null, error: { code: '42P01', message: 'Table unavailable' } };
        const all = (db[table] || []).filter(row => filters.every(filter => filter(row)));
        let rows = all.filter(row => !after || row[after[0]] > after[1]);
        if (limit) rows = rows.slice(0, limit);
        rows = copy(rows);
        if (columns.includes('aircons(')) rows.forEach(row => { row.aircons = { asset_tag: db.aircons.find(ac => ac.id === row.aircon_id)?.asset_tag }; });
        return { data: rows, count: after ? rows.length : all.length, error: null };
      }
      return query;
    },
    async rpc(name, args) {
      calls.push({ name, args: copy(args) });
      if (state.failRpc === name) return { data: null, error: { code: '42501', message: 'Denied' } };
      let data;
      if (name === 'ecotrack_save_ir_code') data = saveCode(args);
      else if (name === 'ecotrack_delete_ir_code') {
        const row = db.ecotrack_ir_codes.find(row => row.aircon_id === args.p_aircon_id && row.command_type === args.p_command_type);
        db.ecotrack_ir_codes = db.ecotrack_ir_codes.filter(item => item !== row);
        data = { deleted: !!row, id: row?.id, aircon_id: args.p_aircon_id };
      } else if (name === 'ecotrack_validate_controller_assignment') data = { valid: true };
      else if (name === 'ecotrack_controller_registration_status') data = { requires_credentials: false, node: db.nodes[0] };
      else if (name.startsWith('ecotrack_finish_controller_registration')) {
        Object.assign(db.nodes[0], { name: args.p_setup.controller_name, protocol_name: args.p_setup.protocol_name });
        Object.assign(db.aircons[0], { protocol_name: args.p_setup.protocol_name, protocol: args.p_setup.protocol_name });
        data = { success: true, connected: true, node: copy(db.nodes[0]), aircon: copy(db.aircons[0]) };
        if (args.p_capture) data.ir_code = saveCode({ p_aircon_id: 'ac-1', p_command_type: 'REMOTE_CAPTURE', p_capture: args.p_capture, p_source: 'mobile' });
      } else throw Error('Unexpected RPC ' + name);
      if (state.mismatch && data?.raw_data) data.raw_data = '1,2,3';
      return { data, error: null };
    },
    channel(name) { const channel = { name, handlers: [], on(event, filter, callback) { channel.handlers.push({ event, filter, callback }); return channel; }, subscribe() { channels.push(channel); return channel; } }; return channel; },
    removeChannel() {},
  };
  const nativeDevice = { async readCharacteristicForService() {
    const frame = { ...capture, sequence: ++sequence };
    return { value: Buffer.from(JSON.stringify(frame)).toString('base64') };
  } };
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  function load(file) {
    file = path.resolve(file);
    if (!fs.existsSync(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.js';
    if (loaded.has(file)) return loaded.get(file).exports;
    const module = { exports: {} }; loaded.set(file, module);
    const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    function req(spec) {
      if (spec === './supabase') return { supabase: client, SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_fixture' };
      if (spec === 'react-native') return { Platform: { OS: 'android' }, PermissionsAndroid: {} };
      if (spec === '@react-native-async-storage/async-storage') return { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
      if (spec === 'react-native-ble-plx') return { BleManager: class { async devices() { return [nativeDevice]; } } };
      if (spec.startsWith('.')) return load(path.resolve(path.dirname(file), spec));
      throw Error('Unexpected dependency ' + spec);
    }
    vm.runInNewContext(js, { module, exports: module.exports, require: req, Date: FakeDate, console, AbortController,
      setTimeout(fn, ms) { if (ms >= 10000) return setTimeout(fn, ms); now += ms; fn(); return 1; }, clearTimeout, setInterval() { return 1; }, clearInterval() {},
      atob: value => Buffer.from(value, 'base64').toString('binary'), btoa: value => Buffer.from(value, 'binary').toString('base64'),
      fetch: async () => { throw Error('Network access prohibited'); } }, { filename: file });
    return module.exports;
  }
  function loadDesktop() {
    const original = read(path.join(desktop, 'scripts/test_page_connections.js'));
    let prefix = original.slice(0, original.indexOf('async function run(){'));
    const start = prefix.indexOf('const sb={'), end = prefix.indexOf('const quiet=', start);
    prefix = prefix.slice(0, start) + 'const sb=sharedClient;\n' + prefix.slice(end);
    prefix = prefix.replace('const db = {', 'const db = sharedDatabase || {');
    const safeFs = { ...fs, readFileSync(file, ...args) { return fs.readFileSync(sourcePath(file), ...args); } };
    const context = vm.createContext({ __dirname: path.join(desktop, 'scripts'), sharedClient: client, sharedDatabase: db,
      require: spec => spec === 'node:fs' ? safeFs : require(spec), console, performance, structuredClone, TextEncoder, TextDecoder, URLSearchParams });
    vm.runInContext(prefix + `
      globalThis.apps=pages.map(makePage); globalThis.studio=loadStudio;
    `, context);
    return context;
  }
  return { db, calls, channels, state, load, loadDesktop };
}
const service = h => h.load(path.join(mobile, 'src/services/ac-controller-service.ts')).AcControllerService;
const cloud = h => h.load(path.join(mobile, 'src/services/cloud-hardware.ts'));

test('Bluetooth remote detection retains real raw timings and the exact protocol', async () => {
  const h = harness(), ble = h.load(path.join(mobile, 'src/services/device-service.ts')).BleDeviceService;
  ble.readControllerInfo = async () => ({ device_id: 'esp32s3-001122334455', capabilities: { ble_ir_monitor: true } });
  const result = await ble.learnNearby('fixture-ble', 'esp32s3-001122334455');
  assert.equal(result.protocol, 'DAIKIN216'); assert.equal(result.capture.raw_data, raw); assert.equal(result.capture.raw_count, 4);
});
test('registration uses one atomic finalizer for the AC profile and captured code', async () => {
  const h = harness();
  const saved = await cloud(h).CloudHardware.register({ device_id: 'esp32s3-001122334455', cloud_protocol: 1, cloud_status: 'verified', node_id: 'n1' }, setup,
    { ssid: '', pass: '' }, () => { throw Error('Unexpected provisioning'); }, capture);
  const finish = h.calls.filter(call => call.name.includes('finish_controller'));
  assert.equal(finish.length, 1); assert.equal(finish[0].name, 'ecotrack_finish_controller_registration_with_ir');
  assert.equal(saved.ir_code.raw_data, raw); assert.equal(saved.ir_code.aircon_id, saved.aircon.id);
});
test('denied atomic registration cannot be reported as successful', async () => {
  const h = harness(); h.state.failRpc = 'ecotrack_finish_controller_registration_with_ir';
  await assert.rejects(cloud(h).CloudHardware.register({ device_id: 'esp32s3-001122334455', cloud_protocol: 1, cloud_status: 'verified', node_id: 'n1' }, setup,
    { ssid: '', pass: '' }, async () => {}, capture), /assigned room/);
  assert.equal(h.db.ecotrack_ir_codes.length, 0);
});
test('mobile saves, reloads, replaces and deletes named codes by stable AC identity', async () => {
  const h = harness(), app = service(h);
  const first = await app.saveIrCommand({ deviceId: 'AC / 01', commandType: 'POWER_OFF', protocol: 'DAIKIN216', rawData: raw, capture });
  assert.equal(first.deviceId, 'AC / 01'); assert.equal(first.sourcePlatform, 'mobile');
  const reloaded = await app.getCommandsForDevice('ac-1'); assert.equal(reloaded[0].rawData, raw);
  const replacement = await app.saveIrCommand({ airconId: 'ac-1', commandType: 'POWER_OFF', protocol: 'DAIKIN216', rawData: '4000,2000,500' });
  assert.equal(replacement.id, first.id); assert.equal((await app.getAllIrCommands()).length, 1);
  assert.equal(await app.deleteIrCommand('AC / 01', 'POWER_OFF'), true); assert.equal((await app.getCommandsForDevice('ac-1')).length, 0);
});
test('invalid captures, permission errors and mismatched receipts never become saved codes', async () => {
  const h = harness(), app = service(h);
  for (const invalid of ['', '0,100,100', '100,-1,100', '100,100', '1000001,1,1'])
    await assert.rejects(app.saveIrCommand({ airconId: 'ac-1', commandType: 'POWER_OFF', protocol: 'DAIKIN216', rawData: invalid }));
  assert.equal(h.calls.length, 0);
  h.state.failRpc = 'ecotrack_save_ir_code';
  await assert.rejects(app.saveIrCommand({ airconId: 'ac-1', commandType: 'POWER_OFF', protocol: 'DAIKIN216', rawData: raw }), /Denied/);
  assert.equal(h.db.ecotrack_ir_codes.length, 0);
  h.state.failRpc = null; h.state.mismatch = true;
  await assert.rejects(app.saveIrCommand({ airconId: 'ac-1', commandType: 'POWER_OFF', protocol: 'DAIKIN216', rawData: raw }), /not confirmed/);
});
test('mobile registration capture and later mobile codes appear in the actual desktop library', async () => {
  const h = harness();
  await cloud(h).CloudHardware.register({ device_id: 'esp32s3-001122334455', cloud_protocol: 1, cloud_status: 'verified', node_id: 'n1' }, setup,
    { ssid: '', pass: '' }, async () => {}, capture);
  const desktopUi = h.loadDesktop();
  for (const app of desktopUi.apps) await app.system.syncWithDatabase();
  for (const app of desktopUi.apps) assert.equal(app.system.ProtocolAdapter.getCommandsForDevice('AC / 01')[0].raw_data, raw);
  const studio = desktopUi.studio(desktopUi.apps[4], 'AC / 01');
  const saved = h.db.ecotrack_ir_codes[0];
  studio.get('savedCodeSelect').value = saved.id; await studio.get('savedCodeSelect').trigger('change');
  assert.equal(studio.get('learnedFrameRaw').value, raw); assert.equal(studio.get('learnedCommandName').value, 'REMOTE_CAPTURE');
  assert.match(studio.get('savedCodeStatus').textContent, /1 shared/);
  await service(h).saveIrCommand({ airconId: 'ac-1', commandType: 'POWER_OFF', protocol: 'DAIKIN216', rawData: '4000,2000,500' });
  for (const app of desktopUi.apps) await app.system.syncWithDatabase();
  assert.match(studio.get('savedCodeStatus').textContent, /2 shared/);
});
test('desktop saves the selected capture to shared storage and mobile can read it', async () => {
  const h = harness(), desktopUi = h.loadDesktop();
  for (const app of desktopUi.apps) await app.system.syncWithDatabase();
  const studio = desktopUi.studio(desktopUi.apps[4], 'AC / 01');
  const adapter = desktopUi.apps[4].system.ProtocolAdapter;
  adapter.getLatestLearned = async () => ({ ...capture, success: true });
  await studio.get('latestLearnedFrameBtn').trigger('click');
  studio.get('learnedCommandName').value = 'POWER_OFF';
  await studio.get('saveCapturedCodeBtn').trigger('click');
  assert.equal(h.db.ecotrack_ir_codes[0].source_platform, 'desktop');
  assert.equal((await service(h).getCommandsForDevice('ac-1'))[0].rawData, raw);
});
test('code-table outages keep profile loading functional and show an unavailable state', async () => {
  const h = harness(); h.state.unavailable = true;
  const desktopUi = h.loadDesktop(); for (const app of desktopUi.apps) await app.system.syncWithDatabase();
  assert.equal(desktopUi.apps[0].system.AirconProfileManager.getById('AC / 01').protocol_name, 'DAIKIN216');
  const studio = desktopUi.studio(desktopUi.apps[4], 'AC / 01');
  assert.match(studio.get('savedCodeStatus').textContent, /unavailable/);
  await assert.rejects(service(h).getAllIrCommands(), /not installed/);
});
test('Protocol Studio displays the shared capture count and refreshes after code changes', async () => {
  const h = harness(); await service(h).saveIrCommand({ airconId: 'ac-1', commandType: 'POWER_OFF', protocol: 'DAIKIN216', rawData: raw });
  const ui = h.loadDesktop(); for (const app of ui.apps) await app.system.syncWithDatabase();
  const studio = ui.studio(ui.apps[4], 'AC / 01');
  assert.match(studio.get('savedCodeStatus').textContent, /1 shared IR code/);
  await service(h).saveIrCommand({ airconId: 'ac-1', commandType: 'TEMP_UP', protocol: 'DAIKIN216', rawData: raw });
  await ui.apps[4].system.syncWithDatabase();
  assert.match(studio.get('savedCodeStatus').textContent, /2 shared IR codes/);
});
test('Supabase code-change subscriptions refresh five engines without reloading the pages', async () => {
  const h = harness(), ui = h.loadDesktop();
  for (const app of ui.apps) for (const callback of app.listeners.get('supabase:ready') || []) callback();
  for (let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));
  const handlers=h.channels.flatMap(channel=>channel.handlers).filter(handler=>handler.filter.table==='ecotrack_ir_codes');
  assert.equal(handlers.length,ui.apps.length);
  const saved=await service(h).saveIrCommand({airconId:'ac-1',commandType:'POWER_OFF',protocol:'DAIKIN216',rawData:raw});
  for(const handler of handlers)handler.callback({eventType:'INSERT',new:h.db.ecotrack_ir_codes[0]});
  for(const app of ui.apps)for(const [id,timer] of [...app.timers])if(timer.ms===150){app.timers.delete(id);timer.fn();}
  for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
  for(const app of ui.apps)assert.equal(app.system.ProtocolAdapter.getCommandsForDevice('AC / 01')[0].id,saved.id);
});
test('registration preserves the exact protocol through manufacturer edits unless a new remote protocol is detected',async()=>{
 const source=read(path.join(mobile,'src/app/devices.tsx'));
 const parsed=ts.createSourceFile('devices.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let declaration;
 const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(parsed)==='handleSaveNewDevice')declaration=node.getText(parsed);ts.forEachChild(node,visit);};visit(parsed);assert(declaration);
 for(const [brand,detected,expected] of [['Daikin',null,'DAIKIN64'],['Midea',null,'DAIKIN64'],['Daikin',{brand:'Daikin',protocol:'DAIKIN216',capture},'DAIKIN216']]){
  const calls=[],module={exports:{}};
  const context={module,exports:module.exports,installationAttempt:{current:null},requestId:()=>require('node:crypto').randomUUID(),remoteSniffRequest:{current:{listening:false}},friendlyName:'Controller',selectedBrand:brand,customBrandInput:'',selectedWifiSsid:'',wifiPassword:'',userType:'admin',userId:'u',userEmail:'u@example.test',selectedRoomId:'r1',selectedAirconType:'Split',assignmentId:'ac-1',customAirconName:'',detectedRemoteInfo:detected,
   availableAircons:[{id:'ac-1',brand:'Daikin',protocolName:'DAIKIN64'}],targetBleDevice:{bleId:'ble',deviceId:'esp32s3-001122334455'},triggerHaptic(){},setSavingDevice(){},setWifiPassword(){},setNewlyCreatedDevice(){},loadDevices:async()=>{},setAddStep(){},
   Alert:{alert(...args){throw Error(args.join(' '));}},DeviceService:{registerController:async(...args)=>{calls.push(args);return {id:'n1'};}},UserDeviceStorage:{recordUserNode:async()=>{}}};
  vm.runInNewContext(ts.transpileModule('const '+declaration+';exports.save=handleSaveNewDevice;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  await module.exports.save();assert.equal(calls[0][2].protocol_name,expected);assert.equal(calls[0][4]?.raw_data,detected?.capture?.raw_data);
 }
});

async function savedCaptureStudio(records = []) {
  const h = harness();
  for (const row of records) await service(h).saveIrCommand({ airconId: 'ac-1', commandType: row.name,
    protocol: row.protocol, rawData: row.raw || raw, capture: { protocol: row.protocol, hex: row.hex || '0x1234' } });
  const ui = h.loadDesktop();
  for (const app of ui.apps) await app.system.syncWithDatabase();
  const app = ui.apps[4], studio = ui.studio(app, 'AC / 01');
  const choose = async protocol => { studio.get('protocolSelect').value = protocol; await studio.get('protocolSelect').trigger('change'); };
  return { h, ui, app, studio, choose };
}
test('selecting TCL112AC opens its single real capture and never sends or saves a configuration', async () => {
  const { h, app, studio, choose } = await savedCaptureStudio([
    { name: 'POWER_ON', protocol: 'TCL112AC', hex: '0x23CB2601024080' },
    { name: 'DAIKIN_OFF', protocol: 'DAIKIN216', raw: '4000,2000,500' },
  ]);
  h.db.aircons.push({ ...h.db.aircons[0], id: 'ac-2', asset_tag: 'Other AC', controller_node_id: null, node_id: null });
  await service(h).saveIrCommand({ airconId: 'ac-2', commandType: 'OTHER_ROOM', protocol: 'TCL112AC', rawData: '1000,2000,3000' });
  await app.system.syncWithDatabase();
  const callsBefore = h.calls.length;
  await choose('TCL112AC');
  assert.equal(studio.get('savedCodeSelect').options.length, 2); // placeholder + this AC's one match
  assert.equal(studio.get('savedCodeSelect').value, h.db.ecotrack_ir_codes[0].id);
  assert.equal(studio.get('learnedFrameRaw').value, raw);
  assert.match(studio.get('learnedFrameSummary').textContent, /POWER_ON · TCL112AC · 0x23CB2601024080/);
  assert.equal(studio.get('learnedFramePanel').classList.contains('hidden'), false);
  assert.equal(studio.get('learnedCommandName').value, 'POWER_ON');
  assert.equal(h.calls.length, callsBefore);
  assert.equal(h.db.aircons[0].protocol_name, 'DAIKIN216');
});
test('multiple exact-protocol captures require a choice; switching protocols clears old frames and command names', async () => {
  const { h, studio, choose } = await savedCaptureStudio([
    { name: 'TCL_ON', protocol: 'TCL112AC', hex: '0x11' },
    { name: 'TCL_OFF', protocol: 'TCL112AC', hex: '0x22', raw: '4000,2000,500' },
    { name: 'DAIKIN64_ON', protocol: 'DAIKIN64', hex: '0x33' },
  ]);
  await choose('TCL112AC');
  assert.equal(studio.get('savedCodeSelect').value, '');
  assert.equal(studio.get('learnedFrameRaw').value, '');
  assert(studio.get('learnedFramePanel').classList.contains('hidden'));
  assert.match(studio.get('savedCodeStatus').textContent, /2 shared.*TCL112AC/);
  studio.get('savedCodeSelect').value = h.db.ecotrack_ir_codes[1].id;
  await studio.get('savedCodeSelect').trigger('change');
  assert.equal(studio.get('learnedFrameRaw').value, '4000,2000,500');
  assert.match(studio.get('learnedFrameSummary').textContent, /0x22/);
  await choose('DAIKIN64');
  assert.equal(studio.get('learnedCommandName').value, 'DAIKIN64_ON');
  assert.match(studio.get('learnedFrameSummary').textContent, /0x33/);
  await choose('DAIKIN216'); // exact variants must not be collapsed into a manufacturer
  assert.equal(studio.get('savedCodeSelect').value, '');
  assert.equal(studio.get('savedCodeSelect').disabled, true);
  assert.equal(studio.get('learnedFrameRaw').value, '');
  assert.equal(studio.get('learnedFrameSummary').textContent, '');
  assert.equal(studio.get('learnedCommandName').value, 'REMOTE_CAPTURE');
  assert.equal(studio.get('saveCapturedCodeBtn').disabled, true);
  assert.match(studio.get('savedCodeStatus').textContent, /No saved IR codes for DAIKIN216/);
  studio.get('savedCodeSelect').value = h.db.ecotrack_ir_codes[1].id;
  await studio.get('savedCodeSelect').trigger('change');
  assert.equal(studio.get('learnedFrameRaw').value, '');
});
test('capture refresh preserves the chosen command and typed name, updates its real data and clears a deleted code', async () => {
  const { h, app, studio, choose } = await savedCaptureStudio([
    { name: 'ON', protocol: 'TCL112AC' }, { name: 'OFF', protocol: 'TCL112AC' },
  ]);
  await choose('TCL112AC');
  const selected = h.db.ecotrack_ir_codes[1];
  studio.get('savedCodeSelect').value = selected.id; await studio.get('savedCodeSelect').trigger('change');
  studio.get('learnedCommandName').value = 'MY_OFF';
  selected.raw_data = '4000,2000,500'; selected.capture.hex = '0x5678';
  await app.system.syncWithDatabase();
  assert.equal(studio.get('savedCodeSelect').value, selected.id);
  assert.equal(studio.get('learnedCommandName').value, 'MY_OFF');
  assert.equal(studio.get('learnedFrameRaw').value, selected.raw_data);
  assert.match(studio.get('learnedFrameSummary').textContent, /0x5678/);
  h.db.ecotrack_ir_codes = [];
  await app.system.syncWithDatabase();
  assert(studio.get('learnedFramePanel').classList.contains('hidden'));
  assert.equal(studio.get('learnedFrameRaw').value, '');
  assert.match(studio.get('savedCodeStatus').textContent, /No saved IR codes for TCL112AC/);
});
test('new remote captures survive background refresh and a failed save without reverting to the existing saved code', async () => {
  const { h, app, studio, choose } = await savedCaptureStudio([{ name: 'OLD', protocol: 'TCL112AC' }]);
  await choose('TCL112AC');
  const fresh = { success: true, protocol: 'TCL112AC', hex: '0xCAFE', raw_data: '5000,2500,600' };
  app.system.ProtocolAdapter.getLatestLearned = async () => fresh;
  await studio.get('latestLearnedFrameBtn').trigger('click');
  studio.get('learnedCommandName').value = 'NEW_OFF';
  await app.system.syncWithDatabase();
  assert.equal(studio.get('savedCodeSelect').value, '');
  assert.equal(studio.get('learnedFrameRaw').value, fresh.raw_data);
  assert.equal(studio.get('learnedCommandName').value, 'NEW_OFF');
  h.state.failRpc = 'ecotrack_save_ir_code';
  await studio.get('saveCapturedCodeBtn').trigger('click');
  assert.equal(h.db.ecotrack_ir_codes.length, 1);
  assert.equal(studio.get('learnedFrameRaw').value, fresh.raw_data);
  assert.equal(studio.get('learnedCommandName').value, 'NEW_OFF');
  assert.equal(studio.get('saveCapturedCodeBtn').disabled, false);
  h.state.failRpc = null;
  await studio.get('saveCapturedCodeBtn').trigger('click');
  assert.equal(h.db.ecotrack_ir_codes.length, 2);
  assert.equal(h.db.ecotrack_ir_codes[1].raw_data, fresh.raw_data);
  assert.equal(studio.get('learnedCommandName').value, 'NEW_OFF');
});
test('late capture responses cannot replace a newly selected protocol', async () => {
  for (const [method, button] of [['getLatestLearned', 'latestLearnedFrameBtn'], ['sniffProtocol', 'autoDetectBtn']]) {
    const { app, studio, choose } = await savedCaptureStudio([{ name: 'TCL_ON', protocol: 'TCL112AC', hex: '0xABC' }]);
    let resolve;
    app.system.ProtocolAdapter[method] = () => new Promise(done => { resolve = done; });
    const request = studio.get(button).trigger('click');
    await choose('TCL112AC');
    resolve({ ...capture, success: true }); await request;
    assert.equal(studio.get('protocolSelect').value, 'TCL112AC');
    assert.match(studio.get('learnedFrameSummary').textContent, /TCL_ON.*0xABC/);
  }
});
test('a storage outage clears the displayed saved capture and disables stale choices', async () => {
  const { h, app, studio } = await savedCaptureStudio([{ name: 'ON', protocol: 'DAIKIN216' }]);
  assert.equal(studio.get('learnedFrameRaw').value, raw);
  h.state.unavailable = true;
  await app.system.syncWithDatabase();
  assert.match(studio.get('savedCodeStatus').textContent, /unavailable/);
  assert.equal(studio.get('savedCodeSelect').disabled, true);
  assert(studio.get('learnedFramePanel').classList.contains('hidden'));
  assert.equal(studio.get('learnedFrameRaw').value, '');
});

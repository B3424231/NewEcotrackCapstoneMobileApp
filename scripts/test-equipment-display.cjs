const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(overrides = {}, denied = []) {
  const records = {
    aircons: [{ id: 'ac-db', asset_tag: 'AC-esp32s3-9cd20604a7ac', name: 'Matrix', brand: 'TCL',
      controller_node_id: 'node-db', node_id: 'Old Controller', aircon_type: 'Split Type (Inverter)', protocol_name: 'TCL112AC', room_id: 'room-db' }],
    nodes: [{ id: 'node-db', name: 'Ac Controller 1', room_id: 'room-db', protocol_name: 'TCL112AC' }],
    rooms: [{ id: 'room-db', name: 'Room 1', floor_id: 'floor-db' }],
    floors: [{ id: 'floor-db', name: 'Floor 1', building_id: 'building-db' }],
    buildings: [{ id: 'building-db', name: 'IC Building' }],
    maintenance_reports: [{ id: 'MR-1', aircon_id: 'AC-esp32s3-9cd20604a7ac', aircon_name: 'AC-esp32s3-9cd20604a7ac',
      aircon_type: 'TCL - Split Type (Inverter)', room_id: 'room-db', room_name: 'Room 1', type: 'Inspection', status: 'Pending', tasks: [] }],
    ...overrides,
  };
  const calls = [], cache = new Map();
  const client = {
    auth: {},
    from(table) {
      const call = { table, ops: [] }; calls.push(call);
      const query = new Proxy({}, { get(_, method) {
        if (method === 'then') return (resolve, reject) => Promise.resolve().then(() => {
          if (denied.includes(table)) return { data: null, error: { message: 'permission denied' } };
          let rows = records[table] || [];
          for (const [op, column, value] of call.ops) {
            if (op === 'in') rows = rows.filter(row => value.includes(row[column]));
            if (op === 'gt') rows = rows.filter(row => row[column] > value);
          }
          return { data: rows, count: rows.length, error: null };
        }).then(resolve, reject);
        return (...args) => { call.ops.push([method, ...args]); return query; };
      } });
      return query;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  function load(file) {
    const filename = path.resolve(file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports,
      process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://test.invalid', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'test-key' } },
      Date, console: { warn() {}, error() {}, log() {} }, setTimeout, clearTimeout, AbortController,
      require(name) {
        if (name === 'react-native') return { Platform: { OS: 'android' } };
        if (name === '@supabase/supabase-js') return { createClient: () => client };
        if (name === '@react-native-async-storage/async-storage') return { getItem: async () => null };
        if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name) + '.ts');
        throw Error('Unexpected dependency ' + name);
      },
    }, { filename });
    return module.exports;
  }
  return { records, calls, load, context: { aircons: records.aircons, nodes: records.nodes, rooms: records.rooms, floors: records.floors, buildings: records.buildings } };
}

test('maintenance resolves current controller and custom AC names, preserves IDs and expands location', async () => {
  const h = harness();
  const reports = await h.load('src/services/supabase.ts').fetchLiveMaintenanceReports('Worker');
  assert.equal(reports.length, 1);
  const report = reports[0];
  assert.equal(report.airconId, h.records.maintenance_reports[0].aircon_id);
  assert.equal(report.controllerName, 'Ac Controller 1');
  assert.equal(report.airconName, 'Matrix');
  assert.equal(report.airconType, 'Split Type (Inverter)');
  assert.equal(report.protocolName, 'TCL112AC');
  assert.equal(report.location, 'IC Building • Floor 1 • Room 1');
  h.records.nodes[0].name = 'Renamed controller';
  assert.equal((await h.load('src/services/supabase.ts').fetchLiveMaintenanceReports())[0].controllerName, 'Renamed controller');
  assert.ok(h.calls.every(call => call.ops.every(([op]) => !['update', 'insert', 'delete', 'upsert'].includes(op))));
});

test('notifications refresh stale equipment metadata and retain recipient state and event IDs', async () => {
  const h = harness();
  const [item] = await h.load('src/services/supabase.ts').resolveNotificationEquipment([{
    id: 'notification-db', relatedReportId: 'MR-1', airconName: 'AC-esp32s3-9cd20604a7ac',
    airconType: 'TCL - Split Type (Inverter)', location: 'Room 1', isRead: true, isSnoozed: true,
    title: 'Check AC-esp32s3-9cd20604a7ac', message: 'Inspect AC-esp32s3-9cd20604a7ac at Room 1; protocol TCL112AC. Room 10 is separate.',
  }]);
  assert.equal(item.controllerName, 'Ac Controller 1');
  assert.equal(item.airconName, 'Matrix');
  assert.equal(item.airconType, 'Split Type (Inverter)');
  assert.equal(item.location, 'IC Building • Floor 1 • Room 1');
  assert.equal(item.id, 'notification-db');
  assert.equal(item.isRead, true); assert.equal(item.isSnoozed, true);
  assert.equal(item.title, 'Check Matrix');
  assert.equal(item.message, 'Inspect Matrix at IC Building • Floor 1 • Room 1; protocol TCL112AC. Room 10 is separate.');
});

test('missing or denied equipment lookup keeps reports visible without relabeling IDs as names', async () => {
  const h = harness({}, ['aircons', 'nodes']);
  const [report] = await h.load('src/services/supabase.ts').fetchLiveMaintenanceReports();
  assert.equal(report.id, 'MR-1'); assert.equal(report.controllerName, undefined); assert.equal(report.airconName, undefined);
  assert.equal(report.airconId, 'AC-esp32s3-9cd20604a7ac');
  assert.equal(report.airconType, 'Split Type (Inverter)');
});

test('ambiguous and room-only links never select a different controller', () => {
  const h = harness(); const resolve = h.load('src/services/equipment-display.ts').resolveEquipmentDisplay;
  let result = resolve({ airconId: 'unlinked-ac', roomId: 'room-db' }, h.context);
  assert.equal(result.controllerName, undefined); assert.equal(result.airconName, undefined);
  h.records.aircons[0].controller_node_id = 'missing-node';
  result = resolve({ airconId: 'ac-db' }, h.context);
  assert.equal(result.controllerName, undefined, 'An explicit broken binding cannot fall back to an unrelated legacy name');
  assert.equal(result.airconName, 'Matrix');
});

test('IR protocol and identifiers remain separate from names even with legacy metadata', () => {
  const h = harness(); const resolve = h.load('src/services/equipment-display.ts').resolveEquipmentDisplay;
  h.records.aircons[0].name = 'TCL112AC';
  h.records.nodes[0].name = 'esp32s3-9cd20604a7ac';
  const result = resolve({ airconId: 'ac-db', airconName: 'AC-esp32s3-9cd20604a7ac' }, h.context);
  assert.equal(result.airconName, undefined); assert.equal(result.controllerName, undefined);
  assert.equal(result.protocolName, 'TCL112AC');
  h.records.aircons[0].name = 'AC-esp32s3-9cd20604a7ac';
  assert.equal(resolve({ airconId: 'ac-db' }, h.context).airconName, undefined);
});

test('explicit saved names may equal an asset label, without using asset labels as name fallbacks', () => {
  const h = harness(); const resolve = h.load('src/services/equipment-display.ts').resolveEquipmentDisplay;
  h.records.aircons[0].asset_tag = 'Matrix';
  assert.equal(resolve({ airconId: 'ac-db' }, h.context).airconName, 'Matrix');
  delete h.records.aircons[0].name;
  assert.equal(resolve({ airconId: 'ac-db', airconName: 'Matrix' }, h.context).airconName, undefined);
});

test('maintenance description is a readable sibling card between equipment and progress', () => {
  const source = fs.readFileSync('src/app/Maintenance.tsx', 'utf8');
  const ast = ts.createSourceFile('Maintenance.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const cards = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'View' &&
      /styles\.(airconInfoCard|progressCard)\b/.test(node.openingElement.attributes.getText(ast))) cards.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const equipment = cards.find(node => node.getText(ast).includes('AIRCON & EQUIPMENT INFORMATION'));
  const description = cards.find(node => node.getText(ast).includes('SCOPE / DESCRIPTION'));
  const progress = cards.find(node => node.getText(ast).includes('MAINTENANCE PROGRESS'));
  assert.ok(equipment && description && progress);
  assert.equal(equipment.parent, description.parent); assert.equal(description.parent, progress.parent);
  assert.ok(equipment.end < description.pos && description.end < progress.pos);
  assert.ok(!equipment.getText(ast).includes('Scope / Description:'));
  assert.ok(!description.getText(ast).includes('numberOfLines'));
  assert.ok(!description.getText(ast).includes('<ScrollView'));
  assert.ok(equipment.getText(ast).includes('Assigned Worker:'));
});

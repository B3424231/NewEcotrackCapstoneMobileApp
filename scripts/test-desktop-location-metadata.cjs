'use strict';
// Execute actual desktop functions with isolated metadata and telemetry fixtures only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const desktop = path.resolve(__dirname, '../../EcoTrackDesktopDashboardNew-main-control');
const read = file => {
  const staged = process.env.ECOTRACK_DESKTOP_OVERLAY && path.join(process.env.ECOTRACK_DESKTOP_OVERLAY, file);
  return fs.readFileSync(staged && fs.existsSync(staged) ? staged : path.join(desktop, file), 'utf8');
};
const copy = value => JSON.parse(JSON.stringify(value));
const hierarchy = {
  nodes: [{ id: 'db-node', name: 'AC Controller 1', room_id: 'room-1', aircon_type: 'Split' }],
  rooms: [{ id: 'room-1', name: 'Room 1', floor_id: 'floor-1' }],
  floors: [{ id: 'floor-1', name: 'Floor 1', building_id: 'building-1' }],
  buildings: [{ id: 'building-1', name: 'IC building' }],
};
const reading = overrides => ({ id: 'reading-1', node_id: 'db-node', room_name: 'Room 1',
  building_name: 'Unassigned', floor_name: 'Unassigned', created: '2026-10-18T00:00:00Z',
  status: 'online', ac_on: true, temperature: 0, ...overrides });
function logHarness(records, data = copy(hierarchy)) {
  let tableRows = [];
  const body = { closest: () => null, replaceChildren(fragment) { tableRows = fragment.rows; } };
  const elements = new Map();
  const window = { addEventListener() {}, EcoTrackEnergyPrediction: { backendUrl: () => 'http://fixture' },
    EcoTrackAirconSystem: { NodeService: { getNode: () => ({ node_id: 'esp32s3-fixture' }) } },
    electron: { invoke: async name => { assert.equal(name, 'scheduler-fetch-data'); return { success: true, ...data }; } } };
  const context = vm.createContext({ window, console, Date, Intl, URLSearchParams,
    localStorage: { getItem: () => null },
    document: { addEventListener() {}, getElementById: id => {
      if (id === 'logsTableBody') return body;
      if (id === 'logsLoadError' || id === 'nodeFilter') return null;
      if (!elements.has(id)) elements.set(id, { style: {}, classList: { add() {}, remove() {} } });
      return elements.get(id);
    }, createDocumentFragment: () => ({ rows: [], appendChild(row) { this.rows.push(row); } }), createElement: () => ({}) },
    fetch: async () => ({ ok: true, json: async () => ({ items: records, totalItems: records.length }) }),
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
  });
  vm.runInContext(read('public/js/aircon-state.js'), context);
  vm.runInContext(read('public/js/logs.js'), context);
  Object.assign(context, { getFilteredLogs: () => vm.runInContext('nodeDataLogs', context),
    populateDateRangeOptions() {}, calculateStats: () => ({ totalRecords: records.length, onlineNodes: 1 }),
    updateActiveFilterBadge() {}, predictEnergyConsumption() {}, getEnergyPredictionForExport: () => null,
  });
  vm.runInContext("selectedDateKey = '2026-10-18'", context);
  return { context, rows: () => vm.runInContext('nodeDataLogs', context), rendered: () => tableRows };
}
test('loaded room hierarchy repairs placeholder location labels in the actual table and report snapshot', async () => {
  const h = logHarness([reading()]);
  await h.context.loadRoomMap(); await h.context.fetchLogsFromDB(true);
  assert.equal(h.rows()[0].floorName, 'Floor 1'); assert.equal(h.rows()[0].buildingName, 'IC building');
  assert.equal(h.rows()[0].temperature, 0);
  h.context.render();
  const cells = [...h.rendered()[0].innerHTML.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1].trim());
  assert.deepEqual(cells.slice(2, 5), ['IC building', 'Floor 1', 'Room 1']);
  const report = h.context.buildLogsReportSnapshot();
  assert.equal(report.rows[0].building, 'IC building'); assert.equal(report.rows[0].floor, 'Floor 1');
});
test('metadata arriving after history resolves a stable physical controller alias without rewriting records', async () => {
  const raw = reading({ node_id: 'esp32s3-fixture' }), original = copy(raw);
  const h = logHarness([raw]);
  await h.context.fetchLogsFromDB(true);
  assert.equal(h.rows()[0].buildingName, 'Unassigned');
  await h.context.loadRoomMap();
  assert.equal(h.context.resolveLogLocation(h.rows()[0]).buildingName, 'IC building');
  assert.equal(h.context.buildLogsReportSnapshot().rows[0].floor, 'Floor 1');
  assert.deepEqual(raw, original);
});
test('real historical locations remain intact and an old room never receives the current room parents', async () => {
  const h = logHarness([
    reading({ id: 'historic', room_name: 'Former Lab', floor_name: 'Old Floor', building_name: 'Old Building' }),
    reading({ id: 'incomplete', room_name: 'Former Lab' }),
    reading({ id: 'other-room-id', room_id: 'different-room', room_name: 'Room 1' }),
  ]);
  await h.context.loadRoomMap(); await h.context.fetchLogsFromDB(true);
  const rows = h.rows();
  assert.equal(rows[0].buildingName, 'Old Building'); assert.equal(rows[0].floorName, 'Old Floor');
  assert.equal(rows[1].roomName, 'Former Lab'); assert.equal(rows[1].floorName, 'Unassigned');
  assert.equal(rows[2].buildingName, 'Unassigned');
});
test('missing hierarchy remains unavailable rather than using a guessed building or floor', async () => {
  const h = logHarness([reading()], { nodes: [], rooms: [], floors: [], buildings: [] });
  await h.context.loadRoomMap(); await h.context.fetchLogsFromDB(true);
  assert.equal(h.rows()[0].floorName, 'Unassigned'); assert.equal(h.rows()[0].buildingName, 'Unassigned');
});
function writerHarness() {
  const data = copy(hierarchy), calls = [], writes = [];
  let now = Date.now(), denied = false, engineNode;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const sb = { from(table) {
    let field, value, update = false;
    const query = { select() { return query; }, eq(f, v) { field = f; value = v; return query; },
      update() { update = true; return query; }, maybeSingle() { return query; },
      then(resolve, reject) {
        if (!update) calls.push({ table, field, value });
        return Promise.resolve(denied ? { data: null, error: { message: 'Denied' } } :
          { data: update ? [] : data[table]?.find(row => row[field] === value), error: null }).then(resolve, reject);
      } }; return query;
  } };
  const window = { supabaseClient: sb, addEventListener() {}, dispatchEvent() {},
    EcoTrackAirconSystem: { NodeService: { getNode: () => engineNode }, AirconProfileManager: { getAll: () => [] } } };
  const context = vm.createContext({ window, console, Date: Clock, AbortController,
    document: { readyState: 'loading', addEventListener() {} },
    CustomEvent: class {}, setTimeout() {}, clearTimeout() {}, setInterval() {},
    fetch: async (url, options) => { assert(url.endsWith('/api/telemetry')); writes.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ id: 'saved-' + writes.length }) }; },
  });
  vm.runInContext(read('public/js/node-sync.js'), context);
  return { calls, writes, data, tick: () => { now += 1000; }, deny: value => { denied = value; },
    engine: node => { engineNode = node; }, save: window.EcoTrackNodeSync.saveNodeTelemetryToSqlite };
}
const packet = { id: 'esp32s3-fixture', pb_id: 'db-node', name: 'Renamed controller', room_name: 'Room 1',
  aircon_type: 'Split', status: 'online', temp: 0, ac_on: false };
test('saving a room-only packet completes parents by stable database identity even after a controller rename', async () => {
  const h = writerHarness(); await h.save(packet);
  assert.equal(h.writes[0].floor_name, 'Floor 1'); assert.equal(h.writes[0].building_name, 'IC building');
  assert.equal(h.writes[0].temperature, 0); assert.equal(h.writes[0].ac_on, false);
  assert.deepEqual(h.calls[0], { table: 'nodes', field: 'id', value: 'db-node' });
  const reads = h.calls.length; h.tick(); await h.save(packet);
  assert.equal(h.calls.length, reads, 'Complete metadata can be reused without querying for each reading');
});
test('an incomplete or denied metadata lookup is retried later, without dropping the actual reading', async () => {
  const h = writerHarness(); h.deny(true); await h.save(packet);
  assert.equal(h.writes[0].floor_name, 'Unassigned'); assert.equal(h.writes[0].ac_on, false);
  h.deny(false); h.tick(); await h.save(packet);
  assert.equal(h.writes[1].building_name, 'IC building'); assert.equal(h.writes[1].floor_name, 'Floor 1');
});
test('known controller metadata completes labels without a query and a room reassignment invalidates old cached parents', async () => {
  const h = writerHarness();
  h.engine({ db_id: 'db-node', room_id: 'room-1', room_name: 'Room 1', floor_name: 'Unassigned', building_name: 'Unassigned', floor: 'Floor 1', building: 'IC building' });
  await h.save(packet); assert.equal(h.calls.length, 0); assert.equal(h.writes[0].building_name, 'IC building');
  h.engine({ db_id: 'db-node', room_id: 'room-2', room_name: 'Workshop', floor: 'Ground', building: 'East' });
  h.tick(); await h.save({ ...packet, room_name: 'Workshop' });
  assert.equal(h.writes[1].room_name, 'Workshop'); assert.equal(h.writes[1].floor_name, 'Ground');
  assert.equal(h.writes[1].building_name, 'East');
});

const tableCells = row => [...row.innerHTML.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1].trim());
const remoteSettings = (temp, mode = 'cool') => ({ observed_remote_state: { power: true, temp, mode, fan: 'low' }, observed_remote_at: '2026-10-18T00:00:00Z' });
test('Target Temperature, Operating Mode, Blower Fan Mode and Special Functions follow the requested order', async () => {
  const snapshot = remoteSettings(21.5); snapshot.observed_remote_state.turbo = true;
  const h = logHarness([reading({ temperature: null, control_snapshot: snapshot })]);
  await h.context.fetchLogsFromDB(true); h.context.render();
  const html = read('public/logs.html'), end = html.indexOf('<tbody id="logsTableBody"');
  const headers = [...html.slice(html.lastIndexOf('<thead', end), end).matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(match => match[1].trim());
  const cells = tableCells(h.rendered()[0]);
  assert.deepEqual(headers.slice(6, 10), ['Target Temperature', 'Operating Mode', 'Blower Fan Mode', 'Special Functions']);
  assert.deepEqual(cells.slice(6, 10), ['21.5°C', 'COOL', 'LOW · TURBO', 'Turbo: ON']);
  assert.equal(headers.length, 13); assert.equal(cells.length, 13);
  assert.equal(headers[6], 'Target Temperature'); assert.equal(cells[6], '21.5°C');
  assert.equal(headers[7], 'Operating Mode'); assert.equal(cells[7], 'COOL');
  assert.equal(headers[8], 'Blower Fan Mode'); assert.equal(cells[8], 'LOW · TURBO');
});
test('historical targets come from each saved snapshot while measured readings and raw history stay unchanged', async () => {
  const records = [reading({ temperature: 29, control_snapshot: remoteSettings(18), created: '2026-10-18T00:00:00Z' }),
    reading({ id: 'second', temperature: null, control_snapshot: remoteSettings(23.5, 'dry'), created: '2026-10-18T00:01:00Z' })];
  const original = copy(records), h = logHarness(records);
  await h.context.fetchLogsFromDB(true); h.context.render();
  assert.deepEqual(h.rendered().map(row => tableCells(row)[6]), ['18°C', '23.5°C']);
  assert.equal(tableCells(h.rendered()[1])[7], 'DRY');
  const report = h.context.buildLogsReportSnapshot();
  assert.deepEqual(Array.from(report.rows, row => row.setpoint), [18, 23.5]);
  assert.deepEqual(Array.from(report.rows, row => row.temperature), [29, null]);
  assert.deepEqual(records, original);
});
test('a missing recorded target never falls back to a room measurement, configured default or requested setting', async () => {
  for (const snapshot of [null, { desired_state: { power: true, temp: 22 } }, { configured_state: { temp: 22 } },
    remoteSettings(''), remoteSettings('invalid'), remoteSettings(true), remoteSettings([]), remoteSettings({})]) {
    const h = logHarness([reading({ temperature: 26, control_snapshot: snapshot })]);
    await h.context.fetchLogsFromDB(true); h.context.render();
    assert.equal(tableCells(h.rendered()[0])[6], 'Unavailable');
    assert.equal(h.context.buildLogsReportSnapshot().rows[0].setpoint, null);
  }
});
test('the actual Excel detail rows use the requested column order and the recorded target temperature', async () => {
  const snapshot = remoteSettings(21.5); snapshot.observed_remote_state.turbo = true;
  const h = logHarness([reading({ temperature: 29, control_snapshot: snapshot })]);
  await h.context.fetchLogsFromDB(true);
  const values = new Map(), cells = new Map();
  Object.assign(h.context, { report: h.context.buildLogsReportSnapshot(),
    logs: { getRow: () => ({}), getCell: key => { if (!cells.has(key)) cells.set(key, {}); return cells.get(key); } },
    styleRow: (_sheet, index, row) => values.set(index, row), numeric: value => Number.isFinite(value) ? value : 'Unavailable' });
  const source = read('public/js/logs.js'), start = source.indexOf("    const headers = [", source.indexOf('async function exportExcelLogs()'));
  const end = source.indexOf('    logs.autoFilter', start);
  assert(start > 0 && end > start);
  vm.runInContext(source.slice(start, end), h.context);
  assert.deepEqual(Array.from(values.get(4)).slice(6, 10), ['Target Temperature (C)', 'Operating Mode', 'Blower Fan Mode', 'Special Functions']);
  assert.deepEqual(Array.from(values.get(5)).slice(6, 10), [21.5, 'COOL', 'LOW · TURBO', 'Turbo: ON']);
  assert.equal(values.get(4)[6], 'Target Temperature (C)'); assert.equal(values.get(4)[7], 'Operating Mode');
  assert.equal(values.get(5)[6], 21.5); assert.equal(values.get(5)[7], 'COOL');
  assert.equal(cells.get('G5').numFmt, '0.0');
});

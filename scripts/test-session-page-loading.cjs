'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true };
const transpile = code => ts.transpileModule(code, { compilerOptions: options }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

function hookRunner() {
  const values = [], effects = [], pending = []; let cursor = 0;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return values[i] ||= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!values[i] || deps.some((value, n) => value !== values[i].deps[n])) values[i] = { fn, deps }; return values[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || deps.some((value, n) => value !== effects[i].deps[n])) pending.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  return { react, render(fn, ...args) { cursor = 0; return fn(...args); }, flush() { for (const fn of pending.splice(0)) fn(); }, unmount() { for (const effect of effects) effect?.cleanup?.(); } };
}

function fixture() {
  let runner, nextRead = Promise.resolve([]), revision = 0, listener;
  const modules = new Map();
  const service = {
    fetchLiveMobileNotifications: () => nextRead,
    deduplicateMobileNotifications: rows => rows,
    isMobileNotificationStateUpdating: () => false,
    getMobileNotificationStateRevision: () => revision,
    subscribeToMobileNotifications: fn => { listener = fn; return () => {}; },
    applyMobileNotificationState: (rows, change) => rows.map(row => row.id === change.id ? { ...row, isRead: change.isRead } : row),
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} }; modules.set(file, module.exports);
    vm.runInNewContext(transpile(fs.readFileSync(file, 'utf8')), {
      module, exports: module.exports, setTimeout, clearTimeout, AbortController,
      console: { warn() {}, error() {} },
      require(name) {
        if (name === 'react-native') return {AppState:{currentState:'active',addEventListener:()=>({remove(){}})}};
        if (name === 'react') return new Proxy({}, { get: (_, key) => runner.react[key] });
        if (name === '@/services/mobile-notifications') return service;
        if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
        throw new Error('Unexpected dependency: ' + name);
      },
    });
    return module.exports;
  }
  const hook = load('src/hooks/use-mobile-notifications.ts').useMobileNotifications;
  return {
    load, read(value) { nextRead = value; },
    mount(account = 'staff:alice') { runner = hookRunner(); const instance = runner; return { render: () => { runner = instance; return instance.render(hook, account); }, flush: () => { runner = instance; instance.flush(); }, unmount: instance.unmount }; },
    change(value) { revision++; listener(value); },
  };
}

test('a successful empty notification page returns immediately after remount', async () => {
  const f = fixture(), first = f.mount();
  assert.equal(first.render().loading, true); first.flush(); await settle();
  assert.equal(first.render().loading, false); first.unmount();
  f.read(new Promise(() => {}));
  const returning = f.mount();
  assert.equal(returning.render().loading, false, 'successful empty data is a usable session snapshot');
  assert.equal(returning.render().items.length, 0); returning.flush(); returning.unmount();
});

test('refresh errors preserve content and error when the notification page remounts', async () => {
  const f = fixture(); f.read(Promise.resolve([{ id: 'notice', isRead: false, createdAt: '2026-10-01T00:00:00Z' }]));
  const first = f.mount(); first.render(); first.flush(); await settle();
  const pending = deferred(); f.read(pending.promise);
  const refresh = first.render().refresh(); await settle();
  assert.equal(first.render().loading, false); assert.equal(first.render().items[0].id, 'notice');
  assert.equal(first.render().refreshing, true);
  pending.reject(new Error('Fixture offline')); await refresh; await settle();
  assert.match(first.render().error, /Unable to sync/); first.unmount();
  const returning = f.mount();
  assert.equal(returning.render().items[0]?.id, 'notice'); assert.equal(returning.render().loading, false);
  assert.match(returning.render().error, /Unable to sync/);
});

test('account changes and cache resets reject old notification completions', async () => {
  const f = fixture(), pending = deferred(); f.read(pending.promise);
  const old = f.mount(); old.render(); old.flush(); await settle();
  // A logout must invalidate work before React cleans up the old page.
  const cache = f.load('src/hooks/use-session-page-snapshot.ts');
  cache.clearSessionPageSnapshots();
  pending.resolve([{ id: 'old-account' }]); await settle();
  assert.equal(old.render().items.length, 0); old.unmount();
  const next = f.mount('staff:bob'); assert.equal(next.render().items.length, 0); assert.equal(next.render().loading, true);
  const sameAccountNextSession = f.mount(); assert.equal(sameAccountNextSession.render().loading, true);
});

function pageFixture(file, stopAt, fields) {
  let runner, read = Promise.resolve([]);
  const auth = { userId: 'alice', userEmail: 'alice@example.invalid', userName: 'Alice', userType: 'admin', setUserAssignment() {} };
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword));
  const statements = [];
  for (const node of component.body.statements) {
    if (node.getText(source).replace(/\r\n/g, '\n').startsWith(stopAt)) break;
    statements.push(node.getText(source));
  }
  const module = { exports: {} };
  const react = Object.fromEntries(['useState', 'useRef', 'useCallback', 'useEffect'].map(name => [name, (...args) => runner.react[name](...args)]));
  // Exercise the actual screen's loading and refresh prelude; only external reads and unrelated UI work are doubled.
  // One module across mounts is essential: a new cache would hide the remount regression.
  const cacheModule = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync('src/hooks/use-session-page-snapshot.ts', 'utf8')), {
    module: cacheModule, exports: cacheModule.exports, require: () => react,
  });
  const helper = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync('src/services/refresh-coordinator.ts', 'utf8')), { module: helper, exports: helper.exports, setTimeout, clearTimeout });
  const services = { fetchAvailableRooms: async () => [], getDevices: () => read, refreshConnectionAge: row=>row,
    subscribeToDeviceChanges: () => () => {} };
  vm.runInNewContext(transpile(`function screen() { ${statements.join('\n')} return { ${fields} }; } module.exports = screen;`), {
    module, exports: module.exports, ...react, ...cacheModule.exports, ...helper.exports,
    useAuth: () => auth, useSettings: () => ({ effectiveTheme: 'light', colors: {}, settings: { autoSyncEnabled: false, syncFrequency: 60 } }),
    themedStyles: { light: {} }, Animated: { Value: class {}, loop: () => ({ start() {}, stop() {} }), sequence: () => ({}), timing: () => ({}) },
    AppState:{currentState:'active',addEventListener:()=>({remove(){}})}, Platform: { OS: 'android' }, createReadScope: () => ({ assertSuccessful() {} }),
    fetchLiveAcControllers: () => read, fetchActiveRoom: async () => ({ id: 'room' }),
    resolveWorkerAssignment: async () => ({ isAssigned: true, roomId: 'room', assignmentText: 'Room' }),
    mergeHomeControllerFetch: rows => rows, applyHomeControllerState: row => row,
    subscribeToNodes: () => () => {}, DeviceService: services, BleDeviceService: {},
    UserDeviceStorage: { getUserNodeIds: async () => [] }, fetchLiveMaintenanceReports: () => read,
    useLocalSearchParams: () => ({}), createMaintenanceMutationTracker: () => () => ({}),
    subscribeToMaintenanceReports: () => () => {}, console: { error() {} }, setInterval: () => 1, clearInterval() {},
  });
  return { auth, read(value) { read = value; }, clear: cacheModule.exports.clearSessionPageSnapshots,
    mount() { const instance = hookRunner(); return { render() { runner = instance; return instance.render(module.exports); }, flush() { runner = instance; instance.flush(); }, unmount: instance.unmount }; } };
}

for (const [name, file, marker, fields] of [
  ['Home', 'src/app/index.tsx', 'const onRefresh', 'loading, controllers, activeRoom, assignmentInfo, fetchError'],
  ['Devices', 'src/app/devices.tsx', 'const filteredDevices', 'loading, devices, availableRooms, hasDeviceSnapshot, fetchError'],
  ['Maintenance', 'src/app/Maintenance.tsx', 'const routeKey', 'loading, reports, fetchError'],
]) {
  test(`${name} restores successful empty data before its background refresh`, async () => {
    const f = pageFixture(file, marker, fields), first = f.mount();
    assert.equal(first.render().loading, true); first.flush(); await settle();
    assert.equal(first.render().loading, false); first.unmount();
    const pending = deferred(); f.read(pending.promise);
    const returning = f.mount(); assert.equal(returning.render().loading, false, `${name} should reuse the session snapshot`);
    returning.flush(); await settle(); assert.equal(returning.render().loading, false);
    pending.reject(new Error('Fixture offline')); await settle();
    assert.equal(returning.render().loading, false); assert.ok(returning.render().fetchError); returning.unmount();
  });
}


test('changing the authenticated account clears even the same account snapshot in a later session', async () => {
  const f=fixture(),cache=f.load('src/hooks/use-session-page-snapshot.ts');
  cache.setSessionPageAccount('staff:alice');
  const first=f.mount();first.render();first.flush();await settle();assert.equal(first.render().loading,false);
  cache.setSessionPageAccount(null);
  cache.setSessionPageAccount('staff:alice');
  first.unmount();assert.equal(f.mount().render().loading,true);
});

for (const [name,file,marker,fields,list] of [
  ['Home','src/app/index.tsx','const onRefresh','loading, controllers, fetchError','controllers'],
  ['Devices','src/app/devices.tsx','const filteredDevices','loading, devices, fetchError','devices'],
  ['Maintenance','src/app/Maintenance.tsx','const routeKey','loading, reports, fetchError','reports'],
]) test(`${name} keeps populated content when returning while its next read fails`,async()=>{
  const f=pageFixture(file,marker,fields);f.read(Promise.resolve([{id:'saved-row',name:'Saved fixture'}]));
  const first=f.mount();first.render();first.flush();await settle();
  assert.equal(first.render()[list][0].id,'saved-row');first.unmount();
  const pending=deferred();f.read(pending.promise);const back=f.mount();
  assert.equal(back.render()[list][0].id,'saved-row');assert.equal(back.render().loading,false);
  back.flush();await settle();pending.reject(Error('offline'));await settle();
  assert.equal(back.render()[list][0].id,'saved-row');assert.ok(back.render().fetchError);back.unmount();
});

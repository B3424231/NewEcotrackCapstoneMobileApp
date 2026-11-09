'use strict';
// Current-source regression tests. All Auth, storage, realtime and clocks are
// isolated in memory; no credential/config file or network service is used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.ECOTRACK_MOBILE_ROOT || path.resolve(__dirname, '..');
const stage = process.env.ECOTRACK_MOBILE_STAGE || root;
const ts = require(require.resolve('typescript', { paths: [root] }));
const source = file => fs.readFileSync(path.join(fs.existsSync(path.join(stage, file)) ? stage : root, file), 'utf8');
const compile = value => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), get resolve() { return resolve; } }; };
function named(file, name) {
  const parsed = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(parsed); else ts.forEachChild(node, visit); };
  visit(parsed); assert(found, name); return found;
}
function clock() {
  let now = Date.parse('2026-11-06T00:00:00Z'), serial = 0;
  const timers = new Map();
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const add = (fn, delay, repeat) => { const id = ++serial; timers.set(id, { fn, at: now + delay, delay, repeat }); return id; };
  return { Date: ClockDate, timers, setTimeout: (fn, ms) => add(fn, ms, false), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => add(fn, ms, true), clearInterval: id => timers.delete(id), async advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers].filter(([, item]) => item.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, item] = next; now = item.at;
        if (item.repeat) item.at += item.delay; else timers.delete(id);
        item.fn(); await settle();
      }
      now = until; await settle();
    } };
}
function hooks() {
  let active;
  const instances = new Set();
  const react = { createContext: value => ({ Provider: 'Provider', value }), useContext: context => context.value,
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const instance = active, index = instance.cursor++;
      if (!(index in instance.slots)) instance.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [instance.slots[index], value => { instance.slots[index] = typeof value === 'function' ? value(instance.slots[index]) : value; }]; },
    useRef(initial) { const instance = active, index = instance.cursor++;
      return instance.slots[index] || (instance.slots[index] = { current: initial }); },
    useCallback(fn, deps) { const instance = active, index = instance.cursor++, prev = instance.slots[index];
      if (!prev || deps.some((value, i) => value !== prev.deps[i])) instance.slots[index] = { fn, deps };
      return instance.slots[index].fn; },
    useEffect(fn, deps) { const instance = active, index = instance.cursor++, prev = instance.slots[index];
      if (!prev || deps.some((value, i) => value !== prev.deps[i])) instance.pending.push(() => {
        prev?.cleanup?.(); instance.slots[index] = { deps, cleanup: fn() }; }); },
  };
  return { react, mount(fn) { const instance = { slots: [], pending: [], cursor: 0 }; instances.add(instance);
    const render = () => { active = instance; instance.cursor = 0; const value = fn(); active = null;
      instance.pending.splice(0).forEach(effect => effect()); return value; };
    const dispose = () => { instance.slots.forEach(slot => slot?.cleanup?.()); instances.delete(instance); };
    return { render, dispose }; } };
}
function evaluate(value, globals = {}) {
  const module = { exports: {} }; vm.runInNewContext(compile(value), { module, exports: module.exports,
    console: { warn() {}, error() {} }, AbortController, URL, ...globals }); return module.exports;
}
const lifecycle = () => { const listeners = new Set(); return { currentState: 'active', listeners,
  addEventListener(_, callback) { listeners.add(callback); return { remove() { listeners.delete(callback); } }; },
  set(state) { this.currentState = state; listeners.forEach(callback => callback(state)); } }; };

function notificationFixture(count = 121) {
  const c = clock(), h = hooks(), life = lifecycle(), channels = [], requests = [], modules = new Map();
  let authEvent, hold = null, fail = false, read = false;
  const rows = Array.from({ length: count }, (_, i) => ({ id: `n${String(i).padStart(3, '0')}`, event_key: `e${i}`,
    title: `Task ${i}`, message: `Message ${i}`, created_at: '2026-11-06T00:00:00Z', is_read: read }));
  const client = { auth: { onAuthStateChange(callback) { authEvent = callback; }, getUser: async () => ({ data: { user: { id: 'auth-a' } }, error: null }) },
    rpc(name, args) {
      requests.push({ name, args });
      if (name !== 'ecotrack_list_notifications') { read = args?.p_action !== 'unread'; return hold ? hold(name, args) : Promise.resolve({ data: args?.p_ids?.length ?? count, error: null }); }
      if (hold) return hold(name, args);
      if (fail) return Promise.resolve({ data: null, error: { message: 'Offline' } });
      const offset = args.p_before_id ? rows.findIndex(row => row.id === args.p_before_id) + 1 : 0;
      const page = rows.slice(offset, offset + args.p_limit).map(row => ({ ...row, is_read: read }));
      return Promise.resolve({ data: { items: page, next_cursor: offset + page.length < rows.length ?
        { id: page.at(-1).id, created_at: page.at(-1).created_at } : null }, error: null });
    },
    channel(name) { const channel = { name, handlers: [], on(_, filter, callback) { this.handlers.push({ filter, callback }); return this; }, subscribe() { return this; } };
      channels.push(channel); return channel; }, removeChannel(channel) { channel.removed = true; } };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = evaluate(source(file), { ...c, require(name) {
      if (name === 'react') return h.react;
      if (name === 'react-native') return { AppState: life };
      if (name === './supabase') return { supabase: client, resolveNotificationEquipment: async items => items };
      if (name === './sensor-readings') return { functionalDeviceText: value => value };
      if (name === '@/utils/notification-emitter') return { NotificationEmitter: {} };
      if (name === '@react-native-async-storage/async-storage') return {};
      return load((name.startsWith('@/') ? `src/${name.slice(2)}` : `src/services/${name.slice(2)}`) + '.ts');
    } }); modules.set(file, exports); return exports;
  }
  const snapshot = load('src/hooks/use-session-page-snapshot.ts'); snapshot.setSessionPageAccount('staff:a');
  const service = load('src/services/mobile-notifications.ts'), hook = load('src/hooks/use-mobile-notifications.ts').useMobileNotifications;
  const mount = (initial = 'staff:a') => { let account = initial; const instance = h.mount(() => hook(account)); instance.render();
    return { ...instance, switchAccount(next) { account = next; return instance.render(); } }; };
  const emit = (table, payload = {}) => channels.filter(channel => !channel.removed).forEach(channel => channel.handlers
    .filter(handler => handler.filter.table === table).forEach(handler => handler.callback(payload)));
  return { c, life, client, channels, requests, snapshot, service, mount, emit,
    hold(value) { hold = value; }, fail(value) { fail = value; }, auth(subject) { authEvent?.('SIGNED_IN', subject ? { user: { id: subject } } : null); } };
}

test('F09 list and badge share three pages and ignore a heartbeat; real metadata/state still invalidate', async () => {
  const f = notificationFixture(), a = f.mount(), b = f.mount(); await settle();
  assert.equal(a.render().items.length, 121); assert.equal(b.render().items.length, 121);
  assert.equal(f.requests.length, 3, 'one full history read for both consumers');
  assert.equal(f.channels.length, 1);
  f.emit('nodes', { eventType: 'UPDATE', old: { id: 'n', name: 'Lab', temp: 20 }, new: { id: 'n', name: 'Lab', temp: 21, last_seen: 'new' } });
  await f.c.advance(200); assert.equal(f.requests.length, 3);
  f.emit('nodes', { eventType: 'UPDATE', old: { id: 'n', name: 'Lab' }, new: { id: 'n', name: 'Renamed Lab' } });
  await f.c.advance(200); assert.equal(f.requests.length, 6);
  f.emit('rooms', { eventType: 'UPDATE', new: { id: 'r', name: 'New room' } });
  f.emit('mobile_notification_state'); await f.c.advance(200); assert.equal(f.requests.length, 9);
  a.dispose(); assert.equal(f.channels[0].removed, undefined); b.dispose();
  assert.equal(f.channels[0].removed, true); assert.equal(f.c.timers.size, 0); assert.equal(f.life.listeners.size, 0);
});

test('F09 recipient revisions reject a late pre-mutation read and synchronize all consumers', async () => {
  const f = notificationFixture(1), a = f.mount(), b = f.mount(); await settle();
  const pending = deferred(); f.hold(name => name === 'ecotrack_list_notifications' ? pending.promise : Promise.resolve({ data: 1, error: null }));
  const refresh = a.render().refresh(); await settle();
  assert.equal(await f.service.markAllMobileNotificationsAsRead(), true);
  assert.equal(a.render().items[0].isRead, true); assert.equal(b.render().items[0].isRead, true);
  f.hold(null); pending.resolve({ data: { items: [{ id: 'n000', title: 'Task', message: 'old', is_read: false }], next_cursor: null }, error: null });
  await refresh; await f.c.advance(200);
  assert.equal(a.render().items[0].isRead, true); a.dispose(); b.dispose();
});

test('F09 background coalescing, snapshot retention, unmount and account isolation survive sharing', async () => {
  const f = notificationFixture(1), a = f.mount(), b = f.mount(); await settle();
  f.life.set('background'); for (let i = 0; i < 20; i++) f.emit('mobile_notifications');
  await f.c.advance(1000); assert.equal(f.requests.length, 1);
  f.life.set('active'); await settle(); assert.equal(f.requests.length, 2);
  f.fail(true); await a.render().refresh(); assert.equal(a.render().items.length, 1); assert(a.render().error);
  f.fail(false); const pending = deferred(); f.hold(() => pending.promise);
  const refresh = a.render().refresh(); await settle();
  f.snapshot.setSessionPageAccount('staff:b'); a.switchAccount('staff:b'); b.switchAccount('staff:b');
  assert.equal(a.render().items.length, 0); f.hold(null);
  pending.resolve({ data: { items: [{ id: 'old-account', title: 'Old', message: '' }], next_cursor: null }, error: null });
  await refresh; await settle();
  assert.equal(a.render().items.some(item => item.id === 'old-account'), false);
  a.dispose(); b.dispose(); assert.equal(f.channels.every(channel => channel.removed), true);
});

test('late recipient mutation cannot release a new account pending mutation or change its feed', async () => {
  const f = notificationFixture(1); f.auth('auth-a');
  const a = deferred(), b = deferred(); let i = 0; f.hold(() => ++i === 1 ? a.promise : b.promise);
  const first = f.service.markMobileNotificationAsRead('broadcast'); await settle();
  f.auth('auth-b'); const second = f.service.markMobileNotificationAsRead('broadcast', false); await settle();
  a.resolve({ data: 1, error: null }); await first;
  assert.equal(f.service.isMobileNotificationStateUpdating(), true);
  b.resolve({ data: 1, error: null }); assert.equal(await second, true);
  assert.equal(f.service.isMobileNotificationStateUpdating(), false);
});

test('F08 foreground suppression uses saved preferences in both directions without replacing subscriptions', async () => {
  const c = clock(), h = hooks(); let settings = { criticalAlertsEnabled: true, maintenanceRemindersEnabled: true }, listener, subscriptions = 0, haptics = 0;
  const animation = { start() {} };
  const exports = evaluate(named('src/app/_layout.tsx', 'GlobalNotificationBanner') + '\nmodule.exports = GlobalNotificationBanner;', { ...c,
    React: h.react, ...h.react, useAuth: () => ({ userName: 'Same user', userId: 'a', isAuthenticated: true, userType: 'staff' }),
    useSettings: () => ({ settings, triggerHaptic() { haptics++; } }), SCREEN_WIDTH: 390,
    Animated: { Value: class { setValue() {} interpolate() {} }, spring: () => animation, timing: () => animation, parallel: () => animation, View: 'Banner' },
    setupNotificationChannels: async () => {}, subscribeToIncomingNotifications: () => { subscriptions++; return () => {}; },
    NotificationEmitter: { addListener(callback) { listener = callback; return () => {}; }, trigger() {} },
    Platform: { OS: 'web' }, isExpoGo: true, bannerStyles: {}, Pressable: 'Pressable', View: 'View', Image: 'Image', ThemedText: 'Text', require: () => ({}),
  });
  const banner = h.mount(exports); banner.render(); await settle();
  listener('Enabled', '', true); assert.equal(haptics, 1); banner.render();
  settings = { criticalAlertsEnabled: false, maintenanceRemindersEnabled: false }; banner.render();
  listener('Disabled alert', '', true); listener('Disabled reminder', '', false); assert.equal(haptics, 1);
  settings = { criticalAlertsEnabled: true, maintenanceRemindersEnabled: true }; banner.render();
  listener('Enabled again', '', false); assert.equal(haptics, 2); assert.equal(subscriptions, 1); banner.dispose();
});

for (const file of ['src/app/index.tsx', 'src/app/devices.tsx']) test(`F07 ${file} applies 30s then 5s and retains realtime`, async () => {
  const parsed = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let effect;
  const visit = node => { if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect' &&
    node.arguments[0]?.getText(parsed).includes('CloudHardware.listUpdates')) effect = node.getText(parsed); ts.forEachChild(node, visit); };
  visit(parsed); assert(effect); const c = clock(), life = lifecycle(); let cleanup, previousDeps, requests = 0, handler;
  const query = evaluate(source('src/services/refresh-coordinator.ts'), c);
  const globals = { ...c, AppState: life, settings: { syncFrequency: 30, autoSyncEnabled: true }, ...query,
    fetchControllers: async () => {}, refreshDeviceData: async () => {}, refreshRef: { current: null },
    isSessionCurrent: () => true, lastInventoryRead: { current: c.Date.now() },
    visibleControllers: { current: [{ id: 'n', lastSeen: '2026-11-06T00:00:00Z' }] }, visibleDevices: { current: [{ id: 'n' }] },
    setControllers() {}, setDevices() {}, setSelectedDevice() {}, applyHomeControllerState: item => item,
    CloudHardware: { listUpdates: async () => { requests++; return []; } }, fetchLiveSensorReadings: async () => [],
    subscribeToNodes: callback => { handler = callback; return () => {}; },
    DeviceService: { subscribeToDeviceChanges: callback => { handler = callback; return () => {}; }, refreshConnectionAge: value => value },
    useEffect(callback, deps) { if (!previousDeps || deps.some((value, i) => value !== previousDeps[i])) { cleanup?.(); cleanup = callback(); previousDeps = deps; } },
  };
  const context = vm.createContext(globals); vm.runInContext(compile(effect), context); await settle();
  await c.advance(29999); assert.equal(requests, 0); await c.advance(1); assert.equal(requests, 1);
  assert.equal(typeof handler, 'function'); context.settings = { ...context.settings, syncFrequency: 5 };
  vm.runInContext(compile(effect), context); await settle(); await c.advance(4999); assert.equal(requests, 1);
  await c.advance(1); assert.equal(requests, 2); cleanup(); assert.equal(c.timers.size, 0);
});

test('F02 provider clears identity immediately even if every cleanup transport remains pending', async () => {
  const c = clock(), h = hooks(), profile = { id: 'a', name: 'Alice', email: 'a@example.invalid', phone: '', userType: 'staff' };
  const query = evaluate(source('src/services/query-utils.ts'), c);
  const services = { getSavedSession: async () => profile, clearSession: () => new Promise(() => {}),
    supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
    updateStaffOnlineStatus() {}, fetchLiveMaintenanceReports: async () => [], subscribeToStaffMember: () => () => {}, isStaffArchived: () => false };
  const component = evaluate(source('src/context/auth-context.tsx'), { ...c, require(name) {
    if (name === 'react') return h.react; if (name === 'react-native') return { AppState: lifecycle() };
    if (name === '@/services/supabase') return services; if (name === '@/services/query-utils') return query;
    if (name === '@/hooks/use-session-page-snapshot') return { clearSessionPageSnapshots() {}, setSessionPageAccount() {} };
    return { checkAndDispatchMaintenanceReminders() {} };
  } }).AuthProvider;
  const provider = h.mount(() => component({ children: null }).props.value); provider.render(); await settle();
  assert.equal(provider.render().isAuthenticated, true); void provider.render().logout();
  assert.equal(provider.render().isAuthenticated, false); assert.equal(provider.render().userId, ''); provider.dispose();
});

test('F02 local sign-out clears persisted identity before bounded captured-token remote cleanup', async () => {
  const c = clock(), requests = [], key = 'sb-fixture-auth-token';
  const store = new Map([[key, JSON.stringify({ access_token: 'old-jwt', refresh_token: 'old-refresh' })], ['ecotrack_expo_push_token', 'old-push'],
    ['ecotrack_session_user', '{}'], [`${key}-flow-12345678-code-verifier`, 'pkce'], ['ecotrack_staff_pwd_old', 'legacy']]);
  let signedOut = 0;
  const storage = { getItem: async key => store.get(key) ?? null, getAllKeys: async () => [...store.keys()],
    removeItem: async key => { store.delete(key); }, multiRemove: async keys => { keys.forEach(key => store.delete(key)); } };
  const client = { auth: { signOut: async () => { assert.equal(store.has(key), false); signedOut++; } }, rpc: () => new Promise(() => {}) };
  const query = evaluate(source('src/services/query-utils.ts'), c);
  const module = evaluate('let localSignOut = null;\n' + named('src/services/supabase.ts', 'clearSession'), { ...c, ...query,
    AsyncStorage: storage, supabase: client, authStorageKey: key, SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'fixture',
    fetch: (url, options) => { requests.push({ url, options }); return new Promise(() => {}); } });
  let completed = false; void module.clearSession('a').then(() => { completed = true; }); await settle();
  assert.equal(completed, true); assert.equal(signedOut, 1); assert.equal(store.has(key), false);
  assert.equal(store.has(`${key}-flow-12345678-code-verifier`), false); assert.equal(store.has('ecotrack_staff_pwd_old'), false);
  // A second account can immediately persist its session while old cleanup is pending.
  store.set(key, JSON.stringify({ access_token: 'new-jwt', refresh_token: 'new-refresh' }));
  await c.advance(7000); assert.equal(JSON.parse(store.get(key)).access_token, 'new-jwt');
  assert.equal(requests.length, 3); assert(requests.every(request => request.options.headers.Authorization === 'Bearer old-jwt'));
  assert.equal(c.timers.size, 0);
});

test('F02 a stalled SDK initialization/local lock reaches an explicit three-second deadline', async () => {
  const c = clock(), query = evaluate(source('src/services/query-utils.ts'), c);
  const module = evaluate('let localSignOut = null;\n' + named('src/services/supabase.ts', 'clearSession'), { ...c, ...query,
    AsyncStorage: { getItem: async () => null, getAllKeys: async () => [], removeItem: async () => {}, multiRemove: async () => {} },
    supabase: { rpc: () => new Promise(() => {}), auth: { signOut: () => new Promise(() => {}) } }, authStorageKey: 'sb-fixture-auth-token' });
  let completed = false; void module.clearSession('a').then(() => { completed = true; }); await settle();
  assert.equal(completed, false); await c.advance(3000); assert.equal(completed, true);
});

test('F02 installed SDK drops an old pending refresh after logout and a successful second-account login', async () => {
  const { createClient } = require(require.resolve('@supabase/supabase-js', { paths: [root] }));
  const now = Math.floor(Date.now() / 1000), key = 'sb-fixture-auth-token', store = new Map(), pending = deferred();
  const token = subject => [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: subject, exp: now + 3600, iat: now, aud: 'authenticated' })).toString('base64url'), 'fixture'].join('.');
  const session = subject => ({ access_token: token(subject), refresh_token: `${subject}-refresh`, token_type: 'bearer',
    expires_in: 3600, expires_at: now + 3600, user: { id: subject, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
  store.set(key, JSON.stringify(session('old-account')));
  const storage = { getItem: async name => store.get(name) ?? null, setItem: async (name, value) => { store.set(name, value); },
    removeItem: async name => { store.delete(name); }, getAllKeys: async () => [...store.keys()], multiRemove: async names => { names.forEach(name => store.delete(name)); } };
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const requests = [];
  const client = createClient('https://fixture.invalid', 'fixture-key', { auth: { storage, storageKey: key,
    persistSession: true, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes('grant_type=refresh_token')) return pending.promise;
      if (String(url).includes('grant_type=password')) return json(session('new-account'));
      throw new Error(`Unexpected isolated SDK request: ${url}`);
    } } });
  await client.auth.getSession(); let signedOut = 0;
  const { data: { subscription } } = client.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') signedOut++; });
  const oldRefresh = client.auth.refreshSession(); await settle();
  assert.equal(requests.filter(request => request.url.includes('refresh_token')).length, 1);
  const c = clock(), query = evaluate(source('src/services/query-utils.ts'), c);
  const module = evaluate('let localSignOut = null;\n' + named('src/services/supabase.ts', 'clearSession'), { ...c, ...query,
    AsyncStorage: storage, supabase: client, authStorageKey: key, SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'fixture',
    fetch: async () => new Response('{}', { status: 200 }) });
  await module.clearSession('a'); assert.equal(signedOut, 1); assert.equal((await client.auth.getSession()).data.session, null);
  const login = await client.auth.signInWithPassword({ email: 'new@example.invalid', password: 'fixture-password' });
  assert.equal(login.error, null); assert.equal(login.data.user.id, 'new-account');
  pending.resolve(json(session('old-account'))); const late = await oldRefresh;
  assert(late.error, 'SDK must reject a refresh whose persisted subject changed');
  assert.equal((await client.auth.getSession()).data.session.user.id, 'new-account');
  assert.equal(signedOut, 1, 'old remote cleanup must never sign out the new account');
  subscription.unsubscribe(); client.auth.stopAutoRefresh(); await c.advance(7000);
});

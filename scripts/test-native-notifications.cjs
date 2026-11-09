const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Mount the actual banner with controlled native and React boundaries. No screen
// visit, Supabase connection, permission prompt or device notification is needed.
function mount({ os = 'android', expoGo = false, channelError = false, pushRegistration } = {}) {
  const calls = [], effects = [];
  const timers = new Map();
  let incoming, responseListener, bannerListener;
  const native = {
    AndroidImportance: { HIGH: 4 },
    setNotificationHandler: handler => calls.push(['handler', handler]),
    setNotificationChannelAsync: async id => {
      calls.push(['channel', id]);
      if (channelError) throw Error('Native channel setup failed');
    },
    getPermissionsAsync: async () => { calls.push(['permissions']); return { status: 'undetermined' }; },
    requestPermissionsAsync: async () => { calls.push(['request']); return { status: 'granted' }; },
    scheduleNotificationAsync: async request => { calls.push(['schedule', request]); },
    dismissAllNotificationsAsync: async () => { calls.push(['clear-tray']); },
    addNotificationResponseReceivedListener: listener => {
      responseListener = listener; return { remove: () => calls.push(['remove-native']) };
    },
  };
  const react = {
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: current => ({ current }),
    useEffect: effect => effects.push(effect),
  };
  const emitter = {
    trigger: (...args) => { calls.push(['banner', ...args]); bannerListener?.(...args); },
    addListener: listener => { bannerListener = listener; return () => calls.push(['remove-banner']); },
  };
  const mocks = {
    react,
    'react-native': {
      Platform: { OS: os, select: values => values[os] ?? values.default },
      Dimensions: { get: () => ({ width: 400, height: 800 }) },
      Animated: { Value: class { setValue() {} }, spring: () => ({ start() {} }), timing: () => ({ start: done => done?.() }) },
      PanResponder: { create: () => ({}) },
      LogBox: { ignoreLogs() {} },
      StyleSheet: { create: styles => styles, absoluteFillObject: {} },
    },
    'expo-constants': { executionEnvironment: expoGo ? 'store-client' : 'standalone' },
    'expo-notifications': native,
    'expo-splash-screen': { preventAutoHideAsync() {} },
    'expo-router': { router: { push: path => calls.push(['route', path]) } },
    '@/context/auth-context': { useAuth: () => ({ userName: 'Worker', userId: 'synthetic', userType: 'staff', isAuthenticated: !!pushRegistration }) },
    '@/context/settings-context': { useSettings: () => ({ settings: { criticalAlertsEnabled: true, maintenanceRemindersEnabled: true }, triggerHaptic() {} }) },
    '@/utils/notification-emitter': { NotificationEmitter: emitter },
    '@/services/mobile-notifications': {
      registerMobilePushToken: () => pushRegistration(),
      subscribeToIncomingNotifications: (_name, listener) => {
        incoming = listener;
        // Exercise a notification arriving synchronously during subscription setup.
        listener({ title: 'Urgent repair', message: 'Inspect AC', priority: 'high', type: 'urgent_repair' });
        return () => calls.push(['remove-incoming']);
      },
    },
  };
  const module = { exports: {} };
  const source = fs.readFileSync('src/app/_layout.tsx', 'utf8') + '\nexport { GlobalNotificationBanner };';
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(compiled, {
    require: name => name.endsWith('/maintenance-status-alert')
      ? require(path.resolve('supabase/functions/_shared/maintenance-status-alert.ts'))
      : mocks[name] || {}, module, exports: module.exports,
    window: {}, console: { warn() {}, error() {} },
    setTimeout: (callback, delay) => { const id = Symbol(); timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  module.exports.GlobalNotificationBanner();
  const cleanups = effects.map(effect => effect());
  return {
    calls, emit: item => incoming(item), tap: request => responseListener(request),
    settle: () => new Promise(resolve => setImmediate(resolve)),
    expireBanner: () => { for (const [id, timer] of timers) if (timer.delay === 6000) { timers.delete(id); timer.callback(); } },
    cleanup: () => cleanups.forEach(cleanup => cleanup?.()),
  };
}

test('closing the six-second in-app banner preserves Android tray notifications', async () => {
  const h = mount(); await h.settle();
  h.emit({ id: 'new-maintenance', title: 'Assigned maintenance', message: 'Inspect AC' });
  await h.settle();
  assert.ok(h.calls.some(call => call[0] === 'schedule'));
  h.expireBanner();
  assert.equal(h.calls.some(call => call[0] === 'clear-tray'), false);
  h.cleanup();
});

test('a notification during push registration keeps the banner without duplicating remote system delivery',async()=>{
  let resolveRegistration;
  const registered=new Promise(resolve=>{resolveRegistration=resolve;});
  const h=mount({pushRegistration:()=>registered});await h.settle();
  assert.ok(h.calls.some(call=>call[0]==='banner'));assert.equal(h.calls.some(call=>call[0]==='schedule'),false);
  resolveRegistration(true);await h.settle();
  assert.equal(h.calls.some(call=>call[0]==='schedule'),false);h.cleanup();
});

test('Android tray replaces repeat status alerts for the same report and phase', async () => {
  const h = mount();
  const status = (id, relatedReportId, phase) => ({
    id, relatedReportId, type: 'status_update', title: 'Maintenance Status Updated',
    message: `Report ${relatedReportId} at Room 1. Status: ${phase}.`,
  });
  h.emit(status('one', 'MR-1', 'In Progress'));
  h.emit(status('two', 'MR-1', 'In Progress'));
  h.emit(status('three', 'MR-1', 'Completed'));
  h.emit(status('four', 'REP-1', 'In Progress'));
  h.emit({ ...status('urgent', 'MR-1', 'In Progress'), priority: 'high' });
  await h.settle();
  const [first, repeat, completed, other, urgent] = h.calls.filter(call => call[0] === 'schedule').slice(-5).map(call => call[1]);
  assert.equal(first.content.title, 'In Progress · MR-1');
  assert.equal(first.identifier, 'maintenance-status:MR-1:in progress');
  assert.equal(repeat.identifier, first.identifier);
  assert.notEqual(completed.identifier, first.identifier);
  assert.notEqual(other.identifier, first.identifier);
  assert.equal(urgent.identifier, undefined);
  assert.equal(urgent.trigger.channelId, 'alerts');
  h.cleanup();
});

test('native startup configures channels and permissions before the first local notification', async () => {
  const h = mount(); await h.settle();
  assert.ok(h.calls.some(call => call[0] === 'handler'));
  assert.deepEqual(h.calls.filter(call => call[0] === 'channel').map(call => call[1]), ['alerts', 'messages']);
  const scheduled = h.calls.findIndex(call => call[0] === 'schedule');
  assert.ok(h.calls.findIndex(call => call[0] === 'request') < scheduled);
  assert.equal(h.calls[scheduled][1].trigger.channelId, 'alerts');
  assert.equal(h.calls[scheduled][1].content.data.channelId, 'alerts');
  h.emit({ title: 'Task', message: 'Routine check', type: 'maintenance_task' });
  await h.settle();
  assert.equal(h.calls.filter(call => call[0] === 'schedule').at(-1)[1].trigger.channelId, 'messages');
  h.cleanup();
  assert.ok(h.calls.some(call => call[0] === 'remove-native'));
  assert.ok(h.calls.some(call => call[0] === 'remove-incoming'));
});

test('notification taps route using payload data on iOS and Android, retaining legacy channel support', async () => {
  for (const os of ['ios', 'android']) {
    const h = mount({ os }); await h.settle();
    h.tap({ notification: { request: { content: { data: { channelId: 'messages' } } } } });
    h.tap({ notification: { request: { content: { android: { channelId: 'alerts' } } } } });
    assert.deepEqual(h.calls.filter(call => call[0] === 'route').map(call => call[1]), ['/Maintenance', '/notification']);
    if (os === 'ios') assert.equal(h.calls.find(call => call[0] === 'schedule')[1].trigger, null);
    h.cleanup();
  }
});

test('web and Expo Go keep in-app notifications without loading native setup', async () => {
  for (const options of [{ os: 'web' }, { expoGo: true }]) {
    const h = mount(options); await h.settle();
    assert.ok(h.calls.some(call => call[0] === 'banner'));
    assert.ok(!h.calls.some(call => ['handler', 'channel', 'request', 'schedule'].includes(call[0])));
    h.cleanup();
  }
});

test('native channel failures preserve in-app delivery and never schedule without a ready channel', async () => {
  const h = mount({ channelError: true }); await h.settle();
  assert.ok(h.calls.some(call => call[0] === 'banner'));
  assert.ok(!h.calls.some(call => call[0] === 'schedule'));
  h.cleanup();
});

test('unmounting during native setup prevents a late system notification', async () => {
  const h = mount(); h.cleanup(); await h.settle();
  assert.ok(!h.calls.some(call => call[0] === 'schedule'));
});

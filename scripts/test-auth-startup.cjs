'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.ECOTRACK_MOBILE_ROOT || path.resolve(__dirname, '..');
const sourceRoot = process.env.ECOTRACK_MOBILE_STAGE || root;
const ts = require(require.resolve('typescript', { paths: [root] }));
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true };
const transpile = source => ts.transpileModule(source, { compilerOptions }).outputText;
const read = file => fs.readFileSync(path.join(sourceRoot, file), 'utf8');
const savedUser = { id: 'staff-fixture', email: 'staff@example.invalid', name: 'Fixture staff', phone: '', userType: 'staff', avatar: 'default' };

function hooks() {
  const states = [], effects = [], pending = []; let cursor = 0, effectCursor = 0, updates = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    createContext: value => ({ Provider: 'Provider', value }), useContext: context => context.value,
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { updates++; states[index] = value; }];
    },
    useEffect(callback, deps) {
      const index = effectCursor++, previous = effects[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) pending.push(() => {
        previous?.cleanup?.(); effects[index] = { deps, cleanup: callback() };
      });
    }
  };
  return {
    react, render(component, props) { cursor = 0; effectCursor = 0; return component(props); },
    flush() { for (const effect of pending.splice(0)) effect(); },
    unmount() { for (const effect of effects) effect?.cleanup?.(); }, updates: () => updates
  };
}

function providerFixture() {
  const h = hooks(); let resolve, reject, authEvent;
  const timers = new Map();
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const services = {
    getSavedSession: () => pending,
    supabase: { auth: { onAuthStateChange(callback) { authEvent = callback; return { data: { subscription: { unsubscribe() {} } } }; } } },
    fetchLiveMaintenanceReports: async () => [], clearSession: async () => {}, updateStaffOnlineStatus() {},
    subscribeToStaffMember: () => () => {}, isStaffArchived: () => false
  };
  const module = { exports: {} };
  const query = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'src/services/query-utils.ts'), 'utf8')), {
    module: query, exports: query.exports, AbortController,
    setTimeout: fn => { timers.set(1, fn); return 1; }, clearTimeout: id => timers.delete(id)
  });
  const snapshot = { exports: {} };
  vm.runInNewContext(transpile(read('src/hooks/use-session-page-snapshot.ts')), { module:snapshot, exports:snapshot.exports, require:()=>h.react });
  vm.runInNewContext(transpile(read('src/context/auth-context.tsx')), {
    module, exports: module.exports,
    require: name => name === 'react' ? h.react : name === '@/hooks/use-session-page-snapshot' ? snapshot.exports : name === 'react-native' ? { AppState: { addEventListener: () => ({ remove() {} }) } } : name === '@/services/supabase' ? services : name === '@/services/query-utils' ? query.exports : { checkAndDispatchMaintenanceReminders() {} },
    setInterval: () => 1, clearInterval() {}
  });
  const render = () => h.render(module.exports.AuthProvider, { children: null }).props.value;
  const initial = render(); h.flush();
  return { initial, render, resolve, reject, signOut: () => authEvent('SIGNED_OUT'), unmount: h.unmount, updates: h.updates, expire: () => timers.get(1)?.() };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

function navigation(auth) {
  const source = read('src/app/_layout.tsx'), parsed = ts.createSourceFile('_layout.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'NavigationRoot');
  const module = { exports: {} };
  vm.runInNewContext(transpile(fn.getText(parsed) + '\nmodule.exports = NavigationRoot;'), {
    module, exports: module.exports, React: hooks().react, useAuth: () => auth, useSettings: () => ({ effectiveTheme: 'dark' }),
    ThemeProvider: 'ThemeProvider', DarkTheme: {}, DefaultTheme: {}, AnimatedSplashOverlay: 'Splash',
    Stack: 'Dashboard', GlobalNotificationBanner: 'Notifications', AuthScreen: 'Login', ArchivedAccountModal: 'Archive', RemoteLogoutNoticeModal: 'RemoteLogout'
  });
  return module.exports();
}
function find(node, type) {
  if (!node) return null;
  if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean);
  return node.type === type ? node : find(node.props?.children, type);
}

test('startup remains undecided while a saved session is being verified', async () => {
  const app = providerFixture();
  assert.equal(app.initial.isRestoringSession, true); assert.equal(app.initial.isAuthenticated, false);
  await settle(); assert.equal(app.render().isRestoringSession, true);
  app.resolve(savedUser); await settle();
  assert.equal(app.render().isRestoringSession, false); assert.equal(app.render().isAuthenticated, true);
  assert.equal(app.render().userId, savedUser.id);
});

test('no saved session and verification errors finish loading and allow sign-in', async () => {
  for (const failure of [false, true]) {
    const app = providerFixture();
    if (failure) app.reject(new Error('Fixture verification unavailable')); else app.resolve(null);
    await settle(); assert.equal(app.render().isRestoringSession, false); assert.equal(app.render().isAuthenticated, false);
  }
});

test('sign-out during startup cancels a late saved-session result', async () => {
  const app = providerFixture(); app.signOut(); app.resolve(savedUser); await settle();
  assert.equal(app.render().isRestoringSession, false); assert.equal(app.render().isAuthenticated, false); assert.equal(app.render().userId, '');
});

test('unmounted startup cannot update the provider when verification finishes', async () => {
  const app = providerFixture(); app.unmount(); const before = app.updates();
  app.resolve(savedUser); await settle(); assert.equal(app.updates(), before);
});

test('a hung session check reaches the existing read deadline and its late result cannot open the dashboard', async () => {
  const app = providerFixture(); app.expire(); await settle();
  assert.equal(app.render().isRestoringSession, false); assert.equal(app.render().isAuthenticated, false);
  app.resolve(savedUser); await settle(); assert.equal(app.render().isAuthenticated, false);
});

test('navigation shows only splash until verification completes, then selects the correct screen', () => {
  for (const isAuthenticated of [false, true]) {
    const loading = navigation({ isRestoringSession: true, isAuthenticated });
    assert.equal(find(loading, 'Login'), undefined); assert.equal(find(loading, 'Dashboard'), undefined);
    assert.equal(find(loading, 'Splash').props.ready, false);
  }
  const signedOut = navigation({ isRestoringSession: false, isAuthenticated: false });
  assert(find(signedOut, 'Login')); assert.equal(find(signedOut, 'Splash').props.ready, true);
  assert(find(navigation({ isRestoringSession: false, isAuthenticated: true }), 'Dashboard'));
  assert(find(navigation({ isRestoringSession: false, isAuthenticated: true, isArchived: true }), 'Login'));
});

test('splash cannot hide or start its fallback timer before both layout and authentication are ready', async () => {
  const h = hooks(), timers = new Map(); let hideCalls = 0;
  const keyframe = class { duration() { return this; } withCallback() { return this; } };
  const module = { exports: {} };
  vm.runInNewContext(transpile(read('src/components/animated-icon.tsx')), {
    module, exports: module.exports, React: h.react,
    require: name => name === 'react' ? h.react : name === 'react-native' ? { Dimensions: { get: () => ({ height: 800 }) }, StyleSheet: { create: value => value, absoluteFill: {} }, View: 'View' }
      : name === 'expo-image' ? { Image: 'Image' } : name === 'expo-splash-screen' ? { hideAsync: async () => { hideCalls++; } }
      : name === 'react-native-reanimated' ? { __esModule: true, default: { View: 'AnimatedView' }, Easing: { elastic: () => null }, Keyframe: keyframe }
      : name === 'react-native-worklets' ? { scheduleOnRN: fn => fn() } : {},
    setTimeout: (fn, delay) => { timers.set(1, { fn, delay }); return 1; }, clearTimeout: id => timers.delete(id)
  });
  const component = module.exports.AnimatedSplashOverlay;
  let output = h.render(component, { ready: false }); h.flush();
  output.props.onLayout(); await settle();
  output = h.render(component, { ready: false }); h.flush(); await settle();
  assert.equal(hideCalls, 0); assert.equal(timers.size, 0); assert(output);
  h.render(component, { ready: true }); h.flush(); await settle();
  assert.equal(hideCalls, 1); assert.equal(timers.size, 1);
  timers.get(1).fn(); assert.equal(h.render(component, { ready: true }), null);
});

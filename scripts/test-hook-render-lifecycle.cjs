'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real screen lifecycle code with controlled context changes.
// Re-run render-phase adjustments as React does, failing on an update loop.
function lifecycle(file, componentName, stopBefore, fields, context, extraHandlers = []) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === componentName);
  assert.ok(component);
  const body = [];
  for (const statement of component.body.statements) {
    if (statement.getText(source).replace(/\r\n/g, '\n').startsWith(stopBefore)) break;
    body.push(statement.getText(source));
  }
  for (const name of extraHandlers) {
    body.push(component.body.statements.find(node => ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(declaration => declaration.name.getText(source) === name)).getText(source));
  }
  const slots = [];
  let cursor = 0, changed = false;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], update => {
        const next = typeof update === 'function' ? update(slots[index]) : update;
        if (!Object.is(next, slots[index])) { slots[index] = next; changed = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect() {},
    useCallback: callback => callback,
  };
  const module = { exports: {} };
  const code = `function screen() { ${body.join('\n')} return { ${fields} }; } module.exports = screen;`;
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, ...hooks, ...context });
  return () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      cursor = 0; changed = false;
      const output = module.exports();
      if (!changed) return output;
    }
    assert.fail('Screen did not settle after 25 render passes');
  };
}

const presentation = { useSettings: () => ({ effectiveTheme: 'light', colors: {}, settings: {}, triggerHaptic() {} }), themedStyles: { light: {} } };
class AnimatedValue {
  constructor(value) { this.value = value; }
  setValue(value) { this.value = value; }
}

test('maintenance deep links wait for reports and do not replay over manual navigation or refresh', () => {
  let reports = [], params = { repairId: 'REP-1' };
  const parent = { id: 'MR-1', items: [{ linkedRepairId: 'REP-1' }] };
  const repair = { id: 'REP-1', parentReportId: 'MR-1', items: [] };
  const render = lifecycle('src/app/Maintenance.tsx', 'MaintenanceScreen', 'const [expandedItem',
    'currentScreen, selectedReportId, activeRepairId, handleOpenReport', {
      ...presentation, useAuth: () => ({ userId: 'staff', userName: 'Staff' }),
      useLocalSearchParams: () => params,
      useSessionPageSnapshot: () => ({ data: reports, setData() {} }),
      createMaintenanceMutationTracker: () => () => ({}),
    }, ['handleOpenReport']);
  assert.equal(render().currentScreen, 'DASHBOARD');
  reports = [parent, repair];
  let screen = render();
  assert.equal(screen.currentScreen, 'REPAIR');
  assert.equal(screen.selectedReportId, parent.id);
  assert.equal(screen.activeRepairId, repair.id);
  screen.handleOpenReport(repair.id);
  screen = render();
  assert.equal(screen.currentScreen, 'DETAILS');
  assert.equal(screen.selectedReportId, repair.id);
  reports = reports.map(report => ({ ...report }));
  assert.equal(render().selectedReportId, repair.id);
  params = { reportId: parent.id };
  assert.equal(render().selectedReportId, parent.id);
});

test('notification details track live edits and retain the latest record when it leaves the feed', () => {
  let items = [{ id: 'n1', message: 'Original' }];
  const render = lifecycle('src/app/notification.tsx', 'NotificationScreen', 'const [now',
    'selectedNotification, setSelectedNotification', {
      ...presentation, useAuth: () => ({ userId: 'staff', userType: 'staff', isAuthenticated: true }),
      useMobileNotifications: () => ({ items }), Animated: { Value: AnimatedValue }, SCREEN_HEIGHT: 800,
    });
  render().setSelectedNotification(items[0]);
  assert.equal(render().selectedNotification.message, 'Original');
  items = [{ id: 'n1', message: 'Updated', isRead: true }];
  assert.equal(render().selectedNotification.message, 'Updated');
  items = [];
  assert.equal(render().selectedNotification.message, 'Updated');
  render().setSelectedNotification(null);
  assert.equal(render().selectedNotification, null);
});

test('settings reflect loaded preferences, persist user edits, save current values, and reset', async () => {
  const defaults = { theme: 'system', tempUnit: 'C', autoSyncEnabled: true, syncFrequency: 15,
    criticalAlertsEnabled: true, maintenanceRemindersEnabled: true, hapticFeedbackEnabled: true };
  let settings = { ...defaults }, saved;
  const context = {
    ...presentation, useAuth: () => ({ userId: 'staff' }), setTimeout() {},
    useSettings: () => ({ settings, effectiveTheme: 'light', colors: {},
      updateSetting: (key, value) => { settings = { ...settings, [key]: value }; },
      saveAllSettings: async values => { saved = { ...values }; return true; },
      resetDefaults: async () => { settings = { ...defaults }; },
    }),
  };
  const render = lifecycle('src/app/settings.tsx', 'SettingsScreen', 'return (',
    'selectedTheme, tempUnit, autoSyncEnabled, handleThemeChange, handleTempUnitChange, handleAutoSyncToggle, handleSave, handleReset', context);
  assert.equal(render().selectedTheme, 'system');
  settings = { ...settings, theme: 'dark', tempUnit: 'F' };
  assert.equal(render().selectedTheme, 'dark');
  assert.equal(render().tempUnit, 'F');
  render().handleThemeChange('light'); render().handleTempUnitChange('C'); render().handleAutoSyncToggle(false);
  assert.equal(render().selectedTheme, 'light'); assert.equal(render().autoSyncEnabled, false);
  await render().handleSave(); assert.deepEqual(saved, settings);
  await render().handleReset(); assert.equal(render().selectedTheme, 'system'); assert.equal(render().autoSyncEnabled, true);
});

test('banner animations and swipe handlers stay stable across renders and swipes dismiss the banner', () => {
  const Animated = { Value: AnimatedValue, timing: (value, { toValue }) => ({ start(callback) { value.setValue(toValue); callback?.(); } }) };
  const render = lifecycle('src/app/_layout.tsx', 'GlobalNotificationBanner', 'useEffect(() => {\n    let disposed = false;\n    const notificationSetup',
    'visible, setVisible, slideAnim, panX, panResponder, handleBannerLayout', {
      ...presentation, useAuth: () => ({}), Animated, SCREEN_WIDTH: 400, isExpoGo: true,
      PanResponder: { create: callbacks => ({ panHandlers: callbacks }) }, clearTimeout() {},
    });
  const first = render(); first.setVisible(true);
  render().handleBannerLayout();
  const ready = render(); assert.equal(ready.slideAnim, first.slideAnim);
  assert.equal(render().panResponder, ready.panResponder);
  ready.panResponder.panHandlers.onPanResponderRelease({}, { dx: 90, dy: 0, vx: 0, vy: 0 });
  assert.equal(render().visible, false); assert.equal(render().panX.value, 0); assert.equal(render().slideAnim.value, -150);
});

test('web color scheme uses a light server snapshot and the client preference after hydration', () => {
  const module = { exports: {} }; let server = true, scheme = 'dark';
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/hooks/use-color-scheme.web.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { module, exports: module.exports, require: name => name === 'react'
    ? { useSyncExternalStore: (_subscribe, client, ssr) => server ? ssr() : client() }
    : { useColorScheme: () => scheme } });
  assert.equal(module.exports.useColorScheme(), 'light');
  server = false; assert.equal(module.exports.useColorScheme(), 'dark');
  scheme = 'light'; assert.equal(module.exports.useColorScheme(), 'light');
});

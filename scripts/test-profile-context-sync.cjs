const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.createSourceFile('profile.tsx', fs.readFileSync('src/app/profile.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const screen = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.getText(source) === 'ProfileScreen');
assert.ok(screen);
const code = ts.transpileModule(screen.getText(source).replace('export default ', '') + ';exports.render=ProfileScreen;', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : [];
const content = tree => typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? (tree.children || []).map(content).join(' ') : '';

function harness({ settingsSaveResult = true } = {}) {
  const state = [], calls = [], timers = [], palette = { text: '#000', textSecondary: '#555', emerald: '#047857', primaryFill: '#047857' };
  let slot = 0;
  const auth = { userId: 's1', userName: 'Initial worker', userEmail: 'initial@example.test', userPhone: 'initial phone', userRole: 'Worker', userAssignment: 'Room 1, Room 2', userAvatar: 'custom', userCustomPhotoUri: 'saved-image', userType: 'staff' };
  auth.updateUserProfile = (name, role, phone, avatar, uri, email, assignment) => { calls.push({ kind: 'profile', name, role, phone, avatar, uri, email, assignment }); Object.assign(auth, { userName: name, userRole: role, userPhone: phone, userAvatar: avatar, userCustomPhotoUri: uri, userEmail: email, userAssignment: assignment }); };
  const defaults = { theme: 'system', tempUnit: 'C', autoSyncEnabled: true, syncFrequency: 15, criticalAlertsEnabled: true, maintenanceRemindersEnabled: true, hapticFeedbackEnabled: true };
  const context = { settings: { ...defaults }, effectiveTheme: 'light', colors: palette, triggerHaptic() {}, updateSetting(key, value) { calls.push({ kind: 'setting', key, value }); context.settings = { ...context.settings, [key]: value }; }, async resetDefaults() { context.settings = { ...defaults }; }, async saveAllSettings(value) { calls.push({ kind: 'save-settings', value }); return settingsSaveResult; } };
  const global = { exports: {}, React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }) }, useState(initial) { const index = slot++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }]; }, useAuth: () => auth, useSettings: () => context, themedStyles: { light: {}, dark: {} }, UiColors: { light: palette, dark: palette }, Spacing: { one: 4, two: 8, three: 16 }, AVATAR_DEFAULT: 'default-image', AVATAR_MALE: 'male-image', AVATAR_FEMALE: 'female-image', ICON_PENCIL_2D: '', ICON_SETTINGS_2D: '', Platform: { OS: 'android' }, Alert: { alert(...args) { calls.push({ kind: 'alert', args }); } }, console, require: () => 'image', setTimeout: callback => { timers.push(callback); return timers.length; }, updateStaffProfile: async (...args) => { calls.push({ kind: 'save-profile', args }); return true; }, requestUserEmailChange: async () => true, changeUserPassword: async () => { throw Error('No password operation expected'); }, uploadImageToSupabase: async () => 'uploaded-image' };
  const collectTags = node => { if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) global[node.tagName.text] = node.tagName.text; ts.forEachChild(node, collectTags); };
  collectTags(screen);
  vm.runInNewContext(code, global);
  const render = () => { slot = 0; return global.exports.render(); };
  const action = name => { const found = nodes(render()).find(node => node.type === 'Pressable' && node.props.onPress?.name === name); assert.ok(found, name); return found.props.onPress; };
  const input = placeholder => { const found = nodes(render()).find(node => node.type === 'TextInput' && node.props.placeholder === placeholder); assert.ok(found, placeholder); return found; };
  return { auth, context, calls, state, timers, render, action, input };
}

test('profile follows refreshed and cleared saved values while a new edit draft starts from the latest profile', () => {
  const h = harness();
  assert.match(content(h.render()), /Initial worker/);
  h.auth.userName = 'Updated worker'; h.auth.userPhone = ''; h.auth.userCustomPhotoUri = null; h.auth.userAssignment = 'Room 3';
  const html = content(h.render());
  assert.match(html, /Updated worker/); assert.match(html, /Room 3/); assert.doesNotMatch(html, /Initial worker|Room 1|Room 2/);
  h.action('openEditModal')();
  const inputs = nodes(h.render()).filter(node => node.type === 'TextInput');
  assert.ok(inputs.some(node => node.props.value === 'Updated worker'));
  assert.ok(inputs.some(node => node.props.value === ''));
  const images = nodes(h.render()).filter(node => node.type === 'Image');
  assert.equal(images.some(node => node.props.source?.uri === 'saved-image'), false);
});

test('editing keeps a private draft until a confirmed save updates the shared profile', async () => {
  const h = harness(); h.action('openEditModal')();
  let field = nodes(h.render()).find(node => node.type === 'TextInput' && node.props.value === 'Initial worker');
  assert.ok(field); field.props.onChangeText('Saved worker');
  assert.equal(h.auth.userName, 'Initial worker');
  await h.action('saveProfileChanges')();
  assert.equal(h.auth.userName, 'Saved worker');
  assert.match(content(h.render()), /Saved worker/);
  assert.equal(h.calls.filter(call => call.kind === 'save-profile').length, 1);
  assert.equal(h.calls.filter(call => call.kind === 'profile').length, 1);
});

test('settings render directly from their shared values and save the current persisted choices', async () => {
  const h = harness(); h.render();
  h.context.settings = { ...h.context.settings, theme: 'dark', tempUnit: 'F', autoSyncEnabled: false, syncFrequency: 30 };
  const tree = h.render();
  assert.ok(nodes(tree).filter(node => node.type === 'Switch').some(node => node.props.value === false));
  const handler = nodes(tree).find(node => node.type === 'Pressable' && /Celsius/.test(content(node)))?.props.onPress;
  assert.ok(handler); handler();
  assert.equal(h.context.settings.tempUnit, 'C');
  await h.action('handleSaveSettings')();
  const saved = h.calls.find(call => call.kind === 'save-settings').value;
  assert.equal(saved.theme, 'dark'); assert.equal(saved.tempUnit, 'C'); assert.equal(saved.syncFrequency, 30); assert.equal(saved.autoSyncEnabled, false);
});

test('a failed settings persistence receipt cannot display success or close the settings dialog', async () => {
  const h = harness({ settingsSaveResult: false }); h.render();
  await h.action('handleSaveSettings')();
  assert.equal(h.timers.length, 0);
  assert.ok(h.calls.some(call => call.kind === 'alert' && call.args[0] === 'Unable to save settings'));
  assert.doesNotMatch(content(h.render()), /Settings saved successfully/);
});

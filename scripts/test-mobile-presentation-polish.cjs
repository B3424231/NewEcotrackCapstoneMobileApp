const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const SSR = require('react-dom/server');
const Web = require('react-native-web');

// Render the actual components using the existing isolated visual-fixture loader.
const visualSource = fs.readFileSync('scripts/render-temperature-rotation-fixtures.cjs', 'utf8');
const visualContext = { require, console, exports: {} };
vm.runInNewContext(visualSource.slice(0, visualSource.indexOf('const Picker=')) + ';exports.load=load;exports.setTheme=value=>{theme=value;};', visualContext);
const Card = visualContext.exports.load('src/components/sensor-card.tsx').AcControllerCard;
const Details = visualContext.exports.load('src/components/sensor-detail-sheet.tsx').AcControllerDetailSheet;
const fixture = { id: 'n1', name: 'Room device', deviceMode: 'both', connectionState: 'online', battery: '85%', ventTemp: '24.5 °C', rotation_rpm: 75.5, rotation_quality: 'ok', associatedAc: 'UNWANTED_MODEL_SENTINEL', acType: 'UNWANTED_TYPE_SENTINEL', setpoint: 16, powerSetting: 'on', operatingMode: 'cool', fanMode: 'auto', specialFunctions: ['Vertical swing', 'Horizontal swing', 'Display', 'Turbo'] };
const render = (Component, item) => SSR.renderToStaticMarkup(React.createElement(Component, { controller: item, visible: true, onPress() {}, onClose() {}, slideAnim: new Web.Animated.Value(0) }));

test('cards and detail modals replace special functions with Aircon state and omit the removed standalone panels', () => {
  for (const theme of ['light', 'dark']) {
    visualContext.exports.setTheme(theme);
    for (const deviceMode of ['monitoring', 'both', 'controller']) for (const Component of [Card, Details]) {
      const html = render(Component, { ...fixture, deviceMode });
      assert.doesNotMatch(html, /Target setpoint|UNWANTED_MODEL_SENTINEL|UNWANTED_TYPE_SENTINEL|>Power<|>Mode<|>Fan<|Operating mode|Blower fan|Horizontal swing|>Display</);
      assert.doesNotMatch(html, /Special functions|Vertical swing|Turbo/);
      assert.match(html, /Aircon state/);
      assert.match(html, /Not reported/);
      assert.match(html, /Maintenance Checklist/);
      if (deviceMode !== 'controller') { assert.match(html, /Air pressure/); assert.match(html, /75.5 RPM/); assert.match(html, /24.5 °C/); }
      else assert.doesNotMatch(html, /75.5 RPM|Air pressure/);
      assert.doesNotMatch(html, /Rotation speed|75.5 Pa|75.5 kPa/);
    }
  }
});

test('Aircon state displays only observed operating-mode labels and explicit observed Off', () => {
  const modes = [['cool', 'Cold'], ['fan', 'Fan Only'], ['fan_only', 'Fan Only'], ['heat', 'Heat']];
  const states = modes.flatMap(([mode, label]) => [
    [{ reported_state: { power: true, mode, temp: 22, fan: 'high' }, reported_at: '2026-10-11T08:00:00Z' }, label],
    [{ observed_remote_state: { power: true, mode, temp: 22, fan: 'high' }, observed_remote_at: '2026-10-11T08:00:00Z' }, label],
  ]);
  states.push([{ reported_state: { power: false, mode: 'cool' } }, 'Off']);
  states.push([{ observed_remote_state: { power: false, mode: 'heat' } }, 'Off']);
  for (const [settingsSnapshot, label] of states) for (const Component of [Card, Details]) {
    const item = { ...fixture, settingsSnapshot };
    const before = JSON.stringify(item);
    const html = render(Component, item);
    assert.match(html, new RegExp('>' + label + '<'));
    assert.doesNotMatch(html, /Special functions|Vertical swing|Horizontal swing|Turbo|>Display<|Requested ·|Configured ·|Remote ·|Reported ·|HIGH FAN|22.0 °C/);
    assert.equal(JSON.stringify(item), before);
  }
});

test('observations alone determine mode while newer requests and configured defaults cannot override them', () => {
  for (const Component of [Card, Details]) {
    const observed = render(Component, { ...fixture, settingsSnapshot: {
      desired_state: { power: false, mode: 'heat' }, commanded_at: '2026-10-11T08:10:00Z',
      configured_state: { power: false, mode: 'dry' },
      observed_remote_state: { power: true, mode: 'cool' }, observed_remote_at: '2026-10-11T08:01:00Z',
    } });
    assert.match(observed, />Cold</); assert.doesNotMatch(observed, />Heat<|>Dry<|>Off</);
    const latest = render(Component, { ...fixture, settingsSnapshot: {
      observed_remote_state: { power: true, mode: 'heat' }, observed_remote_at: '2026-10-11T08:00:00Z',
      reported_state: { power: true, mode: 'fan' }, reported_at: '2026-10-11T08:01:00Z',
    } });
    assert.match(latest, />Fan Only</); assert.doesNotMatch(latest, />Heat</);
    for (const settingsSnapshot of [undefined, {}, { desired_state: { power: false, mode: 'cool' } }, { configured_state: { power: false, mode: 'heat' } }, { observed_remote_state: { turbo: true, swing: true } }, { reported_state: { power: true, temp: 15, fan: 'high' } }, { reported_state: { mode: 'unsupported' } }, { reported_state: { power: true, mode: 'auto' } }, { observed_remote_state: { power: true, mode: 'dry' } }]) {
      const noState = render(Component, { ...fixture, settingsSnapshot, powerSetting: 'off', operatingMode: 'cool', setpoint: 16, connectionState: 'offline', rotation_rpm: 1000 });
      assert.match(noState, /Not reported/);
      assert.doesNotMatch(noState, />Cold<|>Fan Only<|>Heat<|>Off<|>Auto<|>Dry<|15.0 °C|HIGH FAN/);
    }
  }
});

test('phone routes and UI components expose no AC command actions while device setup remains available', () => {
  for (const directory of ['src/app', 'src/components']) for (const relative of fs.readdirSync(directory, { recursive: true }).filter(file => /\.(?:ts|tsx)$/.test(file))) {
    const file = directory + '/' + relative, source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\.(?:dispatchIntent|saveDesiredState)\s*\(/, file);
    assert.doesNotMatch(source, /['"]ac_intent['"]/, file);
  }
  assert.match(fs.readFileSync('src/app/explore.tsx', 'utf8'), /<Redirect href="\/"/);
  assert.match(fs.readFileSync('src/app/devices.tsx', 'utf8'), /DeviceService\.registerController\(/);
  const picker = fs.readFileSync('src/components/ac-device-type-picker.tsx', 'utf8');
  assert.match(picker, /value:'monitoring',label:'Monitoring Only'/);
  assert.match(picker, /value:'both',label:'Monitoring and Controlling'/);
  assert.doesNotMatch(picker, /label:'Control Only'/);
});

test('requested Air pressure presentation retains measured RPM and truthful missing states', () => {
  for (const Component of [Card, Details]) {
    assert.match(render(Component, { ...fixture, rotation_rpm: 0 }), /0.0 RPM/);
    const missing = render(Component, { ...fixture, rotation_rpm: null, ventTemp: undefined });
    assert.match(missing, /Air pressure/);
    assert.match(missing, /Unavailable/);
    assert.doesNotMatch(missing, /0.0 RPM/);
    assert.doesNotMatch(render(Component, { ...fixture, specialFunctions: ['Horizontal swing', 'Display'] }), /Horizontal swing|>Display</);
  }
  const index = fs.readFileSync('src/app/index.tsx', 'utf8');
  assert.match(index, /Assigned AC Device/);
  assert.doesNotMatch(index, /ASSIGNED AC CONTROLLER DEVICES/);
});

const profileText = fs.readFileSync('src/app/profile.tsx', 'utf8');
const profileSource = ts.createSourceFile('profile.tsx', profileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const findNodes = predicate => { const found = []; const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }; visit(profileSource); return found; };
const fields = findNodes(node => ts.isJsxElement(node) && node.openingElement.attributes.getText(profileSource).includes('styles.inputGroup') && /<ThemedText[^>]*>\s*(Old|New|Confirm) Password<\/ThemedText>/.test(node.getText(profileSource)));

test('Old, New and Confirm Password have independent accessible show/hide eyes with masked defaults', () => {
  assert.equal(fields.length, 3);
  for (const [index, field] of fields.entries()) {
    const label = ['old', 'new', 'confirm'][index], flags = { showOldPwd: false, showNewPwd: false, showConfirmPwd: false };
    const context = { exports: {}, React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }) }, View: 'View', TextInput: 'TextInput', ThemedText: 'Text', Pressable: 'Button', AppIcon: 'Icon', styles: new Proxy({}, { get: () => ({}) }), isDark: false, pwdFocusedField: null, pwdOld: 'fixture-old', pwdNew: 'fixture-new', pwdConfirm: 'fixture-new', pwdError: null, ...flags };
    for (const [key, flag] of [['setShowOldPwd', 'showOldPwd'], ['setShowNewPwd', 'showNewPwd'], ['setShowConfirmPwd', 'showConfirmPwd']]) context[key] = updater => { context[flag] = updater(context[flag]); };
    const code = ts.transpileModule('exports.render=()=>(' + field.getText(profileSource) + ');', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
    vm.runInNewContext(code, context);
    const nodes = tree => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : [];
    for (const shown of [false, true, false]) {
      const tree = nodes(context.exports.render()), input = tree.find(node => node.type === 'TextInput'), button = tree.find(node => node.type === 'Button'), icon = tree.find(node => node.type === 'Icon');
      assert.equal(input.props.secureTextEntry, !shown);
      assert.equal(input.props.autoCorrect, false);
      assert.equal(button.props.accessibilityRole, 'button');
      assert.equal(button.props.accessibilityLabel, `${shown ? 'Hide' : 'Show'} ${label} password`);
      assert.equal(button.props.accessibilityState.selected, shown);
      assert.equal(icon.props.name, shown ? 'eye-off' : 'eye');
      assert.equal(input.props.value, label === 'old' ? 'fixture-old' : 'fixture-new');
      button.props.onPress();
    }
    const active = ['showOldPwd', 'showNewPwd', 'showConfirmPwd'][index];
    for (const key of Object.keys(flags).filter(key => key !== active)) assert.equal(context[key], false);
  }
  for (const name of ['showOldPwd', 'showNewPwd', 'showConfirmPwd']) assert.match(profileText, new RegExp(`\\[${name},[^\\]]+\\] = useState\\(false\\)`));
  const opening = findNodes(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(profileSource) === 'Pressable' && node.openingElement.attributes.getText(profileSource).includes('setChangePwdModalVisible(true)'))[0];
  assert.ok(opening);
  for (const setter of ['setShowOldPwd', 'setShowNewPwd', 'setShowConfirmPwd']) assert.match(opening.getText(profileSource), new RegExp(setter + '\\(false\\)'));
});

'use strict';
// Render the production JSX/styles with isolated profile data, without a native build.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const React = require('react'), Web = require('react-native-web'), SSR = require('react-dom/server'), ts = require('typescript');
const { chromium } = require('C:/Users/reygay/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'reports/notification-release-20261103/mobile-ui');
fs.mkdirSync(out, { recursive: true });
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const asset = name => 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'assets/images', name)).toString('base64');
const Image = ({ source, style }) => React.createElement(Web.Image, { source: { uri: typeof source === 'string' ? source : source.uri }, style });
const themeModule = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/constants/theme.ts'), 'utf8')), { module: themeModule, exports: themeModule.exports, require: name => name === 'react-native' ? Web : {} });
const theme = themeModule.exports;
const home = fs.readFileSync(path.join(root, 'src/app/index.tsx'), 'utf8');
const parsed = ts.createSourceFile('index.tsx', home, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let profile;
function visit(node) { if (ts.isJsxElement(node) && node.openingElement.attributes.getText(parsed).includes('styles.userProfileCard,')) profile = node.getText(parsed); ts.forEachChild(node, visit); }
visit(parsed); assert(profile);
const createStyles = parsed.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === 'createStyles')).getText(parsed);
const styleModule = { exports: {} };
vm.runInNewContext(compile(createStyles + '\nmodule.exports=createStyles;'), { module: styleModule, exports: styleModule.exports, ...theme, StyleSheet: Web.StyleSheet, Platform: Web.Platform, SCREEN_HEIGHT: 844, SCREEN_WIDTH: 390 });
const splashModule = { exports: {} };
class Keyframe { duration() { return this; } withCallback() { return this; } }
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/components/animated-icon.tsx'), 'utf8')), {
  module: splashModule, exports: splashModule.exports, React,
  require: name => name === 'react' ? React : name === 'react-native' ? Web : name === 'expo-image' ? { Image }
    : name === 'react-native-reanimated' ? { __esModule: true, default: { View: Web.View }, Easing: { elastic() {} }, Keyframe }
    : name.includes('ecoTrack.png') ? asset('ecoTrack.png') : {},
});

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const checks = [];
  try {
    for (const effectiveTheme of ['light', 'dark']) {
      const colors = theme.Colors[effectiveTheme], module = { exports: {} };
      vm.runInNewContext(compile('function ProfileFixture(){return (' + profile + ')};module.exports=ProfileFixture;'), {
        module, exports: module.exports, React, View: Web.View, Image, ThemedText: Web.Text,
        LocationIcon: () => React.createElement(Web.Text, { style: { color: colors.emerald } }, '•'),
        styles: styleModule.exports(colors), colors, UiColors: theme.Colors, effectiveTheme,
        getAvatarSource: () => asset('avatar_default.png'), userAvatar: 'default', userCustomPhotoUri: null,
        userName: 'Fixture Technician', userRole: 'HVAC / AIRCON TECHNICIAN', userPhone: '—',
        loading: false, assignmentInfo: {}, userAssignment: 'IC building • Floor 1 • Room 1',
      });
      for (const kind of ['profile', 'startup']) {
        const Component = kind === 'profile' ? module.exports : splashModule.exports.AnimatedSplashOverlay;
        const Fixture = () => React.createElement(Web.View, { style: { position: 'relative', width: 390, height: 844, padding: kind === 'profile' ? 24 : 0, paddingTop: kind === 'profile' ? 100 : 0, backgroundColor: colors.background } }, React.createElement(Component, { ready: false }));
        const key = kind + effectiveTheme;
        Web.AppRegistry.registerComponent(key, () => Fixture);
        const app = Web.AppRegistry.getApplication(key);
        const html = '<!doctype html><meta charset="utf-8">' + SSR.renderToStaticMarkup(app.getStyleElement()) + '<style>html,body{margin:0}</style>' + SSR.renderToStaticMarkup(app.element);
        fs.writeFileSync(path.join(out, key + '.html'), html);
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
        await page.setContent(html); await page.locator('img').first().waitFor();
        if (kind === 'startup') {
          const logo = await page.locator('img').first().boundingBox();
          const bar = await page.getByRole('progressbar', { name: 'Loading EcoTrack' }).boundingBox();
          assert(logo && bar && bar.y > logo.y + logo.height);
          assert(Math.abs((logo.x + logo.width / 2) - (bar.x + bar.width / 2)) < 1);
        } else {
          const avatar = await page.locator('img').first().boundingBox();
          const badge = await page.getByLabel('Online', { exact: true }).boundingBox();
          assert(badge && avatar && badge.y > avatar.y + avatar.height / 2 && badge.width < avatar.width / 4);
        }
        await page.screenshot({ path: path.join(out, key + '.png') }); await page.close();
        checks.push(`${effectiveTheme} ${kind}: production JSX rendered and requested placement verified`);
      }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ status: 'PASS', checks, liveRequests: 0, nativeBuild: false }, null, 2));
  console.log(checks.join('\n'));
})().catch(error => { console.error(error); process.exitCode = 1; });

// Isolated real JSX/styles with synthetic battery observations; no live services.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const React = require('react'), SSR = require('react-dom/server'), Web = require('react-native-web');
const out = path.resolve('artifacts/battery-charging-20261103');
fs.mkdirSync(out, { recursive: true });
const source = fs.readFileSync('scripts/render-temperature-rotation-fixtures.cjs', 'utf8');
const loader = source.slice(0, source.indexOf('const Picker=')).replace(/^const out=.*\r?\n/m, '').replace("if(name==='react')", "if(name==='@/services/airflow-pressure')return load('src/services/airflow-pressure.ts');if(name==='@/services/supabase')return {supabase:{}};if(name==='@/context/auth-context')return {useAuth:()=>({userType:'staff',userId:'fixture'})};if(name==='react')");
const context = { require, console, exports: {} };
vm.runInNewContext(loader + ';exports.load=load;exports.setTheme=value=>{theme=value;};', context);
const Card = context.exports.load('src/components/sensor-card.tsx').AcControllerCard;
const Detail = context.exports.load('src/components/sensor-detail-sheet.tsx').AcControllerDetailSheet;
const base = { id: 'fixture', name: 'Room 1 AC device', room: 'Room 1', building: 'Main Building', floor: 'Floor 1', deviceMode: 'both', connectionState: 'online', battery: '4%',
  setpoint: 24, ventTemp: '24.0 °C', rotation_rpm: 800, rotation_quality: 'ok', status: 'optimal',
  batteryState: { percent: 4, voltage: 3.4, charging: true, chargeState: 'charging', observedAt: new Date().toISOString(), source: 'mock', capacityMah: 5200 } };
const variants = [base,
  { ...base, battery: '100%', batteryState: { ...base.batteryState, percent: 100, charging: false, chargeState: 'full' } },
  { ...base, battery: '20%', batteryState: { ...base.batteryState, percent: 20, charging: false, chargeState: 'discharging' } },
  { ...base, connectionState: 'offline' },
];
const pages = [];
for (const theme of ['light', 'dark']) for (const width of [320, 390]) for (const kind of ['cards', 'details']) {
  context.exports.setTheme(theme);
  const key = `battery-${kind}-${theme}-${width}`;
  const colors = context.exports.load('src/constants/theme.ts').Colors[theme];
  const contents = kind === 'cards' ? variants.map((controller, index) => React.createElement(Card, { key: index, controller, onPress() {} }))
    : React.createElement(Detail, { visible: true, controller: base, onClose() {}, slideAnim: new Web.Animated.Value(0) });
  Web.AppRegistry.registerComponent(key, () => () => React.createElement(Web.View, { style: { width, minHeight: 844, height: kind === 'details' ? 844 : undefined, backgroundColor: colors.background, padding: kind === 'cards' ? 12 : 0 } }, contents));
  const app = Web.AppRegistry.getApplication(key);
  fs.writeFileSync(path.join(out, key + '.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + key + '</title>' + SSR.renderToStaticMarkup(app.getStyleElement()) + '<style>html,body{margin:0}*{box-sizing:border-box}</style></head><body>' + SSR.renderToStaticMarkup(app.element) + '</body></html>');
  pages.push({ name: key, width, kind });
}
fs.writeFileSync(path.join(out, 'fixtures.json'), JSON.stringify(pages, null, 2));
console.log(JSON.stringify({ out, pages: pages.length }));
if (process.argv.includes('--screenshots')) (async () => {
  const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = [];
  try {
    for (const fixture of pages) {
      const page = await browser.newPage({ viewport: { width: fixture.width, height: 844 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(require('node:url').pathToFileURL(path.join(out, fixture.name + '.html')).href);
      await page.getByText('Charging', { exact: false }).first().waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow || errors.length) throw Error(JSON.stringify({ fixture, overflow, errors }));
      await page.screenshot({ path: path.join(out, fixture.name + '.png'), fullPage: true });
      results.push({ fixture: fixture.name, overflow, errors }); await page.close();
    }
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ screenshots: results.length, overflow: false, pageErrors: 0 }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

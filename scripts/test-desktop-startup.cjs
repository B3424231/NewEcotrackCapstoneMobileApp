const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(process.env.ECOTRACK_DESKTOP_MAIN_SOURCE || path.resolve('../EcoTrackDesktopDashboardNew-main-control/src/main.js'), 'utf8');

function startup(lock = true) {
  const events = [], windows = [], ipc = new Map(), app = new EventEmitter();
  let ready = false;
  Object.assign(app, {
    requestSingleInstanceLock() { events.push('lock'); return lock; },
    isReady: () => ready,
    quit() { events.push('quit'); },
    exit(code) { events.push('exit:' + code); },
    focus() { events.push('app-focus'); },
    commandLine: { appendSwitch() { events.push('switch'); } },
    setAppUserModelId() {},
    setPath() { throw Error('Do not redirect persistent storage to fix a duplicate process'); }
  });
  class BrowserWindow extends EventEmitter {
    constructor() {
      super(); events.push('window'); windows.push(this);
      this.destroyed = false; this.minimized = false; this.visible = true; this.focusCount = 0; this.urls = [];
      this.webContents = new EventEmitter(); this.webContents.session = { setBluetoothPairingHandler() {} }; this.webContents.setWindowOpenHandler = () => {};
    }
    loadURL(url) { this.urls.push(url); }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return this.minimized; }
    isVisible() { return this.visible; }
    restore() { this.minimized = false; events.push('restore'); }
    show() { this.visible = true; events.push('show'); }
    setAlwaysOnTop() {}
    focus() { this.focusCount++; }
    flashFrame() {}
    close() { this.destroyed = true; this.emit('closed'); }
  }
  const storage = new Proxy({}, { get() { throw Error('Startup must not modify or erase persistent storage'); } });
  const modules = { '../public/js/provisioning-errors.js': require(path.resolve('../EcoTrackDesktopDashboardNew-main-control/public/js/provisioning-errors.js')),
    fs: storage, path, child_process: { execFile() {} }, dotenv: { config() {} }, 'electron-is-dev': false,
    electron: { app, BrowserWindow, Menu: { setApplicationMenu() {} }, shell: {}, ipcMain: {
      on(name, handler) { ipc.set('on:' + name, handler); }, handle(name, handler) { ipc.set(name, handler); }
    } }, ws: class {} };
  vm.runInNewContext(source, { require: name => {
    if (!Object.hasOwn(modules, name)) throw Error('Unexpected startup module: ' + name);
    return modules[name];
  }, __dirname: path.resolve('../EcoTrackDesktopDashboardNew-main-control/src'), console, Buffer, process: { platform: 'win32', env: {} } });
  return { app, events, windows, ipc, ready() { ready = true; app.emit('ready'); } };
}

test('startup acquires the shared profile lock before creating any browser window', () => {
  const s = startup(); assert.equal(s.events[0], 'lock'); assert.equal(s.windows.length, 0);
  s.ready(); assert.equal(s.windows.length, 1);
});

test('a duplicate process exits without creating a window, including delayed ready or focus IPC', async () => {
  const s = startup(false); assert.deepEqual(s.events.filter(event => event.startsWith('exit:')), ['exit:0']);
  assert.ok(!s.events.includes('quit'), 'A duplicate exits before normal shutdown can initialize shared caches');
  s.ready(); s.app.emit('activate'); s.app.emit('second-instance');
  s.ipc.get('on:focus-window')(); await s.ipc.get('focus-window')();
  assert.equal(s.windows.length, 0); assert.equal(s.app.listenerCount('second-instance'), 0);
});

test('launching again restores and focuses the original window without reloading its page', () => {
  const s = startup(); s.ready(); const original = s.windows[0];
  original.minimized = true; original.visible = false;
  s.app.emit('second-instance');
  assert.equal(s.windows.length, 1); assert.equal(original.minimized, false); assert.equal(original.visible, true);
  assert.equal(original.focusCount, 1); assert.equal(original.urls.length, 1);
});

test('early focus events cannot create a browser window before Electron is ready', async () => {
  const s = startup(); s.app.emit('second-instance'); s.app.emit('activate');
  await s.ipc.get('focus-window')(); assert.equal(s.windows.length, 0);
  s.ready(); assert.equal(s.windows.length, 1);
});

test('activation and repeated ready events reuse the current window and replace a closed window', () => {
  const s = startup(); s.ready(); s.ready(); s.app.emit('activate');
  assert.equal(s.windows.length, 1);
  s.windows[0].close(); s.app.emit('activate'); assert.equal(s.windows.length, 2);
  s.windows[1].destroyed = true; s.app.emit('second-instance'); assert.equal(s.windows.length, 3);
});

test('the primary app keeps its protected maintenance IPC handlers and Windows close behavior', () => {
  const s = startup(); s.ready();
  for (const name of ['maintenance-fetch-reports', 'scheduler-fetch-data', 'locations-fetch-all', 'rules-fetch-data', 'notifications-fetch-today']) assert.equal(typeof s.ipc.get(name), 'function', name);
  s.app.emit('window-all-closed'); assert.ok(s.events.includes('quit'));
});

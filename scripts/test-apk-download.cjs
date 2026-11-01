'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const { createApkDownloadServer } = require('./serve-ecotrack-apk.cjs');

test('installer download supplies the EcoTrack filename and exposes only the installer route', async () => {
  const server = createApkDownloadServer(__filename);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const head = await fetch(base + '/EcoTrack.apk', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), 'application/vnd.android.package-archive');
    assert.match(head.headers.get('content-disposition'), /filename="EcoTrack.apk"/);
    assert.ok(Number(head.headers.get('content-length')) > 0);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const get = await fetch(base + '/EcoTrack.apk');
    assert.match(await get.text(), /installer download supplies/);
    assert.equal((await fetch(base + '/package.json')).status, 404);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/EcoTrack.apk', { method: 'POST' })).status, 405);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  const missing = createApkDownloadServer(path.join(__dirname, 'not-an-apk'));
  missing.listen(0, '127.0.0.1'); await once(missing, 'listening');
  try { assert.equal((await fetch(`http://127.0.0.1:${missing.address().port}/EcoTrack.apk`)).status, 404); }
  finally { missing.closeAllConnections(); await new Promise(resolve => missing.close(resolve)); }
});

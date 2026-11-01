'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Share only the named installer, never a directory containing source or credentials.
function createApkDownloadServer(apkPath) {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    if (pathname !== '/EcoTrack.apk') { response.writeHead(404); response.end(); return; }
    fs.stat(apkPath, (error, stat) => {
      if (error || !stat.isFile()) { response.writeHead(404); response.end('EcoTrack installer is not ready.'); return; }
      response.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="EcoTrack.apk"; filename*=UTF-8\'\'EcoTrack.apk',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = fs.createReadStream(apkPath);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    });
  });
}

if (require.main === module) {
  const apkPath = path.resolve(__dirname, '../artifacts/EcoTrack.apk');
  if (!fs.existsSync(apkPath)) throw Error('Build and save artifacts/EcoTrack.apk before serving the download.');
  const host = process.env.ECOTRACK_APK_HOST || '127.0.0.1';
  const port = Number(process.env.ECOTRACK_APK_PORT || 8795);
  const server = createApkDownloadServer(apkPath);
  server.listen(port, host, () => console.log(`EcoTrack download: http://${host}:${port}/EcoTrack.apk`));
}
module.exports = { createApkDownloadServer };

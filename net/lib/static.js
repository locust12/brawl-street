// Serves the built game (index.html + assets/) from one folder. Nothing else in the folder is reachable.
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, dir) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { return send(res, 400, 'bad request'); }
  if (p === '/' || p === '/index.html' || p === '/online' || p === '/play') p = '/index.html';
  else if (!p.startsWith('/assets/')) return send(res, 404, 'not found');
  const file = path.join(dir, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(path.join(dir, path.sep)) || file.includes('\0')) return send(res, 404, 'not found');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found');
    const etag = '"' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
    const headers = {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': p === '/index.html' ? 'no-cache' : 'public, max-age=3600',
      ETag: etag, 'Last-Modified': st.mtime.toUTCString(), 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    let start = 0, end = st.size - 1, code = 200;
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = +range[1]; if (range[2]) end = Math.min(end, +range[2]); }
      else { start = Math.max(0, st.size - +range[2]); }
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      code = 206; headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(code, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  });
}

function send(res, code, text) { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); }

module.exports = { serveStatic, send };

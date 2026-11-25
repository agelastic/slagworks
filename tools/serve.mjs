// Static file server for development and tests. No caching.
//
//   node tools/serve.mjs [port]        serves the project root (default port 8080) on all interfaces
//   const s = await startServer(root, 0)   -> { port, url, close() }   (port 0 = ephemeral, 127.0.0.1)

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

export function startServer(root, port = 0, host = '127.0.0.1') {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, {
        'Content-Type': type,
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return send(400, 'text/plain; charset=utf-8', Buffer.from('bad request'));
    }
    let file = path.join(base, rel);
    if (file !== base && !file.startsWith(base + path.sep)) {
      return send(403, 'text/plain; charset=utf-8', Buffer.from('forbidden'));
    }
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) file = path.join(file, 'index.html');
      fs.readFile(file, (err2, body) => {
        if (err2) return send(404, 'text/plain; charset=utf-8', Buffer.from(`not found: ${rel}`));
        send(200, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', body);
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${actual}/`,
        close: () => new Promise((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const port = Number(process.argv[2] ?? 8080);
  const s = await startServer(root, port, '0.0.0.0');
  console.log(`serving ${root}`);
  console.log(`  ${s.url}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${s.port}/  (same network, e.g. a phone)`);
    }
  }
}

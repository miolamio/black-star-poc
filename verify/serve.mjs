#!/usr/bin/env node
// Zero-dependency static file server for local development and verification.
//   node verify/serve.mjs [port] [root]
// Serves with correct MIME types for ES modules; never caches (Cache-Control: no-store).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

export function createServer(root) {
  root = path.resolve(root);
  return http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const filePath = path.normalize(path.join(root, pathname));
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found: ' + pathname);
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Content-Length': stat.size,
          'Cache-Control': 'no-store',
          'Cross-Origin-Opener-Policy': 'same-origin',
        });
        fs.createReadStream(filePath).pipe(res);
      });
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
}

export function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.argv[2] || 8080);
  const root = process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const server = createServer(root);
  listen(server, port).then((p) => {
    console.log(`GARGANTUA static server: http://127.0.0.1:${p}/  (root: ${path.resolve(root)})`);
  });
}

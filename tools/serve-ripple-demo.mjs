#!/usr/bin/env node
// AGPL-3.0. Standalone preview only; never connects to the installed Hana App.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lab = path.join(repo, 'docs/player-ui/ripple-lab-layers.html');
const cover = path.join(repo, 'docs/player-ui/assets/hanaichimonme-cover.jpg');

export function createRippleDemoServer({ audio, lyrics } = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (url.pathname === '/demo/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ audio: !!audio, lyrics: !!lyrics }));
      return;
    }
    const routes = {
      '/': [lab, 'text/html; charset=utf-8'],
      '/lab': [lab, 'text/html; charset=utf-8'],
      '/assets/hanaichimonme-cover.jpg': [cover, 'image/jpeg'],
      '/demo/song.m4a': [audio, 'audio/mp4'],
      '/demo/lyrics': [lyrics, 'text/plain; charset=utf-8']
    };
    const entry = routes[url.pathname];
    if (!entry || !entry[0]) { res.writeHead(404); res.end('Not found'); return; }
    fs.stat(entry[0], (error, stat) => {
      if (error || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
      let start = 0, end = stat.size - 1, status = 200;
      if (req.headers.range) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        if (!m || Number(m[1]) >= stat.size || (m[2] && Number(m[2]) < Number(m[1]))) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return;
        }
        start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), end) : end; status = 206;
      }
      const headers = { 'Content-Type': entry[1], 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' };
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      res.writeHead(status, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = fs.createReadStream(entry[0], { start, end });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = key => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; };
  const audio = value('--audio'), lyrics = value('--lyrics'), port = Number(value('--port') || 8146);
  for (const file of [audio, lyrics].filter(Boolean)) {
    if (!fs.statSync(file).isFile()) throw new Error(`Not a file: ${file}`);
  }
  const server = createRippleDemoServer({ audio, lyrics });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Ripple preview: http://127.0.0.1:${server.address().port}/`));
  const close = () => server.close(() => process.exit(0));
  process.on('SIGINT', close); process.on('SIGTERM', close);
}

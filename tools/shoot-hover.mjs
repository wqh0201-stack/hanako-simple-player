#!/usr/bin/env node
/* 悬停抬升（发光）· 目视检查用的小脚本（开发用，不进验收）
 * 起本地服务 + puppeteer，真悬停每个按钮，深浅两套各出一张对比图。
 * 用法：node tools/shoot-hover.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE || '/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = path.join(repo, 'ui');
const outDir = process.env.OUT_DIR || '/tmp/hap-hover';
fs.mkdirSync(outDir, { recursive: true });

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const routes = {
      '/api/apps/hanako-audio-player/routes/playlist/load': { tracks: [] },
      '/api/apps/hanako-audio-player/routes/playback-state/load': {}
    };
    const key = u.pathname.replace(/\/load$/, '/load');
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(routes[u.pathname] || {}));
  }
  const rel = u.pathname === '/' ? '/index.html' : u.pathname;
  const p = path.join(uiDir, decodeURIComponent(rel));
  if (!p.startsWith(uiDir) || !fs.existsSync(p)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });

async function shoot(name, size, mode) {
  const page = await browser.newPage();
  await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((mode) => {
    const light = { '--bg': '#F8F4ED', '--bg-card': '#FCFAF5', '--text': '#3B3D3F', '--text-muted': '#8E9196', '--text-light': '#6B6F73', '--accent': '#537D96', '--border': 'rgba(122,96,88,0.18)' };
    const dark = { '--bg': '#3B4A54', '--bg-card': '#445560', '--text': '#E1EAF0', '--text-muted': '#9FB1BC', '--text-light': '#9FB1BC', '--accent': '#C99AAF', '--border': 'rgba(170,121,141,0.16)' };
    const vars = mode === 'dark' ? dark : light;
    const css = ':root{' + Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') + '}';
    /* 在 boot 之前就把变量挂上：applyTone() 读到真值才能选对档 */
    const put = () => {
      const s = document.createElement('style');
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
      document.documentElement.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
    };
    if (document.documentElement) put();
    else document.addEventListener('readystatechange', put, { once: true });
  }, mode);
  await page.goto(`${BASE}/index.html?appSurfaceSession=t&shot=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  const tone = await page.$eval('#player', (el) => el.getAttribute('data-tone'));
  const lit = async (id) => {
    await page.hover(id).catch(() => {});
    await page.evaluate(() => new Promise((r) => setTimeout(r, 260)));
    const box = await page.$eval(id, (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const m = 46;   // 边距：把外扩的光晕也包进来
    await page.screenshot({
      path: path.join(outDir, `${name}-${id.replace('#', '')}.png`),
      clip: {
        x: Math.max(0, box.x - m), y: Math.max(0, box.y - m),
        width: box.w + m * 2, height: box.h + m * 2
      }
    });
    return box;
  };
  await lit('#queueBtn');
  await lit('#playBtn');
  await lit('#prevBtn');
  await lit('#favBtn');
  await lit('#modeBtn');
  console.log(name, 'tone=', tone);
  await page.close();
}

await shoot('card-light', { w: 465, h: 930 }, 'light');
await shoot('card-dark', { w: 465, h: 930 }, 'dark');
await shoot('win-light', { w: 1040, h: 780 }, 'light');
await shoot('win-dark', { w: 1040, h: 780 }, 'dark');

await browser.close();
server.close();
console.log('shots →', outDir);

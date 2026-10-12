#!/usr/bin/env node
/* bass 底纹专项截图：纯 bass 持续音频，看两种底纹（线网/水波纹）的实际可见度。 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE || '/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAB = path.join(repo, 'docs/player-ui/ripple-lab-layers.html');
const OUT = path.join(repo, 'docs/player-ui/screenshots');
const PORT = 8141;
fs.mkdirSync(OUT, { recursive: true });

function synthBass() {
  const SR = 44100, secs = 6, N = SR * secs, s = new Float32Array(N);
  for (let i = 0; i < N; i++) s[i] = 0.5 * Math.sin(2 * Math.PI * 80 * i / SR);
  return s;
}
function wav(s) {
  const n = s.length, pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s[i])) * 32767), i * 2);
  const o = Buffer.alloc(44 + pcm.length);
  o.write('RIFF', 0); o.writeUInt32LE(36 + pcm.length, 4); o.write('WAVEfmt ', 8);
  o.writeUInt32LE(16, 16); o.writeUInt16LE(1, 20); o.writeUInt16LE(1, 22);
  o.writeUInt32LE(44100, 24); o.writeUInt32LE(44100 * 2, 28); o.writeUInt16LE(2, 32);
  o.writeUInt16LE(16, 34); o.write('data', 36); o.writeUInt32LE(pcm.length, 40);
  pcm.copy(o, 44); return o;
}
const BASS = wav(synthBass());

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/lab') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(LAB)); return; }
  if (u.pathname === '/bass.wav') { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(BASS); return; }
  res.writeHead(404); res.end();
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 640 });
  await page.goto(`http://127.0.0.1:${PORT}/lab`, { waitUntil: 'load' });
  await page.evaluate(() => document.documentElement.setAttribute('data-demo-theme', 'dark'));

  for (const mode of ['A', 'B', 'C', 'D']) {
    await page.evaluate((m) => { const b = document.querySelector(`[data-mode="${m}"]`); if (b) b.click(); }, mode);
    await page.evaluate(async () => {
      const buf = await fetch('/bass.wav').then(r => r.arrayBuffer());
      const file = new File([buf], 'bass.wav', { type: 'audio/wav' });
      const dt = new DataTransfer(); dt.items.add(file);
      const input = document.getElementById('fileInput');
      input.files = dt.files; input.dispatchEvent(new Event('change'));
    });
    await new Promise(r => setTimeout(r, 1000));
    /* 清掉 pointer 欢迎波，只看干净的 bass 底纹 */
    await page.evaluate(() => { if (window.rippleLab && window.rippleLab.clearWaves) window.rippleLab.clearWaves(); });
    await new Promise(r => setTimeout(r, 700));   // 等 envBass 拉满
    const env = await page.evaluate(() => window.rippleLab ? window.rippleLab.envBassNow() : 0);
    const scene = await page.$('#scene');
    await scene.screenshot({ path: path.join(OUT, `bass-${mode}.png`) });
    console.log(`候选 ${mode}: envBass=${env.toFixed(2)} 已截图 bass-${mode}.png`);
  }
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });

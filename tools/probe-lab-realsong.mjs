#!/usr/bin/env node
/* 《花一匁》真实音频 · 三层触发统计
 * 把真实歌曲喂进实验台，按秒采样 waveKinds，统计三种事件的触发总量和分布。 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE || '/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAB = path.join(repo, 'docs/player-ui/ripple-lab-layers.html');
const SONG = '/tmp/hanakana-60s.wav';
const PORT = 8143;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/lab') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(LAB)); return; }
  if (u.pathname === '/song.wav') { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(fs.readFileSync(SONG)); return; }
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
  page.on('pageerror', e => console.log('JS错误:', String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/lab`, { waitUntil: 'load' });

  await page.evaluate(async () => {
    const buf = await fetch('/song.wav').then(r => r.arrayBuffer());
    const file = new File([buf], 'song.wav', { type: 'audio/wav' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.getElementById('fileInput');
    input.files = dt.files; input.dispatchEvent(new Event('change'));
  });

  /* 每 2 秒采样一次当前在场的 kind 分布 + envBass，累计 30 秒 */
  const samples = [];
  for (let t = 0; t < 15; t++) {
    await new Promise(r => setTimeout(r, 2000));
    const s = await page.evaluate(() => {
      const lab = window.rippleLab;
      return lab ? { kinds: lab.waveKinds(), envBass: +lab.envBassNow().toFixed(2), waves: lab.stats().waves } : null;
    });
    if (s) samples.push(s);
    console.log(`t=${(t + 1) * 2}s  envBass=${s.envBass}  在场: low=${s.kinds.low} mid=${s.kinds.mid} high=${s.kinds.high}`);
  }

  /* 触发总量估算：每类在场数的总和（粗略反映触发活跃度） */
  const tot = { low: 0, mid: 0, high: 0 };
  for (const s of samples) { tot.low += s.kinds.low; tot.mid += s.kinds.mid; tot.high += s.kinds.high; }
  console.log('\n30秒触发活跃度（在场波次累计）:', JSON.stringify(tot));
  console.log('镲片/鼓点比:', tot.low ? (tot.high / tot.low).toFixed(2) : 'N/A');

  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });

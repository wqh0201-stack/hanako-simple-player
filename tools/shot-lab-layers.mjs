#!/usr/bin/env node
/* 涟漪三层实验台 · 视觉截图验证
 * 用混合音频（bass 持续 + 鼓点 + 镲片）跑 4 秒，截图看三种波的强对比色区分度。
 * 输出到 docs/player-ui/screenshots/layers-demo-*.png
 */
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
const PORT = 8139;
fs.mkdirSync(OUT, { recursive: true });

/* 混合音频：bass 持续 + 鼓点每 0.5s + 镲片每 0.33s 同时存在 */
function synthMixed() {
  const SR = 44100, secs = 6, N = SR * secs, s = new Float32Array(N);
  const add = (from, dur, hz, amp, env) => {
    const a = Math.floor(from * SR), b = Math.min(N, Math.floor((from + dur) * SR));
    for (let i = a; i < b; i++) { const t = (i - a) / SR; s[i] += amp * (env ? Math.exp(-t * env) : 1) * Math.sin(2 * Math.PI * hz * t); }
  };
  add(0, secs, 80, 0.4, 0);                                    // bass 持续
  for (let t = 0.5; t < secs - 0.2; t += 0.5) add(t, 0.12, 60, 0.5, 40);   // 鼓点
  for (let t = 0.3; t < secs - 0.2; t += 1 / 3) for (const hz of [4000, 5200, 6500, 7600]) add(t, 0.15, hz, 0.22, 30); // 镲片
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
const MIXED = wav(synthMixed());

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/lab') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(LAB)); return; }
  if (u.pathname === '/mixed.wav') { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(MIXED); return; }
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
  /* 深色主题下金色和深蓝对比更明显；清掉欢迎波，只看音频波。 */
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-demo-theme', 'dark');
  });

  for (const mode of ['A', 'B', 'C', 'D']) {
    await page.evaluate((m) => {
      const btn = document.querySelector(`[data-mode="${m}"]`);
      if (btn) btn.click();
    }, mode);
    // 加载混合音频
    await page.evaluate(async () => {
      const buf = await fetch('/mixed.wav').then(r => r.arrayBuffer());
      const file = new File([buf], 'mixed.wav', { type: 'audio/wav' });
      const dt = new DataTransfer(); dt.items.add(file);
      const input = document.getElementById('fileInput');
      input.files = dt.files; input.dispatchEvent(new Event('change'));
    });
    // 等音频跑起来后清掉 pointer 欢迎波，只留后续音频波，再截三层同时在场的时刻
    await new Promise(r => setTimeout(r, 900));
    await page.evaluate(() => { if (window.rippleLab && window.rippleLab.clearWaves) window.rippleLab.clearWaves(); });
    /* 跨过至少一个鼓点周期(0.5s)+多个镲片(0.33s)，确保三层同时在场 */
    await new Promise(r => setTimeout(r, 1150));
    // 截水面区域
    const scene = await page.$('#scene');
    const file = path.join(OUT, `layers-demo-${mode}.png`);
    await scene.screenshot({ path: file });
    const kinds = await page.evaluate(() => window.rippleLab ? window.rippleLab.waveKinds() : {});
    console.log(`候选 ${mode}: 已截图 ${path.basename(file)}  waveKinds=${JSON.stringify(kinds)}`);
  }

  await browser.close(); server.close();
  console.log('\n截图完成，目录：' + OUT);
})().catch(e => { console.error(e); process.exit(1); });

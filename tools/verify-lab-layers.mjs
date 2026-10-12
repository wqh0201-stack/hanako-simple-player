#!/usr/bin/env node
/* 涟漪实验室三层候选 · 独立无头验证
 * 验证 docs/player-ui/ripple-lab-layers.html 的三路分层：
 *  - steady-bass（持续 80Hz）→ envBass 上升、场能量在线、waves 里几乎无 short wave
 *  - kicks（60Hz 短包）→ waveKinds().low > 0
 *  - mid-bursts（1.2kHz）→ waveKinds().mid > 0
 *  - hihats（多音色高频）→ waveKinds().high > 0
 *  - silence → 全零，不伪造
 * 运行：node tools/verify-lab-layers.mjs
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
const PORT = 8137;

function synthSamples(kind) {
  const SR = 44100, secs = 6, N = SR * secs;
  const s = new Float32Array(N);
  const addTone = (from, dur, hz, amp, env) => {
    const a = Math.floor(from * SR), b = Math.min(N, Math.floor((from + dur) * SR));
    for (let i = a; i < b; i++) { const t = (i - a) / SR; s[i] += amp * (env ? Math.exp(-t * env) : 1) * Math.sin(2 * Math.PI * hz * t); }
  };
  // 真·底鼓：55Hz 正弦 + 起始上滑 + 快速衰减 + 极短击打瞬态（物理本质）
  const addKick = (from, amp) => {
    const a = Math.floor(from * SR), b = Math.min(N, Math.floor((from + .22) * SR));
    let ph = 0;
    for (let i = a; i < b; i++) {
      const t = (i - a) / SR;
      ph += 2 * Math.PI * (55 + 45 * Math.exp(-t * 30)) / SR;
      s[i] += amp * Math.exp(-t * 22) * Math.sin(ph);
    }
    const c = Math.floor(from * SR), cend = Math.min(N, c + Math.floor(.006 * SR));
    for (let i = c; i < cend; i++) s[i] += amp * .45 * (Math.random() * 2 - 1) * Math.exp(-(i - c) / SR * 900);
  };
  const addBassLine = (from, to, amp) => {
    // 连奏低音贝斯线：换音时不断开、无 note 起音（这是真实编曲里的低音贝斯）
    const a = Math.floor(from * SR), b = Math.min(N, Math.floor(to * SR));
    let ph = 0;
    for (let i = a; i < b; i++) {
      const t = (i - a) / SR;
      const hz = (Math.floor(t / 0.5) % 2) ? 65.4 : 82.4;
      ph += 2 * Math.PI * hz / SR;
      const fund = Math.sin(ph) + .5 * Math.sin(2 * ph) + .25 * Math.sin(3 * ph);
      s[i] += amp * .28 * fund;
    }
  };
  if (kind === 'steady-bass') addBassLine(0, secs, 1);
  else if (kind === 'kicks') for (let t = 0.2; t < secs - 0.2; t += 1 / 3) addKick(t, .7);
  else if (kind === 'bass-kick') { addBassLine(0, secs, 0.6); for (let t = 0.2; t < secs - 0.2; t += 1 / 3) addKick(t, .7); }
  else if (kind === 'mid-bursts') for (let t = 0.2; t < secs - 0.2; t += 1 / 3) addTone(t, 0.08, 1200, 0.45, 55);
  else if (kind === 'hihats') for (let t = 0.2; t < secs - 0.2; t += 1 / 3) for (const hz of [4000, 5200, 6500, 7600]) addTone(t, 0.15, hz, 0.25, 30);
  return s;
}
function wavFromSamples(samples) {
  const n = samples.length, pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  const out = Buffer.alloc(44 + pcm.length);
  out.write('RIFF', 0); out.writeUInt32LE(36 + pcm.length, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(44100, 24); out.writeUInt32LE(44100 * 2, 28); out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(pcm.length, 40);
  pcm.copy(out, 44); return out;
}
const KINDS = ['steady-bass', 'kicks', 'bass-kick', 'mid-bursts', 'hihats', 'silence'];
const WAVS = {};
for (const k of KINDS) WAVS[k] = wavFromSamples(synthSamples(k));

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/lab') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(LAB)); return; }
  if (u.pathname === '/tone.wav') { const k = u.searchParams.get('p') || 'steady-bass'; res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(WAVS[k]); return; }
  res.writeHead(404); res.end();
});

const results = [];
function check(name, ok, detail) { results.push({ ok }); console.log((ok ? '✓' : '✗') + ' ' + name + (detail ? '  — ' + detail : '')); }

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 800 });
  let jsErr = '';
  page.on('pageerror', e => { jsErr = String(e); });

  await page.goto(`http://127.0.0.1:${PORT}/lab`, { waitUntil: 'load' });

  for (const kind of KINDS) {
    const r = await page.evaluate(async (kind) => {
      const buf = await fetch(`/tone.wav?p=${kind}`).then(r => r.arrayBuffer());
      const file = new File([buf], kind + '.wav', { type: 'audio/wav' });
      const dt = new DataTransfer(); dt.items.add(file);
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 1200));
      const lab = window.rippleLab;
      if (!lab) return { kind, err: 'no rippleLab' };
      // 预热后清零计数器，累计 4s 内的真实触发数（不受波退场影响）
      lab.resetTriggers && lab.resetTriggers();
      await new Promise(r => setTimeout(r, 4000));
      const stats = lab.stats();
      const kinds = lab.waveKinds ? lab.waveKinds() : {};
      const trig = lab.triggers ? lab.triggers() : {};
      return { kind, kinds, trig, fieldEnergy: stats.fieldEnergy, envBass: stats.envBass, analysing: stats.analysing, waves: stats.waves };
    }, kind);

    if (r.err) { check(`${kind}`, false, r.err); continue; }
    const t = r.trig || {};
    if (kind === 'steady-bass') {
      check('steady-bass 低频包络上升', r.envBass > 0.3, `envBass=${(r.envBass||0).toFixed(2)}`);
      check('steady-bass 光波场在线', r.fieldEnergy > 0.00001, `fieldEnergy=${(r.fieldEnergy||0).toExponential(2)}`);
      check('steady-bass 不误判为鼓', (t.kick||0) === 0, `kick=${t.kick||0}`);
    } else if (kind === 'kicks') {
      check('kicks 触发 low 波', (t.kick||0) >= 3, `kick=${t.kick||0}`);
      check('kicks 纯底鼓不误判为 bass', (t.bass||0) === 0, `bass=${t.bass||0}`);
    } else if (kind === 'bass-kick') {
      // 关键主场景：bass 与鼓同时响，弹与鼓都要出（不被 pk 门互相挡掉）
      check('bass-kick 弹鼓同时可辨', (t.bass||0) >= 3 && (t.kick||0) >= 3, `bass=${t.bass||0} kick=${t.kick||0}`);
    } else if (kind === 'mid-bursts') {
      check('mid-bursts 触发 mid 波', (t.mid||0) >= 3, `mid=${t.mid||0}`);
    } else if (kind === 'hihats') {
      check('hihats 触发 high 波', (t.hat||0) >= 3, `hat=${t.hat||0}`);
    } else if (kind === 'silence') {
      check('silence 不伪造鼓点', (t.bass||0)+(t.kick||0)+(t.mid||0)+(t.hat||0) === 0, JSON.stringify(t));
    }
  }

  check('页面无 JS 错误', !jsErr, jsErr);

  // 源码级守卫：bass 必须只出立体光波、不出描边等高线。
  // 判据：绘制循环里有一行对 bass 的 continue 跳过，且不再有旧的 bass 描边分支。
  {
    const src = fs.readFileSync(LAB, 'utf8');
    check('bass 绘制被 continue 跳过（不出描边）', /kind==='bass'\)\s*continue/.test(src), '');
    check('bass 仍经 dropKind 推高度场（出光波）', /dropKind\('bass'/.test(src), '');
  }

  await browser.close(); server.close();
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} 通过`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

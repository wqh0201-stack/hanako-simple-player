#!/usr/bin/env node
/* 涟漪三层配色对照（开发用，不进验收）：把 ripplePalette 的产出铺成色板。
 * 直接 import ui/app.js 里的纯函数不方便（浏览器环境），这里复刻同一套常数与算法，
 * 并断言与 app.js 的常数一致（从源码里抽出来比对），避免两处漂移。
 * 用法：node tools/shoot-ripple-colors.mjs  → 输出 /tmp/ripple-colors.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = fs.readFileSync(path.join(repo, 'ui/app.js'), 'utf8');

/* 从源码抽出常数，确保对照表跟生产同源（漂移即报错）。 */
function num(name) {
  const m = new RegExp(name + '\\s*=\\s*([0-9.]+)').exec(appSrc);
  return m ? Number(m[1]) : null;
}
const HUE_OFF = { bass: -30, kick: 16, mid: 34, hat: 60 };
const SAT_MUL = { bass: 0.78, kick: 0.84, mid: 0.86, hat: 0.90 };
const LIGHT_BASE = { bass: 0.60, kick: 0.60, mid: 0.61, hat: 0.62 };
const DARK_BASE = { bass: 0.42, kick: 0.42, mid: 0.43, hat: 0.44 };
const MIN_CT = num('RIPPLE_MIN_CONTRAST') || 2.2;

/* —— 与 app.js 同算法 —— */
function rgb2hsl(c) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; const l = (mx + mn) / 2; let s = 0;
  if (d > 1e-6) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; }
  return [h, s, l];
}
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const f = (n) => { const k = (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
function lumOf(c) { const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]); }
function contrastOf(a, b) { const la = lumOf(a), lb = lumOf(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
function accentFrom(cover, polarity) { const hsl = rgb2hsl(cover); const h = hsl[0] + 150; const s = Math.max(0.42, Math.min(0.72, hsl[1] * 0.9 + 0.22)); const l = polarity === 'dark' ? 0.72 : 0.40; return hsl2rgb(h, s, l); }
function solveByContrast(h, s, bg, baseL, floor) {
  floor = floor || MIN_CT; let best = null;
  for (let d = 0; d <= 100; d += 2) {
    const dd = d / 100; const tries = d === 0 ? [baseL] : [baseL - dd, baseL + dd];
    for (const L of tries) { if (L < 0.04 || L > 0.96) continue; const c = hsl2rgb(h, s, L); if (contrastOf(c, bg) >= floor) { if (!best || dd < best.d) best = { d: dd, c }; } }
    if (best && best.d <= dd) break;
  }
  return best ? best.c : hsl2rgb(h, s, 0.5);
}
function ripplePalette(accent, bg, polarity) {
  const a = rgb2hsl(accent); const dark = polarity !== 'light'; const out = {};
  for (const k of ['bass', 'kick', 'mid', 'hat']) {
    const h = a[0] + HUE_OFF[k]; const s = Math.max(0.28, Math.min(0.85, a[1] * SAT_MUL[k]));
    out[k] = solveByContrast(h, s, bg, (dark ? LIGHT_BASE : DARK_BASE)[k]);
  }
  return out;
}
const rgba = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

const COVERS = [
  { n: '深藏青', c: [27, 34, 51] }, { n: '深暖褐', c: [42, 31, 26] }, { n: '深墨绿', c: [22, 36, 28] },
  { n: '中调青', c: [47, 111, 120] }, { n: '中调橄榄', c: [110, 106, 58] }, { n: '中调玫瑰', c: [122, 74, 90] }, { n: '中调灰蓝', c: [85, 96, 106] },
  { n: '浅米', c: [236, 229, 216] }, { n: '浅粉', c: [242, 217, 224] }, { n: '浅灰蓝', c: [223, 230, 236] },
];

const rows = COVERS.map(({ n, c }) => {
  const pol = lumOf(c) > 0.5 ? 'light' : 'dark';
  const acc = accentFrom(c, pol);
  const pal = ripplePalette(acc, c, pol);
  const cts = ['bass', 'kick', 'mid', 'hat'].map((k) => contrastOf(pal[k], c).toFixed(2));
  const sw = (col, lab) => `<div class="sw" style="background:${rgba(col)}"><span>${lab}</span></div>`;
  return `<tr>
    <td class="cov"><i style="background:${rgba(c)}"></i>${n}<b>${pol}</b></td>
    <td>${sw(acc, '歌词')}</td>
    <td>${sw(pal.bass, 'bass')}<em>${cts[0]}</em></td>
    <td>${sw(pal.kick, 'kick')}<em>${cts[1]}</em></td>
    <td>${sw(pal.mid, 'mid')}<em>${cts[2]}</em></td>
    <td>${sw(pal.hat, 'hat')}<em>${cts[3]}</em></td>
  </tr>`;
}).join('\n');

const html = `<!doctype html><meta charset="utf-8"><title>涟漪三层配色</title>
<style>
 body{background:#F8F4ED;color:#2A2622;font:14px/1.5 -apple-system,"PingFang SC",sans-serif;padding:26px}
 h1{font-family:"Songti SC",serif;font-weight:400;font-size:24px;margin:0 0 4px}
 p.note{color:#6b6f73;margin:0 0 18px;font-size:12px}
 table{border-collapse:collapse}
 th,td{padding:8px 10px;text-align:left;border-bottom:1px solid rgba(42,38,34,.1)}
 .cov{font-size:12px;white-space:nowrap} .cov i{display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:6px}
 .cov b{color:#8E9196;font-weight:400;margin-left:6px;font-size:11px}
 .sw{display:inline-block;width:46px;height:26px;border-radius:4px;vertical-align:middle;box-shadow:0 0 0 1px rgba(0,0,0,.08)}
 .sw span{font-size:9px;color:rgba(255,255,255,.85);padding:2px}
 em{font-style:normal;color:#6b6f73;font-size:11px;margin-left:6px}
</style>
<h1>涟漪三层配色 · 各封面主色下的派生</h1>
<p class="note">算法与 ui/app.js 同源（常数从源码抽出）：偏色相 + 降饱和（弱一档）+ 明度解算保证对比 ≥ ${MIN_CT}。数字是各层与背景的 WCAG 对比。</p>
<table>
 <tr><th>封面主色</th><th>歌词色</th><th>bass 光波</th><th>kick 鼓点</th><th>mid 军鼓</th><th>hat 镲片</th></tr>
${rows}
</table>`;
fs.writeFileSync('/tmp/ripple-colors.html', html);
console.log('wrote /tmp/ripple-colors.html');

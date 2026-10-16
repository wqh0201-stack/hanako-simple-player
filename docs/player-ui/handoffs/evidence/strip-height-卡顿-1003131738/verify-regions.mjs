#!/usr/bin/env node
/* setInteractiveRegions 本地夹具验收（build 1003131739）。
 * 目的不是复现「矮高度卡」（那必须有宿主才会发生），而是验：
 *   1. 不支持时的降级路径：无 hana.surface → 不报错、不改任何现有交互、CLI 干净；
 *   2. 注入假的 hana.surface.setInteractiveRegions 后，集合内容/坐标/上限正确；
 *   3. 布局变化（resize / 退出横条 / 音量浮层开合）会触发重算，退出横条时清空。
 * 用法：node docs/player-ui/handoffs/evidence/strip-height-卡顿-1003131738/verify-regions.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE || '/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const uiDir = '/Volumes/SSD/hanadesk/hanako-audio-player-simple/ui';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wav': 'audio/wav' };
const TRACK = { id: 't1', uid: 'u1', title: 'Tell me', author: 'milet', pic: '/svg.svg', url: '/a.wav', duration: 223 };

const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u.startsWith('/ui/')) {
    const f = path.join(uiDir, u.slice(4));
    if (fs.existsSync(f)) { res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f)); }
    else { res.statusCode = 404; res.end('nf'); }
    return;
  }
  if (u === '/svg.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#C99AAF"/></svg>`); return; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, state: { playing: false, volume: .72, muted: false, index: 0, tracks: [TRACK] } }));
});
await new Promise(r => srv.listen(0, r));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });

const fails = [];
const check = (name, ok, detail) => { if (!ok) fails.push(name + ' :: ' + JSON.stringify(detail)); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); };

async function newPage(withHost) {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.setViewport({ width: 640, height: 80, deviceScaleFactor: 1 });
  // 真 ui/sdk.js 会在加载时用自己的实现覆盖 window.hana.surface，因此 stub 不能
  // 在 evaluateOnNewDocument 里塞（会被冲掉），必须等 SDK 就绪后再替换。
  await page.goto(`${BASE}/ui/index.html`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 900));
  if (withHost) {
    await page.evaluate(() => {
      window.__regionCalls = [];
      window.hana.surface.setInteractiveRegions = regions => {
        window.__regionCalls.push(regions.map(r => ({ ...r })));
        return Promise.resolve({ applied: true });   // 真宿主成功时返回 { applied:true }
      };
    });
  } else {
    // 模拟「旧宿主没有这个能力」：删掉它，走降级路径。
    await page.evaluate(() => { try { delete window.hana.surface.setInteractiveRegions; } catch (e) {} });
  }
  // 触发一次布局重算（换高度 → 集合 key 变化 → 必然重新上报）
  await page.setViewport({ width: 640, height: 88, deviceScaleFactor: 1 });
  await new Promise(r => setTimeout(r, 700));
  return { page, logs };
}

/* ---------- A. 无宿主 API → 必须静默降级 ---------- */
{
  const { page, logs } = await newPage(false);
  const r = await page.evaluate(() => window.__playerDebug.interactiveRegions());
  check('A1-去掉该 API 后 supported=false', r.supported === false, r);
  check('A2-降级时不 applied', r.applied === false, r);
  const errs = logs.filter(l => l.startsWith('PAGEERROR'));
  // 夹具噪声：本地起的服务没有 /api/apps/:appId/ui 这个宿主路由，App SDK 自身会报错；
  // 这是既有的裸浏览器背景噪声（与本次改动无关），只筛掉这一类。
  const noise = /requires an App surface route|App surface handshake|playlist 读取失败/;
  const real = errs.filter(l => !noise.test(l));
  check('A3-无新增运行时报错', real.length === 0, real.slice(0, 6));
  check('A4-仍能进入横条形态', await page.evaluate(() => document.getElementById('player').getAttribute('data-layout')) === 'strip');
  await page.close();
}

/* ---------- B. 有宿主 API → 集合内容与坐标正确 ---------- */
{
  const { page, logs } = await newPage(true);
  const r = await page.evaluate(() => window.__playerDebug.interactiveRegions());
  check('B1-supported=true', r.supported === true, r);
  check('B2-applied=true（最后一次上报成功）', r.applied === true && !r.lastError, r);
  check('B3-矩形数在 1..64 内', r.count >= 1 && r.count <= 64, { count: r.count });

  const calls = await page.evaluate(() => window.__regionCalls);
  const last = calls[calls.length - 1] || [];
  check('B4-确实调用过宿主 API', calls.length > 0, { calls: calls.length });
  check('B5-每个矩形恰好 x,y,width,height 四键',
    last.every(o => Object.keys(o).length === 4 && ['x', 'y', 'width', 'height'].every(k => typeof o[k] === 'number' && Number.isFinite(o[k]))), last.slice(0, 2));
  check('B6-宽高 > 0 且在范围内', last.every(o => o.width > 0 && o.height > 0 && Math.abs(o.x) <= 1e6 && Math.abs(o.y) <= 1e6), last.slice(0, 2));

  // 矮高度（80px）时：条顶 12、底 68 → 矩形应确实落在宿主 44px 带里有重叠的部分
  const overlapsBand = last.filter(o => Math.max(0, Math.min(44, o.y + o.height) - Math.max(0, o.y)) > 0.5);
  check('B7-集合中包含与 44px 带重叠的矩形（这正是要修复的目标）',
    overlapsBand.length > 0, { total: last.length, overlapping: overlapsBand.length });

  // seek 应覆盖整条（宽度接近条宽）
  const seekLike = last.reduce((a, o) => (a && a.width >= o.width ? a : o), null);
  check('B8-最大矩形象 seek（宽接近整条）', seekLike && seekLike.width > 200, seekLike);
  const errs = logs.filter(l => l.startsWith('PAGEERROR'));
  const noise = /requires an App surface route|App surface handshake|playlist 读取失败/;
  const real = errs.filter(l => !noise.test(l));
  check('B9-无新增运行时报错', real.length === 0, real.slice(0, 6));
  await page.close();
}

/* ---------- C. 布局变化触发重算；退出横条清空 ---------- */
{
  const { page, logs } = await newPage(true);
  const n0 = (await page.evaluate(() => window.__regionCalls.length));
  await page.setViewport({ width: 640, height: 160, deviceScaleFactor: 1 });
  await new Promise(r => setTimeout(r, 500));
  const afterResize = await page.evaluate(() => window.__regionCalls.length);
  check('C1-resize 后重新上报', afterResize > n0, { before: n0, after: afterResize });

  const lastBeforeExit = await page.evaluate(() => { const c = window.__regionCalls; return c[c.length - 1]; });
  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
  await new Promise(r => setTimeout(r, 600));
  const layoutNow = await page.evaluate(() => document.getElementById('player').getAttribute('data-layout'));
  const lastAfterExit = await page.evaluate(() => { const c = window.__regionCalls; return c[c.length - 1]; });
  check('C2-退出横条（不再是 strip）', layoutNow !== 'strip', { layout: layoutNow });
  check('C3-退出横条后上报空集合（无残留打洞）', Array.isArray(lastAfterExit) && lastAfterExit.length === 0,
    { before: (lastBeforeExit || []).length, after: (lastAfterExit || []).length });
  const errs = logs.filter(l => l.startsWith('PAGEERROR'));
  const noise = /requires an App surface route|App surface handshake|playlist 读取失败/;
  const real = errs.filter(l => !noise.test(l));
  check('C4-无新增运行时报错', real.length === 0, real.slice(0, 6));
  await page.close();
}

await browser.close();
srv.close();
console.log('\n==== ' + (fails.length ? 'FAILED: ' + fails.length : 'ALL PASS') + ' ====');
if (fails.length) { fails.forEach(f => console.log('  - ' + f)); process.exit(1); }

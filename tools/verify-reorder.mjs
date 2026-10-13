#!/usr/bin/env node
// Real production routes + production UI + Chrome pointer/touch input, isolated app-data.
// The Hana storage transport and external-open bridge are fixtures, not host acceptance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { registerRoutes } from '../lib/register-routes.js';
import { DEFAULT_LISTS, listsFor } from '../lib/lists.js';
import { mergeLibrarySnapshot } from '../lib/library.js';
const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE || '/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.OUT_DIR || '/tmp/hap-reorder';
fs.mkdirSync(out, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hap-reorder-'));
const disk = path.join(dataDir, 'playlist.json'), values = new Map(), pages = new Set();
const results = [], errors = [], sortCalls = [], externalCalls = [];
let failSort = false, sortDelay = 0;
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const tracks = () => JSON.parse(fs.readFileSync(disk, 'utf8'));
const setTracks = value => fs.writeFileSync(disk, JSON.stringify(value));
async function notify(key) {
  await Promise.all([...pages].map(page => page.evaluate(key => {
    for (const fn of window.__sortListeners || []) fn([key]);
  }, key).catch(() => {})));
}
const storage = {
  get: async (key, fallback) => structuredClone(values.get(key) ?? fallback),
  set: async (key, value) => { values.set(key, structuredClone(value)); notify(key).catch(() => {}); }
};
const ctx = { dataDir, storage: { global: storage }, logger: { warn() {}, info() {}, error() {} }, resources: {}, network: { fetch: async () => { throw new Error('offline fixture'); } } };
const routes = new Map();
const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (p, h) => routes.set(method.toUpperCase() + ' ' + p, h)]));
registerRoutes(app, { ctx, state: {} });
const invoke = async (route, body) => routes.get('POST ' + route)({ req: { json: async () => body }, json: (body, status = 200) => ({ body, status }) });
const imports = Array.from({ length: 18 }, (_, i) => ({ id: 'imp:' + (i + 1), name: i === 0 ? '日系流行 · 晴れ' : i === 1 ? 'Aimer 长歌单名称' : '歌单 ' + (i + 1) }));
const baseLists = DEFAULT_LISTS.concat(imports);
values.set('player-lists', baseLists);

// Backend evidence: move intent preserves contemporaneous additions, names and other list slots.
const seed = [
  { list: 'imp:1', id: 'a', name: '甲', unknown: { keep: true } },
  { list: 'imp:2', id: 'a', name: '另一个副本', lyricOffset: 200 },
  { list: 'imp:1', id: 'b', name: '乙' },
  { list: 'local', id: 'local', name: '本地文件' },
  { list: 'imp:1', id: 'c', name: '丙' }
];
setTracks(seed);
let reply = await invoke('/api/playlist/reorder', { list: 'imp:1', id: 'c', beforeId: 'a' });
check('BE-01-song-order-saves', reply.status === 200 && tracks().filter(t => t.list === 'imp:1').map(t => t.id).join() === 'c,a,b');
check('BE-02-other-list-slots-and-metadata-unchanged', JSON.stringify(tracks()[1]) === JSON.stringify(seed[1]) && JSON.stringify(tracks()[3]) === JSON.stringify(seed[3]));
check('BE-03-unknown-fields-and-change-broadcast-survive', tracks().find(t => t.list === 'imp:1' && t.id === 'a').unknown.keep && !!values.get('player-library-revision'));
const bytes = fs.readFileSync(disk, 'utf8');
for (const [name, body, status] of [
  ['missing-item', { list: 'imp:1', id: 'deleted', beforeId: null }, 409],
  ['missing-anchor', { list: 'imp:1', id: 'a', beforeId: 'deleted' }, 409],
  ['other-list-anchor', { list: 'imp:1', id: 'a', beforeId: 'local' }, 409],
  ['same-item', { list: 'imp:1', id: 'a', beforeId: 'a' }, 400],
  ['recent-history', { list: 'recent', id: 'a', beforeId: null }, 400],
  ['bad-input', { list: 'imp:1', id: 'a' }, 400]
]) {
  reply = await invoke('/api/playlist/reorder', body);
  check('BE-04-reject-' + name, reply.status === status && fs.readFileSync(disk, 'utf8') === bytes);
}
setTracks([{ list: 'imp:1', url: 'https://x.test/song?id=1' }, { list: 'imp:1', url: 'https://x.test/song?id=2' }]);
reply = await invoke('/api/playlist/reorder', { list: 'imp:1', id: 'derived-2', url: 'https://x.test/song?id=2', beforeId: 'derived-1', beforeUrl: 'https://x.test/song?id=1' });
check('BE-05-legacy-full-url-identity', reply.status === 200 && tracks()[0].url.endsWith('id=2'));
values.set('player-lists', baseLists.concat({ id: 'imp:99', name: 'Agent 刚新建' }).map(l => l.id === 'imp:2' ? { ...l, name: '同时改名' } : l));
reply = await invoke('/api/lists/reorder', { id: 'imp:2', beforeId: 'fav' });
check('BE-06-tab-order-preserves-new-list-and-name', reply.status === 200 && reply.body.lists[0].name === '同时改名' && reply.body.lists.at(-1).id === 'imp:99');
const beforeDelete = JSON.stringify(values.get('player-lists'));
reply = await invoke('/api/lists/reorder', { id: 'deleted', beforeId: null });
check('BE-07-deleted-tab-not-resurrected', reply.status === 409 && JSON.stringify(values.get('player-lists')) === beforeDelete);
const keyOf = t => t.list + '|' + t.id;
const concurrent = [seed[4], seed[1], seed[0], seed[3], seed[2]];
const stale = seed.map(t => t.id === 'a' && t.list === 'imp:1' ? { ...t, name: '元数据更新' } : t);
const merged = mergeLibrarySnapshot(concurrent, seed, stale, keyOf);
check('BE-08-stale-metadata-save-keeps-external-sort', merged.filter(t => t.list === 'imp:1').map(t => t.id).join() === 'c,a,b' && merged.find(t => keyOf(t) === 'imp:1|a').name === '元数据更新');
const localSort = [seed[2], seed[1], seed[0], seed[3], seed[4]];
const withFresh = [{ list: 'imp:1', id: 'new', name: 'Agent 新录音' }, ...seed];
const result = mergeLibrarySnapshot(withFresh, seed, localSort, keyOf);
check('BE-09-explicit-scope-sort-keeps-new-track', result.map(t => t.id).join() === 'new,b,a,a,local,c');
await Promise.all([listsFor(ctx).reorder('local', 'imp:2'), listsFor(ctx).reorder('imp:3', 'fav')]);
check('BE-10-consecutive-tab-moves-use-latest', values.get('player-lists')[0].id === 'local' && values.get('player-lists')[1].id === 'imp:2' && values.get('player-lists')[2].id === 'imp:3');

const API = '/api/apps/hanako-simple-player/routes';
const fixtureTracks = Array.from({ length: 60 }, (_, i) => ({
  list: 'imp:1', id: 'song-' + i, name: i === 0 ? 'マリーゴールド' : '演示歌曲 ' + (i + 1), author: i === 0 ? 'あいみょん' : '歌手 ' + (i % 3 + 1),
  url: API + '/_fixture/audio.wav?track=' + i, pic: '/fixture-cover.png', dur: 120, mode: '在线'
})).concat([{ list: 'imp:2', id: 'song-0', name: '同曲独立副本', url: API + '/_fixture/audio.wav', mode: '在线' }, { list: 'local', id: 'local-file', name: '本地文件', url: API + '/_fixture/audio.wav', mode: '本地' }]);
values.set('player-lists', baseLists);
values.set('player-cookie-notice-seen', true); values.set('player-welcome-seeded', true);
setTracks(fixtureTracks);
fs.writeFileSync(path.join(dataDir, 'playback.json'), JSON.stringify({ currentId: 'imp:1|song-0', activeList: 'imp:1', currentTrack: fixtureTracks[0], progress: 5, playing: false, volume: .2, muted: true, mode: 'list' }));
const wav = Buffer.alloc(44 + 16000 * 120);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const json = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const allowed = new Set(['/api/lists', '/api/lists/reorder', '/api/playlist/reorder', '/widget/api/playlist', '/api/audio-owner', '/api/playback-state']);
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1'), p = u.pathname.slice(API.length);
  try {
    if (u.pathname.startsWith(API)) {
      if (!u.searchParams.has('appSurfaceSession') && !req.headers['x-hana-app-surface-session']) return json(res, {}, 403);
      if (p === '/_fixture/audio.wav') {
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || ''), start = range ? +range[1] : 0, end = range && range[2] ? Math.min(+range[2], wav.length - 1) : wav.length - 1;
        const headers = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 };
        if (range) headers['Content-Range'] = `bytes ${start}-${end}/${wav.length}`;
        res.writeHead(range ? 206 : 200, headers); return res.end(wav.subarray(start, end + 1));
      }
      if (p.includes('/lrc/') || p.endsWith('/ttml')) return json(res, { ok: false }, 404);
      if (!allowed.has(p)) return json(res, { ok: true, results: [], charts: [], playlists: [], radios: [], songs: [] });
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      if (p.endsWith('/reorder')) {
        sortCalls.push({ p, input });
        if (sortDelay) await new Promise(resolve => setTimeout(resolve, sortDelay));
        if (failSort) return json(res, { ok: false, error: 'simulated save failure' }, 500);
      }
      const response = await routes.get(req.method + ' ' + p)({ req: { json: async () => input, query: key => u.searchParams.get(key), header: key => req.headers[key.toLowerCase()] }, json: (body, status = 200) => ({ body, status }) });
      return json(res, response.body, response.status);
    }
    /* ui/ 静态资源走 surface 路由（官方 App SDK 装配时断言 location.pathname
     * 落在 /api/apps/:appId/ui/ 下，根路径会直接抛错）。 */
    if (u.pathname.startsWith('/api/apps/hanako-simple-player/ui/')) {
      const rel = decodeURIComponent(u.pathname.slice('/api/apps/hanako-simple-player/ui/'.length)) || 'index.html';
      const sf = path.join(root, 'ui', rel);
      if (!sf.startsWith(path.join(root, 'ui')) || !fs.existsSync(sf)) return json(res, {}, 404);
      res.setHeader('Content-Type', sf.endsWith('.js') ? 'text/javascript' : sf.endsWith('.css') ? 'text/css' : sf.endsWith('.png') ? 'image/png' : sf.endsWith('.json') ? 'application/json' : 'text/html');
      return fs.createReadStream(sf).pipe(res);
    }
    const file = u.pathname === '/fixture-cover.png' ? path.join(root, 'docs/player-ui/assets/demo-cover-square.png') : path.join(root, 'ui', u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
    if (!file.startsWith(root) || !fs.existsSync(file)) return json(res, {}, 404);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html');
    fs.createReadStream(file).pipe(res);
  } catch (err) { json(res, { ok: false, error: err.message }, err.code || 500); }
});
let browser;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  /* 页面基址走宿主真实 surface 路由：官方 App SDK 装配时断言 location.pathname
   * 落在 /api/apps/:appId/ui/ 下，根路径会直接抛错。 */
  const uiBase = origin + '/api/apps/hanako-simple-player/ui';
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); pages.add(page);
  page.on('pageerror', err => errors.push(String(err)));
  await page.setViewport({ width: 465, height: 930 });
  await page.exposeFunction('__sortStorageGet', storage.get);
  await page.exposeFunction('__sortStorageSet', storage.set);
  await page.exposeFunction('__sortExternal', input => externalCalls.push(input));
  await page.evaluateOnNewDocument(() => {
    window.__sortListeners = new Set();
    navigator.sendBeacon = () => true;
    const fetch = window.fetch; window.fetch = function (url, opts) { return opts?.keepalive ? Promise.resolve(new Response('{}')) : fetch.apply(this, arguments); };
    let hana;
    Object.defineProperty(window, 'hana', { configurable: true, get: () => hana, set: value => {
      hana = value;
      if (value?.storage?.global) {
        value.ready = () => Promise.resolve(); value.storage.global.get = window.__sortStorageGet; value.storage.global.set = window.__sortStorageSet;
        value.storage.global.onChanged = fn => { window.__sortListeners.add(fn); return () => window.__sortListeners.delete(fn); };
        value.external.open = window.__sortExternal;
      }
    } });
  });
  const go = async () => {
    await page.goto(uiBase + '/index.html?appSurfaceSession=sort-fixture', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__playerDebug?.activeList() === 'imp:1' && document.querySelectorAll('#queueList .q-row').length === 60, { timeout: 8000 });
    await sleep(250);
  };
  await go();
  const ids = () => tracks().filter(t => t.list === 'imp:1').map(t => t.id);
  const row = id => `#queueList .q-row[data-uid="imp:1|${id}"] .q-hit`;
  const arm = async selector => {
    const element = await page.$(selector);
    await element.evaluate(el => el.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await sleep(60);
    const box = await element.boundingBox();
    if (!box) throw new Error('not visible: ' + selector);
    const pos = { x: box.x + Math.min(36, box.width / 2), y: box.y + box.height / 2 };
    await page.mouse.move(pos.x, pos.y); await page.mouse.down(); await sleep(510);
    return pos;
  };
  const release = async () => { await page.mouse.up(); await page.waitForFunction(() => !document.querySelector('.reorder-layer')); await sleep(220); };
  const original = ids();
  let pos = await arm(row('song-0'));
  check('UI-01-long-hold-lifts-with-stable-nodes', await page.evaluate(() => !!document.querySelector('.reorder-ghost') && document.querySelectorAll('#queueList .q-row').length === 60));
  await page.mouse.move(pos.x, pos.y + 35); await sleep(100);
  check('UI-02-neighbor-pressure-is-visible', await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelectorAll('#queueList .q-row')[1]).transform).m22 < .999));
  const slot = await (await page.$(row('song-2'))).boundingBox();
  await page.mouse.move(pos.x, slot.y + slot.height / 2 + 10, { steps: 6 }); await sleep(130);
  check('UI-03-move-preview-does-not-write', ids().join() === original.join() && sortCalls.length === 0);
  await page.screenshot({ path: path.join(out, 'drag-light-465.png') });
  await release();
  check('UI-04-drop-saves-once-and-avoids-play-click', sortCalls.length === 1 && ids().indexOf('song-0') === 2 && await page.evaluate(() => document.getElementById('audio').paused), { calls: sortCalls, order: ids().slice(0, 5) });
  const saved = ids(); await go();
  check('UI-05-reload-restores-order', await page.evaluate(() => [...document.querySelectorAll('#queueList .q-row')].map(el => el.dataset.id).join()) === saved.join());

  await page.click('#playBtn'); await page.waitForFunction(() => !document.getElementById('audio').paused);
  const audioBefore = await page.evaluate(() => ({ time: document.getElementById('audio').currentTime, uid: window.__playerDebug.currentUid(), src: document.getElementById('audio').currentSrc }));
  await page.evaluate(() => document.getElementById('queueList').scrollTop = 0);
  pos = await arm(row('song-0'));
  const first = await (await page.$(row(ids()[0]))).boundingBox();
  await page.mouse.move(pos.x, first.y + first.height / 2 - 10, { steps: 8 }); await release();
  const audioAfter = await page.evaluate(() => ({ time: document.getElementById('audio').currentTime, uid: window.__playerDebug.currentUid(), src: document.getElementById('audio').currentSrc, paused: document.getElementById('audio').paused }));
  check('UI-06-current-recording-and-clock-continue', !audioAfter.paused && audioAfter.uid === audioBefore.uid && audioAfter.src === audioBefore.src && audioAfter.time > audioBefore.time && ids()[0] === 'song-0', { audioBefore, audioAfter, order: ids().slice(0, 5) });
  await page.click('#playBtn'); await sleep(100);

  const priorFailure = ids(); failSort = true;
  pos = await arm(row('song-0')); await page.mouse.move(pos.x, pos.y + 130, { steps: 8 }); await release(); failSort = false;
  check('UI-07-save-failure-restores-order', ids().join() === priorFailure.join() && await page.evaluate(() => [...document.querySelectorAll('#queueList .q-row')].map(el => el.dataset.id).join()) === priorFailure.join());
  const beforeCancel = sortCalls.length;
  pos = await arm(row('song-0')); await page.mouse.move(pos.x, pos.y + 120); await sleep(50); await page.keyboard.press('Escape'); await page.mouse.up(); await sleep(180);
  check('UI-08-escape-cancels-without-write', sortCalls.length === beforeCancel && !await page.$('.reorder-layer') && ids().join() === priorFailure.join());

  await page.evaluate(() => document.getElementById('listTabs').scrollLeft = 0);
  const active = await page.evaluate(() => window.__playerDebug.activeList());
  pos = await arm('#listTabs [data-list="local"]');
  const tab0 = await (await page.$('#listTabs .list-tab')).boundingBox();
  await page.mouse.move(tab0.x + tab0.width / 2 - 10, pos.y, { steps: 8 }); await release();
  check('UI-09-variable-width-tabs-reorder-without-selection', values.get('player-lists')[0].id === 'local' && await page.evaluate(() => window.__playerDebug.activeList()) === active, values.get('player-lists').slice(0, 5));
  await page.evaluate(() => document.getElementById('listTabs').scrollLeft = 0);
  await arm('#listTabs [data-list="imp:1"]'); await release();
  check('UI-10-stationary-tab-hold-only-sorts', await page.evaluate(() => document.getElementById('listPop').hidden) && await page.evaluate(() => window.__playerDebug.activeList()) === active);
  await sleep(850);
  await page.click('#listTabs [data-list="imp:1"]', { button: 'right' });
  check('UI-10b-right-click-keeps-management-menu', await page.evaluate(() => !document.getElementById('listPop').hidden));
  await page.keyboard.press('Escape');

  pos = await arm(row('song-0'));
  const bounds = await page.$eval('#queueList', el => { const r = el.getBoundingClientRect(); return { bottom: r.bottom, top: r.top }; });
  await page.mouse.move(pos.x, bounds.bottom - 4); await sleep(500);
  check('UI-11-song-edge-auto-scroll', await page.$eval('#queueList', el => el.scrollTop) > 80);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.evaluate(() => document.getElementById('queueList').scrollTop = 0);
  pos = await arm('#listTabs .list-tab');
  const tabBounds = await page.$eval('#listTabs', el => { const r = el.getBoundingClientRect(); return { right: r.right }; });
  await page.mouse.move(tabBounds.right - 3, pos.y); await sleep(500);
  check('UI-12-tab-edge-auto-scroll', await page.$eval('#listTabs', el => el.scrollLeft) > 60);
  await page.keyboard.press('Escape'); await page.mouse.up();

  await page.evaluate(() => document.getElementById('queueList').scrollTop = 0);
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const touchBox = await (await page.$(row('song-0'))).boundingBox();
  const point = { x: touchBox.x + 30, y: touchBox.y + touchBox.height / 2 };
  const touchCalls = sortCalls.length;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }); await sleep(510);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y + 130 }] }); await sleep(160);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(850);
  check('UI-13-real-touch-hold-drags-and-saves', sortCalls.length === touchCalls + 1 && ids().indexOf('song-0') === 2, { calls: sortCalls.slice(touchCalls), order: ids().slice(0, 5) });
  await page.evaluate(() => document.getElementById('queueList').scrollTop = 0);
  const scrollCalls = sortCalls.length;
  const start = { x: point.x, y: bounds.bottom - 60 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  for (let i = 1; i <= 5; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y - i * 25 }] }); await sleep(25); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(250);
  check('UI-14-normal-touch-swipe-still-scrolls', sortCalls.length === scrollCalls && await page.$eval('#queueList', el => el.scrollTop) > 0);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });

  await page.setViewport({ width: 1040, height: 780 }); await sleep(300); await page.click('#searchEntryBtn'); await sleep(400);
  const footer = async () => page.evaluate(() => {
    const f = document.getElementById('searchFooter').getBoundingClientRect(), ctl = document.getElementById('controls').getBoundingClientRect(), page = document.getElementById('searchPage').getBoundingClientRect(), b = document.getElementById('repoLinkBtn').getBoundingClientRect();
    return { ok: b.width > 0 && b.left >= page.left && b.right <= page.right && f.bottom <= ctl.top + 1 && f.bottom <= page.bottom + 1, y: f.top };
  });
  check('UI-15-github-footer-above-controls', (await footer()).ok);
  const footBefore = await footer();
  await page.evaluate(() => { document.getElementById('searchDiscover').scrollTop = 1000; window.__playerDebug.renderResults([{ id: 'demo', title: '搜索结果', author: '歌手', url: '/demo', dur: 120 }]); });
  check('UI-16-footer-stable-in-discover-and-results', (await footer()).ok && Math.abs((await footer()).y - footBefore.y) < 2);
  await page.click('#repoLinkBtn');
  check('UI-17-github-uses-host-external-open', externalCalls.length === 1 && externalCalls[0].url === 'https://github.com/wqh0201-stack/hanako-simple-player');
  await page.screenshot({ path: path.join(out, 'search-light-1040.png') });
  for (const [width, height] of [[312,494], [561,500], [465,930], [1040,780]]) {
    await page.setViewport({ width, height }); await sleep(250);
    check('UI-18-footer-fits-' + width, (await footer()).ok);
    if (width === 561) check('UI-18b-compact-results-retain-space', await page.$eval('#searchList', el => el.clientHeight) >= 230, await page.$eval('#searchList', el => el.clientHeight));
    await page.screenshot({ path: path.join(out, 'search-light-' + width + '.png') });
  }
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport({ width: 465, height: 930 });
  await page.evaluate(() => window.__playerDebug.closeSearch()); await sleep(300);
  await page.evaluate(() => document.getElementById('queueList').scrollTop = 0);
  pos = await arm(row(ids()[0]));
  await page.mouse.move(pos.x, pos.y + 90); await sleep(120);
  check('UI-19-reduced-motion-removes-neighbor-squash', await page.evaluate(() => [...document.querySelectorAll('#queueList .q-row:not(.is-reorder-source)')].every(el => new DOMMatrix(getComputedStyle(el).transform).m22 === 1)));
  await release();
  await page.focus(row(ids()[0]));
  const keyboardItem = ids()[0], keyboardCalls = sortCalls.length;
  await page.keyboard.down('Alt'); await page.keyboard.down('Shift'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Shift'); await page.keyboard.up('Alt'); await sleep(450);
  check('UI-21-keyboard-move-saves-and-retains-focus', sortCalls.length === keyboardCalls + 1 && ids()[1] === keyboardItem && await page.evaluate(() => document.activeElement.closest('.q-row')?.dataset.id) === keyboardItem);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.evaluate(() => {
    const vars = { '--bg': '#3B4A54', '--bg-card': '#445560', '--text': '#E1EAF0', '--text-muted': '#9FB1BC', '--text-light': '#9FB1BC', '--accent': '#C99AAF', '--border': 'rgba(170,121,141,.16)' };
    Object.entries(vars).forEach(([key, value]) => document.documentElement.style.setProperty(key, value));
    document.documentElement.setAttribute('data-theme', 'midnight');
    document.getElementById('player').setAttribute('data-tone', 'dark');
    document.getElementById('queueList').scrollTop = 0;
  });
  pos = await arm(row(ids()[0])); await page.mouse.move(pos.x, pos.y + 90); await sleep(100);
  await page.screenshot({ path: path.join(out, 'drag-dark-465.png') });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.setViewport({ width: 1040, height: 780 }); await sleep(300); await page.click('#searchEntryBtn'); await sleep(350);
  await page.screenshot({ path: path.join(out, 'search-dark-1040.png') });
  check('UI-22-dark-footer-fits', (await footer()).ok);
  check('UI-20-no-runtime-errors', errors.length === 0, errors);
} catch (err) {
  check('HARNESS-completed', false, String(err.stack || err));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  const failed = results.filter(r => !r.ok);
  const report = { passed: results.length - failed.length, total: results.length, failed, results, sortCalls, errors, externalCalls };
  fs.writeFileSync(path.join(out, 'verify-reorder.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, total: report.total, failed, out }, null, 2));
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = failed.length ? 1 : 0;
}

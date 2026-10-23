#!/usr/bin/env node
/* 独立隔离UI验收：复用verify-ui既有启动/鉴权夹具，不执行原全量套件。
 * 真实生产HTML/JS/CSS/SDK、真实鼠标点击；仅新业务API与音乐数据替身。非真实宿主验收。 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createAudioOwner } from '../lib/audio-owner.js';
import { mergeLibrarySnapshot } from '../lib/library.js';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const puppeteer = require('/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = path.join(repo, 'docs/player-ui/handoffs/playlist-catalog-enrich-20261020'); fs.mkdirSync(out, { recursive: true });
const legacy = fs.readFileSync(path.join(repo, 'tools/verify-ui.mjs'), 'utf8');
const start = legacy.indexOf('const uiDir ='), end = legacy.indexOf('const report =', start);
assert.ok(start > 0 && end > start); const prefix = legacy.slice(start, end); assert.ok(!prefix.includes('import.meta'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const boot = new AsyncFunction('fs', 'http', 'path', 'repo', 'puppeteer', 'CHROME', 'createAudioOwner', 'mergeLibrarySnapshot', 'process', prefix + '\nreturn {browser,server,BASE,UI_BASE,API};');
const env = await boot(fs, http, path, repo, puppeteer, CHROME, createAudioOwner, mergeLibrarySnapshot, { env: { ...process.env, OUT_DIR: out }, argv: [] });
const { browser, server, BASE, UI_BASE, API } = env;
const fx = JSON.parse(fs.readFileSync(path.join(repo, 'tools/fixtures/cover-avril-real-2026-10-20.json'), 'utf8'));
const png = fs.readFileSync(path.join(repo, 'docs/player-ui/assets/demo-cover.png'));
const clone = x => JSON.parse(JSON.stringify(x));
const albums = [34734318, 1515088].map(id => ({ ...(fx.albumList.find(a => a.id === id) || {}), ...fx.albums[id], id, name: id === 34734318 ? 'The Best Damn Thing' : 'Let Go' }));
const report = { isolation: 'localhost fixture APIs; not production Hana or real playlist writes', checks: [], runtimeErrors: [], missingAuth: [], api: [] };
function initial() { return [
  { id: 'bilibili:BV_HANA_11', name: 'Innocence【HQ】', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', lyricOffset: 111 },
  { id: 'bilibili:BV_HANA_22', name: 'Complicated【HQ】', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', lyricOffset: 222 },
  { id: 'bilibili:BV_HANA_11', name: '收藏副本原名', list: 'fav', mode: '在线', url: API + '/_fixture/audio.wav', lyricOffset: 111 }
]; }
let tracks = initial(), saves = 0, activePage = null;
report.diagnostics = [];
const ok = (request, body, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
function coverData(u) {
  const kind = u.searchParams.get('kind');
  if (kind === 'artist') return { ok: true, artist: fx.artist };
  if (kind === 'albums') return { ok: true, albums: fx.albumList, more: false };
  if (kind === 'search') return { ok: true, tracks: fx.searches[u.searchParams.get('title')] || [] };
  if (kind === 'album') return { ok: true, ...(fx.albums[u.searchParams.get('id')] || { tracks: [] }) };
  return { ok: false };
}
async function settle(page) {
  await page.evaluate(async () => {
    const root = document.getElementById('player');
    const animations = root.getAnimations({ subtree: true }).filter(a => a.effect && a.effect.getTiming().iterations !== Infinity);
    await Promise.all(animations.map(a => a.finished.catch(() => {})));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
async function clickUI(page, selector, options) {
  await page.waitForSelector(selector, { visible: true }); await page.hover(selector); await settle(page);
  await page.waitForFunction(sel => { const e = document.querySelector(sel), r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2; const hit = document.elementFromPoint(x, y); return r.width > 0 && r.height > 0 && !e.disabled && !!hit && e.contains(hit); }, {}, selector);
  await page.click(selector, options);
}
async function pageFor(width, height) {
  const page = await browser.newPage(); activePage = page; page.setDefaultTimeout(8000); await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on('pageerror', e => report.runtimeErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) report.runtimeErrors.push(m.text()); });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'sendBeacon', { value: () => true }); window.__catalogUIEvents = [];
    ['pointerdown', 'click', 'contextmenu'].forEach(type => document.addEventListener(type, e => {
      const b = e.target.closest && e.target.closest('button'); const row = { type, id: b ? b.id : e.target.id, list: b && b.getAttribute('data-list') };
      window.__catalogUIEvents.push(row); if (window.__catalogUIEvents.length > 80) window.__catalogUIEvents.shift();
      queueMicrotask(() => { row.coverHidden = document.getElementById('coverPop')?.hidden; row.listHidden = document.getElementById('listPop')?.hidden; row.moreHidden = document.getElementById('morePop')?.hidden; });
    }, true));
  });
  await page.setRequestInterception(true);
  page.on('request', async request => {
    try {
      const u = new URL(request.url()), p = u.pathname;
      if (u.origin !== BASE) {
        if (/\.music\.126\.net$/.test(u.hostname)) return request.respond({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: png });
        if (u.protocol === 'data:' || u.protocol === 'blob:') return request.continue();
        return request.abort();
      }
      if (!p.startsWith(API + '/')) return request.continue();
      if (!request.headers()['x-hana-app-surface-session'] && !u.searchParams.get('appSurfaceSession')) {
        report.missingAuth.push(p); return ok(request, { ok: false }, 403);
      }
      report.api.push({ p, query: u.search, method: request.method() });
      if (p.endsWith('/widget/api/playlist')) {
        if (request.method() === 'POST') { const body = JSON.parse(request.postData()); tracks = clone(Array.isArray(body) ? body : body.tracks); saves++; return ok(request, { ok: true }); }
        return ok(request, { ok: true, tracks });
      }
      if (p.endsWith('/api/lists')) return ok(request, { ok: true, lists: [{ id: 'fav', name: '我的喜欢' }, { id: 'recent', name: '最近播放' }, { id: 'local', name: '本地' }, { id: 'imp:1', name: 'Avril Lavigne' }] });
      if (p.endsWith('/api/catalog/artist')) return ok(request, { ok: true, artist: fx.artist });
      if (p.endsWith('/api/catalog/index')) return ok(request, { ok: true, artist: fx.artist, albums, coverage: { more: false, at: Date.now() } });
      if (p.endsWith('/api/catalog/build')) return ok(request, { ok: true, pending: 0, total: 2, done: 2, complete: true, more: false });
      if (p.endsWith('/api/catalog/cover')) return request.respond({ status: 200, contentType: 'image/png', body: png });
      if (p.endsWith('/api/catalog/lyric')) return request.respond({ status: 200, contentType: 'text/plain', body: '[00:01.00]catalog fixture lyric' });
      if (p.endsWith('/widget/api/music/cover-catalog')) return ok(request, coverData(u));
      return request.continue();
    } catch (e) { report.runtimeErrors.push('fixture: ' + e.stack); if (!request.isInterceptResolutionHandled()) await request.abort(); }
  });
  await page.goto(`${UI_BASE}/${width > 700 ? 'standalone' : 'index'}.html?appSurfaceSession=fake-ticket&hana-theme-appearance=dark`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#listTabs .list-tab[data-list="imp:1"]', { timeout: 12000 });
  const selector = '#listTabs .list-tab[data-list="imp:1"]';
  const tabShown = await page.$eval(selector, e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && !e.closest('[inert]'); });
  if (!tabShown) { await page.waitForSelector('#queueBtn', { visible: true }); await page.click('#queueBtn'); }
  await page.waitForFunction(sel => { const e = document.querySelector(sel), r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && !e.closest('[inert]'); }, {}, selector);
  const tab = await page.$(selector); await tab.evaluate(e => e.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await clickUI(page, selector); await settle(page);
  await page.waitForSelector('#queueList .q-row .q-more', { visible: true }); return page;
}
async function fill(page, id, value) { await page.click(id, { clickCount: 3 }); await page.type(id, value); }
async function check(name, fn) { try { await fn(); report.checks.push({ name, ok: true }); console.log('PASS ' + name); } catch (e) {
  report.checks.push({ name, ok: false, error: String(e.stack || e) }); process.exitCode = 1; console.log('FAIL ' + name + ': ' + e.message);
  if (activePage && !activePage.isClosed()) {
    report.diagnostics.push({ name, state: await activePage.evaluate(() => Object.fromEntries(['queueBtn', 'queue', 'listPop', 'morePop', 'getCoverBtn', 'coverPop', 'coverStartBtn', 'catalogRestoreBtn'].map(id => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return [id, { hidden: e.hidden, disabled: e.disabled, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, display: getComputedStyle(e).display }]; }))) });
    report.diagnostics.at(-1).events = await activePage.evaluate(() => window.__catalogUIEvents);
    await activePage.screenshot({ path: path.join(out, 'catalog-ui-failure-' + report.checks.length + '.png') });
  }
} }
try {
  for (const [width, height] of [[312, 494], [1040, 780]]) {
    tracks = initial(); saves = 0; const page = await pageFor(width, height);
    await check(`${width}-batch-real-menu-click-and-save`, async () => {
      const tab = await page.$('#listTabs .list-tab[data-list="imp:1"]');
      await clickUI(page, '#listTabs .list-tab[data-list="imp:1"]', { button: 'right' });
      await clickUI(page, '#listCoverBtn');
      await page.waitForSelector('#coverPop:not([hidden])'); await fill(page, '#coverArtist', 'Avril Lavigne');
      assert.ok(await page.$eval('#catalogRestoreBtn', e => !e.hidden)); assert.ok(await page.$eval('#coverRestoreBtn', e => !e.hidden));
      await page.click('#coverStartBtn'); await page.waitForFunction(() => !document.getElementById('coverStartBtn').disabled, { timeout: 10000 });
      assert.ok(saves > 0); assert.equal(tracks.find(t => t.id === 'bilibili:BV_HANA_11' && t.list === 'imp:1').name, 'Innocence'); assert.equal(tracks.find(t => t.id === 'bilibili:BV_HANA_22').name, 'Complicated');
    });
    await check(`${width}-single-input-restore-scope-no-catalog-build`, async () => {
      if (!(await page.$eval('#coverPop', e => e.hidden))) await page.click('#coverCloseBtn');
      await clickUI(page, '#queueList .q-row .q-more'); await clickUI(page, '#enrichTrackBtn');
      await page.waitForSelector('#coverPop:not([hidden])'); assert.ok(await page.$eval('#coverSongRow', e => !e.hidden));
      await fill(page, '#coverSong', 'Innocence'); await fill(page, '#coverArtist', 'Avril Lavigne');
      const bounds = await page.$eval('#coverPop', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, overflow: document.documentElement.scrollWidth > innerWidth }; });
      assert.ok(bounds.left >= -1 && bounds.right <= width + 1 && !bounds.overflow, JSON.stringify(bounds));
      await page.screenshot({ path: path.join(out, `catalog-ui-${width}.png`) });
      const second = tracks.find(t => t.id === 'bilibili:BV_HANA_22').name; const beforeRestore = saves;
      await page.click('#catalogRestoreBtn'); await page.waitForFunction(() => !document.getElementById('coverStartBtn').disabled);
      assert.ok(saves > beforeRestore); assert.equal(tracks.find(t => t.id === 'bilibili:BV_HANA_11' && t.list === 'imp:1').name, 'Innocence【HQ】'); assert.equal(tracks.find(t => t.id === 'bilibili:BV_HANA_22').name, second);
      const before = report.api.length, beforeSave = saves; await page.click('#coverStartBtn'); await page.waitForFunction(() => !document.getElementById('coverStartBtn').disabled);
      assert.ok(saves > beforeSave); assert.equal(report.api.slice(before).filter(r => /catalog\/build|cover-catalog/.test(r.p)).length, 0);
    });
    await check(`${width}-single-cover-restore-does-not-touch-other-song`, async () => {
      const other = tracks.find(t => t.id === 'bilibili:BV_HANA_22'), otherPic = other.pic, otherMatch = clone(other.coverMatch);
      const before = saves; await clickUI(page, '#coverRestoreBtn'); await page.waitForFunction(() => !document.getElementById('coverStartBtn').disabled);
      assert.ok(saves > before); assert.equal(tracks.find(t => t.id === other.id).pic, otherPic); assert.deepEqual(tracks.find(t => t.id === other.id).coverMatch, otherMatch);
      assert.ok(tracks.filter(t => t.id === 'bilibili:BV_HANA_11').every(t => !t.coverMatch));
    });
    await page.close(); tracks = initial(); saves = 0; const coverPage = await pageFor(width, height);
    await check(`${width}-old-get-cover-does-not-normalize-or-bind-lyrics`, async () => {
      const before = tracks.map(t => ({ id: t.id, list: t.list, name: t.name, author: t.author, offset: t.lyricOffset }));
      await clickUI(coverPage, '#queueList .q-row .q-more'); await clickUI(coverPage, '#getCoverBtn');
      await coverPage.waitForSelector('#coverPop:not([hidden])'); await fill(coverPage, '#coverSong', 'Innocence'); await fill(coverPage, '#coverArtist', 'Avril Lavigne');
      await coverPage.click('#coverStartBtn'); await coverPage.waitForFunction(() => !document.getElementById('coverStartBtn').disabled, { timeout: 10000 });
      assert.ok(saves > 0); assert.deepEqual(tracks.map(t => ({ id: t.id, list: t.list, name: t.name, author: t.author, offset: t.lyricOffset })), before);
      assert.ok(tracks.every(t => !t.catalogMatch && !t.catalogLyric)); assert.ok(tracks.some(t => t.coverMatch));
    });
    await coverPage.close();
  }
  assert.deepEqual(report.runtimeErrors, []); assert.deepEqual(report.missingAuth, []);
} catch (e) { process.exitCode = 1; report.runtimeErrors.push(String(e.stack || e)); console.log('UI_HARNESS_ERROR ' + e.message); }
finally { fs.writeFileSync(path.join(out, 'catalog-ui-hana.json'), JSON.stringify(report, null, 2)); await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
console.log(`HANA_CATALOG_UI ${report.checks.filter(x => x.ok).length}/${report.checks.length}`, JSON.stringify(report.runtimeErrors));

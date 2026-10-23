#!/usr/bin/env node
/* 混合歌单 UI 最小真实点击证据：312/1040 一轮，生产 DOM/控制器，仅 mock 业务 API。
 * 不截图、不跑旧套；检查搜索/选择/应用/编辑/取消与真实保存 payload。 */
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
assert.ok(start > 0 && end > start);
const prefix = legacy.slice(start, end);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const boot = new AsyncFunction('fs', 'http', 'path', 'repo', 'puppeteer', 'CHROME', 'createAudioOwner', 'mergeLibrarySnapshot', 'process', prefix + '\nreturn {browser,server,BASE,UI_BASE,API};');
const env = await boot(fs, http, path, repo, puppeteer, CHROME, createAudioOwner, mergeLibrarySnapshot, { env: { ...process.env, OUT_DIR: out }, argv: [] });
const { browser, server, BASE, UI_BASE, API } = env;
const png = fs.readFileSync(path.join(repo, 'docs/player-ui/assets/demo-cover.png'));
const clone = x => JSON.parse(JSON.stringify(x));
const taylor = { id: 44266, name: 'Taylor Swift' };
const other = { id: 9001, name: 'Mixed Artist' };
const searchTracks = {
  'Anti-Hero': [
    { songId: 401, title: 'Anti-Hero', artists: [taylor], albumId: 4, album: 'Midnights', duration: 200, pic: 'https://p1.music.126.net/anti.jpg' },
    { songId: 402, title: 'Anti-Hero', artists: [taylor], albumId: 5, album: 'Anti-Hero Single', duration: 205, pic: 'https://p1.music.126.net/anti2.jpg' }
  ],
  'Pure Song': [{ songId: 501, title: 'Pure Song', artists: [other], albumId: 6, album: 'Mixed Album', duration: 300, pic: 'https://p1.music.126.net/pure.jpg' }]
};
const albumTracks = {
  4: [{ songId: 401, title: 'Anti-Hero', artists: [taylor], albumId: 4, album: 'Midnights', duration: 200, pic: 'https://p1.music.126.net/anti.jpg' }],
  5: [{ songId: 402, title: 'Anti-Hero', artists: [taylor], albumId: 5, album: 'Anti-Hero Single', duration: 205, pic: 'https://p1.music.126.net/anti2.jpg' }],
  6: [{ songId: 501, title: 'Pure Song', artists: [other], albumId: 6, album: 'Mixed Album', duration: 300, pic: 'https://p1.music.126.net/pure.jpg' }]
};
function initial() {
  return [
    { id: 'bilibili:BV_MIX_1', name: 'Anti-Hero', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', dur: 200, pic: 'https://i0.hdslb.com/1.jpg', catalogMatch: { provider: 'netease', songId: 401, albumId: 4, title: 'Anti-Hero', artist: 'Taylor Swift', artistId: 44266, artists: [taylor] }, album: 'Midnights', albumId: 4, songId: 401 },
    { id: 'bilibili:BV_MIX_2', name: 'Pure Song', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', dur: 300, pic: 'https://i0.hdslb.com/2.jpg' },
    { id: 'bilibili:BV_MIX_3', name: 'Artist Three - Song Three', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', dur: 240, pic: 'https://i0.hdslb.com/3.jpg' },
    { id: 'bilibili:BV_MIX_4', name: 'Song Four', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', dur: 180, pic: 'https://i0.hdslb.com/4.jpg' },
    { id: 'bilibili:BV_MIX_5', name: 'Song Five', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', dur: 210, pic: 'https://i0.hdslb.com/5.jpg' },
    { id: 'bilibili:BV_MIX_6', name: 'Song Six', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', dur: 220, pic: 'https://i0.hdslb.com/6.jpg' },
    { id: 'bilibili:BV_MIX_7', name: 'Song Seven', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', dur: 230, pic: 'https://i0.hdslb.com/7.jpg' },
    { id: 'bilibili:BV_MIX_8', name: 'Song Eight', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', dur: 240, pic: 'https://i0.hdslb.com/8.jpg' }
  ];
}
let tracks = initial(), saves = 0, activePage = null;
const report = { isolation: 'localhost fixture APIs; not production Hana or real playlist writes', checks: [], runtimeErrors: [], missingAuth: [], api: [], payloads: [] };
const ok = (request, body, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
function coverData(u) {
  const kind = u.searchParams.get('kind');
  if (kind === 'artist') return { ok: true, artist: taylor };
  if (kind === 'search') return { ok: true, tracks: searchTracks[u.searchParams.get('title')] || [] };
  if (kind === 'album') return { ok: true, ...(albumTracks[Number(u.searchParams.get('id'))] || { tracks: [] }) };
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
async function clickUI(page, selector) {
  await page.waitForSelector(selector, { visible: true }); await page.hover(selector); await settle(page);
  await page.waitForFunction(sel => { const e = document.querySelector(sel), r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, hit = document.elementFromPoint(x, y); return r.width > 0 && r.height > 0 && !e.disabled && !!hit && e.contains(hit); }, {}, selector);
  await page.click(selector);
}
async function pageFor(width, height) {
  const page = await browser.newPage(); activePage = page; page.setDefaultTimeout(8000); await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on('pageerror', e => report.runtimeErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) report.runtimeErrors.push(m.text()); });
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
      if (!request.headers()['x-hana-app-surface-session'] && !u.searchParams.get('appSurfaceSession')) { report.missingAuth.push(p); return ok(request, { ok: false }, 403); }
      report.api.push({ p, query: u.search, method: request.method() });
      if (p.endsWith('/widget/api/playlist')) {
        if (request.method() === 'POST') { const body = JSON.parse(request.postData()); report.payloads.push(clone(body)); tracks = clone(Array.isArray(body) ? body : body.tracks); saves++; return ok(request, { ok: true }); }
        return ok(request, { ok: true, tracks });
      }
      if (p.endsWith('/api/lists')) return ok(request, { ok: true, lists: [{ id: 'fav', name: '我的喜欢' }, { id: 'recent', name: '最近播放' }, { id: 'local', name: '本地' }, { id: 'imp:1', name: '混合歌单' }] });
      if (p.endsWith('/widget/api/music/cover-catalog')) return ok(request, coverData(u));
      if (p.endsWith('/api/catalog/cover')) return request.respond({ status: 200, contentType: 'image/png', body: png });
      if (p.endsWith('/api/catalog/lyric')) return request.respond({ status: 200, contentType: 'text/plain', body: '[00:01.00]fixture lyric' });
      return request.continue();
    } catch (e) { report.runtimeErrors.push('fixture: ' + e.stack); if (!request.isInterceptionResolutionHandled()) await request.abort(); }
  });
  await page.goto(`${UI_BASE}/${width > 700 ? 'standalone' : 'index'}.html?appSurfaceSession=fake-ticket&hana-theme-appearance=dark`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#listTabs .list-tab[data-list="imp:1"]', { timeout: 12000 });
  const selector = '#listTabs .list-tab[data-list="imp:1"]';
  const tabShown = await page.$eval(selector, e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && !e.closest('[inert]'); });
  if (!tabShown) { await page.waitForSelector('#queueBtn', { visible: true }); await page.click('#queueBtn'); }
  await page.waitForFunction(sel => { const e = document.querySelector(sel), r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && !e.closest('[inert]'); }, {}, selector);
  await clickUI(page, selector); await settle(page);
  await page.waitForSelector('#queueList .q-row .q-more', { visible: true }); return page;
}
async function fill(page, id, value) { await page.click(id, { clickCount: 3 }); await page.type(id, value); }
async function check(name, fn) { try { await fn(); report.checks.push({ name, ok: true }); console.log('PASS ' + name); } catch (e) { report.checks.push({ name, ok: false, error: String(e.stack || e) }); process.exitCode = 1; console.log('FAIL ' + name + ': ' + e.message); } }
try {
  for (const [width, height] of [[312, 494], [1040, 780]]) {
    tracks = initial(); saves = 0; report.payloads = [];
    const page = await pageFor(width, height);
    await check(`${width}-match-search-select-apply-real-save`, async () => {
      await clickUI(page, '#queueList .q-row .q-more');
      await clickUI(page, '#matchTrackBtn');
      await page.waitForSelector('#matchPop:not([hidden])');
      assert.ok((await page.$eval('#matchCurrent', e => e.textContent)).includes('Anti-Hero'));
      await fill(page, '#matchArtist', 'Taylor Swift');
      await page.click('#matchSearchBtn');
      await page.waitForSelector('#matchList .match-choice');
      assert.equal(await page.$$eval('#matchList .match-choice', els => els.length), 2);
      await page.click('#matchList .match-choice:nth-child(2)');
      await page.click('#matchApplyBtn');
      await page.waitForFunction(() => document.getElementById('matchPop').hidden, { timeout: 10000 });
      assert.ok(saves > 0);
      const saved = tracks.find(t => t.id === 'bilibili:BV_MIX_1');
      assert.equal(saved.catalogMatch.songId, 402);
      assert.equal(saved.catalogMatch.albumId, 5);
      assert.equal(saved.name, 'Anti-Hero');
      assert.equal(tracks.find(t => t.id === 'bilibili:BV_MIX_2').name, 'Pure Song');
    });
    await check(`${width}-edit-display-does-not-change-reference`, async () => {
      const before = clone(tracks.find(t => t.id === 'bilibili:BV_MIX_2'));
      const beforeSaves = saves;
      await clickUI(page, '#queueList .q-row:nth-child(2) .q-more');
      await clickUI(page, '#editInfoBtn');
      await page.waitForSelector('#editPop:not([hidden])');
      await fill(page, '#editSong', 'Edited Display');
      await fill(page, '#editArtist', 'Edited Artist');
      await page.click('#editSaveBtn');
      await page.waitForFunction(() => document.getElementById('editPop').hidden, { timeout: 10000 });
      assert.ok(saves > beforeSaves);
      const after = tracks.find(t => t.id === 'bilibili:BV_MIX_2');
      assert.equal(after.name, 'Edited Display');
      assert.equal(after.author, 'Edited Artist');
      assert.deepEqual(after.catalogMatch, before.catalogMatch);
      assert.equal(after.pic, before.pic);
      assert.equal(tracks.find(t => t.id === 'bilibili:BV_MIX_1').catalogMatch.songId, 402);
    });
    await check(`${width}-cancel-search-no-write`, async () => {
      const beforeSaves = saves;
      await clickUI(page, '#queueList .q-row:nth-child(1) .q-more');
      await clickUI(page, '#matchTrackBtn');
      await page.waitForSelector('#matchPop:not([hidden])');
      await page.click('#matchSearchBtn');
      await page.waitForSelector('#matchList .match-choice');
      await page.click('#matchCancelBtn');
      await page.waitForFunction(() => document.getElementById('matchPop').hidden);
      assert.equal(saves, beforeSaves);
    });
    const bounds = await page.$eval('#matchPop', e => { const r = e.getBoundingClientRect(); return { hidden: e.hidden, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    assert.ok(bounds.hidden || (bounds.left >= -1 && bounds.right <= width + 1 && bounds.top >= -1 && bounds.bottom <= height + 1), JSON.stringify(bounds));
    await page.close();
  }
  assert.deepEqual(report.runtimeErrors, []);
  assert.deepEqual(report.missingAuth, []);
} catch (e) { process.exitCode = 1; report.runtimeErrors.push(String(e.stack || e)); console.log('UI_HARNESS_ERROR ' + e.message); }
finally { fs.writeFileSync(path.join(out, 'mixed-reference-ui-hana.json'), JSON.stringify(report, null, 2)); await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
console.log(`MIXED_REFERENCE_UI ${report.checks.filter(x => x.ok).length}/${report.checks.length}`, JSON.stringify(report.runtimeErrors));

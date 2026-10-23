#!/usr/bin/env node
/* 统一「编辑歌曲」最小真实 DOM 证据：312/1040 一次，生产控制器与保存 payload。 */
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
const A = { id: 1, name: 'Artist A' };
const B = { id: 2, name: 'Artist B' };
const searchTracks = {
  'Shared Song': [
    { songId: 11, title: 'Shared Song', artists: [A], albumId: 11, album: 'A Album', duration: 240, pic: 'https://p1.music.126.net/a11.jpg' },
    { songId: 13, title: 'Shared Song', artists: [A], albumId: 13, album: 'A Single', duration: 241, pic: 'https://p1.music.126.net/a13.jpg' },
    { songId: 12, title: 'Shared Song', artists: [B], albumId: 12, album: 'B Album', duration: 239, pic: 'https://p1.music.126.net/b12.jpg' }
  ],
  'Edit Only': [{ songId: 21, title: 'Edit Only', artists: [A], albumId: 21, album: 'Edit Album', duration: 200, pic: 'https://p1.music.126.net/e21.jpg' }]
};
const albumTracks = {
  11: [{ songId: 11, title: 'Shared Song', artists: [A], albumId: 11, album: 'A Album', duration: 240, pic: 'https://p1.music.126.net/a11.jpg' }],
  13: [{ songId: 13, title: 'Shared Song', artists: [A], albumId: 13, album: 'A Single', duration: 241, pic: 'https://p1.music.126.net/a13.jpg' }],
  21: [{ songId: 21, title: 'Edit Only', artists: [A], albumId: 21, album: 'Edit Album', duration: 200, pic: 'https://p1.music.126.net/e21.jpg' }]
};
function initial() {
  return [
    { id: 'bilibili:BV_EDIT_1', name: 'Shared Song', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', dur: 240, pic: 'https://i0.hdslb.com/e1.jpg', catalogMatch: { provider: 'netease', songId: 11, albumId: 11, title: 'Shared Song', artist: 'Artist A', artistId: 1, artists: [A] }, album: 'A Album', albumId: 11, songId: 11, lyricMatch: { song: 'manual', keyword: 'manual' }, lyricOffset: 123 },
    { id: 'bilibili:BV_EDIT_2', name: 'Edit Only', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', dur: 200, pic: 'https://i0.hdslb.com/e2.jpg' },
    { id: 'bilibili:BV_EDIT_3', name: 'No Artist Song', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', dur: 180, pic: 'https://i0.hdslb.com/e3.jpg', catalogPending: { artist: 'Artist A', reason: 'no-match' } },
    { id: 'bilibili:BV_EDIT_4', name: 'Cancel Song', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', dur: 190, pic: 'https://i0.hdslb.com/e4.jpg' },
    { id: 'bilibili:BV_EDIT_5', name: 'Duo Song', list: 'imp:1', mode: '在线', url: API + '/_fixture/audio.wav', dur: 190, author: 'Artist A / Artist B', pic: 'https://i0.hdslb.com/e5.jpg' }
  ];
}
let tracks = initial(), saves = 0, failNextSave = false, activePage = null;
const report = { isolation: 'localhost fixture APIs; not production Hana or real playlist writes', checks: [], runtimeErrors: [], missingAuth: [], api: [], payloads: [] };
const ok = (request, body, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
function coverData(u) {
  const kind = u.searchParams.get('kind');
  if (kind === 'artist') return { ok: true, artist: A };
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
  await page.waitForSelector(selector, { visible: true });
  await page.$eval(selector, e => e.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  await page.hover(selector); await settle(page);
  await page.waitForFunction(sel => { const e = document.querySelector(sel), r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, hit = document.elementFromPoint(x, y); return r.width > 0 && r.height > 0 && !e.disabled && !!hit && e.contains(hit); }, {}, selector);
  await page.click(selector);
}
async function pageFor(width, height) {
  const page = await browser.newPage(); activePage = page; page.setDefaultTimeout(8000); await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on('pageerror', e => report.runtimeErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) report.runtimeErrors.push(m.text()); });
  await page.evaluateOnNewDocument(() => {
    window.__copied = '';
    document.execCommand = command => { if (command === 'copy') { window.__copied = document.activeElement ? document.activeElement.value : ''; return true; } return false; };
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
      if (!request.headers()['x-hana-app-surface-session'] && !u.searchParams.get('appSurfaceSession')) { report.missingAuth.push(p); return ok(request, { ok: false }, 403); }
      report.api.push({ p, query: u.search, method: request.method() });
      if (p.endsWith('/widget/api/playlist')) {
        if (request.method() === 'POST') {
          if (failNextSave) { failNextSave = false; return ok(request, { ok: false }, 500); }
          const body = JSON.parse(request.postData()); report.payloads.push(clone(body)); tracks = clone(Array.isArray(body) ? body : body.tracks); saves++; return ok(request, { ok: true });
        }
        return ok(request, { ok: true, tracks });
      }
      if (p.endsWith('/api/lists')) return ok(request, { ok: true, lists: [{ id: 'fav', name: '我的喜欢' }, { id: 'recent', name: '最近播放' }, { id: 'local', name: '本地' }, { id: 'imp:1', name: '编辑歌单' }] });
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
  if (process.env.PENDING_ONLY) {
    for (const [width, height] of [[312, 494], [1040, 780]]) {
      tracks = initial(); tracks[2].author = 'Artist B'; tracks[2].catalogPending = { artist: 'Artist A', reason: 'no-match' }; tracks[2].catalogBackup = { name: 'Original No Artist', author: 'Original UP', artist: 'Original UP', hadAlbum: false, hadAlbumId: false, hadSongId: false }; tracks[2].coverMatch = { albumId: 90, pic: 'https://i0.hdslb.com/current.jpg', originalPic: 'https://i0.hdslb.com/original.jpg' }; tracks[2].coverBasePic = 'https://i0.hdslb.com/original.jpg'; saves = 0; report.payloads = [];
      const page = await pageFor(width, height);
      await check(`${width}-pending-search-defaults-A-keeps-display-B`, async () => {
        await clickUI(page, '#queueList .q-row:nth-child(3) .q-more');
        await clickUI(page, '#editSongBtn');
        await page.waitForSelector('#songEditPop:not([hidden])');
        assert.equal(await page.$eval('#songEditArtist', e => e.value), 'Artist B');
        assert.equal(await page.$eval('#songEditSearchArtist', e => e.value), 'Artist A');
        assert.equal(await page.$eval('#songEditPending', e => e.hidden), false);
        const bounds = await page.$eval('#songEditPop', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
        assert.ok(bounds.left >= -1 && bounds.right <= width + 1 && bounds.top >= -1 && bounds.bottom <= height + 1, JSON.stringify(bounds));
        await page.click('#songEditSearchBtn');
        await page.waitForFunction(() => !document.getElementById('songEditSearchBtn').disabled);
        await page.click('#songEditSave');
        await page.waitForFunction(() => document.getElementById('songEditPop').hidden, { timeout: 10000 });
        const saved = tracks.find(t => t.id === 'bilibili:BV_EDIT_3');
        assert.equal(saved.author, 'Artist B');
        assert.equal(saved.catalogPending && saved.catalogPending.artist, 'Artist A');
      });
      await check(`${width}-restore-actions-are-draft`, async () => {
        const beforeSaves = saves;
        await clickUI(page, '#queueList .q-row:nth-child(3) .q-more');
        await clickUI(page, '#editSongBtn');
        await page.waitForSelector('#songEditPop:not([hidden])');
        await clickUI(page, '#songEditRestoreInfo');
        assert.equal(saves, beforeSaves);
        assert.equal(await page.$eval('#songEditName', e => e.value), 'Original No Artist');
        await clickUI(page, '#songEditRestoreCover');
        assert.equal(saves, beforeSaves);
        await page.click('#songEditCancel');
        await page.waitForFunction(() => document.getElementById('songEditPop').hidden);
        const still = tracks.find(t => t.id === 'bilibili:BV_EDIT_3');
        assert.equal(still.name, 'No Artist Song');
        assert.equal(still.pic, 'https://i0.hdslb.com/e3.jpg');
        assert.equal(still.catalogPending && still.catalogPending.artist, 'Artist A');
      });
      await check(`${width}-lyric-link-keeps-dirty-draft`, async () => {
        await clickUI(page, '#queueList .q-row:nth-child(2) .q-more');
        await clickUI(page, '#editSongBtn');
        await page.waitForSelector('#songEditPop:not([hidden])');
        await fill(page, '#songEditName', 'Dirty Draft');
        await clickUI(page, '#songEditLyricBtn');
        assert.ok(!(await page.$eval('#songEditPop', e => e.hidden)));
        assert.ok((await page.$eval('#songEditNote', e => e.textContent)).includes('未保存'));
        await page.click('#songEditCancel');
      });
      await page.close();
    }
  } else {
  for (const [width, height] of [[312, 494], [1040, 780]]) {
    tracks = initial(); saves = 0; failNextSave = false; report.payloads = [];
    const page = await pageFor(width, height);
    await check(`${width}-single-editor-entry-ref-cover-save`, async () => {
      const beforeDraftSaves = saves;
      await clickUI(page, '#queueList .q-row:nth-child(1) .q-more');
      assert.equal(await page.$$eval('#morePop .pop-item', els => els.filter(e => !e.hidden).map(e => e.id).includes('editSongBtn')), true);
      assert.equal(await page.$$eval('#morePop .pop-item', els => els.some(e => /getCoverBtn|matchTrackBtn|editInfoBtn|enrichTrackBtn/.test(e.id))), false);
      await clickUI(page, '#editSongBtn');
      await page.waitForSelector('#songEditPop:not([hidden])');
      const bounds = await page.$eval('#songEditPop', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scroll: e.querySelector('.song-edit-scroll').scrollHeight, client: e.querySelector('.song-edit-scroll').clientHeight }; });
      assert.ok(bounds.left >= -1 && bounds.right <= width + 1 && bounds.top >= -1 && bounds.bottom <= height + 1, JSON.stringify(bounds));
      await page.click('#songEditSearchBtn');
      await page.waitForSelector('#songEditCandidates .match-choice');
      assert.equal(await page.$$eval('#songEditCandidates .match-choice', els => els.length), 2); // A only: album 11/13; B rejected
      await clickUI(page, '#songEditCandidates .match-choice:nth-child(1)');
      await page.waitForFunction(() => !document.getElementById('songEditCoverNote').textContent.includes('正在') && document.querySelectorAll('#songEditCovers .cover-choice').length > 0);
      await clickUI(page, '#songEditCovers .cover-choice:nth-child(2)');
      assert.equal(saves, beforeDraftSaves);
      await page.click('#songEditSave');
      await page.waitForFunction(() => document.getElementById('songEditPop').hidden, { timeout: 10000 });
      const saved = tracks.find(t => t.id === 'bilibili:BV_EDIT_1');
      assert.equal(saved.catalogMatch.songId, 11);
      assert.equal(saved.coverMatch && saved.coverMatch.albumId, 13);
      assert.equal(saved.lyricMatch && saved.lyricMatch.keyword, 'manual');
      assert.equal(saved.lyricOffset, 123);
      assert.ok(saves > 0);
    });
    await check(`${width}-edit-only-does-not-change-reference`, async () => {
      const before = clone(tracks.find(t => t.id === 'bilibili:BV_EDIT_2'));
      await clickUI(page, '#queueList .q-row:nth-child(2) .q-more');
      await clickUI(page, '#editSongBtn');
      await page.waitForSelector('#songEditPop:not([hidden])');
      await fill(page, '#songEditName', 'Edited Display');
      await fill(page, '#songEditArtist', 'Edited Artist');
      await page.click('#songEditSave');
      await page.waitForFunction(() => document.getElementById('songEditPop').hidden, { timeout: 10000 });
      const after = tracks.find(t => t.id === 'bilibili:BV_EDIT_2');
      assert.equal(after.name, 'Edited Display');
      assert.deepEqual(after.catalogMatch, before.catalogMatch);
      assert.equal(after.pic, before.pic);
      assert.ok(after.catalogBackup && after.catalogBackup.name === 'Edit Only');
    });
    await check(`${width}-cancel-no-write-and-copy-artist`, async () => {
      const beforeSaves = saves;
      assert.equal(await page.$eval('#queueList .q-row:nth-child(3) .q-pending', e => e.textContent), '待确认');
      await clickUI(page, '#queueList .q-row:nth-child(5) .q-more');
      await clickUI(page, '#copyArtistBtn');
      assert.equal(await page.evaluate(() => window.__copied), 'Artist A / Artist B');
      await page.evaluate(() => { window.__copied = ''; });
      await clickUI(page, '#queueList .q-row:nth-child(3) .q-more');
      await clickUI(page, '#copyArtistBtn');
      assert.equal(await page.evaluate(() => window.__copied), '');
      assert.ok((await page.$eval('#toast', e => e.textContent)).includes('没有歌手'));
      await clickUI(page, '#queueList .q-row:nth-child(3) .q-more');
      await clickUI(page, '#editSongBtn');
      await page.waitForSelector('#songEditPop:not([hidden])');
      assert.equal(await page.$eval('#songEditPending', e => e.hidden), false);
      await page.waitForSelector('#songEditPop:not([hidden])');
      await fill(page, '#songEditName', 'Should Not Save');
      await page.click('#songEditCancel');
      await page.waitForFunction(() => document.getElementById('songEditPop').hidden);
      assert.equal(saves, beforeSaves);
      assert.equal(tracks.find(t => t.id === 'bilibili:BV_EDIT_3').name, 'No Artist Song');
    });
    await check(`${width}-save-failure-rolls-back`, async () => {
      const before = tracks.find(t => t.id === 'bilibili:BV_EDIT_2');
      await clickUI(page, '#queueList .q-row:nth-child(2) .q-more');
      await clickUI(page, '#editSongBtn');
      await page.waitForSelector('#songEditPop:not([hidden])');
      await fill(page, '#songEditName', 'Will Fail');
      failNextSave = true;
      await page.click('#songEditSave');
      await page.waitForFunction(() => !document.getElementById('songEditSave').disabled, { timeout: 10000 });
      assert.equal(tracks.find(t => t.id === 'bilibili:BV_EDIT_2').name, before.name);
      assert.ok(!(await page.$eval('#songEditPop', e => e.hidden)));
      await page.click('#songEditCancel');
    });
    await page.close();
  }
  }
  assert.deepEqual(report.runtimeErrors, []);
  assert.deepEqual(report.missingAuth, []);
} catch (e) { process.exitCode = 1; report.runtimeErrors.push(String(e.stack || e)); console.log('UI_HARNESS_ERROR ' + e.message); }
finally { fs.writeFileSync(path.join(out, process.env.PENDING_ONLY ? 'unified-editor-pending-ui-hana.json' : 'unified-editor-ui-hana.json'), JSON.stringify(report, null, 2)); await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
console.log(`UNIFIED_EDITOR_UI ${report.checks.filter(x => x.ok).length}/${report.checks.length}`, JSON.stringify(report.runtimeErrors));

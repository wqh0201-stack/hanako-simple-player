#!/usr/bin/env node
// 生产 app.js + 真实仲裁模块 + 真实 Chrome 媒体；宿主 transport 为可控夹具，不能冒充真机。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createAudioOwner } from 'file:///Volumes/SSD/hanadesk/hanako-audio-player-simple/lib/audio-owner.js';
const require = createRequire(import.meta.url);
const puppeteer = require('/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');
const root = "/Volumes/SSD/hanadesk/hanako-audio-player-simple";
const API = '/api/apps/hanako-simple-player/routes', pages = new Set(), results = [], writes = [], requests = [], errors = [];
const values = new Map();
let playback = null, delayYield = 0;
const wav = Buffer.alloc(44 + 16000 * 30);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const tracks = [1, 2].map(n => ({ id: 'local-' + n, name: '测试曲目 ' + n, list: 'local', mode: '本地', dur: 30, url: API + '/test.wav' }));
async function notify(key) {
  await Promise.all([...pages].map(page => page.evaluate(key => {
    if (window.__audioStorageListeners) [...window.__audioStorageListeners].forEach(fn => fn([key]));
  }, key).catch(() => {})));
}
let service;
function reset(seed = null) {
  values.clear(); writes.length = 0; playback = seed; delayYield = 0;
  service = createAudioOwner({ storage: { get: async key => values.get(key) ?? null, set: async (key, value) => {
    values.set(key, structuredClone(value)); notify(key).catch(() => {});
  } }, writePlayback: async snapshot => { playback = structuredClone(snapshot); writes.push(structuredClone(snapshot)); } });
}
reset();
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  try {
    if (u.pathname.startsWith(API)) {
      if (!req.headers['x-hana-app-surface-session'] && !u.searchParams.get('appSurfaceSession')) return json(res, {}, 403);
      let input;
      if (req.method === 'POST') { const chunks = []; for await (const chunk of req) chunks.push(chunk); input = JSON.parse(Buffer.concat(chunks).toString()); }
      const p = u.pathname.slice(API.length);
      requests.push({ method: req.method, path: p, action: input?.action });
      if (p === '/api/audio-owner') {
        if (input?.action === 'yield' && delayYield) await new Promise(resolve => setTimeout(resolve, delayYield));
        return json(res, input ? await service.command(input) : { ok: true, record: await service.read() });
      }
      if (p === '/api/playback-state') return json(res, input ? await service.savePlayback(input, {
        ownerId: req.headers['x-player-audio-owner'] || u.searchParams.get('audioOwnerId') || '',
        generation: Number(req.headers['x-player-audio-generation'] || u.searchParams.get('audioGeneration') || 0)
      }) : { ok: true, state: playback });
      if (p === '/api/lists') return json(res, { ok: true, lists: [{ id: 'fav', name: '我的喜欢' }, { id: 'recent', name: '最近播放' }, { id: 'local', name: '本地' }] });
      if (p === '/widget/api/playlist') return json(res, { ok: true, tracks, count: tracks.length });
      if (p === '/test.wav') {
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        const start = range ? +range[1] : 0, end = range && range[2] ? +range[2] : wav.length - 1;
        const headers = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 };
        if (range) headers['Content-Range'] = `bytes ${start}-${end}/${wav.length}`;
        res.writeHead(range ? 206 : 200, headers); return res.end(wav.subarray(start, end + 1));
      }
      if (p.includes('/lrc/')) return json(res, { ok: false }, 404);
      return json(res, { ok: true, results: [] });
    }
    const file = path.join(root, 'ui', u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
    if (!file.startsWith(path.join(root, 'ui')) || !fs.existsSync(file)) return json(res, {}, 404);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(file).pipe(res);
  } catch (error) { json(res, { ok: false, error: error.message }, error.code || 500); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 15000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
async function open({ fallback = false, lostHandoff = false } = {}) {
  const page = await browser.newPage(); pages.add(page);
  await page.setViewport({ width: 465, height: 930 });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('close', () => pages.delete(page));
  await page.exposeFunction('__audioStorageGet', key => values.get(key) ?? null);
  await page.exposeFunction('__audioStorageSet', async (key, value) => { values.set(key, value); notify(key).catch(() => {}); });
  await page.evaluateOnNewDocument((fallback, lost) => {
    if (fallback) window.BroadcastChannel = undefined;
    if (lost) { navigator.sendBeacon = () => true; const fetch = window.fetch; window.fetch = function (u, o) { return o?.keepalive ? Promise.resolve(new Response('{}')) : fetch.apply(this, arguments); }; }
    window.__audioStorageListeners = new Set();
    let hana;
    Object.defineProperty(window, 'hana', { configurable: true, get: () => hana, set: value => {
      hana = value;
      if (value?.storage?.global) {
        value.ready = () => Promise.resolve();
        value.storage.global.get = window.__audioStorageGet;
        value.storage.global.set = window.__audioStorageSet;
        value.storage.global.onChanged = fn => { window.__audioStorageListeners.add(fn); return () => window.__audioStorageListeners.delete(fn); };
      }
    } });
  }, fallback, lostHandoff);
  await page.goto(base + '/index.html?appSurfaceSession=test-ticket', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__playerDebug && window.__playerDebug.currentTrack());
  return page;
}
const seed = () => ({ currentId: 'local|local-1', activeList: 'local', currentTrack: tracks[0], progress: 3, playing: true, volume: 0.5, muted: true, mode: 'list' });
const status = page => page.evaluate(() => window.__playerDebug.audioOwner());
const playing = page => page.waitForFunction(() => !document.getElementById('audio').paused, { timeout: 8000, polling: 100 });
try {
  reset(seed());
  const old = await open(); await playing(old);
  const oldState = await status(old), before = await service.read();
  const ownerBefore = values.get('player-audio-owner');
  const cdp = await old.createCDPSession();
  const crashed = new Promise(resolve => old.once('error', e => resolve(String(e))));
  cdp.send('Page.crash').catch(() => {});
  const crashError = await Promise.race([crashed, new Promise((_, reject) => setTimeout(() => reject(new Error('crash event missing')), 5000))]);
  await old.close().catch(() => {});
  const afterCrash = await service.read();
  check('known-dead-document-retains-owner-without-handoff', afterCrash.ownerId === oldState.ownerId && afterCrash.revision === before.revision, { oldState, crashError, afterCrash });
  service = createAudioOwner({ storage: { get: async key => values.get(key) ?? null, set: async (key, value) => { values.set(key, structuredClone(value)); notify(key).catch(() => {}); } }, writePlayback: async snapshot => { playback = structuredClone(snapshot); writes.push(structuredClone(snapshot)); } });
  const fresh = await open();
  await new Promise(resolve => setTimeout(resolve, 400));
  const boot = await status(fresh);
  const clicked = await fresh.evaluate(() => window.__playerDebug.requestPlay('user'));
  const afterClick = await status(fresh);
  check('bug-reproduced-dead-owner-blocks-new-boot-and-click', boot.paused && boot.takeover && clicked === false && afterClick.paused && (await service.read()).ownerId === oldState.ownerId, { boot, clicked, afterClick, record: await service.read() });
  await fresh.close();
  // 同样的后端新实例，也可能对应仍在出声的旧文档；不能把 App 后端重启当页面死亡。
  reset(seed());
  const live = await open(); await playing(live);
  const liveBefore = await status(live);
  service = createAudioOwner({ storage: { get: async key => values.get(key) ?? null, set: async (key, value) => { values.set(key, structuredClone(value)); notify(key).catch(() => {}); } }, writePlayback: async snapshot => { playback = structuredClone(snapshot); writes.push(structuredClone(snapshot)); } });
  const liveRecord = await service.read();
  check('backend-restart-does-not-prove-live-document-stopped', !(await status(live)).paused && liveRecord.ownerId === liveBefore.ownerId, { liveBefore, liveAfter: await status(live), liveRecord });
  await live.close();
  reset(seed());
  const silent = await open({ fallback: true }); await playing(silent);
  const silentBefore = await status(silent);
  pages.delete(silent); // 切断旧页通知，媒体保持播放；模拟活着但收不到消息。
  const candidate = await open({ fallback: true }); await candidate.bringToFront();
  if (await candidate.$eval('#firstRun', e => !e.hidden)) await candidate.click('#firstRunOk');
  await candidate.click('#resumeBtn');
  await new Promise(resolve => setTimeout(resolve, 1800));
  const silentAfter = await status(silent), candidateAfter = await status(candidate);
  check('user-gesture-plus-no-response-does-not-prove-old-media-stopped', !silentAfter.paused && silentAfter.progress > silentBefore.progress + 1 && candidateAfter.paused, { silentBefore, silentAfter, candidateAfter, record: await service.read() });
  await candidate.close(); await silent.close();
} catch (error) { check('probe-error', false, error.stack); }
finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
const out = process.env.OUT_DIR; fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'orphan-repro.json'), JSON.stringify({ purpose: 'Confirmed known-dead owner bug and counterexample to backend epoch; not a functional pass', results, writes, requests, errors }, null, 2));
console.log(JSON.stringify({ reproduced: results.every(x => x.ok), observations: results, outDir: out }, null, 2));
process.exitCode = results.every(x => x.ok) ? 0 : 1;

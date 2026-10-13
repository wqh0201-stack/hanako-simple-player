#!/usr/bin/env node
// 生产 app.js + 真实仲裁模块 + 真实 Chrome 媒体；宿主 transport 为可控夹具，不能冒充真机。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createAudioOwner } from '../lib/audio-owner.js';
const require = createRequire(import.meta.url);
const puppeteer = require('/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = '/api/apps/hanako-simple-player/routes', pages = new Set(), results = [], writes = [], requests = [], errors = [];
const values = new Map();
let playback = null, delayYield = 0, storageMuted = false, fixtureEpoch = 0;
const wav = Buffer.alloc(44 + 16000 * 30);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const tracks = [1, 2].map(n => ({ id: 'local-' + n, name: '测试曲目 ' + n, list: 'local', mode: '本地', dur: 30, url: API + '/test.wav' }));
async function notify(key) {
  if (storageMuted) return;
  await Promise.all([...pages].flatMap(page => page.frames().map(frame => frame.evaluate(key => {
    if (window.__audioStorageListeners) [...window.__audioStorageListeners].forEach(fn => fn([key]));
  }, key).catch(() => {}))));
}
let service;
function reset(seed = null) {
  ++fixtureEpoch;
  values.clear(); writes.length = 0; playback = seed; delayYield = 0; storageMuted = false;
  rebuildService();
}
function rebuildService() {
  const epoch = fixtureEpoch;
  service = createAudioOwner({ storage: { get: async key => values.get(key) ?? null, set: async (key, value) => {
    if (epoch !== fixtureEpoch) return;
    values.set(key, structuredClone(value)); notify(key).catch(() => {});
  } }, writePlayback: async snapshot => {
    if (epoch !== fixtureEpoch) return;
    playback = structuredClone(snapshot); writes.push(structuredClone(snapshot));
  } });
}
reset();
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  // 每轮夹具模拟独立安装数据。旧页 close 后到达的 keepalive 不能跨轮写新 seed。
  const requestService = service;
  const u = new URL(req.url, 'http://127.0.0.1');
  try {
    if (u.pathname.startsWith(API)) {
      const ticket = req.headers['x-hana-app-surface-session'] || u.searchParams.get('appSurfaceSession');
      if (!ticket) return json(res, {}, 403);
      if (ticket !== 'test-ticket-' + fixtureEpoch) return json(res, { ok: false, error: 'fixture ended' }, 409);
      let input;
      if (req.method === 'POST') { const chunks = []; for await (const chunk of req) chunks.push(chunk); input = JSON.parse(Buffer.concat(chunks).toString()); }
      const p = u.pathname.slice(API.length);
      requests.push({ method: req.method, path: p, action: input?.action, input });
      if (p === '/api/audio-owner') {
        if (input?.action === 'yield' && delayYield) await new Promise(resolve => setTimeout(resolve, delayYield));
        return json(res, input ? await requestService.command(input) : { ok: true, record: await requestService.read() });
      }
      if (p === '/api/playback-state') return json(res, input ? await requestService.savePlayback(input, {
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
    if (u.pathname === '/fixture-host') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><iframe id="owner-frame" sandbox="allow-scripts allow-forms allow-popups allow-same-origin" src="/index.html?appSurfaceSession=test-ticket-' + fixtureEpoch + '"></iframe>');
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
async function open({ fallback = false, lostHandoff = false, noLocks = false, securityError = false, opener = null, asIframe = false } = {}) {
  let page;
  if (opener) {
    const popup = new Promise(resolve => opener.once('popup', resolve));
    await opener.evaluate(() => { window.__audioOther = window.open('about:blank'); });
    page = await popup;
  } else page = await browser.newPage();
  pages.add(page);
  await page.setViewport({ width: 465, height: 930 });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('close', () => pages.delete(page));
  await page.exposeFunction('__audioStorageGet', key => values.get(key) ?? null);
  await page.exposeFunction('__audioStorageSet', async (key, value) => { values.set(key, value); notify(key).catch(() => {}); });
  await page.evaluateOnNewDocument((fallback, lost, noLocks, securityError) => {
    if (fallback) window.BroadcastChannel = undefined;
    if (noLocks) Object.defineProperty(navigator, 'locks', { value: undefined });
    if (securityError) Object.defineProperty(navigator, 'locks', { value: {
      request: () => Promise.reject(new DOMException('opaque origin fixture', 'SecurityError'))
    } });
    if (lost) { navigator.sendBeacon = () => true; const fetch = window.fetch; window.fetch = function (u, o) { return o?.keepalive ? Promise.resolve(new Response('{}')) : fetch.apply(this, arguments); }; }
    window.__audioStorageListeners = new Set();
    window.__audioEvents = [];
    document.addEventListener('DOMContentLoaded', () => {
      const audio = document.getElementById('audio');
      if (audio) for (const type of ['loadedmetadata', 'seeking', 'seeked', 'timeupdate', 'play', 'playing', 'pause', 'emptied']) audio.addEventListener(type, () => {
        window.__audioEvents.push({ type, at: performance.now(), time: audio.currentTime, paused: audio.paused });
      });
    });
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
  }, fallback, lostHandoff, noLocks, securityError);
  await page.goto(base + (asIframe ? '/fixture-host' : '/index.html?appSurfaceSession=test-ticket-' + fixtureEpoch), { waitUntil: 'domcontentloaded' });
  const target = asIframe ? page.frames().find(frame => frame.url().includes('/index.html')) : page;
  await target.waitForFunction(() => window.__playerDebug && window.__playerDebug.currentTrack());
  if (asIframe) target.hostPage = page;
  return target;
}
const seed = () => ({ currentId: 'local|local-1', activeList: 'local', currentTrack: tracks[0], progress: 3, playing: true, volume: 0.5, muted: true, mode: 'list' });
const status = page => page.evaluate(() => window.__playerDebug.audioOwner());
const playing = page => page.waitForFunction(() => !document.getElementById('audio').paused, { timeout: 8000, polling: 100 });
async function persistedPlaying() {
  const until = Date.now() + 3000;
  while (!playback?.playing && Date.now() < until) await new Promise(r => setTimeout(r, 10));
  if (!playback?.playing) throw new Error('playing snapshot did not reach fixture disk');
}
try {
  for (const fallback of [false, true]) {
    reset(seed());
    const [a, b] = await Promise.all([open({ fallback }), open({ fallback })]);
    await a.waitForFunction(() => !!window.__playerDebug.audioOwner().record?.ownerId, { timeout: 8000, polling: 100 });
    await new Promise(r => setTimeout(r, 200));
    const [sa, sb] = await Promise.all([status(a), status(b)]);
    check('simultaneous-boot-one-voice-' + fallback, Number(!sa.paused) + Number(!sb.paused) === 1, { sa, sb });
    const active = sa.paused ? b : a, standby = sa.paused ? a : b;
    const before = await status(active);
    await standby.bringToFront();
    await standby.evaluate(() => window.__playerDebug.requestPlay('user'));
    await playing(standby);
    const after = await status(active);
    check('takeover-pauses-preserves-progress-' + fallback, after.paused && !after.playing && Math.abs(after.progress - before.progress) < 1,
      { before, after, events: await active.evaluate(() => window.__audioEvents) });
    await active.evaluate(() => window.__playerDebug.persistNow());
    check('passive-snapshot-false-owner-snapshot-protected-' + fallback, !(await status(active)).snapshot.playing && playback.playing && (await service.read()).ownerId === (await status(standby)).ownerId, playback);
    check('takeover-chip-visible-' + fallback, await active.$eval('#resumeBtn', e => !e.hidden && e.textContent.trim() === '接管播放' && !!e.querySelector('svg')));
    await active.bringToFront();
    // 空夹具会弹既有首次使用提示；按真实使用流程关闭，不能用 DOM click 穿透遮罩。
    if (await active.$eval('#firstRun', e => !e.hidden)) await active.click('#firstRunOk');
    const chipHit = await active.$eval('#resumeBtn', e => {
      const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { x: r.x, y: r.y, width: r.width, height: r.height, reachable: !!hit && e.contains(hit), hit: hit?.outerHTML?.slice(0, 350) };
    });
    check('takeover-chip-pointer-reachable-' + fallback, chipHit.reachable, chipHit);
    await active.click('#resumeBtn'); await playing(active);
    check('chip-reclaims-one-voice-' + fallback, (await status(standby)).paused && !(await status(active)).paused);
    await active.evaluate(() => window.__playerDebug.pauseAll());
    check('manual-pause-stops-all-' + fallback, (await status(a)).paused && (await status(b)).paused && !playback.playing);
    await Promise.all([a.close(), b.close()]);
  }
  reset(seed());
  const one = await open(); await playing(one);
  const before = await status(one);
  await one.reload({ waitUntil: 'domcontentloaded' }); await playing(one);
  const after = await status(one);
  check('single-reload-explicit-handoff-resumes', after.ownerId !== before.ownerId && after.progress >= before.progress - 0.4 && after.playing, { before, after });
  await one.evaluate(() => {
    const uid = window.__playerDebug.currentTrack().uid;
    const hit = document.querySelector('#queueList .q-row[data-uid="' + uid + '"] .q-hit');
    if (!hit) throw new Error('current queue row missing');
    hit.click();
  });
  check('single-reclick-current-keeps-playing-state', (await status(one)).playing && !(await status(one)).paused);
  await one.evaluate(() => { const audio = document.getElementById('audio'); audio.dispatchEvent(new Event('ended')); });
  await one.waitForFunction(() => window.__playerDebug.currentTrack().id === 'local-2' && !document.getElementById('audio').paused);
  check('single-auto-next-unchanged', true);
  await one.close();
  reset(seed());
  const first = await open(); await playing(first);
  const late = await open(); await late.bringToFront();
  delayYield = 2100;
  const timed = await late.evaluate(() => window.__playerDebug.requestPlay('user'));
  await new Promise(resolve => setTimeout(resolve, 1000));
  const grantedButPaused = await status(late);
  check('late-grant-does-not-play-after-wait-ended', timed === false && grantedButPaused.generation > 0 && grantedButPaused.paused, grantedButPaused);
  await late.close(); await new Promise(resolve => setTimeout(resolve, 250));
  check('paused-grantee-close-releases-permit', !(await service.read()).ownerId);
  await first.close();
  reset(seed());
  // 旧断言的反例是“交接丢失 + 旧文档仍活”，不能用关闭旧页来冒充存活。
  const lost = await open({ lostHandoff: true }); await playing(lost);
  const parked = await open(); await new Promise(r => setTimeout(r, 1800));
  check('lost-handoff-remains-standby-no-timeout-play', (await status(parked)).paused && await parked.$eval('#resumeBtn', e => !e.hidden));
  const parkedState = await status(parked);
  check('lock-unavailable-boot-no-claim-no-reap-passive-false', !parkedState.docLockHeld
    && !parkedState.snapshot.playing && !parkedState.playing
    && !requests.some(r => r.input?.ownerId === parkedState.ownerId && r.input.action === 'claim'));
  await lost.close(); await playing(parked);
  check('destroyed-owner-without-handoff-existing-standby-self-heals', (await status(parked)).docLockHeld && ! (await status(parked)).paused);
  await parked.close();

  reset(seed());
  const crashed = await open({ lostHandoff: true }); await playing(crashed);
  await persistedPlaying();
  const prior = await status(crashed); await crashed.close();
  const healed = await open(); await playing(healed);
  const recovered = await status(healed);
  check('destroyed-owner-without-handoff-new-boot-self-heals', recovered.docLockHeld && recovered.playing
    && recovered.ownerId !== prior.ownerId && recovered.generation > prior.generation
    && recovered.progress >= prior.progress - 0.4, { prior, recovered });
  await healed.close();

  reset(seed());
  const orphanSource = await open({ lostHandoff: true }); await playing(orphanSource); await persistedPlaying();
  await orphanSource.close();
  const [rebootA, rebootB] = await Promise.all([open(), open()]);
  await playing((await status(rebootA)).docLockHeld ? rebootA : rebootB);
  const reboots = await Promise.all([status(rebootA), status(rebootB)]);
  check('simultaneous-orphan-boot-only-lock-holder-reaps-one-voice', reboots.filter(s => !s.paused).length === 1
    && reboots.filter(s => s.docLockHeld).length === 1, reboots);
  await Promise.all([rebootA.close(), rebootB.close()]);

  reset(seed());
  const removed = await open({ lostHandoff: true, asIframe: true }); await playing(removed); await persistedPlaying();
  const removedState = await status(removed), requestStart = requests.length;
  await removed.hostPage.evaluate(() => document.getElementById('owner-frame').remove());
  const replacement = await open(); await playing(replacement);
  check('iframe-remove-without-handoff-reaps-and-resumes', (await status(replacement)).docLockHeld
    && (await status(replacement)).generation > removedState.generation
    && !requests.slice(requestStart).some(r => r.input?.ownerId === removedState.ownerId && r.action === 'handoff'));
  await Promise.all([replacement.close(), removed.hostPage.close()]);

  reset(seed());
  const retained = await open(); await playing(retained);
  rebuildService();
  const restarted = await open(); await new Promise(r => setTimeout(r, 1800));
  check('backend-only-rebuild-retains-live-owner-lock-standby', (await status(restarted)).paused
    && !(await status(restarted)).docLockHeld && !(await status(retained)).paused);
  await Promise.all([retained.close(), restarted.close()]);

  reset(seed());
  const living = await open(); await playing(living); await persistedPlaying();
  const livingState = await status(living);
  const transient = await browser.newPage(); await transient.goto(base);
  // 撤掉全局锁后立即结束回调，模拟 stealer 自己先消失；原文档仍活着。
  // 它的身份锁不可被偷，新的空闲全局锁不能被误读成“旧文档已死”。
  await transient.evaluate(() => navigator.locks.request('hana-simple-player-audio-doc', { steal: true }, () => {}));
  const noReapStart = requests.length;
  const guarded = await open(); await new Promise(r => setTimeout(r, 1800));
  check('stolen-global-lock-is-not-document-death-identity-fences-reap', (await status(guarded)).docLockHeld
    && (await status(guarded)).paused && (await service.read()).ownerId === livingState.ownerId
    && !requests.slice(noReapStart).some(r => r.input?.reap === true));
  await Promise.all([living.close(), guarded.close(), transient.close()]);

  reset({ ...seed(), playing: false });
  await service.command({ action: 'claim', ownerId: 'dead-stop', claimId: 'dead-stop-1' });
  const stopped = await open();
  await stopped.evaluate(() => window.__playerDebug.pauseAll());
  check('proven-orphan-stop-without-pending-clears', !(await service.read()).ownerId && playback.playing === false);
  await stopped.close();

  reset(seed());
  const isolated = await open({ fallback: true }); await playing(isolated);
  storageMuted = true;
  const contender = await open({ fallback: true, opener: isolated }); await new Promise(r => setTimeout(r, 1800));
  check('both-notifications-lost-boot-cannot-steal', !(await status(isolated)).paused && (await status(contender)).paused);
  // 两个文档使用同源真实 Chrome，每个媒体事件同步检查全部 audio 的 paused。
  for (const page of [isolated, contender]) await page.evaluate(() => {
    window.__voiceTimeline = [];
    window.__voiceWindows = [window, window.opener || window.__audioOther];
    const current = document.getElementById('audio');
    const sample = () => {
      const voices = [...window.__voiceWindows].filter(w => !w.document.getElementById('audio').paused).length;
      window.__voiceTimeline.push({ at: performance.timeOrigin + performance.now(), voices });
    };
    current.addEventListener('play', sample); current.addEventListener('playing', sample);
    window.__voiceSampler = setInterval(sample, 1);
  });
  await contender.evaluate(() => window.__playerDebug.requestPlay('user')); await playing(contender);
  const timeline = (await Promise.all([isolated, contender].map(page => page.evaluate(() => {
    clearInterval(window.__voiceSampler); return window.__voiceTimeline;
  })))).flat().sort((a, b) => a.at - b.at);
  check('both-notifications-lost-explicit-steal-pauses-old-one-voice', (await status(isolated)).paused
    && !(await status(contender)).paused && timeline.every(t => t.voices <= 1), timeline);
  await Promise.all([isolated.close(), contender.close()]);

  for (const unsupported of [{ noLocks: true }, { securityError: true }]) {
    reset(seed());
    const alive = await open(unsupported); await playing(alive);
    const fallbackPage = await open(unsupported); await new Promise(r => setTimeout(r, 1800));
    const s = await status(fallbackPage);
    check('unsupported-locks-conservative-' + Object.keys(unsupported)[0], s.paused && !s.docLockSupported);
    const start = requests.length;
    await fallbackPage.evaluate(() => window.__playerDebug.requestPlay('user')); await playing(fallbackPage);
    check('unsupported-locks-existing-yield-no-reap-' + Object.keys(unsupported)[0], (await status(alive)).paused
      && !requests.slice(start).some(r => r.input?.reap === true));
    await Promise.all([alive.close(), fallbackPage.close()]);
  }
} catch (error) {
  check('unexpected-test-error', false, error.stack);
  for (const page of pages) {
    check('diagnostic', false, await page.evaluate(() => {
      const a = document.getElementById('audio');
      return { owner: window.__playerDebug?.audioOwner(), src: a?.src, ready: a?.readyState, error: a?.error?.message, duration: a?.duration };
    }).catch(e => String(e)));
  }
}
finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
const out = process.env.OUT_DIR || '/tmp/hap-audio-owner'; fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'verify-audio-owner.json'), JSON.stringify({ results, writes, requests, errors }, null, 2));
console.log(JSON.stringify({ passed: results.filter(x => x.ok).length, total: results.length, failed: results.filter(x => !x.ok), outDir: out }, null, 2));
process.exitCode = results.every(x => x.ok) ? 0 : 1;

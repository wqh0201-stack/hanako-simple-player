import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequestGate } from '../lib/netease-gate.js';
import { createCatalogIndex } from '../lib/catalog-index.js';
import { getLyric } from '../lib/meting.js';

let clock = 0;
const gate = createRequestGate({ now: () => clock, sleep: async ms => { clock += ms; } });
const starts = [];
await Promise.all([0, 1, 2].map(id => gate.schedule().then(() => starts.push({ id, at: clock }))));
starts.sort((a, b) => a.id - b.id);
assert.deepEqual(starts, [{ id: 0, at: 0 }, { id: 1, at: 2000 }, { id: 2, at: 4000 }], JSON.stringify(starts));
const cooling = createRequestGate({ now: () => clock, sleep: async ms => { clock += ms; } });
cooling.cool(429, 'lyric');
await assert.rejects(cooling.schedule(), e => e.cooldown && e.code === 429 && e.retryAfterMs === 60000);
const cancelGate = createRequestGate({ now: () => clock, sleep: async ms => { clock += ms; } });
await cancelGate.schedule();
const ac = new AbortController();
const cancelled = cancelGate.schedule(ac.signal);
ac.abort();
await assert.rejects(cancelled, e => e.name === 'AbortError');

let fetchCount = 0, schedules = 0;
const lyricGate = { schedule: async () => { schedules++; }, cool: () => 0 };
const lyricCtx = { network: { async fetch() {
  fetchCount++;
  if (fetchCount === 1) return { ok: false, status: 503 };
  return { ok: true, text: async () => '[00:00.00]Hello' };
} } };
const lr = await getLyric(lyricCtx, { id: '1', gate: lyricGate });
assert.equal(lr.lyric, '[00:00.00]Hello');
assert.equal(fetchCount, 2);
assert.equal(schedules, 2);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-a-fix-'));
const zeroGate = createRequestGate({ minInterval: 0, cooldownMs: 0 });
let lyricFetchCount = 0;
const fakeLyric = async () => { lyricFetchCount++; return { lyric: '[00:00.00]Hello' }; };
const mk = (lyricFetch) => createCatalogIndex({ dataDir: dir, logger: { warn() {} }, network: { fetch: async () => ({ ok: false, status: 500 }) } }, { coverCatalog: {}, gate: zeroGate, lyricFetch });
const idx = mk(fakeLyric);
await assert.rejects(idx.lyric('abc456def'), e => e.code === 400);
assert.equal(lyricFetchCount, 0);
await idx.lyric('456');
assert.equal(lyricFetchCount, 1);
assert.ok(fs.existsSync(path.join(dir, 'catalog-lyrics', '456.lrc')));
const idx2 = mk(fakeLyric);
await idx2.lyric('456');
assert.equal(lyricFetchCount, 1, 'cache hit must not fetch');
let badCalls = 0;
const bad = mk(async () => { badCalls++; return { lyric: '{"code":405,"message":"refused"}' }; });
await assert.rejects(bad.lyric('789'), e => e.cooldown && e.code === 405);
assert.equal(badCalls, 1);
assert.ok(!fs.existsSync(path.join(dir, 'catalog-lyrics', '789.lrc')), 'failed JSON must not be cached');
fs.rmSync(dir, { recursive: true, force: true });
console.log('PHASE_A_FIXES_OK');

// HTTP 405/429 在歌词节点回退中必须立即保护，不再打下一节点。
let blockFetches = 0, blockCools = 0;
const blockGate = { schedule: async () => {}, cool: (code, stage) => { blockCools++; return 60000; } };
const blockCtx = { network: { async fetch() { blockFetches++; return { ok: false, status: 429 }; } } };
await assert.rejects(getLyric(blockCtx, { id: '2', gate: blockGate }), e => e.cooldown && e.code === 429 && e.stage === 'lyric' && e.retryAfterMs === 60000);
assert.equal(blockFetches, 1, 'HTTP 429 must stop before next node');
assert.equal(blockCools, 1);

// gate 的 CooldownError 不能被 fetchText 吞成普通节点错误。
let controlFetches = 0;
const controlGate = { schedule: async () => { throw Object.assign(new Error('上游暂时拒绝请求'), { name: 'CooldownError', cooldown: true, code: 405, stage: 'lyric', retryAfterMs: 60000 }); } };
const controlCtx = { network: { async fetch() { controlFetches++; return { ok: true, text: async () => 'x' }; } } };
await assert.rejects(getLyric(controlCtx, { id: '3', gate: controlGate }), e => e.cooldown && e.code === 405 && e.retryAfterMs === 60000);
assert.equal(controlFetches, 0, 'control error must not send');

// 取图 HTTP 405/429 也要进入保护并保留结构。
const coverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-a-cover405-'));
let coverFetches = 0;
const coverCatalog = {
  albums: async () => ({ albums: [{ id: 55, name: 'A', type: '专辑', size: 1, published: 2000, pic: 'https://p1.music.126.net/x.jpg' }], more: false }),
  album: async () => ({ tracks: [{ songId: 55, title: 'S', artists: [{ id: 1, name: 'A' }], albumId: 55, album: 'A', albumType: '专辑', subType: '录音室版', published: 2000, albumSize: 1, pic: 'https://p1.music.126.net/x.jpg' }] })
};
const coverCtx = { dataDir: coverDir, logger: { warn() {} }, network: { async fetch() { coverFetches++; return { ok: false, status: 405 }; } } };
const coverIndex = createCatalogIndex(coverCtx, { coverCatalog, gate: createRequestGate({ minInterval: 0, cooldownMs: 0 }), lyricFetch: fakeLyric });
await coverIndex.build(1, { limit: 1 });
await assert.rejects(coverIndex.cover(55), e => e.cooldown && e.code === 405 && e.stage === 'cover');
assert.equal(coverFetches, 1);
fs.rmSync(coverDir, { recursive: true, force: true });
console.log('PHASE_A_A4_ERRORS_OK');

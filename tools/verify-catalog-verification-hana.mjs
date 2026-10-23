#!/usr/bin/env node
/* 验证 -462 账号验证拒绝：只跑本地假网络，不请求网易。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCoverCatalog } from '../lib/cover-catalog.js';
import { createCatalogIndex } from '../lib/catalog-index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-verify-'));
const gate = { schedule: async () => {}, cool: () => 60000, state: () => ({ retryAfterMs: 0 }) };
const logger = { warn() {} };
let passed = 0, total = 0;
async function test(name, fn) { total++; try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { console.log('FAIL ' + name + ': ' + (e.stack || e)); process.exitCode = 1; } }
const verdict = { ok: true, json: async () => ({ code: -462, message: '请绑定手机后再试哦~' }) };

await test('one-fetch-verification-non-retryable-preserves-code-message', async () => {
  let fetches = 0;
  const ctx = { dataDir: dir, logger, network: { fetch: async () => { fetches++; return verdict; } } };
  const cc = createCoverCatalog(ctx, { gate });
  let err;
  try { await cc.album(92895788); } catch (e) { err = e; }
  assert.equal(fetches, 1); assert.equal(err.code, -462); assert.equal(err.requiresVerification, true); assert.equal(err.nonRetryable, true);
  assert.match(err.message, /请绑定手机/); assert.equal(err.upstreamMessage, '请绑定手机后再试哦~');
});

await test('build-stops-after-verification-and-keeps-first-two-albums', async () => {
  let albumCalls = 0, listCalls = 0;
  const ts = (id) => ({ songId: id, title: 'T' + id, artists: [{ id: 7, name: 'A' }], pic: 'https://p1.music.126.net/x.jpg' });
  const fake = {
    async albums() { listCalls++; return { albums: [
      { id: 1, name: 'A', type: '专辑' }, { id: 2, name: 'B', type: '专辑' }, { id: 3, name: 'C', type: '专辑' }
    ], more: false }; },
    async album(id) { albumCalls++; if (Number(id) === 3) { const e = new Error('请绑定手机后再试哦~'); e.code = -462; e.requiresVerification = true; e.nonRetryable = true; e.upstreamMessage = e.message; throw e; } return { tracks: [ts(id)] }; }
  };
  const idx = createCatalogIndex({ dataDir: dir, logger }, { coverCatalog: fake, gate });
  let err;
  try { await idx.build(7, { limit: 10 }); } catch (e) { err = e; }
  assert.equal(err.requiresVerification, true); assert.equal(err.code, -462);
  assert.equal(listCalls, 1); assert.equal(albumCalls, 3);
  const got = idx.index(7);
  assert.equal(got.albums.filter(a => a.tracks && a.tracks.length).length, 2);
  assert.equal(got.albums.find(a => a.id === 1).tracks[0].title, 'T1');
  assert.equal(got.albums.find(a => a.id === 2).tracks[0].title, 'T2');
});
await test('lyric-json-462-preserves-verification-not-502', async () => {
  let calls = 0;
  const idx = createCatalogIndex({ dataDir: dir, logger }, { coverCatalog: {}, gate,
    lyricFetch: async () => { calls++; return { lyric: JSON.stringify({ code: -462, message: '请绑定手机后再试哦~' }) }; } });
  let err;
  try { await idx.lyric(424242); } catch (e) { err = e; }
  assert.equal(calls, 1); assert.equal(err.code, -462); assert.equal(err.requiresVerification, true);
  assert.equal(err.nonRetryable, true); assert.match(err.upstreamMessage, /请绑定手机/);
});
console.log(`HANA_CATALOG_VERIFICATION ${passed}/${total}`);

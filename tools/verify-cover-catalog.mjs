#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCoverCatalog } from '../lib/cover-catalog.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hap-cover-'));
let calls = [], inflight = 0, maximum = 0, retryFailures = 0, permanentFailure = false;
const pic = 'http://p1.music.126.net/a/123.jpg';
const ctx = { dataDir, logger: { warn() {} }, network: { async fetch(url, opts) {
  calls.push(url); maximum = Math.max(maximum, ++inflight);
  await new Promise(r => setTimeout(r, 2)); inflight--;
  assert.equal(opts.method, 'GET');
  assert.ok(['music.163.com', 'api.bilibili.com'].includes(new URL(url).hostname));
  if (url.endsWith('/999') && permanentFailure) return { ok: true, json: async () => ({ code: -462 }) };
  if (url.endsWith('/18877') && retryFailures-- > 0) return { ok: true, json: async () => ({ code: -462 }) };
  let body;
  if (url.includes('/search/')) body = { code: 200, result: { artists: [{ id: 9, name: 'Aimer', albumSize: 1 }, { id: 16152, name: 'Aimer', albumSize: 109 }, { id: 10, name: 'Aimer翻唱', alias: ['Aimer'], albumSize: 999 }] } };
  else if (url.includes('/artist/albums/')) body = { code: 200, hotAlbums: [{ id: 18877, name: '魔杰座' }], more: true };
  else if (url.includes('/api/v1/album/')) body = { code: 200, album: { id: Number(url.split('/').pop()), name: '魔杰座', size: 1, picUrl: pic, publishTime: 1224000000000, subType: '录音室版' }, songs: [{ id: 185709, name: '稻香', ar: [{ id: 6452, name: '周杰伦' }], dt: 223000 }] };
  else body = { code: 0, data: { title: 'Aimer 全歌曲合集' } };
  return { ok: true, json: async () => body };
} } };
const create = () => createCoverCatalog(ctx, { delay: async () => {} });
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
try {
  let catalog = create();
  await check('artist identity excludes substring names and ranks duplicate names', async () => assert.equal((await catalog.artist('Aimer')).artist.id, 16152));
  await check('pagination remains explicit', async () => assert.equal((await catalog.albums(6452)).more, true));
  await check('transient errors retried; same album requests coalesced', async () => {
    retryFailures = 2; const n = calls.length;
    const [a, b] = await Promise.all([catalog.album(18877), catalog.album(18877)]);
    assert.equal(calls.length - n, 3); assert.deepEqual(a, b);
    assert.equal(a.tracks[0].pic, pic.replace('http:', 'https:')); assert.equal(a.tracks[0].duration, 223);
  });
  await check('cache survives reload without new network requests', async () => {
    catalog = create(); const n = calls.length;
    assert.equal((await catalog.album(18877)).cached, true); assert.equal(calls.length, n);
  });
  await check('expired cache fetches fresh metadata', async () => {
    const f = path.join(dataDir, 'cover-catalog-cache.json'), d = JSON.parse(fs.readFileSync(f));
    d.entries['album:18877'].at = 1; fs.writeFileSync(f, JSON.stringify(d)); catalog = create();
    assert.equal((await catalog.album(18877)).cached, false);
  });
  await check('permanent failure bounded and never cached as empty success', async () => {
    permanentFailure = true; const n = calls.length;
    await assert.rejects(catalog.album(999), /-462/); assert.equal(calls.length - n, 3);
    permanentFailure = false; assert.equal((await catalog.album(999)).cached, false);
  });
  await check('multiple requests share one outbound queue', async () => {
    await Promise.all([catalog.album(101), catalog.album(102), catalog.context('BV1TN5K6NEux')]); assert.equal(maximum, 1);
  });
  await check('invalid ids and offsets fail before outbound requests', async () => {
    const n = calls.length;
    await assert.rejects(catalog.album('../../etc/passwd'));
    await assert.rejects(catalog.albums(6452, -1)); await assert.rejects(catalog.context('wrong'));
    assert.equal(calls.length, n);
  });
  console.log(`${passed}/${passed} cover catalog checks passed`);
} finally { fs.rmSync(dataDir, { recursive: true, force: true }); }

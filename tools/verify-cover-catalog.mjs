#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCoverCatalog } from '../lib/cover-catalog.js';
import { createRequestGate } from '../lib/netease-gate.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hap-cover-'));
let calls = [], inflight = 0, maximum = 0, retryFailures = 0, permanentFailure = false;
const pic = 'http://p1.music.126.net/a/123.jpg';
const ctx = { dataDir, logger: { warn() {} }, network: { async fetch(url, opts) {
  calls.push(url); maximum = Math.max(maximum, ++inflight);
  await new Promise(r => setTimeout(r, 2)); inflight--;
  assert.equal(opts.method, 'GET');
  assert.ok(['music.163.com', 'api.bilibili.com'].includes(new URL(url).hostname));
  if (url.endsWith('/999') && permanentFailure) return { ok: true, json: async () => ({ code: -462 }) };
  if (url.endsWith('/405')) return { ok: true, json: async () => ({ code: 405 }) };
  if (url.endsWith('/18877') && retryFailures-- > 0) return { ok: true, json: async () => ({ code: -462 }) };
  let body;
  const u = new URL(url);
  if (u.pathname.includes('/search/get/web')) {
    const type = u.searchParams.get('type'), s = u.searchParams.get('s') || '';
    if (type === '100' && s === '同名') body = { code: 200, result: { artists: [
      { id: 21, name: '同名', albumSize: 0 }, { id: 22, name: '同名', albumSize: 0 }] } };
    else if (type === '100' && /^jay chou$/i.test(s)) body = { code: 200, result: { artists: [
      { id: 7, name: '周杰伦', alias: ['Jay Chou'], albumSize: 50 }] } };
    else if (type === '100') body = { code: 200, result: { artists: [
      { id: 9, name: 'Aimer', albumSize: 1 }, { id: 16152, name: 'Aimer', albumSize: 109 },
      { id: 10, name: 'Aimer翻唱', alias: ['Aimer'], albumSize: 999 }] } };
    else body = { code: 200, result: { songs: [
      { id: 185709, name: '稻香', alias: ['Rice Aroma'], ar: [{ id: 6452, name: '周杰伦' }], al: { id: 18877, name: '魔杰座', publishTime: 1224000000000, size: 1 } }] } };
  }
  else if (u.pathname.includes('/artist/albums/')) body = { code: 200, hotAlbums: [{ id: 18877, name: '魔杰座', type: '专辑', subType: '录音室版', publishTime: 1224000000000, size: 1, picUrl: pic }], more: true };
  else if (u.pathname.includes('/api/v1/album/')) body = { code: 200, album: { id: Number(url.split('/').pop()), name: '魔杰座', type: '专辑', size: 1, picUrl: pic, publishTime: 1224000000000, subType: '录音室版' }, songs: [{ id: 185709, name: '稻香', alias: ['Rice Aroma'], ar: [{ id: 6452, name: '周杰伦' }], dt: 223000 }] };
  else body = { code: 0, data: { title: 'Aimer 全歌曲合集' } };
  return { ok: true, json: async () => body };
} } };
const create = () => createCoverCatalog(ctx, { delay: async () => {}, gate: createRequestGate({ minInterval: 0, cooldownMs: 0 }) });
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
try {
  let catalog = create();
  await check('artist identity excludes substring names and ranks duplicate names', async () => assert.equal((await catalog.artist('Aimer')).artist.id, 16152));
  await check('ambiguous duplicate artist names are rejected', async () => {
    await assert.rejects(catalog.artist('同名'), e => e.code === 409);
  });
  await check('explicit alias resolves to the same official identity', async () => {
    const r = await catalog.artist('Jay Chou');
    assert.equal(r.artist.id, 7); assert.ok(r.artist.aliases.includes('Jay Chou'));
  });
  await check('song search keeps artist and album ids for cover matching', async () => {
    const r = await catalog.search('稻香', '周杰伦');
    assert.equal(r.tracks[0].songId, 185709);
    assert.equal(r.tracks[0].albumId, 18877);
    assert.deepEqual(r.tracks[0].artists, [{ id: 6452, name: '周杰伦' }]);
    assert.deepEqual(r.tracks[0].aliases, ['Rice Aroma']);
    assert.equal(r.tracks[0].album, '魔杰座');
    assert.equal(r.tracks[0].albumPublished, 1224000000000);
    assert.equal(r.tracks[0].albumSize, 1);
  });
  await check('song search rejects empty title before any outbound request', async () => {
    const n = calls.length;
    await assert.rejects(catalog.search('', '周杰伦'), e => e.code === 400);
    assert.equal(calls.length, n);
  });
  await check('pagination remains explicit', async () => {
    const r = await catalog.albums(6452);
    assert.equal(r.more, true);
    assert.equal(r.albums[0].type, '专辑');
    assert.equal(r.albums[0].size, 1);
    assert.equal(r.albums[0].pic, pic.replace('http:', 'https:'));
  });
  await check('upstream business 405 is not retried', async () => {
    const n = calls.length;
    await assert.rejects(catalog.album(405), /405/);
    assert.equal(calls.length - n, 1);
  });
  await check('transient errors retried; same album requests coalesced', async () => {
    retryFailures = 2; const n = calls.length;
    const [a, b] = await Promise.all([catalog.album(18877), catalog.album(18877)]);
    assert.equal(calls.length - n, 3); assert.deepEqual(a, b);
    assert.equal(a.tracks[0].pic, pic.replace('http:', 'https:')); assert.equal(a.tracks[0].duration, 223);
    assert.deepEqual(a.tracks[0].aliases, ['Rice Aroma']);
  });
  await check('cache survives reload without new network requests', async () => {
    catalog = create(); const n = calls.length;
    assert.equal((await catalog.album(18877)).cached, true); assert.equal(calls.length, n);
  });
  await check('expired cache fetches fresh metadata', async () => {
    const f = path.join(dataDir, 'cover-catalog-cache.json'), d = JSON.parse(fs.readFileSync(f));
    assert.equal(d.version, 2);
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

#!/usr/bin/env node
/* Hana TTL/断点增量验收：临时目录、可计数假元数据，不访问网络/生产缓存。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createCatalogIndex } from '../lib/catalog-index.js';
const TTL = 30 * 86400000, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hana-index-ttl-'));
const a = id => ({ id, name: 'Album ' + id, type: '专辑', pic: 'https://p1.music.126.net/' + id + '.jpg' });
const listCalls = [], detailCalls = []; let rejectPage = false;
const catalog = {
  albums: async (id, offset) => {
    listCalls.push(offset);
    if (offset === 0) return { albums: [a(101), a(102)], more: true };
    if (offset === 2) { if (rejectPage) throw Object.assign(new Error('fixture refused'), { code: 405, cooldown: true }); return { albums: [a(103)], more: false }; }
    throw new Error('unexpected cursor ' + offset);
  },
  album: async id => { detailCalls.push(Number(id)); return { ...a(Number(id)), tracks: [{ songId: Number(id) * 10, title: 'Song ' + id, artists: [{ id: 7, name: 'A' }], pic: a(id).pic }] }; }
};
const dataFile = path.join(dir, 'catalog-index.json');
const seed = () => fs.writeFileSync(dataFile, JSON.stringify({ version: 1, artists: {},
  albumLists: { 7: { at: Date.now() - TTL - 1000, albums: [a(101)], more: false, nextOffset: 1 } },
  albums: { 101: { ...a(101), tracks: [{ songId: 1010, title: 'old cached song' }], at: Date.now() } } }));
const ctx = { dataDir: dir, logger: { warn() {} } };
const create = () => createCatalogIndex(ctx, { coverCatalog: catalog });
let passed = 0, total = 0;
async function test(name, fn) { total++; try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { process.exitCode = 1; console.log('FAIL ' + name + ': ' + e.message); } }
try {
  seed();
  await test('expired-complete-list-restarts-zero-with-bounded-progress', async () => {
    const r = await create().listAlbums(7, { maxPages: 1 });
    assert.deepEqual(listCalls, [0]); assert.equal(r.more, true); assert.equal(r.nextOffset, 2);
    assert.deepEqual(r.albums.map(x => x.id), [101, 102]); assert.ok(Date.now() - r.at >= TTL, 'partial page is not fresh-complete');
  });
  await test('reconstructed-module-continues-cursor-and-completes', async () => {
    const r = await create().listAlbums(7, { maxPages: 1 });
    assert.deepEqual(listCalls, [0, 2]); assert.equal(r.more, false); assert.equal(r.nextOffset, 3);
    assert.deepEqual(r.albums.map(x => x.id), [101, 102, 103]); assert.ok(Date.now() - r.at < 1000);
    await create().listAlbums(7); assert.deepEqual(listCalls, [0, 2], 'fresh complete list must not fetch');
  });
  await test('build-only-new-details-retains-fresh-existing-album', async () => {
    const r = await create().build(7, { limit: 8 });
    assert.equal(r.complete, true); assert.deepEqual(detailCalls.sort(), [102, 103]);
    assert.equal(create().index(7).albums.find(x => x.id === 101).tracks[0].title, 'old cached song');
    await create().build(7); assert.deepEqual(detailCalls.sort(), [102, 103]); assert.deepEqual(listCalls, [0, 2]);
  });
  await test('page-rejection-preserves-durable-cursor-and-old-relations', async () => {
    seed(); listCalls.length = 0; rejectPage = true;
    await assert.rejects(create().listAlbums(7, { maxPages: 3 }), e => e.code === 405);
    assert.deepEqual(listCalls, [0, 2]); const checkpoint = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.equal(checkpoint.albumLists[7].nextOffset, 2); assert.equal(checkpoint.albums[101].tracks[0].title, 'old cached song');
    rejectPage = false; await create().listAlbums(7); assert.deepEqual(listCalls, [0, 2, 2]);
  });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log(`HANA_CATALOG_INCREMENTAL ${passed}/${total}`);

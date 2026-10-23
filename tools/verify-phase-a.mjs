import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequestGate } from '../lib/netease-gate.js';
import { createCatalogIndex } from '../lib/catalog-index.js';

let clock = 0;
const gate = createRequestGate({ now: () => clock, sleep: async ms => { clock += ms; } });
const starts = [];
await gate.schedule();
starts.push(clock);
await gate.schedule();
starts.push(clock);
assert.ok(starts[1] - starts[0] >= 2000, JSON.stringify(starts));
const coolGate = createRequestGate({ now: () => clock, sleep: async ms => { clock += ms; } });
coolGate.cool(405, 'album');
await assert.rejects(coolGate.schedule(), e => e.cooldown && e.code === 405 && e.retryAfterMs === 60000);
clock += 60000;
await coolGate.schedule();
const ac = new AbortController();
const p = coolGate.schedule(ac.signal);
ac.abort();
await assert.rejects(p, e => e.name === 'AbortError');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-a-'));
let albumCalls = 0, imageCalls = 0;
const albums = [
  { id: 101, name: 'Alpha', type: '专辑', size: 12, published: 2010, pic: 'https://p1.music.126.net/a.jpg' },
  { id: 102, name: 'Beta', type: 'EP', size: 5, published: 2012, pic: 'https://p1.music.126.net/b.jpg' },
  { id: 103, name: 'Gamma', type: 'Single', size: 2, published: 2014, pic: 'https://p1.music.126.net/c.jpg' },
  { id: 104, name: 'Delta', type: '专辑', size: 10, published: 2016, pic: 'https://p1.music.126.net/d.jpg' }
];
const pages = { 0: { albums: albums.slice(0, 2), more: true }, 2: { albums: albums.slice(2, 3), more: true }, 3: { albums: albums.slice(3), more: false } };
const coverCatalog = {
  artist: async name => ({ artist: { id: 7, name, aliases: [] } }),
  albums: async (id, offset) => { const p = pages[offset] || { albums: [], more: false }; return p; },
  album: async id => { albumCalls++; const a = albums.find(x => x.id === Number(id)); return { tracks: [{ songId: id * 10, title: 'Song', artists: [{ id: 7, name: 'A' }], albumId: a.id, album: a.name, albumType: a.type, subType: '录音室版', published: a.published, albumSize: a.size, pic: a.pic }] }; }
};
const ctx = { dataDir: dir, logger: { warn() {} }, network: { async fetch(url) {
  imageCalls++;
  return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
} } };
const idx = createCatalogIndex(ctx, { coverCatalog, gate: createRequestGate({ minInterval: 0, cooldownMs: 0 }) });
await idx.artist('A');
let r = await idx.build(7, { limit: 1 });
assert.equal(r.albumsListed, 4);
assert.equal(r.more, false);
assert.equal(r.nextOffset, 4);
assert.equal(albumCalls, 1);
const idx2 = createCatalogIndex(ctx, { coverCatalog, gate: createRequestGate({ minInterval: 0, cooldownMs: 0 }) });
r = await idx2.build(7, { limit: 10 });
assert.equal(r.albumsListed, 4, JSON.stringify(r));
assert.equal(r.nextOffset, 4, JSON.stringify(r));
assert.equal(r.complete, true, 'all pages must be complete');
const ids = idx2.index(7).albums.map(a => a.id).sort((a,b)=>a-b);
assert.deepEqual(ids, [101,102,103,104], JSON.stringify(ids));
const [c1, c2] = await Promise.all([idx2.cover(101), idx2.cover(101)]);
assert.equal(imageCalls, 1);
assert.equal(c1.type, 'image/jpeg');
assert.equal(c2.type, 'image/jpeg');
const idx3 = createCatalogIndex(ctx, { coverCatalog, gate: createRequestGate({ minInterval: 0, cooldownMs: 0 }) });
await idx3.cover(101);
assert.equal(imageCalls, 1);
fs.rmSync(dir, { recursive: true, force: true });
console.log('PHASE_A_GATE_INDEX_OK');

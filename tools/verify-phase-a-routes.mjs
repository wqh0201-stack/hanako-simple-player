import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerRoutes } from '../lib/register-routes.js';
import { createCatalogIndex } from '../lib/catalog-index.js';
import { createRequestGate } from '../lib/netease-gate.js';

const PNG = fs.readFileSync('docs/player-ui/assets/demo-cover.png');
function routesFor(ctx) {
  const routes = [];
  const app = { get: (p, h) => routes.push(['GET', p, h]), post: (p, h) => routes.push(['POST', p, h]),
    put: (p, h) => routes.push(['PUT', p, h]), delete: (p, h) => routes.push(['DELETE', p, h]) };
  registerRoutes(app, { ctx, state: {} });
  return routes;
}
async function call(routes, method, p, query = {}, body = {}) {
  const hit = routes.find(r => r[0] === method && r[1] === p);
  assert.ok(hit, method + ' ' + p);
  const c = {
    req: { query: k => query[k], json: async () => body },
    json: (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } }),
    text: (txt, status = 200, headers = {}) => new Response(txt, { status, headers })
  };
  return hit[2](c);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-a-routes-'));
fs.mkdirSync(path.join(dir, 'catalog-covers'), { recursive: true });
fs.mkdirSync(path.join(dir, 'catalog-lyrics'), { recursive: true });
fs.writeFileSync(path.join(dir, 'catalog-lyrics', '123.lrc'), '[00:00.00]Hello');
const now = Date.now(), pic = 'https://p1.music.126.net/test.jpg';
const album = { id: 55, name: 'Album', type: '专辑', subType: '录音室版', size: 1, published: 2000, pic };
const track = { songId: 55, title: 'Song', artists: [{ id: 7, name: 'A' }], albumId: 55, album: 'Album', albumType: '专辑', subType: '录音室版', published: 2000, albumSize: 1, pic };
fs.writeFileSync(path.join(dir, 'catalog-index.json'), JSON.stringify({ version: 1,
  artists: { 7: { id: 7, name: 'A', aliases: [], at: now } },
  albumLists: { 7: { at: now, albums: [album], more: false, nextOffset: 1 } },
  albums: { 55: { ...album, tracks: [track], at: now } } }));
let imageFetches = 0, lyricFetches = 0;
const ctx = {
  dataDir: dir, logger: { warn() {} }, resources: {}, storage: { global: { get: async () => [], set: async () => {} } }, tools: {},
  network: { async fetch(url) {
    if (String(url).includes('p1.music.126.net/test.jpg')) {
      imageFetches++;
      return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => PNG };
    }
    if (String(url).includes('type=lrc') && String(url).includes('id=789')) {
      lyricFetches++;
      return { ok: true, text: async () => '{"code":405,"message":"refused"}' };
    }
    throw new Error('unexpected fetch ' + url);
  } }
};
const routes = routesFor(ctx);
let res = await call(routes, 'GET', '/api/catalog/artist', { name: 'A' });
assert.equal(res.status, 200);
assert.equal((await res.json()).artist.id, 7);
res = await call(routes, 'POST', '/api/catalog/build', {}, { artistId: 7, limit: 6 });
assert.equal(res.status, 200);
res = await call(routes, 'GET', '/api/catalog/index', { artistId: '7' });
assert.equal(res.status, 200);
assert.equal((await res.json()).albums[0].tracks[0].songId, 55);
res = await call(routes, 'GET', '/api/catalog/cover', { albumId: '55' });
assert.equal(res.status, 200);
assert.equal(res.headers.get('content-type'), 'image/png');
assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
res = await call(routes, 'GET', '/api/catalog/cover', { albumId: '55' });
assert.equal(res.status, 200);
assert.equal(imageFetches, 1, 'second cover must hit cache');
res = await call(routes, 'GET', '/api/catalog/lyric', { songId: '123' });
assert.equal(res.status, 200);
assert.equal(await res.text(), '[00:00.00]Hello');
res = await call(routes, 'GET', '/api/catalog/cover', { albumId: 'abc' });
assert.equal(res.status, 400);
res = await call(routes, 'GET', '/api/catalog/lyric', { songId: 'abc456def' });
assert.equal(res.status, 400);
res = await call(routes, 'POST', '/api/catalog/build', {}, { artistId: 'abc' });
assert.equal(res.status, 400);
assert.equal(imageFetches, 1);
assert.equal(lyricFetches, 0);
res = await call(routes, 'GET', '/api/catalog/lyric', { songId: '789' });
assert.equal(res.status, 405);
const bad = await res.json();
assert.equal(bad.code, 405);
assert.equal(bad.stage, 'lyric');
assert.ok(bad.cooldown);
assert.ok(bad.retryAfterMs > 0);
assert.ok(!fs.existsSync(path.join(dir, 'catalog-lyrics', '789.lrc')));
fs.rmSync(dir, { recursive: true, force: true });

const capDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-a-cap-'));
fs.mkdirSync(path.join(capDir, 'catalog-covers'), { recursive: true });
const pic99 = 'https://p1.music.126.net/cap.jpg';
fs.writeFileSync(path.join(capDir, 'catalog-index.json'), JSON.stringify({ version: 1, artists: {}, albumLists: {},
  albums: { 99: { id: 99, name: 'Cap', pic: pic99, tracks: [], at: Date.now() } } }));
const own = (i) => `1000000000${i}-abcdefabcdef.png`.replace('1000000000', '1');
for (let i = 0; i < 256; i++) {
  const name = `${100000 + i}-abcdefabcdef.png`;
  const f = path.join(capDir, 'catalog-covers', name);
  fs.writeFileSync(f, Buffer.from([i % 256]));
  fs.utimesSync(f, new Date(1000 + i), new Date(1000 + i));
  fs.writeFileSync(f.replace(/\.png$/, '') + '.meta.json', JSON.stringify({ type: 'image/png' }));
}
fs.writeFileSync(path.join(capDir, 'catalog-covers', 'notes.txt'), 'keep');
fs.mkdirSync(path.join(capDir, 'catalog-covers', '999-abcdefabcdef.jpg'));
fs.symlinkSync(path.join(capDir, 'catalog-covers', 'notes.txt'), path.join(capDir, 'catalog-covers', '999-abcdefabcdee.jpg'));
let capFetches = 0;
const capCtx = { dataDir: capDir, logger: { warn() {} }, network: { async fetch() { capFetches++; return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => PNG }; } } };
const cap = createCatalogIndex(capCtx, { coverCatalog: {}, gate: createRequestGate({ minInterval: 0, cooldownMs: 0 }) });
await cap.cover(99);
const names = fs.readdirSync(path.join(capDir, 'catalog-covers'));
const ownNames = names.filter(n => /^\d+-[a-f0-9]{12}\.png$/.test(n));
assert.equal(ownNames.length, 256);
assert.ok(!names.includes('100000-abcdefabcdef.png'), 'oldest own image should be pruned');
assert.ok(!names.includes('100000-abcdefabcdef.meta.json'), 'oldest meta should be pruned');
assert.ok(names.includes('notes.txt'), 'unrelated file must survive');
assert.ok(fs.statSync(path.join(capDir, 'catalog-covers', '999-abcdefabcdef.jpg')).isDirectory());
assert.ok(fs.lstatSync(path.join(capDir, 'catalog-covers', '999-abcdefabcdee.jpg')).isSymbolicLink());
assert.equal(capFetches, 1);
fs.rmSync(capDir, { recursive: true, force: true });
console.log('PHASE_A_ROUTES_CAP_OK');

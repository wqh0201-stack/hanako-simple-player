#!/usr/bin/env node
/* B2c 调用边界：实际 startEnrich + 生产 coverResolve，假 cover-catalog，无网络。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { harness, clone, flush, ENDPOINT, canonical } from './verify-catalog-transaction-hana.mjs';
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/cover-avril-real-2026-10-20.json', import.meta.url), 'utf8'));
const count = (h, part) => h.calls.filter(c => c.url.includes(part)).length;
function coverApi(url) {
  const u = new URL(url, 'http://fixture'); const kind = u.searchParams.get('kind');
  if (kind === 'artist') return { ok: true, body: { ok: true, artist: fx.artist } };
  if (kind === 'albums') return { ok: true, body: { ok: true, albums: fx.albumList, more: false } };
  if (kind === 'search') { const t = fx.searches[u.searchParams.get('title')] || []; return { ok: true, body: { ok: true, tracks: t } }; }
  if (kind === 'album') { const a = fx.albums[String(u.searchParams.get('id'))] || {}; return { ok: true, body: { ok: true, tracks: a.tracks || [] } }; }
  return { ok: false, status: 404, body: { ok: false } };
}
function single(h, uid, song, artist) {
  h.enrichSingleUid = uid; h.$('coverSong').value = song; h.$('coverArtist').value = artist;
}
let passed = 0, total = 0;
async function test(name, fn) { total++; try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { console.log('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

await test('single-index-hit-no-build-no-search', async () => {
  const h = harness(); const t = h.state.tracks[0]; single(h, t.uid, 'Innocence', 'Avril Lavigne');
  await h.startEnrich(); assert.equal(h.state.tracks[0].title, 'Innocence'); assert.equal(h.state.tracks[0].author, 'Avril Lavigne');
  assert.equal(count(h, ENDPOINT.catalogBuild), 0); assert.equal(count(h, ENDPOINT.coverCatalog), 0);
  assert.ok(h.state.tracks.every(x => x.raw.catalogBackup));
});
await test('single-empty-index-falls-back-to-real-coverResolve', async () => {
  const h = harness({ get: url => url.includes('/catalog/index') ? { ok: true, body: { ok: true, artist: fx.artist, albums: [], coverage: { more: false } } } : undefined, cover: coverApi });
  const t = h.state.tracks[0]; single(h, t.uid, 'Innocence', 'Avril Lavigne');
  await h.startEnrich(); assert.equal(count(h, ENDPOINT.catalogBuild), 0); assert.ok(count(h, ENDPOINT.coverCatalog) > 0);
  assert.equal(h.state.tracks[0].title, 'Innocence'); assert.equal(h.state.tracks[0].raw.catalogMatch.songId, canonical.songId);
  assert.equal(h.state.tracks[0].raw.catalogMatch.albumId, 34734318);
});
await test('batch-fallback-cap-six-deferred-remainder', async () => {
  const h = harness({ get: url => url.includes('/catalog/index') ? { ok: true, body: { ok: true, artist: fx.artist, albums: [], coverage: { more: false } } } : undefined, cover: () => ({ ok: false, status: 404, body: { ok: false } }) });
  for (let i = 0; i < 7; i++) h.state.tracks.push(h.normalizeTrack({ id: 'bilibili:BV_UNKNOWN:' + i, list: 'imp:test', name: 'Unknown ' + i, url: '/audio/u' + i, mode: '在线', bvid: 'BV_UNKNOWN', cid: i }));
  await h.startEnrich(); assert.equal(count(h, ENDPOINT.coverCatalog), 6); assert.match(h.statuses.at(-1), /待处理\s*[12]/);
});
await test('fallback-cooldown-stops-no-later-candidates-no-save', async () => {
  let n = 0; const h = harness({ get: url => url.includes('/catalog/index') ? { ok: true, body: { ok: true, artist: fx.artist, albums: [], coverage: { more: false } } } : undefined, cover: () => { n++; return { ok: false, status: 405, body: { ok: false, code: 405, stage: 'artist', cooldown: true, retryAfterMs: 1 } }; } });
  for (let i = 0; i < 7; i++) h.state.tracks.push(h.normalizeTrack({ id: 'bilibili:BV_COOL:' + i, list: 'imp:test', name: 'Cool ' + i, url: '/audio/c' + i, mode: '在线', bvid: 'BV_COOL', cid: i }));
  const before = clone(h.state.tracks); await h.startEnrich();
  assert.equal(n, 2); assert.equal(h.saves.length, 0); assert.deepEqual(clone(h.state.tracks), before); assert.match(h.statuses.at(-1), /保护停止/); assert.equal(h.coverJob, null);
});
console.log(`HANA_CATALOG_FALLBACK ${passed}/${total}`);

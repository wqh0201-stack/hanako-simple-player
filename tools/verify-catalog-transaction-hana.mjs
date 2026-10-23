#!/usr/bin/env node
/* Hana B2a独立控制器验收：实际startEnrich/catalogRestoreInfo/封面写入回滚。
 * 生产解析/状态转换，API、DOM渲染和保存为隔离桩；不写真实歌单/缓存，不宣称宿主已验。 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const PNG = fs.readFileSync(new URL('../docs/player-ui/assets/demo-cover.png', import.meta.url));
const src = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/cover-avril-real-2026-10-20.json', import.meta.url), 'utf8'));
const canonical = fx.albums['34734318'].tracks.find(t => t.title === 'Innocence');
assert.ok(canonical, 'public fixture must contain real Innocence');
const album = { id: 34734318, name: 'The Best Damn Thing', type: '专辑', size: 12, published: 1176508800000, tracks: [canonical] };
function slice(a, b) { const p = src.indexOf(a), q = src.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, 'production anchors ' + a); return src.slice(p, q); }
const production = [
  slice('  function deriveId(t, url) {', '  function setTrackLyricOffset('),
  slice('  function coverKey(s)', '  function coverTargets('),
  slice('  async function coverResolve(', '  function guessCoverArtist('),
  slice('  function applyCoverMatch(', '  function setSingleCoverBusy('),
  slice('  /* ---------- 统一整理事务 ---------- */', "  $('coverStartBtn').addEventListener")
].join('\n');
const clone = x => JSON.parse(JSON.stringify(x));
const flush = () => new Promise(resolve => setImmediate(resolve));
const ENDPOINT = { catalogArtist: '/api/catalog/artist', catalogBuild: '/api/catalog/build', catalogIndex: '/api/catalog/index', catalogCover: '/api/catalog/cover', catalogLyric: '/api/catalog/lyric', coverCatalog: '/widget/api/music/cover-catalog' };
function harness(config = {}) {
  const calls = [], saves = [], statuses = [], toasts = [], nodes = {}; let busy = false, audioWrites = 0;
  const noop = () => {};
  const h = {
    ENDPOINT, AbortController, AbortSignal, DOMException, Response, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval,
    coverListId: 'imp:test', coverJob: null, singleCoverBusy: false,
    state: { tracks: [], activeList: 'imp:test', lists: [{ id: 'imp:test', name: 'Avril Lavigne 50' }, { id: 'fav', name: '我的喜欢' }], currentUid: '', progress: 37, playing: true },
    normalizeAppUrl: x => x, renderQueue: noop, renderTrack: noop,
    coverPanelBusy: b => { busy = b; }, coverStatus: text => statuses.push(text), toast: text => toasts.push(text),
    findList: id => h.state.lists.find(l => l.id === id), guessCoverArtist: () => fx.artist.name,
    $: id => nodes[id] ??= { value: id === 'coverArtist' ? fx.artist.name : '', disabled: false, textContent: '', focus: noop, classList: { add: noop, remove: noop, toggle: noop } },
    probeCoverImage: async () => true,
    apiGetJson: async url => {
      calls.push({ method: 'GET', url });
      if (config.get) { const r = await config.get(url); if (r !== undefined) return r; }
      if (url.startsWith(ENDPOINT.catalogArtist)) return { ok: true, body: { ok: true, artist: fx.artist } };
      if (url.startsWith(ENDPOINT.catalogIndex)) return { ok: true, body: { ok: true, artist: fx.artist, albums: [album], coverage: { more: false } } };
      throw new Error('unexpected GET ' + url);
    },
    apiPostJson: async (url, body, options) => {
      calls.push({ method: 'POST', url, body, options });
      if (config.post) { const r = await config.post(url, body, options); if (r !== undefined) return r; }
      if (url === ENDPOINT.catalogBuild) return { ok: true, body: { ok: true, pending: 0, done: 1, total: 1, more: false, complete: true } };
      throw new Error('unexpected POST ' + url);
    },
    apiFetch: async (url, init) => {
      calls.push({ method: 'FETCH', url, init });
      if (config.fetch) { const r = await config.fetch(url, init); if (r !== undefined) return r; }
      return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
    },
    apiText: async url => {
      calls.push({ method: 'TEXT', url });
      return config.lyric ? config.lyric(url) : { ok: true, status: 200, text: '[00:00.00]Innocence fixture lyrics' };
    },
    apiJson: async (url, init) => {
      calls.push({ method: 'JSON', url });
      if (config.cover) return config.cover(url, init);
      throw new Error('unexpected cover JSON ' + url);
    },
    savePlaylist: async () => {
      saves.push(clone(h.state.tracks.map(h.toStoredTrack)));
      return { ok: config.save ? !!(await config.save(saves.length)) : true };
    }
  };
  h.trackByUid = uid => h.state.tracks.find(t => t.uid === uid);
  h.audio = {}; for (const key of ['src', 'currentTime']) Object.defineProperty(h.audio, key, { get: () => key === 'src' ? '/audio/original' : 37, set: () => audioWrites++ });
  Object.assign(h, config.globals || {}); h.window = h;
  vm.createContext(h); vm.runInContext(production, h, { filename: 'production-catalog-transaction.js' });
  const pic = config.cover ? '' : 'https://custom.example/keep.jpg';
  const raw = [
    { id: 'bilibili:BV_TEST:123', list: 'imp:test', name: 'Innocence【HQ】', author: 'UP主', url: '/audio/original', mode: '在线', bvid: 'BV_TEST', cid: 123, lyricOffset: 111, customField: 'source', ...(pic ? { pic } : {}) },
    { id: 'bilibili:BV_TEST:123', list: 'fav', name: '我收藏的原始标题', author: '私人作者', album: '旧专辑', albumId: 17, songId: 19, url: '/audio/original', mode: '在线', bvid: 'BV_TEST', cid: 123, lyricOffset: 222, customField: 'favorite', ...(pic ? { pic } : {}) }
  ];
  h.state.tracks = raw.map(h.normalizeTrack); h.state.currentUid = h.state.tracks[0].uid;
  h.calls = calls; h.saves = saves; h.statuses = statuses; h.toasts = toasts; h.busy = () => busy; h.audioWrites = () => audioWrites;
  return h;
}
function identity(h) { return clone(h.state.tracks.map(t => ({ id: t.id, uid: t.uid, list: t.list, url: t.url, bvid: t.raw.bvid, cid: t.raw.cid, offset: t.raw.lyricOffset }))); }
function field(t, key) { return Object.hasOwn(t.raw, key) ? { present: true, value: clone(t.raw[key]) } : { present: false }; }
function metadata(t) { return { title: t.title, author: t.author, artist: t.artist, album: field(t, 'album'), albumId: field(t, 'albumId'), songId: field(t, 'songId') }; }
function deferred() { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve: value => resolve(value) }; }
export { harness, clone, flush, ENDPOINT, canonical, identity };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
let total = 0, passed = 0;
async function test(name, fn) { total++; try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { process.exitCode = 1; console.log('FAIL ' + name + ': ' + e.message); } }
await test('canonical-metadata-copies-own-backups-stable-audio-and-order', async () => {
  const h = harness(), before = identity(h), originals = h.state.tracks.map(t => t.title);
  await h.startEnrich(); assert.equal(h.saves.length, 1); assert.equal(h.state.tracks[0].title, 'Innocence');
  for (let i = 0; i < 2; i++) { const t = h.state.tracks[i]; assert.equal(t.title, 'Innocence', 'all existing audio copies'); assert.equal(t.author, 'Avril Lavigne'); assert.equal(t.artist, t.author, 'normalized artist alias must follow author'); assert.equal(t.raw.catalogBackup.name, originals[i]); assert.equal(t.raw.catalogMatch.songId, canonical.songId); assert.equal(t.raw.catalogLyric.songId, canonical.songId); }
  assert.deepEqual(identity(h), before); assert.equal(h.audioWrites(), 0); assert.equal(h.state.progress, 37); assert.equal(h.coverJob, null); assert.equal(h.busy(), false);
});
await test('second-enrichment-does-not-replace-first-backups', async () => {
  const h = harness(); await h.startEnrich(); const backups = clone(h.state.tracks.map(t => t.raw.catalogBackup));
  await h.startEnrich(); assert.deepEqual(clone(h.state.tracks.map(t => t.raw.catalogBackup)), backups); assert.equal(h.saves.length, 2);
});
await test('failed-save-restores-full-display-and-raw-including-cover-absence', async () => {
  const h = harness({ cover: true, save: () => false }), before = clone(h.state.tracks);
  await h.startEnrich(); assert.equal(h.saves.length, 1); assert.deepEqual(clone(h.state.tracks), before); assert.equal(h.coverJob, null); assert.equal(h.busy(), false);
});
await test('manual-stop-after-stage-writes-restores-everything-and-never-saves', async () => {
  const d = deferred(); const h = harness({ cover: true, lyric: () => d.promise }), before = clone(h.state.tracks);
  const work = h.startEnrich(); await flush(); assert.ok(h.calls.some(c => c.method === 'TEXT')); h.coverJob.controller.abort();
  d.resolve({ ok: true, text: '[00:00.00]late lyric' }); await work;
  assert.equal(h.saves.length, 0); assert.deepEqual(clone(h.state.tracks), before); assert.equal(h.coverJob, null); assert.equal(h.busy(), false);
});
await test('restore-metadata-value-presence-keeps-shared-ID-lyrics-and-cover', async () => {
  const h = harness(), originals = h.state.tracks.map(metadata); await h.startEnrich();
  const protectedFields = clone(h.state.tracks.map(t => ({ match: t.raw.catalogMatch, lyric: t.raw.catalogLyric, pic: t.pic, offset: t.raw.lyricOffset })));
  await h.catalogRestoreInfo('imp:test'); await h.catalogRestoreInfo('fav');
  assert.deepEqual(h.state.tracks.map(metadata), originals);
  assert.deepEqual(clone(h.state.tracks.map(t => ({ match: t.raw.catalogMatch, lyric: t.raw.catalogLyric, pic: t.pic, offset: t.raw.lyricOffset }))), protectedFields);
});
await test('failed-restore-reinstates-fields-that-restore-deleted', async () => {
  const h = harness({ save: count => count === 1 }); await h.startEnrich(); const before = clone(h.state.tracks);
  const result = await h.catalogRestoreInfo('imp:test'); assert.equal(result.ok, false); assert.deepEqual(clone(h.state.tracks), before); assert.equal(h.coverJob, null);
});
await test('manual-conflict-during-lyric-await-is-not-committed-or-overwritten', async () => {
  const d = deferred(), h = harness({ lyric: () => d.promise }), before = clone(h.state.tracks);
  const work = h.startEnrich(); await flush(); const t = h.state.tracks[0]; t.title = '用户等待期间重命名'; t.raw.name = t.title;
  d.resolve({ ok: true, text: '[00:00.00]late lyric' }); await work;
  assert.equal(h.saves.length, 0, 'do not commit a stale target'); assert.equal(t.title, '用户等待期间重命名'); assert.equal(t.raw.name, t.title);
  const expected = before; expected[0].title = t.title; expected[0].raw.name = t.title; assert.deepEqual(clone(h.state.tracks), expected);
});
await test('removed-target-does-not-commit-or-resurrect', async () => {
  const d = deferred(), h = harness({ lyric: () => d.promise }), favoriteBefore = clone(h.state.tracks[1]);
  const work = h.startEnrich(); await flush(); h.state.tracks = h.state.tracks.filter(t => t.list !== 'imp:test');
  d.resolve({ ok: true, text: '[00:00.00]late lyric' }); await work;
  assert.equal(h.saves.length, 0); assert.equal(h.state.tracks.length, 1); assert.deepEqual(clone(h.state.tracks[0]), favoriteBefore);
});
await test('busy-restore-rejected-and-transaction-delete-rollback-is-correct', async () => {
  const h = harness(); h.coverJob = { mode: 'enrich' }; const before = clone(h.state.tracks);
  assert.equal((await h.catalogRestoreInfo('imp:test')).busy, true); assert.equal(h.saves.length, 0); assert.deepEqual(clone(h.state.tracks), before);
  h.coverJob = null; const t = h.state.tracks[1], tx = h.enrichTx(); h.enrichTxSnap(tx, t); h.enrichTxRaw(tx, t, 'albumId', undefined); h.enrichTxRollback(tx); assert.equal(t.raw.albumId, 17);
});
await test('old-v1-backup-restores-only-known-fields', async () => {
  const h = harness(), t = h.state.tracks[0]; t.raw.catalogBackup = { name: 'old v1', author: 'old singer', album: 'old album' }; t.raw.albumId = 55; t.raw.songId = 66;
  await h.catalogRestoreInfo('imp:test'); assert.equal(t.title, 'old v1'); assert.equal(t.author, 'old singer'); assert.equal(t.raw.album, 'old album'); assert.equal(t.raw.albumId, 55); assert.equal(t.raw.songId, 66);
});
console.log(`HANA_CATALOG_TRANSACTION ${passed}/${total}`);
}

#!/usr/bin/env node
/* Hana 独立B1验收：抽取并调用生产loadLyrics/解析/序列化/继承函数。
 * API与渲染为可控桩；验真实加载逻辑，不冒充宿主/音频真机验收。无网络/磁盘歌单写入。 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
function slice(a, b) {
  const start = src.indexOf(a), end = src.indexOf(b, start + a.length);
  assert.ok(start >= 0 && end > start, 'production anchors: ' + a);
  return src.slice(start, end);
}
const production = [
  slice('  function deriveId(t, url) {', '  function setTrackLyricOffset('),
  slice('  function validLyricOffset(v) {', '  function savedLyricOffset('),
  slice('  function parseLrcDocument(text) {', '  /* ---------- 无词入口 + 手动匹配'),
  slice('  function catalogLyricOf(t) {', '  var pendingSeek = 0;')
].join('\n');
const ENDPOINT = { lrcLoad: '/lrc-load', lrcSave: '/lrc-save', catalogLyric: '/api/catalog/lyric', musicLrc: '/music/lrc', lrcProxy: '/lrc-proxy', ttml: '/ttml', search: '/search' };
const plain = x => JSON.parse(JSON.stringify(x));
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(config = {}) {
  const calls = []; let audioWrites = 0;
  const noop = () => {};
  const h = {
    ENDPOINT, LYRIC_OFFSET_LIMIT: 180000, lyricAlign: null, lyricGen: 0, lyricBaseOffset: 0,
    lyricIndex: -1, lyricState: 'idle', state: { tracks: [], lyricLines: [], page: 'play' },
    normalizeAppUrl: x => x, closeLyricAlign: noop, clearLyricPress: noop, hideLyricHint: noop,
    clearStripLyricAnimation: noop, resetStripLyricSample: noop, renderLyrics: noop,
    renderAsk: noop, sizeLyricPad: noop, updateLyricIndex: noop,
    apiGetJson: async url => {
      calls.push({ kind: 'json', url });
      const custom = config.json ? await config.json(new URL(url, 'https://fixture.invalid')) : undefined;
      return custom ?? { ok: true, status: 200, body: { ok: true, lrc: '', results: [] } };
    },
    apiText: async url => {
      calls.push({ kind: 'text', url });
      return (config.text ? await config.text(new URL(url, 'https://fixture.invalid')) : undefined)
        ?? { ok: false, status: 404, text: '' };
    },
    apiPostJson: async (url, body) => { calls.push({ kind: 'post', url, body }); return { ok: true, body: { ok: true } }; }
  };
  h.findAnyById = id => h.state.tracks.find(t => t.id === id);
  h.audio = {};
  Object.defineProperties(h.audio, { src: { get: () => 'fixture-audio', set: () => audioWrites++ }, currentTime: { get: () => 37, set: () => audioWrites++ } });
  vm.createContext(h); vm.runInContext(production, h, { filename: 'production-lyrics-b1.js' });
  h.calls = calls; h.audioWrites = () => audioWrites;
  h.load = async t => { h.loadLyrics(t); await flush(); };
  return h;
}
function track(id, raw = {}, title = 'Same Title') {
  const data = { id, list: 'imp:test', name: title, mode: '在线', url: '/fixture-audio', ...raw };
  return { id, list: data.list, uid: data.list + '|' + id, title, author: data.author || '', artist: data.author || '',
    url: data.url, mode: data.mode, group: '', dur: 120, pic: '', lrcUrl: '', raw: data };
}
const auto = id => ({ provider: 'netease', songId: id, at: 1 });
const ok = text => ({ ok: true, status: 200, text });
const catalogCalls = h => h.calls.filter(c => c.url.startsWith(ENDPOINT.catalogLyric));
const searches = h => h.calls.filter(c => c.url.startsWith(ENDPOINT.search));
const nameWrites = h => h.calls.filter(c => c.url === ENDPOINT.lrcSave);
let passed = 0, total = 0;
async function test(name, fn) {
  total++;
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { process.exitCode = 1; console.log('FAIL ' + name + ': ' + e.message); }
}
await test('production-loadLyrics-auto-ID-enters-state-no-name-write', async () => {
  const h = harness({ text: u => ok('[00:01.00]AUTO_' + u.searchParams.get('songId')) });
  const t = track('bilibili:BV_A:1', { catalogLyric: auto('101'), lyricOffset: 1250 }); const before = JSON.stringify(t.raw);
  await h.load(t);
  assert.equal(h.lyricState, 'ready'); assert.equal(h.state.lyricLines[0].text, 'AUTO_101');
  assert.equal(catalogCalls(h).length, 1); assert.equal(searches(h).length, 0); assert.equal(nameWrites(h).length, 0);
  assert.equal(JSON.stringify(t.raw), before); assert.equal(h.audioWrites(), 0);
});
await test('automatic-LRC-retains-embedded-offset', async () => {
  const h = harness({ text: () => ok('[offset:250]\n[00:01.00]AUTO') });
  await h.load(track('bilibili:BV_A:1', { catalogLyric: auto('101'), lyricOffset: 1250 }));
  assert.equal(h.lyricBaseOffset, 250, 'automatic path must use parseLrcDocument advanceMs');
});
await test('current-name-user-LRC-wins', async () => {
  const h = harness({ json: u => u.pathname === ENDPOINT.lrcLoad ? { ok: true, body: { ok: true, lrc: '[00:01.00]USER_CURRENT' } } : undefined });
  const t = track('bilibili:BV_A:1', { catalogLyric: auto('101'), lyricOffset: 321 });
  await h.load(t); assert.equal(h.state.lyricLines[0].text, 'USER_CURRENT'); assert.equal(catalogCalls(h).length, 0); assert.equal(t.raw.lyricOffset, 321);
});
await test('original-name-user-LRC-remains-readable-after-rename', async () => {
  const old = '原来的标题【HQ】';
  const h = harness({ json: u => u.searchParams.get('name') === old ? { ok: true, body: { ok: true, lrc: '[00:01.00]USER_OLD_NAME' } } : undefined });
  const t = track('bilibili:BV_A:1', { catalogLyric: auto('101'), catalogBackup: { name: old, author: '原作者' } });
  const before = JSON.stringify(t.raw); await h.load(t);
  assert.equal(h.state.lyricLines[0].text, 'USER_OLD_NAME'); assert.equal(catalogCalls(h).length, 0); assert.equal(nameWrites(h).length, 0); assert.equal(JSON.stringify(t.raw), before);
});
await test('manual-binding-and-offset-preserved-in-real-chain', async () => {
  const h = harness({ text: u => u.pathname === ENDPOINT.musicLrc ? ok('[00:01.00]MANUAL_PICK') : undefined });
  const t = track('bilibili:BV_A:1', { catalogLyric: auto('101'), lyricOffset: -750,
    lyricMatch: { song: 'Manual', artist: 'Singer', keyword: 'Manual Singer', mid: '77', server: 'tencent', at: 9 } });
  const before = JSON.stringify(t.raw); await h.load(t);
  assert.equal(h.state.lyricLines[0].text, 'MANUAL_PICK'); assert.equal(catalogCalls(h).length, 0); assert.equal(JSON.stringify(t.raw), before);
  assert.ok(h.calls.some(c => c.url.includes('id=77') && c.url.includes('server=tencent')));
});
await test('same-title-different-official-IDs-do-not-share-key', async () => {
  const h = harness({ text: u => ok('[00:01.00]ID_' + u.searchParams.get('songId')) });
  await h.load(track('bilibili:BV_A:1', { catalogLyric: auto('101') })); assert.equal(h.state.lyricLines[0].text, 'ID_101');
  await h.load(track('bilibili:BV_B:2', { catalogLyric: auto('202') })); assert.equal(h.state.lyricLines[0].text, 'ID_202');
  assert.deepEqual(catalogCalls(h).map(c => new URL(c.url, 'https://fixture.invalid').searchParams.get('songId')), ['101', '202']);
});
await test('shared-official-song-keeps-per-audio-offsets', async () => {
  const h = harness({ text: () => ok('[00:01.00]SHARED') });
  const a = track('bilibili:BV_A:1', { catalogLyric: auto('101'), lyricOffset: 1000 });
  const b = track('bilibili:BV_B:2', { catalogLyric: auto('101'), lyricOffset: -500 });
  await h.load(a); await h.load(b); assert.equal(a.raw.lyricOffset, 1000); assert.equal(b.raw.lyricOffset, -500);
  assert.equal(h.audioWrites(), 0); assert.equal(nameWrites(h).length, 0);
});
await test('official-binding-survives-storage-and-normalize', async () => {
  const h = harness({ text: () => ok('[00:01.00]RELOADED') });
  const a = track('bilibili:BV_A:1', { catalogLyric: auto('101'), lyricOffset: 111, catalogBackup: { name: 'old' } });
  const reloaded = h.normalizeTrack(plain(h.toStoredTrack(a)));
  assert.deepEqual(plain(reloaded.raw.catalogLyric), auto('101')); assert.equal(reloaded.raw.lyricOffset, 111);
  assert.equal(reloaded.id, a.id); assert.equal(reloaded.uid, a.uid); await h.load(reloaded); assert.equal(h.state.lyricLines[0].text, 'RELOADED');
});
await test('new-same-audio-copy-inherits-auto-not-backup-or-own-manual-overwrite', async () => {
  const h = harness(); const source = track('bilibili:BV_A:1', { catalogLyric: auto('101'), lyricOffset: 1000, catalogBackup: { name: 'original-only-for-source' } });
  h.state.tracks = [source]; const copy = track(source.id, { lyricOffset: 777, lyricMatch: { keyword: 'own manual' } });
  h.inheritLyricSettings(copy); assert.equal(h.catalogLyricOf(copy).songId, '101'); assert.equal(copy.raw.lyricOffset, 777);
  assert.deepEqual(copy.raw.lyricMatch, { keyword: 'own manual' }); assert.ok(!Object.hasOwn(copy.raw, 'catalogBackup'));
});
await test('shared-catalogMatch-only-identity-survives-new-audio-copy', async () => {
  const h = harness(); const source = track('bilibili:BV_A:1', { catalogMatch: auto('101') }); h.state.tracks = [source];
  const copy = track(source.id); h.inheritLyricSettings(copy);
  assert.equal(h.catalogLyricOf(copy)?.songId, '101', 'copy must not lose already-confirmed shared song identity');
});
await test('late-A-cannot-overwrite-B', async () => {
  let resolveA; const deferred = new Promise(resolve => { resolveA = resolve; });
  const h = harness({ text: u => u.searchParams.get('songId') === '101' ? deferred : ok('[00:01.00]CURRENT_B') });
  h.loadLyrics(track('bilibili:BV_A:1', { catalogLyric: auto('101') })); await flush();
  await h.load(track('bilibili:BV_B:2', { catalogLyric: auto('202') })); assert.equal(h.state.lyricLines[0].text, 'CURRENT_B');
  resolveA(ok('[00:01.00]LATE_A')); await flush(); assert.equal(h.state.lyricLines[0].text, 'CURRENT_B'); assert.equal(h.lyricState, 'ready');
});
await test('official-no-word-error-never-fuzzy-searches-or-writes-name', async () => {
  for (const response of [{ ok: false, status: 404, text: '' }, { ok: false, status: 405, text: '{"code":405}' }, ok('[00:00.00]纯音乐，请欣赏')]) {
    const h = harness({ text: () => response }); await h.load(track('bilibili:BV_A:1', { catalogLyric: auto('101') }));
    assert.equal(h.state.lyricLines.length, 0); assert.equal(h.lyricState, 'none'); assert.equal(searches(h).length, 0); assert.equal(nameWrites(h).length, 0); assert.equal(catalogCalls(h).length, 1);
  }
});
await test('strict-provider-ID-validation', async () => {
  const h = harness(); for (const binding of [{ provider: 'qq', songId: '101' }, auto('abc456'), auto('../1'), auto('1234567890123')]) assert.equal(h.catalogLyricOf(track('bilibili:BV_A:1', { catalogLyric: binding })), null);
  assert.equal(h.catalogLyricOf(track('bilibili:BV_A:1', { catalogMatch: auto('101') })).songId, '101');
});
await test('old-track-without-auto-identity-keeps-legacy-chain', async () => {
  const h = harness({ text: u => u.pathname === ENDPOINT.musicLrc ? ok('[00:01.00]LEGACY') : undefined });
  await h.load(track('netease:777')); assert.equal(h.state.lyricLines[0].text, 'LEGACY'); assert.equal(catalogCalls(h).length, 0); assert.equal(nameWrites(h).length, 1);
});
console.log(`HANA_CATALOG_LYRICS ${passed}/${total}`);

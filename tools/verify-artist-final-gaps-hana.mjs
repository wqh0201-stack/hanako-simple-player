#!/usr/bin/env node
/* 1821集中返修证据：pending 空批量保留、失败查找不改显示、专辑补读艺人复核、恢复草稿。 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
function slice(a, b) { const p = src.indexOf(a), q = src.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return src.slice(p, q); }
const base = [
  slice('  function coverKey(s)', '  function coverTargets('),
  slice('  function referenceTrackDuration(', '  function guessCoverArtist('),
  slice('  function enrichSnapshot(', '  async function startEnrich('),
  slice('  async function startEnrich() {', "  $('coverStartBtn')"),
  slice('  async function saveSongEditor() {', '  function catalogArtistDict('),
  slice('  function applyDefaultCover(', '  function applyAlternateCover(')
].join('\n');
let pass = 0, total = 0;
function check(name, ok, detail) { total++; if (ok) pass++; else { console.error('FAIL ' + name + (detail ? ' ' + detail : '')); process.exitCode = 1; } }
const A = { id: 1, name: 'Artist A', aliases: [] };
const B = { id: 2, name: 'Artist B', aliases: [] };

// 1. 空歌手批量：已有 pending A 的曲目不得复用旧 B 或清 pending。
const state1 = { tracks: [{ id: 'bilibili:BV_P', uid: 'imp:1|bilibili:BV_P', list: 'imp:1', title: 'Song B', author: 'B', artist: 'B', pic: 'https://i0.hdslb.com/p.jpg', dur: 240, raw: { catalogMatch: { provider: 'netease', songId: 22, albumId: 22, title: 'Song B', artist: 'Artist B', artistId: 2 }, catalogPending: { artist: 'Artist A', reason: 'artist' } } }], currentUid: '' };
const ctx1 = {
  AbortController, URLSearchParams, DOMException,
  ENDPOINT: { catalogCover: '/api/catalog/cover', coverCatalog: '/cover-catalog', catalogLyric: '/api/catalog/lyric' },
  state: state1, audio: { duration: 0 }, coverListId: 'imp:1', enrichSingleUid: '', enrichForce: false,
  coverJob: null, singleCoverBusy: false, coverPickBusy: false, coverPickPanel: { hidden: true }, coverPickSaving: false,
  fields: { coverArtist: { value: '' }, coverSong: { value: '' }, coverCloseBtn: { disabled: false } },
  $: id => ctx1.fields[id] || { disabled: false, textContent: '', value: '' },
  findList: () => ({ id: 'imp:1', name: 'Mixed' }), guessCoverArtist: () => '',
  trackByUid: uid => state1.tracks.find(t => t.uid === uid), renderQueue: () => {}, renderTrack: () => {}, loadLyrics: () => {}, coverPanelBusy: () => {}, coverStatus: s => { ctx1.lastStatus = s; },
  savePlaylist: async () => { ctx1.saved = JSON.parse(JSON.stringify(state1.tracks)); return { ok: true }; }, toast: () => {}, probeCoverImage: async () => true,
  apiFetch: async () => ({ ok: true, status: 200, text: async () => '{}' }), apiText: async () => ({ ok: true, status: 200, text: '[00:01.00]x' }),
  apiJson: async () => { ctx1.apiCalls = (ctx1.apiCalls || 0) + 1; return { ok: false, status: 404, body: { ok: false } }; }
};
vm.createContext(ctx1); vm.runInContext(base, ctx1, { filename: 'pending-blank.js' });
await ctx1.startEnrich();
check('pending-blank-batch-keeps-original', state1.tracks[0].title === 'Song B' && state1.tracks[0].raw.catalogMatch.songId === 22 && state1.tracks[0].raw.catalogPending.artist === 'Artist A' && ctx1.apiCalls === undefined, JSON.stringify(state1.tracks[0]));
check('pending-blank-batch-not-cleared-in-payload', ctx1.saved && ctx1.saved[0].raw.catalogPending && ctx1.saved[0].raw.catalogMatch.songId === 22);

// 2. 查找 A 失败后保存：查询条件 A 不得写进显示 B。
const t2 = { id: 'bilibili:BV_E', uid: 'imp:1|bilibili:BV_E', list: 'imp:1', title: 'Song B', author: 'B', artist: 'B', pic: 'https://i0.hdslb.com/e.jpg', raw: { catalogMatch: { provider: 'netease', songId: 22, albumId: 22, title: 'Song B', artist: 'Artist B' } } };
const state2 = { tracks: [t2], currentUid: '' };
const fields2 = { songEditName: { value: 'Song B' }, songEditArtist: { value: 'B' }, songEditAlbum: { value: '' }, songEditSearchArtist: { value: 'Artist A' }, songEditSave: { disabled: false }, songEditCancel: { disabled: false }, songEditSearchBtn: { disabled: false }, songEditRestoreInfo: { disabled: false }, songEditRestoreCover: { disabled: false }, songEditLyricBtn: { disabled: false }, songEditCopyArtist: { disabled: false }, songEditCoverReload: { disabled: false }, songEditNote: { textContent: '', classList: { toggle: () => {} } } };
const ctx2 = {
  AbortController, URLSearchParams, DOMException, ENDPOINT: { catalogCover: '/api/catalog/cover' }, state: state2,
  songEditTargetUid: t2.uid, songEditSaving: false, songEditSeq: 0, songEditLoadSeq: 0, songEditController: null, songEditRef: null, songEditCoverDirty: false, songEditRestoreInfoDraft: false, songEditRestoreCoverDraft: false,
  songEditAttemptFailed: true, songEditAttemptArtist: 'Artist A', songEditAttemptReason: 'artist', songEditPop: { hidden: false },
  $: id => fields2[id] || { disabled: false, textContent: '', value: '' }, trackByUid: uid => state2.tracks.find(t => t.uid === uid),
  savePlaylist: async () => { ctx2.saved = JSON.parse(JSON.stringify(state2.tracks)); return { ok: true }; }, renderQueue: () => {}, renderTrack: () => {}, loadLyrics: () => {}, toast: () => {},
  closeSongEditor: () => { ctx2.closed = true; songEdit2Closed = true; }, probeCoverImage: async () => true
};
let songEdit2Closed = false;
vm.createContext(ctx2); vm.runInContext(base, ctx2, { filename: 'failed-search-save.js' });
ctx2.songEditTargetUid = t2.uid; ctx2.songEditAttemptFailed = true; ctx2.songEditAttemptArtist = 'Artist A';
await ctx2.saveSongEditor();
check('failed-search-preserves-display', state2.tracks[0].title === 'Song B' && state2.tracks[0].author === 'B' && ctx2.saved && ctx2.saved[0].author === 'B');
check('failed-search-keeps-pending-A', state2.tracks[0].raw.catalogPending && state2.tracks[0].raw.catalogPending.artist === 'Artist A');

// 3. 搜索 A、专辑同 id 补读 B：最终不能返回 B。
const lookup = async q => {
  if (q.kind === 'artist') return { artist: A };
  if (q.kind === 'search') return { tracks: [{ songId: 11, title: 'Song', artists: [A], albumId: 1, album: 'Album', duration: 250, pic: 'https://p1.music.126.net/a.jpg' }] };
  if (q.kind === 'album') return { tracks: [{ songId: 11, title: 'Song', artists: [B], albumId: 1, album: 'Album', duration: 250, pic: 'https://p1.music.126.net/b.jpg' }] };
  throw new Error('unexpected');
};
const ctx3 = { ENDPOINT: { catalogCover: '/api/catalog/cover' }, state: { tracks: [], currentUid: '' }, audio: { duration: 0 }, trackByUid: () => null };
vm.createContext(ctx3); vm.runInContext(base, ctx3, { filename: 'album-artist-recheck.js' });
const r3 = await ctx3.referenceResolve('Song', 'Artist A', lookup, { duration: 250, requireArtist: true });
check('album-artist-change-rejected', !r3.match && !r3.candidates.some(c => (c.artists || []).some(a => a.id === B.id)), JSON.stringify(r3));

// 4. 恢复信息/原图只进入事务 helper，不改写备份。
const t4 = { id: 'bilibili:BV_R', uid: 'imp:1|bilibili:BV_R', list: 'imp:1', title: 'Edited', author: 'Edited', artist: 'Edited', pic: 'https://x/new.jpg', raw: { catalogBackup: { name: 'Original', author: 'Original UP', artist: 'Original UP', hadAlbum: true, album: 'Original Album', hadAlbumId: true, albumId: 9, hadSongId: true, songId: 9 }, coverMatch: { albumId: 8, pic: 'https://x/new.jpg', originalPic: 'https://x/old.jpg' }, coverBasePic: 'https://x/old.jpg', lyricMatch: { keyword: 'manual' }, lyricOffset: 7 } };
const ctx4 = { state: { tracks: [t4] }, trackByUid: uid => ctx4.state.tracks.find(t => t.uid === uid) };
vm.createContext(ctx4); vm.runInContext(base, ctx4, { filename: 'restore-draft.js' });
let tx4 = ctx4.enrichTx();
check('restore-info-helper', ctx4.enrichRestoreInfoTx(tx4, t4) && t4.title === 'Original' && t4.raw.album === 'Original Album' && t4.raw.songId === 9 && t4.raw.catalogBackup.name === 'Original');
ctx4.enrichTxRollback(tx4);
let tx5 = ctx4.enrichTx();
check('restore-cover-helper', ctx4.enrichRestoreCoverTx(tx5, t4) && t4.pic === 'https://x/old.jpg' && !t4.raw.coverMatch && !t4.raw.coverBasePic && t4.raw.lyricMatch.keyword === 'manual' && t4.raw.lyricOffset === 7);
console.log('ARTIST_FINAL_GAPS ' + pass + '/' + total);

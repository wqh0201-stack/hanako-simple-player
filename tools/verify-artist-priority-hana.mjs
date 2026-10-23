#!/usr/bin/env node
/* 批量手填歌手优先：真实 startEnrich 输入框、旧绑定不复用、待确认保留、空歌手逐曲。 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
function slice(a, b) { const p = src.indexOf(a), q = src.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return src.slice(p, q); }
const production = [
  slice('  function coverKey(s)', '  function coverTargets('),
  slice('  function referenceTrackDuration(', '  function guessCoverArtist('),
  slice('  function enrichSnapshot(', '  async function startEnrich('),
  slice('  async function startEnrich() {', "  $('coverStartBtn')"),
  slice('  function applyDefaultCover(', '  function applyAlternateCover(')
].join('\n');
const A = { id: 1, name: 'Artist A', aliases: [] };
const B = { id: 2, name: 'Artist B', aliases: [] };
const state = { tracks: [], currentUid: '' };
const apiUrls = [], artistCalls = [], searchCalls = [], albumCalls = [];
function apiJson(url) {
  const u = new URL(url, 'http://x'); apiUrls.push(u.pathname);
  if (u.pathname !== '/cover-catalog') return { ok: false, status: 404, body: { ok: false } };
  const kind = u.searchParams.get('kind');
  if (kind === 'artist') {
    const n = u.searchParams.get('name'); artistCalls.push(n);
    const hit = [A, B].find(a => a.name === n);
    return hit ? { ok: true, body: { ok: true, artist: hit } } : { ok: false, status: 404, body: { ok: false } };
  }
  if (kind === 'search') {
    const title = u.searchParams.get('title'); searchCalls.push([title, u.searchParams.get('artist')]);
    const tracks = {
      'Shared Song': [
        { songId: 11, title: 'Shared Song', artists: [A], albumId: 11, album: 'A Album', duration: 260, pic: 'https://p1.music.126.net/a.jpg' },
        { songId: 12, title: 'Shared Song', artists: [B], albumId: 12, album: 'B Album', duration: 251, pic: 'https://p1.music.126.net/b.jpg' }
      ],
      'Only B Song': [{ songId: 12, title: 'Only B Song', artists: [B], albumId: 12, album: 'B Album', duration: 250, pic: 'https://p1.music.126.net/b.jpg' }],
      'Mixed One': [{ songId: 21, title: 'Mixed One', artists: [A], albumId: 21, album: 'Mixed A', duration: 200, pic: 'https://p1.music.126.net/m1.jpg' }],
      'Mixed Two': [{ songId: 22, title: 'Mixed Two', artists: [B], albumId: 22, album: 'Mixed B', duration: 205, pic: 'https://p1.music.126.net/m2.jpg' }]
    };
    return { ok: true, body: { ok: true, tracks: tracks[title] || [] } };
  }
  if (kind === 'album') {
    const id = Number(u.searchParams.get('id')); albumCalls.push(id);
    const hit = { 11: { songId: 11, title: 'Shared Song', artists: [A], albumId: 11, album: 'A Album', duration: 260, pic: 'https://p1.music.126.net/a.jpg' }, 12: { songId: 12, title: 'Only B Song', artists: [B], albumId: 12, album: 'B Album', duration: 250, pic: 'https://p1.music.126.net/b.jpg' } }[id];
    return { ok: true, body: { ok: true, tracks: hit ? [hit] : [] } };
  }
  return { ok: false, status: 404, body: { ok: false } };
}
function makeTrack(id, title, dur, binding) {
  return { id: 'bilibili:' + id, uid: 'imp:1|bilibili:' + id, list: 'imp:1', title, author: 'Bili UP', artist: 'Bili UP', pic: 'https://i0.hdslb.com/' + id + '.jpg', dur, raw: binding ? { catalogMatch: { provider: 'netease', songId: binding.songId, albumId: binding.albumId, title: binding.title, artist: binding.artist, artistId: binding.artistId } } : {} };
}
const ctx = {
  AbortController, URLSearchParams, DOMException,
  ENDPOINT: { catalogCover: '/api/catalog/cover', coverCatalog: '/cover-catalog', catalogLyric: '/api/catalog/lyric' },
  state, audio: { duration: 0 }, coverListId: 'imp:1', enrichSingleUid: '', enrichForce: false,
  coverJob: null, singleCoverBusy: false, coverPickBusy: false, coverPickPanel: { hidden: true }, coverPickSaving: false,
  fields: { coverArtist: { value: 'Artist A' }, coverSong: { value: '' }, coverCloseBtn: { disabled: false } },
  $: id => ctx.fields[id] || { disabled: false, textContent: '', value: '' },
  findList: () => ({ id: 'imp:1', name: 'Mixed Playlist' }), guessCoverArtist: () => '',
  trackByUid: uid => state.tracks.find(t => t.uid === uid),
  renderQueue: () => {}, renderTrack: () => {}, loadLyrics: () => {}, coverPanelBusy: () => {}, coverStatus: s => { ctx.lastStatus = s; },
  savePlaylist: async () => { ctx.saves = (ctx.saves || 0) + 1; ctx.saved = JSON.parse(JSON.stringify(state.tracks)); return { ok: true }; },
  toast: () => {}, probeCoverImage: async () => true,
  apiFetch: async () => ({ ok: true, status: 200, text: async () => '{}' }), apiText: async () => ({ ok: true, status: 200, text: '[00:01.00]fixture' }), apiJson
};
vm.createContext(ctx); vm.runInContext(production, ctx, { filename: 'artist-priority-production.js' });
let pass = 0, total = 0;
function check(name, ok, detail) { total++; if (ok) pass++; else { console.error('FAIL ' + name + (detail ? ' ' + detail : '')); process.exitCode = 1; } }

const a = makeTrack('A1', 'Shared Song', 250, { songId: 12, albumId: 12, title: 'Shared Song', artist: 'Artist B', artistId: 2 });
const b = makeTrack('B1', 'Only B Song', 250, { songId: 12, albumId: 12, title: 'Only B Song', artist: 'Artist B', artistId: 2 });
const c = makeTrack('C1', 'Mixed One', 200, null);
state.tracks = [a, b, c]; state.currentUid = a.uid;
await ctx.startEnrich();
const sa = state.tracks.find(t => t.id === 'bilibili:A1'), sb = state.tracks.find(t => t.id === 'bilibili:B1'), sc = state.tracks.find(t => t.id === 'bilibili:C1');
check('batch-seed-from-real-input-and-A-wins', sa.raw.catalogMatch && sa.raw.catalogMatch.songId === 11 && sa.title === 'Shared Song', JSON.stringify(sa.raw.catalogMatch));
check('old-B-binding-not-reused', sa.raw.catalogMatch && sa.raw.catalogMatch.songId !== 12);
check('specified-A-only-no-pending-on-success', !sa.raw.catalogPending);
check('only-B-preserved-and-pending', sb.title === 'Only B Song' && sb.raw.catalogMatch.songId === 12 && sb.raw.catalogPending && sb.raw.catalogPending.artist === 'Artist A', JSON.stringify(sb.raw.catalogPending));
check('empty-artist-mixed-per-track', sc.raw.catalogMatch && sc.raw.catalogMatch.songId === 21);
check('batch-no-global-artist-index', !apiUrls.some(p => /catalog\/(artist|index|build)/.test(p)), JSON.stringify(apiUrls));
check('batch-save-payload-has-pending', ctx.saved.find(t => t.id === 'bilibili:B1').raw.catalogPending && ctx.saved.find(t => t.id === 'bilibili:A1').raw.catalogMatch.songId === 11);

// 空歌手：不因上轮 A 遗留；两首不同标题各自候选。
const d = makeTrack('D1', 'Mixed One', 200, null), e = makeTrack('E1', 'Mixed Two', 200, null);
state.tracks = [d, e]; state.currentUid = d.uid; ctx.fields.coverArtist.value = ''; ctx.saves = 0; searchCalls.length = 0; artistCalls.length = 0;
await ctx.startEnrich();
check('empty-artist-does-not-call-artist-index', artistCalls.length === 0, JSON.stringify(artistCalls));
check('empty-artist-processes-each-title', state.tracks.every(t => t.raw.catalogMatch) && searchCalls.length >= 2, JSON.stringify(searchCalls));
console.log('ARTIST_PRIORITY ' + pass + '/' + total);

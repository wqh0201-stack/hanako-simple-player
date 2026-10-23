#!/usr/bin/env node
/* startEnrich 混合批量最小证据：8 首逐曲、无 artist/index、默认图缓存入口。 */
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
const taylor = { id: 44266, name: 'Taylor Swift', aliases: [] };
const artists = [taylor];
const tracks = Array.from({ length: 8 }, (_, i) => ({
  id: 'bilibili:BV_MIX_' + (i + 1), uid: 'imp:1|bilibili:BV_MIX_' + (i + 1), list: 'imp:1', title: i === 0 ? 'Anti-Hero' : 'Mixed Song ' + (i + 1),
  author: '', artist: '', pic: 'https://i0.hdslb.com/' + (i + 1) + '.jpg', dur: 200 + i, raw: {}
}));
const ctx = {
  AbortController, URLSearchParams, DOMException,
  ENDPOINT: { catalogCover: '/api/catalog/cover', coverCatalog: '/cover-catalog', catalogLyric: '/api/catalog/lyric' },
  state: { tracks, currentUid: tracks[0].uid }, audio: { duration: 0 },
  coverListId: 'imp:1', enrichSingleUid: '', enrichForce: false, coverJob: null, singleCoverBusy: false,
  coverPickBusy: false, coverPickPanel: { hidden: true }, coverPickSaving: false,
  $: id => ({ disabled: false, textContent: '', value: '' }),
  findList: () => ({ id: 'imp:1', name: 'Mixed Playlist' }),
  guessCoverArtist: () => '',
  trackByUid: uid => ctx.state.tracks.find(t => t.uid === uid),
  renderQueue: () => {}, renderTrack: () => {}, loadLyrics: () => {},
  coverPanelBusy: () => {}, coverStatus: s => { ctx.lastStatus = s; },
  toast: () => {},
  savePlaylist: async () => { ctx.saves = (ctx.saves || 0) + 1; return { ok: true }; },
  probeCoverImage: async () => true,
  apiFetch: async () => ({ ok: true, status: 200, text: async () => '{}' }),
  apiText: async () => ({ ok: true, status: 200, text: '[00:01.00]fixture' }),
  apiJson: async (url) => {
    ctx.apiUrls = ctx.apiUrls || [];
    const u = new URL(url, 'http://x'); ctx.apiUrls.push(u.pathname);
    if (u.pathname === '/cover-catalog') {
      const kind = u.searchParams.get('kind');
      if (kind === 'search') {
        const title = u.searchParams.get('title');
        return { ok: true, body: { ok: true, tracks: [{ songId: title === 'Anti-Hero' ? 401 : 500 + Number((title.match(/(\d+)/) || [0, 1])[1]), title, artists, albumId: 4, album: 'Mixed Album', duration: title === 'Anti-Hero' ? 200 : 200 + Number((title.match(/(\d+)/) || [0, 1])[1]), pic: 'https://p1.music.126.net/x.jpg' }] } };
      }
      if (kind === 'album') return { ok: true, body: { ok: true, tracks: [{ songId: 401, title: 'Anti-Hero', artists, albumId: 4, album: 'Mixed Album', duration: 200, pic: 'https://p1.music.126.net/x.jpg' }] } };
      return { ok: false, status: 404, body: { ok: false } };
    }
    if (u.pathname === '/api/catalog/lyric') return { ok: true, status: 200, body: { ok: true } };
    return { ok: false, status: 404, body: { ok: false } };
  }
};
vm.createContext(ctx); vm.runInContext(production, ctx, { filename: 'mixed-start-production.js' });
let pass = 0, total = 0;
function check(name, ok, detail) { total++; if (ok) pass++; else { console.error('FAIL ' + name + (detail ? ' ' + detail : '')); process.exitCode = 1; } }
await ctx.startEnrich();
check('eight-tracks-processed', ctx.saves === 1 && tracks.every(t => t.title.indexOf('Anti-Hero') === 0 || /^Mixed Song/.test(t.title)));
check('later-than-six-not-blocked', tracks[7].raw.catalogMatch && tracks[7].raw.catalogMatch.songId === 508);
check('no-artist-index-request', !ctx.apiUrls.some(p => /catalog\/(artist|index|build)/.test(p)), JSON.stringify(ctx.apiUrls));
check('default-cover-cache-entry', tracks.every(t => !t.pic || t.pic.indexOf('/api/catalog/cover?albumId=') === 0));
check('no-global-artist-scan', tracks.every(t => t.raw.catalogMatch && t.raw.catalogMatch.artistId === 44266));
console.log('MIXED_START ' + pass + '/' + total + ' ' + (ctx.lastStatus || ''));

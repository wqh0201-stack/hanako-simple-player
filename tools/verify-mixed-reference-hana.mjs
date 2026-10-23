#!/usr/bin/env node
/* 混合歌单参照最小离线证据：逐曲、时长边界、标题锚点、事务保护。 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
function slice(a, b) { const p = src.indexOf(a), q = src.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return src.slice(p, q); }
const production = [
  slice('  function coverKey(s)', '  function coverTargets('),
  slice('  function referenceTrackDuration(', '  function guessCoverArtist('),
  slice('  function enrichSnapshot(', '  async function startEnrich(')
].join('\n');
const taylor = { id: 44266, name: 'Taylor Swift', aliases: [] };
const one = { id: 1, name: 'Artist One', aliases: [] };
const two = { id: 2, name: 'Artist Two', aliases: [] };
const three = { id: 3, name: 'Artist Three', aliases: [] };
const ctx = {
  ENDPOINT: { catalogCover: '/api/catalog/cover' },
  state: { tracks: [], currentUid: '' },
  audio: { duration: 0 },
  trackByUid: uid => ctx.state.tracks.find(t => t.uid === uid),
  fmtTime: s => String(Math.floor(s / 60)) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
};
vm.createContext(ctx); vm.runInContext(production, ctx, { filename: 'mixed-reference-production.js' });

const albumTracks = {
  1: { tracks: [{ songId: 101, title: 'Song A', artists: [one], albumId: 1, album: 'Album One', duration: 240, pic: 'https://p1.music.126.net/a.jpg' }] },
  2: { tracks: [{ songId: 201, title: 'Pure Song', artists: [two], albumId: 2, album: 'Album Two', duration: 305, pic: 'https://p1.music.126.net/b.jpg' }] },
  3: { tracks: [{ songId: 301, title: 'Pure Song', artists: [three], albumId: 3, album: 'Album Three', duration: 400, pic: 'https://p1.music.126.net/c.jpg' }] },
  4: { tracks: [{ songId: 401, title: 'Anti-Hero', artists: [taylor], albumId: 4, album: 'Midnights', duration: 200, pic: 'https://p1.music.126.net/d.jpg' }] }
};
const artistCalls = [], searchCalls = [], albumCalls = [];
const lookup = async q => {
  if (q.kind === 'artist') {
    artistCalls.push(q.name);
    const hit = [one, two, three, taylor].find(a => a.name.toLowerCase() === q.name.toLowerCase());
    if (!hit) { const e = new Error('not found'); e.status = 404; throw e; }
    return { artist: hit };
  }
  if (q.kind === 'search') {
    searchCalls.push(q);
    if (q.title === 'Song A') return { tracks: [{ songId: 101, title: 'Song A', artists: [one], albumId: 1, album: 'Album One', duration: 240, pic: 'https://p1.music.126.net/a.jpg' }] };
    if (q.title === 'Pure Song') return { tracks: [
      { songId: 201, title: 'Pure Song', artists: [two], albumId: 2, album: 'Album Two', duration: 305, pic: 'https://p1.music.126.net/b.jpg' },
      { songId: 301, title: 'Pure Song', artists: [three], albumId: 3, album: 'Album Three', duration: 400, pic: 'https://p1.music.126.net/c.jpg' }
    ] };
    if (q.title === 'Anti-Hero') return { tracks: [{ songId: 401, title: 'Anti-Hero', artists: [taylor], albumId: 4, album: 'Midnights', duration: 200, pic: 'https://p1.music.126.net/d.jpg' }] };
    return { tracks: [] };
  }
  if (q.kind === 'album') { albumCalls.push(q.id); return albumTracks[q.id] || { tracks: [] }; }
  throw new Error('unexpected ' + JSON.stringify(q));
};

let pass = 0, total = 0;
function check(name, ok, detail) { total++; if (ok) pass++; else { console.error('FAIL ' + name + (detail ? ' ' + detail : '')); process.exitCode = 1; } }

const antiForms = ctx.cleanCoverQuery('Anti-Hero').forms;
check('anti-hero-not-split', antiForms.length === 1 && antiForms[0].song === 'Anti-Hero' && antiForms[0].artists.length === 0, JSON.stringify(antiForms));
const anti = await ctx.referenceResolve('Anti-Hero', '', lookup, { duration: 200 });
check('title-only-official-search', anti.match && anti.match.songId === 401 && anti.artists[0].id === 44266);
check('anti-hero-no-fake-artist-query', !artistCalls.includes('Anti') && !artistCalls.includes('Hero'), JSON.stringify(artistCalls));
check('title-only-cache-no-album-index', searchCalls.length === 1 && albumCalls.length === 1 && !artistCalls.length);

artistCalls.length = 0; searchCalls.length = 0; albumCalls.length = 0;
const explicit = await ctx.referenceResolve('Artist One - Song A', '', lookup, { duration: 240 });
check('explicit-title-artist-per-track', explicit.match && explicit.match.songId === 101 && artistCalls.includes('Artist One'));
check('explicit-duration-close', explicit.match && explicit.candidates[0]._allowed === true && explicit.candidates[0]._delta === 0);

artistCalls.length = 0; searchCalls.length = 0; albumCalls.length = 0;
const pure = await ctx.referenceResolve('Pure Song', '', lookup, { duration: 300 });
check('pure-title-picks-closest-duration', pure.match && pure.match.songId === 201 && pure.candidates.length === 2 && pure.candidates[0]._allowed === true && pure.candidates[1]._allowed === false);
check('pure-title-no-artist-index', artistCalls.length === 0 && searchCalls.length === 1);

// 时长边界：15 / 18 / 30 秒，边界含等号；未知不当 0 秒。
function candidate(duration) { return { duration, _delta: ctx.coverDurationDelta(240, duration), _tolerance: ctx.coverDurationTolerance(duration), _allowed: ctx.coverDurationAllows(240, duration) }; }
check('duration-4min-boundary', ctx.coverDurationTolerance(240) === 15 && candidate(254)._allowed === true && candidate(255)._allowed === true && candidate(256)._allowed === false);
check('duration-6min-boundary', ctx.coverDurationTolerance(360) === 18 && ctx.coverDurationAllows(360, 378) === true && ctx.coverDurationAllows(360, 379) === false);
check('duration-10min-boundary', ctx.coverDurationTolerance(600) === 30 && ctx.coverDurationAllows(600, 630) === true && ctx.coverDurationAllows(600, 631) === false);
check('duration-unknown-not-zero', ctx.coverDurationAllows(240, 0) === null && ctx.coverDurationAllows(0, 240) === null);

const long = await ctx.referenceResolve('Song A', '', lookup, { duration: 1200 });
check('long-compilation-deferred', !long.match && long.reason === 'duration' && long.candidates.length > 0);

// 8 首逐曲循环，不能被旧 6 首兜底挡住；每首独立线索。
artistCalls.length = 0; searchCalls.length = 0; albumCalls.length = 0;
const batch = [];
for (let i = 0; i < 8; i++) {
  const r = await ctx.referenceResolve(i % 2 ? 'Song A' : 'Pure Song', i % 2 ? 'Artist One' : '', lookup, { duration: i % 2 ? 240 : 300 });
  batch.push(!!r.match);
}
check('eight-tracks-all-processed', batch.every(Boolean) && batch.length === 8);
check('batch-no-global-artist-index', artistCalls.every(n => n === 'Artist One') && albumCalls.length <= 8);

// 事务：旧自动词清掉，手工词/偏移/备份保留。
const a = { id: 'bilibili:BV_A', uid: 'imp:test|bilibili:BV_A', list: 'imp:test', title: 'Old A', author: 'Old', artist: 'Old', raw: { catalogMatch: { provider: 'netease', songId: 101, albumId: 1, title: 'Song A', artist: 'Artist One' }, catalogLyric: { provider: 'netease', songId: 101 }, lyricOffset: 123, catalogBackup: { name: 'First', author: 'First' } } };
const b = { id: 'bilibili:BV_A', uid: 'fav|bilibili:BV_A', list: 'fav', title: 'Old A', author: 'Old', artist: 'Old', raw: { lyricMatch: { song: 'manual', keyword: 'manual' }, lyricOffset: 456 } };
ctx.state.tracks = [a, b];
const tx = ctx.enrichTx();
ctx.enrichApplyReference(tx, a, { songId: 401, albumId: 4, title: 'Anti-Hero', album: 'Midnights', duration: 200 }, [taylor]);
check('info-shared-reference', a.title === 'Anti-Hero' && a.author === 'Taylor Swift' && a.raw.songId === 401 && a.raw.catalogMatch.artists[0].id === 44266);
check('old-auto-lyric-cleared', !a.raw.catalogLyric && !b.raw.catalogLyric);
check('manual-lyric-and-offset-preserved', b.raw.lyricMatch.song === 'manual' && a.raw.lyricOffset === 123 && b.raw.lyricOffset === 456);
check('initial-backup-not-rewritten', a.raw.catalogBackup.name === 'First');
console.log('MIXED_REFERENCE ' + pass + '/' + total);

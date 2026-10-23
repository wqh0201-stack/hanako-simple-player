#!/usr/bin/env node
/* 封面选择器最小离线控制器：复用身份、同录音候选、只换图、默认重置与回滚。 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
function slice(a, b) { const p = src.indexOf(a), q = src.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return src.slice(p, q); }
const production = [
  slice('  function coverKey(s)', '  function coverTargets('),
  slice('  function applyDefaultCover(', '  function setSingleCoverBusy('),
  slice('  function closeCoverChooser()', '  function savedCoverIdentity('),
  slice('  function coverBoundFromAlbum(', '  async function startEnrich('),
  slice('  function savedCoverIdentity(', '  function renderCoverChooser(')
].join('\n');
const taylor = { id: 44266, name: 'Taylor Swift', aliases: [] };
const defaultPic = 'https://p1.music.126.net/default.jpg';
const altPic = 'https://p1.music.126.net/alt.jpg';
const originalPic = 'https://i0.hdslb.com/original.jpg';
const track = {
  id: 'bilibili:BV_ANTI:1', uid: 'imp:test|bilibili:BV_ANTI:1', list: 'imp:test', title: 'Anti-Hero', author: 'Taylor Swift', artist: 'Taylor Swift', pic: originalPic,
  raw: { catalogMatch: { provider: 'netease', songId: 1990192694, albumId: 153345099, title: 'Anti-Hero', artistId: 44266, artist: 'Taylor Swift' }, album: 'Midnights', albumId: 153345099, songId: 1990192694 }
};
const ctx = { ENDPOINT: { catalogCover: '/api/catalog/cover' }, state: { tracks: [track] }, trackByUid: uid => ctx.state.tracks.find(t => t.uid === uid), renderQueue: () => {}, renderTrack: () => {}, findList: () => null, guessCoverArtist: () => '', singleCoverName: () => 'Taylor Swift', withSession: x => x };
vm.createContext(ctx); vm.runInContext(production, ctx, { filename: 'cover-chooser-production.js' });
const defaultTrack = { songId: 1990192694, title: 'Anti-Hero', artists: [taylor], albumId: 153345099, album: 'Midnights', pic: defaultPic };
const altTrack = { songId: 1990192700, title: 'Anti-Hero', artists: [taylor], albumId: 555, album: 'Alternate Album', pic: altPic };
const tv = { songId: 9, title: "Anti-Hero (Taylor's Version)", artists: [taylor], albumId: 9, album: 'TV', pic: 'https://x/tv.jpg' };
const live = { songId: 10, title: 'Anti-Hero (Live)', artists: [taylor], albumId: 10, album: 'Live', pic: 'https://x/live.jpg' };
const other = { songId: 11, title: 'Other Song', artists: [taylor], albumId: 11, album: 'Other', pic: 'https://x/other.jpg' };
const extraCollab = { songId: 12, title: 'Anti-Hero', artists: [taylor, { id: 10912, name: 'Lana Del Rey' }], albumId: 12, album: 'Extra Collab', pic: 'https://x/extra.jpg' };
const lookup = async q => {
  if (q.kind === 'artist') return { artist: taylor };
  if (q.kind === 'search') return { tracks: [defaultTrack, altTrack, tv, live, other, extraCollab] };
  if (q.kind === 'album') return { tracks: [defaultTrack] };
  throw new Error('unexpected ' + JSON.stringify(q));
};
let pass = 0, total = 0;
function check(name, ok, detail) { total++; if (ok) pass++; else { console.error('FAIL ' + name + (detail ? ' ' + detail : '')); process.exitCode = 1; } }
ctx.coverPickPanel = { hidden: false }; ctx.coverPickBusy = true; ctx.coverPickSaving = false; ctx.coverPickSeq = 3; let aborted = false; ctx.coverPickController = { abort: () => { aborted = true; } };
ctx.closeCoverChooser();
check('loading-cancel-aborts-and-hides', aborted && ctx.coverPickPanel.hidden && ctx.coverPickSeq === 4 && !ctx.coverPickBusy);
ctx.coverPickPanel.hidden = false; ctx.coverPickBusy = true; ctx.coverPickSaving = true; aborted = false;
ctx.closeCoverChooser();
check('saving-cancel-blocked', !aborted && !ctx.coverPickPanel.hidden && ctx.coverPickBusy && ctx.coverPickSaving);
ctx.coverPickSaving = false; ctx.coverPickBusy = false;
const identity = ctx.savedCoverIdentity(track);
check('identity-reuses-full-saved-artist', identity && identity.title === 'Anti-Hero' && identity.artists[0].id === 44266);
let identitySearchCalls = 0;
const identityLookup = async q => { if (q.kind === 'search') identitySearchCalls++; return { artist: taylor }; };
const reused = await ctx.coverChooserIdentity(track, identityLookup);
check('saved-identity-does-not-search-title', reused && reused.title === 'Anti-Hero' && identitySearchCalls === 0);
const loaded = await ctx.coverChooserLoad(identity, track, lookup);
const biliOnly = { ...track, pic: originalPic, raw: { ...track.raw, coverMatch: undefined } };
check('netease-thumb-only', ctx.coverThumb('https://p1.music.126.net/a.jpg') === 'https://p1.music.126.net/a.jpg?param=120y120' && ctx.coverThumb('https://i0.hdslb.com/a.jpg') === 'https://i0.hdslb.com/a.jpg');
check('bilibili-current-not-mislabeled-default', ctx.coverCurrentChoice(biliOnly, loaded.choices) === null);
check('two-same-recording-albums', loaded.choices.length === 2 && loaded.choices.some(c => c.albumId === 153345099) && loaded.choices.some(c => c.albumId === 555));
check('wrong-version-and-other-song-excluded', !loaded.choices.some(c => /Taylor's Version|Live/.test(c.title)) && !loaded.choices.some(c => c.albumId === 11 || c.albumId === 12));
const before = JSON.parse(JSON.stringify(track.raw.catalogMatch));
const alt = loaded.choices.find(c => c.albumId === 555), def = loaded.defaultInfo || loaded.choices.find(c => c.albumId === 153345099);
const snapshots = ctx.applyAlternateCover(track.id, alt, identity.artists, def, 1);
check('alternate-only-cover-and-metadata', track.pic === altPic && track.title === 'Anti-Hero' && track.author === 'Taylor Swift' && track.raw.album === 'Midnights' && track.raw.coverMatch.albumId === 555 && track.raw.coverBasePic === originalPic && JSON.stringify(track.raw.catalogMatch) === JSON.stringify(before));
ctx.rollbackCovers(snapshots);
check('save-failure-rollback-restores-cover', track.pic === originalPic && !track.raw.coverMatch && !track.raw.coverBasePic && JSON.stringify(track.raw.catalogMatch) === JSON.stringify(before));
ctx.applyAlternateCover(track.id, alt, identity.artists, def, 2);
ctx.applyDefaultCover(track.id, { pic: defaultPic }, identity.artists, 3);
check('default-reset-clears-selection-keeps-base', track.pic === defaultPic && !track.raw.coverMatch && track.raw.coverBasePic === originalPic && JSON.stringify(track.raw.catalogMatch) === JSON.stringify(before));
const civil = { id: 103399, name: 'The Civil Wars', aliases: [] };
const safeTrack = { id: 'bilibili:BV_SAFE:1', uid: 'imp:test|bilibili:BV_SAFE:1', list: 'imp:test', title: 'Safe & Sound (from The Hunger Games Soundtrack)', author: 'Taylor Swift / The Civil Wars', pic: 'https://i0.hdslb.com/safe.jpg', raw: {
  catalogMatch: { provider: 'netease', songId: 23432684, albumId: 2133992, title: 'Safe & Sound (from The Hunger Games Soundtrack)', artistId: 44266, artist: 'Taylor Swift / The Civil Wars', artists: [taylor, civil] },
  coverMatch: { albumId: 777, album: 'Old Wrong Cover', pic: 'https://x/wrong.jpg', songId: 1 },
  album: 'The Hunger Games', albumId: 2133992, songId: 23432684
} };
const safeDefault = { songId: 23432684, title: 'Safe & Sound (from The Hunger Games Soundtrack)', artists: [taylor, civil], albumId: 2133992, album: 'The Hunger Games', pic: defaultPic };
const safeAlt = { songId: 999, title: 'Safe and Sound', artists: [taylor, civil], albumId: 555, album: 'Alternate Album', pic: altPic };
const safeLookup = async q => {
  if (q.kind === 'artist') return { artist: taylor };
  if (q.kind === 'search') return { tracks: [safeDefault, safeAlt] };
  if (q.kind === 'album') return { tracks: [safeDefault] };
  throw new Error('unexpected ' + JSON.stringify(q));
};
const safeId = ctx.savedCoverIdentity(safeTrack);
const safeBound = ctx.coverBoundFromAlbum(safeTrack, { tracks: [safeDefault] });
check('bound-default-uses-catalog-cover-cache', safeBound && safeBound.pic === '/api/catalog/cover?albumId=2133992');
const incompleteBound = ctx.coverBoundFromAlbum({ ...safeTrack, raw: { ...safeTrack.raw, catalogMatch: { ...safeTrack.raw.catalogMatch, artists: undefined } } }, { tracks: [{ ...safeDefault, songId: 999 }] });
check('incomplete-bound-not-one-singer', incompleteBound === null);
const safeLoaded = await ctx.coverChooserLoad(safeId, safeTrack, safeLookup);
check('different-songid-different-title-layer-kept', safeLoaded.choices.some(c => c.songId === 23432684) && safeLoaded.choices.some(c => c.songId === 999));
check('old-cover-not-pushed-as-candidate', !safeLoaded.choices.some(c => c.albumId === 777));
console.log('COVER_CHOOSER ' + pass + '/' + total + ' (incl. title-layer extras)');

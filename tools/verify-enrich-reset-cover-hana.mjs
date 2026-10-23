#!/usr/bin/env node
/* 显式整理必须重置已选其他专辑封面；保留最初原图备份与音轨/词。 */
import assert from 'node:assert/strict';
import { harness, canonical } from './verify-catalog-transaction-hana.mjs';
const h = harness(), t = h.state.tracks[0];
h.coverPickBusy = false; h.coverPickPanel = { hidden: true };
t.raw.coverMatch = { albumId: 999, album: 'User Pick', pic: 'https://custom.example/pick.jpg', originalPic: 'https://custom.example/original.jpg', songId: 77 };
t.raw.coverBasePic = 'https://custom.example/original.jpg';
t.pic = 'https://custom.example/pick.jpg';
t.raw.lyricOffset = 123;
const beforeUrl = t.url, beforeOffset = t.raw.lyricOffset;
await h.startEnrich();
assert.ok(t.pic && t.pic !== 'https://custom.example/pick.jpg', 'default cover must replace selected alternate');
assert.equal(t.raw.coverMatch, undefined, 'selected alternate metadata cleared');
assert.equal(t.raw.coverBasePic, 'https://custom.example/original.jpg', 'initial original backup preserved');
assert.equal(t.url, beforeUrl);
assert.equal(t.raw.lyricOffset, beforeOffset);
assert.equal(h.saves.length, 1);
console.log('ENRICH_RESET_COVER 1/1');

const h2 = harness({ cover: url => {
  const u = new URL(url, 'http://fixture');
  if (u.searchParams.get('kind') === 'album') return { ok: true, body: { ok: true, tracks: [{ ...canonical, pic: 'https://p1.music.126.net/default.jpg' }] } };
  return { ok: false, status: 404, body: { ok: false } };
} });
h2.coverPickBusy = false; h2.coverPickPanel = { hidden: true };
const b = h2.state.tracks[0];
b.raw.catalogMatch = { provider: 'netease', songId: canonical.songId, albumId: canonical.albumId, title: 'Innocence', artistId: 46490, artist: 'Avril Lavigne' };
h2.$('coverArtist').value = 'Avril Lavigne';
b.raw.coverMatch = { albumId: 999, pic: 'https://custom.example/pick.jpg', originalPic: 'https://custom.example/original.jpg' };
b.raw.coverBasePic = 'https://custom.example/original.jpg'; b.pic = 'https://custom.example/pick.jpg';
await h2.startEnrich();
assert.equal(h2.state.tracks[0].raw.catalogMatch.songId, canonical.songId);
assert.equal(h2.state.tracks[0].raw.catalogMatch.albumId, canonical.albumId);
assert.equal(h2.state.tracks[0].raw.catalogMatch.artistId, 46490);
assert.ok(!h2.calls.some(c => /catalogArtist|catalogBuild|catalogIndex/.test(c.url)), 'bound identity must not rebuild/search');
console.log('BOUND_IDENTITY 1/1');

const h3 = harness({ cover: url => {
  const u = new URL(url, 'http://fixture');
  if (u.searchParams.get('kind') === 'album') return { ok: true, body: { ok: true, tracks: [{ ...canonical, songId: 999999 }] } };
  return { ok: false, status: 404, body: { ok: false } };
} });
h3.coverPickBusy = false; h3.coverPickPanel = { hidden: true };
const c = h3.state.tracks[0];
c.raw.catalogMatch = { provider: 'netease', songId: canonical.songId, albumId: canonical.albumId, title: 'Innocence', artistId: 46490, artist: 'Avril Lavigne / Second Artist' };
const beforeC = JSON.stringify({ title: c.title, author: c.author, match: c.raw.catalogMatch });
await h3.startEnrich();
assert.equal(JSON.stringify({ title: c.title, author: c.author, match: c.raw.catalogMatch }), beforeC);
assert.ok(!h3.calls.some(x => /catalogArtist|catalogBuild|catalogIndex/.test(x.url)), 'invalid bound must not guess/rebuild');
console.log('BOUND_INCOMPLETE_KEPT 1/1');

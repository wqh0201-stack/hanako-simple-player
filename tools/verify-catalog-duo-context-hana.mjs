#!/usr/bin/env node
/* 双歌手 context 的生产 startEnrich 轻量复现：不可解引用 null artist。 */
import assert from 'node:assert/strict';
import { harness, ENDPOINT } from './verify-catalog-transaction-hana.mjs';
const taylor = { id: 44266, name: 'Taylor Swift', aliases: [] };
const boys = { id: 1001, name: 'Boys Like Girls', aliases: [] };
const track = { songId: 1990192705, title: 'Two Is Better Than One', artists: [boys, taylor], albumId: 153345099, album: 'Love Drunk', albumType: '专辑', albumSize: 13, published: 1666281600000, pic: 'https://p1.music.126.net/two.jpg' };
const h = harness({
  get: url => {
    if (url.includes('/catalog/index')) return { ok: true, body: { ok: true, artist: taylor, albums: [], coverage: { more: false } } };
  },
  cover: url => {
    const u = new URL(url, 'http://fixture'), kind = u.searchParams.get('kind');
    if (kind === 'artist') {
      const n = u.searchParams.get('name');
      const a = n === boys.name ? boys : n === taylor.name ? taylor : null;
      return a ? { ok: true, body: { ok: true, artist: a } } : { ok: false, status: 404, body: { ok: false } };
    }
    if (kind === 'albums') return { ok: true, body: { ok: true, albums: [{ id: track.albumId, name: track.album, type: '专辑', size: 13, published: track.published }], more: false } };
    if (kind === 'search') return { ok: true, body: { ok: true, tracks: u.searchParams.get('title') === track.title ? [track] : [] } };
    if (kind === 'album') return { ok: true, body: { ok: true, tracks: [track] } };
    return { ok: false, status: 404, body: { ok: false } };
  }
});
h.enrichSingleUid = h.state.tracks[0].uid;
h.$('coverSong').value = 'Two Is Better Than One';
h.$('coverArtist').value = 'Boys Like Girls / Taylor Swift';
await h.startEnrich();
assert.equal(h.state.tracks[0].title, 'Two Is Better Than One');
assert.equal(h.state.tracks[0].author, 'Boys Like Girls / Taylor Swift');
assert.equal(h.state.tracks[0].raw.catalogMatch.artistId, 1001);
assert.equal(h.saves.length, 1);
console.log('DUO_CONTEXT_OK 1/1');

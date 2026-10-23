#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
const a = src.indexOf('  function coverRestoreTargets('), b = src.indexOf('  async function openEnrichPanel(', a);
assert.ok(a > 0 && b > a, 'restore anchors');
const make = () => new Function('state', 'coverListId', 'coverStatus', 'coverPanelBusy', '$', 'savePlaylist', 'renderQueue', 'renderTrack',
  'var coverJob=null; var rollbackCovers=function(){};\n' + src.slice(a, b) + '\nreturn { restoreCovers, coverRestoreTargets };');
const tracks = [
  { id: 'A', uid: 'L|A', list: 'L', pic: 'newA', raw: { coverMatch: { originalPic: 'origA' } } },
  { id: 'A', uid: 'F|A', list: 'F', pic: 'newAF', raw: { coverMatch: { originalPic: 'origAF' } } },
  { id: 'B', uid: 'L|B', list: 'L', pic: 'newB', raw: { coverMatch: { originalPic: 'origB' } } }
].map(t => ({ ...t, raw: { ...t.raw } }));
const state = { tracks };
const h = make()(state, 'L', () => {}, () => {}, () => ({ disabled: false }), async () => ({ ok: true }), () => {}, () => {});
assert.deepEqual(h.coverRestoreTargets('L', 'L|A').map(t => t.uid), ['L|A']);
await h.restoreCovers('L', 'L|A');
assert.equal(state.tracks[0].pic, 'origA');
assert.equal(state.tracks[1].pic, 'origAF', 'same-id other-list copy keeps old per-copy restore semantics');
assert.equal(state.tracks[2].pic, 'newB', 'other id must not move');
assert.ok(!state.tracks[0].raw.coverMatch && !state.tracks[1].raw.coverMatch);
assert.ok(state.tracks[2].raw.coverMatch);
console.log('RESTORE_SCOPE_OK 1/1');

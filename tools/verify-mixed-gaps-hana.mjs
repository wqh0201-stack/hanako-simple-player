#!/usr/bin/env node
/* 1817 收尾缺口证据：旧缓存补时长、专辑冲突重算、原始搜索单位、保护错误、首次备份、按需专辑表头。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createCoverCatalog } from '../lib/cover-catalog.js';
import { createCatalogIndex } from '../lib/catalog-index.js';
import { createRequestGate } from '../lib/netease-gate.js';

let pass = 0, total = 0;
function check(name, ok, detail) { total++; if (ok) pass++; else { console.error('FAIL ' + name + (detail ? ' ' + detail : '')); process.exitCode = 1; } }
const repo = path.dirname(new URL(import.meta.url).pathname);
const src = fs.readFileSync(path.join(repo, '../ui/app.js'), 'utf8');
function slice(a, b) { const p = src.indexOf(a), q = src.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return src.slice(p, q); }
const taylor = { id: 44266, name: 'Taylor Swift', aliases: [] };
const production = [
  slice('  function coverKey(s)', '  function coverTargets('),
  slice('  function referenceTrackDuration(', '  function guessCoverArtist('),
  slice('  function enrichSnapshot(', '  async function startEnrich(')
].join('\n');
const ctx = {
  ENDPOINT: { catalogCover: '/api/catalog/cover' }, state: { tracks: [], currentUid: '' }, audio: { duration: 0 },
  trackByUid: uid => ctx.state.tracks.find(t => t.uid === uid), fmtTime: s => String(Math.floor(s / 60)) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
};
vm.createContext(ctx); vm.runInContext(production, ctx, { filename: 'mixed-gaps-production.js' });

const album = (duration) => ({ tracks: [{ songId: 101, title: 'Song', artists: [taylor], albumId: 1, album: 'Album', duration, pic: 'https://p1.music.126.net/x.jpg' }] });
let albumCalls = 0, searchTracks = [{ songId: 101, title: 'Song', artists: [taylor], albumId: 1, album: 'Album', pic: 'https://p1.music.126.net/x.jpg' }];
const lookup = async q => {
  if (q.kind === 'album') { albumCalls++; return album(240); }
  if (q.kind === 'search') return { tracks: searchTracks };
  throw Object.assign(new Error('not found'), { status: 404 });
};
const legacy = await ctx.referenceResolve('Song', '', lookup, { duration: 240 });
check('legacy-search-missing-duration:reads-album', legacy.match && legacy.match.duration === 240 && albumCalls === 1, JSON.stringify({ albumCalls, legacy }));

albumCalls = 0;
const conflictLookup = async q => q.kind === 'album' ? (albumCalls++, album(1200)) : { tracks: [{ ...searchTracks[0], duration: 240 }] };
const conflict = await ctx.referenceResolve('Song', '', conflictLookup, { duration: 240 });
check('album-conflict:no-auto-match', !conflict.match && conflict.reason === 'duration' && albumCalls === 1 && conflict.candidates[0]._allowed === false, JSON.stringify({ albumCalls, conflict }));

// 原始搜索包：dt / duration 都按毫秒，生产 search 输出秒。
async function rawSearch(field, value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hap-raw-'));
  const data = { code: 200, result: { songs: [{ id: 1, name: 'Raw Song', ar: [{ id: 1, name: 'Raw Artist' }], al: { id: 2, name: 'Raw Album' }, [field]: value }] } };
  const fake = { dataDir: dir, logger: { warn() {} }, network: { async fetch() { return { ok: true, json: async () => data }; } } };
  try {
    const catalog = createCoverCatalog(fake, { gate: createRequestGate({ minInterval: 0, cooldownMs: 0 }) });
    return (await catalog.search('Raw Song', 'Raw Artist')).tracks[0].duration;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
check('raw-search-dt-ms', await rawSearch('dt', 240000) === 240);
check('raw-search-duration-ms', await rawSearch('duration', 240000) === 240);

// 首次备份：已有备份不重写；未整理曲目由编辑入口补一次。
const track = { id: 'bilibili:BV_EDIT', uid: 'imp:1|bilibili:BV_EDIT', list: 'imp:1', title: 'Original', author: 'UP', artist: 'UP', raw: {} };
ctx.state.tracks = [track];
let tx = ctx.enrichTx();
ctx.enrichEnsureBackup(tx, track);
check('edit-first-backup', track.raw.catalogBackup && track.raw.catalogBackup.name === 'Original');
track.title = 'Edited'; track.author = 'New';
const kept = JSON.stringify(track.raw.catalogBackup);
tx = ctx.enrichTx(); ctx.enrichEnsureBackup(tx, track);
check('edit-backup-not-rewritten', JSON.stringify(track.raw.catalogBackup) === kept);

// 编辑显示信息真实保存路径：首次只建一次备份，二次编辑不重写。
const editTrack = { id: 'bilibili:BV_EDIT2', uid: 'imp:1|bilibili:BV_EDIT2', list: 'imp:1', title: 'Original Edit', author: 'UP', artist: 'UP', raw: {} };
const editCtx = {
  state: { tracks: [editTrack], currentUid: '' }, editTargetUid: editTrack.uid, editSaving: false,
  fields: { editSong: { value: 'Edited Title' }, editArtist: { value: 'Edited Artist' }, editAlbum: { value: 'Edited Album' }, editNote: { textContent: '' }, editSaveBtn: { disabled: false }, editCancelBtn: { disabled: false } },
  $: id => editCtx.fields[id] || { disabled: false, textContent: '', value: '' },
  trackByUid: uid => editCtx.state.tracks.find(t => t.uid === uid),
  renderQueue: () => {}, renderTrack: () => {}, toast: () => {}, savePlaylist: async () => { editCtx.saves = (editCtx.saves || 0) + 1; return { ok: true }; },
  closeEditPanel: () => { editCtx.closed = true; }
};
vm.createContext(editCtx); vm.runInContext(production + '\n' + slice('  async function saveEditPanel() {', '  function catalogArtistDict('), editCtx, { filename: 'mixed-gaps-edit.js' });
editCtx.editTargetUid = editTrack.uid; editCtx.editSaving = false; editCtx.editPop = { hidden: false };
await editCtx.saveEditPanel();
check('edit-save-first-backup', editCtx.saves === 1 && editTrack.raw.catalogBackup && editTrack.raw.catalogBackup.name === 'Original Edit' && editTrack.title === 'Edited Title');
const editBackup = JSON.stringify(editTrack.raw.catalogBackup);
editCtx.fields.editSong.value = 'Edited Again'; editCtx.editSaving = false; editCtx.editTargetUid = editTrack.uid; editCtx.editPop.hidden = false;
await editCtx.saveEditPanel();
check('edit-save-backup-once', editCtx.saves === 2 && JSON.stringify(editTrack.raw.catalogBackup) === editBackup);

// 保护错误不得被 album catch 吞掉后继续图/词。
const appCtx = {
  AbortController, URLSearchParams, DOMException, ENDPOINT: { catalogCover: '/api/catalog/cover' },
  state: { tracks: [track], currentUid: '' }, matchTargetUid: track.uid, matchSelected: { songId: 101, albumId: 1, artists: [taylor], title: 'Song' },
  matchSaving: false, matchBusy: false, matchPop: { hidden: false }, $: () => ({ disabled: false, textContent: '' }),
  trackByUid: uid => appCtx.state.tracks.find(t => t.uid === uid), toast: () => {}, savePlaylist: async () => { appCtx.saves = (appCtx.saves || 0) + 1; return { ok: true }; },
  renderQueue: () => {}, renderTrack: () => {}, loadLyrics: () => {}, closeMatchPanel: () => {},
  probeCoverImage: async () => { appCtx.imageCalls = (appCtx.imageCalls || 0) + 1; return true; },
  enrichCall: async () => { const e = new Error('需要验证'); e.requiresVerification = true; throw e; },
  coverData: async () => ({ tracks: [] }), saveEditPanel: () => {}
};
vm.createContext(appCtx); vm.runInContext(production + '\n' + slice('  async function applyMatchChoice() {', '  function closeEditPanel()'), appCtx, { filename: 'mixed-gaps-apply.js' });
appCtx.enrichCall = async () => { const e = new Error('需要验证'); e.requiresVerification = true; throw e; };
await appCtx.applyMatchChoice();
check('protection-stops-before-image', appCtx.imageCalls === undefined && appCtx.saves === undefined);

// catalog-index 按需专辑保留/补齐表头，不变成无名专辑。
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hap-index-'));
const png = fs.readFileSync(path.join(repo, '../docs/player-ui/assets/demo-cover.png'));
const index = createCatalogIndex({ dataDir: cacheDir, logger: { warn() {} }, network: { async fetch() { return { ok: true, arrayBuffer: async () => png }; } } }, {
  coverCatalog: { album: async id => ({ tracks: [{ songId: 7, title: 'Song', album: 'Header Album', albumType: '专辑', subType: '录音室版', albumSize: 9, published: 123, albumId: Number(id), pic: 'https://p1.music.126.net/z.jpg' }] }) },
  gate: { schedule: async () => {}, cool: () => 0, state: () => ({ retryAfterMs: 0 }) }
});
const img = await index.cover(123);
const saved = JSON.parse(fs.readFileSync(path.join(cacheDir, 'catalog-index.json'), 'utf8'));
check('catalog-cover-header-fallback', !!img.file && saved.albums['123'].name === 'Header Album' && saved.albums['123'].type === '专辑' && saved.albums['123'].size === 9 && saved.albums['123'].published === 123, JSON.stringify(saved.albums['123']));
fs.rmSync(cacheDir, { recursive: true, force: true });
console.log('MIXED_GAPS ' + pass + '/' + total);

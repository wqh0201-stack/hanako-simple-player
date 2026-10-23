#!/usr/bin/env node
/* C 证据：真实标题夹具 + 公开候选样本。只做样本覆盖，不宣称 100 首命中率。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(repo, 'ui/app.js'), 'utf8');
function slice(a, b) { const p = src.indexOf(a), q = src.indexOf(b, p + a.length); if (p < 0 || q <= p) throw new Error('anchor ' + a); return src.slice(p, q); }
const pure = slice('  function coverKey(s)', '  function coverTargets(');
const dictFn = slice('  function catalogArtistDict(index) {', '  function catalogRestoreInfo(');
const ENDPOINT = { catalogCover: '/api/catalog/cover' };
const api = new Function('ENDPOINT', pure + '\n' + dictFn + '\nreturn { cleanCoverQuery, pickCoverMatch, catalogArtistDict, coverKey, coverSong };')(ENDPOINT);
const x = JSON.parse(fs.readFileSync(path.join(repo, 'tools/fixtures/cover-avril-real-2026-10-20.json'), 'utf8'));
const t = JSON.parse(fs.readFileSync(path.join(repo, 'tools/fixtures/catalog-taylor-public-2026-10-20.json'), 'utf8'));
const titles = JSON.parse(fs.readFileSync(path.join(repo, 'tools/fixtures/catalog-real-titles-2026-10-20.json'), 'utf8')).groups;
const avrilTitles = titles.find(g => g.artist === 'Avril Lavigne').titles;
const taylorTitles = titles.find(g => g.artist === 'Taylor Swift').titles;
const avrilDict = api.catalogArtistDict({ albums: Object.values(x.albums) });
const taylorAlbums = Object.create(null);
for (const tr of t.tracks) {
  const id = String(tr.albumId);
  if (!taylorAlbums[id]) taylorAlbums[id] = { id: tr.albumId, name: tr.album || '', type: '', size: tr.albumSize || 0, published: tr.published || 0, tracks: [] };
  taylorAlbums[id].tracks.push(tr);
}
const taylorDict = api.catalogArtistDict({ albums: Object.values(taylorAlbums) });
function parseStats(list) { return list.reduce((s, title) => { const q = api.cleanCoverQuery(title); s.ok += q.ok ? 1 : 0; s.forms += q.forms.length; s.artistForms += q.forms.filter(f => f.artists.length).length; return s; }, { ok: 0, forms: 0, artistForms: 0 }); }
function coverage(list, songs) { const key = s => api.coverKey(api.coverSong(s).song || s).replace(/[.。]+$/, ''); const keys = new Set(songs.map(key)); return list.filter(title => api.cleanCoverQuery(title).forms.some(f => keys.has(key(f.song)))).length; }
function matchStats(list, artist, dict) { let n = 0; for (const title of list) if (api.pickCoverMatch(title, artist, dict)) n++; return n; }
const aStats = parseStats(avrilTitles), tStats = parseStats(taylorTitles);
const aCov = coverage(avrilTitles, [...Object.keys(x.searches), ...Object.values(x.albums).flatMap(a => (a.tracks || []).map(t => t.title))]);
const tBase = t.tracks.map(tr => tr.title);
const tCov = coverage(taylorTitles, tBase);
console.log(JSON.stringify({ Avril: { total: avrilTitles.length, preParse: aStats, coveredTitles: aCov, reliableMatches: matchStats(avrilTitles, x.artist, avrilDict) }, Taylor: { total: taylorTitles.length, preParse: tStats, coveredTitles: tCov, reliableMatches: matchStats(taylorTitles, t.artist, taylorDict), sampleExpected: t.baseExpected } }, null, 2));
let failed = 0;
for (const [label, id] of Object.entries(t.baseExpected)) {
  const title = label.replace(/^\d+\.\s*/, '');
  const got = api.pickCoverMatch(title, t.artist, taylorDict);
  const ok = got && Number(got.songId) === Number(id);
  console.log((ok ? 'PASS ' : 'FAIL ') + label + ' got=' + (got && got.songId));
  if (!ok) failed++;
}
const ex = api.pickCoverMatch('exile', t.artist, taylorDict);
const exIds = ex ? (ex.artists || []).map(a => Number(a.id)).sort().join(',') : '';
console.log((ex && exIds === '29337,44266' ? 'PASS ' : 'FAIL ') + 'exile-artists ' + exIds);
if (!ex || exIds !== '29337,44266') failed++;
const baseOnly = taylorDict.filter(row => Object.values(t.baseExpected).includes(Number(row.songId)));
for (const [label, query, dict, expected] of [
  ['TV-explicit-Long-Live', "Long Live (Taylor's Version)", taylorDict, 2059790562],
  ['TV-explicit-Love-Story-smart-apostrophe', 'Love Story (Taylor’s Version)', taylorDict, 1819857342],
  ['live-explicit-Long-Live', 'Long Live (Live/2011)', taylorDict, 19292833],
  ['TV-not-original-only', "Long Live (Taylor's Version)", baseOnly, null],
  ['live-not-original-only', 'Long Live (Live/2011)', baseOnly, null],
  ['acoustic-not-original-only', 'Anti-Hero (Acoustic Version)', baseOnly, null],
  ['explicit-wrong-artist-not-default-context', 'Adele - Love Story', taylorDict, null]
]) {
  const got = api.pickCoverMatch(query, t.artist, dict);
  const ok = expected === null ? !got : got && Number(got.songId) === expected;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + ' got=' + (got && got.songId)); if (!ok) failed++;
}
// Controlled identity counterexamples, not official sample data or coverage.
const question = { songId: 1, title: 'Echo?', artists: [t.artist], albumId: 100, album: 'First album', albumType: '专辑', albumSize: 12, published: 1000, pic: '/a' };
const bang = { ...question, songId: 2, title: 'Echo!', albumId: 101, album: 'Second album', published: 2000, pic: '/b' };
const dotless = { ...question, songId: 3, title: 'Dot' };
const dotted = { ...bang, songId: 4, title: 'Dot.' };
for (const [label, query, dict, expected] of [
  ['punct-explicit-bang-is-not-question', 'Echo!', [question, bang], 2],
  ['punct-no-mark-does-not-invent-mark', 'Echo', [question, bang], null],
  ['punct-explicit-mark-no-weakening', 'Echo!', [question], null],
  ['terminal-period-exact-before-equivalent', 'Dot.', [dotless, dotted], 4],
  ['terminal-period-absent-exact-before-equivalent', 'Dot', [dotless, dotted], 3]
]) {
  const got = api.pickCoverMatch(query, t.artist, dict); const ok = expected === null ? !got : got && Number(got.songId) === expected;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + ' got=' + (got && got.songId)); if (!ok) failed++;
}
const honestCoverage = tCov === 5 && aCov >= matchStats(avrilTitles, x.artist, avrilDict);
console.log((honestCoverage ? 'PASS ' : 'FAIL ') + 'coverage-counts-all-production-forms-and-real-candidate-titles');
if (!honestCoverage) failed++;
if (failed) process.exitCode = 1;
console.log('CATALOG_SAMPLE_FAILURES ' + failed);

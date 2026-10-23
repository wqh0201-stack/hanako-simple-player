#!/usr/bin/env node
/* 标题比较的最小离线例：Safe and/&、来源括号、版本、Candy、未知括号、精确优先。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(repo, 'ui/app.js'), 'utf8');
const a = src.indexOf('  function coverKey(s)'), b = src.indexOf('  function coverTargets(');
const resolveSrc = src.slice(src.indexOf('  async function coverResolve('), src.indexOf('  function guessCoverArtist('));
const f = new Function(src.slice(a, b) + '\n' + resolveSrc + '\nreturn { pickCoverMatch, coverTitleMatchRank, coverTitleLooseKey, coverResolve };')();
const taylor = { id: 44266, name: 'Taylor Swift', aliases: [] };
const civil = { id: 103399, name: 'The Civil Wars', aliases: [] };
const pic = 'https://p1.music.126.net/safe.jpg';
const base = { songId: 23432684, title: 'Safe & Sound (from The Hunger Games Soundtrack)', artists: [taylor, civil], albumId: 2133992, album: 'The Hunger Games', albumType: '专辑', albumSize: 12, pic };
const tv = { ...base, songId: 2031002706, title: 'Safe & Sound (Taylor\'s Version)', albumId: 999, album: 'Red (Taylor\'s Version)' };
let pass = 0, total = 0;
function check(name, ok, detail) { total++; if (ok) pass++; else { console.error('FAIL ' + name + (detail ? ' ' + detail : '')); process.exitCode = 1; } }
check('safe-and-&-matches-cache', f.pickCoverMatch('Safe And Sound', [taylor, civil], [base, tv])?.songId === 23432684);
check('original-not-tv', f.pickCoverMatch('Safe And Sound', [taylor, civil], [tv]) === null);
check('candy-not-replaced', f.coverTitleLooseKey('Candy') === 'candy');
check('unknown-parentheses-not-merged', f.coverTitleMatchRank('Song', { title: 'Song (Acoustic)' }) < 0);
check('bang-question-not-merged', f.coverTitleMatchRank('Echo!', { title: 'Echo?' }) < 0);
const exact = { ...base, songId: 2, title: 'Safe & Sound', album: 'Exact' };
check('exact-before-derived', f.pickCoverMatch('Safe & Sound', [taylor, civil], [base, exact])?.songId === 2);
const dotA = { ...base, songId: 3, title: 'Dot.', album: 'Dot A' };
const dotB = { ...base, songId: 4, title: 'Dot', album: 'Dot B' };
check('dot-literal-exact-priority', f.pickCoverMatch('Dot.', taylor, [dotB, dotA])?.songId === 3 && f.pickCoverMatch('Dot', taylor, [dotA, dotB])?.songId === 4);
const aliasA = { ...base, songId: 5, title: 'Song A', album: 'Shared', aliases: ['Shared Alias'] };
const aliasB = { ...base, songId: 6, title: 'Song B', album: 'Shared', aliases: ['Shared Alias'] };
check('shared-alias-ambiguity', f.pickCoverMatch('Shared Alias', taylor, [aliasA, aliasB]) === null);
const exactSingle = { ...base, songId: 7, title: 'Safe & Sound', albumId: 7, album: 'Exact Single', albumType: 'Single', albumSize: 1 };
const weak = { ...base, songId: 8, albumId: 8, album: 'Weak Album' };
let weakRead = false;
const lookup = async query => {
  if (query.kind === 'artist') return { artist: taylor };
  if (query.kind === 'albums') return { albums: [{ id: 7, name: 'Exact Single', type: 'Single', size: 1 }, { id: 8, name: 'Weak Album', type: '专辑', size: 12 }] };
  if (query.kind === 'search') return { tracks: [weak, exactSingle] };
  if (query.kind === 'album' && Number(query.id) === 7) return { tracks: [exactSingle] };
  if (query.kind === 'album' && Number(query.id) === 8) { weakRead = true; throw new Error('weak album should not be read'); }
  throw new Error('unexpected ' + JSON.stringify(query));
};
const strong = await f.coverResolve('Safe & Sound', 'Taylor Swift', lookup);
check('strong-before-album-read', strong.match?.songId === 7 && !weakRead);
console.log('TITLE_NORMALIZATION ' + pass + '/' + total);

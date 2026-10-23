#!/usr/bin/env node
/* 封面纯函数回归：直接抽取 ui/app.js 的生产文本。
 * 覆盖 R1/R2/R3，以及 2026-10-20 Avril 真实公开元数据夹具（5 首）。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(repo, 'ui/app.js'), 'utf8');
function slice(start, end) {
  const a = src.indexOf(start), b = src.indexOf(end);
  if (a < 0 || b < 0 || b <= a) throw new Error('无法定位生产代码片段：' + start);
  return src.slice(a, b);
}
const pure = slice('  function coverKey(s)', '  function coverTargets(');
const resolve = slice('  async function coverResolve(', '  function guessCoverArtist(');
const { cleanCoverQuery, pickCoverMatch, coverResolve } = new Function(
  pure + '\n' + resolve + '\nreturn { cleanCoverQuery, pickCoverMatch, coverResolve };')();

const artist = { id: 6452, name: '周杰伦' };
const pic = 'https://p1.music.126.net/fixture.jpg';
const original = { songId: 1, title: '稻香', artists: [artist], albumId: 1, album: '魔杰座', albumType: '专辑', albumSize: 10, subType: '录音室版', published: 2008, pic };
const live = { songId: 3, title: '稻香', artists: [artist], albumId: 3, album: '超时代演唱会', albumType: '专辑', albumSize: 12, subType: '现场版', published: 2010, pic };
const cover = { songId: 4, title: '稻香', artists: [artist], albumId: 4, album: '翻唱合辑', albumType: '合辑', albumSize: 12, subType: '翻唱版', published: 2012, pic };
const originalOnly = [original], allVersions = [original, live, cover];
let passed = 0, total = 0;
function check(name, ok, detail) {
  total++;
  if (ok) { passed++; console.log('PASS ' + name); }
  else { console.log('FAIL ' + name + (detail ? ' ' + detail : '')); process.exitCode = 1; }
}

/* R1：装饰与版本混在同一标签里，不能整段删掉。 */
for (const title of ['周杰伦-稻香【Live高清】', '周杰伦-稻香【现场高清】', '周杰伦-稻香【翻唱无损】']) {
  const cleaned = cleanCoverQuery(title);
  check('R1-mixed-tag-negative ' + title, pickCoverMatch(title, artist, originalOnly) === null,
    JSON.stringify({ song: cleaned.song, version: cleaned.version }));
}
check('R1-live-positive', pickCoverMatch('周杰伦-稻香【Live高清】', artist, allVersions)?.songId === 3);
check('R1-scene-positive', pickCoverMatch('周杰伦-稻香【现场高清】', artist, allVersions)?.songId === 3);
check('R1-cover-positive', pickCoverMatch('周杰伦-稻香【翻唱无损】', artist, allVersions)?.songId === 4);
check('R1-mixed-tag-keeps-version', cleanCoverQuery('周杰伦-稻香【Live高清】').version === 'live');
check('R1-unknown-tag-preserved', /特别版/.test(cleanCoverQuery('周杰伦-稻香【特别版】').song));

/* R3：只去明确质量/画质括号；真实括号和版本不能丢。 */
for (const title of ['周杰伦 - 稻香（无损音质）', '稻香（HQ）', '周杰伦 - 稻香【无损音质】', '周杰伦-稻香[1080P]']) {
  check('R3-quality-positive ' + title, pickCoverMatch(title, artist, originalOnly)?.songId === 1,
    JSON.stringify(cleanCoverQuery(title)));
}
check('R3-live-negative', pickCoverMatch('周杰伦 - 稻香 (Live)', artist, originalOnly) === null);
const parenTitle = '周杰伦 - 七里香（电影《不能说的秘密》插曲）';
const parenTrack = { songId: 9, title: '七里香（电影《不能说的秘密》插曲）', artists: [artist], albumId: 9, album: '七里香', albumType: '专辑', albumSize: 10, subType: '录音室版', pic };
check('R3-real-parentheses-preserved', pickCoverMatch(parenTitle, artist, [parenTrack])?.songId === 9);

/* 真正的同级冲突：两张不同正式专辑、同发行日，不能靠 albumId 硬挑。 */
const tieA = { ...original, songId: 11, albumId: 11, album: '专辑甲', published: 1000 };
const tieB = { ...original, songId: 12, albumId: 12, album: '专辑乙', published: 1000 };
check('true-same-level-ambiguity-preserved', pickCoverMatch('稻香', artist, [tieA, tieB]) === null);

/* R2：候选专辑读取失败不能把潜在多录音洗成唯一。 */
const otherRecording = { ...original, songId: 2, albumId: 2, album: '另一录音' };
function makeLookup(second) {
  return async (query) => {
    if (query.kind === 'artist') {
      if (query.name === '周杰伦') return { artist: { ...artist, aliases: [] } };
      const e = new Error('not found'); e.status = 404; throw e;
    }
    if (query.kind === 'albums') return { albums: [
      { id: 1, name: '魔杰座', type: '专辑', subType: '录音室版', size: 10, published: 2008 },
      { id: 2, name: '另一录音', type: '专辑', subType: '录音室版', size: 10, published: 2010 }] };
    if (query.kind === 'search') return { tracks: [original, second] };
    if (query.kind === 'album' && Number(query.id) === 1) return { tracks: [original] };
    if (query.kind === 'album' && Number(query.id) === 2) {
      const e = new Error('other candidate album timed out'); e.status = 503; throw e;
    }
    throw new Error('unexpected query ' + JSON.stringify(query));
  };
}
const blocked = await coverResolve('周杰伦-稻香', '', makeLookup(otherRecording));
check('R2-different-recording-unread-blocks', !blocked.match && blocked.reason === 'error' && /timed out/.test(blocked.error?.message || ''),
  JSON.stringify({ reason: blocked.reason, error: blocked.error?.message }));
check('R2-error-keeps-stage', blocked.error?.stage === 'album', JSON.stringify(blocked.error?.stage));
const allowed = await coverResolve('周杰伦-稻香', '', makeLookup({ ...original, albumId: 2, album: '同一录音的另一专辑' }));
check('R2-same-recording-unread-allows', allowed.match?.songId === 1,
  JSON.stringify({ match: allowed.match?.songId, reason: allowed.reason }));

/* 真实公开元数据夹具：至少 5 首 Avril 规范曲名。夹具只含公开曲库字段。 */
const fx = JSON.parse(fs.readFileSync(path.join(repo, 'tools/fixtures/cover-avril-real-2026-10-20.json'), 'utf8'));
function fixtureLookup({ wrongArtist = false } = {}) {
  return async (query) => {
    if (query.kind === 'artist') {
      if (!wrongArtist && query.name === 'Avril Lavigne') return { artist: fx.artist };
      const e = new Error('not found'); e.status = 404; throw e;
    }
    if (query.kind === 'albums') return { albums: fx.albumList };
    if (query.kind === 'search') {
      const key = Object.keys(fx.searches).find(k => k.toLowerCase() === String(query.title).toLowerCase());
      return { tracks: key ? fx.searches[key] : [] };
    }
    if (query.kind === 'album') {
      const album = fx.albums[String(query.id)];
      if (!album) { const e = new Error('album fixture missing ' + query.id); e.status = 404; throw e; }
      return { tracks: album.tracks };
    }
    throw new Error('unexpected query ' + JSON.stringify(query));
  };
}
const expected = {
  'Innocence': { album: 'The Best Damn Thing', albumId: 34734318 },
  'Rock N Roll': { album: 'Avril Lavigne (Expanded Edition)', albumId: 2662056 },
  'Head Above Water': { album: 'Head Above Water', albumId: 75552216 },
  'Complicated': { album: 'Let Go', albumId: 1515088 },
  'Sk8er Boi': { album: 'Let Go', albumId: 1515088 }
};
for (const [title, want] of Object.entries(expected)) {
  const out = await coverResolve(title, 'Avril Lavigne', fixtureLookup());
  check('real-avril-' + title, !!out.match && out.match.albumId === want.albumId && out.match.album === want.album && out.reason !== 'error',
    JSON.stringify({ reason: out.reason, match: out.match && { album: out.match.album, albumId: out.match.albumId, songId: out.match.songId }, error: out.error && out.error.message }));
}
const reversed = await coverResolve('Complicated - Avril Lavigne', 'Avril Lavigne', fixtureLookup());
check('real-reversed-title-uses-confirmed-default-artist', reversed.match?.albumId === 1515088, JSON.stringify({ reason: reversed.reason, match: reversed.match && reversed.match.albumId }));
const forward = await coverResolve('Avril Lavigne - Complicated', 'Avril Lavigne', fixtureLookup());
check('real-forward-title-still-matches', forward.match?.albumId === 1515088, JSON.stringify({ reason: forward.reason, match: forward.match && forward.match.albumId }));

/* 分页 more=true 时，未出现在第一页的专辑不能被否定归属；否则会误降老专辑。 */
const pagedLookup = async (query) => {
  if (query.kind === 'artist') return { artist: { id: 1, name: 'A', aliases: [] } };
  if (query.kind === 'albums') return { albums: [{ id: 98, name: '精选集', type: '精选集', subType: '录音室版', size: 10, published: 2020 }], more: true };
  if (query.kind === 'search') return { tracks: [
    { songId: 99, title: 'Song', artists: [{ id: 1, name: 'A' }], albumId: 99, album: 'Old Album', albumSize: 10, published: 1990 },
    { songId: 98, title: 'Song', artists: [{ id: 1, name: 'A' }], albumId: 98, album: '精选集', albumSize: 10, published: 2020 }] };
  if (query.kind === 'album' && Number(query.id) === 99) return { tracks: [{ songId: 99, title: 'Song', artists: [{ id: 1, name: 'A' }], albumId: 99, album: 'Old Album', subType: '录音室版', published: 1990, albumSize: 10, pic }] };
  if (query.kind === 'album' && Number(query.id) === 98) return { tracks: [{ songId: 98, title: 'Song', artists: [{ id: 1, name: 'A' }], albumId: 98, album: '精选集', albumType: '精选集', subType: '录音室版', published: 2020, albumSize: 10, pic }] };
  throw new Error('unexpected query ' + JSON.stringify(query));
};
const paged = await coverResolve('Song', 'A', pagedLookup);
check('paged-album-list-does-not-demote-unseen-album', paged.match?.albumId === 99, JSON.stringify({ reason: paged.reason, match: paged.match && paged.match.albumId }));

const wrong = await coverResolve('Complicated', 'Evanescence', fixtureLookup({ wrongArtist: true }));
check('real-wrong-artist-does-not-match', !wrong.match, JSON.stringify(wrong));
const head = await coverResolve('Head Above Water', 'Avril Lavigne', fixtureLookup());
check('real-duplicate-catalog-entry-not-ambiguity', head.match?.album === 'Head Above Water' && [1310906383, 3342121531].includes(head.match.songId),
  JSON.stringify(head.match && { songId: head.match.songId, albumId: head.match.albumId }));
const avril = { id: 46490, name: 'Avril Lavigne' };
const bestAlbum = { songId: 50, title: 'Innocence', artists: [avril], albumId: 50, album: 'The Best Damn Thing', albumType: '专辑', albumSize: 17, subType: '录音室版', pic };
const hitsAlbum = { ...bestAlbum, songId: 51, albumId: 51, album: 'Greatest Hits', albumType: '精选集', albumSize: 20 };
check('real-best-album-not-compilation', pickCoverMatch('Innocence', avril, [hitsAlbum, bestAlbum])?.album === 'The Best Damn Thing');

console.log(`${passed}/${total} cover match checks passed`);

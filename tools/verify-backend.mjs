#!/usr/bin/env node
/* ============================================================
   tools/verify-backend.mjs — 后端列表归属的单元验收（开发用）
   直接调用 registerRoutes 注册的处理函数，验证：
     · 去重键纳入 list：同一首歌进两个列表不被并成一条
     · 同一列表内仍按 id 去重
     · 老数据（无 id）回退到完整 url，同样按 list 分开
     · DELETE /api/track 带 list 只删该列表里的那一份
   用法：node tools/verify-backend.mjs
   ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerRoutes } from '../lib/register-routes.js';
import { parseBiliInput } from '../lib/bilibili.js';
import { makePlayTool } from './play.js';
import { makeListMusicTool } from './list-music.js';
import { makeCreateListTool } from './create-list.js';
import { makeSearchMusicTool } from './search-music.js';
import { createList, reserveList } from '../lib/library.js';
import { cleanMusicMetadata, singerPrefixes, pickMetadataMatch } from '../lib/music-metadata.js';
import { createMoodCommand, MOOD_PROMPT } from '../lib/mood-command.js';
import { apply as applyPlayer } from '../index.js';
import { createAudioOwner } from '../lib/audio-owner.js';

const routes = [];
const app = {
  get: (p, h) => routes.push(['GET', p, h]),
  post: (p, h) => routes.push(['POST', p, h]),
  put: (p, h) => routes.push(['PUT', p, h]),
  delete: (p, h) => routes.push(['DELETE', p, h])
};

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hap-be-'));

/* 网络探针：playlist 路由会先问 Meting 节点拿曲目、再（仅 netease）问网易云官方
 * 拿歌单真名。这里把 ctx.network.fetch 换成可控的假实现，按 URL 分流，并记录调用。 */
let netCalls = [];
const netFetch = async (url) => {
  netCalls.push(url);
  if (url.includes('music.163.com/api/v6/playlist/detail')) {
    return {
      ok: true,
      json: async () => ({
        code: 200,
        playlist: { name: 'Can_0201喜欢的音乐', creator: { nickname: 'Can_0201' }, coverImgUrl: 'http://c/x.jpg', trackCount: 905 }
      })
    };
  }
  // 网易云官方搜索（分页）：回 cloudsearch 形状，字段名与 Meting 节点完全不同
  if (url.includes('music.163.com/api/cloudsearch/pc')) {
    return {
      ok: true,
      json: async () => ({
        code: 200,
        result: {
          songCount: 274,
          songs: [
            { id: 509781655, name: '想你就写信 (Live)', ar: [{ name: '周杰伦' }, { name: '李硕' }], al: { picUrl: 'http://p1.music.126.net/a.jpg' }, dt: 238698 },
            { id: 210049, name: '布拉格广场', ar: [{ name: '蔡依林' }, { name: '周杰伦' }], al: { picUrl: 'http://p1.music.126.net/b.jpg' }, dt: 245000 },
          ],
        },
      })
    };
  }
  // B站搜索：回 data.result 形状（numResults 为近似上限）
  if (url.includes('api.bilibili.com') && url.includes('/search/type')) {
    return {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          numResults: 1000,
          numPages: 34,
          page: 1,
          result: [
            { bvid: 'BV1FPjy6TEiE', title: '<em class="keyword">周杰伦</em> 测试', author: 'UP主甲', pic: '//i2.hdslb.com/a.jpg', duration: '4:30' },
            { bvid: 'BV16XpM6EEtF', title: '第二首', author: 'UP主乙', pic: '//i2.hdslb.com/b.jpg', duration: '3:12' },
          ],
        },
      })
    };
  }
  // B站分P列表：回 data[] 形状（每 P 一个 {cid,page,part,duration}）
  if (url.includes('api.bilibili.com') && url.includes('/player/pagelist')) {
    return {
      ok: true,
      json: async () => ({
        code: 0,
        data: [
          { cid: 111, page: 1, part: '01 第一首', duration: 240 },
          { cid: 222, page: 2, part: '02 第二首', duration: 260 },
          { cid: 333, page: 3, part: '03 第三首', duration: 210 },
        ],
      })
    };
  }
  // B站 view（视频元信息）：bili-resolve 走这条。
  //   aid 或 BV1CAxaeHEeH → 多P（149 集，验证点名分P与合成 id）；其余 → 单P。
  if (url.includes('api.bilibili.com') && url.includes('/web-interface/view')) {
    if (/[?&]aid=\d+/.test(url) || url.includes('BV1CAxaeHEeH')) {
      const pages = Array.from({ length: 149 }, (_, i) => ({ cid: 26000000000 + i, page: i + 1, part: `第 ${i + 1} 讲`, duration: 600 + i }));
      return {
        ok: true,
        json: async () => ({ code: 0, data: { bvid: 'BV1CAxaeHEeH', aid: 233268574, videos: 149, cid: pages[0].cid,
          title: '《高等数学》全程教学视频 2.0版【宋浩老师】', owner: { name: '宋浩老师官方' }, pic: '//i2.hdslb.com/bfs/archive/abc.jpg',
          duration: 2076, pages } })
      };
    }
    return {
      ok: true,
      json: async () => ({ code: 0, data: { bvid: 'BV118411B7XU', aid: 233268574, videos: 1, cid: 1262792384,
        title: '在百万豪装录音棚大声听 杨丞琳《雨爱》【Hi-res】', owner: { name: 'JLRS-LeoFM' },
        pic: '//i1.hdslb.com/bfs/archive/rain.jpg', duration: 263,
        pages: [{ cid: 1262792384, page: 1, part: '在百万豪装录音棚大声听 杨丞琳《雨爱》【Hi-res】', duration: 263 }] } })
    };
  }
  // 其余（Meting 节点）：回一个最小可用的曲目数组（url 带 id，好让 metingStableId 能取到）
  return { ok: true, json: async () => ([{ id: '1', title: 't', author: 'a', url: 'http://node/1?server=tencent&type=url&id=1', pic: '', lrc: '' }]) };
};

const storagePath = path.join(dataDir, 'global.json');
const storage = {
  async get(key, fallback) { return fs.existsSync(storagePath) ? JSON.parse(fs.readFileSync(storagePath, 'utf8'))[key] ?? fallback : fallback; },
  async set(key, value) {
    const all = fs.existsSync(storagePath) ? JSON.parse(fs.readFileSync(storagePath, 'utf8')) : {};
    all[key] = value;
    fs.writeFileSync(storagePath, JSON.stringify(all));
  }
};
const ctx = { dataDir, logger: { warn() {}, info() {}, error() {} }, resources: {}, storage: { global: storage }, tools: {}, network: { fetch: netFetch } };
registerRoutes(app, { ctx, state: {} });

const handler = (method, p) => {
  const hit = routes.find((r) => r[0] === method && r[1] === p);
  if (!hit) throw new Error(`route not found: ${method} ${p}`);
  return hit[2];
};
const POST_PLAYLIST = handler('POST', '/widget/api/playlist');
const GET_PLAYLIST = handler('GET', '/widget/api/music/playlist');
const GET_SEARCH = handler('GET', '/widget/api/music/search');
const GET_BILI_PARTS = handler('GET', '/widget/api/music/bili-parts');
const GET_BILI_RESOLVE = handler('GET', '/widget/api/music/bili-resolve');
const DELETE_TRACK = handler('DELETE', '/api/track');
const GET_PLAYBACK = handler('GET', '/api/playback-state');
const POST_PLAYBACK = handler('POST', '/api/playback-state');

function fakeC({ json, query }) {
  return {
    req: {
      json: async () => json,
      query: (k) => (query && k in query ? query[k] : undefined),
      param: () => undefined,
      header: () => undefined
    },
    json: (o, s) => ({ status: s || 200, body: o }),
    text: (t, s) => ({ status: s || 200, text: t }),
    redirect: (u) => ({ status: 302, url: u })
  };
}
const playlistPath = path.join(dataDir, 'playlist.json');
const readDisk = () => JSON.parse(fs.readFileSync(playlistPath, 'utf-8'));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail === undefined ? '' : detail) });
}

/* 1) 同一首歌进两个列表：不能并 */
await POST_PLAYLIST(fakeC({ json: { tracks: [
  { id: 'netease:1', name: 'a', list: 'imp:1' },
  { id: 'netease:1', name: 'a', list: 'imp:2' }
] } }));
let disk = readDisk();
check('cross-list-kept', disk.length === 2, JSON.stringify(disk.map((t) => t.list)));

/* 2) 同一列表内同 id：仍要去重 */
await POST_PLAYLIST(fakeC({ json: { tracks: [
  { id: 'netease:1', name: 'a', list: 'imp:1' },
  { id: 'netease:1', name: 'b', list: 'imp:1' }
] } }));
disk = readDisk();
check('same-list-deduped', disk.length === 1, JSON.stringify(disk));

/* 3) 老数据（无 id）回退到完整 url，同样按 list 分开 */
await POST_PLAYLIST(fakeC({ json: { tracks: [
  { url: 'u1', name: 'x' },
  { url: 'u1', name: 'x', list: 'imp:2' }
] } }));
disk = readDisk();
check('legacy-url-by-list', disk.length === 2, JSON.stringify(disk.map((t) => t.list || '')));

/* 4) DELETE 带 list：只删该列表里的那一份 */
await POST_PLAYLIST(fakeC({ json: { tracks: [
  { id: 'netease:9', name: 's', list: 'imp:1' },
  { id: 'netease:9', name: 's', list: 'imp:2' }
] } }));
let res = await DELETE_TRACK(fakeC({ query: { id: 'netease:9', list: 'imp:1' } }));
disk = readDisk();
check('delete-with-list', res.body.ok === true && disk.length === 1 && disk[0].list === 'imp:2', JSON.stringify(disk));

/* 5) DELETE 不带 list：保持旧行为（按 id 全删） */
res = await DELETE_TRACK(fakeC({ query: { id: 'netease:9' } }));
disk = readDisk();
check('delete-without-list-legacy', res.body.ok === true && disk.length === 0, JSON.stringify(disk));

/* 6) 播放状态：POST 落盘 → GET 取回（跨文档续播的持久层） */
const snap = { currentId: 'imp:1|netease:1', activeList: 'imp:1', progress: 12.5, volume: 0.8, muted: false, mode: 'list', lyricsVisible: true, playing: true };
await POST_PLAYBACK(fakeC({ json: snap }));
const got = await GET_PLAYBACK(fakeC({}));
check('playback-roundtrip', got.body.ok === true && got.body.state && got.body.state.playing === true && got.body.state.progress === 12.5, JSON.stringify(got.body));

/* 7) 非法播放状态被拒 */
const bad = await POST_PLAYBACK(fakeC({ json: null }));
check('playback-reject-invalid', bad.status === 400, JSON.stringify(bad));

/* 8) 导入歌单：netease 时附带官方真名（meta.name） */
netCalls = [];
let plRes = await GET_PLAYLIST(fakeC({ query: { id: '12881021', server: 'netease' } }));
check('playlist-meta-netease',
  plRes.body.ok === true && plRes.body.tracks.length === 1 &&
  plRes.body.meta && plRes.body.meta.name === 'Can_0201喜欢的音乐' && plRes.body.meta.creator === 'Can_0201',
  JSON.stringify(plRes.body));
check('playlist-meta-netease-fetched',
  netCalls.some((u) => u.includes('music.163.com/api/v6/playlist/detail?id=12881021')),
  JSON.stringify(netCalls));

/* 9) 非 netease：不取真名（meta 缺省），也不打网易云 */
netCalls = [];
plRes = await GET_PLAYLIST(fakeC({ query: { id: '12881021', server: 'tencent' } }));
check('playlist-meta-skip-non-netease',
  plRes.body.ok === true && plRes.body.meta === undefined &&
  !netCalls.some((u) => u.includes('music.163.com')),
  JSON.stringify({ body: plRes.body, netCalls }));

/* 10) 在线搜索·网易云：改走官方分页接口，但**对外形状必须与走节点时一致**
 *     （results[].{id,title,author,pic,url,lrc} + total）。这是与下游（歌词跨源兜底）的硬约定。 */
netCalls = [];
let sRes = await GET_SEARCH(fakeC({ query: { keyword: '周杰伦', server: 'netease', offset: '0', limit: '30' } }));
check('search-netease-shape',
  sRes.body.ok === true && Array.isArray(sRes.body.results) && sRes.body.results.length === 2 &&
  sRes.body.results[0].title === '想你就写信 (Live)' &&
  sRes.body.results[0].author === '周杰伦 / 李硕' &&
  sRes.body.results[0].pic === 'http://p1.music.126.net/a.jpg' &&
  typeof sRes.body.results[0].url === 'string' && sRes.body.results[0].url.indexOf('music/go/') >= 0 &&
  sRes.body.results[0].lrc === '' &&
  sRes.body.results[0].id === 'netease:509781655',
  JSON.stringify(sRes.body));
check('search-netease-official-endpoint',
  netCalls.some((u) => u.includes('music.163.com/api/cloudsearch/pc')) &&
  !netCalls.some((u) => u.includes('meting')),   // 网易云不再打 Meting 节点
  JSON.stringify(netCalls));
check('search-netease-total-precise', sRes.body.total === 274, String(sRes.body.total));

/* 11) 分页参数透传：offset 换成官方 offset（缺省即第一页） */
netCalls = [];
sRes = await GET_SEARCH(fakeC({ query: { keyword: '周杰伦', server: 'netease', offset: '30', limit: '30' } }));
check('search-netease-offset-passthrough',
  netCalls.some((u) => /[?&]offset=30(&|$)/.test(u)),
  JSON.stringify(netCalls));

/* 12) B站：offset/limit 换算成 page/page_size；total = numResults（近似上限） */
netCalls = [];
sRes = await GET_SEARCH(fakeC({ query: { keyword: '周杰伦', server: 'bilibili', offset: '0', limit: '30' } }));
check('search-bili-shape',
  sRes.body.ok === true && sRes.body.results.length === 2 &&
  sRes.body.results[0].id === 'bilibili:BV1FPjy6TEiE' &&
  sRes.body.results[0].title === '周杰伦 测试' &&   // 去了 <em> 标签
  sRes.body.results[0].url.indexOf('music/go/BV1FPjy6TEiE') >= 0,
  JSON.stringify(sRes.body));
check('search-bili-first-page',
  netCalls.some((u) => /[?&]page=1(&|$)/.test(u)) && netCalls.some((u) => /[?&]page_size=30(&|$)/.test(u)),
  JSON.stringify(netCalls));
check('search-bili-total-approx', sRes.body.total === 1000, String(sRes.body.total));

/* 13) B站第二页：offset=30&limit=30 → page=2 */
netCalls = [];
sRes = await GET_SEARCH(fakeC({ query: { keyword: '周杰伦', server: 'bilibili', offset: '30', limit: '30' } }));
check('search-bili-page-from-offset',
  netCalls.some((u) => /[?&]page=2(&|$)/.test(u)),
  JSON.stringify(netCalls));

/* 14) 非网易云/非B站（如 tencent）：仍走 Meting 节点，形状不变 */
netCalls = [];
sRes = await GET_SEARCH(fakeC({ query: { keyword: '周杰伦', server: 'tencent', limit: '30' } }));
check('search-meting-untouched',
  sRes.body.ok === true && Array.isArray(sRes.body.results) && sRes.body.results.length === 1 &&
  sRes.body.results[0].id === 'tencent:1' &&
  netCalls.some((u) => u.includes('server=tencent')),
  JSON.stringify({ body: sRes.body, netCalls }));

/* 15) B站分P列表：每 P 带合成 id（`bilibili:<bvid>_<cid>`）与 go 跳板 url，
 *     形状与搜索结果的曲目一致（前端可直接当普通曲目播放/收藏）。
 *     同一支视频的 P1/P2 必须是**不同的 id**（否则落库会去重成一条）。 */
netCalls = [];
let partsRes = await GET_BILI_PARTS(fakeC({ query: { bvid: 'BV1CAxaeHEeH' } }));
check('bili-parts-shape',
  partsRes.body.ok === true && partsRes.body.results.length === 3 && partsRes.body.videos === 3 &&
  partsRes.body.results[0].id === 'bilibili:BV1CAxaeHEeH_111' &&
  partsRes.body.results[0].title === '01 第一首' &&
  partsRes.body.results[0].dur === 240 &&
  partsRes.body.results[0].url.indexOf('music/go/BV1CAxaeHEeH_111') >= 0 &&
  partsRes.body.results[1].id !== partsRes.body.results[0].id,
  JSON.stringify(partsRes.body));
check('bili-parts-endpoint',
  netCalls.some((u) => u.includes('api.bilibili.com/x/player/pagelist') && u.includes('bvid=BV1CAxaeHEeH')),
  JSON.stringify(netCalls));
/* 16) 非法 bvid 被拒（防把任意字符串透传给 B站） */
let badParts = await GET_BILI_PARTS(fakeC({ query: { bvid: '../etc' } }));
check('bili-parts-reject-invalid', badParts.status === 400, JSON.stringify(badParts));

/* 17) 粘贴 B站链接 → 曲目（bili-resolve）。模拟罐头分享的那段原文：
 *     「【标题】 https://…video/BV…/?share_source=copy_web&vd_source=<40位hex>」。
 *     断言：抠出 BV、形状与搜索结果一条曲目一致、url 走 go 跳板、单 P 落裸 bvid。 */
netCalls = [];
const BILI_SHARE_TEXT = '【在百万豪装录音棚大声听 杨丞琳《雨爱》【Hi-res】】 https://www.bilibili.com/video/BV118411B7XU/?share_source=copy_web&vd_source=fe48fd0e530457bfa813705dfcc26a93';
let brRes = await GET_BILI_RESOLVE(fakeC({ query: { url: BILI_SHARE_TEXT } }));
check('bili-resolve-shape',
  brRes.body.ok === true && brRes.body.track &&
  brRes.body.track.id === 'bilibili:BV118411B7XU' &&
  brRes.body.track.title === '在百万豪装录音棚大声听 杨丞琳《雨爱》【Hi-res】' &&
  brRes.body.track.author === 'JLRS-LeoFM' &&
  brRes.body.track.pic === 'https://i1.hdslb.com/bfs/archive/rain.jpg' &&   // //→https、http→https
  brRes.body.track.dur === 263 &&
  brRes.body.track.url.indexOf('music/go/BV118411B7XU') >= 0 &&
  brRes.body.multi === false && brRes.body.parts === 1,
  JSON.stringify(brRes.body));
check('bili-resolve-share-text-endpoint',
  netCalls.some((u) => u.includes('/web-interface/view') && u.includes('bvid=BV118411B7XU')),
  JSON.stringify(netCalls));

/* 18) 裸 BV 号（不用完整链接）同样能认 */
brRes = await GET_BILI_RESOLVE(fakeC({ query: { url: 'BV118411B7XU' } }));
check('bili-resolve-bare-bv',
  brRes.body.ok === true && brRes.body.track && brRes.body.track.id === 'bilibili:BV118411B7XU',
  JSON.stringify(brRes.body));

/* 19) av 号（走 aid 查询）+ 多 P：默认拿 P1。
 *     裸 bvid ≡ P1，所以默认落裸 bvid（与搜索页那条同 id，不会生成重复副本）。 */
brRes = await GET_BILI_RESOLVE(fakeC({ query: { url: 'av233268574' } }));
check('bili-resolve-av',
  brRes.body.ok === true && brRes.body.track && brRes.body.track.id === 'bilibili:BV1CAxaeHEeH' &&
  brRes.body.multi === true && brRes.body.parts === 149,
  JSON.stringify({ id: brRes.body.track && brRes.body.track.id, multi: brRes.body.multi, parts: brRes.body.parts, netCalls }));

/* 20) 分P链接（?p=6）：标题取第 6 讲的 part，id 落 `bvid_cid`（否则 149 集会塔成 1 条） */
brRes = await GET_BILI_RESOLVE(fakeC({ query: { url: 'https://www.bilibili.com/video/BV1CAxaeHEeH?p=6' } }));
check('bili-resolve-multi-pick',
  brRes.body.ok === true && brRes.body.track &&
  brRes.body.track.id === 'bilibili:BV1CAxaeHEeH_26000000005' &&
  brRes.body.track.title === '第 6 讲' &&
  brRes.body.track.page === 6 && brRes.body.parts === 149,
  JSON.stringify(brRes.body.track));

/* 21) 认不出的文本：400 且提示可读（不把没有 BV 的串透传给 B站） */
netCalls = [];
let badResolve = await GET_BILI_RESOLVE(fakeC({ query: { url: '随便一段没有 BV 号的文字' } }));
check('bili-resolve-reject-unknown',
  badResolve.status === 400 && /BV/.test(badResolve.body.error) &&
  !netCalls.some((u) => u.includes('api.bilibili.com')),
  JSON.stringify({ res: badResolve, netCalls }));

/* 22) b23.tv 短链本轮不支持：给可行动提示，且**不发起网络请求**（b23.tv 没在白名单）。
 *     真实的 b23 短链是 base62 随机段，**不带 BV**，所以本地认不出。 */
netCalls = [];
let shortRes = await GET_BILI_RESOLVE(fakeC({ query: { url: 'https://b23.tv/2JdKxY9' } }));
check('bili-resolve-b23-explicit-hint',
  shortRes.status === 400 && /b23\.tv/.test(shortRes.body.error) &&
  !netCalls.some((u) => u.includes('api.bilibili.com')),
  JSON.stringify({ res: shortRes, netCalls }));

/* 23) parseBiliInput 纯函数边界（不联网）：完整链接 / 裸号 / 文案夹取 / p=N */
const pb = parseBiliInput;
check('parse-bili-input-boundaries',
  pb('https://www.bilibili.com/video/BV118411B7XU/?t=1').bvid === 'BV118411B7XU' &&
  pb('【标题】 BV118411B7XU 分享给你').bvid === 'BV118411B7XU' &&
  pb('av123456').aid === 123456 && pb('av123456').bvid === '' &&
  pb('https://www.bilibili.com/video/BV1CAxaeHEeH?p=3').page === 3 &&
  pb('BV118411B7XU') !== null && pb('') === null &&
  pb('这是一段普通文字') === null &&
  pb('aabbccddeeff1122334455667788') === null,   // 40 位 hex 不得被误当 BV
  JSON.stringify([pb('BV118411B7XU'), pb('av123456'), pb('普通文字')]));

/* 工具新增也置顶；重复调用保留原位置，不重排已有曲目。 */
const toolPlaylistPath = path.join(dataDir, 'playlist.json');
const toolSeed = [{ name: '旧甲', url: 'https://example.com/a.mp3' }, { name: '旧乙', url: 'https://example.com/b.mp3' }];
fs.writeFileSync(toolPlaylistPath, JSON.stringify(toolSeed));
const playTool = makePlayTool({ dataDir }, {});
await playTool.execute({ source: 'https://example.com/new.mp3', title: '新歌' });
let toolTracks = JSON.parse(fs.readFileSync(toolPlaylistPath, 'utf8'));
check('tool-new-track-prepends', toolTracks.map((t) => t.name).join(',') === '新歌,旧甲,旧乙', JSON.stringify(toolTracks));
await playTool.execute({ source: 'https://example.com/a.mp3', title: '旧甲更新' });
toolTracks = JSON.parse(fs.readFileSync(toolPlaylistPath, 'utf8'));
check('tool-existing-track-keeps-position', toolTracks.map((t) => t.name).join(',') === '新歌,旧甲更新,旧乙', JSON.stringify(toolTracks));

/* 元数据先验整份再写；前端与工具通过同一宿主键读回名字。 */
const fixedLists = [{ id: 'fav', name: '我的喜欢' }, { id: 'recent', name: '最近播放' }, { id: 'local', name: '本地' }];
const listSeed = [...fixedLists, { id: 'imp:4', name: '四号' }];
const PUT_LISTS = handler('PUT', '/api/lists');
const GET_LISTS = handler('GET', '/api/lists');
const putLists = (lists, baseLists) => PUT_LISTS(fakeC({ json: { lists, ...(baseLists ? { baseLists } : {}) } }));
const listsSaved = await putLists(listSeed);
check('lists-put-get-shared-key', listsSaved.status === 200 && JSON.stringify((await GET_LISTS(fakeC({}))).body.lists) === JSON.stringify(listSeed));
check('lists-renamed-name-on-disk', JSON.parse(fs.readFileSync(storagePath, 'utf8'))['player-lists'][3].name === '四号');
const priorLists = fs.readFileSync(storagePath, 'utf8');
for (const [label, bad] of [
  ['not-array', {}], ['empty-id', [...fixedLists, { id: '', name: '空' }]],
  ['missing-fixed', fixedLists.slice(1)], ['blank-name', [...fixedLists, { id: 'imp:5', name: ' ' }]],
  ['duplicate-id', [...fixedLists, fixedLists[0]]]
]) {
  const res = await putLists(bad);
  check('lists-reject-' + label + '-without-write', res.status === 400 && fs.readFileSync(storagePath, 'utf8') === priorLists);
}
await putLists([...listSeed, { id: 'imp:5', name: 'agent新建' }]);
const mergedLists = await putLists([...fixedLists, { id: 'imp:4', name: '手动改名' }], listSeed);
check('lists-stale-ui-save-preserves-agent-list', mergedLists.body.lists.some((x) => x.id === 'imp:5') && mergedLists.body.lists.find((x) => x.id === 'imp:4').name === '手动改名');

const source44 = '/api/apps/hanako-simple-player/routes/widget/api/music/go/44?server=netease';
const retained = [
  { id: 'netease:44', url: source44, name: '原曲', list: 'fav', author: '原歌手', pic: 'keep-cover', lyricOffset: 55 },
  { id: 'bilibili:BV118411B7XU', url: '/api/apps/hanako-simple-player/routes/widget/api/music/go/BV118411B7XU?server=bilibili', name: '孤单', list: 'imp:8' }
];
fs.writeFileSync(playlistPath, JSON.stringify(retained));
const originalBytes = fs.readFileSync(playlistPath, 'utf8');
const createTool = makeCreateListTool(ctx);
const unwrap = (r) => JSON.parse(r.content[0].text);
const fresh = unwrap(await createTool.execute({ name: '今日心情', tracks: [{ source: source44, name: '干净名字' }] }));
check('create-list-allocates-above-metadata-and-orphan-tracks', fresh.listId === 'imp:9' && fresh.created && !fresh.replaced && fresh.count === 1, JSON.stringify(fresh));
check('create-list-keeps-existing-id-url-and-unknown-fields', readDisk().find(x => x.list === fresh.listId).id === 'netease:44' && readDisk().find(x => x.list === fresh.listId).url === source44 && readDisk().find(x => x.list === fresh.listId).lyricOffset === 55);
check('create-list-other-lists-unchanged', JSON.stringify(readDisk().filter(x => x.list !== fresh.listId)) === JSON.stringify(retained));
const backups = () => fs.readdirSync(dataDir).filter(x => x.startsWith('playlist.json.bak-'));
check('create-list-backup-before-write', backups().length === 1 && fs.readFileSync(path.join(dataDir, backups()[0]), 'utf8') === originalBytes);
const replaced = unwrap(await createTool.execute({ name: '今日心情', tracks: [{ source: source44 }, { source: source44 }] }));
check('create-list-same-name-replaces-and-dedupes', replaced.listId === fresh.listId && !replaced.created && replaced.replaced && replaced.count === 1 && readDisk().filter(x => x.list === fresh.listId).length === 1);
check('create-list-same-name-publishes-content-revision', typeof (await storage.get('player-library-revision')) === 'string');
const empty = await createList(ctx, { name: '今日心情', tracks: [] });
check('create-list-empty-replacement-keeps-name', empty.replaced && empty.count === 0 && !readDisk().some(x => x.list === empty.listId) && (await storage.get('player-lists')).some(x => x.id === empty.listId));
const specialName = '/:*?"<>|'.repeat(100);
const special = await createList(ctx, { name: specialName, tracks: [] });
check('create-list-long-special-name-is-data-not-path', special.name === specialName && (await storage.get('player-lists')).some(x => x.name === specialName));
const beforeBad = fs.readFileSync(playlistPath, 'utf8'), backupCount = backups().length;
for (const [label, args] of [
  ['blank-name', { name: ' ', tracks: [] }], ['missing-source', { name: '今日心情', tracks: [{ source: source44 }, {}] }],
  ['bad-tracks', { name: '今日心情', tracks: null }], ['bad-duration', { name: '今日心情', tracks: [{ source: source44, dur: -1 }] }]
]) {
  const res = await createTool.execute(args);
  check('create-list-reject-' + label + '-without-write', res.isError && fs.readFileSync(playlistPath, 'utf8') === beforeBad && backups().length === backupCount);
}
const raced = await Promise.all([
  createList(ctx, { name: '并发甲', tracks: [] }), reserveList(ctx, { name: 'UI预留' }),
  createList(ctx, { name: '并发乙', tracks: [] }), createList(ctx, { name: '并发丙', tracks: [] }),
]);
const raceIds = raced.map(x => x.listId || x.id);
check('create-list-and-ui-reservation-share-one-number-sequence', new Set(raceIds).size === 4 && raceIds.join(',') === 'imp:11,imp:12,imp:13,imp:14', JSON.stringify(raceIds));
const sameRace = await Promise.all([createList(ctx, { name: '并发同名', tracks: [] }), createList(ctx, { name: '并发同名', tracks: [{ source: source44 }] })]);
check('create-list-concurrent-same-name-one-list', sameRace[0].created && sameRace[1].replaced && sameRace[0].listId === sameRace[1].listId && readDisk().filter(x => x.list === sameRace[0].listId).length === 1);
const beforeFailure = fs.readFileSync(playlistPath, 'utf8'), setBefore = storage.set;
storage.set = async () => { throw new Error('storage denied'); };
const failedSave = await createTool.execute({ name: '失败歌单', tracks: [{ source: source44 }] });
storage.set = setBefore;
check('create-list-storage-failure-rolls-back-playlist', failedSave.isError && fs.readFileSync(playlistPath, 'utf8') === beforeFailure && !(await storage.get('player-lists')).some(x => x.name === '失败歌单'));
await createList(ctx, { name: '失败后恢复', tracks: [] });
check('create-list-queue-recovers-after-failure', (await storage.get('player-lists')).some(x => x.name === '失败后恢复'));
const music = unwrap(await makeListMusicTool(ctx).execute({ keyword: '原曲', limit: 1 }));
check('list-music-metadata-counts-independent-of-track-filter', music.lists.find(x => x.id === sameRace[0].listId).count === 1 && music.returned === 1 && music.tracks[0].source === source44);
const allocRes = await handler('POST', '/api/lists/allocate')(fakeC({ json: { prefix: '歌单' } }));
check('lists-allocate-route-persists-reservation', allocRes.status === 200 && (await storage.get('player-lists')).some(x => x.id === allocRes.body.list.id));

for (const version of ['DJ版', '曼波版', 'Live', 'Remix', '伴奏', 'cover', 'ver.2']) {
  const clean = cleanMusicMetadata({ title: `2011 09 07 【字幕组】歌曲（${version}）(中文翻译) Hi-res MV` });
  check('clean-preserves-version-' + version, clean.name === `歌曲 (${version})`, JSON.stringify(clean));
}
const cleanBook = cleanMusicMetadata({ title: '【A-SOUL/向晚】南拳妈妈《下雨天》(中文翻译)[出自动画] MV', author: '账号已注销' });
check('clean-book-name-and-singer-without-up', cleanBook.name === '下雨天' && cleanBook.author === '南拳妈妈');
const prefixCounts = singerPrefixes([{ name: '周杰伦 - 稻香' }, { name: '周杰伦 - 枫' }, { name: '周杰伦 - 晴天' }, { name: '晩餐歌 - Bansanka' }, { name: '革命道中 - On The Way' }]);
check('clean-singer-prefix-threshold-three', cleanMusicMetadata({ title: '周杰伦 - 稻香' }, { prefixes: prefixCounts }).name === '稻香');
check('clean-prefix-below-three-is-not-split', cleanMusicMetadata({ title: '周杰伦 - 稻香' }, { prefixes: singerPrefixes([{ name: '周杰伦 - 枫' }, { name: '周杰伦 - 晴天' }]) }).name === '周杰伦 - 稻香');
check('clean-japanese-romanized-alias-not-mis-split', cleanMusicMetadata({ title: '晩餐歌 - Bansanka' }, { prefixes: prefixCounts }).author === '' && cleanMusicMetadata({ title: '革命道中 - On The Way' }, { prefixes: prefixCounts }).name === '革命道中 - On The Way');
check('clean-up-singer-conservative', ['', '账号已注销', 'A-SOUL/向晚', '歌手123', '歌手(翻唱)', '歌手｜UP'].every(author => cleanMusicMetadata({ title: '歌曲', author }).author === ''));
const candidates = [{ id: '1', title: '下雨天', dur: 200 }, { id: '2', title: '下雨天 (Live)', dur: 263 }, { id: '3', title: '下雨天', dur: 262 }];
check('match-name-and-nearest-duration', pickMetadataMatch({ name: '下雨天' }, 263, candidates).hit.id === '3');
check('match-version-does-not-collapse-to-studio', pickMetadataMatch({ name: '下雨天(Live)' }, 263, candidates).hit.id === '2' && pickMetadataMatch({ name: '下雨天(Remix)' }, 263, candidates) === null);
check('match-duration-soft-sixty-second-boundary', !pickMetadataMatch({ name: '下雨天' }, 322, candidates).suspect && pickMetadataMatch({ name: '下雨天' }, 323, candidates).suspect);

const searchCalls = [];
let searchMissing = false, lyricFails = false, rawDuration = '4:23';
const searchCtx = { ...ctx, network: { async fetch(url, opts) {
  searchCalls.push({ url, cookie: !!opts?.headers?.Cookie });
  if (url.includes('/search/type')) return { ok: true, json: async () => ({ data: { result: [{ bvid: 'BV118411B7XU', title: '2011 09 07 【字幕组】南拳妈妈《下雨天》(中文翻译) Hi-res MV', author: 'UP主甲', pic: '//i1.hdslb.com/raw.jpg', duration: rawDuration }] } }) };
  if (url.includes('cloudsearch')) return { ok: true, json: async () => ({ code: 200, result: { songs: searchMissing ? [] : [
    { id: 101, name: '下雨天', ar: [{ name: '南拳妈妈' }], al: { picUrl: 'https://p1.music.126.net/far.jpg' }, dt: 200000 },
    { id: 102, name: '下雨天 (Live)', ar: [{ name: '翻唱歌手' }], al: { picUrl: 'https://p1.music.126.net/live.jpg' }, dt: 263000 },
    { id: 103, name: '下雨天', ar: [{ name: '南拳妈妈' }], al: { picUrl: 'https://p1.music.126.net/near.jpg' }, dt: 262000 }
  ] } }) };
  if (url.includes('type=lrc')) { if (lyricFails) throw new Error('lyric unavailable'); return { ok: true, text: async () => '[00:01.00]测试歌词' }; }
  return { ok: true, json: async () => [{ id: 'qq44', title: '下雨天', author: '南拳妈妈', url: 'https://node/?server=tencent&type=url&id=qq44' }] };
} } };
const searchTool = makeSearchMusicTool(searchCtx);
const biliFound = unwrap(await searchTool.execute({ keyword: '下雨天' }));
check('search-default-bili-clean-metadata-preserves-play-source', biliFound.server === 'bilibili' && biliFound.tracks[0].source.endsWith('/BV118411B7XU?server=bilibili') && biliFound.tracks[0].name === '下雨天' && biliFound.tracks[0].author === '南拳妈妈' && biliFound.tracks[0].pic.endsWith('/near.jpg'));
check('search-secondary-lyric-and-duration-in-seconds', biliFound.tracks[0].matched && biliFound.tracks[0].lrc.includes('测试歌词') && biliFound.tracks[0].lrcUrl.includes('id=103') && biliFound.tracks[0].dur === 263);
searchMissing = true;
const missing = unwrap(await searchTool.execute({ keyword: '下雨天' }));
check('search-unmatched-preserves-source-and-cover', missing.tracks.length === 1 && !missing.tracks[0].matched && missing.tracks[0].pic.endsWith('/raw.jpg') && missing.tracks[0].source === biliFound.tracks[0].source);
searchMissing = false; rawDuration = '8:23';
const suspect = unwrap(await searchTool.execute({ keyword: '下雨天' }));
check('search-huge-duration-gap-marks-without-dropping', suspect.tracks[0].matched && suspect.tracks[0].matchWarning.includes('存疑'));
rawDuration = '4:23'; lyricFails = true;
const noLyric = unwrap(await searchTool.execute({ keyword: '下雨天' }));
check('search-lyric-failure-keeps-matched-song', noLyric.tracks[0].matched && noLyric.tracks[0].lrc === '' && noLyric.tracks[0].source === biliFound.tracks[0].source);
lyricFails = false;
fs.writeFileSync(path.join(dataDir, 'cookies.env'), 'NETEASE_COOKIE=MUSIC_U=fixture\n');
searchCalls.length = 0;
const neteaseFound = unwrap(await searchTool.execute({ keyword: '下雨天' }));
check('search-cookie-default-netease-no-source-mix', neteaseFound.server === 'netease' && neteaseFound.tracks.every(x => x.source.includes('server=netease')) && !searchCalls.some(x => x.url.includes('bilibili')) && searchCalls.some(x => x.cookie));
const override = unwrap(await searchTool.execute({ keyword: '下雨天', server: 'tencent' }));
check('search-explicit-provider-wins', override.server === 'tencent' && override.tracks[0].source.endsWith('/qq44?server=tencent'));
searchCalls.length = 0;
await searchTool.execute({ keyword: '下雨天', limit: 100 });
check('search-limit-clamped-at-thirty', searchCalls[0].url.includes('limit=30'));
check('search-rejects-empty-query-and-invalid-provider', (await searchTool.execute({ keyword: '' })).isError && (await searchTool.execute({ keyword: '下雨天', server: 'bad' })).isError);
fs.unlinkSync(path.join(dataDir, 'cookies.env'));
const revisionBeforeRoute = await storage.get('player-library-revision');
await POST_PLAYLIST(fakeC({ json: { tracks: readDisk() } }));
check('playlist-route-write-publishes-global-revision', (await storage.get('player-library-revision')) !== revisionBeforeRoute);
const revisionBeforePlay = await storage.get('player-library-revision');
await makePlayTool(ctx, {}).execute({ source: 'https://example.com/notified.mp3' });
check('play-tool-write-publishes-global-revision', (await storage.get('player-library-revision')) !== revisionBeforePlay);
const orderedBase = (await storage.get('player-lists'));
const orderedNext = [...orderedBase].reverse();
await putLists(orderedNext, orderedBase);
check('lists-ui-order-change-persists', JSON.stringify(await storage.get('player-lists')) === JSON.stringify(orderedNext));

/* 注册的唯一成功判据是 listOwn；装载时 ready 的异步拒绝也必须能被捕获。 */
let ownCommands = [], commandAttempts = 0, commandReady = true;
let registeredMood;
const commandCtx = { logger: ctx.logger, commands: {
  async listOwn() { if (!commandReady) throw new Error('engine unavailable'); return ownCommands; },
  register(registration) {
    commandAttempts++;
    registeredMood = registration;
    const off = () => { ownCommands = []; };
    off.ready = Promise.resolve().then(() => { ownCommands = [{ name: registration.name, usage: registration.usage }]; });
    return off;
  },
} };
const mood = createMoodCommand(commandCtx);
const registrationResults = await Promise.all([mood.ensure(), mood.ensure(), mood.ensure()]);
check('mood-first-registration-awaits-receipt-and-list-own', registrationResults.every(Boolean) && commandAttempts === 1 && ownCommands[0].name === 'mood');
// 使用真实子进程 invocation 的四个可序列化字段，不再由 mock 注入 reply。
const moodReply = await registeredMood.handler({ commandName: 'mood', rawText: '/mood', args: '', sessionPath: '/test/session.jsonl' });
check('mood-handler-single-guidance-reply-with-contextual-example', registeredMood.aliases[0] === '心情' && moodReply === MOOD_PROMPT && moodReply.includes('建个安静的心情歌单'));
mood.dispose();
check('mood-dispose-removes-command-and-prevents-late-registration', ownCommands.length === 0 && !(await mood.ensure()) && commandAttempts === 1);
commandReady = false;
const lateMood = createMoodCommand(commandCtx);
check('mood-no-engine-does-not-enqueue-doomed-registration', !(await lateMood.ensure()) && commandAttempts === 1);
commandReady = true;
check('mood-event-driven-recovery-without-timer', await lateMood.ensure() && commandAttempts === 2);
lateMood.dispose();
let rejectedDisposed = false;
const rejectedMood = createMoodCommand({ logger: ctx.logger, commands: {
  listOwn: async () => [], register() {
    const off = () => { rejectedDisposed = true; };
    off.ready = Promise.reject(new Error('registration rejected'));
    return off;
  },
} });
check('mood-asynchronous-ready-rejection-not-success', !(await rejectedMood.ensure()) && rejectedDisposed);
const unlistedMood = createMoodCommand({ logger: ctx.logger, commands: {
  listOwn: async () => [], register() { const off = () => {}; off.ready = Promise.resolve(); return off; },
} });
check('mood-ready-alone-does-not-prove-registration', !(await unlistedMood.ensure()));
const registeredTools = [];
const setupStorageBefore = fs.readFileSync(storagePath, 'utf8');
const stopPlayer = await applyPlayer({ ...ctx, commands: commandCtx.commands,
  bus: { subscribe: () => () => {} },
  tools: { register: tool => { registeredTools.push(tool.name); return () => {}; } },
  routes: { register: callback => { callback(app); return () => {}; } },
});
check('app-startup-registers-mood-before-tool-or-session-event', ownCommands.some(x => x.name === 'mood') && registeredTools.length === 5);
check('app-startup-does-not-write-player-storage', fs.readFileSync(storagePath, 'utf8') === setupStorageBefore);
stopPlayer();
check('app-teardown-disposes-mood-command', ownCommands.length === 0);

const staleBase = [
  { id: 'netease:44', url: source44, name: '原曲', list: 'fav', pic: 'old' },
  { id: 'netease:45', url: source44.replace('/44?', '/45?'), name: '将被删', list: 'fav' },
];
await POST_PLAYLIST(fakeC({ json: { tracks: staleBase } }));
const racingList = await createList(ctx, { name: '保存竞态', tracks: [{ source: source44 }] });
const diskDuringRace = readDisk();
diskDuringRace.find(t => t.list === 'fav' && t.id === 'netease:44').pic = 'agent-new-cover';
fs.writeFileSync(playlistPath, JSON.stringify(diskDuringRace));
await POST_PLAYLIST(fakeC({ json: { baseTracks: staleBase, tracks: [{ ...staleBase[0], name: 'UI改名' }] } }));
check('playlist-stale-ui-save-keeps-agent-created-tracks', readDisk().some(t => t.list === racingList.listId));
check('playlist-stale-ui-save-merges-only-local-fields', readDisk().find(t => t.list === 'fav').name === 'UI改名' && readDisk().find(t => t.list === 'fav').pic === 'agent-new-cover');
check('playlist-ui-delete-still-applies-with-snapshot', !readDisk().some(t => t.id === 'netease:45'));
const beforeDelete = readDisk();
fs.writeFileSync(playlistPath, JSON.stringify(beforeDelete.filter(t => t.list !== 'fav')));
await POST_PLAYLIST(fakeC({ json: { baseTracks: beforeDelete, tracks: beforeDelete } }));
check('playlist-stale-ui-save-does-not-resurrect-external-deletion', !readDisk().some(t => t.list === 'fav'));

/* 真实宿主的中文 alias 拒绝会回滚主名；清理回执后只降级一次并回读目录。 */
let aliasOwn = [], aliasAttempts = [], aliasReleased = false, asciiRegistration;
const aliasMood = createMoodCommand({ logger: ctx.logger, commands: {
  listOwn: async () => aliasOwn,
  register(registration) {
    aliasAttempts.push(registration);
    const off = () => { aliasOwn = []; };
    off.disposeAsync = async () => { off(); aliasReleased = true; };
    off.ready = Promise.resolve().then(() => {
      if (registration.aliases?.includes('心情')) {
        aliasOwn = [];
        throw new Error('v2 app "hanako-simple-player" could not register command alias "心情": it is invalid, reserved, or already taken.');
      }
      if (!aliasReleased) throw new Error('failed registration was not disposed');
      asciiRegistration = registration;
      aliasOwn = [{ name: registration.name }];
    });
    return off;
  },
} });
const aliasResults = await Promise.all([aliasMood.ensure(), aliasMood.ensure()]);
check('mood-alias-rejection-disposes-and-registers-ascii-once', aliasResults.every(Boolean) && aliasAttempts.length === 2 && aliasReleased && aliasOwn[0]?.name === 'mood');
check('mood-ascii-fallback-does-not-advertise-unavailable-alias', !asciiRegistration?.aliases && !asciiRegistration?.usage.includes('心情）'));
aliasMood.dispose();
let genericAttempts = 0;
const genericRejectedMood = createMoodCommand({ logger: ctx.logger, commands: {
  listOwn: async () => [], register() {
    genericAttempts++;
    const off = () => {};
    off.ready = Promise.reject(new Error('permission denied'));
    return off;
  },
} });
check('mood-general-registration-rejection-does-not-trigger-alias-fallback', !(await genericRejectedMood.ensure()) && genericAttempts === 1);

/* 音频授权：测真实状态机与跨 await 竞速，不复制第二套仲裁。 */
{
  const values = new Map(), snapshots = [];
  let failWrite = false;
  const owner = createAudioOwner({ storage: {
    get: async key => values.get(key) ?? null,
    set: async (key, value) => { if (failWrite) throw new Error('storage failed'); values.set(key, structuredClone(value)); }
  }, writePlayback: async value => snapshots.push(structuredClone(value)) });
  const request = (ownerId, claimId, action = 'claim', extra = {}) => ({ ownerId, claimId, action, ...extra });
  const boots = await Promise.all([owner.command(request('A', 'A-1', 'claim', { reason: 'restore' })), owner.command(request('B', 'B-1', 'claim', { reason: 'restore' }))]);
  check('audio-concurrent-boot-single-grant', boots.filter(x => x.granted).length === 1 && (await owner.read()).ownerId === 'A');
  const first = await owner.read();
  await owner.command(request('B', 'B-2'));
  check('audio-claim-waits-for-pause', (await owner.read()).ownerId === 'A' && (await owner.read()).pending.ownerId === 'B');
  await owner.command(request('A', 'wrong', 'yield', { generation: first.generation, snapshot: { playing: true, progress: 5 } }));
  check('audio-stale-yield-cannot-grant', (await owner.read()).ownerId === 'A');
  await owner.command(request('C', 'C-1'));
  await owner.command(request('A', 'B-2', 'yield', { generation: first.generation }));
  check('audio-later-claim-wins-without-old-ack', (await owner.read()).pending.ownerId === 'C' && (await owner.read()).ownerId === 'A');
  await owner.command(request('A', 'C-1', 'yield', { generation: first.generation, snapshot: { playing: true, progress: 5 } }));
  const current = await owner.read();
  check('audio-yield-saves-false-before-grant', current.ownerId === 'C' && snapshots.at(-1).playing === false && snapshots.at(-1).progress === 5);
  await owner.savePlayback({ playing: true, progress: 6 }, { ownerId: 'C', generation: current.generation });
  const stale = await owner.savePlayback({ playing: true, progress: 99 }, { ownerId: 'A', generation: first.generation });
  const passive = await owner.savePlayback({ playing: false, progress: 99 }, { ownerId: 'A', generation: first.generation });
  check('audio-old-true-and-false-cannot-overwrite-current', !stale.accepted && !passive.accepted && snapshots.at(-1).progress === 6);
  await owner.command(request('A', 'A-stop', 'stop', { snapshot: { playing: false } }));
  check('audio-other-instance-stop-requires-yield', (await owner.read()).ownerId === 'C' && (await owner.read()).pending.ownerId === '');
  await owner.command(request('C', 'A-stop', 'yield', { generation: current.generation, snapshot: { playing: false } }));
  check('audio-stop-clears-owner-and-resume', !(await owner.read()).ownerId && !(await owner.read()).resume && snapshots.at(-1).playing === false);
  const resumed = await owner.command(request('A', 'A-3'));
  await owner.command(request('A', 'A-handoff', 'handoff', { generation: resumed.record.generation, snapshot: { playing: true, progress: 12 } }));
  check('audio-explicit-handoff-keeps-resume-intent', !(await owner.read()).ownerId && (await owner.read()).resume && snapshots.at(-1).playing && snapshots.at(-1).progress === 12);
  const reboots = await Promise.all([owner.command(request('B', 'B-reload', 'claim', { reason: 'restore' })), owner.command(request('C', 'C-reload', 'claim', { reason: 'restore' }))]);
  check('audio-handoff-reboot-single-grant', reboots.filter(x => x.granted).length === 1);
  const beforeFailure = await owner.read(); failWrite = true;
  let rejected = false;
  try { await owner.command(request('A', 'A-failed')); } catch { rejected = true; }
  check('audio-storage-failure-never-grants', rejected && (await owner.read()).revision === beforeFailure.revision);
  failWrite = false;
  await owner.command(request('A', 'A-retry'));
  check('audio-failed-command-does-not-poison-chain', (await owner.read()).pending.claimId === 'A-retry');

  const orphan = await owner.read();
  const reaped = await owner.command(request('D', 'D-restore', 'claim', { reason: 'restore',
    reap: true, reapOwnerId: orphan.ownerId, reapGeneration: orphan.generation }));
  check('audio-proven-orphan-reaped-before-restore-guard', reaped.granted && reaped.record.ownerId === 'D'
    && reaped.record.revision === orphan.revision + 2 && reaped.record.generation > orphan.generation);
  const fenced = await owner.savePlayback({ playing: true, progress: 99 }, { ownerId: orphan.ownerId, generation: orphan.generation });
  await owner.command(request(orphan.ownerId, 'orphan-late-yield', 'yield', { generation: orphan.generation }));
  await owner.command(request(orphan.ownerId, 'orphan-late-handoff', 'handoff', { generation: orphan.generation, snapshot: { playing: true } }));
  check('audio-reap-fences-old-save-yield-handoff', !fenced.accepted && (await owner.read()).generation === reaped.record.generation);
  const delayed = await owner.command(request('E', 'E-delayed', 'claim', { reason: 'restore',
    reap: true, reapOwnerId: orphan.ownerId, reapGeneration: orphan.generation }));
  check('audio-delayed-reap-cannot-clear-new-owner', !delayed.granted && delayed.record.ownerId === 'D'
    && delayed.record.generation === reaped.record.generation);
  const noProof = await owner.command(request('E', 'E-unproven', 'claim', { reason: 'restore', reap: true }));
  check('audio-reap-without-target-proof-remains-standby', !noProof.granted && noProof.record.ownerId === 'D');
  await owner.command(request('E', 'E-reap-stop', 'stop', { reap: true, reapOwnerId: 'D',
    reapGeneration: reaped.record.generation, snapshot: { playing: true, progress: 6 } }));
  check('audio-proven-orphan-stop-clears-and-saves-false', !(await owner.read()).ownerId
    && (await owner.read()).generation > reaped.record.generation && snapshots.at(-1).playing === false);
}

fs.rmSync(dataDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, failed, results }, null, 2));
process.exit(failed.length ? 1 : 0);

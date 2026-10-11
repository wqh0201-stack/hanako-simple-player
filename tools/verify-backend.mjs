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

const routes = [];
const app = {
  get: (p, h) => routes.push(['GET', p, h]),
  post: (p, h) => routes.push(['POST', p, h]),
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
  // 其余（Meting 节点）：回一个最小可用的曲目数组（url 带 id，好让 metingStableId 能取到）
  return { ok: true, json: async () => ([{ id: '1', title: 't', author: 'a', url: 'http://node/1?server=tencent&type=url&id=1', pic: '', lrc: '' }]) };
};

const ctx = { dataDir, logger: { warn() {}, info() {}, error() {} }, resources: {}, storage: { global: {} }, tools: {}, network: { fetch: netFetch } };
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

fs.rmSync(dataDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, failed, results }, null, 2));
process.exit(failed.length ? 1 : 0);

#!/usr/bin/env node
/* ============================================================
   tools/verify-ui.mjs — 生产 ui/ 的无头验收（开发用）
   零业务依赖：起本地 HTTP 服务（ui/ + 假后端），用 puppeteer-core 驱动系统 Chrome：
     · 六种尺寸 × 浅深主题：跑页面内自检（?assert=1）+ 出截图（12 组布局自检）
     · 接线冒烟：多歌单切换 / 本地文件夹 / 重命名 / 导入 / 播放 / 歌词 / 删除 / 抽屉
     · 精修矩阵：312/465/1040 × 浅深 × 歌词开/关 + 312 档自检
     · 主题双保险：hana-css 注入 / palette 跟随系统深浅 / 无宿主兜底 / 宿主优先
     · 夜间兜底：宿主没注入主题时跟随 prefers-color-scheme
     · 旧数据迁移：无 list 字段 → 按 group 分导入列表（幂等）
     · 拖拽生命周期：pagehide 落盘 → reload 恢复 + 续播
   鉴权闸门（无票 403）与滚动条断言（悬停前后歌词宽度必须相等）都在本文件里，
   不许绕过。
   用法：node tools/verify-ui.mjs
   ============================================================ */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mergeLibrarySnapshot } from '../lib/library.js';
import { createAudioOwner } from '../lib/audio-owner.js';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE || '/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = process.env.VERIFY_UI_DIR ? path.resolve(process.env.VERIFY_UI_DIR) : path.join(repo, 'ui');
const outDir = process.env.OUT_DIR || '/tmp/hap-verify';
const API = '/api/apps/hanako-simple-player/routes';
const COVER_FILE = path.join(repo, 'docs/player-ui/assets/demo-cover.png');
const COVER_SQUARE_FILE = path.join(repo, 'docs/player-ui/assets/demo-cover-square.png');
/* 深色封面夹具：右缘确实深，用来验证「深底 → 浅字」那条分支。
 * 由 tools/make-fixture-covers.mjs 生成（纯 Node 手写 PNG，可复现）。 */
const COVER_DARK_FILE = path.join(repo, 'docs/player-ui/assets/demo-cover-dark.png');
const COVER_LIGHT_FILE = path.join(repo, 'docs/player-ui/assets/demo-cover-light.png');
fs.mkdirSync(outDir, { recursive: true });

/* ---------- 假音频：30 秒静音 WAV（走 URL，不走 data URL） ----------
 * 30 秒是为了让接线冒烟不跟 1 秒音频的 ended 连锁自动切歌撞车（点完到断言
 * 有 0.7~0.9s 窗口，ended 恰好落在里面就会张冠李戴）；走 URL 同时让 <audio>
 * 真实经过 withSession 贴票路径，也避免 savePlaylist 把巨型 data URL 回写。
 * 带 Range 支持（真实后端 /widget/media 也是 Range；无 Range 会不可 seek，
 * 续播断言会假红）。 */
const WAV_SECONDS = 30;
const pcm = Buffer.alloc(44100 * 2 * WAV_SECONDS);
const wav = Buffer.alloc(44 + pcm.length);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(44100 * 2, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
pcm.copy(wav, 44);
const WAV_URL = `${API}/_fixture/audio.wav`;

/* ---------- 合成音频夹具（涟漪音频分层验收用） ----------
 * 全为单声道 44100Hz 16bit WAV，同源 → captureStream 能读到真实 FFT。
 * 每个夹具都按预设总时长生成，覆盖方案 §7 要的三态：
 *   steady-bass : 6s 持续 80Hz（低音感强，无跳变）→ 应维持宽缓场、不持续生成短波
 *   kicks       : 6s 每秒 3 个 60Hz 短包（明显底鼓）→ 应产出有限细波
 *   mid-bursts  : 6s 每秒 3 个 1.2kHz 短包（中频敲击，低频门限之外）→ 起音路径应识别
 *   hihats      : 6s 每秒 3 个多音色高频短包（4/5.2/6.5/7.6kHz，踩镲）→ 高频起音路径应识别
 *   weak-mid    : 6s 每秒 3 个双音色弱短包（1/1.4kHz）→ 严格档不出波、调松后出波
 *   mixed       : 2s 80Hz 持续 + 之后每 0.5s 一个低频短脉冲
 *   silence     : 6s 真静音 → 不得伪造周期鼓点
 *   dense       : 3s 每秒 8 个短脉冲（密集）→ 经合并/限流后波包不超过预算
 * steady 与 kicks 用相同峰值幅度，便于「同总音量」对比形态。 */
function synthSamples(kind) {
  const SR = 44100, secs = kind === 'dense' ? 3 : 6, N = SR * secs;
  const s = new Float32Array(N);
  const addTone = (from, dur, hz, amp, env) => {
    const a = Math.floor(from * SR), b = Math.min(N, Math.floor((from + dur) * SR));
    for (let i = a; i < b; i++) {
      const t = (i - a) / SR;
      const g = env ? Math.exp(-t * env) : 1;
      s[i] += amp * g * Math.sin(2 * Math.PI * hz * t);
    }
  };
  if (kind === 'steady-bass') {
    addTone(0, secs, 80, 0.5, 0);
  } else if (kind === 'kicks') {
    for (let t = 0.2; t < secs - 0.2; t += 1 / 3) addTone(t, 0.12, 60, 0.5, 40);   // 60Hz 短包（底鼓）
  } else if (kind === 'mid-bursts') {
    for (let t = 0.2; t < secs - 0.2; t += 1 / 3) addTone(t, 0.08, 1200, 0.45, 55);  // 1.2kHz 敲击
  } else if (kind === 'hihats') {
    /* 踩镲：多音色短包（能量分散到多个 bin，抗 FFT 窗口对齐）。
       包长 0.15s 而不是 0.07s：整套负载下 rAF 变慢时采样变疏，短包可能只被采到 1 个样本、
       包络爬升不够而假性漏触（实测整套里会从 7 次掉到 1 次）；长包保证采到 3+ 样本。 */
    for (let t = 0.2; t < secs - 0.2; t += 1 / 3) for (const hz of [4000, 5200, 6500, 7600]) addTone(t, 0.15, hz, 0.25, 30);
  } else if (kind === 'weak-mid') {
    /* 弱中频（灵敏度档位用）：包长同样取 0.15s，抗整套负载下的采样变疏。 */
    for (let t = 0.2; t < secs - 0.2; t += 1 / 3) for (const hz of [1000, 1400]) addTone(t, 0.15, hz, 0.09, 30);
  } else if (kind === 'mixed') {
    addTone(0, 2, 80, 0.42, 0);
    for (let t = 2.3; t < secs - 0.2; t += 0.5) addTone(t, 0.14, 65, 0.42, 30);
  } else if (kind === 'dense') {
    for (let t = 0.2; t < secs - 0.15; t += 1 / 8) addTone(t, 0.06, 70, 0.45, 60);    // 每秒 8 个
  }
  return s;
}
function wavFromSamples(samples) {
  const n = samples.length;
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const out = Buffer.alloc(44 + pcm.length);
  out.write('RIFF', 0); out.writeUInt32LE(36 + pcm.length, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(44100, 24); out.writeUInt32LE(44100 * 2, 28); out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(pcm.length, 40);
  pcm.copy(out, 44);
  return out;
}
const SYNTH_KINDS = ['steady-bass', 'kicks', 'mid-bursts', 'hihats', 'weak-mid', 'mixed', 'silence', 'dense'];
const SYNTH_WAV = {};
for (const k of SYNTH_KINDS) SYNTH_WAV[k] = wavFromSamples(synthSamples(k));
const synthUrl = (kind) => `${API}/_fixture/tone.wav?p=${kind}`;const COVER = `${API}/_fixture/cover.png`;
const COVER_SQUARE = `${API}/_fixture/cover-square.png`;
const COVER_DARK = `${API}/_fixture/cover-dark.png`;
const COVER_LIGHT = `${API}/_fixture/cover-light.png`;
const goUrl = (id) => `${API}/widget/api/music/go/${id}?server=netease`;

/* ---------- 假播放列表（多歌单：本地为空 + 两个导入歌单） ----------
 *  · local   ：0 首（验证「没设文件夹 → 引导」）
 *  · imp:1   ：20 首在线（前两首带封面，一方一横幅，验封面两种画幅）
 *  · imp:2   ：3 首与 imp:1 同 id（跨列表重复，去重键必须含 list 才不会被并掉）
 *             + 3 首旧版 searchKey 曲目（无 url，测现搜现播）
 */
function makeTracks() {
  const out = [];
  for (let i = 0; i < 20; i++) {
    out.push({
      id: `netease:${900000 + i}`, name: `在线曲目 ${i + 1}`, url: goUrl(900000 + i),
      mode: '在线', dur: 0, group: '在线音乐', list: 'imp:1',
      pic: i % 5 === 0 ? COVER : ''
    });
  }
  out[0].pic = COVER_SQUARE;   // 方形封面（右缘上浅下深）
  out[1].pic = COVER;          // 横幅封面
  out[2].pic = COVER_DARK;     // 深色封面（右缘极深，走「深纱+纸字」）
  out[4].pic = COVER_LIGHT;    // 真·浅底封面（整张浅，走「浅纱+墨字」）
  out[5] = { id: 'netease:900099', name: '无词纯音乐', url: goUrl(900099), mode: '在线', dur: 0, group: '在线音乐', list: 'imp:1', pic: COVER_DARK };  // 无歌词曲目（假后端对其返回空 LRC）；配深色封面，供「无词 + 深底」验证
  out[6] = { id: 'netease:900098', name: '占位词纯音乐', url: goUrl(900098), mode: '在线', dur: 0, group: '在线音乐', list: 'imp:1', pic: COVER_LIGHT };  // 歌词源回「这似乎是一首纯音乐」占位句，应被当无词
  out[7].pic = `${API}/_fixture/cover-portrait.svg`; // 竖图：阅读轴不能随画幅变化
  for (let i = 0; i < 3; i++) {
    out.push({
      id: `netease:${900000 + i}`, name: `在线曲目 ${i + 1}`, url: goUrl(900000 + i),
      mode: '在线', dur: 0, group: '鸣潮', list: 'imp:2'
    });
  }
  for (let k = 0; k < 3; k++) {
    out.push({
      name: `搜索曲目 ${k + 1}`, url: '', mode: '在线', dur: 0, group: '鸣潮',
      list: 'imp:2', searchKey: `关键词 ${k + 1}`, searchServer: 'netease'
    });
  }
  return out;
}
const TRACKS = makeTracks();

/* ---------- 旧数据夹具（无 list 字段，用于测迁移） ----------
 * 复刻罐头真实的 playlist.json 形状：只有 name/url/mode/dur/group。
 *  · mode 本地 → local；在线按 group 各自成一个导入列表；group 缺失 → 未分类
 */
const OLD_TRACKS = [];
for (let i = 0; i < 3; i++) OLD_TRACKS.push({ name: `旧本地 ${i + 1}`, url: WAV_URL, mode: '本地', dur: 0, group: '本地音乐' });
for (let i = 0; i < 4; i++) OLD_TRACKS.push({ name: `鸣潮曲 ${i + 1}`, url: '', mode: '在线', dur: 0, group: '鸣潮', searchKey: `鸣潮 ${i + 1}`, searchServer: 'netease' });
for (let i = 0; i < 3; i++) OLD_TRACKS.push({ name: `在线曲 ${i + 1}`, url: '', mode: '在线', dur: 0, group: '在线音乐', searchKey: `在线 ${i + 1}`, searchServer: 'netease' });
for (let i = 0; i < 2; i++) OLD_TRACKS.push({ name: `未分类曲 ${i + 1}`, url: '', mode: '在线', dur: 0, group: '', searchKey: `未分类 ${i + 1}`, searchServer: 'netease' });
/* 旧包名前缀（改名迁移债）：本 App 曾叫 hanako-audio-player，磁盘上留着该前缀的
 * 绝对路径；旧 app 已停用、路由不再注册 → 一律 404。读时必须归一到当前 appId。 */
const OLD_PKG = 'hanako-audio-player';
for (let i = 0; i < 3; i++) OLD_TRACKS.push({ id: `netease:${810000 + i}`, name: `旧前缀曲 ${i + 1}`, url: `/api/apps/${OLD_PKG}/routes/widget/api/music/go/${810000 + i}?server=netease`, mode: '在线', dur: 0, group: '旧包名' });

/* 纯旧前缀夹具：曲目已带 list 字段（不需要列表迁移），只有 url 是旧包名前缀。
 * 用来单独验证 boot 时的“读时归一 → 立即全量回写自愈”分支（不靠迁移顺带触发）。 */
const OLDPREFIX_TRACKS = [
  { id: 'netease:820001', name: '旧前缀甲', url: `/api/apps/${OLD_PKG}/routes/widget/api/music/go/820001?server=netease`, mode: '在线', dur: 0, group: '在线音乐', list: 'imp:1' },
  { id: 'netease:820002', name: '旧前缀乙', url: `/api/apps/${OLD_PKG}/routes/widget/api/music/go/820002?server=netease`, mode: '在线', dur: 0, group: '在线音乐', list: 'imp:1' },
  // 对照组：本地媒体新前缀 + 外链，都不能被误伤
  { id: 'keep.wav', name: '本地保留', url: `/api/apps/hanako-simple-player/routes/widget/media/keep.wav`, mode: '本地', dur: 0, group: '本地音乐', list: 'local' }
];

/* 假后端状态：POST /playlist 会落盘，GET 优先返回落盘值（测迁移幂等） */
let fixtureMode = 'main';
let persistedPlaylist = null;
let persistedLists = null, listReads = 0, listWrites = 0;
/* 播放状态（跨文档）：POST 落盘，GET 取回 */
let playbackState = null;
let fixtureOwner = null;
function resetOwnerFixture() {
  fixtureOwner = createAudioOwner({ storage: { get: async () => null, set: async (key, record) => {
    // 复用真实仲裁；这里只替代宿主 transport，不实现第二套假仲裁逻辑。
    ownerFixtureRecord = JSON.parse(JSON.stringify(record));
  } }, writePlayback: async (snapshot) => { playbackState = JSON.parse(JSON.stringify(snapshot)); } });
  ownerFixtureRecord = null;
}
let ownerFixtureRecord = null;
resetOwnerFixture();
/* 搜索请求计数（测歌手补齐的次数 / 幂等） */
let searchHits = 0;
/* bili-resolve 请求计数：守「认不出的输入不发无谓请求」 */
let biliResolveHits = 0;
/* 歌单真名夹具：导入歌单时假后端附带 meta.name（模拟后端问网易云官方接口） */
const PLAYLIST_META = { name: 'Can_0201喜欢的音乐', creator: 'Can_0201', cover: '', trackCount: 905 };

/* ---------- 主题夹具 ---------- */
const THEME_VARS = {
  light: { '--bg': '#F8F4ED', '--bg-card': '#FCFAF5', '--text': '#3B3D3F', '--text-muted': '#8E9196', '--text-light': '#6B6F73', '--accent': '#537D96', '--border': 'rgba(122,96,88,0.18)' },
  dark: { '--bg': '#3B4A54', '--bg-card': '#445560', '--text': '#E1EAF0', '--text-muted': '#9FB1BC', '--text-light': '#9FB1BC', '--accent': '#C99AAF', '--border': 'rgba(170,121,141,0.16)' }
};

function lrcFor(name) {
  return Array.from({ length: 40 }, (_, i) => `[00:0${Math.floor(i / 10)}.${String((i % 10) * 10).padStart(2, '0')}]${name} 第 ${i + 1} 行歌词`).join('\n');
}
function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}
function text(res, code, body, type) {
  res.statusCode = code;
  res.setHeader('content-type', type || 'text/plain; charset=utf-8');
  res.end(body);
}
/* 假音频流：带 Range 支持（真实后端 /widget/media 也是 Range；无 Range 会不可 seek） */
function serveAudio(req, res) {
  const total = wav.length;
  res.setHeader('content-type', 'audio/wav');
  res.setHeader('accept-ranges', 'bytes');
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : total - 1;
      res.statusCode = 206;
      res.setHeader('content-range', `bytes ${start}-${end}/${total}`);
      res.setHeader('content-length', String(end - start + 1));
      return res.end(wav.subarray(start, end + 1));
    }
  }
  res.setHeader('content-length', String(total));
  return res.end(wav);
}

let coverRequests = [], coverDelay = 0, coverFail = false, coverImageBad = false;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;
  if (p === '/favicon.ico') { res.statusCode = 204; return res.end(); }

  // 复刻宿主鉴权：/routes/ 下的请求必须带 surface session（header 或 query），否则 403。
  // 少了这一层，前端忘了带票也会“假绿”——正是这次踩的坑。
  if (p.startsWith(API + '/')) {
    const hasHeader = (req.headers['x-hana-app-surface-session'] || '').trim();
    const hasQuery = (u.searchParams.get('appSurfaceSession') || '').trim();
    if (!hasHeader && !hasQuery) {
      return json(res, 403, { error: 'forbidden', reason: 'missing_credential', connectionKind: 'local' });
    }
  }

  // 假后端
  if (p === API + '/api/lists/allocate') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const input = JSON.parse(body), all = persistedLists || [];
      const ids = [...all.map(x => x.id), ...(persistedPlaylist || TRACKS).map(x => x.list)];
      const max = Math.max(0, ...ids.map(x => Number(/^imp:(\d+)$/.exec(x || '')?.[1]) || 0));
      const list = { id: 'imp:' + (max + 1), name: input.name || (input.prefix || '歌单') + ' ' + (max + 1) };
      persistedLists = [...all, list];
      json(res, 200, { ok: true, list });
    });
    return;
  }
  if (p === API + '/api/lists') {
    if (req.method === 'POST' || req.method === 'PUT') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        persistedLists = JSON.parse(body).lists;
        listWrites++;
        json(res, 200, { ok: true, lists: persistedLists });
      });
      return;
    }
    listReads++;
    return json(res, 200, { ok: true, lists: persistedLists || [] });
  }
  if (p === API + '/widget/api/music/cover-catalog') {
    const kind = u.searchParams.get('kind'); coverRequests.push(kind);
    let body;
    const entry = { title: '稻香', songId: 185709, artists: [{ id: 6452, name: '周杰伦' }], albumId: 18877, album: '魔杰座', subType: '录音室版', published: 2008, pic: coverImageBad ? WAV_URL : COVER_SQUARE };
    if (coverFail) body = { ok: false, error: '上游返回 -462' };
    else if (kind === 'artist') body = { ok: true, artist: { id: 6452, name: '周杰伦' } };
    else if (kind === 'albums') body = { ok: true, albums: [{ id: 18877, name: '魔杰座' }], more: false };
    else if (kind === 'album') body = { ok: true, tracks: [{ ...entry, albumId: 10, album: '超时代演唱会', published: 2010 }, { ...entry, albumId: 9, album: '精选集', published: 2000 }, entry, { ...entry, songId: 185912, title: '枫', album: '11月的萧邦', published: 2005 }] };
    else body = { ok: true, title: '周杰伦 全集' };
    if (coverDelay) return setTimeout(() => { if (!res.destroyed) json(res, 200, body); }, coverDelay);
    return json(res, 200, body);
  }
  if (p === API + '/widget/api/playlist') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const j = JSON.parse(body);
          persistedPlaylist = Array.isArray(j.tracks) ? (j.baseTracks ? mergeLibrarySnapshot(persistedPlaylist || (fixtureMode === 'migrate' ? OLD_TRACKS : fixtureMode === 'oldprefix' ? OLDPREFIX_TRACKS : fixtureMode === 'empty' ? [] : TRACKS), j.baseTracks, j.tracks,
            t => String(t.list || '') + '|' + String(t.id || t.url || t.name || '')) : j.tracks) : null;
        } catch { persistedPlaylist = null; }
        json(res, 200, { ok: true, count: persistedPlaylist ? persistedPlaylist.length : 0 });
      });
      return;
    }
    const tracks = persistedPlaylist || (fixtureMode === 'migrate' ? OLD_TRACKS : (fixtureMode === 'oldprefix' ? OLDPREFIX_TRACKS : (fixtureMode === 'empty' ? [] : TRACKS)));
    return json(res, 200, { ok: true, tracks, count: tracks.length });
  }
  if (p === API + '/__fixture/reset') {
    fixtureMode = u.searchParams.get('mode') || 'main';
    persistedPlaylist = null;
    playbackState = null;
    resetOwnerFixture();
    persistedLists = null; listReads = 0; listWrites = 0;
    searchHits = 0;
    return json(res, 200, { ok: true, mode: fixtureMode });
  }
  if (p === API + '/api/playback-state') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const snapshot = JSON.parse(body);
          // Node 测试播种直接准备盘上 fixture；真实页面仍经生产写入闸门。
          if (req.headers['x-fixture-seed'] === '1') { playbackState = snapshot; return json(res, 200, { ok: true }); }
          json(res, 200, await fixtureOwner.savePlayback(snapshot, {
            ownerId: req.headers['x-player-audio-owner'] || u.searchParams.get('audioOwnerId') || '',
            generation: Number(req.headers['x-player-audio-generation'] || u.searchParams.get('audioGeneration') || 0)
          }));
        } catch (err) { json(res, 500, { ok: false, error: err.message }); }
      });
      return;
    }
    return json(res, 200, { ok: true, state: playbackState });
  }
  if (p === API + '/api/audio-owner') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        try { json(res, 200, await fixtureOwner.command(JSON.parse(body))); }
        catch (err) { json(res, err.code || 500, { ok: false, error: err.message }); }
      });
    } else fixtureOwner.read().then(record => json(res, 200, { ok: true, record }));
    return;
  }
  if (p === API + '/api/track' && req.method === 'DELETE') {
    // 带上 list 时只删该列表里的那一份
    return json(res, 200, { ok: true, removed: 1, count: TRACKS.length - 1, list: u.searchParams.get('list') });
  }
  if (p === API + '/widget/api/lrc/load') return json(res, 404, { ok: false, error: 'not found' });
  if (p === API + '/widget/api/lrc/save') return json(res, 200, { ok: true, filename: 'x.lrc' });
  if (p === API + '/widget/api/music/lrc') {
    const id = u.searchParams.get('id') || '';
    if (id === '2074315223' && process.env.RIPPLE_LYRICS) return text(res, 200, fs.readFileSync(process.env.RIPPLE_LYRICS, 'utf8'), 'text/plain; charset=utf-8');
    if (id === '900099') return text(res, 200, '', 'text/plain; charset=utf-8');  // 无词纯音乐
    if (id === '900098') return text(res, 200, '[00:00.00]这似乎是一首纯音乐呢，请尽情欣赏它吧！', 'text/plain; charset=utf-8');  // 占位词纯音乐
    if (fixtureMode === 'align') return text(res, 200, '[offset:250]\n' + Array.from({ length: 12 }, (_, i) => `[00:${String(1 + i * 2).padStart(2, '0')}.00]校准试听 第 ${i + 1} 句`).join('\n'), 'text/plain; charset=utf-8');
    if (fixtureMode === 'lyric-slow') return text(res, 200, process.env.LYRIC_PERF_LRC ? fs.readFileSync(process.env.LYRIC_PERF_LRC, 'utf8') : [
      '[00:00.00]作词信息', '[00:01.00]作曲信息', '[00:02.00]编曲信息',
      '[00:12.55]ゆっくりと夜道を歩いて遠くの灯りを見つめている（这是一句日文与中文合并显示的长句，验证缓慢流动时仍然连续）',
      '[00:24.81]続く言葉を待っている（等待下一句）', '[00:30.48]この先も歩いていく（继续向前走）'
    ].join('\n'), 'text/plain; charset=utf-8');
    if (fixtureMode === 'lyric-flow') return text(res, 200, [
      '[00:01.00]风慢慢经过窗前',
      '[00:03.00]这是一句很长的中文歌词，让它自然换行之后仍然能够看清，每一个字都不会被波浪挤到旁边的句子上',
      '[00:05.00]再向前一点',
      '[00:08.00]Somewhere beyond the skyline, we keep moving through the night with a very long English lyric',
      '[00:08.00]同一时刻的翻译也保留',
      '[00:10.00]灯光渐渐亮起来',
      '[00:27.00]漫长间奏之后继续唱'
    ].join('\n'), 'text/plain; charset=utf-8');
    return text(res, 200, lrcFor('fixture'), 'text/plain; charset=utf-8');
  }
  if (p === API + '/widget/api/music/lrc-proxy') {
    return text(res, 200, lrcFor('proxy'), 'text/plain; charset=utf-8');
  }
  if (p === API + '/widget/api/music/ttml') return text(res, 404, 'not in amll-db');
  if (p === API + '/widget/api/music/song') {
    const id = u.searchParams.get('id') || '0';
    return json(res, 200, { ok: true, track: { id: `netease:${id}`, title: `在线单曲 ${id}`, author: '测试歌手', url: goUrl(id), pic: '', lrc: '' }, host: 'mock' });
  }
  /* 粘贴 B站链接导入（bili-resolve）：回一条与搜索结果同形的曲目 + parts/multi。
     与真实后端同口径：按**正文内容**判（真实后端看链接里的 ?p=N / view 的 pages）。
     正文含「多P」→ 回多 P（149 集），否则单 P。 */
  if (p === API + '/widget/api/music/bili-resolve') {
    biliResolveHits++;
    const raw = u.searchParams.get('url') || '';
    const multi = raw.indexOf('多P') >= 0 || /[?&]p=\d/.test(raw);
    const trackId = multi ? 'BV1CAxaeHEeH_26000000005' : 'BV118411B7XU';
    const track = {
      id: `bilibili:${trackId}`,
      title: multi ? '第 6 讲' : '在百万豪装录音棚大声听 杨丞琳《雨爱》【Hi-res】',
      author: multi ? '宋浩老师官方' : 'JLRS-LeoFM',
      pic: `${API}/_fixture/cover.png`,
      dur: multi ? 615 : 263,
      page: multi ? 6 : 1,
      cid: multi ? 26000000005 : 1262792384,
      url: `${API}/widget/api/music/go/${trackId}?server=bilibili`,
    };
    return json(res, 200, { ok: true, track, parts: multi ? 149 : 1, multi, bvid: multi ? 'BV1CAxaeHEeH' : 'BV118411B7XU', host: 'mock' });
  }
  if (p === API + '/_fixture/cover.png') {
    res.setHeader('content-type', 'image/png');
    return fs.createReadStream(COVER_FILE).pipe(res);
  }
  if (p === API + '/_fixture/cover-square.png') {
    res.setHeader('content-type', 'image/png');
    return fs.createReadStream(COVER_SQUARE_FILE).pipe(res);
  }
  if (p === API + '/_fixture/cover-portrait.svg') {
    return text(res, 200, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="#18364a"/><circle cx="180" cy="320" r="140" fill="#537d96"/></svg>', 'image/svg+xml');
  }
  if (p === API + '/_fixture/cover-dark.png') {
    res.setHeader('content-type', 'image/png');
    return fs.createReadStream(COVER_DARK_FILE).pipe(res);
  }
  if (p === API + '/_fixture/cover-light.png') {
    res.setHeader('content-type', 'image/png');
    return fs.createReadStream(COVER_LIGHT_FILE).pipe(res);
  }
  if (p === API + '/_fixture/audio.wav') return serveAudio(req, res);
  if (p === API + '/_fixture/hanaichimonme-cover.jpg') { res.setHeader('content-type', 'image/jpeg'); return fs.createReadStream(path.join(repo, 'docs/player-ui/assets/hanaichimonme-cover.jpg')).pipe(res); }
  if (p === API + '/_fixture/tone.wav' || (p === API + '/_fixture/real-song.m4a' && process.env.RIPPLE_SONG)) {
    const kind = u.searchParams.get('p') || 'steady-bass';
    const realSong = p.endsWith('/real-song.m4a');
    const buf = realSong ? fs.readFileSync(process.env.RIPPLE_SONG) : (SYNTH_WAV[kind] || SYNTH_WAV['steady-bass']);
    res.setHeader('content-type', realSong ? 'audio/mp4' : 'audio/wav');
    res.setHeader('accept-ranges', 'bytes');
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : buf.length - 1;
        res.statusCode = 206;
        res.setHeader('content-range', `bytes ${start}-${end}/${buf.length}`);
        res.setHeader('content-length', String(end - start + 1));
        return res.end(buf.subarray(start, end + 1));
      }
    }
    res.setHeader('content-length', String(buf.length));
    return res.end(buf);
  }
  // 假主题样式表（真实宿主同款端点 /api/apps/theme.css，不需要 surface session）
  if (p === '/api/apps/theme.css') {
    const name = u.searchParams.get('theme') || '';
    const HOSTFIX = { '--bg': '#112233', '--bg-card': '#1B2E44', '--text': '#E8F2FF', '--text-muted': '#8FA8C0', '--text-light': '#8FA8C0', '--accent': '#22AA88', '--border': 'rgba(150,180,220,0.2)' };
    const vars = /dark|midnight/.test(name) ? THEME_VARS.dark : (/hostfix/.test(name) ? HOSTFIX : THEME_VARS.light);
    return text(res, 200, ':root{' + Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') + ';}', 'text/css; charset=utf-8');
  }
  if (p === API + '/widget/api/music/search') {
    searchHits++;
    const kw = u.searchParams.get('keyword') || '';
    const server = u.searchParams.get('server') || '';
    const offset = Math.max(0, Number(u.searchParams.get('offset')) || 0);
    const limit = Math.max(1, Number(u.searchParams.get('limit')) || 30);
    /* B站分P夹具：server=bilibili 时回两条 —— 一条多P（长时长，值得探分P）、
     * 一条单P（短片，不该出现分集入口）。id 形状与真实后端一致。 */
    if (server === 'bilibili' && kw.indexOf('多P') >= 0) {
      const results = [
        { id: 'bilibili:BV1Multi', title: 'B站合集 多P', author: '合集UP', pic: `${API}/_fixture/cover.png`, dur: 6489 * 60, url: `${API}/widget/api/music/go/BV1Multi?server=bilibili`, lrc: '' },
        { id: 'bilibili:BV1Single', title: 'B站单曲', author: '单曲UP', pic: '', dur: 270, url: `${API}/widget/api/music/go/BV1Single?server=bilibili`, lrc: '' },
      ];
      return json(res, 200, { ok: true, results, host: 'mock', total: 2 });
    }
    /* 长标题夹具：尾行红心被挤出主行的回归守（关键词含「长标题」）。
       一条超长 no-wrap 标题 + 两条普通行，比对行高与红心是否同行。 */
    if (kw.indexOf('长标题') >= 0) {
      const results = [
        { id: 'netease:880001', title: '超长标题'.repeat(60), author: '长标题歌手', url: goUrl(880001), pic: '', lrc: '' },
        { id: 'netease:880002', title: '普通标题甲', author: '歌手甲', url: goUrl(880002), pic: '', lrc: '' },
        { id: 'netease:880003', title: '普通标题乙', author: '歌手乙', url: goUrl(880003), pic: '', lrc: '' },
      ];
      return json(res, 200, { ok: true, results, host: 'mock', total: 3 });
    }
    /* 分页夹具：关键词含「分页」时回一套可翻页的数据集（共 75 条，每页 30），
     * 供无限滚动断言；其余关键词保持原来的单条返回（backfill / 跨源歌词等用）。 */
    if (kw.indexOf('分页') >= 0) {
      const TOTAL = 75;
      const n = Math.max(0, Math.min(limit, TOTAL - offset));
      const results = Array.from({ length: n }, (_, i) => {
        const idx = offset + i;
        return { id: `netease:${790000 + idx}`, title: `分页曲目 ${idx + 1}`, author: '分页歌手', url: goUrl(790000 + idx), pic: '', lrc: '' };
      });
      return json(res, 200, { ok: true, results, host: 'mock', total: TOTAL });
    }
    /* 手动匹配候选夹具：关键词含「候选」时按平台各回几条不同结果，
       让 submitLyricMatch 能攒出「多条候选 + 不同来源平台」。 */
    if (kw.indexOf('候选') >= 0) {
      if (server === 'tencent') {
        return json(res, 200, { ok: true, results: [
          { id: 'tencent:9003', title: '候选歌曲 · 腾讯版', author: '候选歌手', url: `${API}/widget/api/music/go/9003?server=tencent`, pic: '', lrc: '' },
        ], host: 'mock', total: 1 });
      }
      if (server === 'netease' || !server) {
        return json(res, 200, { ok: true, results: [
          { id: 'netease:9001', title: '候选歌曲 · 网易甲', author: '候选歌手', url: goUrl(9001), pic: '', lrc: '' },
          { id: 'netease:9002', title: '候选歌曲 · 网易乙', author: '另一歌手', url: goUrl(9002), pic: '', lrc: '' },
        ], host: 'mock', total: 2 });
      }
      return json(res, 200, { ok: true, results: [], host: 'mock', total: 0 });
    }
    return json(res, 200, { ok: true, results: [{ id: `netease:${770000 + kw.length}`, title: `命中 ${kw}`, author: '搜索歌手', url: goUrl(770000 + kw.length), pic: '', lrc: 'http://mock/lrc/' + encodeURIComponent(kw) }], host: 'mock', total: 1 });
  }
  if (p === API + '/widget/api/music/hot') {
    const results = Array.from({ length: 3 }, (_, i) => ({ id: `netease:${780000 + i}`, title: `热门推荐 ${i + 1}`, author: `推荐歌手 ${i + 1}`, url: goUrl(780000 + i), pic: '', lrc: '' }));
    return json(res, 200, { ok: true, results, host: 'mock' });
  }
  if (p === API + '/widget/api/music/charts') {
    return json(res, 200, { ok: true,
      charts: [{ id: '3778678', name: '热歌榜', pic: '', note: '每天更新', kind: 'chart' }],
      sheets: [{ id: '8904187604', name: '超火rap', pic: '', note: '109 首', kind: 'sheet' }],
      host: 'mock' });
  }
  if (p === API + '/widget/api/music/chart-tracks') {
    const id = u.searchParams.get('id') || '0';
    const results = Array.from({ length: 2 }, (_, i) => ({ id: `netease:${id}${i}`, title: `榜单曲 ${i + 1}`, author: '榜单歌手', url: goUrl(`${id}${i}`), pic: '', lrc: '' }));
    return json(res, 200, { ok: true, results, name: '热歌榜', host: 'mock' });
  }
  if (p === API + '/widget/api/music/bili-parts') {
    const bvid = u.searchParams.get('bvid') || '';
    if (bvid === 'BV1Multi') {
      const results = Array.from({ length: 12 }, (_, i) => ({
        id: `bilibili:BV1Multi_${1000 + i}`, title: `分集曲 ${i + 1}`, author: '', pic: '', dur: 240 + i,
        page: i + 1, cid: 1000 + i, url: `${API}/widget/api/music/go/BV1Multi_${1000 + i}?server=bilibili`, lrc: ''
      }));
      return json(res, 200, { ok: true, results, videos: results.length, bvid, host: 'mock' });
    }
    return json(res, 200, { ok: true, results: [{ id: `bilibili:${bvid}_1`, title: '唯 1 集', author: '', pic: '', dur: 270, page: 1, cid: 1, url: `${API}/widget/api/music/go/${bvid}_1?server=bilibili`, lrc: '' }], videos: 1, bvid, host: 'mock' });
  }
  if (p === API + '/widget/api/music/radios') {
    return json(res, 200, { ok: true, results: [
      { id: '1230174483', name: '你，静不下来', pic: '', category: '情感', programCount: 73, subCount: 11595 },
      { id: '1225587488', name: '有声短剧', pic: '', category: '有声书', programCount: 46, subCount: 2097 }
    ], host: 'mock' });
  }
  if (p === API + '/widget/api/music/radio-programs') {
    const rid = u.searchParams.get('radioId') || '0';
    const results = Array.from({ length: 2 }, (_, i) => ({ id: `netease:${rid}0${i}`, title: `电台节目 ${i + 1}`, author: '主播', url: goUrl(`${rid}0${i}`), pic: '', dur: 2900, lrc: '' }));
    return json(res, 200, { ok: true, results, host: 'mock' });
  }
  if (p === API + '/widget/api/music/playlist') {
    const id = u.searchParams.get('id') || '0';
    const tracks = Array.from({ length: 5 }, (_, i) => ({ id: `netease:${id}${i}`, title: `歌单曲目 ${i + 1}`, author: '测试', url: goUrl(`${id}${i}`), pic: '', lrc: '' }));
    const server = u.searchParams.get('server') || 'netease';
    /* id=888 固定返回真名夹具；其余按 id 生成不同名 —— 溢出测试要能造出多个歌单 */
    const meta = id === '888' ? PLAYLIST_META : { name: '歌单 ' + id, creator: 'Can_0201', cover: '', trackCount: 12 };
    return json(res, 200, { ok: true, tracks, host: 'mock', ...(server === 'netease' ? { meta } : {}) });
  }
  if (p === API + '/widget/api/import-file') {
    const src = u.searchParams.get('path') || '';
    const base = path.basename(src);
    return json(res, 200, { ok: true, id: base, name: base.replace(/\.\w+$/, ''), url: WAV_URL, mode: '本地' });
  }
  if (p === API + '/widget/api/scan-folder') {
    // 固定文件夹扫描：返回 3 个本地文件
    const files = Array.from({ length: 3 }, (_, i) => ({ id: `scan-${i + 1}.mp3`, name: `扫描曲目 ${i + 1}`, url: WAV_URL, mode: '本地' }));
    return json(res, 200, { ok: true, files, count: files.length });
  }
  if (p.startsWith(API + '/widget/api/music/go/')) return serveAudio(req, res);
  if (p.startsWith(API + '/widget/media/')) return serveAudio(req, res);
  if (p.startsWith(API + '/')) return json(res, 200, { ok: true });

  // ui/ 静态文件
  if (p.startsWith('/api/apps/hanako-simple-player/ui/')) {
    const rel = decodeURIComponent(p.slice('/api/apps/hanako-simple-player/ui/'.length)) || 'index.html';
    const f = path.join(uiDir, rel);
    if (!f.startsWith(uiDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', f.endsWith('.js') ? 'text/javascript; charset=utf-8' : f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    return fs.createReadStream(f).pipe(res);
  }
  // 直接按路径访问 ui/（页面以 /index.html 打开）
  const f = path.join(uiDir, decodeURIComponent(p === '/' ? 'index.html' : p));
  if (f.startsWith(uiDir) && fs.existsSync(f) && !fs.statSync(f).isDirectory()) {
    res.setHeader('content-type', f.endsWith('.js') ? 'text/javascript; charset=utf-8' : f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    return fs.createReadStream(f).pipe(res);
  }
  res.statusCode = 404; res.end('not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* 页面基址必须走宿主真实 surface 路由（/api/apps/<id>/ui/）：
 * 官方 App SDK 在装配时会断言 location.pathname 落在该前缀下（assertAppUiSurface），
 * 用根路径 /index.html 打开会直接抛错。后端 API 仍是绝对路径，不受影响。 */
const UI_BASE = `${BASE}/api/apps/hanako-simple-player/ui`;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  // 不传 --hide-scrollbars：之前它会藏住滚动条缺陷，等于把这类问题藏起来
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1']
});

const report = { selfCheck: [], wiring: {}, four: {}, darkFallback: {}, runtimeErrors: [], expectedProbes: [], assertions: [], refine: [], narrowSelfCheck: [], theme: {}, ambient: {} };

/* 断言登记：不通过就退非零，结果里逐条列出 */
function assert(name, ok, detail) {
  if (process.argv.includes('--ripple-only') || process.argv.includes('--song-only')) console.log((ok ? 'PASS ' : 'FAIL ') + name);
  report.assertions.push({ name, ok: !!ok, detail: String(detail === undefined ? '' : detail) });
}
/* 预期噪声（文档已记）：降级链的探测性 404（离线库没命中 → 走在线）、
 * 切歌/卸载时 <audio> 主动 abort 媒体请求的 ERR_ABORTED。不计入致命错误，但逐条留档。 */
const EXPECTED_PROBE = /\/(widget\/api\/lrc\/load|widget\/api\/music\/ttml)(\?|$)/;

async function newPage(opts) {
  const page = await browser.newPage();
  if (!(opts && opts.teardown)) {
    const close = page.close.bind(page);
    page.close = async (...args) => {
      // 默认段落本来就隔离卸载；先结束本段音频授权，避免已关闭的 fixture 挡下一段。
      await page.evaluate(async () => { if (window.__playerDebug) await window.__playerDebug.pauseAll(); }).catch(() => {});
      return close(...args);
    };
  }
  /* 段落间夹具隔离：**默认拦掉「页面卸载时的落盘」**。
   * 为什么：page.close() / 换页会触发 pagehide → 旧页面用 sendBeacon / keepalive fetch
   * 异步投递一个 playback-state 快照；它可能**晚于下一段落的 __fixture/reset** 到达，
   * 于是下一段落一进页读到的不是空列表，而是上一段落的当前曲目（实测 flaky：
   * 2d 的 artist-line-inert-without-artist 偶发读到 2c 的「点播歌手」）。
   * 拦法精确：只拦 sendBeacon 与 keepalive fetch —— 这两条正是卸载专用通道；
   * 常规落盘走无 keepalive 的 fetch，不受影响（第 7 段还有该跑的验证）。
   * 第 7 段专测「跨文档落盘→续播」，传 { teardown: true } 关闭拦截。 */
  const allowTeardown = !!(opts && opts.teardown);
  await page.evaluateOnNewDocument((allow) => {
    if (allow) return;
    try { Object.defineProperty(navigator, 'sendBeacon', { value: () => true, configurable: true, writable: true }); } catch (e) {}
    const origFetch = window.fetch;
    window.fetch = function (u, o) {
      if (o && o.keepalive) return Promise.resolve(new Response('{}'));
      return origFetch.apply(this, arguments);
    };
  }, allowTeardown);
  page.on('pageerror', (e) => report.runtimeErrors.push('pageerror: ' + String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const txt = m.text();
    /* 浏览器对 4xx 的固定播报不带 URL，改由 response 监听器带 URL 记录 */
    if (txt.indexOf('Failed to load resource') >= 0) return;
    report.runtimeErrors.push('console: ' + txt);
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const u = r.url();
    (EXPECTED_PROBE.test(u) ? report.expectedProbes : report.runtimeErrors).push(`http ${r.status()} ${u}`);
  });
  page.on('requestfailed', (r) => {
    const err = (r.failure() && r.failure().errorText) || '';
    const line = `reqfail: ${r.url()} ${err}`;
    /* 切歌/卸载时 <audio> 会主动 abort 上一个媒体请求，浏览器记 ERR_ABORTED —— 正常行为 */
    (err === 'net::ERR_ABORTED' ? report.expectedProbes : report.runtimeErrors).push(line);
  });
  await page.evaluateOnNewDocument(() => {
    window.__fixtureTheme = (mode) => {
      const light = { '--bg': '#F8F4ED', '--bg-card': '#FCFAF5', '--text': '#3B3D3F', '--text-muted': '#8E9196', '--text-light': '#6B6F73', '--accent': '#537D96', '--border': 'rgba(122,96,88,0.18)' };
      const dark = { '--bg': '#3B4A54', '--bg-card': '#445560', '--text': '#E1EAF0', '--text-muted': '#9FB1BC', '--text-light': '#9FB1BC', '--accent': '#C99AAF', '--border': 'rgba(170,121,141,0.16)' };
      const vars = mode === 'dark' ? dark : light;
      Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
      document.documentElement.setAttribute('data-theme', mode);
    };
  });
  return page;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tabLabels = (page) => page.$$eval('#listTabs .list-tab', (els) => els.map((e) => e.textContent.trim()));
const rowCount = (page) => page.$$eval('#queueList .q-row', (els) => els.length);
const activeTab = (page) => page.$eval('#listTabs .list-tab.is-active', (e) => e.getAttribute('data-list'));
const rowTitles = (page) => page.$$eval('#queueList .q-row .q-title', (els) => els.map((e) => e.textContent));
const dupUids = (page) => page.evaluate(() => {
  const seen = {}, dup = [];
  document.querySelectorAll('#queueList .q-row').forEach((r) => {
    const u = r.getAttribute('data-uid');
    if (seen[u]) dup.push(u); else seen[u] = 1;
  });
  return dup;
});
/* 切歌单标签：等标签渲染 → 点击 → 等它真的 active。
 * 旧版是「查到就点、查不到就静默跳过」——官方 App SDK 体量大、boot 落点靠后，
 * goto 后立刻调用时标签还没渲染，点击静默落空，后续“等行出现”被上一个列表的行满足，
 * 于是选不中目标曲目（实测 refine-312x494-light-lyrics-off 假失败）。 */
const clickTab = async (page, id) => {
  await page.waitForFunction((listId) => !!document.querySelector('#listTabs .list-tab[data-list="' + listId + '"]'), { timeout: 8000 }, id);
  await page.evaluate((listId) => document.querySelector('#listTabs .list-tab[data-list="' + listId + '"]').click(), id);
  await page.waitForFunction((listId) => {
    const a = document.querySelector('#listTabs .list-tab.is-active');
    return !!a && a.getAttribute('data-list') === listId;
  }, { timeout: 8000 }, id);
};
const geom = (page) => page.evaluate(() => {
  const r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  return { sceneTop: r('sceneTop'), controls: r('controls'), tabs: r('listTabs'), listTop: Math.round(document.getElementById('queueList').getBoundingClientRect().top) };
});

/* 搜索封面与两个侧滑面板：验实际中间帧、同步时钟和反向，不只验 CSS 属性。 */
async function verifySurfaceMotion() {
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await sleep(700);
  await clickTab(page, 'imp:1');
  await page.evaluate(() => document.querySelector('#queueList .q-hit').click());
  await sleep(120);
  const result = await page.evaluate(async () => {
    const $ = (id) => document.getElementById(id), D = window.__playerDebug;
    const tick = () => new Promise((r) => requestAnimationFrame(r));
    const finish = async (...ids) => { await Promise.all(ids.flatMap((id) => $(id).getAnimations().map((a) => a.finished.catch(() => {})))); await tick(); };
    const snapshot = () => {
      const slot = $('searchCoverSlot'), btn = $('searchCoverBtn'), copy = $('ctlTitle').getBoundingClientRect();
      const c = $('controls').getBoundingClientRect(), p = $('playBtn').getBoundingClientRect();
      return { width: slot.getBoundingClientRect().width, titleX: copy.left, inert: slot.inert, disabled: btn.disabled,
        opacity: +getComputedStyle(btn).opacity, searchHidden: $('searchPage').hidden,
        immersive: $('player').getAttribute('data-immersive'), glass: getComputedStyle($('controls'), '::before').backdropFilter, controlsHidden: $('player').getAttribute('data-controls-hidden'),
        centered: Math.abs(p.left + p.width / 2 - c.left - c.width / 2) < 1 };
    };
    const home = snapshot();
    D.openSearch();
    const group = ['searchPage', 'searchCoverSlot', 'searchCoverBtn'].map((id) => $(id).getAnimations()[0]);
    const timing = group.map((a) => ({ start: a.startTime, duration: a.effect.getTiming().duration, easing: a.effect.getTiming().easing }));
    group.forEach((a) => { a.pause(); a.currentTime = 100; });
    const mid = snapshot();
    const before = getComputedStyle($('searchPage')).transform;
    D.closeSearch();
    const reverse = $('searchPage').getAnimations()[0].effect.getKeyframes()[0].transform;
    await finish('searchPage', 'searchCoverSlot', 'searchCoverBtn');
    const closed = snapshot();
    D.openSearch();
    await finish('searchPage', 'searchCoverSlot', 'searchCoverBtn');
    const opened = snapshot();
    const image = $('searchCoverImg'), b = image.getBoundingClientRect(), style = getComputedStyle(image);
    const cover = { shown: !image.hidden, crop: style.objectFit, position: style.objectPosition, width: b.width, height: b.height,
      between: $('searchEntryBtn').getBoundingClientRect().right <= b.left && b.right <= $('ctlTitle').getBoundingClientRect().left };
    const previousSrc = image.getAttribute('src');
    $('nextBtn').click(); await new Promise((r) => setTimeout(r, 120));
    const changed = { previousSrc, currentSrc: image.getAttribute('src'), expected: D.currentTrack().pic,
      naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
    $('searchCoverBtn').click();
    const leaving = snapshot();
    await finish('searchPage', 'searchCoverSlot', 'searchCoverBtn');
    const byCover = snapshot();
    // 已有搜索详情也直接回播放；先收再马上重新打开，旧 finished 不能卸载新页。
    D.openSearch(); D.renderResults([{ id: 'netease:780001', title: '封面测试结果', author: '测试', url: '/unused' }]);
    await finish('searchPage', 'searchCoverSlot', 'searchCoverBtn');
    $('searchCoverBtn').click(); D.openSearch();
    await finish('searchPage', 'searchCoverSlot', 'searchCoverBtn');
    const reopened = snapshot();
    D.closeSearch(); await finish('searchPage', 'searchCoverSlot', 'searchCoverBtn');
    // 一首确无封面的歌曲；无效图片用同源 WAV，HTTP 200 但图片解码失败。
    D.currentTrack().pic = ''; D.openSearch(); await finish('searchPage', 'searchCoverSlot', 'searchCoverBtn');
    const fallback = image.hidden && !$('searchCoverBtn').classList.contains('has-cover');
    D.closeSearch(); await finish('searchPage', 'searchCoverSlot', 'searchCoverBtn');
    D.currentTrack().pic = '/api/apps/hanako-simple-player/routes/_fixture/audio.wav';
    D.openSearch(); await finish('searchPage', 'searchCoverSlot', 'searchCoverBtn');
    const brokenFallback = image.hidden && !$('searchCoverBtn').classList.contains('has-cover');
    D.closeSearch(); await finish('searchPage', 'searchCoverSlot', 'searchCoverBtn');
    $('queueBtn').click();
    const queueTiming = $('queue').getAnimations()[0].effect.getTiming();
    const qa = $('queue').getAnimations()[0]; qa.pause(); qa.currentTime = 100;
    const qb = getComputedStyle($('queue')).transform;
    $('queueBtn').click();
    const qr = $('queue').getAnimations()[0].effect.getKeyframes()[0].transform;
    const scrimShown = getComputedStyle($('drawerScrim')).display !== 'none';
    await finish('queue', 'drawerScrim');
    const queueClosed = getComputedStyle($('queue')).display === 'none';
    return { home, mid, before, reverse, closed, opened, cover, changed, leaving, byCover, reopened, fallback, brokenFallback,
      timing, queueTiming, queueBefore: qb, queueReverse: qr, scrimShown, queueClosed };
  });
  assert('search-cover-home-has-no-slot-or-focus', result.home.width === 0 && result.home.inert && result.home.disabled, JSON.stringify(result.home));
  assert('surface-motion-unified-clock-and-easing', result.timing.every((t) => t.start === result.timing[0].start && t.duration === 320 && t.easing === result.timing[0].easing) && result.queueTiming.duration === 320 && result.queueTiming.easing === result.timing[0].easing, JSON.stringify(result.timing));
  assert('search-cover-grows-and-moves-title', result.mid.width > 0 && result.mid.width < 44 && result.mid.titleX > result.home.titleX && result.mid.opacity > 0 && result.mid.opacity < 1, JSON.stringify(result.mid));
  assert('search-cover-keeps-play-centered', [result.home, result.mid, result.opened, result.closed].every((s) => s.centered), JSON.stringify(result));
  assert('search-motion-reverses-from-visible-frame', result.before === result.reverse, JSON.stringify({ before: result.before, reverse: result.reverse }));
  assert('search-cover-exit-finishes-with-page', result.closed.searchHidden && result.closed.width === 0 && result.closed.titleX === result.home.titleX, JSON.stringify(result.closed));
  assert('search-cover-is-centered-square-between-search-and-title', result.cover.shown && result.cover.crop === 'cover' && result.cover.position === '50% 50%' && result.cover.width === 32 && result.cover.height === 32 && result.cover.between, JSON.stringify(result.cover));
  assert('search-cover-follows-track-and-crops-landscape', result.changed.previousSrc !== result.changed.currentSrc && result.changed.naturalWidth > result.changed.naturalHeight, JSON.stringify(result.changed));
  assert('search-exit-keeps-solid-controls-through-real-animation', result.leaving.immersive === '0' && result.leaving.glass === 'none' && result.leaving.controlsHidden === '0', JSON.stringify(result.leaving));
  assert('search-cover-click-closes-with-immediate-focus-removal', result.leaving.inert && result.leaving.disabled && !result.leaving.searchHidden && result.byCover.searchHidden && result.byCover.width === 0, JSON.stringify(result.byCover));
  assert('search-cover-reopen-cancels-stale-unmount', !result.reopened.searchHidden && result.reopened.width === 44, JSON.stringify(result.reopened));
  assert('search-cover-missing-and-broken-image-fallback', result.fallback && result.brokenFallback, JSON.stringify({ missing: result.fallback, broken: result.brokenFallback }));
  assert('queue-motion-reverses-and-finishes-with-scrim', result.queueBefore === result.queueReverse && result.scrimShown && result.queueClosed, JSON.stringify(result));
  // 留下深浅两张实际控制条截图，检查裁切、间距与文字收缩。
  await page.evaluate((pic) => { window.__playerDebug.currentTrack().pic = pic; window.__playerDebug.openSearch(); }, COVER);
  await sleep(380);
  for (const tone of ['light', 'dark']) {
    await page.evaluate((t) => window.__fixtureTheme(t), tone);
    await (await page.$('#controls')).screenshot({ path: path.join(outDir, `search-cover-${tone}.png`) });
  }
  // 窄一点的宽窗也要让文字收缩，封面/红心不得碰到播放模式。
  await page.setViewport({ width: 720, height: 700, deviceScaleFactor: 1 });
  await page.evaluate(() => window.__playerDebug.openSearch()); await sleep(380);
  const tight = await page.evaluate(() => {
    const heart = document.getElementById('favBtn').getBoundingClientRect(), mode = document.getElementById('modeBtn').getBoundingClientRect();
    return { gap: mode.left - heart.right, copyWidth: document.getElementById('ctlTitle').getBoundingClientRect().width };
  });
  assert('search-cover-fits-small-wide-window', tight.gap >= 0 && tight.copyWidth > 0, JSON.stringify(tight));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const reduced = await page.evaluate(async () => {
    window.__playerDebug.closeSearch();
    const animations = ['searchPage', 'searchCoverSlot', 'searchCoverBtn'].flatMap((id) => document.getElementById(id).getAnimations());
    const keys = animations.flatMap((a) => a.effect.getKeyframes().flatMap(Object.keys));
    await Promise.all(animations.map((a) => a.finished));
    return { keys, hidden: document.getElementById('searchPage').hidden };
  });
  assert('surface-motion-reduced-is-opacity-only', reduced.hidden && !reduced.keys.some((k) => ['transform', 'width', 'marginRight'].includes(k)), JSON.stringify(reduced));
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.waitForFunction(() => document.getElementById('player').getAttribute('data-layout') === 'long');
  await page.evaluate(() => window.__playerDebug.openSearch());
  assert('search-cover-hidden-in-card', await page.$eval('#searchCoverSlot', (el) => getComputedStyle(el).display === 'none'));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.evaluate(() => window.__playerDebug.closeSearch()); await sleep(380);
  await page.setViewport({ width: 531, height: 451, deviceScaleFactor: 1 });
  await page.waitForFunction(() => document.getElementById('player').getAttribute('data-layout') === 'compact');
  await page.evaluate(() => {
    document.getElementById('queueBtn').click();
    for (const id of ['queue', 'scene']) for (const a of document.getElementById(id).getAnimations()) { a.pause(); a.currentTime = 100; }
  });
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.waitForFunction(() => document.getElementById('player').getAttribute('data-layout') === 'wide');
  await page.evaluate(() => document.getElementById('queueBtn').click()); await sleep(380);
  const switched = await page.$eval('#scene', (el) => ({ opacity: +getComputedStyle(el).opacity, transform: getComputedStyle(el).transform, animations: el.getAnimations().length }));
  assert('surface-motion-layout-switch-cleans-obsolete-scene', switched.opacity === 1 && switched.transform === 'none' && switched.animations === 0, JSON.stringify(switched));
  await page.close();
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
}

/* 真实媒体时钟驱动的歌词验收；--lyrics-only 可单独运行，完整验收也包含它。 */
async function verifyLyricFlow() {
  await fetch(`${BASE}${API}/__fixture/reset?mode=lyric-flow&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 820, height: 700, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await sleep(700);
  await clickTab(page, 'imp:1');
  await page.evaluate(() => document.querySelector('#queueList .q-hit').click());
  await page.waitForFunction(() => document.querySelectorAll('.lyric-line').length === 7);
  const info = () => page.evaluate(() => window.__playerDebug.lyricFlowState());
  async function seekTo(t) {
    await page.evaluate((t) => { document.querySelector('audio').currentTime = t; }, t);
    await page.waitForFunction(() => !document.querySelector('audio').seeking);
    await sleep(80);
  }
  await seekTo(4.2);
  const flow = await page.evaluate(() => new Promise((resolve) => {
    const frames = [], start = performance.now();
    function sample() {
      const st = window.__playerDebug.lyricFlowState();
      frames.push({ focus: st.focus, position: st.position, index: st.index, height: document.querySelector('.lyric-line').offsetHeight });
      if (performance.now() - start < 2100) requestAnimationFrame(sample); else resolve(frames);
    }
    requestAnimationFrame(sample);
  }));
  const steps = flow.slice(1).map((f, i) => ({ focus: f.focus - flow[i].focus, pos: f.position - flow[i].position }));
  assert('lyrics-flow-through-phrase-and-boundary', flow.length > 30 && flow[0].index === 1 && flow.at(-1).index === 2 && steps.every((s) => s.focus >= -0.001 && s.focus < .2) && steps.filter((s) => s.focus > .0001).length > steps.length * .9,
    JSON.stringify({ frames: flow.length, first: flow[0], last: flow.at(-1), stalled: steps.filter((s) => s.focus <= .0001).length, maxStep: Math.max(...steps.map((s) => s.focus)) }));
  assert('lyrics-wave-keeps-row-geometry-stable', new Set(flow.map((f) => f.height)).size === 1, JSON.stringify([...new Set(flow.map((f) => f.height))]));
  assert('lyrics-flow-preserves-subpixel-motion', steps.some((s) => s.pos > 0 && Math.abs(s.pos - Math.round(s.pos)) > .01), JSON.stringify(steps.slice(0, 6)));
  await page.evaluate(() => document.querySelector('audio').pause());
  await sleep(60);
  const paused = await info();
  await sleep(350);
  const frozen = await info();
  await page.evaluate(() => window.__playerDebug.requestPlay('fixture'));
  await sleep(220);
  const resumed = await info();
  assert('lyrics-pause-resume-keeps-phase', !frozen.raf && Math.abs(frozen.focus - paused.focus) < .001 && Math.abs(frozen.position - paused.position) < .01 && resumed.focus > frozen.focus && resumed.focus - frozen.focus < .5,
    JSON.stringify({ paused, frozen, resumed }));
  await page.evaluate(() => document.querySelector('audio').pause());
  await seekTo(5);
  const beforeResize = await info();
  await page.setViewport({ width: 1120, height: 940, deviceScaleFactor: 1 });
  await sleep(160);
  const afterResize = await info();
  const centerError = await page.evaluate(() => {
    const row = document.querySelector('.lyric-line.is-current').getBoundingClientRect(), wrap = document.querySelector('#lyrics').getBoundingClientRect();
    return Math.abs((row.top + row.bottom) / 2 - (wrap.top + wrap.bottom) / 2);
  });
  assert('lyrics-same-phrase-resize-recenters-with-readable-size-cap', beforeResize.index === afterResize.index && afterResize.height > beforeResize.height && afterResize.font <= 19 / 1.15 + .1 && centerError < 2, JSON.stringify({ beforeResize, afterResize, centerError }));

  for (const [w, h] of [[820, 700], [465, 930], [380, 430], [312, 494], [719, 559], [720, 560]]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await sleep(120);
    await seekTo(3);
    const fit = await page.evaluate(() => {
      const wrap = document.querySelector('#lyrics').getBoundingClientRect();
      const texts = [...document.querySelectorAll('.lyric-text')].map((el) => el.getBoundingClientRect());
      const title = document.querySelector('#trackTitle');
      title.textContent = '一个很长很长的歌名，用来验证超长标题不会占掉歌词空间'.repeat(4);
      const current = document.querySelector('.lyric-line.is-current').getBoundingClientRect();
      const currentText = document.querySelector('.lyric-line.is-current .lyric-text');
      const baseFont = parseFloat(getComputedStyle(currentText).fontSize);
      const peakFont = baseFont * new DOMMatrix(getComputedStyle(currentText).transform).a;
      return { ...window.__playerDebug.lyricFlowState(), layout: document.querySelector('#player').getAttribute('data-layout'), fontFamily: getComputedStyle(currentText).fontFamily, bodyFontFamily: getComputedStyle(document.body).fontFamily, peakFont, actualHeight: document.querySelector('#lyricWrap').clientHeight, centerError: Math.abs((current.top + current.bottom - wrap.top - wrap.bottom) / 2), overlaps: texts.some((r, i) => i && r.top < texts[i - 1].bottom - .5), overflow: texts.some((r) => r.right > wrap.right - 1 || r.left < wrap.left - .5), wrapped: document.querySelectorAll('.lyric-text')[1].offsetHeight > parseFloat(getComputedStyle(document.querySelector('.lyric-line')).lineHeight) * 1.3, titleHeight: title.clientHeight, titleFont: parseFloat(getComputedStyle(title).fontSize), queueTitleFont: parseFloat(getComputedStyle(document.querySelector('.queue-title')).fontSize), titleFull: title.title.length > 0 };
    });
    assert(`lyrics-readable-and-wave-fits-${w}x${h}`, fit.font >= 11 && fit.height === fit.actualHeight && fit.centerError < 2 && !fit.overlaps && !fit.overflow && fit.wrapped && fit.titleHeight <= fit.titleFont * 1.3 && fit.titleFull, JSON.stringify(fit));
    assert(`lyrics-peak-stays-three-pixels-below-title-${w}x${h}`, fit.font >= 11 && fit.peakFont <= fit.titleFont - 2.9 && fit.titleFont > fit.queueTitleFont && fit.fontFamily === fit.bodyFontFamily && (fit.layout === 'wide' ? fit.titleFont >= 20 && fit.titleFont <= 22 : Math.abs(fit.titleFont - 18) < .1), JSON.stringify({ peakFont: fit.peakFont, titleFont: fit.titleFont, queueTitleFont: fit.queueTitleFont, fontFamily: fit.fontFamily, layout: fit.layout }));
    if ([820, 465, 380].includes(w)) {
      for (const theme of ['light', 'dark']) {
        await page.evaluate((t) => window.__fixtureTheme(t), theme);
        await page.screenshot({ path: path.join(outDir, `lyric-flow-${w}x${h}-${theme}.png`) });
      }
    }
  }
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await sleep(120);
  const split = await page.$eval('#splitHandle', (el) => { const b = el.getBoundingClientRect(); return { x: b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.move(split.x, split.y);
  await page.mouse.down();
  await page.mouse.move(split.x, 180, { steps: 10 });
  await page.mouse.up();
  await sleep(160);
  const dragged = await info();
  assert('lyrics-split-keeps-reading-area-and-remeasures', dragged.height >= 127 && dragged.height < 230 && Math.abs(dragged.position - (dragged.centers[1] - dragged.height / 2)) < 2, JSON.stringify(dragged));

  await page.evaluate(() => {
    window.__playerDebug.requestPlay('fixture');
    document.querySelector('#lyricWrap').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }));
    document.querySelector('#lyrics').scrollTop += 80;
  });
  const browsed = await info();
  await sleep(400);
  const stayed = await info();
  assert('lyrics-flow-does-not-steal-browsing', !stayed.follow && !stayed.raf && Math.abs(stayed.position - browsed.position) < 1, JSON.stringify({ browsed, stayed }));
  await sleep(3300);
  assert('lyrics-flow-resumes-after-browsing', (await info()).follow && (await info()).raf, JSON.stringify(await info()));

  /* 回位必须是「滑」而不是「跳」：中途要有若干中间位置。 */
  await seekTo(3.4);
  await page.evaluate(() => {
    document.querySelector('#lyricWrap').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }));
    document.querySelector('#lyrics').scrollTop -= 150;
  });
  await sleep(200);
  const awayFromLine = await info();
  const backCurve = await page.evaluate(() => new Promise((resolve) => {
    const frames = [], start = performance.now();
    function sample() {
      const st = window.__playerDebug.lyricFlowState();
      frames.push({ t: Math.round(performance.now() - start), pos: Math.round(st.position * 100) / 100, follow: st.follow });
      if (performance.now() - start < 4200) requestAnimationFrame(sample); else resolve(frames);
    }
    requestAnimationFrame(sample);
  }));
  const backStart = backCurve.findIndex((f) => f.follow);
  const backRamp = backStart < 0 ? [] : backCurve.filter((f) => f.t >= backCurve[backStart].t && f.t <= backCurve[backStart].t + 400);
  const backMid = backRamp.find((f) => f.t >= backCurve[backStart].t + 150);
  const backEnd = backCurve[backCurve.length - 1];
  assert('lyrics-bounce-back-is-animated',
    !awayFromLine.follow && backStart > 0 && backRamp.length >= 4 && new Set(backRamp.map((f) => Math.round(f.pos))).size >= 4
      && !!backMid && Math.abs(backMid.pos - backEnd.pos) > 8 && backEnd.follow,
    JSON.stringify({ awayFromLine: { follow: awayFromLine.follow, position: awayFromLine.position }, backStart, backEnd, backMid, ramp: backRamp.map((f) => [f.t, f.pos]) }));

  /* 点歌词跳转也要有动画：从当前句滑到目标句，不能瞬移。 */
  await seekTo(15);
  const beforeJump = await info();
  const jumpCurve = await page.evaluate(() => new Promise((resolve) => {
    const frames = [], start = performance.now();
    const el = document.querySelector('.lyric-line[data-i="0"] .lyric-text');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    function sample() {
      const st = window.__playerDebug.lyricFlowState();
      frames.push({ t: Math.round(performance.now() - start), pos: Math.round(st.position * 100) / 100, index: st.index, raf: st.raf, follow: st.follow });
      if (performance.now() - start < 900) requestAnimationFrame(sample); else resolve(frames);
    }
    requestAnimationFrame(sample);
  }));
  const jumpEnd = jumpCurve[jumpCurve.length - 1];
  const jumpRamp = jumpCurve.filter((f) => f.t <= 400);
  const jumpMid = jumpCurve.find((f) => f.t >= 150);
  assert('lyrics-click-line-jumps-with-animation',
    Math.abs(beforeJump.position - jumpEnd.pos) > 40 && jumpEnd.index === 0 && jumpEnd.follow
      && new Set(jumpRamp.map((f) => Math.round(f.pos))).size >= 4 && !!jumpMid && Math.abs(jumpMid.pos - jumpEnd.pos) > 8,
    JSON.stringify({ beforeJump: beforeJump.position, jumpEnd, jumpMid, ramp: jumpRamp.map((f) => [f.t, f.pos]) }));

  /* 松手事件丢失（在卡片/窗口外松手、宿主吞掉 pointerup）不能让跟随永久卡死。 */
  await seekTo(3.4);
  await page.evaluate(() => {
    const el = document.querySelector('.lyric-line.is-current') || document.querySelector('.lyric-line');
    const b = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'mouse', button: 0, buttons: 1, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }));
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'mouse', buttons: 1, clientX: b.left + b.width / 2 + 40, clientY: b.top + b.height / 2 }));
  });
  await sleep(200);
  const pressedNoUp = await info();
  await sleep(3600);
  const healed = await info();
  /* 期望落点 = 当前插值句中心 - 半屏（和 lyricCenterAt 同口径）。 */
  const healedN = Math.max(0, Math.min(healed.centers.length - 1, healed.focus));
  const healedA = Math.floor(healedN), healedB = Math.min(healedA + 1, healed.centers.length - 1);
  const healedCenter = healedA === healedB ? healed.centers[healedA]
    : healed.centers[healedA] + (healed.centers[healedB] - healed.centers[healedA]) * (healedN - healedA);
  assert('lyrics-lost-pointerup-self-heals',
    !pressedNoUp.follow && healed.follow && healed.raf && Math.abs(healed.position - (healedCenter - healed.height / 2)) < 10,
    JSON.stringify({ pressedNoUp: { follow: pressedNoUp.follow, position: pressedNoUp.position }, healed: { follow: healed.follow, raf: healed.raf, position: healed.position, target: healedCenter - healed.height / 2, focus: healed.focus } }));

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await sleep(80);
  const reduced = await page.evaluate(() => ({ ...window.__playerDebug.lyricFlowState(), transforms: [...document.querySelectorAll('.lyric-text')].map((e) => getComputedStyle(e).transform) }));
  assert('lyrics-reduced-motion-stops-flow-and-scaling', !reduced.raf && reduced.transforms.every((t) => t === 'matrix(1, 0, 0, 1, 0, 0)' || t === 'none'), JSON.stringify(reduced));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.evaluate(() => document.querySelector('#scene').style.transform = 'translateX(200vw)');
  await sleep(100);
  assert('lyrics-offscreen-stops-flow', !(await info()).raf, JSON.stringify(await info()));
  await page.evaluate(() => document.querySelector('#scene').style.transform = 'none');
  await sleep(100);
  await seekTo(8.1);
  const bilingual = await info();
  assert('lyrics-same-timestamp-lines-have-one-semantic-current', bilingual.index === 4 && Number.isFinite(bilingual.focus) && (await page.$$eval('.lyric-line[aria-current="true"]', (els) => els.length)) === 1, JSON.stringify(bilingual));
  await page.setViewport({ width: 820, height: 700, deviceScaleFactor: 1 });
  await sleep(100);
  await seekTo(6);
  await page.evaluate(() => document.querySelector('#queueBtn').click());
  await sleep(100);
  // 宽窗抽屉只盖住阅读列的一部分，露出的歌词必须继续逐帧流动。
  assert('lyrics-visible-behind-drawer-keeps-frames', (await info()).raf, JSON.stringify(await info()));
  await page.evaluate(() => document.querySelector('#queueBtn').click());
  await sleep(350);
  await page.evaluate(() => window.__playerDebug.openSearch());
  await sleep(100);
  assert('lyrics-covered-by-search-stops-frames', !(await info()).raf, JSON.stringify(await info()));
  await page.evaluate(() => document.querySelector('#searchEntryBtn').click());
  await sleep(350);
  assert('lyrics-returning-from-overlay-resumes-frames', (await info()).raf, JSON.stringify(await info()));
  await seekTo(16);
  const gap = await info();
  await sleep(220);
  assert('lyrics-long-instrumental-holds-until-upcoming-phrase', gap.index === 5 && gap.focus === 5 && (await info()).focus === 5, JSON.stringify(gap));
  await seekTo(27.2);
  const last = await info();
  assert('lyrics-last-phrase-has-finite-position-and-stops-frames', last.index === 6 && last.focus === 6 && !last.raf && Number.isFinite(last.position), JSON.stringify(last));
  await page.close();
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
}

/* 同一段真媒体时钟对照：rAF 采样只读行内样式，不读布局，避免探针自己迫使重排。
 * CDP 时间仅作为本机诊断记录，不拿机器相关的毫秒数作回归门槛。 */
async function verifyLyricPerformance() {
  await fetch(`${BASE}${API}/__fixture/reset?mode=lyric-flow&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/standalone.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await sleep(700);
  await clickTab(page, 'imp:1');
  await page.evaluate(() => document.querySelector('#queueList .q-hit').click());
  await page.waitForFunction(() => document.querySelectorAll('.lyric-line').length === 7);
  const cdp = await page.target().createCDPSession();
  await cdp.send('Performance.enable');
  if (process.env.LYRIC_PERF_DISABLE_EQ === '1') await page.addStyleTag({ content: '.q-eq path, .q-eq > span { animation: none !important; }' });
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  async function sample(open, name) {
    await page.evaluate(async open => {
      const a = document.querySelector('audio'), p = document.getElementById('player');
      a.pause(); a.currentTime = 3.4;
      await new Promise(resolve => a.addEventListener('seeked', resolve, { once: true }));
      if ((p.getAttribute('data-drawer') === '1') !== open) document.getElementById('queueBtn').click();
    }, open);
    await sleep(400); // 表面入/退场不混入稳态测量
    await page.evaluate(() => window.__playerDebug.requestPlay('fixture'));
    if (process.env.LYRIC_PERF_TRACE === '1') await page.tracing.start({ path: path.join(outDir, 'trace-' + name + '.json'), categories: ['devtools.timeline'] });
    const before = await metrics();
    const frames = await page.evaluate(() => new Promise(resolve => {
      const line = document.querySelector('.lyric-line[data-i="2"]'), a = document.querySelector('audio');
      const frames = [], start = performance.now();
      function tick(now) {
        frames.push({ at: now, scale: line.style.getPropertyValue('--lyric-scale'), media: a.currentTime });
        if (now - start < 1800) requestAnimationFrame(tick); else resolve(frames);
      }
      requestAnimationFrame(tick);
    }));
    const after = await metrics();
    const trace = process.env.LYRIC_PERF_TRACE === '1' ? JSON.parse(Buffer.from(await page.tracing.stop()).toString('utf8')).traceEvents : null;
    const paint = trace ? trace.filter(e => e.name === 'Paint' && e.ph === 'X') : null;
    const geometry = await page.evaluate(() => {
      const d = window.__playerDebug.lyricFlowState();
      return { raf: d.raf, width: d.width, height: d.height, position: d.position, focus: d.focus };
    });
    await page.evaluate(() => document.querySelector('audio').pause());
    const intervals = frames.slice(1).map((f, i) => f.at - frames[i].at).sort((a, b) => a - b);
    const changed = frames.slice(1).filter((f, i) => f.scale !== frames[i].scale).length;
    return {
      frames: frames.length, changed, movingRatio: changed / Math.max(1, frames.length - 1),
      medianFrameMs: intervals[Math.floor(intervals.length / 2)], p95FrameMs: intervals[Math.floor(intervals.length * .95)],
      mediaAdvance: frames.at(-1).media - frames[0].media, geometry,
      paint: paint ? { count: paint.length, durationMs: paint.reduce((sum, e) => sum + (e.dur || 0), 0) / 1000 } : null,
      metrics: Object.fromEntries(['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration']
        .map(key => [key, +(after[key] - before[key]).toFixed(6)]))
    };
  }
  const closed = await sample(false, 'closed'), opened = await sample(true, 'opened'), reclosed = await sample(false, 'reclosed');
  for (const [name, s] of Object.entries({ closed, opened, reclosed })) {
    assert('lyrics-perf-' + name + '-updates-each-frame', s.frames > 30 && s.mediaAdvance > 1.5 && s.movingRatio > .9,
      JSON.stringify(s));
  }
  assert('lyrics-drawer-preserves-reading-geometry', closed.geometry.width === opened.geometry.width && closed.geometry.height === opened.geometry.height,
    JSON.stringify({ closed: closed.geometry, opened: opened.geometry }));
  assert('lyrics-drawer-has-no-per-frame-layout', opened.metrics.LayoutCount < opened.frames / 4, JSON.stringify(opened.metrics));
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await sleep(150);
  const long = await sample(false, 'long-line');
  const wrapped = await page.$eval('.lyric-line[data-i="1"] .lyric-text', el => el.offsetHeight > parseFloat(getComputedStyle(el).lineHeight) * 2);
  assert('lyrics-long-wrapped-line-updates-each-frame', wrapped && long.frames > 30 && long.movingRatio > .9, JSON.stringify(long));
  assert('lyrics-long-card-has-no-per-frame-layout', long.metrics.LayoutCount < long.frames / 4, JSON.stringify(long.metrics));
  await page.evaluate(() => window.__playerDebug.requestPlay('fixture'));
  await sleep(100);
  const layersOn = await page.$$eval('.lyric-line.is-flowing', els => els.length);
  await page.evaluate(() => document.querySelector('audio').pause());
  const layersOff = await page.$$eval('.lyric-line.is-flowing', els => els.length);
  assert('lyrics-compositor-hints-are-bounded-and-release-on-pause', layersOn > 0 && layersOn <= 10 && layersOff === 0, JSON.stringify({ layersOn, layersOff }));
  const eq = await page.evaluate(() => {
    const eq = document.querySelector('.q-row.is-current .q-eq');
    return { paths: eq.querySelectorAll('path').length, svgTransforms: [...eq.querySelectorAll('path')].map(el => getComputedStyle(el).transform), animations: eq.getAnimations({ subtree: true }).length };
  });
  assert('queue-equalizer-retains-three-svg-strokes-without-path-animation', eq.paths === 3 && eq.svgTransforms.every(t => t === 'none') && eq.animations === 3, JSON.stringify(eq));
  await page.setViewport({ width: 312, height: 494, deviceScaleFactor: 1 });
  await sleep(150);
  await page.evaluate(() => { window.__playerDebug.requestPlay('fixture'); document.getElementById('queueBtn').click(); });
  await sleep(100);
  const covered = await page.evaluate(() => ({ page: document.getElementById('player').getAttribute('data-page'), raf: window.__playerDebug.lyricFlowState().raf }));
  assert('lyrics-compact-queue-replaces-scene-and-stops-frames', covered.page === 'queue' && !covered.raf, JSON.stringify(covered));
  report.lyricPerformance = { closed, opened, reclosed, long, compact: covered, eqDisabled: process.env.LYRIC_PERF_DISABLE_EQ === '1', probe: 'headless Chrome, synthetic silent media, CSS scale sample without layout reads; CDP renderer metrics' };
  await cdp.detach();
  await page.close();
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
}

/* 慢歌：时间来自用户反馈的 12.55→24.81s 句间距；外部 LRC 仅由本地环境变量读取，
 * 不进入生产 ui/ 或发布包。几何采样用于检查亚像素连续性，不能充当无扰动性能测量。 */
async function verifySlowLyricFlow() {
  await fetch(`${BASE}${API}/__fixture/reset?mode=lyric-slow&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/standalone.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await sleep(700);
  await clickTab(page, 'imp:1');
  await page.evaluate(() => document.querySelector('#queueList .q-hit').click());
  await page.waitForFunction(() => document.querySelectorAll('.lyric-line').length >= 6);
  await page.evaluate(async () => {
    const a = document.querySelector('audio'); a.pause(); a.currentTime = 21.5;
    await new Promise(resolve => a.addEventListener('seeked', resolve, { once: true }));
    await window.__playerDebug.requestPlay('fixture');
  });
  const curve = await page.evaluate(() => new Promise(resolve => {
    const frames = [], line = document.querySelector('.lyric-line[data-i="3"]'), a = document.querySelector('audio');
    const start = performance.now();
    function tick(now) {
      const r = line.getBoundingClientRect();
      frames.push({ at: now, media: a.currentTime, center: (r.top + r.bottom) / 2 });
      if (now - start < 2400) requestAnimationFrame(tick); else resolve(frames);
    }
    requestAnimationFrame(tick);
  }));
  const steps = curve.slice(1).map((f, i) => f.center - curve[i].center);
  const fit = await page.$eval('.lyric-line[data-i="3"] .lyric-text', el => ({ height: el.offsetHeight, lineHeight: parseFloat(getComputedStyle(el).lineHeight) }));
  const summary = { frames: curve.length, moving: steps.filter(s => Math.abs(s) > .00001).length,
    maxStepPx: Math.max(...steps.map(Math.abs)), travelPx: curve[0].center - curve.at(-1).center,
    firstMedia: curve[0].media, lastMedia: curve.at(-1).media, fit, externalLrc: !!process.env.LYRIC_PERF_LRC };
  assert('lyrics-slow-bilingual-long-line-is-wrapped', fit.height > fit.lineHeight * 1.5, JSON.stringify(summary));
  assert('lyrics-slow-bilingual-line-moves-at-subpixel-steps', curve.length > 60 && summary.moving > steps.length * .9 && summary.travelPx > 2 && summary.maxStepPx < 2
    && steps.every(s => s < .01) && steps.some(s => Math.abs(s) > .01 && Math.abs(s - Math.round(s)) > .01), JSON.stringify(summary));
  fs.writeFileSync(path.join(outDir, 'slow-lyric-curve.json'), JSON.stringify({ summary, curve }, null, 2));
  await page.screenshot({ path: path.join(outDir, 'slow-bilingual-1040x780.png') });
  report.slowLyricFlow = summary;
  await page.close();
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
}
async function verifyCoverFill() {
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const bili = (id, title, list = 'imp:1') => ({ id: 'bilibili:' + id, name: title, pic: '', list, mode: '在线', url: WAV_URL });
  const id = 'bilibili:BV16XpM6EEtF_1';
  persistedPlaylist = [bili('BV16XpM6EEtF_1', '周杰伦 - 稻香'), bili('BV16XpM6EEtF_2', '周杰伦 - 枫'), bili('BV16XpM6EEtF_3', '周杰伦 - 稻香 (Live)'),
    bili('BV16XpM6EEtF_1', '周杰伦 - 稻香', 'fav'), bili('BV16XpM6EEtF_1', '周杰伦 - 稻香', 'recent'),
    { ...bili('BV16XpM6EEtF_4', '周杰伦 - 稻香'), pic: COVER },
    { id: 'netease:1', name: '网易曲目', pic: COVER, list: 'imp:1', mode: '在线', url: WAV_URL }];
  coverRequests = []; coverFail = coverImageBad = false; coverDelay = 0;
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__playerDebug && document.querySelector('#listTabs .list-tab[data-list="imp:1"]'));
  await clickTab(page, 'imp:1');
  const clean = await page.evaluate(() => ['周杰伦 - 枫', '周杰伦 - 默', '周杰伦 - 扯', '蔡依林、周杰伦 - 布拉格广场', '纯音乐 2011 09 07 今日から思い出 (从今天起成为回忆)', '周杰伦 - 稻香 (Live)'].map(window.__playerDebug.cleanCoverQuery));
  assert('cover-clean-keeps-single-character-songs', clean.slice(0, 3).map(q => q.song).join(',') === '枫,默,扯');
  assert('cover-clean-preserves-multiple-artists', clean[3].artists.join(',') === '蔡依林,周杰伦');
  assert('cover-clean-aimer-dates-translations-and-instrumental-heading', clean[4].song === '今日から思い出' && clean[4].ok);
  assert('cover-clean-skips-live-versions', !clean[5].ok);
  const picked = await page.evaluate(() => {
    const artist = { id: 6452, name: '周杰伦' }, d = window.__playerDebug;
    const s = { title: '稻香', artists: [artist], albumId: 2, album: '魔杰座', pic: '/original', published: 2008 };
    const songs = [{ ...s, artists: [{ id: 1, name: '翻唱者' }], album: '翻唱', published: 1990 }, { ...s, album: '演唱会', published: 2000 }, { ...s, album: '精选集', published: 1999 }, { ...s, album: '魔杰座再版', published: 2020 }, s];
    return [d.pickCoverMatch('周杰伦 - 稻香', artist, songs), d.pickCoverMatch('周杰伦、陈奕迅 - 稻香', artist, songs), d.pickCoverMatch('周杰伦 - 稻香 (Live)', artist, songs)];
  });
  assert('cover-match-selects-original-before-covers-live-compilation-reissue', picked[0].album === '魔杰座' && !picked[1] && !picked[2]);
  await page.click('#importBtn'); await page.click('[data-import="covers"]');
  assert('cover-menu-opens-prefilled-current-list', await page.$eval('#coverArtist', el => el.value) === '周杰伦' && await page.$eval('#coverPop', el => !el.hidden));
  for (const [width, height] of [[312, 930], [465, 930], [1040, 780]]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 }); await sleep(70);
    if (width >= 720) { await page.click('#queueBtn'); await sleep(400); }
    await page.evaluate(() => window.__playerDebug.openCoverPanel('imp:1'));
    const fits = await page.$eval('#coverPop', el => { const r = el.getBoundingClientRect(); return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
    assert('cover-panel-fits-' + width, fits);
    await page.screenshot({ path: path.join(outDir, 'cover-panel-' + width + '.png') });
  }
  await page.evaluate(() => window.__playerDebug.startCoverFill());
  const copies = await page.evaluate(id => window.__playerDebug.coverInfo(id), id);
  assert('cover-fill-syncs-source-favorite-and-recent-copies', copies.length === 3 && copies.every(t => t.pic === COVER_SQUARE && t.match.originalPic === '' && t.match.album === '魔杰座'), JSON.stringify(copies));
  assert('cover-fill-preserves-live-custom-and-other-platform-covers', !persistedPlaylist.find(t => t.id.endsWith('_3')).pic && persistedPlaylist.find(t => t.id.endsWith('_4')).pic === COVER && persistedPlaylist.find(t => t.id === 'netease:1').pic === COVER);
  assert('cover-fill-saves-match-provenance', persistedPlaylist.filter(t => t.id === id).every(t => t.coverMatch.songId === 185709 && t.coverMatch.source === 'netease'));
  await page.evaluate(() => window.__playerDebug.startCoverFill());
  assert('cover-repeat-preserves-original-backup', (await page.evaluate(id => window.__playerDebug.coverInfo(id), id)).every(t => t.match.originalPic === ''));
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__playerDebug && document.querySelector('#listTabs .list-tab[data-list="imp:1"]'));
  await page.evaluate(() => window.__playerDebug.openCoverPanel('imp:1'));
  await page.evaluate(() => window.__playerDebug.restoreCovers('imp:1'));
  assert('cover-restore-after-reload-syncs-copies-and-removes-binding', (await page.evaluate(id => window.__playerDebug.coverInfo(id), id)).every(t => t.pic === '' && !t.match) && persistedPlaylist.filter(t => t.id === id).every(t => !t.coverMatch && !t.pic));
  coverDelay = 500;
  await page.evaluate(() => { window.__playerDebug.startCoverFill(); });
  await page.click('#coverCloseBtn'); await sleep(650); coverDelay = 0;
  assert('cover-stop-prevents-commit-and-further-catalog-requests', (await page.evaluate(id => window.__playerDebug.coverInfo(id), id)).every(t => !t.match) && await page.$eval('#coverNote', el => el.textContent.includes('已停止')));
  coverFail = true;
  await page.evaluate(() => window.__playerDebug.startCoverFill()); coverFail = false;
  assert('cover-metadata-failure-preserves-original', (await page.evaluate(id => window.__playerDebug.coverInfo(id), id)).every(t => !t.match) && await page.$eval('#coverNote', el => el.textContent.includes('-462')));
  coverImageBad = true;
  await page.evaluate(() => window.__playerDebug.startCoverFill()); coverImageBad = false;
  assert('cover-undecodable-image-is-not-written', (await page.evaluate(id => window.__playerDebug.coverInfo(id), id)).every(t => !t.match) && await page.$eval('#coverNote', el => el.textContent.includes('失败 2 首')));
  await page.evaluate(async () => {
    const fetchBefore = window.fetch;
    window.fetch = function (url, opts) { return String(url).includes('/widget/api/playlist') && opts && opts.method === 'POST' ? Promise.resolve(new Response('{}', { status: 500 })) : fetchBefore.apply(this, arguments); };
    await window.__playerDebug.startCoverFill(); window.fetch = fetchBefore;
  });
  assert('cover-save-failure-rolls-back-pics-and-backups', (await page.evaluate(id => window.__playerDebug.coverInfo(id), id)).every(t => t.pic === '' && !t.match) && await page.$eval('#coverNote', el => el.textContent.includes('保存失败')));
  await page.close();
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
}
async function verifyMoodLists() {
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const fixed = [{ id: 'fav', name: '我的喜欢' }, { id: 'recent', name: '最近播放' }, { id: 'local', name: '本地' }];
  persistedLists = [...fixed, { id: 'imp:2', name: '后端乙' }, { id: 'imp:1', name: '后端甲' }];
  const page = await newPage();
  await page.evaluateOnNewDocument((legacy) => {
    let h;
    const listeners = new Set();
    window.__legacyLists = legacy;
    window.__listsUnavailable = false;
    window.__listsDirectWrites = [];
    window.__notifyLists = (keys) => { listeners.forEach(fn => fn(keys)); };
    const fetchBefore = window.fetch;
    window.fetch = function (url, opts) {
      if (window.__listsUnavailable && String(url).endsWith('/api/lists') && !(opts && opts.method)) {
        return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 200 }));
      }
      return fetchBefore.apply(this, arguments).then((res) => {
        if (String(url).endsWith('/api/lists') && opts && opts.method === 'POST') {
          setTimeout(() => window.__notifyLists(['player-lists']), 0);
        }
        return res;
      });
    };
    Object.defineProperty(window, 'hana', { configurable: true, get() { return h; }, set(v) {
      h = v;
      if (v && v.storage && v.storage.global) {
        v.storage.global.get = (key) => Promise.resolve(key === 'player-lists' ? window.__legacyLists : null);
        v.storage.global.set = (key) => { window.__listsDirectWrites.push(key); return Promise.resolve(); };
        v.storage.global.onChanged = (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
      }
    } });
  }, [...fixed, { id: 'imp:1', name: '旧门甲' }, { id: 'imp:2', name: '旧门乙' }]);
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__playerDebug && window.__playerDebug.listsInfo().some(l => l.name === '后端甲'));
  assert('mood-lists-backend-priority-and-order', (await page.evaluate(() => window.__playerDebug.listsInfo())).map(l => l.name).join(',') === '我的喜欢,最近播放,本地,后端乙,后端甲');
  await clickTab(page, 'imp:1');
  await page.evaluate(() => document.getElementById('renameBtn').click());
  await page.$eval('#listNameInput', el => { el.value = '改名持久化'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await page.waitForFunction(async (api) => (await fetch(api + '/api/lists?appSurfaceSession=fake-ticket').then(r => r.json())).lists.some(l => l.name === '改名持久化'), {}, API);
  assert('mood-lists-rename-backend-persistence', persistedLists.find(l => l.id === 'imp:1').name === '改名持久化');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__playerDebug && window.__playerDebug.listsInfo().some(l => l.name === '改名持久化'));
  assert('mood-lists-rename-survives-reload', await page.evaluate(() => window.__playerDebug.listsInfo().some(l => l.name === '改名持久化')));
  await page.evaluate(() => {
    window.__listRenders = 0;
    window.__listObserver = new MutationObserver(() => window.__listRenders++);
    window.__listObserver.observe(document.getElementById('listTabs'), { childList: true, subtree: true });
    window.__notifyLists(['player-lists']);
  });
  await sleep(250);
  assert('mood-lists-own-echo-no-rerender', await page.evaluate(() => window.__listRenders === 0));
  const writes = listWrites;
  persistedLists.push({ id: 'imp:9', name: '今日心情' });
  if (!persistedPlaylist) persistedPlaylist = TRACKS.map(t => ({ ...t }));
  persistedPlaylist.push({ id: 'netease:890001', name: '新心情曲', url: goUrl(890001), mode: '在线', dur: 180, group: '在线音乐', list: 'imp:9' });
  await page.evaluate(() => window.__notifyLists(['player-lists']));
  await page.waitForFunction(() => window.__playerDebug.listTracks('imp:9').length === 1);
  assert('mood-lists-external-create-shows-tracks-immediately', await page.evaluate(() => window.__playerDebug.listsInfo().some(l => l.name === '今日心情')));
  assert('mood-lists-broadcast-does-not-write-back', listWrites === writes);
  persistedPlaylist = persistedPlaylist.filter(t => t.list !== 'imp:9').concat({ id: 'netease:890002', name: '覆盖心情曲', url: goUrl(890002), mode: '在线', dur: 190, group: '在线音乐', list: 'imp:9' });
  await page.evaluate(() => window.__notifyLists(['player-library-revision']));
  await page.waitForFunction(() => window.__playerDebug.listTracks('imp:9').some(t => t.title === '覆盖心情曲'));
  assert('mood-lists-same-name-replacement-refreshes-tracks', await page.evaluate(() => window.__playerDebug.listTracks('imp:9').length === 1));
  assert('mood-lists-no-direct-storage-write', await page.evaluate(() => !window.__listsDirectWrites.includes('player-lists')));
  await page.evaluateOnNewDocument(() => { window.__listsUnavailable = true; });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__playerDebug && window.__playerDebug.listsInfo().some(l => l.name === '旧门甲'));
  assert('mood-lists-backend-unavailable-legacy-fallback', await page.evaluate(() => window.__playerDebug.listsInfo().some(l => l.name === '旧门乙')));
  await page.close();
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
}
if (!process.argv.includes('--ripple-only') && !process.argv.includes('--song-only')) {
if (process.argv.includes('--lyric-perf-only')) {
  await verifyLyricPerformance();
  await verifySlowLyricFlow();
  fs.writeFileSync(path.join(outDir, 'verify-lyric-perf.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ assertions: `${report.assertions.filter(a => a.ok).length}/${report.assertions.length}`, failed: report.assertions.filter(a => !a.ok), lyricPerformance: report.lyricPerformance, runtimeErrors: report.runtimeErrors, outDir }, null, 2));
  await browser.close(); server.closeAllConnections(); server.close();
  process.exit(report.assertions.some(a => !a.ok) || report.runtimeErrors.length ? 1 : 0);
}
await verifyMoodLists();
if (process.argv.includes('--lists-only')) {
  console.log(JSON.stringify({ assertions: `${report.assertions.filter(a => a.ok).length}/${report.assertions.length}`, failed: report.assertions.filter(a => !a.ok), runtimeErrors: report.runtimeErrors }, null, 2));
  await browser.close(); server.closeAllConnections(); server.close();
  process.exit(report.assertions.some(a => !a.ok) || report.runtimeErrors.length ? 1 : 0);
}
await verifyCoverFill();
if (process.argv.includes('--covers-only')) {
  fs.writeFileSync(path.join(outDir, 'verify-covers.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ assertions: `${report.assertions.filter(a => a.ok).length}/${report.assertions.length}`, failed: report.assertions.filter(a => !a.ok), runtimeErrors: report.runtimeErrors }, null, 2));
  await browser.close(); server.closeAllConnections(); server.close();
  process.exit(report.assertions.some(a => !a.ok) || report.runtimeErrors.length ? 1 : 0);
}
await verifySurfaceMotion();
if (process.argv.includes('--surface-motion-only')) {
  console.log(JSON.stringify({ assertions: `${report.assertions.filter((a) => a.ok).length}/${report.assertions.length}`, failed: report.assertions.filter((a) => !a.ok), runtimeErrors: report.runtimeErrors }, null, 2));
  await browser.close(); server.close();
  process.exit(report.assertions.some((a) => !a.ok) || report.runtimeErrors.length ? 1 : 0);
}
await verifyLyricFlow();
await verifyLyricPerformance();
await verifySlowLyricFlow();
if (process.argv.includes('--lyrics-only')) {
  fs.writeFileSync(path.join(outDir, 'verify-lyrics.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ assertions: `${report.assertions.filter((a) => a.ok).length}/${report.assertions.length}`, failed: report.assertions.filter((a) => !a.ok), runtimeErrors: report.runtimeErrors, outDir }, null, 2));
  await browser.close(); server.close();
  process.exit(report.assertions.some((a) => !a.ok) || report.runtimeErrors.length ? 1 : 0);
}

/* ============ 1) 六尺寸 × 浅深：自检 + 截图 ============ */
const CASES = [
  ['card-465x930', 465, 930, 'index.html'],
  ['tall-585x1172', 585, 1172, 'index.html'],
  ['short-531x451', 531, 451, 'index.html'],
  ['card-560x616', 560, 616, 'index.html'],
  ['window-1040x740', 1040, 740, 'standalone.html'],
  ['window-1040x780', 1040, 780, 'standalone.html']
];
for (const [name, w, h, file] of CASES) {
  for (const theme of ['light', 'dark']) {
    const page = await newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(`${UI_BASE}/${file}?assert=1&shot=1&appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => window.__fixtureTheme(t), theme);
    await sleep(700);
    const result = await page.evaluate(() => window.__playerSelfCheck());
    report.selfCheck.push({ case: `${name}/${theme}`, passed: result.passed, failed: result.checks.filter((c) => !c.ok) });
    await page.screenshot({ path: path.join(outDir, `${name}-${theme}.png`) });
    await page.close();
  }
}

/* ============ 2) 接线冒烟：多歌单切换 + 舞台呈现 ============ */
{
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(800);

  const w = {};
  w.tabs = await tabLabels(page);
  w.activeList = await activeTab(page);
  // 本地页：没设文件夹 → 引导（不是空白）
  await clickTab(page, 'local');
  await sleep(250);
  w.localGuide = await page.evaluate(() => ({
    rows: document.querySelectorAll('#queueList .q-row').length,
    hasPickBtn: !!document.getElementById('localPickBtn'),
    text: (document.querySelector('#queueList .q-guide-text') || {}).textContent || ''
  }));
  await page.screenshot({ path: path.join(outDir, 'list-local-empty-465x930-light.png') });

  const geoBefore = await geom(page);

  // 切到导入歌单 1：只换内容，顶栏/控制条不动
  await clickTab(page, 'imp:1');
  await sleep(350);
  w.imp1 = { rows: await rowCount(page), first: (await rowTitles(page))[0], dup: await dupUids(page) };
  w.geoStableOnSwitch = JSON.stringify(await geom(page)) === JSON.stringify(geoBefore);
  await page.screenshot({ path: path.join(outDir, 'list-imp1-465x930-light.png') });

  // 切到导入歌单 2：含跨列表重复 id + searchKey 曲目
  await clickTab(page, 'imp:2');
  await sleep(350);
  w.imp2 = { rows: await rowCount(page), dup: await dupUids(page), titles: await rowTitles(page) };
  await page.screenshot({ path: path.join(outDir, 'list-imp2-465x930-light.png') });

  // 跨列表重复：imp:1 与 imp:2 各有 3 首同 id，两边都必须各自保留（列表内无重复、跨列表不并）
  w.crossList = {
    imp1Rows: w.imp1.rows,
    imp2Rows: w.imp2.rows,
    imp2HasSearch: w.imp2.titles.some((t) => t.startsWith('搜索曲目'))
  };

  // 回到本地页，选文件夹（stub 宿主 pick）
  await clickTab(page, 'local');
  await sleep(250);
  await page.evaluate(() => {
    if (window.hana && window.hana.resources) {
      window.hana.resources.pick = () => Promise.resolve({ resources: [{ path: '/Users/fake/Music' }] });
    }
  });
  await page.evaluate(() => document.getElementById('localPickBtn').click());
  await sleep(700);
  w.localAfterPick = { rows: await rowCount(page), dup: await dupUids(page), first: (await rowTitles(page))[0] };
  await page.screenshot({ path: path.join(outDir, 'list-local-465x930-light.png') });

  // 播放本地曲目
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(700);
  w.afterPlayLocal = await page.evaluate(() => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent,
    audioPaused: document.getElementById('audio').paused
  }));

  // 切到歌单 1，播放带封面的在线曲目（歌词降级链 + 有封面压字态）
  await clickTab(page, 'imp:1');
  await sleep(300);
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(700);
  w.coverState = await page.evaluate(() => ({
    nocover: document.getElementById('player').classList.contains('nocover'),
    titleColor: getComputedStyle(document.getElementById('trackTitle')).color
  }));
  w.afterPlayOnline = await page.evaluate(() => ({
    title: document.getElementById('trackTitle').textContent,
    lyricLines: document.querySelectorAll('#lyrics .lyric-line').length,
    hasEmpty: !!document.querySelector('#lyrics .lyric-empty'),
    audioPaused: document.getElementById('audio').paused,
    lyricScrolling: document.getElementById('lyrics').scrollHeight > document.getElementById('lyrics').clientHeight,
    nocover: document.getElementById('player').classList.contains('nocover')
  }));
  await page.screenshot({ path: path.join(outDir, 'cover-465x930-light.png') });
  // 宽窗 + 封面（设计稿主展示态）
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await sleep(500);
  await page.screenshot({ path: path.join(outDir, 'cover-1040x780-light.png') });
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await sleep(400);

  // 悬停歌词：滚动条现形但歌词宽度不变（不抽动）
  w.lyricBeforeHover = await page.evaluate(() => { const el = document.getElementById('lyrics'); return { clientWidth: el.clientWidth, offsetWidth: el.offsetWidth, sb: getComputedStyle(el).scrollbarColor }; });
  await page.hover('#lyrics');
  await sleep(350);
  w.lyricAfterHover = await page.evaluate(() => { const el = document.getElementById('lyrics'); return { clientWidth: el.clientWidth, offsetWidth: el.offsetWidth, sb: getComputedStyle(el).scrollbarColor }; });
  /* 滚动条断言（R1）：悬停前后歌词宽度必须相等 —— 滑块淡入不许挾压歌词 */
  assert('lyric-scrollbar-no-shift',
    w.lyricBeforeHover.clientWidth === w.lyricAfterHover.clientWidth &&
    w.lyricBeforeHover.offsetWidth === w.lyricAfterHover.offsetWidth &&
    w.lyricBeforeHover.sb !== w.lyricAfterHover.sb,
    JSON.stringify({ before: w.lyricBeforeHover, after: w.lyricAfterHover }));
  await page.mouse.move(2, 2);
  await sleep(250);
  await page.screenshot({ path: path.join(outDir, 'lyrics-465x930-light.png') });

  // 无词曲目：右侧换频谱，蒙层/渐变必须保持在线（R4）。
  // 现在歌词显隐不再由按钮控制，而是「有词就显、没词才出频谱」——
  // 所以这里直接播“无词纯音乐”（夹具里 id 900099，假后端对它回空 LRC）。
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queueList .q-row')];
    const target = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('无词纯音乐'));
    if (target) target.querySelector('.q-hit').click();
  });
  await sleep(700);
  w.lyricsoffState = await page.evaluate(() => {
    const cs = (id) => getComputedStyle(document.getElementById(id)).display;
    const rip = document.getElementById('rippleCanvas');
    return { wrap: cs('lyricWrap'), scrim: cs('lyricScrim'), ripple: rip ? cs('rippleCanvas') : 'none' };
  });
  assert('ripple-layer-when-no-lyrics',
    w.lyricsoffState.wrap === 'none' && w.lyricsoffState.scrim !== 'none' && w.lyricsoffState.ripple !== 'none',
    JSON.stringify(w.lyricsoffState));
  await page.screenshot({ path: path.join(outDir, 'no-lyrics-ripple-465x930-light.png') });
  // 切回有词曲目：歌词层回来
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queueList .q-row')];
    const target = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('在线曲目'));
    if (target) target.querySelector('.q-hit').click();
  });
  await sleep(700);
  w.lyricsBackState = await page.evaluate(() => {
    const cs = (id) => getComputedStyle(document.getElementById(id)).display;
    return { wrap: cs('lyricWrap') };
  });
  assert('lyrics-return-when-track-has-lyrics',
    w.lyricsBackState.wrap !== 'none',
    JSON.stringify(w.lyricsBackState));
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await sleep(400);
  await page.screenshot({ path: path.join(outDir, 'lyrics-1040x780-light.png') });
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await sleep(400);

  // 下一首（在歌单内）
  await page.evaluate(() => document.getElementById('nextBtn').click());
  await sleep(400);
  w.afterNext = await page.evaluate(() => ({
    title: document.getElementById('trackTitle').textContent,
    activeList: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list')
  }));

  // 旧版 searchKey 曲目：切到歌单 2，点「搜索曲目」→ 现搜现播
  await clickTab(page, 'imp:2');
  await sleep(250);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queueList .q-row')];
    const target = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('搜索曲目'));
    target.querySelector('.q-hit').click();
  });
  await sleep(900);
  w.searchKeyResolve = await page.evaluate(() => ({
    title: document.getElementById('trackTitle').textContent,
    audioPaused: document.getElementById('audio').paused,
    hasSrc: !!(document.getElementById('audio').getAttribute('src')),
    lyricLines: document.querySelectorAll('#lyrics .lyric-line').length
  }));

  // 播放模式循环
  await page.evaluate(() => { for (let i = 0; i < 3; i++) document.getElementById('modeBtn').click(); });
  w.modeTitle = await page.$eval('#modeBtn', (e) => e.title);

  // 导入在线歌单 → 新列表出现并激活
  const tabsBefore = (await tabLabels(page)).length;
  await page.evaluate(() => {
    document.getElementById('importBtn').click();
    document.getElementById('linkInput').value = 'https://music.163.com/#/playlist?id=888';
    document.getElementById('linkAddBtn').click();
  });
  await sleep(600);
  w.importPlaylist = {
    tabsBefore,
    tabsAfter: (await tabLabels(page)).length,
    active: await activeTab(page),
    rows: await rowCount(page)
  };
  await page.screenshot({ path: path.join(outDir, 'list-imported-465x930-light.png') });

  // 重命名当前导入列表（内联编辑，不用模态）
  await page.evaluate(() => document.getElementById('renameBtn').click());
  await sleep(150);
  const hasInput = await page.evaluate(() => !!document.getElementById('listNameInput'));
  await page.evaluate(() => {
    const inp = document.getElementById('listNameInput');
    inp.value = '我的歌单';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await sleep(200);
  w.rename = {
    hasInput,
    headerTitle: await page.$eval('#queueTitle', (e) => e.textContent),
    tabTitle: await page.$eval('#listTabs .list-tab.is-active', (e) => e.getAttribute('title'))
  };
  await page.screenshot({ path: path.join(outDir, 'rename-465x930-light.png') });

  /* 导入在线单曲 → 落「我的喜欢」。
   * ⚠️ 产品行为变更（2026-10-11）：链接导入 = 收藏，与红心 / 搜索结果「加入」同一心智，
   * 直落 fav、不新建「单曲」歌单、不切激活列表。旧行为是「归入当前激活列表」，
   * 本组断言随之**有意修正观察位置**（从当前列表改到 fav）—— 不是放宽，是产品变了。 */
  const beforeSingle = await rowCount(page);
  const tabsBeforeSingle = (await tabLabels(page)).length;
  const activeBeforeSingle = await activeTab(page);
  await page.evaluate(() => {
    document.getElementById('importBtn').click();
    document.getElementById('linkInput').value = 'https://music.163.com/#/song?id=1234567';
    document.getElementById('linkAddBtn').click();
  });
  await sleep(600);
  w.importSingle = {
    before: beforeSingle,
    after: await rowCount(page),
    active: await activeTab(page),
    activeBefore: activeBeforeSingle,
    tabsBefore: tabsBeforeSingle,
    tabsAfter: (await tabLabels(page)).length,
    favRows: await page.evaluate(() => window.__playerDebug.listTracks('fav').length),
    hasUnitList: await page.evaluate(() => window.__playerDebug.listsInfo().some((l) => l.name === '单曲'))
  };

  // 删除最后一首
  const n0 = await rowCount(page);
  await page.evaluate(() => {
    const rows = document.querySelectorAll('#queueList .q-row');
    rows[rows.length - 1].querySelector('.q-more').click();
    document.getElementById('removeBtn').click();
  });
  await sleep(400);
  w.removed = n0 - (await rowCount(page));

  // 宽窗：抽屉 + 列表页截图（浅 / 深）
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await sleep(400);
  await page.evaluate(() => document.getElementById('queueBtn').click());
  w.wideDrawer = await page.$eval('#player', (e) => e.getAttribute('data-drawer'));
  await page.screenshot({ path: path.join(outDir, 'list-1040x780-light.png') });
  await page.evaluate((t) => window.__fixtureTheme(t), 'dark');
  await sleep(300);
  await page.screenshot({ path: path.join(outDir, 'list-1040x780-dark.png') });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(200);
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await sleep(300);
  await page.evaluate((t) => window.__fixtureTheme(t), 'dark');
  await sleep(250);
  await page.screenshot({ path: path.join(outDir, 'list-imported-465x930-dark.png') });

  report.wiring = w;
  await page.close();
}

/* ============ 2c) 动效（BRIEF-MOTION）：隐现/3行聚焦/频谱兜底/按压 ============ */
const motion = {};
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await clickTab(page, 'imp:1');
  await sleep(300);
  // 有歌词：邻近波峰更清晰，远处保留定稿的 65% 阅读底线。
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(900);
  motion.focus = await page.evaluate(() => {
    const cur = document.querySelector('.lyric-line.is-current');
    const near = document.querySelector('.lyric-line.is-near');
    const far = [...document.querySelectorAll('.lyric-line')].find((e) => !e.classList.contains('is-current') && !e.classList.contains('is-near'));
    const op = (e) => e ? +parseFloat(getComputedStyle(e).opacity).toFixed(2) : null;
    return { cur: op(cur), near: op(near), far: op(far), layout: document.getElementById('player').getAttribute('data-layout') };
  });
  assert('motion-wave-focus-keeps-context-readable',
    motion.focus.layout !== 'wide' && motion.focus.cur > motion.focus.far && motion.focus.near > motion.focus.far && motion.focus.far >= 0.64 && motion.focus.far <= 0.7,
    JSON.stringify(motion.focus));

  // 换层（motion 4）：有词曲目 ⇄ 无词曲目 互斥切换，且蒙层/渐变始终在线。
  // 不再由按钮驱动（按钮已删）——改由「有词/无词曲目」驱动，确定性更强。
  motion.crossfade = await page.evaluate(async () => {
    const vis = (id) => getComputedStyle(document.getElementById(id)).display;
    const rows = () => [...document.querySelectorAll('#queueList .q-row')];
    const pick = (kw) => { const r = rows().find((x) => x.querySelector('.q-title').textContent.startsWith(kw)); if (r) r.querySelector('.q-hit').click(); return !!r; };
    const has = () => document.getElementById('player').getAttribute('data-haslyrics');
    // 已经在有词曲目上（上面刚播过）
    const withLyrics = { wrap: vis('lyricWrap'), scrim: vis('lyricScrim'), has: has() };
    // 切到无词曲目（“无词纯音乐”，假后端回空 LRC）
    pick('无词纯音乐');
    await new Promise((r) => setTimeout(r, 800));
    const noLyrics = { wrap: vis('lyricWrap'), scrim: vis('lyricScrim'), has: has() };
    // 再切回有词曲目
    pick('在线曲目');
    await new Promise((r) => setTimeout(r, 800));
    const back = { wrap: vis('lyricWrap'), has: has() };
    return { withLyrics, noLyrics, back };
  });
  assert('motion-lyric-crossfade',
    motion.crossfade.withLyrics.wrap !== 'none' && motion.crossfade.withLyrics.has === '1' &&
    motion.crossfade.noLyrics.wrap === 'none' && motion.crossfade.noLyrics.scrim !== 'none' &&
    motion.crossfade.noLyrics.has === '0' &&
    motion.crossfade.back.wrap !== 'none' && motion.crossfade.back.has === '1',
    JSON.stringify(motion.crossfade));

  // 歌词跟随 3s 自动回归：滚动（wheel）后停 3.4s 应回到跟随（is-browsing 消失）
  motion.follow = await page.evaluate(async () => {
    const wrap = document.getElementById('lyricWrap');
    const ls = document.getElementById('lyrics');
    wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const browsingNow = ls.classList.contains('is-browsing');
    await new Promise((r) => setTimeout(r, 3400));
    return { browsingNow, browsingAfter: ls.classList.contains('is-browsing') };
  });
  assert('motion-follow-auto-resume',
    motion.follow.browsingNow === true && motion.follow.browsingAfter === false,
    JSON.stringify(motion.follow));

  // 鼠标悬停移动不算「浏览」：不应重置 3s 回归（桌面下否则永不回归）
  motion.followMouse = await page.evaluate(async () => {
    const wrap = document.getElementById('lyricWrap');
    const ls = document.getElementById('lyrics');
    wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    for (let i = 0; i < 5; i++) {
      wrap.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
    }
    const browsingMid = ls.classList.contains('is-browsing');
    await new Promise((r) => setTimeout(r, 1600));
    return { browsingMid, browsingAfter: ls.classList.contains('is-browsing') };
  });
  assert('motion-follow-mouse-ignored',
    motion.followMouse.browsingMid === true && motion.followMouse.browsingAfter === false,
    JSON.stringify(motion.followMouse));

  // 无歌词 → 自动出频谱（不再显「暂无歌词」）
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queueList .q-row')];
    const t = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('无词'));
    if (t) t.querySelector('.q-hit').click();
  });
  await sleep(900);
  motion.nolyr = await page.evaluate(() => ({
    haslyrics: document.getElementById('player').getAttribute('data-haslyrics'),
    rippleShown: !!(document.getElementById('rippleCanvas') && getComputedStyle(document.getElementById('rippleCanvas')).display !== 'none'),
    emptyShown: !!document.querySelector('#lyrics .lyric-empty')
  }));
  assert('motion-ripple-when-no-lyrics',
    motion.nolyr.haslyrics === '0' && motion.nolyr.emptyShown === false,
    JSON.stringify(motion.nolyr));

  // 指针涟漪：手动喂一圈，波列表增长；不读音频（无 captureStream 依赖）
  motion.ripple = await page.evaluate(() => {
    const dbg = window.__playerDebug;
    if (!dbg || typeof dbg.ripplePoke !== 'function') return { ok: false, reason: 'no-hook' };
    const before = dbg.rippleState();
    const n = dbg.ripplePoke(0.4, 0.5, true);
    return { ok: true, exists: before.exists !== false, beforeWaves: before.waves, afterWaves: n };
  });
  assert('motion-ripple-poke-adds-wave',
    motion.ripple.ok === true && motion.ripple.afterWaves >= 1 &&
    motion.ripple.afterWaves > (motion.ripple.beforeWaves || 0),
    JSON.stringify(motion.ripple));

  // 音频反应：喂一次低频包络 → 宽缓水面驱动（真机接同源音频后同一条路径）
  motion.audio = await page.evaluate(() => {
    const dbg = window.__playerDebug;
    if (!dbg || typeof dbg.rippleAudioPoke !== 'function') return { ok: false, reason: 'no-hook' };
    const st = dbg.rippleAudio();
    dbg.rippleResetAnalysis();
    const beforeEnv = dbg.rippleAudio().envBass;
    dbg.rippleAudioPoke(0.08);
    const after = dbg.rippleAudio();
    return { ok: true, ready: st.ready, beforeEnv: beforeEnv, afterEnv: after.envBass, gain: after.gain };
  });
  assert('motion-ripple-reactive-to-audio',
    motion.audio.ok === true && motion.audio.afterEnv > (motion.audio.beforeEnv || 0),
    JSON.stringify(motion.audio));

  // 按钮按压：:active 样式存在（scale）—— 检查样式表里确实写了
  motion.press = await page.evaluate(() => {
    const el = document.getElementById('playBtn');
    const cs = getComputedStyle(el).transitionProperty || '';
    return { trans: cs };
  });
  assert('motion-press-feedback',
    /transform/.test(motion.press.trans),
    JSON.stringify(motion.press));

  // 队列退场（宽窗抽屉）：关闭瞬间仍挂载（is-q-leaving），动画后才卸载
  {
    const p2 = await newPage();
    await p2.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
    await p2.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
    await sleep(700);
    motion.queueExit = await p2.evaluate(async () => {
      const player = document.getElementById('player');
      const q = document.getElementById('queue');
      document.getElementById('queueBtn').click();   // 打开抽屉
      await new Promise((r) => setTimeout(r, 380));
      const opened = { drawer: player.getAttribute('data-drawer'), disp: getComputedStyle(q).display };
      document.getElementById('queueBtn').click();   // 关闭
      await new Promise((r) => setTimeout(r, 70));
      const leaving = { drawer: player.getAttribute('data-drawer'), cls: player.classList.contains('is-q-leaving'), disp: getComputedStyle(q).display };
      await new Promise((r) => setTimeout(r, 320));
      const settled = { cls: player.classList.contains('is-q-leaving'), disp: getComputedStyle(q).display };
      return { opened, leaving, settled };
    });
    assert('motion-queue-exit-anim',
      motion.queueExit.opened.disp !== 'none' && motion.queueExit.leaving.cls === true &&
      motion.queueExit.leaving.disp !== 'none' && motion.queueExit.settled.cls === false &&
      motion.queueExit.settled.disp === 'none',
      JSON.stringify(motion.queueExit));
    await p2.close();
  }

  // 矮卡整页交叉：点开队列时舞台仍在场（左滑出）而不是瞬间消失
  {
    const p3 = await newPage();
    await p3.setViewport({ width: 531, height: 451, deviceScaleFactor: 1 });
    await p3.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
    await sleep(700);
    motion.compactEnter = await p3.evaluate(async () => {
      const player = document.getElementById('player');
      const scene = document.getElementById('scene');
      const q = document.getElementById('queue');
      document.getElementById('queueBtn').click();
      await new Promise((r) => setTimeout(r, 70));
      const mid = { page: player.getAttribute('data-page'), cls: player.classList.contains('is-q-in'), scene: getComputedStyle(scene).display, queue: getComputedStyle(q).display };
      await new Promise((r) => setTimeout(r, 300));
      const settled = { cls: player.classList.contains('is-q-in'), scene: getComputedStyle(scene).display, queue: getComputedStyle(q).display };
      return { mid, settled };
    });
    assert('motion-compact-queue-enter',
      motion.compactEnter.mid.cls === true && motion.compactEnter.mid.scene !== 'none' &&
      motion.compactEnter.mid.queue !== 'none' && motion.compactEnter.settled.cls === false &&
      motion.compactEnter.settled.scene === 'none' && motion.compactEnter.settled.queue !== 'none',
      JSON.stringify(motion.compactEnter));
    await p3.close();
  }

  report.motion = motion;
  await page.close();
}

/* ============ 2b) 四项改造：来源重做 / 真名压缩 / 歌手补齐 / 歌单可删 ============ */
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(800);

  const w2 = {};
  const metaText = () => page.$eval('#trackMeta', (e) => e.textContent);
  const tabInfo2 = () => page.$$eval('#listTabs .list-tab', (els) => els.map((e) => ({ list: e.getAttribute('data-list'), label: e.textContent.trim(), title: e.getAttribute('title') })));

  // ---- (a) 元信息行：本地曲目 →「来源·本地」
  await clickTab(page, 'local');
  await sleep(200);
  await page.evaluate(() => {
    if (window.hana && window.hana.resources) window.hana.resources.pick = () => Promise.resolve({ resources: [{ path: '/Users/fake/Music' }] });
  });
  await page.evaluate(() => document.getElementById('localPickBtn').click());
  await sleep(700);
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(400);
  w2.localMeta = await metaText();
  assert('meta-source-local', w2.localMeta === '来源·本地', w2.localMeta);
  await page.screenshot({ path: path.join(outDir, 'source-local-465x930-light.png') });

  // ---- (b) 元信息行：在线曲目 →「来源·<歌单名>」（间隔点格式）
  await clickTab(page, 'imp:1');
  await sleep(250);
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(400);
  w2.onlineMeta = await metaText();
  assert('meta-source-format', w2.onlineMeta.indexOf('来源·') === 0 && w2.onlineMeta.length > 3, w2.onlineMeta);
  await page.screenshot({ path: path.join(outDir, 'source-online-465x930-light.png') });

  // ---- (c) 队列第二行：没有 artist 就留空（不让 group 冒充）
  await clickTab(page, 'imp:2');
  await sleep(250);
  w2.queueArtists = await page.$$eval('#queueList .q-row .q-artist', (els) => els.map((e) => e.textContent.trim()));
  assert('queue-artist-empty-when-none',
    w2.queueArtists.length > 0 && w2.queueArtists.every((a) => a === ''),
    JSON.stringify(w2.queueArtists));

  // ---- (c2) 我的喜欢：红心加入 / 切换条出现「我的喜欢」/ 跨列表同曲同亮 / 取消不动原歌单
  const favState = () => page.evaluate(() => ({
    onRows: [...document.querySelectorAll('#queueList .q-row .q-fav.is-on')].length,
    total: document.querySelectorAll('#queueList .q-row .q-fav').length,
    tabs: [...document.querySelectorAll('#listTabs .list-tab')].map((e) => e.getAttribute('data-list'))
  }));
  // imp:2 首行点亮红心
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-fav').click());
  await sleep(250);
  w2.favAfterAdd = await favState();
  assert('fav-row-toggles-on',
    w2.favAfterAdd.onRows === 1 && w2.favAfterAdd.tabs.indexOf('fav') >= 0,
    JSON.stringify(w2.favAfterAdd));

  // 切到「我的喜欢」：只收到那一首，元信息行显示「来源·我的喜欢」
  await clickTab(page, 'fav');
  await sleep(250);
  w2.favList = { rows: await rowCount(page), first: (await rowTitles(page))[0] };
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(350);
  w2.favMeta = await metaText();
  assert('fav-list-collects-and-labels',
    w2.favList.rows === 1 && w2.favMeta === '来源·我的喜欢',
    JSON.stringify({ rows: w2.favList.rows, meta: w2.favMeta }));
  await page.screenshot({ path: path.join(outDir, 'fav-465x930-light.png') });

  // 跨列表同亮：imp:1 与 imp:2 各有一首同 id（在线曲目 1 = netease:900000）。
  // 在 imp:2 点亮后，切到 imp:1 同名 id 那颗心也应亮 —— 证明红心按稳定 id 判，不按 uid。
  await clickTab(page, 'imp:1');
  await sleep(250);
  const crossFav = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#queueList .q-row')].find((r) => r.getAttribute('data-id') === 'netease:900000');
    return { found: !!row, on: !!(row && row.querySelector('.q-fav.is-on')), onRows: document.querySelectorAll('#queueList .q-fav.is-on').length };
  });
  w2.favCrossList = crossFav;
  assert('fav-state-by-stable-id-cross-list', crossFav.found === true && crossFav.on === true, JSON.stringify(crossFav));

  // 取消喜欢：从「我的喜欢」移出，原歌单那份纹丝不动
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-fav').click());
  await sleep(250);
  const afterUnfav = await page.evaluate(() => ({
    onRowsImp1: document.querySelectorAll('#queueList .q-fav.is-on').length,
    rowsImp1: document.querySelectorAll('#queueList .q-row').length
  }));
  await clickTab(page, 'fav');
  await sleep(250);
  const favAfterUnfav = await page.evaluate(() => document.querySelectorAll('#queueList .q-row').length);
  w2.favUnfav = { afterUnfav, favRows: favAfterUnfav };
  assert('fav-unfav-keeps-original-list',
    afterUnfav.onRowsImp1 === 0 && afterUnfav.rowsImp1 === 20 && favAfterUnfav === 0,
    JSON.stringify(w2.favUnfav));

  // 「我的喜欢」不可删：长按不弹删除浮层
  await page.evaluate(() => {
    const tab = document.querySelector('#listTabs .list-tab[data-list="fav"]');
    tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await sleep(700);
  const favPopOpen = await page.evaluate(() => !document.getElementById('listPop').hidden);
  await page.evaluate(() => {
    const tab = document.querySelector('#listTabs .list-tab[data-list="fav"]');
    tab.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  assert('fav-not-deletable', favPopOpen === false, String(favPopOpen));
  await clickTab(page, 'imp:2');
  await sleep(200);

  // ---- (c3) 播放页红心（曲名下方 meta 旁）：跟着当前曲换，点亮后同步到队列行
  await clickTab(page, 'imp:1');
  await sleep(200);
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(350);
  const stageFavBefore = await page.evaluate(() => ({
    hidden: document.getElementById('stageFavBtn').hidden,
    pressed: document.getElementById('stageFavBtn').getAttribute('aria-pressed'),
    // 图标必须在（曾经是空标签导致红心看不见）
    hasIcon: !!document.querySelector('#stageFavBtn .icon use'),
    svgW: Math.round((document.querySelector('#stageFavBtn .icon') || {getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width)
  }));
  await page.evaluate(() => document.getElementById('stageFavBtn').click());
  await sleep(300);
  const stageFavAfter = await page.evaluate(() => ({
    pressed: document.getElementById('stageFavBtn').getAttribute('aria-pressed'),
    on: document.getElementById('stageFavBtn').classList.contains('is-on'),
    rowOn: document.querySelectorAll('#queueList .q-fav.is-on').length
  }));
  w2.stageFav = { before: stageFavBefore, after: stageFavAfter };
  assert('stage-fav-toggles-and-syncs-row',
    stageFavBefore.hidden === false && stageFavBefore.pressed === 'false' &&
    stageFavBefore.hasIcon === true && stageFavBefore.svgW >= 11 &&
    stageFavAfter.on === true && stageFavAfter.pressed === 'true' && stageFavAfter.rowOn === 1,
    JSON.stringify(w2.stageFav));
  // 心收回（不留侧效给后续用例）
  await page.evaluate(() => document.getElementById('stageFavBtn').click());
  await sleep(250);

  // ---- (c2b) 控制条常驻红心：纯图标（无「喜欢」文字）+ 点亮 + 与播放页/队列行同步
  const ctlFavBefore = await page.evaluate(() => ({
    pressed: document.getElementById('favBtn').getAttribute('aria-pressed'),
    text: document.getElementById('favBtn').textContent.trim(),
    hasIcon: !!document.querySelector('#favBtn .icon use'),
    isBar: document.getElementById('favBtn').classList.contains('fav-btn-bar')
  }));
  await page.evaluate(() => document.getElementById('favBtn').click());
  await sleep(250);
  const ctlFavAfter = await page.evaluate(() => ({
    pressed: document.getElementById('favBtn').getAttribute('aria-pressed'),
    on: document.getElementById('favBtn').classList.contains('is-on'),
    stageOn: document.getElementById('stageFavBtn').classList.contains('is-on'),
    rowOn: document.querySelectorAll('#queueList .q-fav.is-on').length
  }));
  w2.ctlFav = { before: ctlFavBefore, after: ctlFavAfter };
  assert('control-bar-fav-toggles',
    ctlFavBefore.pressed === 'false' && ctlFavBefore.text === '' &&
    ctlFavBefore.hasIcon === true && ctlFavBefore.isBar === true &&
    ctlFavAfter.on === true && ctlFavAfter.pressed === 'true' &&
    ctlFavAfter.stageOn === true && ctlFavAfter.rowOn === 1,
    JSON.stringify(w2.ctlFav));
  await page.evaluate(() => document.getElementById('favBtn').click());   // 收回
  await sleep(250);

  // ---- (c2c) 切回列表自动居中正在播的那首
  // 播 imp:1 靠后的一首，手动滚到顶，切走再切回 —— 它应被滚回可视区中部。
  await page.evaluate(() => {
    const rows = document.querySelectorAll('#queueList .q-row');
    rows[15].querySelector('.q-hit').click();
  });
  await sleep(400);
  await page.evaluate(() => { document.getElementById('queueList').scrollTop = 0; });
  await clickTab(page, 'imp:2');
  await sleep(200);
  await clickTab(page, 'imp:1');
  await sleep(350);
  const centerAfter = await page.evaluate(() => {
    const list = document.getElementById('queueList');
    const cur = list.querySelector('.q-row.is-current');
    if (!cur) return { found: false };
    const rowMid = cur.offsetTop + cur.offsetHeight / 2 - list.scrollTop;
    return { found: true, scrolled: list.scrollTop > 0, rowMid: Math.round(rowMid), viewMid: Math.round(list.clientHeight / 2) };
  });
  w2.centerOnSwitch = centerAfter;
  assert('queue-center-on-list-switch',
    centerAfter.found === true && centerAfter.scrolled === true &&
    Math.abs(centerAfter.rowMid - centerAfter.viewMid) <= 40,   // 居中容差 40px（半行高量级）
    JSON.stringify(w2.centerOnSwitch));

  // 回到 imp:2（(d) 补全歌手针对的就是这个列表里的 searchKey 曲目）
  await clickTab(page, 'imp:2');
  await sleep(200);

  // ---- (d) 歌手补齐：searchKey 曲目补 author，且幂等
  const hitsBefore = searchHits;
  await page.evaluate(() => document.querySelector('[data-import="backfill"]').click());
  let filled = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    filled = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#queueList .q-row')];
      return rows.filter((r) => r.querySelector('.q-title').textContent.startsWith('搜索曲目') && r.querySelector('.q-artist').textContent.trim()).length;
    });
    if (filled >= 3) break;
  }
  w2.backfill = { searchHitsDelta: searchHits - hitsBefore, filledRows: filled };
  assert('backfill-fills-artist', filled === 3 && searchHits - hitsBefore === 3, JSON.stringify(w2.backfill));
  await page.screenshot({ path: path.join(outDir, 'backfill-465x930-light.png') });

  // 幂等：再跑一次，不再发起搜索
  const hits2 = searchHits;
  await page.evaluate(() => document.querySelector('[data-import="backfill"]').click());
  await sleep(700);
  w2.backfillIdempotent = { searchHitsDelta: searchHits - hits2 };
  assert('backfill-idempotent', searchHits - hits2 === 0, JSON.stringify(w2.backfillIdempotent));

  // ---- (e) 歌单真名：导入歌单后切换条显示压缩名、title 是完整名
  await page.evaluate(() => {
    document.getElementById('importBtn').click();
    document.getElementById('linkInput').value = 'https://music.163.com/#/playlist?id=888';
    document.getElementById('linkAddBtn').click();
  });
  await sleep(700);
  const afterImport = await tabInfo2();
  const imported = afterImport.find((t) => t.title === PLAYLIST_META.name);
  w2.realName = { tabs: afterImport, imported };
  assert('list-realname-compressed',
    !!imported && imported.label === 'Can_0201' && imported.title === 'Can_0201喜欢的音乐',
    JSON.stringify(imported));
  await page.screenshot({ path: path.join(outDir, 'list-realname-465x930-light.png') });

  // ---- (e2) 切换条溢出：两侧按需渐隐 + 切列表时当前项自动滚入视野
  // 再导 3 个歌单把切换条撑溢（窄卡 465 宽：4 个固定列表 + 4 个导入歌单必然溢出）
  for (const pid of ['901', '902', '903']) {
    await page.evaluate((id) => {
      document.getElementById('importBtn').click();
      document.getElementById('linkInput').value = 'https://music.163.com/#/playlist?id=' + id;
      document.getElementById('linkAddBtn').click();
    }, pid);
    await sleep(700);
  }
  await clickTab(page, 'fav');   // 回到第一个 tab：此时只有右侧还有内容
  await sleep(300);
  const tabOverflow = await page.evaluate(() => {
    const el = document.getElementById('listTabs');
    const cs = getComputedStyle(el);
    return {
      count: el.querySelectorAll('.list-tab').length,
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      overflow: el.scrollWidth - el.clientWidth > 1,
      fadeR: el.classList.contains('is-scroll-r'),
      fadeL: el.classList.contains('is-scroll-l'),
      scrollLeft: Math.round(el.scrollLeft),
      mask: String(cs.maskImage || cs.webkitMaskImage || '')
    };
  });
  // 切到最后一个 tab —— 它应被自动带进视野（scrollLeft > 0 且右边缘不越界）
  await page.evaluate(() => {
    const tabs = document.querySelectorAll('#listTabs .list-tab');
    tabs[tabs.length - 1].click();
  });
  await sleep(400);
  const lastTab = await page.evaluate(() => {
    const el = document.getElementById('listTabs');
    const tabs = el.querySelectorAll('.list-tab');
    const t = tabs[tabs.length - 1];
    const cr = el.getBoundingClientRect(), tr = t.getBoundingClientRect();
    return {
      activeIsLast: t.classList.contains('is-active'),
      scrollLeft: Math.round(el.scrollLeft),
      rightGap: Math.round(cr.right - tr.right),
      fadeL: el.classList.contains('is-scroll-l'),
      fadeR: el.classList.contains('is-scroll-r')
    };
  });
  w2.tabOverflow = { tabOverflow, lastTab };
  assert('list-tabs-overflow-fade',
    tabOverflow.overflow === true && tabOverflow.fadeR === true && tabOverflow.fadeL === false &&
    tabOverflow.scrollLeft === 0 && /gradient/.test(tabOverflow.mask),
    JSON.stringify(tabOverflow));
  assert('list-tabs-active-scrolls-into-view',
    lastTab.activeIsLast === true && lastTab.scrollLeft > 0 && lastTab.rightGap >= -1 &&
    lastTab.fadeL === true && lastTab.fadeR === false,
    JSON.stringify(lastTab));
  await page.screenshot({ path: path.join(outDir, 'list-tabs-overflow-465x930-light.png') });

  // ---- (f) 用户新要求：长按只排序；没有移动不弹菜单、不误切列表。
  await clickTab(page, 'imp:2');
  await sleep(200);
  const tabsBeforePress = (await tabInfo2()).map((t) => t.list).join(',');
  const heldTab = await page.$('#listTabs .list-tab[data-list="imp:2"]');
  await heldTab.evaluate(el => el.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
  const heldBox = await heldTab.boundingBox();
  await page.mouse.move(heldBox.x + heldBox.width / 2, heldBox.y + heldBox.height / 2);
  await page.mouse.down();
  await sleep(700);
  const popAfterPress = await page.evaluate(() => ({
    open: !document.getElementById('listPop').hidden,
    lifted: !!document.querySelector('.reorder-ghost'),
    title: document.getElementById('listPopTitle').textContent,
    activeList: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list')
  }));
  await page.mouse.up();
  await sleep(200);
  const popClosed = await page.evaluate(() => document.getElementById('listPop').hidden);
  w2.longPress = { popAfterPress, popClosed, tabsUnchanged: (await tabInfo2()).map((t) => t.list).join(',') === tabsBeforePress };
  assert('list-longpress-arms-sort-without-menu',
    popAfterPress.open === false && popAfterPress.lifted === true && popAfterPress.activeList === 'imp:2',
    JSON.stringify(w2.longPress));
  assert('list-longpress-cancel', popClosed === true && w2.longPress.tabsUnchanged === true, JSON.stringify(w2.longPress));

  // ---- (g) 右键删除「正在播的那首」所在的列表：播放不中断，列表从切换条消失
  await clickTab(page, 'imp:1');
  await sleep(250);
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  /* 等条件而不是等时间（同 search-hit-plays-directly 的根因）：点行起播需等媒体就绪、
   * play 事件把 data-playing 置 1。固定 sleep(900) 会偶发（HEAD 干净副本同样会挂）。 */
  await page.waitForFunction(
    () => document.getElementById('player').getAttribute('data-playing') === '1'
      && document.getElementById('audio').paused === false,
    { timeout: 5000, polling: 100 }
  ).catch(() => {});
  const before = await page.evaluate(() => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent,
    paused: document.getElementById('audio').paused,
    rows: document.querySelectorAll('#queueList .q-row').length,
    activeList: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list'),
    currentUid: (document.querySelector('#queueList .q-row.is-current') || {}).getAttribute
      ? document.querySelector('#queueList .q-row.is-current').getAttribute('data-uid') : ''
  }));
  await page.evaluate(() => {
    const tab = document.querySelector('#listTabs .list-tab[data-list="imp:1"]');
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });
  await sleep(250);
  const popTitle = await page.$eval('#listPopTitle', (e) => e.textContent);
  await page.screenshot({ path: path.join(outDir, 'list-delete-confirm-465x930-light.png') });
  await page.evaluate(() => document.getElementById('listDeleteBtn').click());
  /* 等条件而不是等时间（同 before 半）：删除歌单逻辑一行不碰音频，但状态刷新是异步的。
   * 固定 sleep(700) 会偶发（实测：同一次会话里第1跑红、第2跑绿）。
   * 若播放真被打断（永不恢复），这里 5s 后会超时，让下面断言报出真实状态。 */
  await page.waitForFunction(
    () => document.getElementById('player').getAttribute('data-playing') === '1'
      && document.getElementById('audio').paused === false,
    { timeout: 5000, polling: 100 }
  ).catch(() => {});
  const after = await page.evaluate(() => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent,
    paused: document.getElementById('audio').paused,
    activeList: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list'),
    tabs: [...document.querySelectorAll('#listTabs .list-tab')].map((e) => e.getAttribute('data-list'))
  }));
  w2.deletePlaying = { before, popTitle, after };
  assert('list-delete-while-playing',
    before.playing === '1' && before.paused === false && before.rows === 20 &&
    before.activeList === 'imp:1' && String(before.currentUid).indexOf('imp:1|') === 0 &&
    after.playing === '1' && after.paused === false && after.title === before.title &&
    after.tabs.indexOf('imp:1') < 0 && after.activeList === 'local',
    JSON.stringify(w2.deletePlaying));
  assert('list-delete-confirm-title', popTitle.indexOf('删除') === 0, popTitle);

  // 被删列表的曲目不再出现；其余列表不受影响
  const remaining = await tabInfo2();
  const perList = {};
  for (const t of remaining) {
    await clickTab(page, t.list);
    await sleep(150);
    perList[t.list] = await rowCount(page);
  }
  w2.afterDelete = { tabs: remaining.map((t) => t.list), perList };
  assert('list-delete-others-intact',
    remaining.some((t) => t.list === 'imp:2') && perList['imp:2'] === 6 &&
    remaining.every((t) => t.list !== 'imp:1'),
    JSON.stringify(w2.afterDelete));

  // 本地列表不可删（右键不弹浮层）
  await page.evaluate(() => {
    const tab = document.querySelector('#listTabs .list-tab[data-list="local"]');
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });
  await sleep(150);
  const localPopOpen = await page.evaluate(() => !document.getElementById('listPop').hidden);
  assert('list-local-not-deletable', localPopOpen === false, String(localPopOpen));

  /* 歌词跨源兜底：拿「标题+歌手」去别的平台搜时，匹配规则必须保守。
   * 纯函数，不依赖网络（走 __playerDebug 钩子）；防「纯音乐被配成同名歌曲」这类乱配。 */
  const lyricMatch = await page.evaluate(() => {
    const D = window.__playerDebug;
    const mk = (title, author) => ({ title, author, url: 'x' });
    const hit = (list, t, a) => { const r = D.pickLyricHit(list, t, a); return r ? (r.title + '/' + r.author) : null; };
    return {
      exact: hit([mk('晴天', '周杰伦')], '晴天', '某某'),                 // 同名直取
      bracketVersion: hit([mk('晴天 (Live版)', '周杰伦')], '晴天', ''),     // 括号版本注记 → 归一后同名
      wrongTitle: hit([mk('雨天', '周杰伦')], '晴天', '周杰伦'),           // 标题不同不取
      authorPreferred: hit([mk('晴天', '林俊杰'), mk('晴天', '周杰伦')], '晴天', '周杰伦'), // 同名时作者对得上的优先
      emptyList: hit([], '晴天', '周杰伦'),
      noUrl: (function () { const r = D.pickLyricHit([{ title: '晴天', author: '周杰伦' }], '晴天', '周杰伦'); return r ? 'has' : 'null'; })()  // 无 url 的结果不取
    };
  });
  assert('lyric-crosssource-match-rules',
    lyricMatch.exact === '晴天/周杰伦' && lyricMatch.bracketVersion === '晴天 (Live版)/周杰伦' &&
    lyricMatch.wrongTitle === null && lyricMatch.authorPreferred === '晴天/周杰伦' &&
    lyricMatch.emptyList === null && lyricMatch.noUrl === 'null',
    JSON.stringify(lyricMatch));

  /* 歌词关键词清洗（cleanLyricQuery）：B站长标题是「一整条广告」+ author 是 UP 主。
   * 跨源兜底原来拿 [title, author].join(' ') 原样搜 —— 搜索这一步就废了。
   * 真实样本（2026-10-11，B站搜索结果）走纯函数验证。 */
  const cleanq = await page.evaluate(() => {
    const D = window.__playerDebug;
    const q = (t, a) => D.cleanLyricQuery(t, a).keyword;
    const qo = (t, a) => { const r = D.lyricQueryOf(t, a); return r ? r.keyword : null; };
    return {
      book: q('【4K珍藏】南拳妈妈《下雨天》MV极致修复！（收录于2008年专辑《优の良曲 南搞小孩》）', '郭总说'),
      bookEn: q('【𝐇𝐢-𝐑𝐞𝐬无损音质】｜《稻香》- 周杰伦 -‘还记得你说家是唯一的城堡’', 'VV音乐局'),
      dash: q('【4K修复】周杰伦 - 稻香 MV 2160P修复版 简体', 'zyl2012_音乐无限'),
      after: q('《起风了》买辣椒也用券「我终将青春还给了她」【循环歌单】', '余响闲时'),
      // 合集/纯音乐：判定 ok=false，不做自动兜底（返回 null）
      collection: qo('【时长6小时】100首超好听的纯音乐，没有歌词也能打动人心，绝对值得珍藏的轻音乐合集！', '北流嘉措'),
      instrumental: qo('HR音质：纯音乐《卡农》（经典钢琴版）——dylanf', '一二桂'),
      // 干净标题：歌名原样 + 真歌手保留（author 不是 UP 主）
      clean: qo('晴天', '周杰伦')
    };
  });
  assert('lyric-query-cleaned-for-bili-titles',
    cleanq.book === '下雨天 南拳妈妈' && cleanq.bookEn === '稻香 周杰伦' &&
    cleanq.dash === '稻香 周杰伦' && cleanq.after === '起风了 买辣椒也用券' &&
    cleanq.clean === '晴天 周杰伦',
    JSON.stringify(cleanq));
  assert('lyric-query-skips-collection-and-instrumental',
    cleanq.collection === null && cleanq.instrumental === null,
    JSON.stringify(cleanq));

  /* 脏标题也能匹配上：拿 B站长标题去 pickLyricHit，应当命中干净结果的「地下天」。 */
  const dirtyMatch = await page.evaluate(() => {
    const D = window.__playerDebug;
    const mk = (title, author) => ({ title, author, url: 'x' });
    const r = D.pickLyricHit([mk('下雨天', '南拳妈妈'), mk('下雨天', '梁心颐')],
      '【4K珍藏】南拳妈妈《下雨天》MV极致修复！（收录于2008年专辑《优の良曲 南搞小孩》）', '郭总说');
    return r ? (r.title + '/' + r.author) : null;
  });
  assert('lyric-dirty-title-matches-after-clean',
    dirtyMatch === '下雨天/南拳妈妈',
    JSON.stringify(dirtyMatch));

  /* 无词入口：只在「确实无词」时亮，加载中/有词都不亮（罐头拍板：单入口、有词不打扰）。 */
  const lyricAsk = await page.evaluate(() => {
    const D = window.__playerDebug;
    const el = document.getElementById('lyricAsk');
    const st = () => D.lyricAskState();
    // 当前曲目（fixture 里带词）→ 不亮
    const withLyrics = st().hidden;
    // 手动把状态改成 none 再看
    D.openLyricMatch();
    const popOpen = st().popHidden === false;
    const prefilled = (document.getElementById('lmSong') || {}).value || '';
    D.closeLyricMatch();
    const popClosed = st().popHidden === true;
    return { withLyrics: withLyrics, popOpen: popOpen, prefilled: prefilled, popClosed: popClosed, hasEl: !!el };
  });
  assert('lyric-ask-hidden-when-lyrics-present',
    lyricAsk.hasEl === true && lyricAsk.withLyrics === true,
    JSON.stringify(lyricAsk));
  assert('lyric-match-panel-opens-and-prefills',
    lyricAsk.popOpen === true && lyricAsk.popClosed === true && lyricAsk.prefilled.length > 0,
    JSON.stringify(lyricAsk));

  /* 无词入口按钮的视觉（罐头 2026-10-11 真机反馈：旧的胶囊「像个贴上去的创可贴」）。
   * 改成「歌词区里的一行字」：常态 = 邻行色，悬停 = 当前句同款（颜色 + 600 + 同光），
   * 不再有底/描边/圆角/灰环。伪类读不到 getComputedStyle，所以扫样式表。 */
  const askStyle = await page.evaluate(() => {
    const rules = [];
    const sheets = document.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
      const list = sheets[i].cssRules || [];
      for (let j = 0; j < list.length; j++) {
        const r = list[j];
        if (!r.selectorText || !r.style) continue;
        if (r.selectorText.indexOf('.lyric-ask-btn') < 0) continue;
        rules.push({
          sel: r.selectorText,
          border: r.style.border || '',
          radius: r.style.borderRadius || '',
          background: r.style.background || r.style.backgroundColor || '',
          boxShadow: r.style.boxShadow || '',
          color: r.style.color || '',
          fontWeight: r.style.fontWeight || '',
          textShadow: r.style.textShadow || ''
        });
      }
    }
    const base = rules.filter((r) => r.sel === '.lyric-ask-btn')[0] || {};
    const hover = rules.filter((r) => r.sel.indexOf(':hover') >= 0)[0] || {};
    return { base, hover, count: rules.length };
  });
  assert('lyric-ask-is-a-lyric-line-not-a-pill',
    // 常态：无底/无描边/无圆角，上邻行色
    !askStyle.base.border && !askStyle.base.radius && !askStyle.base.background &&
    /var\(--lyric-near\)/.test(askStyle.base.color || ''),
    JSON.stringify(askStyle.base));
  assert('lyric-ask-hover-uses-lyric-current-glow',
    // 悬停：当前句色 + 600 + 同款光；不再有 surface 底 / hv-ring 灰环
    /var\(--lyric-current\)/.test(askStyle.hover.color || '') &&
    askStyle.hover.fontWeight === '600' &&
    /var\(--lyric-shadow\),\s*var\(--lyric-glow\)/.test(askStyle.hover.textShadow || '') &&
    !askStyle.hover.background && !/hv-ring/.test(askStyle.hover.boxShadow || ''),
    JSON.stringify(askStyle.hover));

  /* 占位词识别：纯音乐占位句（「这似乎是一首纯音乐呢」等）当空处理，不占歌词层 */
  const placeholder = await page.evaluate(() => {
    const D = window.__playerDebug;
    if (!D || typeof D.lyricIsPlaceholder !== 'function') return { ok: false, reason: 'no-hook' };
    const one = (t) => D.lyricIsPlaceholder([{ t: 0, text: t }]);
    return {
      ok: true,
      pure: one('这似乎是一首纯音乐呢，请尽情欣赏它吧！'),
      enjoy: one('纯音乐，请欣赏'),
      real: one('作词 : ACAね'),
      real2: one('おはよう　おつかれ')
    };
  });
  assert('lyric-placeholder-treated-as-empty',
    placeholder.ok === true && placeholder.pure === true && placeholder.enjoy === true &&
    placeholder.real === false && placeholder.real2 === false,
    JSON.stringify(placeholder));

  /* 音频反应链**只走 captureStream**（非破坏性副本）：同源拿数据、跨源抛错退回纯指针。
   * **绝不能**回到 createMediaElementSource —— 跨源会输出全零（静音）且不可逆。源码级守卫，去注释后再查。 */
  const codeNoComments = fs.readFileSync(path.join(uiDir, 'app.js'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert('reactive-uses-captureStream-not-mediaElementSource',
    /\.captureStream\s*\(/.test(codeNoComments) && !/createMediaElementSource\s*\(/.test(codeNoComments),
    JSON.stringify({ usesCaptureStream: /\.captureStream\s*\(/.test(codeNoComments), callsOldApi: /createMediaElementSource\s*\(/.test(codeNoComments) }));

  report.four = w2;
  await page.close();
}

}

/* ============ 涟漪音频分层：真实同源合成音频 → captureStream/FFT ============
 * 覆盖 RIPPLE-AUDIO-PLAN §7：持续 Bass 以游移脉冲激发光波、瞬态点短波、中频敲击走独立起音路径、
 * 静音不伪造、密集脉冲经合并受限、连续低频场能量有界、倍率只改观感、冻结/隐藏/降级无积压。
 * 直接驱动同一个 <audio>（同源 → captureStream 可读），走真实 play→resume→buildAudio→FFT。 */
if (!process.argv.includes('--song-only')) {
const rippleAudio = {};
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage({ teardown: true });
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(700);

  /* 播放一段合成音频并周期性采样涟漪音频态。 */
  const playSynth = (kind, seconds) => page.evaluate(async (k, secs) => {
    const D = window.__playerDebug;
    const audio = document.getElementById('audio');
    audio.pause();
    audio.loop = true;   // 防止播完触发自动切歌（夹具不在列表里，免得污染后续）
    audio.src = '/api/apps/hanako-simple-player/routes/_fixture/tone.wav?p=' + k + '&appSurfaceSession=fake-ticket';
    audio.load();
    await new Promise((r) => { const f = () => { audio.removeEventListener('loadedmetadata', f); r(); }; audio.addEventListener('loadedmetadata', f); setTimeout(r, 2000); });
    D.rippleClear();   // 夹具间彻底隔离：波包/场/包络/起音历史全清
    try { await window.__playerDebug.requestPlay('fixture'); } catch (e) { return { playErr: String(e) }; }
    // 等分析链就绪（captureStream 同源）
    for (let i = 0; i < 40 && !D.rippleAudio().ready; i++) await new Promise((r) => setTimeout(r, 50));
    const S = [];
    const t0 = performance.now();
    while (performance.now() - t0 < secs * 1000) {
      const a = D.rippleAudio(), st = D.rippleState();
      S.push({ signal: a.signal, activeAudioWaves: a.activeAudioWaves, t: +((performance.now() - t0) / 1000).toFixed(2), env: a.envBass, onsets: a.onsets, waves: a.waves, audioWaves: a.audioWaves, kinds: a.kinds, hFast: a.hFast, mFast: a.mFast, field: a.bassField, ready: a.ready, analysing: a.analysing });
      await new Promise((r) => setTimeout(r, 100));
    }
    audio.pause();
    return { S, vol: audio.volume, gain: D.rippleAudio().gain };
  }, kind, seconds);
  const agg = (r) => {
    const S = (r && r.S) || [];
    const max = (f) => S.length ? Math.max(...S.map(f)) : 0;
    /* 前后半峰值只作诊断，不作「有界」判据：预热后的头一两秒仍可能爬升，
       前半峰值偏低会使正常场假越线（整套复现 0.00174 → 0.00333，约 1.91 倍）。
       全采样（含预热）的绝对上限不依赖窗口切分，也能抓住快速饱和的坏版本；
       均值/中位数前后半比则会把这种坏版本放过（饱和后比值仍≈1.0）。 */
    const settled = S.filter((x) => x.t >= 1.5).map((x) => x.field);
    const half = Math.floor(settled.length / 2);
    const h1 = settled.slice(0, half), h2 = settled.slice(half);
    return {
      ready: S.length ? S[S.length - 1].ready : false,
      maxEnv: max((x) => x.env), lastEnv: S.length ? S[S.length - 1].env : 0,
      onsets: S.length ? S[S.length - 1].onsets : 0,
      kinds: S.length ? S[S.length - 1].kinds : null,
      maxLowRatio: max((x) => x.signal ? x.signal.lowRatio : 0), maxLowFlux: max((x) => x.signal ? x.signal.bf : 0), maxHFast: max((x) => x.hFast || 0), maxMFast: max((x) => x.mFast || 0),
      maxActiveAudioWaves: max((x) => x.activeAudioWaves || 0), maxWaves: max((x) => x.waves), maxAudioWaves: max((x) => x.audioWaves),
      fieldValid: S.length > 0 && S.every((x) => Number.isFinite(x.field) && x.field >= 0),
      maxField: max((x) => x.field),
      halfMaxFirst: h1.length ? Math.max(...h1) : 0,
      halfMaxLast: h2.length ? Math.max(...h2) : 0,
      settledN: settled.length
    };
  };

  // ① 持续 80Hz 低音：离散光波在线，预热后不误认鼓点或镲片
  //    采 9s，覆盖预热与夹具循环；100ms 采样的 bassField 才是真实能量，
  //    rippleState().field 在 inject() 时会置 1 作活动标记，不能拿它判断能量。
  const steady = agg(await playSynth('steady-bass', 9));
  rippleAudio.steady = steady;
  assert('ripple-steady-bass-pulses-light-without-false-beats',
    steady.ready === true && steady.maxEnv > 0.4 && steady.maxField > 1e-4 &&
    steady.onsets === 0 && steady.kinds.bass > 0,
    JSON.stringify(steady));

  // ② 明显底鼓：重复短脉冲产生有限细波，且预算是限的
  //    功能验证用「宽松档」（各门槛取量程下限）——默认档偏高（罐头偏好），
  //    夹具能量不够触发；检测路径是否完好要在宽档上验。默认档的克制见后面单独断言。
  await page.evaluate(() => window.__playerDebug.rippleSetTune({ bassThreshold: 0.004, beatThreshold: 0.005, hatThreshold: 0.0003 }));
  const kicks = agg(await playSynth('kicks', 5));
  rippleAudio.kicks = kicks;
  assert('ripple-kicks-produce-finite-short-waves',
    kicks.onsets >= 4 && kicks.maxAudioWaves >= 1 && kicks.maxActiveAudioWaves <= 14 && kicks.maxWaves <= 46,
    JSON.stringify(kicks));

  // ③ 中频敲击（1.2kHz，低频门限之外）：靠中频起音路径识别，低频包络保持低
  const mid = agg(await playSynth('mid-bursts', 5));
  rippleAudio.mid = mid;
  assert('ripple-mid-burst-onset-detected-outside-bass-gate',
    mid.onsets >= 4 && mid.maxEnv < 0.7 && mid.maxEnv < steady.maxEnv,
    JSON.stringify(mid));

  // ④ 同样总音量下，持续信号 vs 短脉冲 → 形态不同
  assert('ripple-steady-and-transient-shape-differ',
    steady.onsets === 0 && steady.kinds.bass > 0 && kicks.kinds.low >= 4 &&
    steady.maxField > 1e-4 && steady.maxEnv > kicks.maxEnv - 1,
    JSON.stringify({ steady: { w: steady.maxAudioWaves, e: steady.maxEnv }, kicks: { w: kicks.maxAudioWaves, e: kicks.maxEnv } }));

  // ④b 默认档（罐头偏好的高门槛）：同一组夹具默认不出波 —— 这是预期行为，不是失灵。
  //     默认值靠「克制」，而功能完整性由上面宽松档的断言保障。
  await page.evaluate(() => window.__playerDebug.rippleResetTune());
  const kicksDefault = agg(await playSynth('kicks', 5));
  assert('ripple-default-tune-is-restrained',
    kicksDefault.onsets === 0, JSON.stringify({ onsets: kicksDefault.onsets }));
  await page.evaluate(() => window.__playerDebug.rippleSetTune({ bassThreshold: 0.004, beatThreshold: 0.005, hatThreshold: 0.0003 }));

  // ⑤ 静音：不伪造周期鼓点，也没有水场
  const silence = agg(await playSynth('silence', 3));
  rippleAudio.silence = silence;
  assert('ripple-silence-fakes-no-beats',
    silence.onsets === 0 && silence.maxWaves === 0 && silence.maxEnv < 0.05 && silence.maxField < 1e-6,
    JSON.stringify(silence));

  // ⑥ 密集脉冲（每秒 8 个）：经冷却合并后满足波包预算
  const dense = agg(await playSynth('dense', 3));
  rippleAudio.dense = dense;
  assert('ripple-dense-pulses-merge-within-budget',
    dense.maxActiveAudioWaves <= 14 && dense.maxWaves <= 46 && dense.onsets <= 10 && dense.onsets >= 3,
    JSON.stringify(dense));

  // ⑥b 踩镲（5.2kHz 高频段）：高频起音路径能识别，出 high 类短波
  const hihats = agg(await playSynth('hihats', 5));
  rippleAudio.hihats = hihats;
  assert('ripple-hihats-trigger-high-waves',
    hihats.ready === true && hihats.kinds && hihats.kinds.high >= 3 && hihats.kinds.low === 0 && hihats.maxAudioWaves >= 1,
    JSON.stringify(hihats));

  // ⑥c 鼓点门槛：同一夹具在高门槛不出波，降低门槛后出波。
  //    用 normal mid-bursts 夹具（weak-mid 能量太低，新旧量程下界拉高后已不够触发）；
  //    「严格档」取量程上限，「宽松档」取量程下限。
  await page.evaluate(() => window.__playerDebug.rippleSetTune({ beatThreshold: 0.036 }));
  const weakStrict = agg(await playSynth('mid-bursts', 4));
  await page.evaluate(() => window.__playerDebug.rippleSetTune({ beatThreshold: 0.005, hatThreshold: 0.0003 }));
  const weakLoose = agg(await playSynth('mid-bursts', 4));
  await page.evaluate(() => window.__playerDebug.rippleResetTune());
  rippleAudio.beatThreshold = { weakStrict: weakStrict.onsets, weakLoose: weakLoose.onsets };
  assert('ripple-beat-threshold-lower-produces-more-events',
    weakStrict.onsets === 0 && weakLoose.onsets >= 3,
    JSON.stringify({ strict: weakStrict.onsets, loose: weakLoose.onsets }));

  // ⑥d 最低门槛仍不误触：稳态低音只有光波，静音零波
  await page.evaluate(() => window.__playerDebug.rippleSetTune({ beatThreshold: 0.005, hatThreshold: 0.0003 }));
  const steadyMax = agg(await playSynth('steady-bass', 5));
  const silenceMax = agg(await playSynth('silence', 3));
  await page.evaluate(() => window.__playerDebug.rippleResetTune());
  rippleAudio.maxSensQuiet = { steady: steadyMax.onsets, silence: silenceMax.onsets };
  assert('ripple-lowest-thresholds-keep-steady-and-silence-quiet',
    steadyMax.onsets === 0 && steadyMax.kinds.bass > 0 &&
    silenceMax.onsets === 0 && silenceMax.maxWaves === 0,
    JSON.stringify({ steady: steadyMax.onsets, silence: silenceMax.onsets }));

  // ⑥e 音频环沿用演示圈数预算，bass 只画光
  const ringLayers = await page.evaluate(() => ({
    bass: window.__playerDebug.rippleRingLayers('bass'),
    low: window.__playerDebug.rippleRingLayers('low'),
    mid: window.__playerDebug.rippleRingLayers('mid'),
    high: window.__playerDebug.rippleRingLayers('high')
  }));
  rippleAudio.ringLayers = ringLayers;
  assert('ripple-audio-ring-layers-match-approved-demo',
    ringLayers.bass === 0 && ringLayers.low >= 3 && ringLayers.low <= 9 && ringLayers.mid >= 3 && ringLayers.mid <= 9 && ringLayers.high >= 3 && ringLayers.high <= 6,
    JSON.stringify(ringLayers));

  // ⑥f bass 光波必须真画得出来：喂持续低频后，canvas 上要有足够亮的像素。
  //     历史上亮度公式太低（封顶后的场 × 小乘子 → alpha 只有个位数/255），肉眼看不见。
  //     宽松档 + 满浓淡下验证（默认档门槛高、浓淡 60%，光波更淡；
  //     这条测的是「亮度公式够不够看」，应与默认档解耦）。
  await page.evaluate(() => window.__playerDebug.rippleSetTune({ bassThreshold: 0.004, beatThreshold: 0.005, hatThreshold: 0.0003, bassOpacity: 1 }));
  const glow = await page.evaluate(async () => {
    const D = window.__playerDebug, audio = document.getElementById('audio');
    audio.pause(); audio.loop = true;
    audio.src = '/api/apps/hanako-simple-player/routes/_fixture/tone.wav?p=steady-bass&appSurfaceSession=fake-ticket&g=' + Math.random();
    audio.load();
    await new Promise((r) => { const f = () => { audio.removeEventListener('loadedmetadata', f); r(); }; audio.addEventListener('loadedmetadata', f); setTimeout(r, 1500); });
    D.rippleClear();
    try { await window.__playerDebug.requestPlay('fixture'); } catch (e) { return { playErr: String(e) }; }
    for (let i = 0; i < 40 && !D.rippleAudio().ready; i++) await new Promise((r) => setTimeout(r, 50));
    // 采多帧取峰值：高度场是周期性松弛振荡，单帧会撞谷底（实测同配置单帧可差 30 倍）。
    const cv = document.getElementById('rippleCanvas');
    const cols = D.rippleState().cols;
    let maxA = 0, bright = 0;
    // 分区亮度（防 attMask 只让歌词遮罩区有光波的老 bug）：左半 vs 右半
    let leftPeak = 0, rightPeak = 0;
    for (let n = 0; n < 45; n++) {
      await new Promise((r) => setTimeout(r, 100));
      const W = cv.width, H = cv.height;
      const px = cv.getContext('2d').getImageData(0, 0, W, H).data;
      let ma = 0, br = 0, lpk = 0, rpk = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const a = px[(y * W + x) * 4 + 3];
          if (a > ma) ma = a;
          if (a > 60) br++;
          if (x < W / 2) { if (a > lpk) lpk = a; } else { if (a > rpk) rpk = a; }
        }
      }
      if (ma > maxA) maxA = ma;
      if (br > bright) bright = br;
      if (lpk > leftPeak) leftPeak = lpk;
      if (rpk > rightPeak) rightPeak = rpk;
    }
    audio.pause();
    return { maxAlpha: maxA, brightPx: bright, leftPeak, rightPeak, field: D.rippleState().field };
  });
  rippleAudio.glow = glow;
  assert('ripple-bass-glow-actually-visible',
    !glow.playErr && glow.maxAlpha >= 40,
    JSON.stringify(glow));
  // 光波要在封面区也画得出来（掩膜不能把封面区抹掉）。
  // 历史上 attMask 默认全 0、只给歌词区赋值，封面区 att=0 → 光波被整片抹掉。
  // 功能上很难在无词夹具里复现（attMask 只在有词且歌词层可见时才构建），
  // 所以这里用**源码级守卫**：attMask 分配后必须先 fill(1) 再逐格降。
  {
    const srcGlow = fs.readFileSync(path.join(uiDir, 'app.js'), 'utf-8');
    const seg = (srcGlow.split('function computeAttMask')[1] || '').split('function ')[0];
    const allocIdx = seg.indexOf('attMask = new Float32Array');
    const fillIdx = seg.indexOf('attMask.fill(1)');
    assert('ripple-attmask-defaults-to-full-strength',
      allocIdx >= 0 && fillIdx > allocIdx,
      `alloc@${allocIdx} fill@${fillIdx}`);
  }

  // 离散脉冲定稿提高了实际场幅度；465px 实测峰值约 .28，旧 .005 是持续微注入版本。
  // .4 上限覆盖相位差，保留有限能量判据；同注入/网格的无阻尼反例峰值约 6.9。
  assert('ripple-continuous-bass-field-bounded',
    steady.settledN >= 8 && steady.fieldValid && steady.maxField < 0.4,
    JSON.stringify({ max: steady.maxField, fieldValid: steady.fieldValid, halfMaxFirst: steady.halfMaxFirst,
      halfMaxLast: steady.halfMaxLast, settledN: steady.settledN }));

  // ⑧ 倍率只改观感：不动音量、不参与起音路径（源码级守卫 §5 陷阱）
  const gainRuntime = await page.evaluate(() => {
    const D = window.__playerDebug, audio = document.getElementById('audio');
    const before = { vol: audio.volume, gain: D.rippleAudio().gain };
    D.rippleSetGain(3.0);
    const after = { vol: audio.volume, gain: D.rippleAudio().gain };
    D.rippleSetGain(2.6);
    return { before, after, restored: D.rippleAudio().gain };
  });
  rippleAudio.gain = gainRuntime;
  const codeNC = fs.readFileSync(path.join(uiDir, 'app.js'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const injectBody = (codeNC.split('function inject(')[1] || '').split('\n    }')[0];
  const readBody = (codeNC.split('function readSignal(')[1] || '').split('\n    }')[0];
  assert('ripple-visual-gain-changes-look-only',
    gainRuntime.before.vol === gainRuntime.after.vol &&
    gainRuntime.after.gain === 3 && gainRuntime.restored === 2.6 &&
    !/visualGain|Opacity/.test(injectBody) && !/visualGain|Opacity/.test(readBody),
    JSON.stringify({ gainRuntime, injectHasGain: /VISUAL_GAIN/.test(injectBody), readHasGain: /VISUAL_GAIN/.test(readBody) }));

  // ⑨ 截图冻结 / reduced-motion：分析调度真停；恢复后无积压突发
  const freeze = await page.evaluate(async () => {
    const D = window.__playerDebug, audio = document.getElementById('audio');
    try { await window.__playerDebug.requestPlay('fixture'); } catch (e) {}
    await new Promise((r) => setTimeout(r, 300));
    const playing = { analysing: D.rippleAudio().analysing, onsets: D.rippleAudio().onsets };
    document.body.classList.add('is-shot');
    window.__playerDebug.rippleResetAnalysis();   // 不推进波龄；仅让下一次 sync 生效
    document.getElementById('player').dispatchEvent(new Event('x'));
    await new Promise((r) => setTimeout(r, 250));
    const frozen = { analysing: D.rippleAudio().analysing, onsets: D.rippleAudio().onsets };
    document.body.classList.remove('is-shot');
    await new Promise((r) => setTimeout(r, 400));
    const resumed = { analysing: D.rippleAudio().analysing, onsets: D.rippleAudio().onsets };
    audio.pause();
    return { playing, frozen, resumed };
  });
  rippleAudio.freeze = freeze;
  assert('ripple-shot-freeze-stops-analysis',
    freeze.frozen.analysing === false,
    JSON.stringify(freeze));

  // ⑩ 跨源 / 不支持：captureStream 抛错 → 退回纯指针，仍出声、无运行时错误
  const degrade = await page.evaluate(async () => {
    const D = window.__playerDebug, audio = document.getElementById('audio');
    const proto = HTMLMediaElement.prototype;
    const real = proto.captureStream;
    let threw = false;
    proto.captureStream = function () { threw = true; throw new DOMException('SecurityError'); };
    audio.pause();
    audio.src = '/api/apps/hanako-simple-player/routes/_fixture/tone.wav?p=kicks&appSurfaceSession=fake-ticket&x=' + Math.random();
    audio.load();
    await new Promise((r) => { const f = () => { audio.removeEventListener('loadedmetadata', f); r(); }; audio.addEventListener('loadedmetadata', f); setTimeout(r, 1500); });
    let played = false;
    try { await window.__playerDebug.requestPlay('fixture'); played = !audio.paused; } catch (e) { played = false; }
    await new Promise((r) => setTimeout(r, 600));
    const st = D.rippleAudio();
    audio.pause();
    proto.captureStream = real;
    return { threw, played, ready: st.ready };
  });
  rippleAudio.degrade = degrade;
  assert('ripple-crosssource-degrades-without-silencing',
    degrade.threw === true && degrade.played === true && degrade.ready === false,
    JSON.stringify(degrade));

  // ⑪ 三层配色：bass/kick/mid/hat 各自成色，且都与封面环境色保对比、色相各异
  const layerColors = await page.evaluate(() => {
    const D = window.__playerDebug;
    const st = D.rippleState();
    const cs = getComputedStyle(document.getElementById('player'));
    const readVar = (n) => {
      const s = cs.getPropertyValue(n).trim();
      const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(s);
      return m ? [+m[1], +m[2], +m[3]] : null;
    };
    return {
      colors: st.colors,
      vars: { bass: readVar('--rl-bass'), kick: readVar('--rl-kick'), mid: readVar('--rl-mid'), hat: readVar('--rl-hat') },
      ambient: (() => { const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(cs.getPropertyValue('--ambient-color').trim()); return m ? [+m[1], +m[2], +m[3]] : null; })(),
      surface: (() => { const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(getComputedStyle(document.documentElement).getPropertyValue('--hk-surface').trim()); return m ? [+m[1], +m[2], +m[3]] : null; })(),
      ambientOk: document.getElementById('player').classList.contains('ambient-ok')
    };
  });
  report.layerColors = layerColors;
  const _layHas = (c) => Array.isArray(c) && c.length === 3;
  // ① 四层颜色互不相同（同色 = 没分层）
  const _same = (a, b) => _layHas(a) && _layHas(b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  assert('ripple-layer-colors-distinct',
    _layHas(layerColors.colors && layerColors.colors.bass) &&
    !_same(layerColors.colors.bass, layerColors.colors.kick) &&
    !_same(layerColors.colors.kick, layerColors.colors.mid) &&
    !_same(layerColors.colors.mid, layerColors.colors.hat),
    JSON.stringify(layerColors.colors));
  // ② CSS 变量与运行时取色一致（接线没错位）—— 不比 ambient，只比变量 vs 运行时
  assert('ripple-layer-color-vars-wired',
    !!layerColors.vars.bass &&
    _same(layerColors.vars.bass, layerColors.colors.bass) &&
    _same(layerColors.vars.hat, layerColors.colors.hat),
    JSON.stringify({ vars: layerColors.vars, runtime: layerColors.colors }));
  // ③ 三层色相都从歌词色错开（不跟歌词混）—— 纯函数直接验派生数学（不依赖页面状态）
  const hueCheck = await page.evaluate(() => {
    const D = window.__playerDebug;
    const covers = [[27, 34, 51], [47, 111, 120], [110, 106, 58], [236, 229, 216], [242, 217, 224], [85, 96, 106]];
    const toHsl = (c) => { const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; const l = (mx + mn) / 2; if (d > 1e-6) { if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; } return h; };
    const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
    const minOff = { bass: 999, kick: 999, mid: 999, hat: 999 };
    const minCt = { bass: 999, kick: 999, mid: 999, hat: 999 };
    for (const c of covers) {
      const lum = 0.2126 * (c[0] / 255) + 0.7152 * (c[1] / 255) + 0.0722 * (c[2] / 255);
      const pol = lum > 0.5 ? 'light' : 'dark';
      const acc = D.rippleAccentFrom(c, pol);   // 与生产同一条派生路径
      const pal = D.ripplePalette(acc, c, pol);
      const accH = toHsl(acc);
      for (const k of ['bass', 'kick', 'mid', 'hat']) {
        minOff[k] = Math.min(minOff[k], hueDist(toHsl(pal[k]), accH));
        minCt[k] = Math.min(minCt[k], D.contrastOf(pal[k], c));
      }
    }
    return { minOff, minCt };
  });
  report.layerHueCheck = hueCheck;
  assert('ripple-layer-hue-offset-from-lyric',
    hueCheck.minOff.bass >= 20 && hueCheck.minOff.kick >= 10 &&
    hueCheck.minOff.mid >= 20 && hueCheck.minOff.hat >= 40,
    JSON.stringify(hueCheck.minOff));
  // ④ 任何封面主色下，四层都与背景保对比 ≥ 3.8（细线要狠对比；新下限 4.0）
  assert('ripple-layer-colors-survive-background',
    Math.min(hueCheck.minCt.bass, hueCheck.minCt.kick, hueCheck.minCt.mid, hueCheck.minCt.hat) >= 3.8,
    JSON.stringify(hueCheck.minCt));

  report.rippleAudio = rippleAudio;
  await page.close();
}

/* ============ 涟漪参数「玩具箱」面板（仅宽窗）：开合 / 三组门槛与浓淡 / 实时 / 存储 ============ */
const rippleTool = {};
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  // 假宿主：拦 window.hana 赋值，给 storage.global 装一个可读可写的桩
  await page.evaluateOnNewDocument(() => {
    window.__storeCalls = { sets: [], gets: [] };
    window.__preset = { visualGain: 2.2, bassDrive: 14, onsetSens: 1.5, midHighSens: 2.4, maxAudioWaves: 5, onsetCooldown: 640 };
    let _h;
    Object.defineProperty(window, 'hana', {
      configurable: true,
      get() { return _h; },
      set(v) {
        _h = v;
        if (v && v.storage && v.storage.global) {
          v.storage.global.get = function (key) {
            window.__storeCalls.gets.push(key);
            return Promise.resolve(key === 'player-ripple-tune' ? window.__preset : null);
          };
          v.storage.global.set = function (key, value) { window.__storeCalls.sets.push({ key: key, value: value }); return Promise.resolve(); };
        }
      }
    });
  });
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/standalone.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(900);

  const legacy = await page.evaluate(() => ({ tune: window.__playerDebug.rippleTune(), defaults: window.__playerDebug.rippleTuneDefaults(), writes: window.__storeCalls.sets.filter(s => s.key === 'player-ripple-tune') }));
  assert('ripple-tool-legacy-settings-use-new-defaults-without-writing', JSON.stringify(legacy.tune) === JSON.stringify(legacy.defaults) && legacy.writes.length === 0, JSON.stringify(legacy));
  const btnInfo = () => page.evaluate(() => {
    const btn = document.getElementById('rippleToolBtn');
    const cs = btn ? getComputedStyle(btn) : null;
    const pop = document.getElementById('rippleToolPop');
    const ripple = document.getElementById('rippleCanvas');
    const rc = ripple ? getComputedStyle(ripple).zIndex : null;
    return {
      exists: !!btn, display: cs && cs.display, opacity: cs && +cs.opacity,
      btnZ: cs && cs.zIndex, rippleZ: rc,
      isPop: pop && pop.classList.contains('pop'),
      bg: pop && getComputedStyle(pop).backgroundColor,
      border: pop && getComputedStyle(pop).borderTopWidth,
      shadow: pop && getComputedStyle(pop).boxShadow,
      hidden: pop && pop.hidden,
      ranges: document.querySelectorAll('#rippleToolPop .rt-range').length,
      labels: [...document.querySelectorAll('#rippleToolPop .rt-label')].map((e) => e.textContent.replace(/\s*[\d.]+\s*(ms)?$/, '').trim()),
      hasReset: !!document.getElementById('rtResetBtn'),
      note: (document.querySelector('#rippleToolPop .pop-note') || {}).textContent || ''
    };
  });

  // ① 宽窗专属：宽窗可见，长卡/窄卡隐藏
  const wide = await btnInfo();
  rippleTool.wide = wide;
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 }); await sleep(400);
  const longInfo = await btnInfo();
  await page.setViewport({ width: 312, height: 494, deviceScaleFactor: 1 }); await sleep(400);
  const compactInfo = await btnInfo();
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 }); await sleep(400);
  assert('ripple-tool-wide-only',
    wide.display !== 'none' && longInfo.display === 'none' && compactInfo.display === 'none',
    JSON.stringify({ wide: wide.display, long: longInfo.display, compact: compactInfo.display }));

  // ② 常态半透明 + z 高于涟漪画布
  assert('ripple-tool-opacity-and-z',
    Math.abs(wide.opacity - 0.45) < 0.02 && +wide.btnZ > +wide.rippleZ,
    JSON.stringify({ opacity: wide.opacity, btnZ: wide.btnZ, rippleZ: wide.rippleZ }));

  // ③ 面板复用 .pop 皮（背景/描边/阴影来自 --hk-* 变量，不另起一套）
  assert('ripple-tool-pop-reuses-pop-skin',
    wide.isPop === true && wide.bg && wide.bg !== 'rgba(0, 0, 0, 0)' &&
    parseFloat(wide.border) > 0 && wide.shadow && wide.shadow !== 'none',
    JSON.stringify({ isPop: wide.isPop, bg: wide.bg, border: wide.border, shadow: wide.shadow }));

  // ④ 点图标开、Esc 关、点外部关
  const openClose = await page.evaluate(async () => {
    const pop = document.getElementById('rippleToolPop');
    document.getElementById('rippleToolBtn').click();
    await new Promise((r) => setTimeout(r, 50));
    const opened = !pop.hidden;
    const expanded = document.getElementById('rippleToolBtn').getAttribute('aria-expanded');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    const afterEsc = pop.hidden;
    document.getElementById('rippleToolBtn').click();
    await new Promise((r) => setTimeout(r, 50));
    const reopened = !pop.hidden;
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    const afterOutside = pop.hidden;
    return { opened, expanded, afterEsc, reopened, afterOutside };
  });
  rippleTool.openClose = openClose;
  assert('ripple-tool-opens-and-closes',
    openClose.opened && openClose.expanded === 'true' && openClose.afterEsc &&
    openClose.reopened && openClose.afterOutside,
    JSON.stringify(openClose));

  // ⑤ 6 滑杆 + 重置 + 说明齐全；点重置回默认
  const resetInfo = await page.evaluate(async () => {
    document.getElementById('rippleToolBtn').click();
    await new Promise((r) => setTimeout(r, 40));
    // 先改一个值再重置
    const el = document.getElementById('rt_bassOpacity');
    el.value = '180'; el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    const changed = window.__playerDebug.rippleTune().bassOpacity;
    document.getElementById('rtResetBtn').click();
    await new Promise((r) => setTimeout(r, 40));
    const t = window.__playerDebug.rippleTune();
    const d = window.__playerDebug.rippleTuneDefaults();
    return { changed, tune: t, defaults: d, out: document.getElementById('rtv_bassOpacity').textContent };
  });
  rippleTool.reset = resetInfo;
  assert('ripple-tool-six-sliders-and-reset',
    wide.ranges === 6 && wide.hasReset === true && wide.note.length > 12 &&
    resetInfo.changed === 1.8 &&
    JSON.stringify(resetInfo.tune) === JSON.stringify(resetInfo.defaults),
    JSON.stringify({ ranges: wide.ranges, hasReset: wide.hasReset, noteLen: wide.note.length, changed: resetInfo.changed, tune: resetInfo.tune }));

  // ⑥ 拖「镲片浓淡」实时生效：alpha 变、音量不变、起音计数不变
  const gainLive = await page.evaluate(async () => {
    const D = window.__playerDebug, audio = document.getElementById('audio');
    const before = { gain: D.rippleTune().hatOpacity, vol: audio.volume, onsets: D.rippleAudio().onsets };
    const el = document.getElementById('rt_hatOpacity');
    el.value = '90'; el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const after = { gain: D.rippleTune().hatOpacity, vol: audio.volume, onsets: D.rippleAudio().onsets };
    return { before, after };
  });
  rippleTool.gainLive = gainLive;
  assert('ripple-tool-slider-live-and-volume-untouched',
    gainLive.after.gain === 0.9 && gainLive.before.vol === gainLive.after.vol &&
    gainLive.before.onsets === gainLive.after.onsets,
    JSON.stringify(gainLive));

  // 三组门槛通过真实 input 接线，浓淡和音量不随之改变。
  const tuneApply = await page.evaluate(() => {
    const D = window.__playerDebug, audio = document.getElementById('audio'), vol = audio.volume;
    [['bassThreshold','0.02'],['beatThreshold','0.03'],['hatThreshold','0.002']].forEach(([k,v]) => {
      const el = document.getElementById('rt_' + k); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const t = D.rippleTune(); D.rippleResetTune(); return { t, volSame: audio.volume === vol };
  });
  rippleTool.tuneApply = tuneApply;
  assert('ripple-tool-slider-affects-tuning', tuneApply.t.bassThreshold === 0.02 && tuneApply.t.beatThreshold === 0.03 && tuneApply.t.hatThreshold === 0.002 && tuneApply.volSame, JSON.stringify(tuneApply));

  // ⑧ 沉浸时随控制条淡出（data-controls-hidden 在 .player 上）
  const immersive = await page.evaluate(async () => {
    const player = document.getElementById('player');
    const btn = document.getElementById('rippleToolBtn');
    const before = { opacity: +getComputedStyle(btn).opacity, pe: getComputedStyle(btn).pointerEvents };
    player.setAttribute('data-controls-hidden', '1');
    await new Promise((r) => setTimeout(r, 260));
    const hidden = { opacity: +getComputedStyle(btn).opacity, pe: getComputedStyle(btn).pointerEvents };
    player.setAttribute('data-controls-hidden', '0');
    await new Promise((r) => setTimeout(r, 260));
    const back = { opacity: +getComputedStyle(btn).opacity };
    return { before, hidden, back };
  });
  rippleTool.immersive = immersive;
  assert('ripple-tool-hidden-when-controls-hidden',
    immersive.before.opacity > 0.3 && immersive.hidden.opacity < 0.05 && immersive.hidden.pe === 'none' && immersive.back.opacity > 0.3,
    JSON.stringify(immersive));

  // ⑨ 截图模式隐藏（is-shot 在 body 上）
  const shotInfo = await page.evaluate(async () => {
    const btn = document.getElementById('rippleToolBtn');
    const before = getComputedStyle(btn).display;
    document.body.classList.add('is-shot');
    await new Promise((r) => setTimeout(r, 60));
    const shot = getComputedStyle(btn).display;
    document.body.classList.remove('is-shot');
    await new Promise((r) => setTimeout(r, 60));
    const after = getComputedStyle(btn).display;
    return { before, shot, after };
  });
  rippleTool.shot = shotInfo;
  assert('ripple-tool-hidden-in-shot',
    shotInfo.before !== 'none' && shotInfo.shot === 'none' && shotInfo.after !== 'none',
    JSON.stringify(shotInfo));

  // 实际可访问名称和方向提示：所有滑杆都明确标出向左/右的含义。
  const plain = await page.evaluate(() => ({
    groups: [...document.querySelectorAll('.rt-group legend')].map(e => e.textContent),
    inputs: [...document.querySelectorAll('#rippleToolPop input')].map(e => ({name:e.getAttribute('aria-label'),hint:document.getElementById(e.getAttribute('aria-describedby')).textContent})),
    old: !!document.querySelector('#rt_visualGain,#rt_bassDrive,#rt_onsetSens,#rt_midHighSens,#rt_maxAudioWaves,#rt_onsetCooldown')
  }));
  assert('ripple-tool-names-and-slider-directions', !plain.old && plain.groups.length === 3 && plain.inputs.length === 6 && plain.inputs.every(e => /触发门槛|颜色浓淡/.test(e.name) && /低门槛 · 更多.*高门槛 · 更少|更浅、更淡.*更深、更浓/.test(e.hint)), JSON.stringify(plain));
  await page.screenshot({path:path.join(outDir, 'ripple-toybox-production.png')});

  // ⑪ 存储：改值 → 去抖后写入 player-ripple-tune（读假宿主记录的 set 调用）
  const saved = await page.evaluate(async () => {
    const el = document.getElementById('rt_bassThreshold');
    el.value = '0.008'; el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));   // 等过去抖（300ms）
    const sets = (window.__storeCalls && window.__storeCalls.sets) || [];
    const hit = sets.filter((s) => s.key === 'player-ripple-tune').pop();
    return { tune: window.__playerDebug.rippleTune().bassThreshold, wroteKey: !!hit, wroteVal: hit && hit.value && hit.value.bassThreshold };
  });
  rippleTool.saved = saved;
  assert('ripple-tool-persists-to-storage',
    saved.tune === 0.008 && saved.wroteKey === true && saved.wroteVal === 0.008,
    JSON.stringify(saved));

  await page.close();
}

/* ⑫ 存储恢复：预置 player-ripple-tune → boot 读到后 tune 反映该值（走真读存储路径） */
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  // 假宿主：拦 window.hana 赋值，给 storage.global 装桩；player-ripple-tune 返回预置值
  await page.evaluateOnNewDocument(() => {
    window.__storeCalls = { sets: [], gets: [] };
    window.__preset = { schemaVersion: 2, bassThreshold: 0.02, beatThreshold: 0.03, hatThreshold: 0.002, bassOpacity: 1.0, beatOpacity: 0.15, hatOpacity: 0.08 };
    let _h;
    Object.defineProperty(window, 'hana', {
      configurable: true,
      get() { return _h; },
      set(v) {
        _h = v;
        if (v && v.storage && v.storage.global) {
          v.storage.global.get = function (key) {
            window.__storeCalls.gets.push(key);
            return Promise.resolve(key === 'player-ripple-tune' ? window.__preset : null);
          };
          v.storage.global.set = function (key, value) { window.__storeCalls.sets.push({ key: key, value: value }); return Promise.resolve(); };
        }
      }
    });
  });
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/standalone.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(1000);   // 等 sdkReady.then 的存储读取落地
  const restore = await page.evaluate(() => ({
    t: window.__playerDebug.rippleTune(),
    askedKey: window.__storeCalls.gets.indexOf('player-ripple-tune') >= 0,
    out: document.getElementById('rtv_bassOpacity') ? document.getElementById('rtv_bassOpacity').textContent : null
  }));
  assert('ripple-tool-restores-from-storage',
    restore.askedKey === true && restore.t.schemaVersion === 2 && restore.t.bassThreshold === 0.02 && restore.t.beatThreshold === 0.03 && restore.t.hatThreshold === 0.002 && restore.t.bassOpacity === 1.0 && restore.t.beatOpacity === 0.15 && restore.t.hatOpacity === 0.08,
    JSON.stringify(restore));
  const bounds = await page.evaluate(() => {
    const D=window.__playerDebug, before=D.rippleTune();
    const unknown=D.rippleSetTune({schemaVersion:3,bassThreshold:1});
    const partial=D.rippleSetTune({schemaVersion:2,bassThreshold:-1,beatThreshold:Infinity,hatThreshold:9,bassOpacity:NaN,hatOpacity:9});
    return {before,unknown,partial};
  });
  assert('ripple-tune-version-and-finite-bounds', JSON.stringify(bounds.before)===JSON.stringify(bounds.unknown) && bounds.partial.bassThreshold===.004 && bounds.partial.hatThreshold===.0036 && bounds.partial.hatOpacity===1.8 && bounds.partial.beatThreshold===bounds.before.beatThreshold && bounds.partial.bassOpacity===bounds.before.bassOpacity,JSON.stringify(bounds));
  await page.close();
}

}

/* 真实歌曲仅从用户指定的本地文件读取；文件不进入 ui/ 或发布包。 */
if (process.env.RIPPLE_SONG) {
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  persistedPlaylist = [{ id:'netease:2074315223', name:'花一匁', author:'ずっと真夜中でいいのに。', list:'imp:1', group:'在线音乐', mode:'在线', dur:251,
    url: `${API}/_fixture/real-song.m4a`, pic:`${API}/_fixture/hanaichimonme-cover.jpg` }];
  const page = await newPage();
  await page.setViewport({width:1040,height:780,deviceScaleFactor:1});
  await page.goto(`${UI_BASE}/standalone.html?appSurfaceSession=fake-ticket`, {waitUntil:'domcontentloaded'});
  await sleep(700); await page.click('#queueBtn'); await sleep(380); await clickTab(page,'imp:1');
  await page.click('#queueList .q-hit');
  if (await page.$eval('#player', e=>e.getAttribute('data-drawer')==='1')) await page.click('#queueBtn');
  await page.waitForFunction(() => !document.getElementById('audio').paused && window.__playerDebug.rippleAudio().ready);
  await sleep(12000);
  const baseline = await page.evaluate(() => ({ audio:window.__playerDebug.rippleAudio(), state:window.__playerDebug.rippleState(), tune:window.__playerDebug.rippleTune(), time:document.getElementById('audio').currentTime }));
  /* 默认档（罐头偏好的高门槛）：真歌也克制——三组都不该大量出波。
     这是路线甲的预期，不是失灵；接下来拉松到宽松档再验识别链路完好。 */
  assert('ripple-real-song-restrained-by-default',
    baseline.time >= 10 && baseline.audio.kinds.bass + baseline.audio.kinds.low + baseline.audio.kinds.mid + baseline.audio.kinds.high <= 3,
    JSON.stringify({ kinds: baseline.audio.kinds, time: baseline.time }));
  // 拉松到宽松档后，三组都要在真实歌曲上识别出来。
  const loosened = await page.evaluate(async () => {
    const D=window.__playerDebug, a=document.getElementById('audio');
    D.rippleResetTune(); D.rippleSetTune({ bassThreshold:0.004, beatThreshold:0.005, hatThreshold:0.0003 });
    D.rippleClear(); a.currentTime = 0; await new Promise(r=>a.addEventListener('seeked',r,{once:true}));
    await D.requestPlay('fixture'); await new Promise(r=>setTimeout(r,12000));
    return { audio:D.rippleAudio(), time:a.currentTime };
  });
  assert('ripple-real-song-all-three-groups-trigger',
    loosened.time >= 10 && loosened.audio.kinds.bass > 0 && loosened.audio.kinds.low + loosened.audio.kinds.mid > 0 && loosened.audio.kinds.high >= 10,
    JSON.stringify(loosened));
  // 在同一 JS 帧重画：检测、队列和波场都冻结于同一采样，只有 alpha 应改变。
  const opacity = await page.evaluate(() => {
    const D=window.__playerDebug, cv=document.getElementById('rippleCanvas'), ctx=cv.getContext('2d'), audio=document.getElementById('audio');
    const sumAlpha=()=>{const data=ctx.getImageData(0,0,cv.width,cv.height).data;let sum=0;for(let i=3;i<data.length;i+=4)sum+=data[i];return sum;};
    const state=()=>JSON.stringify({field:D.rippleState().field, kinds:D.rippleAudio().kinds, waves:D.rippleState().waves, volume:audio.volume, time:audio.currentTime});
    const results={};
    ['bass','beat','hat'].forEach(k=>{
      const before=state(), field=k+'Opacity';
      const render=(value)=>{
        D.rippleSetTune({[field]:value});
        if(k==='bass') return sumAlpha();
        const real=ctx.stroke, alphas=[];ctx.stroke=function(){alphas.push(ctx.globalAlpha);return real.apply(this,arguments);};
        try{D.rippleRingLayers(k==='hat'?'high':'low');}finally{ctx.stroke=real;}
        return alphas.reduce((x,y)=>x+y,0);
      };
      const maxOp={bass:1.8,beat:1.8,hat:1.8}[k];
      const light=render(maxOp/6),deep=render(maxOp),after=state();
      results[k]={light,deep,unchanged:before===after};D.rippleResetTune();
    });return results;
  });
  assert('ripple-all-opacity-controls-change-alpha-only', Object.values(opacity).every(x=>x.deep>x.light && x.unchanged),JSON.stringify(opacity));
  await page.click('#rippleToolBtn');
  await page.screenshot({path:path.join(outDir,'ripple-real-song-production.png')});
  const runs={};
  for (const [group,key,lo,hi] of [['bass','bassThreshold',.004,.028],['beat','beatThreshold',.005,.036],['hat','hatThreshold',.0003,.0036]]) {
    runs[group]={};
    for(const [label,value] of [['more',lo],['fewer',hi]]) {
      runs[group][label]=await page.evaluate(async (key,value,group)=>{
        const D=window.__playerDebug,a=document.getElementById('audio');a.pause();D.rippleResetTune();D.rippleSetTune({[key]:value});
        a.currentTime=1;await new Promise(r=>a.addEventListener('seeked',r,{once:true}));D.rippleClear();await D.requestPlay('fixture');
        await new Promise(r=>setTimeout(r,8000));const k=D.rippleAudio().kinds;a.pause();return group==='beat'?k.low+k.mid:group==='hat'?k.high:k.bass;
      },key,value,group);
    }
    assert('ripple-real-song-'+group+'-threshold-direction',runs[group].more>runs[group].fewer,JSON.stringify(runs[group]));
  }
  await sleep(650);
  const paused=await page.evaluate(()=>({state:window.__playerDebug.rippleState(),audio:window.__playerDebug.rippleAudio()}));
  assert('ripple-real-song-pause-clears-residue',paused.state.waves===0 && paused.state.field===0 && !paused.state.raf && !paused.audio.analysing,JSON.stringify(paused));
  report.rippleSong={baseline,opacity,runs,paused};
  await page.close();
}

if (process.argv.includes('--ripple-only') || process.argv.includes('--song-only')) {
  fs.writeFileSync(path.join(outDir, 'verify-ripple.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ assertions: `${report.assertions.filter(a => a.ok).length}/${report.assertions.length}`, failed: report.assertions.filter(a => !a.ok), rippleAudio: report.rippleAudio, runtimeErrors: report.runtimeErrors, outDir }, null, 2));
  await browser.close(); server.closeAllConnections(); server.close();
  process.exit(report.assertions.some(a => !a.ok) || report.runtimeErrors.length ? 1 : 0);
}

/* ============ 歌词校准：真鼠标长按/拖动 + 真媒体时钟 + playlist 持久化 ============ */
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=align&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  const entry = `${UI_BASE}/standalone.html?appSurfaceSession=fake-ticket`;
  await page.goto(entry, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__fixtureTheme('light'));
  const ready = () => page.waitForFunction(() => window.__playerDebug && window.__playerDebug.lyricAlignState().base === 250 && document.getElementById('audio').duration > 0);
  await ready();
  const info = () => page.evaluate(() => window.__playerDebug.lyricAlignState());
  const hold = async () => {
    const r = await page.$eval('#lyrics', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(r.x, r.y);
    await page.mouse.down();
    await sleep(520);
    return r;
  };
  await page.evaluate(() => { const a = document.getElementById('audio'); a.pause(); a.currentTime = 3; });
  await sleep(100);
  const parsed = await page.evaluate(() => {
    const d = window.__playerDebug;
    const pos = d.parseLrcDocument('[offset: +750]\n[00:03.00]一句');
    const neg = d.parseLrcDocument('[offset:250]\n[offset: -450]\n[00:03.00]一句');
    return { pos: pos.advanceMs, neg: neg.advanceMs, missing: d.parseLrcDocument('[00:03.00]一句').advanceMs, base: d.lyricAlignState().base, t: pos.lines[0].t };
  });
  assert('lyric-align-parse-lrc-offset-tag', parsed.pos === 750 && parsed.neg === -450 && parsed.missing === 0 && parsed.t === 3, JSON.stringify(parsed));
  assert('lyric-align-candidate-parse-does-not-change-current-source', parsed.base === 250, JSON.stringify(parsed));

  const tapPoint = await page.$eval('#lyrics', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(tapPoint.x, tapPoint.y);
  await page.mouse.down(); await sleep(80); await page.mouse.up();
  assert('lyric-align-short-press-does-not-enter-or-save', !(await info()).active && (await info()).saved === 0, JSON.stringify(await info()));
  await page.evaluate(() => { document.getElementById('audio').currentTime = 3; });
  await sleep(100);
  const r = await hold();
  const entered = await info();
  assert('lyric-align-long-press-enters', entered.active && entered.dragging && !entered.follow, JSON.stringify(entered));
  await page.mouse.move(r.x, r.y - 48, { steps: 8 });
  const dragged = await info();
  assert('lyric-align-drag-changes-offset', dragged.draft > 0 && dragged.index > entered.index && dragged.saved === 0 && dragged.time > dragged.media + 0.25, JSON.stringify({ entered, dragged }));
  const scrollBefore = await page.$eval('#lyrics', (el) => el.scrollTop);
  await page.evaluate(() => window.__playerDebug.requestPlay('fixture'));
  await sleep(3300); // 超过原浏览态的 3s 自动回归，也跨过歌词句界
  const moving = await info();
  const scrollAfter = await page.$eval('#lyrics', (el) => el.scrollTop);
  assert('lyric-align-media-keeps-moving-without-offset-drift', moving.media > dragged.media + 2 && moving.draft === dragged.draft && moving.active && moving.dragging && scrollAfter > scrollBefore + 10, JSON.stringify({ dragged, moving, scrollBefore, scrollAfter }));
  assert('lyric-align-draft-is-not-written-to-track', moving.copies.every((x) => x.offset === undefined), JSON.stringify(moving));
  await page.mouse.up();
  await sleep(500);
  const released = await info();
  assert('lyric-align-release-keeps-preview-and-fine-controls', released.active && !released.dragging && released.draft === dragged.draft && released.media > moving.media + 0.2, JSON.stringify(released));
  await page.evaluate(() => document.getElementById('audio').pause());
  assert('lyric-align-paused-preview-stops-frames', !(await info()).raf, JSON.stringify(await info()));
  await sleep(220);
  await page.screenshot({ path: path.join(outDir, 'lyric-align-light-1040x780.png') });
  await page.evaluate(() => window.__fixtureTheme('dark'));
  await sleep(220);
  await page.screenshot({ path: path.join(outDir, 'lyric-align-dark-1040x780.png') });
  await page.setViewport({ width: 312, height: 494, deviceScaleFactor: 1 });
  await sleep(220);
  const narrow = await page.evaluate(() => {
    const el = document.getElementById('lyricAlignTools'), r = el.getBoundingClientRect(), p = document.getElementById('player').getBoundingClientRect();
    // 只量「对齐动作」那一排（提前/延后/还原/完成）—— 第一行是读数 + 换歌词，不参与单行判定
    const buttons = Array.from(el.querySelectorAll('.lyric-align-actions button'));
    return { inside: r.left >= p.left && r.right <= p.right + 1 && r.top >= p.top && r.bottom <= p.bottom, singleRow: Math.abs(buttons[0].getBoundingClientRect().top - buttons[buttons.length - 1].getBoundingClientRect().top) < 1, hits: Array.from(el.querySelectorAll('button')).every((b) => { const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }) };
  });
  assert('lyric-align-controls-fit-and-hit-in-narrow-card', narrow.inside && narrow.hits && narrow.singleRow, JSON.stringify(narrow));
  await page.screenshot({ path: path.join(outDir, 'lyric-align-dark-312x494.png') });
  await page.keyboard.press('Escape');
  const canceled = await info();
  assert('lyric-align-escape-discards-draft', !canceled.active && canceled.saved === 0 && canceled.follow, JSON.stringify(canceled));

  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await sleep(100);
  await hold(); await page.mouse.up();
  await page.click('#lyricAlignEarlier');
  assert('lyric-align-fine-step-is-50ms', (await info()).draft === 50 && (await info()).saved === 0, JSON.stringify(await info()));
  await page.click('#lyricAlignDone');
  await page.waitForFunction(() => !window.__playerDebug.lyricAlignState().active && window.__playerDebug.lyricAlignState().saved === 50);
  const stored = (persistedPlaylist || []).filter((t) => t.id === 'netease:900000');
  assert('lyric-align-persists-to-playlist-and-all-copies', stored.length >= 2 && stored.every((t) => t.lyricOffset === 50), JSON.stringify(stored.map((t) => ({ list: t.list, offset: t.lyricOffset }))));
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await ready();
  const restored = await info();
  assert('lyric-align-restores-across-documents-with-base-once', restored.saved === 50 && Math.abs(restored.time - restored.media - 0.3) < 0.001, JSON.stringify(restored));

  await page.evaluate(() => document.getElementById('audio').pause());
  await page.evaluate(() => document.querySelector('#lyrics [data-i="3"]').click());
  await sleep(120);
  const seeked = await info();
  assert('lyric-align-click-seek-inverts-the-lyric-clock', Math.abs(seeked.media - 6.7) < 0.05 && seeked.index === 3, JSON.stringify(seeked));
  const cancelR = await hold();
  await page.mouse.move(cancelR.x, cancelR.y + 30);
  await page.evaluate(() => document.getElementById('lyricWrap').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true })));
  await page.mouse.up();
  const pointerCanceled = await info();
  assert('lyric-align-pointercancel-rolls-back-drag', pointerCanceled.active && !pointerCanceled.dragging && pointerCanceled.draft === 50 && pointerCanceled.saved === 50, JSON.stringify(pointerCanceled));
  await page.click('#lyricAlignReset');
  assert('lyric-align-reset-is-a-draft-and-retains-source-offset', (await info()).draft === 0 && (await info()).saved === 50 && (await info()).base === 250, JSON.stringify(await info()));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const d = window.__playerDebug; d.bindLyricMatch(d.currentTrack(), '校准试听', '', '校准试听'); });
  await page.waitForFunction(() => window.__playerDebug.lyricAlignState().base === 250 && document.querySelectorAll('#lyrics .lyric-line').length === 12);
  await sleep(100);
  const rebound = await info();
  const reboundStored = (persistedPlaylist || []).filter((t) => t.id === 'netease:900000');
  assert('lyric-align-cleared-on-rebind-for-all-copies', rebound.saved === 0 && rebound.base === 250 && reboundStored.length >= 2 && reboundStored.every((t) => !Object.hasOwn(t, 'lyricOffset') && t.lyricMatch.keyword === '校准试听'), JSON.stringify(rebound));
  await page.close();
}

/* ============ 2c) 搜索页：左下角入口（仅独立窗）+ 搜索行尾红心落库 + 点播 ============ */
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/standalone.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(700);

  const s = {};
  // 静听控制面（宽窗）：搜索在最左、队列在最右（纯图标）且左右对称；曲目信息在搜索右侧；
  // 中央三键 44×44 / 中心距 52，播放键恒落控制面正中；模式 / 音量落在 C∓112。
  s.entryVisibleWide = await page.evaluate(() => {
    const b = document.getElementById('searchEntryBtn');
    const r = b.getBoundingClientRect();
    const ctl = document.getElementById('controls').getBoundingClientRect();
    const qb = document.getElementById('queueBtn').getBoundingClientRect();
    const ct = document.getElementById('ctlTitle');
    const prev = document.getElementById('prevBtn').getBoundingClientRect();
    const play = document.getElementById('playBtn').getBoundingClientRect();
    const next = document.getElementById('nextBtn').getBoundingClientRect();
    const mode = document.getElementById('modeBtn').getBoundingClientRect();
    const vol = document.getElementById('volGroup').getBoundingClientRect();
    const C = ctl.left + ctl.width / 2;
    const cx = (el) => el.left + el.width / 2;
    return {
      shown: getComputedStyle(b).display !== 'none' && r.width > 0,
      searchLeftmost: Math.abs(cx(r) - (ctl.left + 24 + 22)) < 2,
      qbRightmost: Math.abs(cx(qb) - (ctl.right - 24 - 22)) < 2,
      qbIconOnly: getComputedStyle(document.querySelector('#queueBtn .qb-label')).display === 'none',
      titleShown: getComputedStyle(ct).display !== 'none' && ct.textContent.trim().length > 0,
      playCentered: Math.abs(cx(play) - C) < 1,
      transport: Math.round(prev.width) === 44 && Math.round(play.width) === 44 && Math.round(next.width) === 44 &&
                 Math.round(cx(play) - cx(prev)) === 52 && Math.round(cx(next) - cx(play)) === 52,
      flanks: Math.abs(cx(mode) - (C - 112)) < 2 && Math.abs(cx(vol) - (C + 112)) < 2
    };
  });
  assert('search-entry-visible-in-window', s.entryVisibleWide.shown === true, JSON.stringify(s.entryVisibleWide));
  assert('ctl-endpoints-symmetric-wide',
    s.entryVisibleWide.searchLeftmost === true && s.entryVisibleWide.qbRightmost === true &&
    s.entryVisibleWide.qbIconOnly === true && s.entryVisibleWide.titleShown === true,
    JSON.stringify(s.entryVisibleWide));
  assert('ctl-play-centered-wide', s.entryVisibleWide.playCentered === true, JSON.stringify(s.entryVisibleWide));
  assert('ctl-transport-geometry', s.entryVisibleWide.transport === true, JSON.stringify(s.entryVisibleWide));
  assert('ctl-flank-slots-wide', s.entryVisibleWide.flanks === true, JSON.stringify(s.entryVisibleWide));

  /* 音量：一颗按钮 + 悬停弹出的竖向滑条（三种布局通用） */
  s.volClosed = await page.evaluate(() => {
    const v = document.getElementById('vol');
    return { visibility: getComputedStyle(v).visibility, h: Math.round(v.getBoundingClientRect().height) };
  });
  assert('vol-pop-closed-by-default', s.volClosed.visibility === 'hidden', JSON.stringify(s.volClosed));

  await page.hover('#muteBtn');
  await sleep(420);
  s.volHover = await page.evaluate(() => {
    const v = document.getElementById('vol');
    const vr = v.getBoundingClientRect();
    const mb = document.getElementById('muteBtn');
    const br = mb.getBoundingClientRect();
    const fr = document.getElementById('frame').getBoundingClientRect();
    return {
      visible: getComputedStyle(v).visibility === 'visible',
      vertical: vr.height > vr.width * 2,
      above: vr.bottom <= br.top + 1,
      inside: vr.left >= fr.left - 1 && vr.right <= fr.right + 1 && vr.top >= fr.top - 1,
      expanded: mb.getAttribute('aria-expanded') === 'true'
    };
  });
  assert('vol-pop-opens-on-hover',
    s.volHover.visible === true && s.volHover.vertical === true && s.volHover.above === true &&
    s.volHover.inside === true && s.volHover.expanded === true,
    JSON.stringify(s.volHover));
  await page.screenshot({ path: path.join(outDir, 'vol-pop-wide-light.png') });

  // 浮层必须在最顶层：呼出歌单抽屉时不能被盖住
  s.volZ = await page.evaluate(() => ({
    vol: parseInt(getComputedStyle(document.getElementById('volPop')).zIndex, 10),
    queue: parseInt(getComputedStyle(document.getElementById('queue')).zIndex, 10),
    scrim: parseInt(getComputedStyle(document.getElementById('drawerScrim')).zIndex, 10)
  }));
  assert('vol-pop-above-queue',
    s.volZ.vol > s.volZ.queue && s.volZ.vol > s.volZ.scrim, JSON.stringify(s.volZ));

  // 竖向拖动：靠近顶部 = 大音量、靠近底部 = 小音量（映射不能反）
  const vrect = await page.evaluate(() => {
    const r = document.getElementById('vol').getBoundingClientRect();
    return { x: r.left + r.width / 2, top: r.top, bottom: r.bottom, h: r.height };
  });
  await page.mouse.move(vrect.x, vrect.top + 3);
  await page.mouse.down();
  await page.mouse.move(vrect.x, vrect.bottom - vrect.h * 0.25, { steps: 8 });
  await page.mouse.up();
  await sleep(200);
  s.volDrag = await page.evaluate(() => ({
    value: parseInt(document.getElementById('vol').value, 10),
    audioVol: Math.round(document.getElementById('audio').volume * 100)
  }));
  assert('vol-vertical-drag-sets-volume',
    s.volDrag.value > 5 && s.volDrag.value < 45 && Math.abs(s.volDrag.audioVol - s.volDrag.value) <= 1,
    JSON.stringify(s.volDrag));

  // 点按钮 = 切静音：图标换、滑条归零（但 state.volume 留着）
  await page.click('#muteBtn');
  await sleep(200);
  s.volMute = await page.evaluate(() => ({
    muted: document.getElementById('audio').muted,
    icon: document.querySelector('#muteBtn use').getAttribute('href'),
    sliderVal: document.getElementById('vol').value,
    fill: document.getElementById('vol').style.getPropertyValue('--fill')
  }));
  assert('vol-click-mutes',
    s.volMute.muted === true && s.volMute.icon === '#i-volume-mute' &&
    s.volMute.sliderVal === '0' && s.volMute.fill === '0%',
    JSON.stringify(s.volMute));

  // 取消静音 → 回到原来设置的音量（上一步拖到的那个值）
  await page.click('#muteBtn');
  await sleep(200);
  s.volUnmute = await page.evaluate(() => ({
    muted: document.getElementById('audio').muted,
    sliderVal: parseInt(document.getElementById('vol').value, 10),
    audioVol: Math.round(document.getElementById('audio').volume * 100)
  }));
  assert('vol-unmute-restores-volume',
    s.volUnmute.muted === false && s.volUnmute.sliderVal === s.volDrag.value &&
    s.volUnmute.audioVol === s.volDrag.value,
    JSON.stringify(s.volUnmute));

  /* 音量图标三档弧线：低/中/高 → i-volume-1/2/3；静音 → i-volume-mute。 */
  s.volIcon = await page.evaluate(() => {
    const href = () => document.querySelector('#muteBtn use').getAttribute('href');
    const set = (v) => {
      const el = document.getElementById('vol');
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return href();
    };
    const out = { low: set(20), mid: set(50), high: set(80) };
    document.getElementById('muteBtn').click();
    out.muted = href();
    document.getElementById('muteBtn').click();   // 取消静音，恢复原音量
    out.back = href();
    return out;
  });
  assert('vol-icon-levels',
    s.volIcon.low === '#i-volume-1' && s.volIcon.mid === '#i-volume-2' &&
    s.volIcon.high === '#i-volume-3' && s.volIcon.muted === '#i-volume-mute' &&
    s.volIcon.back === '#i-volume-3',
    JSON.stringify(s.volIcon));

  // 移开 → 收起
  await page.mouse.move(6, 6);
  await sleep(520);
  s.volLeave = await page.evaluate(() => ({
    hidden: getComputedStyle(document.getElementById('vol')).visibility === 'hidden',
    expanded: document.getElementById('muteBtn').getAttribute('aria-expanded')
  }));
  assert('vol-pop-closes-on-leave',
    s.volLeave.hidden === true && s.volLeave.expanded === 'false', JSON.stringify(s.volLeave));

  // 长卡 / 窄卡：同一颗按钮同样弹竖条，且竖条不越出容器
  for (const [vw, vh, lay] of [[465, 930, 'long'], [531, 451, 'compact']]) {
    await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1 });
    await sleep(400);
    await page.hover('#muteBtn');
    await sleep(420);
    const r = await page.evaluate(() => {
      const v = document.getElementById('vol');
      const vr = v.getBoundingClientRect();
      const fr = document.getElementById('frame').getBoundingClientRect();
      return {
        layout: document.getElementById('player').getAttribute('data-layout'),
        vertical: getComputedStyle(v).visibility === 'visible' && vr.height > vr.width * 2,
        inside: vr.top >= fr.top - 1 && vr.bottom <= fr.bottom + 1
      };
    });
    assert(`vol-pop-opens-${lay}`, r.layout === lay && r.vertical === true && r.inside === true, JSON.stringify(r));
    await page.screenshot({ path: path.join(outDir, `vol-pop-${lay}-light.png`) });
    await page.mouse.move(4, 4);
    await sleep(400);
  }
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await sleep(300);

  // 歌单抽屉开着时，浮层仍画在它上面（截图存档）
  await page.click('#queueBtn');
  await sleep(450);
  await page.hover('#muteBtn');
  await sleep(420);
  await page.screenshot({ path: path.join(outDir, 'vol-pop-over-drawer-light.png') });
  // 真命中测试（不只比 z-index 数字）：抽屉 + 遮罩开着时，音量滑条中心必须仍能被指针点到。
  // （浮层是往上长进舞台区的，和遮罩几何重叠 —— 只比 40>28 会假绿。）
  s.volHitDrawer = await page.evaluate(() => {
    const v = document.getElementById('vol');
    const r = v.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { hit: el ? (el.id || el.className || el.tagName) : null, ok: !!(el && (el === v || el.closest('#volPop'))) };
  });
  assert('vol-pop-hit-under-drawer', s.volHitDrawer.ok === true, JSON.stringify(s.volHitDrawer));
  await page.mouse.move(6, 6);
  await sleep(400);
  await page.click('#queueBtn');
  await sleep(450);
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await sleep(300);
  s.entryHiddenCard = await page.evaluate(() => {
    const b = document.getElementById('searchEntryBtn');
    return getComputedStyle(b).display === 'none' || b.getBoundingClientRect().width === 0;
  });
  assert('search-entry-hidden-in-card', s.entryHiddenCard === true, String(s.entryHiddenCard));
  s.titleHiddenCard = await page.evaluate(() => {
    const ct = document.getElementById('ctlTitle');
    const cs = getComputedStyle(ct);
    return cs.display === 'none' || parseFloat(cs.opacity) === 0 || ct.getBoundingClientRect().width === 0;
  });
  assert('ctl-title-hidden-in-card', s.titleHiddenCard === true, String(s.titleHiddenCard));

  // 回到独立窗，开搜索页 → 直接喂假结果 → 点行尾红心 → 曲目落进「我的喜欢」
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await sleep(300);
  await clickTab(page, 'imp:1');
  await sleep(200);
  const beforeRows = await page.evaluate(() => document.querySelectorAll('#queueList .q-row').length);
  await page.evaluate(() => {
    window.__playerDebug.renderDiscover({ hot: [], charts: [], sheets: [], radios: [] });
    window.__playerDebug.openSearch();
    window.__playerDebug.renderResults([
      { id: 'netease:770001', title: '搜索命中曲', author: '搜索歌手', url: '/api/apps/hanako-simple-player/routes/widget/api/music/go/770001?server=netease', pic: '' }
    ]);
  });
  await sleep(200);
  s.pageOpen = await page.evaluate(() => ({ open: window.__playerDebug.searchState().open, rows: document.querySelectorAll('#searchList .search-row').length, favBtns: document.querySelectorAll('#searchList .search-fav').length }));
  assert('search-page-lists-results',
    s.pageOpen.open === true && s.pageOpen.rows === 1 && s.pageOpen.favBtns === 1,
    JSON.stringify(s.pageOpen));
  // 搜索页只盖舞台，不得遮住底部控制条（罐头拍板）
  s.coversControls = await page.evaluate(() => {
    const sp = document.getElementById('searchPage').getBoundingClientRect();
    const ctl = document.getElementById('controls').getBoundingClientRect();
    return { searchBottom: Math.round(sp.bottom), controlsTop: Math.round(ctl.top), spW: Math.round(sp.width), frameW: Math.round(document.getElementById('frame').getBoundingClientRect().width) };
  });
  assert('search-page-not-cover-controls',
    s.coversControls.searchBottom <= s.coversControls.controlsTop + 1,
    JSON.stringify(s.coversControls));
  // 搜索页开着时，音量浮层不能被它盖住 —— 同样用真命中测试（搜索页只铺 .stage，
  // 但浮层往上长进 .stage，几何重叠；父层 stacking context 会把 40 关小）。
  await page.hover('#muteBtn');
  await sleep(420);
  s.volHitSearch = await page.evaluate(() => {
    const v = document.getElementById('vol');
    const r = v.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { hit: el ? (el.id || el.className || el.tagName) : null, ok: !!(el && (el === v || el.closest('#volPop'))) };
  });
  assert('vol-pop-hit-under-search', s.volHitSearch.ok === true, JSON.stringify(s.volHitSearch));
  await page.mouse.move(6, 6);
  await sleep(400);
  await page.screenshot({ path: path.join(outDir, 'search-page-1040x780-light.png') });

  // 行尾红心：点一下 = 收藏到「我的喜欢」（加入与心是同一件事）
  await page.evaluate(() => document.querySelector('#searchList .search-fav').click());
  await sleep(300);
  s.afterAdd = await page.evaluate(() => ({
    favOn: !!document.querySelector('#searchList .search-fav.is-on'),
    inFav: Array.prototype.some.call(document.querySelectorAll('#listTabs .list-tab'), (e) => e.getAttribute('data-list') === 'fav')
  }));
  // 拍板：搜索行尾红心 = 收藏，落「我的喜欢」（不再新建隐形「搜索」歌单）
  await clickTab(page, 'fav');
  await sleep(250);
  s.favRows = await page.evaluate(() => ({
    count: document.querySelectorAll('#queueList .q-row').length,
    hasNew: Array.prototype.some.call(document.querySelectorAll('#queueList .q-title'), (e) => e.textContent === '搜索命中曲')
  }));
  assert('search-fav-toggles-fav',
    s.afterAdd.favOn === true && s.afterAdd.inFav === true && s.favRows.hasNew === true,
    JSON.stringify({ afterAdd: s.afterAdd, favRows: s.favRows }));

  // 点搜索结果行 = 直接播（不落喜欢）；播过的自动进「最近播放」
  await page.evaluate(() => {
    window.__playerDebug.openSearch();
    window.__playerDebug.renderResults([
      { id: 'netease:770002', title: '点播命中曲', author: '点播歌手', url: '/api/apps/hanako-simple-player/routes/widget/api/music/go/770002?server=netease', pic: '' }
    ]);
  });
  await sleep(200);
  s.playHit = await page.evaluate(() => ({ hits: document.querySelectorAll('#searchList .search-hit').length }));
  await page.evaluate(() => document.querySelector('#searchList .search-hit').click());
  /* 等条件而不是等时间：点搜索行 → playTrack 先置 playing=true，但换曲时 loadAudio 重置旧
   * <audio> 会触发 pause 把状态打回 false，新音频要等媒体就绪、play 事件才再置真。
   * 固定 sleep(600) 赌这个异步会偶发（2026-10-11 实测定案：HEAD 干净副本同样会挂）。
   * 等到真的 playing=1 为止，最多 5s；超时不当场抛，让下面的断言报出真实状态。 */
  await page.waitForFunction(
    () => document.getElementById('player').getAttribute('data-playing') === '1',
    { timeout: 5000, polling: 100 }
  ).catch(() => {});
  s.afterPlay = await page.evaluate(() => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent,
    recentTab: Array.prototype.some.call(document.querySelectorAll('#listTabs .list-tab'), (e) => e.getAttribute('data-list') === 'recent')
  }));
  assert('search-hit-plays-directly',
    s.playHit.hits === 1 && s.afterPlay.playing === '1' && s.afterPlay.title === '点播命中曲' && s.afterPlay.recentTab === true,
    JSON.stringify({ playHit: s.playHit, afterPlay: s.afterPlay }));
  // 播放 ≠ 喜欢：点行播放不点亮红心（罐头拍板：播放就是播放，不一定喜欢）
  s.playNotLike = await page.evaluate(() => ({
    favOn: !!document.querySelector('#searchList .search-fav.is-on')
  }));
  assert('play-does-not-fav',
    s.playNotLike.favOn === false,
    JSON.stringify(s.playNotLike));
  // 切到最近播放：刚才点播的那首应在里面
  await clickTab(page, 'recent');
  await sleep(300);
  s.recentList = await page.evaluate(() => ({
    count: document.querySelectorAll('#queueList .q-row').length,
    hasPlayed: Array.prototype.some.call(document.querySelectorAll('#queueList .q-title'), (e) => e.textContent === '点播命中曲')
  }));
  assert('recent-list-records-played',
    s.recentList.count >= 1 && s.recentList.hasPlayed === true,
    JSON.stringify(s.recentList));

  // Esc 关闭搜索页（退场动画 290ms 后才 hidden）
  await page.keyboard.press('Escape');
  await sleep(420);
  s.closed = await page.evaluate(() => window.__playerDebug.searchState().open);
  assert('search-page-esc-closes', s.closed === false, String(s.closed));

  // 入口按钮 toggle：点一下开、再点一下关（与队列抽屉同一交互）
  await page.evaluate(() => document.getElementById('searchEntryBtn').click());
  await sleep(360);
  s.toggleOpen = await page.evaluate(() => window.__playerDebug.searchState().open);
  await page.evaluate(() => document.getElementById('searchEntryBtn').click());
  await sleep(420);
  s.toggleClosed = await page.evaluate(() => window.__playerDebug.searchState().open);
  assert('search-entry-toggles',
    s.toggleOpen === true && s.toggleClosed === false,
    JSON.stringify({ open: s.toggleOpen, closed: s.toggleClosed }));

  // 搜歌手 / 搜歌曲：范围切换按钮存在且能切（后台同一关键词接口，侧重不同）
  await page.evaluate(() => { window.__playerDebug.renderDiscover({ hot: [], charts: [], sheets: [], radios: [] }); window.__playerDebug.openSearch(); });
  await sleep(150);
  s.scopeButtons = await page.evaluate(() => Array.from(document.querySelectorAll('#searchScope .search-scope-btn')).map((b) => b.getAttribute('data-scope')));
  await page.evaluate(() => document.querySelector('#searchScope .search-scope-btn[data-scope="artist"]').click());
  await sleep(120);
  s.scopeAfter = await page.evaluate(() => window.__playerDebug.searchState().scope);
  assert('search-scope-song-and-artist',
    s.scopeButtons.join(',') === 'song,artist' && s.scopeAfter === 'artist',
    JSON.stringify({ buttons: s.scopeButtons, after: s.scopeAfter }));

  // 推荐区：清空关键词/重开搜索时展示热门 + 榜单 + 电台三块
  await page.evaluate(() => {
    window.__playerDebug.renderDiscover({
      hot: [{ id: 'netease:780001', title: '热门推荐 1', author: '推荐歌手 1', url: '/api/apps/hanako-simple-player/routes/widget/api/music/go/780001?server=netease', pic: '' }],
      charts: [{ id: '3778678', name: '热歌榜', pic: '', note: '每天更新' }],
      sheets: [{ id: '8904187604', name: '超火rap', pic: '', note: '109 首' }],
      radios: [{ id: '1230174483', name: '你，静不下来', pic: '', category: '情感', programCount: 73 }]
    });
    window.__playerDebug.openSearch();
    window.__playerDebug.clearSearch();
  });
  await sleep(500);
  s.discover = await page.evaluate(() => ({
    discoverVisible: window.__playerDebug.searchState().discoverVisible,
    hotRows: document.querySelectorAll('#hotList .search-row').length,
    hotFirst: (document.querySelector('#hotList .q-title') || {}).textContent || '',
    chartCards: document.querySelectorAll('#chartsGrid .discover-card').length,
    chartFirst: (document.querySelector('#chartsGrid .discover-card-name') || {}).textContent || '',
    radioCards: document.querySelectorAll('#radiosGrid .discover-card').length,
    radioFirst: (document.querySelector('#radiosGrid .discover-card-name') || {}).textContent || ''
  }));
  assert('search-discover-three-blocks',
    s.discover.discoverVisible === true && s.discover.hotRows === 1 && s.discover.hotFirst === '热门推荐 1' &&
    s.discover.chartCards === 2 && s.discover.chartFirst === '热歌榜' &&
    s.discover.radioCards === 1 && s.discover.radioFirst === '你，静不下来',
    JSON.stringify(s.discover));
  await page.screenshot({ path: path.join(outDir, 'search-discover-1040x780-light.png') });

  // 点一张榜单 → 拉曲目进结果区（推荐区隐去）
  await page.evaluate(() => document.querySelector('#chartsGrid .discover-card').click());
  await sleep(400);
  s.chartOpen = await page.evaluate(() => ({
    rows: document.querySelectorAll('#searchList .search-row').length,
    discoverVisible: window.__playerDebug.searchState().discoverVisible,
    first: (document.querySelector('#searchList .q-title') || {}).textContent || ''
  }));
  assert('search-chart-opens-tracks',
    s.chartOpen.rows === 2 && s.chartOpen.discoverVisible === false && s.chartOpen.first === '榜单曲 1',
    JSON.stringify(s.chartOpen));

  // 「返回」分层退：详情层 → 推荐区（不关搜索）→ 再按才退出搜索（罐头拍板）
  await page.evaluate(() => document.getElementById('searchBackBtn').click());
  await sleep(250);
  s.back1 = await page.evaluate(() => ({ open: window.__playerDebug.searchState().open, discover: window.__playerDebug.searchState().discoverVisible, label: (document.querySelector('#searchBackBtn span') || {}).textContent }));
  await page.evaluate(() => document.getElementById('searchBackBtn').click());
  await sleep(420);
  s.back2 = await page.evaluate(() => window.__playerDebug.searchState().open);
  assert('search-back-layered',
    s.back1.open === true && s.back1.discover === true && s.back2 === false,
    JSON.stringify({ back1: s.back1, back2: s.back2 }));

  // 点一档电台 → 拉节目进结果区（每期是可播长音频）
  await page.evaluate(() => { window.__playerDebug.clearSearch(); });
  await sleep(400);
  await page.evaluate(() => document.querySelector('#radiosGrid .discover-card').click());
  await sleep(400);
  s.radioOpen = await page.evaluate(() => ({
    rows: document.querySelectorAll('#searchList .search-row').length,
    first: (document.querySelector('#searchList .q-title') || {}).textContent || ''
  }));
  assert('search-radio-opens-programs',
    s.radioOpen.rows === 2 && s.radioOpen.first === '电台节目 1',
    JSON.stringify(s.radioOpen));

  /* ── B站分P（多 P 视频的展开）───────────────────────────────
   * 搜索结果里没有分P字段，只能探 pagelist；长视频才探（正常单曲摸不到阈值），
   * 且一轮搜索有额度上限（不预取整页）。五条：
   *   ①只有多P才挂分集入口 ②点开就地长树、不跳页 ③子面板限高滚动
   *   ④单集红心落「我的喜欢」 ⑤整单导入成新歌单。 */
  await page.evaluate(() => { window.__playerDebug.clearSearch(); });
  await sleep(300);
  await page.evaluate(() => {
    window.__playerDebug.openSearch();
    window.__playerDebug.setServer('bilibili');   // B站分P：先切平台
    window.__playerDebug.setKeyword('多P');
    window.__playerDebug.doSearch();
  });
  await page.waitForFunction(() => document.querySelectorAll('#searchList .bili-mark').length === 1, { timeout: 4000, polling: 50 }).catch(() => {});
  s.biliProbe = await page.evaluate(() => ({
    rows: document.querySelectorAll('#searchList .search-row').length,
    marks: document.querySelectorAll('#searchList .bili-mark').length,
    markText: (document.querySelector('#searchList .bili-mark') || {}).textContent || '',
    state: window.__playerDebug.biliPartsState(),
    singleMark: !!document.querySelector('#searchList .search-row[data-i="1"] .bili-mark')
  }));
  assert('bili-parts-mark-only-on-multi',
    s.biliProbe.rows === 2 && s.biliProbe.marks === 1 && /分集/.test(s.biliProbe.markText) &&
    /12/.test(s.biliProbe.markText) && s.biliProbe.singleMark === false &&
    s.biliProbe.state.probe.BV1Single === undefined,   // 短片不探（不预取）
    JSON.stringify(s.biliProbe));

  // 「分集 N」是纯静态提示器：不可点、无按钮语言（罐头定稿：展开靠点标题，它本身不点）
  s.biliMark = await page.evaluate(() => {
    const m = document.querySelector('#searchList .bili-mark');
    if (!m) return { exists: false };
    const cs = getComputedStyle(m);
    return {
      exists: true,
      tag: m.tagName,
      role: m.getAttribute('role'),
      tabindex: m.getAttribute('tabindex'),
      dataMark: m.hasAttribute('data-bili-mark'),
      pe: cs.pointerEvents,
      hasArrow: !!m.querySelector('svg'),
      bg: cs.backgroundColor
    };
  });
  assert('bili-mark-is-passive-hint',
    s.biliMark.exists === true && s.biliMark.tag === 'SPAN' && s.biliMark.role === null &&
    s.biliMark.tabindex === null && s.biliMark.dataMark === false &&
    s.biliMark.pe === 'none' && s.biliMark.hasArrow === false,
    JSON.stringify(s.biliMark));

  // 多P 行：点行主体/标题 = 展开·收起（不播放）。点之前先确认没在播
  const multiHitSel = () => '#searchList .search-row[data-i="0"] .search-hit';
  await page.evaluate((sel) => document.querySelector(sel).click(), multiHitSel());
  await page.waitForFunction(() => document.querySelectorAll('#searchList .bili-prow').length === 12, { timeout: 4000, polling: 50 }).catch(() => {});
  s.biliOpen = await page.evaluate(() => {
    const row = document.querySelector('#searchList .search-row');
    const tree = document.querySelector('#searchList .bili-tree');
    const plist = document.querySelector('#searchList .bili-plist');
    const hit = document.querySelector('#searchList .search-hit');
    const rows = document.querySelectorAll('#searchList .search-row');
    const trect = tree ? tree.getBoundingClientRect() : null;
    const heart = document.querySelector('#searchList .search-row[data-i="0"] .search-fav');
    return {
      open: row.classList.contains('is-open'),
      treeInRow: !!tree,
      prows: document.querySelectorAll('#searchList .bili-prow').length,
      firstName: (document.querySelector('#searchList .bili-pname') || {}).textContent || '',
      firstIdx: (document.querySelector('#searchList .bili-pidx') || {}).textContent || '',
      treeTop: trect ? Math.round(trect.top) : 0,
      hitBottom: Math.round(hit.getBoundingClientRect().bottom),
      nextRowTop: rows[1] ? Math.round(rows[1].getBoundingClientRect().top) : 0,
      capped: plist ? getComputedStyle(plist).maxHeight : '',
      discover: window.__playerDebug.searchState().discoverVisible,
      playing: document.getElementById('player').getAttribute('data-playing'),
      title: document.getElementById('trackTitle').textContent,
      // E：主行主体（封面+标题+红心）必须恒定一行、等高；分集树另起一行不撑主行
      heartTop: Math.round(heart.getBoundingClientRect().top),
      heartBottom: Math.round(heart.getBoundingClientRect().bottom),
      hitTop: Math.round(hit.getBoundingClientRect().top),
      hitBottomMain: Math.round(hit.getBoundingClientRect().bottom),
      favTop: Math.round(document.querySelector('#searchList .search-row[data-i="0"] .search-fav').getBoundingClientRect().top),
      // Bug B：分集缩略图继承主行封面（封面写在 --cover-image 上，读计算样式）
      thumbBg: (() => { const t = document.querySelector('#searchList .bili-pcover'); return t ? (t.style.getPropertyValue('--cover-image') || getComputedStyle(t).backgroundImage || '') : ''; })()
    };
  });
  assert('bili-parts-expand-in-place',
    s.biliOpen.open === true && s.biliOpen.treeInRow === true && s.biliOpen.prows === 12 &&
    s.biliOpen.firstName === '分集曲 1' && s.biliOpen.firstIdx === 'P1' &&
    s.biliOpen.treeTop >= s.biliOpen.hitBottom - 3 &&
    (s.biliOpen.nextRowTop === 0 || s.biliOpen.treeTop <= s.biliOpen.nextRowTop + 3) &&
    s.biliOpen.discover === false,
    JSON.stringify(s.biliOpen));
  assert('bili-multi-row-click-toggles',
    s.biliOpen.title !== 'B站合集 多P',   // 展开 ≠ 播放（点行没有把这行播起来）
    JSON.stringify({ title: s.biliOpen.title }));
  assert('bili-parts-list-scrolls',
    /px$/.test(s.biliOpen.capped) && parseFloat(s.biliOpen.capped) > 0,
    s.biliOpen.capped);
  // 分集子列表不得有竖向导引线（曾有一条 ::before hairline，挂在滚动容器上只能盖首屏、滚下去就断）
  s.biliGuide = await page.evaluate(() => {
    const pl = document.querySelector('#searchList .bili-plist');
    if (!pl) return { exists: false };
    const cs = getComputedStyle(pl, '::before');
    return { exists: true, content: cs.content, width: cs.width, bg: cs.backgroundColor };
  });
  assert('bili-parts-no-guide-line',
    s.biliGuide.exists === true &&
    (s.biliGuide.content === 'none' || s.biliGuide.content === 'normal' || s.biliGuide.content === '""'),
    JSON.stringify(s.biliGuide));
  // Bug B：分P继承主行封面（子行缩略图吃到主行 pic；pagelist 本身不给图）
  assert('bili-parts-inherit-cover',
    /cover\.png/.test(s.biliOpen.thumbBg),
    s.biliOpen.thumbBg);
  // E：标题限长 + 红心不换行 + 主行主体等高（红心仍在主行主体的纵向范围内）
  assert('bili-row-keeps-one-line-with-heart',
    s.biliOpen.favTop < s.biliOpen.hitBottomMain &&
    (s.biliOpen.hitBottomMain - s.biliOpen.hitTop) < 60,
    JSON.stringify({ hitTop: s.biliOpen.hitTop, hitBottom: s.biliOpen.hitBottomMain, favTop: s.biliOpen.favTop, heartTop: s.biliOpen.heartTop }));
  await page.screenshot({ path: path.join(outDir, 'search-bili-parts-1040x780-light.png') });

  // 再点一次标题 → 收起（树消失）
  await page.evaluate((sel) => document.querySelector(sel).click(), multiHitSel());
  await sleep(300);
  s.biliClose = await page.evaluate(() => ({
    open: document.querySelector('#searchList .search-row').classList.contains('is-open'),
    prows: document.querySelectorAll('#searchList .bili-prow').length
  }));
  assert('bili-multi-row-click-collapses',
    s.biliClose.open === false && s.biliClose.prows === 0,
    JSON.stringify(s.biliClose));

  // 未展开时再点开一次（后面的 fav / 导入断言要用）
  await page.evaluate((sel) => document.querySelector(sel).click(), multiHitSel());
  await page.waitForFunction(() => document.querySelectorAll('#searchList .bili-prow').length === 12, { timeout: 4000, polling: 50 }).catch(() => {});

  // 单P 行：点 = 播放（现状不变）—— 副带验 Bug A（无 pic 曲目起播后，
  // 搜索页其它行的封面不能被 .player.nocover 整片清掉）
  await page.evaluate(() => document.querySelector('#searchList .search-row[data-i="1"] .search-hit').click());
  await page.waitForFunction(() => document.getElementById('player').getAttribute('data-playing') === '1', { timeout: 5000, polling: 100 }).catch(() => {});
  s.biliSingle = await page.evaluate(() => {
    const cover = document.querySelector('#searchList .search-row[data-i="0"] .q-cover');
    const bg = getComputedStyle(cover).backgroundImage;
    return {
      playing: document.getElementById('player').getAttribute('data-playing'),
      title: document.getElementById('trackTitle').textContent,
      nocover: document.getElementById('player').classList.contains('nocover'),
      multiCoverBg: bg
    };
  });
  assert('bili-single-row-click-plays',
    s.biliSingle.playing === '1' && s.biliSingle.title === 'B站单曲',
    JSON.stringify(s.biliSingle));
  assert('bili-cover-survives-nocover',
    s.biliSingle.nocover === true && /cover\.png/.test(s.biliSingle.multiCoverBg),
    JSON.stringify({ nocover: s.biliSingle.nocover, bg: s.biliSingle.multiCoverBg }));

  // 分集行尾红心 = 收藏到「我的喜欢」（与主行红心同一语义）
  await page.evaluate(() => document.querySelector('#searchList .bili-prow .search-fav').click());
  await sleep(250);
  await clickTab(page, 'fav');
  await sleep(300);
  s.biliFav = await page.evaluate(() => ({
    favOn: !!document.querySelector('#searchList .bili-prow .search-fav.is-on'),
    inFav: Array.prototype.some.call(document.querySelectorAll('#queueList .q-title'), (e) => e.textContent === '分集曲 1')
  }));
  assert('bili-part-fav-goes-to-fav',
    s.biliFav.favOn === true && s.biliFav.inFav === true,
    JSON.stringify(s.biliFav));

  // 整单导入 → 新建歌单（imp:N），不塞「我的喜欢」
  await page.evaluate(() => { window.__playerDebug.openSearch(); window.__playerDebug.setServer('bilibili'); window.__playerDebug.setKeyword('多P'); window.__playerDebug.doSearch(); });
  await page.waitForFunction(() => document.querySelectorAll('#searchList .bili-mark').length === 1, { timeout: 4000, polling: 50 }).catch(() => {});
  await page.evaluate((sel) => document.querySelector(sel).click(), multiHitSel());
  await page.waitForFunction(() => document.querySelectorAll('#searchList .bili-prow').length === 12, { timeout: 4000, polling: 50 }).catch(() => {});
  s.biliBefore = await page.evaluate(() => document.querySelectorAll('#listTabs .list-tab').length);
  await page.evaluate(() => document.querySelector('#searchList [data-bili-imp]').click());
  await sleep(400);
  s.biliImport = await page.evaluate(() => ({
    tabs: document.querySelectorAll('#listTabs .list-tab').length,
    active: (document.querySelector('#listTabs .list-tab.is-active') || {}).textContent || '',
    queueRows: document.querySelectorAll('#queueList .q-row').length,
    firstQueue: (document.querySelector('#queueList .q-title') || {}).textContent || ''
  }));
  assert('bili-parts-import-to-new-list',
    s.biliImport.tabs === s.biliBefore + 1 && s.biliImport.queueRows === 12 &&
    s.biliImport.firstQueue === '分集曲 1',
    JSON.stringify(s.biliImport));

  /* ── 粘贴 B站链接导入（罐头需求：「添加曲目」面板里粘贴 B站分享链接）──
   * 前情：importLink 写死了 `[?&]id=(\d+)`（只认数字 id），B站链接丢进去走到
   * 「无法从链接里识别歌曲 / 歌单 id」—— 本组断言锁死新分流不再犯。 */
  await page.evaluate(() => window.__playerDebug.closeSearch());
  await sleep(300);
  // 先打开「添加曲目」面板（导入入口），模拟 UI 路径而不是直接调函数
  await page.evaluate(() => document.getElementById('importBtn').click());
  await sleep(200);
  s.linkKind = await page.evaluate(() => {
    const D = window.__playerDebug;
    return {
      shareText: D.detectLinkKind('【在百万豪装录音棚大声听 杨丞琳《雨爱》【Hi-res】】 https://www.bilibili.com/video/BV118411B7XU/?share_source=copy_web&vd_source=fe48fd0e530457bfa813705dfcc26a93'),
      bareBv: D.detectLinkKind('BV118411B7XU'),
      avNum: D.detectLinkKind('av233268574'),
      netease: D.detectLinkKind('https://music.163.com/#/song?id=1234567'),
      plainNum: D.detectLinkKind('1234567'),
      junk: D.detectLinkKind('随便一段文字')   // 40 位 vd_source 不得被当 BV
    };
  });
  assert('import-link-kind-routing',
    s.linkKind.shareText === 'bili' && s.linkKind.bareBv === 'bili' && s.linkKind.avNum === 'bili' &&
    s.linkKind.netease === 'num' && s.linkKind.plainNum === 'num' && s.linkKind.junk === 'unknown',
    JSON.stringify(s.linkKind));

  // 罐头那条原文（整段分享文案）丢进去 → 真的落成一条在线曲目。
  // ⚠️ 落点变更（2026-10-11）：链接导入直落「我的喜欢」，不再留在当前列表；
  // 观察位置随之改到 fav 页（断言口径从「当前行数 +1」改为「fav 里能找到这首」）。
  await clickTab(page, 'imp:1');
  await sleep(200);
  const beforeBili = await page.evaluate(() => window.__playerDebug.listTracks('imp:1').length);
  const beforeFavBili = await page.evaluate(() => window.__playerDebug.listTracks('fav').length);
  const beforeResolveHits = biliResolveHits;
  await page.evaluate(() => {
    const inp = document.getElementById('linkInput');
    inp.value = '【在百万豪装录音棚大声听 杨丞琳《雨爱》【Hi-res】】 https://www.bilibili.com/video/BV118411B7XU/?share_source=copy_web&vd_source=fe48fd0e530457bfa813705dfcc26a93';
    document.getElementById('linkAddBtn').click();
  });
  await page.waitForFunction((n) => window.__playerDebug.listTracks('fav').length > n, { timeout: 4000, polling: 50 }, beforeFavBili).catch(() => {});
  await clickTab(page, 'fav');
  await sleep(250);
  s.biliPaste = await page.evaluate((imp1Before) => {
    const rows = [...document.querySelectorAll('#queueList .q-row')];
    const hit = rows.find((r) => (r.querySelector('.q-title') || {}).textContent.indexOf('雨爱') >= 0);
    return {
      favRows: window.__playerDebug.listTracks('fav').length,
      imp1Rows: window.__playerDebug.listTracks('imp:1').length,
      imp1Before: imp1Before,
      title: hit ? hit.querySelector('.q-title').textContent : '',
      artist: hit ? (hit.querySelector('.q-artist') || {}).textContent : '',
      note: document.getElementById('importNote').textContent,
      inputCleared: document.getElementById('linkInput').value === '',
      active: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list')
    };
  }, beforeBili);
  assert('import-link-bili-paste-adds-track',
    s.biliPaste.favRows === beforeFavBili + 1 && s.biliPaste.imp1Rows === beforeBili &&
    s.biliPaste.title.indexOf('雨爱') >= 0 &&
    s.biliPaste.artist === 'JLRS-LeoFM' && s.biliPaste.inputCleared === true &&
    biliResolveHits === beforeResolveHits + 1,
    JSON.stringify({ ...s.biliPaste, beforeFavBili, resolveHits: biliResolveHits - beforeResolveHits }));
  /* 来源/歌词兜底的根：B站曲目必须落成「在线」。
     normalizeTrack 在无 mode/group 时把曲目判本地 → ① 来源标错；
     ② 跨源歌词兜底的 `t.mode !== '在线'` 守卫会直接跳过 B站曲目。 */
  s.biliMode = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queueList .q-row')];
    const hit = rows.find((r) => (r.querySelector('.q-title') || {}).textContent.indexOf('雨爱') >= 0);
    if (!hit) return { found: false };
    const uid = hit.getAttribute('data-uid');
    const t = window.__playerDebug.kindOf(uid);
    return { found: true, mode: t && t.mode, source: t && t.source, meta: t && t.metaText };
  });
  assert('import-link-bili-marks-online',
    s.biliMode.found === true && s.biliMode.mode === '在线' && s.biliMode.source === 'online' &&
    /来源/.test(String(s.biliMode.meta)),
    JSON.stringify(s.biliMode));

  // 多 P 视频：提示「共 N 集」，且已加入第几集（不是直接开分P树）
  await page.evaluate(() => document.getElementById('importBtn').click());
  await sleep(150);
  await page.evaluate(() => {
    document.getElementById('linkInput').value = 'https://www.bilibili.com/video/BV1CAxaeHEeH?p=6';
    document.getElementById('linkAddBtn').click();
  });
  await page.waitForFunction(() => /共 .* 集/.test(document.getElementById('importNote').textContent), { timeout: 4000, polling: 50 }).catch(() => {});
  s.biliMulti = await page.evaluate(() => ({
    note: document.getElementById('importNote').textContent,
    hasPartsTree: !!document.querySelector('#queueList .bili-plist'),
    titles: [...document.querySelectorAll('#queueList .q-title')].map((e) => e.textContent)
  }));
  assert('import-link-bili-multi-note',
    /共 149 集/.test(s.biliMulti.note) && /第 6 集/.test(s.biliMulti.note) &&
    s.biliMulti.hasPartsTree === false &&
    s.biliMulti.titles.indexOf('第 6 讲') >= 0,
    JSON.stringify(s.biliMulti));

  // 认不出的输入：给可读提示，且**不发无谓请求**（守「先判后发」）
  await page.evaluate(() => document.getElementById('importBtn').click());
  await sleep(150);
  const beforeJunkResolve = biliResolveHits;
  await page.evaluate(() => {
    document.getElementById('linkInput').value = '随便一段没有链接的文字';
    document.getElementById('linkAddBtn').click();
  });
  await sleep(300);
  s.biliJunk = await page.evaluate(() => ({ note: document.getElementById('importNote').textContent }));
  assert('import-link-unknown-note-no-request',
    /认不出/.test(s.biliJunk.note) && biliResolveHits === beforeJunkResolve,
    JSON.stringify({ note: s.biliJunk.note, delta: biliResolveHits - beforeJunkResolve }));

  // 网易云老路不被破：数字 id 仍走 song / playlist（分流不得误伤）
  await page.evaluate(() => document.getElementById('importBtn').click());
  await sleep(150);
  const beforeNumRows = await page.evaluate(() => document.querySelectorAll('#queueList .q-row').length);
  const beforeNumResolve = biliResolveHits;
  await page.evaluate(() => {
    document.getElementById('linkInput').value = 'https://music.163.com/#/song?id=1234567';
    document.getElementById('linkAddBtn').click();
  });
  await page.waitForFunction((n) => document.querySelectorAll('#queueList .q-row').length > n, { timeout: 4000, polling: 50 }, beforeNumRows).catch(() => {});
  s.numStill = await page.evaluate(() => ({
    rows: document.querySelectorAll('#queueList .q-row').length,
    hasOnlineSingle: [...document.querySelectorAll('#queueList .q-title')].some((e) => /在线单曲/.test(e.textContent))
  }));
  assert('import-link-netease-still-works',
    s.numStill.rows === beforeNumRows + 1 && s.numStill.hasOnlineSingle === true &&
    biliResolveHits === beforeNumResolve,
    JSON.stringify({ ...s.numStill, resolveDelta: biliResolveHits - beforeNumResolve }));
  await page.evaluate(() => document.querySelector('#queueList .q-hit') && document.getElementById('importBtn').click());
  await sleep(150);

  /* 长标题回归守（罐头真机抓到：「超长标题把行尾红心挤到下一行、行变高」）。
   * 根因：.search-hit 用 flex:1 1 auto（basis 取 max-content），而 .search-row 是 flex-wrap，
   * 换行先按 hypothetical size 分行 → 长标题独占第 1 行、红心掉到第 2 行。basis 改 0 后不会。
   * 锁死：超长标题行的红心与行主体**同一行**（top 差 ≈ 0），且行高与相邻普通行一致。
   * 与 B站/分P无关 —— 任何「内容宽 > 容器」的长标题都适用。 */
  await page.evaluate(() => { window.__playerDebug.openSearch(); window.__playerDebug.setServer('netease'); window.__playerDebug.setKeyword('长标题'); window.__playerDebug.doSearch(); });
  await page.waitForFunction(() => document.querySelectorAll('#searchList .search-row').length === 3, { timeout: 4000, polling: 50 }).catch(() => {});
  s.longTitle = await page.evaluate(() => {
    const rows = document.querySelectorAll('#searchList .search-row');
    const pick = (i) => {
      const r = rows[i];
      const hit = r.querySelector('.search-hit');
      const fav = r.querySelector('.search-fav');
      const rb = r.getBoundingClientRect();
      const hb = hit.getBoundingClientRect();
      const fb = fav.getBoundingClientRect();
      return { rowH: Math.round(rb.height), hitTop: Math.round(hb.top), favTop: Math.round(fb.top), hitW: Math.round(hb.width), rowW: Math.round(rb.width) };
    };
    return { long: pick(0), normal: pick(1), longTitleLen: (rows[0].querySelector('.q-title') || {}).textContent.length };
  });
  assert('search-long-title-keeps-fav-inline',
    s.longTitle.longTitleLen > 100 &&
    Math.abs(s.longTitle.long.hitTop - s.longTitle.long.favTop) <= 2 &&   // 红心与主体同行
    s.longTitle.long.hitW < s.longTitle.long.rowW &&                     // 主体没独占整行
    Math.abs(s.longTitle.long.rowH - s.longTitle.normal.rowH) <= 2,      // 行高与普通行一致
    JSON.stringify(s.longTitle));

  // 歌词手动匹配面板里的静态对齐提示（罐头补充：绑定后还能长按歌词调对齐）
  s.lmHint = await page.evaluate(() => {
    const el = document.getElementById('lmAlignHint');
    if (!el) return { exists: false };
    const cs = getComputedStyle(el);
    return { exists: true, text: el.textContent.trim(), fs: parseFloat(cs.fontSize) };
  });
  assert('lyric-match-align-hint-present',
    s.lmHint.exists === true && /长按歌词/.test(s.lmHint.text) && s.lmHint.fs >= 11,
    JSON.stringify(s.lmHint));

  /* ── 歌词匹配错了要能「挑」：①工具条有「换歌词」能开面板 ②手动匹配列候选、点哪条绑哪条 ── */
  // ① 工具条里的「换歌词」（长按歌词调对齐时出现）
  s.lmSwap = await page.evaluate(() => {
    const btn = document.getElementById('lyricAlignSwap');
    if (!btn) return { exists: false };
    const tools = document.getElementById('lyricAlignTools');
    const val = document.getElementById('lyricAlignValue');
    const inTools = tools && btn.closest('#lyricAlignTools') !== null;
    // 同一行：与 output 的垂直中心差
    const b = btn.getBoundingClientRect(), v = val.getBoundingClientRect();
    return { exists: true, text: btn.textContent.trim(), inTools: inTools,
      sameRow: Math.abs((b.top + b.height / 2) - (v.top + v.height / 2)) <= 3 };
  });
  assert('lyric-align-tools-has-swap-button',
    s.lmSwap.exists === true && s.lmSwap.text === '换歌词' && s.lmSwap.inTools === true && s.lmSwap.sameRow === true,
    JSON.stringify(s.lmSwap));

  // 点它 → 开手动匹配面板（面板本身在无词时才自动亮，但工具条调用不受那个限制）
  s.lmSwapOpen = await page.evaluate(() => {
    window.__playerDebug.closeLyricMatch();
    const before = document.getElementById('lyricMatchPop').hidden;
    document.getElementById('lyricAlignSwap').click();
    const after = document.getElementById('lyricMatchPop').hidden;
    const song = (document.getElementById('lmSong') || {}).value || '';
    return { before: before, after: after, song: song };
  });
  assert('lyric-align-swap-opens-match-panel',
    s.lmSwapOpen.before === true && s.lmSwapOpen.after === false,
    JSON.stringify(s.lmSwapOpen));

  // ② 手动匹配列出候选（不直接绑），点其中一条才绑那条
  await page.evaluate(() => {
    const D = window.__playerDebug;
    D.closeLyricMatch();
    D.openLyricMatch();
    document.getElementById('lmSong').value = '候选歌曲';
    document.getElementById('lmArtist').value = '候选歌手';
    D.lmSubmit();
  });
  await page.waitForFunction(() => window.__playerDebug.lmCandidateState().count >= 2, { timeout: 4000, polling: 50 }).catch(() => {});
  s.lmCands = await page.evaluate(() => {
    const D = window.__playerDebug;
    const st = D.lmCandidateState();
    const rows = document.querySelectorAll('#lmCandidates .lm-cand-hit');
    const srcs = Array.prototype.map.call(document.querySelectorAll('#lmCandidates .lm-cand-src'), (e) => e.textContent);
    return { count: st.count, domRows: rows.length, hidden: st.hidden, list: st.list, srcs: srcs, boundBefore: st.bound };
  });
  assert('lyric-match-lists-candidates',
    s.lmCands.count >= 2 && s.lmCands.domRows === s.lmCands.count && s.lmCands.hidden === false &&
    s.lmCands.boundBefore === null &&                       // 选之前不能已经绑上
    s.lmCands.srcs.indexOf('QQ') >= 0 && /网易云/.test(s.lmCands.srcs.join('')),   // 候选跨平台
    JSON.stringify(s.lmCands));
  // 点第 2 条（腾讯那条，跨源）→ 绑的就是这条（带 server+mid）
  s.lmPick = await page.evaluate(() => {
    const D = window.__playerDebug;
    const list = D.lmCandidateState().list;
    const idx = list.findIndex((c) => c.server === 'tencent');
    document.querySelector('#lmCandidates .lm-cand-hit[data-lm-cand="' + idx + '"]').click();
    return { idx: idx, want: list[idx] };
  });
  await page.waitForFunction(() => { const b = window.__playerDebug.lmCandidateState().bound; return b && b.mid; }, { timeout: 4000, polling: 50 }).catch(() => {});
  s.lmBound = await page.evaluate(() => ({
    bound: window.__playerDebug.lmCandidateState().bound,
    popHidden: document.getElementById('lyricMatchPop').hidden
  }));
  assert('lyric-match-binds-picked-candidate',
    s.lmBound.bound && s.lmBound.bound.mid === '9003' && s.lmBound.bound.server === 'tencent' &&
    s.lmBound.popHidden === true,
    JSON.stringify({ picked: s.lmPick, bound: s.lmBound }));

  /* 无限滚动翻页（罐头拍板：滚到底自动加载）。
   * 假后端对「分页」关键词回 75 条、每页 30（见 _fixture 的 music/search）。
   * 三条：①触底续接 ②到底收尾（尾巴消失） ③详情层不挂翻页。 */
  await page.evaluate(() => { window.__playerDebug.clearSearch(); });
  await sleep(300);
  await page.evaluate(() => {
    window.__playerDebug.openSearch();
    window.__playerDebug.setKeyword('分页');
    window.__playerDebug.doSearch();
  });
  await page.waitForFunction(() => window.__playerDebug.searchState().results === 30, { timeout: 4000, polling: 50 }).catch(() => {});
  s.page1 = await page.evaluate(() => ({
    rows: document.querySelectorAll('#searchList .search-row').length,
    total: window.__playerDebug.searchState().total,
    paginated: window.__playerDebug.searchState().paginated,
    note: document.getElementById('searchNote').textContent,
    more: !!document.getElementById('searchMore')
  }));
  assert('search-pagination-first-page',
    s.page1.rows === 30 && s.page1.total === 75 && s.page1.paginated === true &&
    s.page1.more === true && /共 75 条/.test(s.page1.note),
    JSON.stringify(s.page1));

  // 滚到底 → 自动加载第 2 页（30 → 60）
  await page.evaluate(() => window.__playerDebug.scrollListToBottom());
  await page.evaluate(() => document.getElementById('searchList').dispatchEvent(new Event('scroll')));
  await page.waitForFunction(() => window.__playerDebug.searchState().results === 60, { timeout: 4000, polling: 50 }).catch(() => {});
  s.page2 = await page.evaluate(() => ({
    rows: document.querySelectorAll('#searchList .search-row').length,
    first: (document.querySelector('#searchList .q-title') || {}).textContent,
    last: (document.querySelectorAll('#searchList .q-title')[59] || {}).textContent,
    more: !!document.getElementById('searchMore')
  }));
  assert('search-pagination-appends',
    s.page2.rows === 60 && s.page2.first === '分页曲目 1' && s.page2.last === '分页曲目 60' && s.page2.more === true,
    JSON.stringify(s.page2));

  // 再滚到底 → 第 3 页（60 → 75，到底）
  await page.evaluate(() => window.__playerDebug.scrollListToBottom());
  await page.evaluate(() => document.getElementById('searchList').dispatchEvent(new Event('scroll')));
  await page.waitForFunction(() => window.__playerDebug.searchState().results === 75, { timeout: 4000, polling: 50 }).catch(() => {});
  s.page3 = await page.evaluate(() => ({
    rows: document.querySelectorAll('#searchList .search-row').length,
    last: (document.querySelectorAll('#searchList .q-title')[74] || {}).textContent,
    more: !!document.getElementById('searchMore'),
    note: document.getElementById('searchNote').textContent
  }));
  assert('search-pagination-exhausts',
    s.page3.rows === 75 && s.page3.last === '分页曲目 75' && s.page3.more === false && /共 75 条/.test(s.page3.note),
    JSON.stringify(s.page3));

  // 到底后再滚：不发新请求、不重复行（在途闸 + total 护栏）
  const hitsAtEnd = searchHits;
  await page.evaluate(() => window.__playerDebug.scrollListToBottom());
  await page.evaluate(() => document.getElementById('searchList').dispatchEvent(new Event('scroll')));
  await sleep(400);
  s.atEnd = await page.evaluate(() => ({ rows: document.querySelectorAll('#searchList .search-row').length, hits: 0 }));
  s.atEnd.hits = searchHits - hitsAtEnd;
  assert('search-pagination-stops-at-total',
    s.atEnd.rows === 75 && s.atEnd.hits === 0,
    JSON.stringify(s.atEnd));
  await page.screenshot({ path: path.join(outDir, 'search-pagination-1040x780-light.png') });

  // 详情层不挂翻页：点榜单进结果区 → paginated=false、无尾巴
  await page.evaluate(() => window.__playerDebug.clearSearch());
  await sleep(300);
  await page.evaluate(() => document.querySelector('#chartsGrid .discover-card').click());
  await sleep(400);
  s.detailNoPaginate = await page.evaluate(() => ({
    rows: document.querySelectorAll('#searchList .search-row').length,
    paginated: window.__playerDebug.searchState().paginated,
    more: !!document.getElementById('searchMore')
  }));
  assert('search-pagination-not-on-detail-layer',
    s.detailNoPaginate.rows === 2 && s.detailNoPaginate.paginated === false && s.detailNoPaginate.more === false,
    JSON.stringify(s.detailNoPaginate));

  /* 控制面断点边界：719/720/721（形态 long↔wide）与 399/400/401（密度 normal↔narrow）。
     只证几何：三键恒 44×44 / 中心距 52、播放中心贴控制面中心、无横向溢出、data-ctl 正确翻转。
     连续换位只动周边槽位（模式/音量/红心），中央三键不做 FLIP —— 所以动画中量也不漂。 */
  const boundary = [];
  for (const [bw, bh] of [[719, 780], [720, 780], [721, 780], [399, 600], [400, 600], [401, 600]]) {
    await page.setViewport({ width: bw, height: bh, deviceScaleFactor: 1 });
    await sleep(360);
    boundary.push(await page.evaluate((w) => {
      const pl = document.getElementById('player');
      const ctl = document.getElementById('controls').getBoundingClientRect();
      const cx = (el) => el.left + el.width / 2;
      const prev = document.getElementById('prevBtn').getBoundingClientRect();
      const play = document.getElementById('playBtn').getBoundingClientRect();
      const next = document.getElementById('nextBtn').getBoundingClientRect();
      return {
        w,
        form: pl.getAttribute('data-layout'),
        ctl: pl.getAttribute('data-ctl'),
        keys: Math.round(prev.width) === 44 && Math.round(play.width) === 44 && Math.round(next.width) === 44 &&
              Math.round(cx(play) - cx(prev)) === 52 && Math.round(cx(next) - cx(play)) === 52,
        centered: Math.abs(cx(play) - (ctl.left + ctl.width / 2)) < 1,
        overflow: pl.scrollWidth <= pl.clientWidth + 1
      };
    }, bw));
  }
  assert('ctl-boundary-continuity',
    boundary.every((b) => b.keys && b.centered && b.overflow) &&
    boundary[0].form === 'long' && boundary[1].form === 'wide' && boundary[2].form === 'wide' &&
    boundary[3].ctl === 'narrow' && boundary[4].ctl === 'normal' && boundary[5].ctl === 'normal',
    JSON.stringify(boundary));

  report.search = s;
  await page.close();
}

/* ============ 2d) 舞台歌手名 = 搜索入口（三种布局都能开搜索页） ============ */
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/standalone.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(800);

  const s = {};
  // 夹具曲目没有歌手 → 歌手行收起：不可点、隐去搜索字形、不占高度（不能留个能点的空壳）
  s.empty = await page.evaluate(() => {
    const b = document.getElementById('trackArtist');
    return {
      tag: b.tagName, hidden: b.hidden, disabled: b.disabled,
      h: Math.round(b.getBoundingClientRect().height),
      name: document.getElementById('trackArtistName').textContent,
      iconShown: getComputedStyle(b.querySelector('.ta-go')).display !== 'none'
    };
  });
  assert('artist-line-inert-without-artist',
    s.empty.tag === 'BUTTON' && s.empty.hidden === true && s.empty.disabled === true &&
    s.empty.name === '' && s.empty.h === 0 && s.empty.iconShown === false,
    JSON.stringify(s.empty));

  /* 首次使用提示：只有「存储读过且读到空」才弹；读过、读不到都不弹。 */
  s.firstRun = await page.evaluate(() => {
    const D = window.__playerDebug;
    const r = {};
    r.hiddenInit = D.firstRunState().hidden;               // 初始（未触发过）
    r.shownWhenUnseen = D.firstRunTry({ ok: true, value: null });   // 未读过 → 弹
    r.hiddenAfterSeen = D.firstRunTry({ ok: true, value: 1 });      // 读过 → 不弹
    r.hiddenWhenUnreadable = D.firstRunTry({ ok: false, value: null }); // 读不到 → 不弹
    return r;
  });
  assert('first-run-notice-shows-once',
    s.firstRun.hiddenInit === true && s.firstRun.shownWhenUnseen === false &&
    s.firstRun.hiddenAfterSeen === true && s.firstRun.hiddenWhenUnreadable === true,
    JSON.stringify(s.firstRun));

  /* 涟漪工具箱首启提示：与 cookie 提示同一个「只弹一次」纪律，但多一层
     必要条件——工具箱此刻真实可见（宽窗）。窄卡里不该弹（按钮不显示）。 */
  s.rippleTip = await page.evaluate(() => {
    const D = window.__playerDebug;
    const r = {};
    // 先把 cookie 首启提示收掉，避免两个弹层叠弹的回避逻辑干扰本文验
    D.firstRunTry({ ok: true, value: 1 });
    r.hiddenInit = D.rippleTipState().hidden;
    r.shownWhenUnseen = D.rippleTipTry({ ok: true, value: null });    // 未读过 + 宽窗 → 弹
    r.hiddenAfterSeen = D.rippleTipTry({ ok: true, value: 1 });       // 读过 → 不弹
    r.hiddenWhenUnreadable = D.rippleTipTry({ ok: false, value: null }); // 读不到 → 不弹
    return { r, layout: document.getElementById('player').getAttribute('data-layout'), title: D.rippleTipState().title };
  });
  assert('ripple-tip-notice-shows-once-when-tool-visible',
    s.rippleTip.layout === 'wide' && s.rippleTip.title === '涟漪可以调' &&
    s.rippleTip.r.hiddenInit === true && s.rippleTip.r.shownWhenUnseen === false &&
    s.rippleTip.r.hiddenAfterSeen === true && s.rippleTip.r.hiddenWhenUnreadable === true,
    JSON.stringify(s.rippleTip));

  /* 窄卡（非 wide）里工具箱按钮不显示 → 提示也不得弹，否则提示了一个看不见的入口。 */
  s.rippleTipNarrow = await page.evaluate(() => {
    const D = window.__playerDebug, player = document.getElementById('player');
    const prev = player.getAttribute('data-layout');
    player.setAttribute('data-layout', 'long');            // 临时模拟窄卡
    const shown = D.rippleTipTry({ ok: true, value: null });   // 未读过，但不在宽窗 → 不弹
    player.setAttribute('data-layout', prev);
    return { shownWhenNarrow: shown };
  });
  assert('ripple-tip-skipped-when-tool-hidden',
    s.rippleTipNarrow.shownWhenNarrow === true, JSON.stringify(s.rippleTipNarrow));

  /* 欢迎歌：只在「列表确实读到、且为空、且没播过」时播一次，单独放一个歌单。
   * 夹具此时有曲目（imp:1/imp:2）→ 不应当被播种；先验这道闸。 */
  s.welcome = await page.evaluate(async () => {
    const D = window.__playerDebug;
    const r = {};
    r.whenHasTracks = await D.welcomeSeedTry({ ok: true, value: null });   // 有曲目 → 不播
    r.whenUnreadable = await D.welcomeSeedTry({ ok: false, value: null }); // 读不到 → 不播
    r.whenSeen = await D.welcomeSeedTry({ ok: true, value: 1 });           // 播过 → 不播
    r.whenEmpty = await D.welcomeSeedTry({ ok: true, value: null }, 'empty');   // 空且未播 → 播
    return r;
  });
  assert('welcome-song-seeds-once-when-empty',
    s.welcome.whenHasTracks.seeded === false && s.welcome.whenUnreadable.seeded === false &&
    s.welcome.whenSeen.seeded === false && s.welcome.whenEmpty.seeded === true &&
    s.welcome.whenEmpty.listName === '塞壬唱片' && s.welcome.whenEmpty.count === 1 &&
    s.welcome.whenEmpty.trackId === 'netease:1460626792' &&
    /\/widget\/api\/music\/go\/1460626792\?server=netease/.test(s.welcome.whenEmpty.trackUrl || '') &&
    s.welcome.whenEmpty.activeList === s.welcome.whenEmpty.listId &&
    s.welcome.whenEmpty.favCount === 0,
    JSON.stringify(s.welcome));
  // 播过再点一次（标已置）→ 不重复播，也不把用户的空列表重新填满
  s.welcomeAgain = await page.evaluate(() => window.__playerDebug.welcomeSeedTry({ ok: true, value: 1 }, 'empty'));
  assert('welcome-song-not-reseeded',
    s.welcomeAgain.seeded === false && s.welcomeAgain.count === 0,
    JSON.stringify(s.welcomeAgain));

  /* 首次卡：不能只是 cookie 说明，还要告诉新用户「怎么加歌」（罐头需求）。
   * 位置句随布局变（宽窗 = 右下角队列；长卡 = 下方播放列表），与空态引导语同一份口径。
   * 当前页是宽窗（1040）。 */
  s.firstRunCard = await page.evaluate(() => {
    const D = window.__playerDebug;
    const r = {};
    r.shown = D.firstRunTry({ ok: true, value: null });        // 没用过 → 弹
    r.state = D.firstRunState();
    return r;
  });
  assert('first-run-card-teaches-how-to-add',
    s.firstRunCard.shown === false &&
    /^欢迎使用/.test(s.firstRunCard.state.title || '') &&
    /^想加歌：点右下角队列里的 ＋/.test(s.firstRunCard.state.addHint || '') &&
    /添加。?$/.test(s.firstRunCard.state.addHint || ''),
    JSON.stringify(s.firstRunCard));
  // 换到长卡布局（宽→窄）：还开着的卡片里那句位置也要跟着变
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await sleep(700);
  const hintLong = await page.evaluate(() => window.__playerDebug.firstRunState().addHint);
  assert('first-run-card-hint-follows-layout',
    /^想加歌：点下方播放列表里的 ＋/.test(hintLong || ''),
    JSON.stringify({ hintLong }));
  await page.evaluate(() => window.__playerDebug.firstRunTry({ ok: true, value: 1 }));   // 收掉，别挡后续
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });            // 还原宽窗（后续断言依赖它）
  await sleep(500);

  // 播一首「有歌手」的搜索结果（夹具搜索结果 author = 搜索歌手）→ 歌手行变成活的入口
  await page.evaluate(() => window.__playerDebug.openSearch());
  await sleep(380);
  await page.evaluate(() => window.__playerDebug.renderResults([
    { id: 'netease:770001', title: '搜索命中曲', author: '搜索歌手',
      url: '/api/apps/hanako-simple-player/routes/widget/api/music/go/770001?server=netease', pic: '' }
  ]));
  await sleep(280);
  await page.evaluate(() => document.querySelector('#searchList .search-hit').click());
  await sleep(700);
  await page.evaluate(() => window.__playerDebug.closeSearch());
  await sleep(460);

  s.line = await page.evaluate(() => {
    const b = document.getElementById('trackArtist');
    const r = b.getBoundingClientRect();
    return {
      name: document.getElementById('trackArtistName').textContent, hidden: b.hidden, disabled: b.disabled,
      label: b.getAttribute('aria-label'), h: Math.round(r.height), w: Math.round(r.width),
      iconShown: getComputedStyle(b.querySelector('.ta-go')).display !== 'none'
    };
  });
  assert('artist-line-clickable-with-artist',
    s.line.name === '搜索歌手' && s.line.hidden === false && s.line.disabled === false &&
    s.line.h >= 15 && s.line.w > 0 && s.line.iconShown === true &&
    s.line.label === '搜索歌手：搜索歌手',
    JSON.stringify(s.line));

  // 点它 → 搜索页开、范围=搜歌手、关键词预填、已自动出结果（不用再点搜索）
  await page.click('#trackArtist');
  await sleep(900);
  s.wide = await page.evaluate(() => ({
    open: window.__playerDebug.searchState().open,
    scope: window.__playerDebug.searchState().scope,
    discover: window.__playerDebug.searchState().discoverVisible,
    kw: document.getElementById('searchInput').value,
    rows: document.querySelectorAll('#searchList .search-row').length,
    section: document.getElementById('searchSection').textContent
  }));
  assert('artist-search-opens-and-searches',
    s.wide.open === true && s.wide.scope === 'artist' && s.wide.kw === '搜索歌手' &&
    s.wide.rows === 1 && s.wide.discover === false && s.wide.section === '歌手结果',
    JSON.stringify(s.wide));

  // 窄卡（312×494）：同一个入口也要开得了，且不横溢、返回键与输入框都在。
  // 顺带验「离开宽窗不再强收搜索页」—— 这里是从宽窗缩到窄卡的。
  await page.evaluate(() => window.__playerDebug.closeSearch());
  await sleep(460);
  await page.setViewport({ width: 312, height: 494, deviceScaleFactor: 1 });
  await sleep(700);
  await page.click('#trackArtist');
  await sleep(900);
  s.narrow = await page.evaluate(() => {
    const sp = document.getElementById('searchPage');
    const fr = document.getElementById('frame');
    const back = document.getElementById('searchBackBtn').getBoundingClientRect();
    const inp = document.getElementById('searchInput').getBoundingClientRect();
    return {
      open: window.__playerDebug.searchState().open,
      scope: window.__playerDebug.searchState().scope,
      kw: document.getElementById('searchInput').value,
      rows: document.querySelectorAll('#searchList .search-row').length,
      spOverflow: sp.scrollWidth > sp.clientWidth + 1,
      frameOverflow: fr.scrollWidth > fr.clientWidth + 1,
      backVisible: back.width > 0 && back.height > 0,
      inputVisible: inp.width > 0 && inp.height > 0,
      inputW: Math.round(inp.width)
    };
  });
  assert('artist-search-usable-in-narrow-card',
    s.narrow.open === true && s.narrow.scope === 'artist' && s.narrow.kw === '搜索歌手' &&
    s.narrow.rows === 1 && s.narrow.spOverflow === false && s.narrow.frameOverflow === false &&
    s.narrow.backVisible === true && s.narrow.inputVisible === true && s.narrow.inputW >= 100,
    JSON.stringify(s.narrow));
  await page.screenshot({ path: path.join(outDir, 'artist-search-narrow-312x494-light.png') });

  report.artistSearch = s;
  await page.close();
}

/* ============ 2e) 卡片里的搜索页头部收矮（四行 → 两行） ============ */
{
  const s = {};
  const CASES = [
    ['compact-561x500', 561, 500, 'index.html', 'compact'],
    ['narrow-312x494', 312, 494, 'index.html', 'compact'],
    ['wide-1040x780', 1040, 780, 'standalone.html', 'wide']
  ];
  for (const [name, w, h, file, wantLayout] of CASES) {
    await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
    const page = await newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(`${UI_BASE}/${file}?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => window.__fixtureTheme(t), 'light');
    await sleep(800);
    await page.evaluate(() => window.__playerDebug.openSearch());
    await sleep(420);
    // 喂一页结果，让列表真占位（点行播放的路径不影响这里）
    await page.evaluate(() => window.__playerDebug.renderResults(Array.from({ length: 6 }, (_, i) => ({
      id: 'netease:78' + i, title: '结果 ' + (i + 1), author: '歌手 ' + (i + 1),
      url: '/api/apps/hanako-simple-player/routes/widget/api/music/go/78' + i + '?server=netease', pic: ''
    }))));
    await sleep(320);
    s[name] = await page.evaluate(() => {
      const head = document.querySelector('.search-head');
      const srvs = document.getElementById('searchServers');
      const scope = document.getElementById('searchScope');
      const inp = document.getElementById('searchInput');
      const list = document.getElementById('searchList');
      const fr = document.getElementById('frame');
      const sec = document.getElementById('searchSection');
      const r = (el) => el.getBoundingClientRect();
      /* 「结果」标签那行：临时拿掉 hidden 读计算样式，才能真的验到非宽窗那条 display:none */
      const wasHidden = sec.hidden;
      sec.hidden = false;
      const secDisplay = getComputedStyle(sec).display;
      sec.hidden = wasHidden;
      const hb = r(head), sb = r(srvs), cb = r(scope), ib = r(inp), lb = r(list);
      return {
        layout: document.getElementById('player').getAttribute('data-layout'),
        headH: Math.round(hb.height),
        sameRow: Math.abs(sb.top - cb.top) < 2,
        scopeInside: cb.left >= hb.left - 1 && cb.right <= hb.right + 1 && cb.width > 0,
        serversScroll: srvs.scrollWidth > srvs.clientWidth + 1,
        serversW: Math.round(sb.width),
        serversFadeR: srvs.classList.contains('is-scroll-r'),
        serversFadeL: srvs.classList.contains('is-scroll-l'),
        serversFadeWidth: getComputedStyle(srvs).getPropertyValue('--srv-fade-r').trim(),
        inputW: Math.round(ib.width),
        sectionDisplay: secDisplay,
        listH: Math.round(lb.height),
        overflow: fr.scrollWidth > fr.clientWidth + 1
      };
    });
    s[name].wantLayout = wantLayout;
    await page.screenshot({ path: path.join(outDir, `search-header-${name}-light.png`) });
    await page.close();
  }
  const c = s['compact-561x500'], n = s['narrow-312x494'], wd = s['wide-1040x780'];
  // 卡片：两行、平台与范围同行、范围完整可见、「结果」标签被 CSS 隐去、列表拿到高度
  assert('search-head-compact-two-rows',
    c.layout === 'compact' && c.sameRow === true && c.headH <= 110 && c.sectionDisplay === 'none' &&
    c.scopeInside === true && c.inputW >= 150 && c.overflow === false && c.listH >= 230 &&
    c.serversFadeR === false,
    JSON.stringify(c));
  // 极窄：同一套两行，平台条开始横滑（范围仍完整可见）—— 截断处必须有「后面还有」的渐隐
  assert('search-head-narrow-two-rows',
    n.layout === 'compact' && n.sameRow === true && n.headH <= 110 && n.sectionDisplay === 'none' &&
    n.scopeInside === true && n.serversScroll === true && n.inputW >= 100 && n.overflow === false &&
    n.serversFadeR === true && n.serversFadeL === false && n.serversFadeWidth !== '0px',
    JSON.stringify(n));
  // 宽窗：平台与范围并到输入框同一行（头部从两行变一行），「结果」标签仍显示，平台条不溢出则无渐隐
  assert('search-head-wide-single-row',
    wd.layout === 'wide' && wd.sameRow === true && wd.headH <= 72 && wd.sectionDisplay !== 'none' &&
    wd.overflow === false && wd.inputW >= 200 && wd.serversFadeR === false,
    JSON.stringify(wd));
  report.searchHeader = s;
}

/* ============ 2f) 空列表引导语：＋ 的方位随布局变（不能一律说「右上角」） ============
 * 背景：这条引导语曾是「用右上角的 ＋ 导入」—— 那是极简版早期 ＋ 的位置。
 * 之后控制条重排、队列改为下方面板/独立页/右侧抽屉，＋ 搬到了队列面板头部，
 * 三种布局里位置各不相同（长卡常驻下方、窄卡与独立窗都要先点右下角队列键），
 * 所以文案必须跟着布局走，换布局时也要重写。 */
{
  const CASES = [
    ['long-465x930', 465, 930, 'index.html', 'long', '点下方播放列表里的 ＋ 添加'],
    ['compact-312x494', 312, 494, 'index.html', 'compact', '点右下角队列里的 ＋ 添加'],
    ['wide-1040x780', 1040, 780, 'standalone.html', 'wide', '点右下角队列里的 ＋ 添加']
  ];
  const s = {};
  for (const [name, w, h, file, wantLayout, wantHint] of CASES) {
    await fetch(`${BASE}${API}/__fixture/reset?mode=empty&appSurfaceSession=fake-ticket`);
    const page = await newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(`${UI_BASE}/${file}?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => window.__fixtureTheme(t), 'light');
    await sleep(850);
    s[name] = await page.evaluate(() => ({
      layout: document.getElementById('player').getAttribute('data-layout'),
      title: document.getElementById('trackTitle').textContent,
      hint: document.getElementById('trackArtistName').textContent,
      inert: document.getElementById('trackArtist').disabled === true
    }));
    s[name].wantLayout = wantLayout; s[name].wantHint = wantHint;
    await page.screenshot({ path: path.join(outDir, `empty-hint-${name}-light.png`) });

    /* 同页换布局：宽窗 → 长卡，「＋ 在哪」变了，引导语也该跟着换。 */
    if (name === 'wide-1040x780') {
      await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
      await sleep(700);
      s.afterResize = await page.evaluate(() => ({
        layout: document.getElementById('player').getAttribute('data-layout'),
        hint: document.getElementById('trackArtistName').textContent
      }));
    }
    await page.close();
  }
  const CASES_MAP = {};
  for (const [name, , , , wantLayout, wantHint] of CASES) CASES_MAP[name] = { wantLayout, wantHint };
  const bad = Object.keys(CASES_MAP).filter((k) => s[k].hint !== CASES_MAP[k].wantHint || s[k].layout !== CASES_MAP[k].wantLayout);
  assert('empty-hint-names-the-right-place',
    bad.length === 0 && Object.keys(CASES_MAP).every((k) => s[k].title === '还没有曲目' && s[k].inert === true),
    JSON.stringify(s));
  assert('empty-hint-follows-layout-change',
    s.afterResize && s.afterResize.layout === 'long' &&
    s.afterResize.hint === '点下方播放列表里的 ＋ 添加',
    JSON.stringify(s.afterResize));
  report.emptyHint = s;
}

/* ============ 3) 精修矩阵：312 / 465 / 1040 × 浅深 × 歌词开/关 ============ */
/* 先复位夹具：上一段接线冒烟改过歌单（删了 imp:1）也留了播放态；不复位这里
 * 拍到的就是那个残局（无封面的歌单曲目），看不出封面/环境色的真实效果。 */
await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
const REFINE_CASES = [
  ['312x494', 312, 494, 'index.html'],
  ['465x930', 465, 930, 'index.html'],
  ['1040x780', 1040, 780, 'standalone.html']
];
const accentByTheme = {};
for (const [name, w, h, file] of REFINE_CASES) {
  for (const theme of ['light', 'dark']) {
    /* 歌词开/关这条轴已不存（歌词随歌曲有无自动切换），改成
     * 「有词曲目 / 无词曲目」两种内容，尺寸 × 主题 × 内容 = 12 张。 */
    for (const lyricsOn of [true, false]) {
      const page = await newPage();
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await page.goto(`${UI_BASE}/${file}?assert=1&shot=1&appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
      await page.evaluate((t) => window.__fixtureTheme(t), theme);
      // 切到歌单 1，按本档需要选「有词」或「无词」曲目
      await clickTab(page, 'imp:1');
      for (let _w = 0; _w < 20 && (await page.$$eval('#queueList .q-row', (e) => e.length)) === 0; _w++) await sleep(100);
      await sleep(200);
      await page.evaluate((wantLyrics) => {
        const rows = [...document.querySelectorAll('#queueList .q-row')];
        if (wantLyrics) {
          const t = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('在线曲目')) || rows[0];
          if (t) t.querySelector('.q-hit').click();
        } else {
          const t = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('无词纯音乐'));
          if (t) t.querySelector('.q-hit').click();
        }
      }, lyricsOn);
      await sleep(950);
      const shotName = `refine-${name}-${theme}-lyrics-${lyricsOn ? 'on' : 'off'}.png`;
      await page.screenshot({ path: path.join(outDir, shotName) });
      report.refine.push(shotName);

      // 有词 → 歌词层；无词 → 只剩封面 + 涟漪（涟漪常驻）。两种下蒙层/渐变都要在线。
      const swap = await page.evaluate(() => {
        const cs = (id) => getComputedStyle(document.getElementById(id)).display;
        return { wrap: cs('lyricWrap'), scrim: cs('lyricScrim'), has: document.getElementById('player').getAttribute('data-haslyrics') };
      });
      const swapOk = lyricsOn
        ? (swap.wrap !== 'none' && swap.scrim !== 'none' && swap.has === '1')
        : (swap.wrap === 'none' && swap.scrim !== 'none' && swap.has === '0');
      assert(`lyrics-crossfade:${shotName}`, swapOk, JSON.stringify(swap));

      // R5：高亮/激活态必须吃主题强调色
      accentByTheme[theme] = await page.evaluate(() => getComputedStyle(document.getElementById('playBtn')).backgroundColor);

      if (w === 312) {
        const res = await page.evaluate(() => window.__playerSelfCheck());
        report.narrowSelfCheck.push({
          case: `${name}/${theme}/lyrics-${lyricsOn ? 'on' : 'off'}`,
          passed: res.passed,
          failed: res.checks.filter((c) => !c.ok)
        });
      }
      await page.close();
    }
  }
}
assert('theme-accent-on-highlight',
  accentByTheme.light === 'rgb(83, 125, 150)' && accentByTheme.dark === 'rgb(201, 154, 175)',
  JSON.stringify(accentByTheme));

/* ============ 3b) 环境色：封面右缘取色 → 竖向渐变铺满 + 歌词薄纱可读性 ============
   ① 渐变确实写进 --ambient-gradient；② 深底封面选深纱（首段近深色）且歌词
   对比度够；③ .stage-ambient 铺满 scene 且不是 --hk-surface 单色；
   ④ 无封面 / 取色失败（getImageData 抛 SecurityError）优雅退回；
   ⑤ 封面右缘 mask 淡出；⑥ 歌词薄纱只罩阅读列，R4 语义保留。
   对比度用 :root 的 --veil-* 独立算一遍（不是读 app 的内部状态）：
   字色先按自身 alpha 合成到薄纱上，再与薄纱后的背景算 WCAG 比。
   阈值：中部（歌词真正落的那段）≥ 4.5；最差段位（极端封面）≥ 3.0（大字）。 */
/* 背景已从「采样渐变」改为「封面模糊铺底」：
   - 底图 = .cover-haze（封面模糊放大，常驻）；取色只用来定字色极性 data-ambient。
   - 采样只用于对比度闸门；这里独立算：拖当前封面到 canvas，取「屏上可见带」均色
     作为背景基色（模糊保持均色不变，所以均色是可信近似），再合成纱 → 与字色算 WCAG 比。
   断言：底图存在且带封面 url、不是 12 段纯色渐变（防回退）、无封面/取色失败优雅退回。 */
const AMBIENT_PROBE = async () => {
  const player = document.getElementById('player');
  const scene = document.getElementById('scene');
  const ambient = document.getElementById('stageAmbient');
  const haze = document.getElementById('coverHaze');
  const scrim = document.getElementById('lyricScrim');
  const cover = document.getElementById('cover');
  const pcs = getComputedStyle(player);
  const hex = (s) => { const m = /^#([0-9a-f]{6})$/i.exec(String(s || '').trim()); if (!m) return null; const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const over = (fg, bg, a) => [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
  const rs = getComputedStyle(document.documentElement);
  const pol = player.getAttribute('data-ambient');
  const veil = pol === 'dark' ? hex(rs.getPropertyValue('--veil-ink')) : hex(rs.getPropertyValue('--veil-paper'));
  const va = parseFloat(pol === 'dark' ? rs.getPropertyValue('--veil-ink-a') : rs.getPropertyValue('--veil-paper-a'));
  const textRGB = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el).color;
    let m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/.exec(s);
    if (m) return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4], raw: s };
    m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(s);
    if (m) return { rgb: [+m[1] * 255, +m[2] * 255, +m[3] * 255], a: m[4] === undefined ? 1 : +m[4], raw: s };
    return null;
  };

  // 背景 = 封面主色调平色（--ambient-color），不再要 canvas 重算
  const ambColor = (() => {
    const s = pcs.getPropertyValue('--ambient-color').trim();
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(s);
    return m ? [+m[1], +m[2], +m[3]] : null;
  })();
  const coverHasUrl = /url\(/.test(pcs.getPropertyValue('--cover-image') || '') || /url\(/.test(getComputedStyle(cover).backgroundImage || '');

  const contrastAt = (sel, base) => {
    const t = textRGB(sel);
    if (!t || !base || !veil) return null;
    const bg = over(veil, base, va);
    return +ratio(over(t.rgb, bg, t.a), bg).toFixed(2);
  };

  const sb = scene.getBoundingClientRect();
  const pb = player.getBoundingClientRect();
  const ab = ambient.getBoundingClientRect();
  const cb = scrim.getBoundingClientRect();
  return {
    polarity: pol,
    ambientOk: player.classList.contains('ambient-ok'),
    nocover: player.classList.contains('nocover'),
    ambientColor: ambColor,
    scene: [Math.round(sb.width), Math.round(sb.height)],
    ambient: [Math.round(ab.width), Math.round(ab.height)],
    player: [Math.round(pb.width), Math.round(pb.height)],
    coverHasUrl,
    scrim: getComputedStyle(scrim).display,
    scrimTop: Math.round(cb.top - sb.top),
    scrimLeft: Math.round(cb.left - sb.left),
    contentX: Math.round(parseFloat(pcs.getPropertyValue('--content-x')) || 0),
    lyricTop: Math.round(parseFloat(pcs.getPropertyValue('--lyric-top')) || 0),
    coverW: pcs.getPropertyValue('--cover-w').trim(),
    coverBox: (() => { const r = cover.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    /* 长卡只铺上方 scene；其余播放形态三边锚定完整 player。 */
    coverAnchored: (() => {
      const r = cover.getBoundingClientRect();
      const bounds = player.dataset.layout === 'long' ? sb : pb;
      return Math.abs(r.left - bounds.left) <= 1 && Math.abs(r.top - bounds.top) <= 1 && Math.abs(r.bottom - bounds.bottom) <= 1;
    })(),
    seam: pcs.getPropertyValue('--seam').trim(),
    band: pcs.getPropertyValue('--band').trim(),
    /* 舞台底部渐隐已撤（2026-10-09 罐头拍板）：.scene::after 不该再生成 —— 底边硬切到控制条，
     * 全屏只留歌词那侧往左的淡入（.lyric-scrim）。这里做反断言，防回归。 */
    bottomFade: (() => {
      const cs = getComputedStyle(scene, '::after');
      return { content: cs.content, bg: (cs.backgroundImage || 'none').slice(0, 60) };
    })(),
    surfaceRGB: hex(rs.getPropertyValue('--hk-surface')),
    /* .frame 的背景色 = 圆角处露出来的颜色（.player 满铺盖住其余部分）——
     * 必须是卡面色 --hk-surface，不能是页面色 --hk-bg。 */
    frameBg: (() => {
      const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(getComputedStyle(document.querySelector('.frame')).backgroundColor || '');
      return m ? [+m[1], +m[2], +m[3]] : null;
    })(),
    /* 顶部圆角：卡片壳自己补（宿主只在独立窗里裁）。顺手把 data-shell 切成 window 再读一次，
     * 不用额外开页（开页会写 playback-state，撞后面的生命周期用例）。 */
    corners: (() => {
      const read = () => {
        const cs = getComputedStyle(player);
        return { tl: parseFloat(cs.borderTopLeftRadius) || 0, bl: parseFloat(cs.borderBottomLeftRadius) || 0 };
      };
      const card = read();
      document.body.setAttribute('data-shell', 'window');
      const win = read();
      document.body.setAttribute('data-shell', 'card');
      return { card, win };
    })(),
    coverMask: (getComputedStyle(cover).maskImage || getComputedStyle(cover).webkitMaskImage || '').slice(0, 120),
    scrimMask: (getComputedStyle(scrim).maskImage || getComputedStyle(scrim).webkitMaskImage || '').slice(0, 120),
    lyricsTextAlign: getComputedStyle(document.getElementById('lyrics')).textAlign,
    contrastMid: { current: contrastAt('.lyric-line.is-current', ambColor), near: contrastAt('.lyric-line.is-near', ambColor) },
    contrastWorst: { current: contrastAt('.lyric-line.is-current', ambColor), near: contrastAt('.lyric-line.is-near', ambColor) },
    textColor: { current: (textRGB('.lyric-line.is-current') || {}).raw || null, near: (textRGB('.lyric-line.is-near') || {}).raw || null }
  };
};
let ambient = {};
{
  /* 先复位夹具：上一段接线冒烟删过歌单、也留了播放态，不复位 imp:1 就不在了 */
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?assert=1&shot=1&appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await clickTab(page, 'imp:1');
  await sleep(250);
  const playRow = (i) => page.evaluate((idx) => {
    document.querySelectorAll('#queueList .q-row')[idx].querySelector('.q-hit').click();
  }, i);

  // ① 真·浅底封面（整张浅）→ 浅纱 + 墨字
  await playRow(4);
  await sleep(950);
  ambient.light = await page.evaluate(AMBIENT_PROBE);
  await page.screenshot({ path: path.join(outDir, 'ambient-light-465x930.png') });

  // ①b 方形封面（可见段上浅下深）→ 不论择哪态纱，字必须可读（对比度断言）
  await playRow(0);
  await sleep(950);
  ambient.mixed = await page.evaluate(AMBIENT_PROBE);
  await page.screenshot({ path: path.join(outDir, 'ambient-mixed-465x930.png') });

  // ② 深底封面 → 深纱 + 纸字
  await playRow(2);
  await sleep(950);
  ambient.dark = await page.evaluate(AMBIENT_PROBE);
  await page.screenshot({ path: path.join(outDir, 'ambient-dark-465x930.png') });

  // ③ 无封面曲目 → 退回纸面兜底
  await playRow(3);
  await sleep(800);
  ambient.nocover = await page.evaluate(AMBIENT_PROBE);
  await page.screenshot({ path: path.join(outDir, 'ambient-nocover-465x930.png') });

  // ④ 取色失败：getImageData 抛 SecurityError（模拟非 CORS 封面 / 解码失败）
  await page.evaluate(() => {
    const orig = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function () {
      if (window.__ambientFail) throw new DOMException('tainted canvas', 'SecurityError');
      return orig.apply(this, arguments);
    };
    window.__ambientFail = true;
  });
  await playRow(1);   // 横幅封面：本页还没取过色 → 触发一次失败
  await sleep(950);
  ambient.fail = await page.evaluate(AMBIENT_PROBE);
  await page.screenshot({ path: path.join(outDir, 'ambient-fail-465x930.png') });

  assert('ambient-dominant-color-applied:light',
    ambient.light.ambientOk === true && !!ambient.light.ambientColor &&
    (ambient.light.ambientColor[0] + ambient.light.ambientColor[1] + ambient.light.ambientColor[2]) > 0,
    JSON.stringify({ ok: ambient.light.ambientOk, c: ambient.light.ambientColor }));
  /* 主色底不能用「12 段纯色渐变」/模糊照片（那会出硬色阶·橙色团）—— 背景是平色。 */
  assert('backdrop-is-flat-color-not-banded',
    ambient.light.ambientOk === true && ambient.dark.ambientOk === true && !!ambient.dark.ambientColor,
    JSON.stringify({ lg: ambient.light.ambientColor, dg: ambient.dark.ambientColor }));
  /* 歌词列左对齐（与歌名同一条竖线） */
  assert('lyrics-left-aligned',
    ambient.light.lyricsTextAlign === 'left',
    ambient.light.lyricsTextAlign);
  /* 方形封面的可见段上浅下深 —— 不绑死在某一极性上（算法按对比度择优）。
   * 真正要保的是「不论选哪态纱，字都可读」。 */
  assert('ambient-mixed-picks-readable',
    ambient.mixed.ambientOk === true && ambient.mixed.contrastMid.current >= 3.0 &&
    ambient.mixed.contrastWorst.current >= 3.0,
    JSON.stringify({ p: ambient.mixed.polarity, mid: ambient.mixed.contrastMid, worst: ambient.mixed.contrastWorst }));
  assert('ambient-dark-color-applied',
    ambient.dark.ambientOk === true && ambient.dark.polarity === 'dark',
    JSON.stringify({ p: ambient.dark.polarity, ok: ambient.dark.ambientOk }));
  /* 舞台底部不再有渐隐（2026-10-09 罐头拍板）：曾有一条 .scene::after 把封面底缘「化」进
   * 环境色（吃 --ambient-color），现已撤掉 —— 底边直接硬切到控制条，全屏只留歌词那侧往左的
   * 淡入（.lyric-scrim）。反断言：::after 不该生成。 */
  assert('bottom-fade-removed',
    ambient.dark.bottomFade.content === 'none' && ambient.dark.bottomFade.bg === 'none',
    JSON.stringify(ambient.dark.bottomFade));

  /* 顶部圆角（2026-10-09）：宿主只在独立窗/浏览器视图里把 App 面裁圆，聊天卡片里不裁 ——
   * App 自己补上，固定 14px（宿主不转发 --radius-chat-surface；只转发 8/6px 那两个，
   * 比卡片容器那道弧小一半，真机上判为粗糙）。断言：两壳上两角都是这一档、下两角仍直角。
   * 另断言角上露出的颜色 = 卡面色（--hk-surface），不是页面色。 */
  assert('top-corners-rounded',
    ambient.dark.corners.card.tl >= 14 && ambient.dark.corners.card.bl === 0 &&
    ambient.dark.corners.win.tl >= 14,
    JSON.stringify(ambient.dark.corners));
  assert('corner-reveals-card-surface',
    Array.isArray(ambient.dark.frameBg) && Array.isArray(ambient.dark.surfaceRGB) &&
    ambient.dark.frameBg.every((v, i) => Math.abs(v - ambient.dark.surfaceRGB[i]) <= 2),
    JSON.stringify({ frameBg: ambient.dark.frameBg, surface: ambient.dark.surfaceRGB }));
  assert('ambient-fills-scene',
    ambient.dark.ambient[0] === ambient.dark.scene[0] && ambient.dark.ambient[1] === ambient.dark.scene[1] &&
    ambient.dark.ambient[1] < ambient.dark.player[1],
    JSON.stringify({ a: ambient.dark.ambient, s: ambient.dark.scene, p: ambient.dark.player }));
  assert('ambient-dark-lyric-readable',
    ambient.dark.contrastMid.current >= 4.5 && ambient.dark.contrastMid.near >= 4.5,
    JSON.stringify({ mid: ambient.dark.contrastMid }));
  assert('ambient-light-lyric-readable',
    ambient.light.contrastMid.current >= 4.5 && ambient.light.contrastMid.near >= 4.5,
    JSON.stringify({ mid: ambient.light.contrastMid }));
  /* 封面锚定「左/上/下」三边（不管什么比例都是如此） */
  assert('cover-anchored-left-top-bottom',
    ambient.dark.coverAnchored === true,
    JSON.stringify({ anchored: ambient.dark.coverAnchored, box: ambient.dark.coverBox }));
  /* 封面 mask 两段式（实→虚，连续插值）。
   * 歌词遮罩：满屏固定（inset:0，不跟歌词列跑），只做横向淡入 ——
   * 从接缝 -band/2 透明、+band/2 满。两条都是「只给两端点」的连续插值。 */
  const band = parseFloat(ambient.dark.band) || 0;
  const coverM = /linear-gradient/.test(ambient.dark.coverMask);
  const coverTwoStop = (ambient.dark.coverMask.match(/(?:px|%)/g) || []).length >= 2;
  assert('cover-mask-two-stop-continuous',
    coverM && coverTwoStop && band > 0 && band < 320,
    JSON.stringify({ band, cm: ambient.dark.coverMask.slice(0, 80) }));
  /* 歌词遮罩：满屏固定（左/上贴 0），且 mask 从接缝淡入（linear-gradient 两端点） */
  const scrimFade = ambient.dark.scrimMask;
  assert('lyric-scrim-fixed-full-bleed-fade',
    ambient.dark.scrim !== 'none' &&
    ambient.dark.scrimLeft === 0 && ambient.dark.scrimTop === 0 &&
    /linear-gradient/.test(scrimFade) &&
    (scrimFade.match(/(?:px|%)/g) || []).length >= 2,
    JSON.stringify({ scrimLeft: ambient.dark.scrimLeft, scrimTop: ambient.dark.scrimTop, sm: scrimFade.slice(0, 90) }));
  /* 遮罩「满罩点」必须落在歌词列起点 --content-x 上（不再锚接缝）——
   * 歌词永远在满罩区，列随面板移动也跟得住。 */
  const scrimx = [...scrimFade.matchAll(/(-?[\d.]+)px/g)].map((m) => parseFloat(m[1]));
  const scrimOpaqueAt = scrimx.length ? scrimx[scrimx.length - 1] : null;
  assert('lyric-scrim-opaque-at-column-start',
    scrimOpaqueAt !== null && Math.abs(scrimOpaqueAt - ambient.dark.contentX) <= 2,
    JSON.stringify({ contentX: ambient.dark.contentX, scrimOpaqueAt, sm: scrimFade.slice(0, 90) }));
  assert('ambient-nocover-fallback',
    ambient.nocover.nocover === true && ambient.nocover.polarity === 'none' && ambient.nocover.ambientColor === null,
    JSON.stringify({ nocover: ambient.nocover.nocover, p: ambient.nocover.polarity, c: ambient.nocover.ambientColor }));
  /* 取色失败：背景退回主题纸面（无 --ambient-color），字仍可读，不白屏 */
  assert('ambient-extract-failure-graceful',
    ambient.fail.ambientColor === null && ambient.fail.ambient[0] > 0 && ambient.fail.ambient[1] > 0,
    JSON.stringify({ c: ambient.fail.ambientColor, a: ambient.fail.ambient }));

  report.ambient = ambient;
  await page.close();
}

/* 深色封面截图：312 / 465 / 1040 × 浅深 + 歌词关（频谱压在薄纱上，R4） */
for (const [name, w, h, file] of [['312x494', 312, 494, 'index.html'], ['465x930', 465, 930, 'index.html'], ['1040x780', 1040, 780, 'standalone.html']]) {
  for (const theme of ['light', 'dark']) {
    const page = await newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(`${UI_BASE}/${file}?assert=1&shot=1&appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => window.__fixtureTheme(t), theme);
    await clickTab(page, 'imp:1');
    await sleep(220);
    await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[2].querySelector('.q-hit').click());
    await sleep(950);
    const shotName = `ambient-dark-${name}-${theme}.png`;
    await page.screenshot({ path: path.join(outDir, shotName) });
    report.refine.push(shotName);
    await page.close();
  }
}
{
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?assert=1&shot=1&appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await clickTab(page, 'imp:1');
  await sleep(220);
  // 无词曲目（现在配深色封面）：频谱接管歌词层，蒙层必须保持在线
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queueList .q-row')];
    const t = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('无词纯音乐'));
    if (t) t.querySelector('.q-hit').click();
  });
  await sleep(950);
  const off = await page.evaluate(AMBIENT_PROBE);
  assert('ambient-dark-nolyrics-scrim-stays',
    off.scrim !== 'none' && off.ambientOk === true && off.polarity === 'dark',
    JSON.stringify({ scrim: off.scrim, ok: off.ambientOk, p: off.polarity }));
  await page.screenshot({ path: path.join(outDir, 'ambient-dark-465x930-nolyrics.png') });
  await page.close();
}

/* ============ 4) 主题双保险（R5 + macOS 夜间模式） ============
   优先级断言：宿主显式注入 > @media prefers-color-scheme 兑底 > 写死默认 */
{
  // (a) hana-css 初始注入：SDK 初始不拉样式表，App 自己补拉
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  const cssUrl = '/api/apps/theme.css?theme=hostfix';
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket&shot=1&hana-theme=hostfix&hana-css=${encodeURIComponent(cssUrl)}`, { waitUntil: 'domcontentloaded' });
  await sleep(500);
  const vals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor
  }));
  report.theme.hanaCssInject = vals;
  assert('theme-hana-css-inject', vals.accent === 'rgb(34, 170, 136)' && vals.body === 'rgb(17, 34, 51)', JSON.stringify(vals));
  await page.screenshot({ path: path.join(outDir, 'theme-hostfix-inject.png') });
  await page.close();
}
{
  // (a2) 真实宿主形状：同时给 hana-css + palette 对 + hana-theme-appearance。
  //      系统浅色 + 主题深色（就是报告里的 bug 环境）→ 必须用 hana-css 那套（暗色），
  //      绝不能因为系统浅色而挑 palette-light。旧实现（palette 对优先 + 包 media）此处必挂。
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  const q = new URLSearchParams({
    appSurfaceSession: 'fake-ticket',
    shot: '1',
    'hana-theme': 'midnight-fix',
    'hana-theme-appearance': 'dark',
    'hana-css': '/api/apps/theme.css?theme=midnight-fix',
    'hana-palette-light-css': '/api/apps/theme.css?theme=palette-light-fix',
    'hana-palette-dark-css': '/api/apps/theme.css?theme=palette-dark-fix'
  });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto(`${UI_BASE}/index.html?${q}`, { waitUntil: 'domcontentloaded' });
  await sleep(500);
  const vals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    onAccent: getComputedStyle(document.documentElement).getPropertyValue('--hk-on-accent').trim(),
    appearance: document.documentElement.getAttribute('data-appearance')
  }));
  report.theme.realHostShape = vals;
  // midnight-fix 走 /dark/ 分支（THEME_VARS.dark）：body #3B4A54 / accent #C99AAF；深色 → 强调色上用深字
  assert('theme-real-host-shape-uses-current-theme',
    vals.accent === 'rgb(201, 154, 175)' && vals.body === 'rgb(59, 74, 84)' &&
    vals.onAccent === '#2A3238' && vals.appearance === 'dark',
    JSON.stringify(vals));
  await page.screenshot({ path: path.join(outDir, 'theme-real-host-shape.png') });
  await page.close();
}
{
  // (b) palette 对（兼容老宿主）：宿主只给深浅两套主题、不给 hana-css 时，
  //     必须按 hana-theme-appearance 选，【不】按系统深浅选。
  //     这条同时是两个 bug 的回归判据：系统深浅与 Hana 主题深浅不一致时不许翻车。
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  const q = new URLSearchParams({
    appSurfaceSession: 'fake-ticket',
    shot: '1',
    'hana-theme': 'palette-fix',
    'hana-theme-appearance': 'dark',
    'hana-palette-light-css': '/api/apps/theme.css?theme=palette-light-fix',
    'hana-palette-dark-css': '/api/apps/theme.css?theme=palette-dark-fix'
  });
  // 故意把系统设成浅色：旧实现会因此错选浅色那套（bug 根因）
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto(`${UI_BASE}/index.html?${q}`, { waitUntil: 'domcontentloaded' });
  await sleep(500);
  const sysLightVals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor
  }));
  await page.screenshot({ path: path.join(outDir, 'theme-palette-appearance-dark-syslight.png') });
  // 系统切成深色，结果必须不变（说明看的是主题权威值，不是系统）
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await sleep(300);
  const sysDarkVals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor
  }));
  await page.screenshot({ path: path.join(outDir, 'theme-palette-appearance-dark-sysdark.png') });
  report.theme.palette = { sysLight: sysLightVals, sysDark: sysDarkVals };
  // dark 那套：accent #C99AAF / body #3B4A54
  assert('theme-palette-follows-appearance-not-macos',
    sysLightVals.accent === 'rgb(201, 154, 175)' && sysLightVals.body === 'rgb(59, 74, 84)' &&
    sysDarkVals.accent === 'rgb(201, 154, 175)' && sysDarkVals.body === 'rgb(59, 74, 84)',
    JSON.stringify({ sysLight: sysLightVals, sysDark: sysDarkVals }));
  await page.close();
}
{
  // (b2) 系统深色 + 主题浅色那套 → 必须选浅色（旧实现会错选深色）
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  const q = new URLSearchParams({
    appSurfaceSession: 'fake-ticket',
    shot: '1',
    'hana-theme': 'palette-fix',
    'hana-theme-appearance': 'light',
    'hana-palette-light-css': '/api/apps/theme.css?theme=palette-light-fix',
    'hana-palette-dark-css': '/api/apps/theme.css?theme=palette-dark-fix'
  });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.goto(`${UI_BASE}/index.html?${q}`, { waitUntil: 'domcontentloaded' });
  await sleep(500);
  const vals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    onAccent: getComputedStyle(document.documentElement).getPropertyValue('--hk-on-accent').trim()
  }));
  report.theme.paletteLight = vals;
  // light 那套：accent #537D96 / body #F8F4ED；浅色主题 → 强调色上是近白字
  assert('theme-palette-light-despite-macos-dark',
    vals.accent === 'rgb(83, 125, 150)' && vals.body === 'rgb(248, 244, 237)' &&
    vals.onAccent === '#FFFDF7',
    JSON.stringify(vals));
  await page.close();
}
{
  // (c) 无宿主注入：@media prefers-color-scheme 兑底接管（深板岩 / 暖纸）
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket&shot=1`, { waitUntil: 'domcontentloaded' });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await sleep(500);
  const darkVals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor
  }));
  await page.screenshot({ path: path.join(outDir, 'theme-fallback-dark.png') });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await sleep(300);
  const lightVals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor
  }));
  await page.screenshot({ path: path.join(outDir, 'theme-fallback-light.png') });
  report.theme.fallback = { dark: darkVals, light: lightVals };
  assert('fallback-dark-slate',
    darkVals.accent === 'rgb(201, 154, 175)' && darkVals.body === 'rgb(52, 66, 75)', JSON.stringify(darkVals));
  assert('fallback-light-paper',
    lightVals.accent === 'rgb(83, 125, 150)' && lightVals.body === 'rgb(248, 244, 237)', JSON.stringify(lightVals));
  await page.close();
}
{
  // (d) 优先级：宿主显式值 > prefers-color-scheme 兑底（系统深色也不能盖掉宿主主题）
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  const cssUrl = '/api/apps/theme.css?theme=hostfix';
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket&shot=1&hana-theme=hostfix&hana-css=${encodeURIComponent(cssUrl)}`, { waitUntil: 'domcontentloaded' });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await sleep(500);
  const vals = await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor }));
  await page.screenshot({ path: path.join(outDir, 'theme-host-wins-over-dark.png') });
  assert('host-theme-wins-over-prefers', vals.body === 'rgb(17, 34, 51)', JSON.stringify(vals));
  await page.close();
}

/* ============ 5) 夜间兜底：宿主没注入主题时跟随 prefers-color-scheme ============ */
{
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  // 不调 __fixtureTheme —— 模拟宿主完全没注入主题变量的情况
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await sleep(600);
  const dark = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { hkBg: cs.getPropertyValue('--hk-bg').trim(), hkText: cs.getPropertyValue('--hk-text').trim() };
  });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await sleep(150);
  const light = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { hkBg: cs.getPropertyValue('--hk-bg').trim(), hkText: cs.getPropertyValue('--hk-text').trim() };
  });
  await page.screenshot({ path: path.join(outDir, 'darkfallback-465x930.png') });
  report.darkFallback = { dark, light, changed: dark.hkBg !== light.hkBg };
  await page.close();
}

/* ============ 6) 旧数据迁移：无 list 字段 → 本地 + 按 group 分导入列表（幂等） ============ */
let migration = {};
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=migrate&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(800);

  const tabInfo = () => page.$$eval('#listTabs .list-tab', (els) => els.map((e) => ({ list: e.getAttribute('data-list'), label: e.textContent.trim(), title: e.getAttribute('title') })));
  const countAll = async () => {
    const tabs = (await tabInfo()).map((t) => t.list);
    let total = 0;
    const per = {};
    for (const id of tabs) {
      await clickTab(page, id);
      await sleep(120);
      const n = await rowCount(page);
      per[id] = n;
      total += n;
    }
    return { total, per };
  };

  const first = await tabInfo();
  const firstCounts = await countAll();
  migration = {
    firstTabs: first,
    firstCounts,
    expectedTotal: OLD_TRACKS.length
  };
  await page.screenshot({ path: path.join(outDir, 'migrated-465x930-light.png') });

  // 重新加载：已带 list 字段，结构必须不变（幂等）
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(800);
  const secondTabs = (await tabInfo()).map((t) => t.list);
  const secondCounts = await countAll();
  migration.reloadTabs = secondTabs;
  migration.reloadTotal = secondCounts.total;
  migration.idempotent =
    secondTabs.length === first.length &&
    secondCounts.total === firstCounts.total &&
    firstCounts.total === OLD_TRACKS.length;

  /* 旧包名前缀迁移：读时归一成当前 appId（否则打到已停用的旧路由 → 404），
   * 且保存后磁盘上的前缀自愈（不再留旧包名）。 */
  migration.norm = await page.evaluate((oldPkg) => {
    const d = window.__playerDebug;
    const f = d.normalizeAppUrl;
    const old = `/api/apps/${oldPkg}/routes/widget/api/music/go/123?server=netease`;
    const cur = `/api/apps/${d.appId()}/routes/widget/api/music/go/123?server=netease`;
    const local = `/api/apps/${d.appId()}/routes/widget/media/x.wav`;
    const ext = 'https://m8.music.126.net/a.mp3';
    return {
      oldToNew: f(old),
      curKept: f(cur),
      localKept: f(local),
      externalKept: f(ext),
      appId: d.appId()
    };
  }, OLD_PKG);
  migration.savedUrls = (persistedPlaylist || []).map((t) => t.url).filter((u) => /\/api\/apps\//.test(u));
  migration.savedOldPrefixCount = migration.savedUrls.filter((u) => u.includes('/api/apps/' + OLD_PKG + '/')).length;
  migration.savedNewPrefixCount = migration.savedUrls.filter((u) => u.includes('/api/apps/hanako-simple-player/')).length;

  assert('old-appId-prefix-normalized-on-read',
    migration.norm.oldToNew === migration.norm.curKept &&
    migration.norm.curKept.includes('/api/apps/hanako-simple-player/routes/') &&
    migration.norm.localKept.includes('/api/apps/hanako-simple-player/routes/widget/media/') &&
    migration.norm.externalKept === 'https://m8.music.126.net/a.mp3',
    JSON.stringify(migration.norm));
  assert('old-appId-prefix-self-heals-on-save',
    migration.savedOldPrefixCount === 0 && migration.savedNewPrefixCount >= 3,
    JSON.stringify({ old: migration.savedOldPrefixCount, neu: migration.savedNewPrefixCount, sample: migration.savedUrls.slice(0, 3) }));

  report.migration = migration;
  await page.close();
}

/* ============ 6b) 纯旧前缀：boot 读时归一 → 立即全量回写自愈（不靠列表迁移顺带） ============ */
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=oldprefix&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  // 等 boot 的 dataReady.then 跑完（读列表 → 归一置位 → 回写）
  await sleep(1200);

  const saved = (persistedPlaylist || []).map((t) => t.url);
  const oldLeft = saved.filter((u) => u.includes('/api/apps/' + OLD_PKG + '/')).length;
  const newCount = saved.filter((u) => u.includes('/api/apps/hanako-simple-player/routes/widget/api/music/go/')).length;
  const localKept = saved.filter((u) => u.includes('/routes/widget/media/keep.wav')).length;

  assert('oldprefix-boot-writes-back-full-self-heal',
    oldLeft === 0 && newCount === 2 && localKept === 1,
    JSON.stringify({ oldLeft, newCount, localKept, saved }));

  report.oldprefix = { saved, oldLeft, newCount, localKept };
  await page.close();
}

/* ============ 7) 拖拽生命周期：pagehide 落盘 → reload 恢复 + 续播 ============ */
let lifecycle = {};
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  // 本段专测「卸载落盘 → 新文档续播」，必须开启 teardown（默认被拦）
  const page = await newPage({ teardown: true });
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(800);

  // 切到歌单 1，播第一首，等它播到 > 0s
  await clickTab(page, 'imp:1');
  await sleep(200);
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(1200);
  const before = await page.evaluate(() => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent,
    cur: document.getElementById('audio').currentTime
  }));

  // 模拟卸载：pagehide（拖进/拖出 = 整份文档被换掉）。
  // sendBeacon 是异步投递，轮询等它落到后端。
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  let saved = null;
  for (let i = 0; i < 25; i++) {
    const r = await (await fetch(`${BASE}${API}/api/playback-state?appSurfaceSession=fake-ticket`)).json();
    saved = r;
    if (r.state && r.state.playing === true && r.state.progress >= before.cur - 0.3) break;
    await sleep(100);
  }

  // 新文档：reload（模拟拖出后新 iframe 从零 rehydrate）。
  // 起播那一刻的位置必须是续播点 —— 不能先从头/错误位置放出来再跳（听感=「退回上一句」）。
  await page.evaluateOnNewDocument(() => {
    window.__firstPlayAt = null;
    document.addEventListener('play', (e) => {
      const el = e.target;
      if (el && el.tagName === 'AUDIO' && window.__firstPlayAt === null) window.__firstPlayAt = el.currentTime;
    }, true);
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(1000);
  const after = await page.evaluate(() => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent,
    cur: document.getElementById('audio').currentTime,
    activeList: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list'),
    resumeHidden: document.getElementById('resumeBtn').hidden,
    firstPlayAt: window.__firstPlayAt
  }));
  lifecycle.crossDocument = { before, saved: saved && saved.state, after };
  lifecycle.crossOk =
    before.playing === '1' && before.cur > 0 &&
    !!saved && !!saved.state && saved.state.playing === true &&
    saved.state.currentId === 'imp:1|netease:900000' && saved.state.progress > 0 &&
    after.playing === '1' && after.title === '在线曲目 1' && after.activeList === 'imp:1' &&
    after.cur >= saved.state.progress - 0.35 &&
    after.firstPlayAt !== null && after.firstPlayAt >= saved.state.progress - 0.5;

  // 关掉旧文档（它的 pagehide 会再落一次盘），等它落完再播种一个进度=12s 的快照
  await page.close();
  await sleep(500);

  // 自动播放被拦：保留进度 + 「继续播放」引导（不归零）
  const seed = { currentId: 'imp:1|netease:900000', activeList: 'imp:1', progress: 12, volume: 0.8, muted: false, mode: 'list', lyricsVisible: true, playing: true };
  for (let i = 0; i < 4; i++) {
    await fetch(`${BASE}${API}/api/playback-state?appSurfaceSession=fake-ticket`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-fixture-seed': '1' }, body: JSON.stringify(seed)
    });
    await sleep(150);
    const chk = await (await fetch(`${BASE}${API}/api/playback-state?appSurfaceSession=fake-ticket`)).json();
    if (chk.state && chk.state.progress === 12) break;
  }
  const blocked = await newPage();
  await blocked.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await blocked.evaluateOnNewDocument(() => {
    HTMLMediaElement.prototype.play = function () {
      return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    };
  });
  await blocked.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await blocked.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(900);
  const blockedState = await blocked.evaluate(() => ({
    resumeShown: !document.getElementById('resumeBtn').hidden,
    curTime: document.getElementById('curTime').textContent,
    seekVal: document.getElementById('seek').value,
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent
  }));
  lifecycle.autoplayBlocked = blockedState;
  lifecycle.blockedOk =
    blockedState.resumeShown === true && blockedState.curTime === '0:12' &&
    blockedState.playing === '0' && blockedState.title === '在线曲目 1';
  await blocked.screenshot({ path: path.join(outDir, 'resume-chip-465x930-light.png') });
  await blocked.close();

  /* 快照自带曲目：盘上 playlist.json 还没有它时（刚点搜索结果直接播就拖走，
   * 没有任何 savePlaylist 触发过）也要能续上同一首，而不是回退到列表第一首。 */
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const orphan = {
    id: 'netease:777777', list: 'recent', name: '孤儿曲目', url: goUrl(777777),
    mode: '在线', dur: 0, group: '', author: '孤儿歌手'
  };
  const snapSeed = {
    currentId: 'recent|netease:777777', activeList: 'recent', progress: 5,
    volume: 0.8, muted: false, mode: 'list', playing: true, shuffleTrail: [], currentTrack: orphan
  };
  for (let i = 0; i < 4; i++) {
    await fetch(`${BASE}${API}/api/playback-state?appSurfaceSession=fake-ticket`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-fixture-seed': '1' }, body: JSON.stringify(snapSeed)
    });
    await sleep(120);
    const chk = await (await fetch(`${BASE}${API}/api/playback-state?appSurfaceSession=fake-ticket`)).json();
    if (chk.state && chk.state.currentId === 'recent|netease:777777') break;
  }
  const orphanPage = await newPage();
  await orphanPage.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await orphanPage.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await orphanPage.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(1000);
  const orphanState = await orphanPage.evaluate(() => ({
    title: document.getElementById('trackTitle').textContent,
    activeList: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list'),
    queueText: document.getElementById('queueList').textContent,
    cur: document.getElementById('audio').currentTime
  }));
  lifecycle.snapshotTrack = orphanState;
  lifecycle.snapshotTrackOk =
    orphanState.title === '孤儿曲目' && orphanState.activeList === 'recent' &&
    orphanState.queueText.indexOf('孤儿曲目') >= 0 && orphanState.cur >= 4.5;
  await orphanPage.close();

  /* 拖动进度条后继续播：落盘位置必须跟着实际播放走，不能停在跳转点。
   * （老实现是 900ms 防抖，连续播放时永远不写盘 → 盘上停在跳转那一下。） */
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const seekPage = await newPage();
  await seekPage.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await seekPage.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await seekPage.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(800);
  await clickTab(seekPage, 'imp:1');
  await sleep(200);
  await seekPage.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(1200);
  // 拖到 ~10s，再继续播 2.6s
  await seekPage.evaluate(() => {
    const s = document.getElementById('seek');
    s.value = '10';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(2600);
  const seekCur = await seekPage.evaluate(() => document.getElementById('audio').currentTime);
  const seekSaved = (await (await fetch(`${BASE}${API}/api/playback-state?appSurfaceSession=fake-ticket`)).json()).state;
  lifecycle.seekFollow = { saved: seekSaved && seekSaved.progress, cur: seekCur };
  lifecycle.seekFollowOk =
    !!seekSaved && seekCur > 11 && seekSaved.progress >= seekCur - 1.5;
  await seekPage.close();

  report.lifecycle = lifecycle;
}

/* ============ ETE：真实画幅、整窗边界、计时与操作保护 ============ */
{
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'manifest.json'), 'utf8'));
  const card = manifest.contributes.cards.find((c) => c.id === 'player');
  assert('ete-manifest-presentation-and-min-version', card.cardForm === 'edge-to-edge' && card.titleMode === 'hide' &&
    !('titlebar' in card) && manifest.minAppVersion === '0.1017.0' && manifest.network.allowedHosts.includes('*.mountaintoys.cn'));
  const index = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8');
  const standalone = fs.readFileSync(path.join(uiDir, 'standalone.html'), 'utf8');
  assert('ete-html-twins-synchronized', index.replace('data-shell="card"', 'data-shell="window"') === standalone);
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  // 首轮用真实 3 秒；保护/竞态用同一个 3000ms 队列可控推进，音频/动画仍用真实时钟。
  await page.evaluateOnNewDocument(() => {
    const schedule = window.setTimeout, cancel = window.clearTimeout;
    const clock = window.__eteClock = { fast: false, pending: new Map(), next: -1, requests: [] };
    window.setTimeout = function (fn, delay, ...args) {
      if (!clock.fast || delay !== 3000) return schedule(fn, delay, ...args);
      const id = clock.next--;
      clock.requests.push(delay);
      clock.pending.set(id, () => fn(...args));
      return id;
    };
    window.clearTimeout = function (id) { if (id < 0) clock.pending.delete(id); else cancel(id); };
    window.__eteTick = () => { const jobs = [...clock.pending.values()]; clock.pending.clear(); jobs.forEach((fn) => fn()); };
  });
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?assert=1&shot=1&appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  /* 等列表就位再点：官方 App SDK 比旧插件 SDK 体量大，boot 落点靠后；
   * 本段原先 goto 后立刻点 tab，属既有竞态（其余段落都有 waitForFunction）。 */
  await page.waitForFunction(() => window.__playerDebug && document.querySelector('#listTabs .list-tab[data-list="imp:1"]') && window.__playerDebug.listTracks('imp:1').length > 0);
  await clickTab(page, 'imp:1');
  await page.waitForFunction(() => document.querySelectorAll('#queueList .q-row').length > 0);
  const playRow = async (i) => {
    await page.evaluate((idx) => document.querySelectorAll('#queueList .q-row')[idx].querySelector('.q-hit').click(), i);
    await sleep(500);
    await page.evaluate(() => { document.getElementById('audio').loop = true; });
  };
  const probe = () => page.evaluate(() => {
    const p = document.getElementById('player'), c = document.getElementById('controls');
    const rect = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
    const g = getComputedStyle(c, '::before');
    return { immersive: p.dataset.immersive, hidden: p.dataset.controlsHidden, opacity: +getComputedStyle(c).opacity,
      inert: c.inert, glass: g.backdropFilter, bg: g.backgroundColor, theme: getComputedStyle(p).getPropertyValue('--hk-surface').trim(),
      cover: rect('cover'), backdrop: rect('playerBackdrop'), lyrics: rect('lyricWrap'), title: rect('sceneTop'),
      scene: rect('scene'), footer: rect('controls'), layout: p.dataset.layout,
      pending: window.__eteClock.pending.size };
  });
  const axis = [];
  for (const [w, h] of [[1040, 780], [910, 600], [465, 930], [312, 494]]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    const samples = [];
    for (const i of [0, 1, 7]) { await playRow(i); samples.push(await probe()); }
    const x = samples[0].lyrics[0], width = samples[0].lyrics[2];
    assert(`ete-reading-axis-stable-${w}x${h}`, samples.every((s) => s.lyrics[0] === x && s.lyrics[2] === width &&
      s.title[0] === x && width > w * 0.37 && s.lyrics[0] + s.lyrics[2] <= w), JSON.stringify(samples));
    axis.push({ w, h, samples });
  }
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await playRow(0);
  await page.mouse.move(30, 200);
  await sleep(3200);
  const inside = await probe();
  assert('ete-stationary-pointer-inside-keeps-controls', inside.hidden === '0' && inside.immersive === '1', JSON.stringify(inside));
  assert('ete-single-background-full-height-with-glass', inside.backdrop[3] === 780 && inside.cover[3] === 780 &&
    /blur\(20px\)/.test(inside.glass), JSON.stringify(inside));
  await page.screenshot({ path: path.join(outDir, 'ete-square-glass-1040x780-light.png') });
  await page.mouse.move(-20, 200);
  await sleep(2600);
  assert('ete-leave-keeps-controls-before-three-seconds', (await probe()).hidden === '0');
  await sleep(750);
  const hidden = await probe();
  assert('ete-leave-hides-after-three-seconds', hidden.hidden === '1' && hidden.opacity === 0 && hidden.inert, JSON.stringify(hidden));
  assert('ete-hide-does-not-reflow-cover-or-lyrics', JSON.stringify(hidden.cover) === JSON.stringify(inside.cover) &&
    JSON.stringify(hidden.lyrics) === JSON.stringify(inside.lyrics) && JSON.stringify(hidden.backdrop) === JSON.stringify(inside.backdrop));
  const hit = await page.evaluate(() => {
    const r = document.getElementById('playBtn').getBoundingClientRect(), el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!el && !el.closest('#controls');
  });
  assert('ete-hidden-controls-do-not-intercept-pointer', hit);
  await page.screenshot({ path: path.join(outDir, 'ete-hidden-1040x780-light.png') });
  await page.mouse.move(30, 200);
  assert('ete-pointer-enter-wakes-immediately', (await probe()).hidden === '0' && !(await probe()).inert);
  await page.evaluate(() => { window.__eteClock.fast = true; });
  const leave = () => page.mouse.move(-20, 200);
  const enter = () => page.mouse.move(30, 200);
  const tick = async () => { await page.evaluate(() => window.__eteTick()); await sleep(230); };
  await leave();
  await enter(); await tick();
  assert('ete-enter-cancels-old-deadline', (await probe()).hidden === '0' && (await probe()).pending === 0);
  await leave(); await tick();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert('ete-window-focus-wakes-controls', (await probe()).hidden === '0' && (await probe()).pending === 1);
  await tick();
  await page.evaluate(() => document.getElementById('player').dispatchEvent(new PointerEvent('pointerdown',
    { bubbles: true, pointerId: 45, pointerType: 'mouse', clientX: 20, clientY: 100 })));
  assert('ete-window-click-wakes-controls', (await probe()).hidden === '0');
  await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup',
    { bubbles: true, pointerId: 45, pointerType: 'mouse', clientX: 20, clientY: 100 })));
  await enter();
  // 在视口内部被宿主悬浮控件接管 pointer，不能误触发隐藏。
  await page.evaluate(() => document.documentElement.dispatchEvent(new PointerEvent('pointerleave', { clientX: 1000, clientY: 18 })));
  await tick();
  assert('ete-host-overlay-interior-leave-is-not-window-exit', (await probe()).hidden === '0' && (await probe()).pending === 0);

  // 原生窗口 leave 不保证坐标越界；最后一个内容区坐标与归零坐标都必须启动计时。
  for (const [name, point] of [['last-content-position', { clientX: 30, clientY: 200 }],
    ['zero-position', { screenX: 400, screenY: 500 }]]) {
    await page.evaluate((position) => document.documentElement.dispatchEvent(new PointerEvent('pointerleave', position)), point);
    assert(`ete-native-leave-${name}-starts-deadline`, (await probe()).hidden === '0' && (await probe()).pending === 1);
    await tick();
    assert(`ete-native-leave-${name}-hides-controls`, (await probe()).hidden === '1' && (await probe()).inert);
    await page.evaluate(() => document.documentElement.dispatchEvent(new PointerEvent('pointerenter', { clientX: 30, clientY: 200 })));
  }

  await leave();
  await page.evaluate(() => {
    window.__eteStaleTimer = [...window.__eteClock.pending.values()][0];
    document.getElementById('audio').pause();
  });
  await sleep(60);
  await page.evaluate(() => { if (window.__eteStaleTimer) window.__eteStaleTimer(); });
  await tick();
  assert('ete-pause-and-stale-timer-keep-controls', (await probe()).hidden === '0' && (await probe()).pending === 0);
  await page.evaluate(() => window.__playerDebug.requestPlay('fixture'));
  await sleep(80);
  assert('ete-resume-outside-starts-fresh-three-seconds', (await probe()).pending === 1 && (await probe()).hidden === '0');
  await enter();

  // 真实拖进度到视口之外：按住期间不隐藏；结束后另计满三秒。
  const seekRect = await page.$eval('#seek', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width * .25, y: r.y + r.height / 2 }; });
  await page.mouse.move(seekRect.x, seekRect.y); await page.mouse.down(); await leave(); await tick();
  const dragging = await probe();
  await page.mouse.up(); await sleep(60);
  assert('ete-seek-drag-guards-and-restarts-deadline', dragging.hidden === '0' && dragging.pending === 0 && (await probe()).pending === 1, JSON.stringify({ dragging, released: await probe() }));
  await enter();
  await page.hover('#muteBtn'); await sleep(240);
  await page.evaluate(() => document.documentElement.dispatchEvent(new PointerEvent('pointerleave', { clientX: -20, clientY: 200 })));
  await tick();
  assert('ete-volume-pop-keeps-controls-visible', (await probe()).hidden === '0' && (await probe()).pending === 0);
  await enter();
  await page.evaluate(() => window.__playerDebug.openLyricAlign()); await leave(); await tick();
  assert('ete-lyric-alignment-keeps-controls-visible', (await probe()).hidden === '0' && (await probe()).pending === 0);
  await page.evaluate(() => window.__playerDebug.closeLyricAlign()); await sleep(60);
  assert('ete-operation-end-outside-restarts-three-seconds', (await probe()).pending === 1);
  await enter();
  await page.keyboard.press('Tab');
  await page.evaluate(() => document.getElementById('playBtn').focus()); await leave(); await tick();
  assert('ete-keyboard-focus-keeps-controls-visible', (await probe()).hidden === '0' && (await probe()).pending === 0);
  await page.evaluate(() => document.activeElement.blur()); await sleep(60);
  await tick();
  await page.keyboard.press('Tab');
  assert('ete-keyboard-wakes-hidden-controls', (await probe()).hidden === '0' && !(await probe()).inert);
  await page.evaluate(() => document.activeElement.blur());
  await enter();
  await page.keyboard.press('Tab');
  await page.evaluate(() => document.getElementById('playBtn').focus());
  await page.mouse.move(60, 200); // 用户回到鼠标操作，保留焦点也不应无限锁住底栏。
  await leave(); await tick();
  assert('ete-mouse-after-keyboard-releases-stale-focus-guard', (await probe()).hidden === '1' && (await probe()).inert);
  await enter();
  await page.click('#queueBtn'); await leave(); await tick();
  assert('ete-open-drawer-keeps-controls-visible', (await probe()).hidden === '0' && (await probe()).pending === 0);
  await page.evaluate(() => document.getElementById('drawerCloseBtn').click());
  await enter();
  await page.evaluate(() => window.__playerDebug.openSearch()); await sleep(330); await leave(); await tick();
  const search = await probe();
  assert('ete-search-restores-solid-theme-controls', search.hidden === '0' && search.immersive === '0' && search.glass === 'none', JSON.stringify(search));
  const searchSafety = await page.evaluate(() => {
    const head = document.querySelector('.search-head');
    const buttons = [...head.querySelectorAll('button, input')].filter((el) => el.getBoundingClientRect().width > 0);
    return buttons.every((el) => el.getBoundingClientRect().top >= 40);
  });
  assert('ete-search-header-clears-floating-host-controls', searchSafety);
  await page.screenshot({ path: path.join(outDir, 'ete-search-solid-1040x780-light.png') });
  await page.evaluate(() => window.__playerDebug.closeSearch()); await sleep(100);
  const exiting = await probe();
  // shot 模式统一即时收尾；真实退场保留主题的断言由 verifySurfaceMotion 覆盖。
  assert('ete-search-exit-shot-settles-immediately', exiting.immersive === '1' && await page.$eval('#searchPage', (el) => el.hidden));
  // 收起途中再点可恢复，旧退场回调不能卸载重开的页。
  await page.evaluate(() => window.__playerDebug.openSearch()); await sleep(330);
  assert('ete-search-reopen-restores-solid-theme', !(await page.$eval('#searchPage', (el) => el.hidden)) && (await probe()).immersive === '0');
  await page.evaluate(() => window.__playerDebug.closeSearch()); await sleep(340);
  assert('ete-search-exit-restores-immersion-at-completion', (await probe()).immersive === '1' && (await probe()).pending === 1);
  await enter();
  await playRow(1);
  await page.evaluate((t) => window.__fixtureTheme(t), 'dark'); await sleep(200);
  await page.screenshot({ path: path.join(outDir, 'ete-landscape-glass-1040x780-dark.png') });
  await playRow(7);
  await page.screenshot({ path: path.join(outDir, 'ete-portrait-glass-1040x780-dark.png') });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await leave(); await tick();
  assert('ete-reduced-motion-hides-without-animation', await page.$eval('#controls', (el) =>
    getComputedStyle(el).transitionDuration === '0s' && getComputedStyle(el).visibility === 'hidden'));
  await enter();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  // 已隐藏的宽窗缩成长卡时，恢复主题底栏；出窗也不再安排隐藏。
  await leave(); await tick();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await sleep(400);
  const long = await probe();
  assert('ete-long-restores-solid-visible-controls-after-hidden-wide', long.layout === 'long' && long.immersive === '0' &&
    long.hidden === '0' && !long.inert && long.glass === 'none' && long.pending === 0, JSON.stringify(long));
  await tick();
  assert('ete-long-pointer-exit-keeps-controls-visible', (await probe()).hidden === '0' && (await probe()).pending === 0);
  const sameScene = (s) => s.backdrop.every((n, i) => Math.abs(n - s.scene[i]) < 1) &&
    Math.abs(s.cover[3] - s.scene[3]) < 1 && s.backdrop[1] + s.backdrop[3] < s.footer[1];
  assert('ete-long-background-confined-to-upper-scene', sameScene(long), JSON.stringify(long));
  // 拖动上下分区：背景与封面随播放区缩放，不在队列或底栏下露出来。
  await playRow(0);
  const split = await page.$eval('#splitHandle', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(split.x, split.y); await page.mouse.down();
  await page.mouse.move(split.x, split.y - 100, { steps: 8 });
  const splitLong = await probe();
  assert('ete-long-split-keeps-background-and-cover-in-scene', sameScene(splitLong) &&
    splitLong.scene[3] < long.scene[3] - 50 && Math.abs(splitLong.cover[2] - splitLong.scene[3]) < 1 &&
    splitLong.hidden === '0', JSON.stringify(splitLong));
  await page.mouse.up();
  await page.screenshot({ path: path.join(outDir, 'ete-long-stage-only-465x930-dark.png') });
  // 相反方向切回宽窗仍铺满全高；其隐藏倒计时切回长卡必须取消。
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 }); await sleep(400);
  await enter(); await leave();
  const resumedWide = await probe();
  assert('ete-long-to-wide-restores-full-background-and-deadline', resumedWide.immersive === '1' &&
    resumedWide.backdrop[3] === 780 && resumedWide.cover[3] === 780 && resumedWide.pending === 1, JSON.stringify(resumedWide));
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 }); await sleep(400); await tick();
  assert('ete-long-cancels-pending-wide-deadline', (await probe()).hidden === '0' && (await probe()).pending === 0 && sameScene(await probe()));
  await enter();
  // 长卡的队列常驻：只打开菜单也必须守住底栏，不能依赖 drawer 标记。
  await page.click('#queueList .q-more'); await leave(); await tick();
  assert('ete-menu-in-permanent-queue-keeps-controls', (await probe()).hidden === '0' && (await probe()).pending === 0 &&
    !(await page.$eval('#morePop', (el) => el.hidden)));
  await enter();
  await page.setViewport({ width: 312, height: 494, deviceScaleFactor: 1 }); await sleep(400);
  const compact = await probe();
  assert('ete-long-to-compact-restores-full-background', compact.layout === 'compact' && compact.immersive === '1' &&
    compact.backdrop[3] === 494 && compact.cover[3] === 494, JSON.stringify(compact));
  await page.click('#queueBtn'); await sleep(320);
  const backSafety = await page.$eval('#backBtn', (el) => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return r.top >= 40 && !!hit && (hit === el || hit.closest('#backBtn') === el);
  });
  assert('ete-compact-queue-back-clears-host-controls-and-hits', backSafety);
  await page.click('#backBtn'); await sleep(320);
  await playRow(3); await leave(); await tick();
  assert('ete-no-cover-keeps-theme-controls-visible', (await probe()).hidden === '0' && (await probe()).immersive === '0' && (await probe()).glass === 'none');
  assert('ete-operation-deadlines-are-all-three-seconds', await page.evaluate(() => window.__eteClock.requests.length > 5 && window.__eteClock.requests.every((d) => d === 3000)));
  report.ete = { axis, inside, hidden, search, exiting, long, splitLong, resumedWide, compact };
  await page.close();
}

/* ============ ETE·独立窗口：无指针活动计时（不依赖 pointerleave） ============
 * 独立窗口（standalone.html / body[data-shell="window"]）里 iframe 铺满原生窗口，
 * 指针移出窗口时 pointerleave 不派发；判据改为「无指针活动」。本块专门覆盖这条分支，
 * 确保不靠 pointerleave 也能隐藏，且仅凭一次 pointermove 立刻唤回。 */
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.evaluateOnNewDocument(() => {
    const schedule = window.setTimeout, cancel = window.clearTimeout;
    const clock = window.__eteClock = { fast: false, pending: new Map(), next: -1, requests: [] };
    window.setTimeout = function (fn, delay, ...args) {
      if (!clock.fast || delay !== 3000) return schedule(fn, delay, ...args);
      const id = clock.next--;
      clock.requests.push(delay);
      clock.pending.set(id, () => fn(...args));
      return id;
    };
    window.clearTimeout = function (id) { if (id < 0) clock.pending.delete(id); else cancel(id); };
    window.__eteTick = () => { const jobs = [...clock.pending.values()]; clock.pending.clear(); jobs.forEach((fn) => fn()); };
  });
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/standalone.html?assert=1&shot=1&appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  /* 同卡片分支：等列表就位再点 tab（官方 App SDK 体量大，boot 落点靠后）。 */
  await page.waitForFunction(() => window.__playerDebug && document.querySelector('#listTabs .list-tab[data-list="imp:1"]') && window.__playerDebug.listTracks('imp:1').length > 0);
  await clickTab(page, 'imp:1');
  await page.waitForFunction(() => document.querySelectorAll('#queueList .q-row').length > 0);
  const wPlayRow = async (i) => {
    await page.evaluate((idx) => document.querySelectorAll('#queueList .q-row')[idx].querySelector('.q-hit').click(), i);
    await sleep(500);
    await page.evaluate(() => { document.getElementById('audio').loop = true; });
  };
  const wProbe = () => page.evaluate(() => {
    const p = document.getElementById('player'), c = document.getElementById('controls');
    return { immersive: p.dataset.immersive, hidden: p.dataset.controlsHidden, inert: c.inert,
      shell: document.body.getAttribute('data-shell'), pending: window.__eteClock.pending.size };
  });
  const wMove = (x, y) => page.evaluate(([mx, my]) => document.getElementById('player').dispatchEvent(new PointerEvent('pointermove',
    { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: mx, clientY: my })), [x, y]);
  const wTick = async () => { await page.evaluate(() => window.__eteTick()); await sleep(230); };

  await wPlayRow(0);
  assert('ete-window-shell-uses-idle-judgement', (await wProbe()).shell === 'window');
  await page.evaluate(() => { window.__eteClock.fast = true; });
  // 一次指针活动即排一个空闲倒计时；推进后隐藏。
  await wMove(300, 400);
  assert('ete-window-pointer-activity-arms-idle-deadline', (await wProbe()).pending === 1 && (await wProbe()).hidden === '0');
  await wTick();
  assert('ete-window-idle-hides-controls-without-leave', (await wProbe()).hidden === '1' && (await wProbe()).inert);
  // 仅仅一次 pointermove（模拟鼠标移回窗口）就立刻唤回。
  await wMove(320, 420);
  assert('ete-window-pointer-move-wakes-immediately', (await wProbe()).hidden === '0' && !(await wProbe()).inert);
  // 窗内静止不再豁免：维持不动，下一个空闲倒计时照常隐藏（与卡片分支相反）。
  await wTick();
  assert('ete-window-stationary-inside-still-hides', (await wProbe()).hidden === '1' && (await wProbe()).inert);
  // 按住不放松（如拖进度）不得隐藏。
  await wMove(300, 400); await wTick();
  await page.evaluate(() => document.getElementById('player').dispatchEvent(new PointerEvent('pointerdown',
    { bubbles: true, pointerId: 11, pointerType: 'mouse', clientX: 300, clientY: 400 })));
  await wTick();
  assert('ete-window-pointer-down-guards-idle', (await wProbe()).hidden === '0');
  await page.evaluate(() => document.getElementById('player').dispatchEvent(new PointerEvent('pointerup',
    { bubbles: true, pointerId: 11, pointerType: 'mouse', clientX: 300, clientY: 400 })));
  await wTick();
  assert('ete-window-pointer-up-restarts-idle', (await wProbe()).hidden === '1' && (await wProbe()).inert);
  report.eteWindow = { shell: 'window' };
  await page.close();
}

/* ============ 8) 歌单管理改造（2026-10-11）
   导入落 fav / 队列行「移动到…·复制歌名」/ 「最近播放」倒序 ============ */
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  /* 假宿主：桩 clipboard.writeText 记录调用；同时桩 document.execCommand('copy')
   * 并记录写入的文本（同步优先链路要验）。默认 execCommand 返 true（同步成功），
   * 需要验兜底时用 window.__forceExecFalse 把它推成 false。 */
  await page.evaluateOnNewDocument(() => {
    window.__clipCalls = [];
    window.__execCalls = [];
    window.__forceExecFalse = false;
    const origExec = document.execCommand.bind(document);
    document.execCommand = function (cmd) {
      if (cmd === 'copy') {
        const ta = document.querySelector('textarea');
        window.__execCalls.push({ cmd, text: ta ? ta.value : null });
        return !window.__forceExecFalse;
      }
      return origExec.apply(document, arguments);
    };
    let _h;
    Object.defineProperty(window, 'hana', {
      configurable: true,
      get() { return _h; },
      set(v) {
        _h = v;
        if (v && v.clipboard) {
          v.clipboard.writeText = function (text) { window.__clipCalls.push(text); return Promise.resolve({ ok: true }); };
        }
      }
    });
  });
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(800);

  const g = {};
  const D = (fn, arg) => page.evaluate(fn, arg);

  /* ---- (a) 导入落点：粘链接落 fav、不新建「单曲」歌单、不切激活列表 ---- */
  await clickTab(page, 'imp:1');
  await sleep(200);
  const favBefore = await D(() => window.__playerDebug.listTracks('fav').length);
  const tabsBefore = await D(() => document.querySelectorAll('#listTabs .list-tab').length);
  const activeBefore = await activeTab(page);
  const listsBefore = await D(() => window.__playerDebug.listIds());
  await D(() => {
    document.getElementById('importBtn').click();
    document.getElementById('linkInput').value = 'https://music.163.com/#/song?id=666001';
    document.getElementById('linkAddBtn').click();
  });
  await page.waitForFunction((n) => window.__playerDebug.listTracks('fav').length > n, { timeout: 4000, polling: 50 }, favBefore).catch(() => {});
  g.importFav = await D((n) => ({
    favRows: window.__playerDebug.listTracks('fav').length,
    tabs: document.querySelectorAll('#listTabs .list-tab').length,
    active: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list'),
    lists: window.__playerDebug.listIds(),
    hasUnitList: window.__playerDebug.listsInfo().some((l) => l.name === '单曲')
  }), favBefore);
  assert('import-link-lands-in-fav',
    g.importFav.favRows === favBefore + 1 && g.importFav.tabs === tabsBefore &&
    g.importFav.active === activeBefore && g.importFav.hasUnitList === false &&
    g.importFav.lists.join(',') === listsBefore.join(','),
    JSON.stringify({ ...g.importFav, favBefore, tabsBefore, activeBefore, listsBefore }));
  // 同一口径验 B站链接（整段分享文案 → bili-resolve）
  const favBeforeBili = await D(() => window.__playerDebug.listTracks('fav').length);
  await D(() => { window.__playerDebug.importLink('https://www.bilibili.com/video/BV118411B7XU'); });
  await page.waitForFunction((n) => window.__playerDebug.listTracks('fav').length > n, { timeout: 4000, polling: 50 }, favBeforeBili).catch(() => {});
  g.importFavBili = await D((n) => ({
    favRows: window.__playerDebug.listTracks('fav').length,
    active: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list'),
    hasUnitList: window.__playerDebug.listsInfo().some((l) => l.name === '单曲')
  }), favBeforeBili);
  assert('import-bili-lands-in-fav',
    g.importFavBili.favRows === favBeforeBili + 1 && g.importFavBili.active === activeBefore &&
    g.importFavBili.hasUnitList === false,
    JSON.stringify({ ...g.importFavBili, favBeforeBili }));

  /* ---- (b) 队列行「⋯」菜单三项齐全 ---- */
  await clickTab(page, 'imp:1');
  await sleep(250);
  await D(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-more').click());
  await sleep(150);
  g.menu = await D(() => ({
    hidden: document.getElementById('morePop').hidden,
    items: [...document.querySelectorAll('#morePop .pop-item')].map((b) => b.textContent.trim()),
    moveHidden: document.getElementById('moveBtn').hidden
  }));
  assert('queue-menu-three-actions',
    g.menu.hidden === false && g.menu.items.join('|') === '从队列移除|移动到…|复制歌名' && g.menu.moveHidden === false,
    JSON.stringify(g.menu));

  /* ---- (c) 移动目标：只含真歌单（fav + imp:），排除 local/recent/源列表 ---- */
  await D(() => document.getElementById('moveBtn').click());
  await sleep(150);
  g.moveTargets = await D(() => ({
    popHidden: document.getElementById('movePop').hidden,
    targets: [...document.querySelectorAll('#moveList [data-move-to]')].map((b) => b.getAttribute('data-move-to'))
  }));
  assert('move-targets-exclude-local-recent',
    g.moveTargets.popHidden === false && g.moveTargets.targets.join(',') === 'fav,imp:2',
    JSON.stringify(g.moveTargets));
  await D(() => window.__playerDebug && document.getElementById('movePop'));

  /* ---- (d) 移动 A→B：A 少一、B 多一、源不留副本 ---- */
  const imp1Before = await D(() => window.__playerDebug.listTracks('imp:1').length);
  const imp2Before = await D(() => window.__playerDebug.listTracks('imp:2').length);
  const pickUid = await D(() => {
    const rows = document.querySelectorAll('#queueList .q-row');
    return rows[3] ? rows[3].getAttribute('data-uid') : rows[0].getAttribute('data-uid');   // 索引 3 = imp:1 独有 id（前 3 首与 imp:2 重复）
  });
  await D((uid) => window.__playerDebug.moveTrackTo(uid, 'imp:2'), pickUid);
  await sleep(300);
  g.moveBetween = await D((uid) => ({
    imp1: window.__playerDebug.listTracks('imp:1').length,
    imp2: window.__playerDebug.listTracks('imp:2').length,
    movedInB: window.__playerDebug.listTracks('imp:2').some((t) => t.id === uid.split('|')[1]),
    goneFromA: !window.__playerDebug.hasUid(uid)
  }), pickUid);
  assert('move-between-lists',
    g.moveBetween.imp1 === imp1Before - 1 && g.moveBetween.imp2 === imp2Before + 1 &&
    g.moveBetween.movedInB === true && g.moveBetween.goneFromA === true,
    JSON.stringify({ ...g.moveBetween, imp1Before, imp2Before, pickUid }));

  /* ---- (e) 移动目标已有同 id → 去重（两边都不出现重复行） ---- */
  const imp1BeforeDup = await D(() => window.__playerDebug.listTracks('imp:1').length);
  const imp2BeforeDup = await D(() => window.__playerDebug.listTracks('imp:2').length);
  const dupUid = await D(() => document.querySelectorAll('#queueList .q-row')[0].getAttribute('data-uid'));  // 在线曲目 1，imp:2 亦有一份
  await D((uid) => window.__playerDebug.moveTrackTo(uid, 'imp:2'), dupUid);
  await sleep(300);
  g.moveDedup = await D(() => ({
    imp1: window.__playerDebug.listTracks('imp:1').length,
    imp2: window.__playerDebug.listTracks('imp:2').length,
    dup: (function () { const seen = {}, d = []; document.querySelectorAll('#queueList .q-row').forEach((r) => { const u = r.getAttribute('data-uid'); if (seen[u]) d.push(u); else seen[u] = 1; }); return d; })()
  }));
  assert('move-dedupes-target',
    g.moveDedup.imp1 === imp1BeforeDup - 1 && g.moveDedup.imp2 === imp2BeforeDup && g.moveDedup.dup.length === 0,
    JSON.stringify({ ...g.moveDedup, imp1BeforeDup, imp2BeforeDup, dupUid }));

  /* ---- (f) 移动**正在播**的那首：播放不断、指针转到目标副本 ---- */
  await D(() => document.querySelectorAll('#queueList .q-row')[4].querySelector('.q-hit').click());
  await page.waitForFunction(() => document.getElementById('player').getAttribute('data-playing') === '1' &&
    document.getElementById('audio').paused === false, { timeout: 5000, polling: 100 }).catch(() => {});
  const playUid = await D(() => window.__playerDebug.currentUid());
  const favBeforePlay = await D(() => window.__playerDebug.listTracks('fav').length);
  await D((uid) => window.__playerDebug.moveTrackTo(uid, 'fav'), playUid);
  await sleep(400);
  await clickTab(page, 'fav');
  await sleep(250);
  g.movePlaying = await D((oldUid) => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    paused: document.getElementById('audio').paused,
    currentUid: window.__playerDebug.currentUid(),
    oldGone: !window.__playerDebug.hasUid(oldUid),
    favRows: window.__playerDebug.listTracks('fav').length,
    currentRow: (function () { const r = document.querySelector('#queueList .q-row.is-current'); return r ? r.getAttribute('data-uid') : ''; })()
  }), playUid);
  assert('move-playing-keeps-playback',
    g.movePlaying.playing === '1' && g.movePlaying.paused === false &&
    g.movePlaying.currentUid === 'fav|' + playUid.split('|')[1] &&
    g.movePlaying.oldGone === true && g.movePlaying.currentRow === g.movePlaying.currentUid &&
    g.movePlaying.favRows === favBeforePlay + 1,
    JSON.stringify({ ...g.movePlaying, playUid, favBeforePlay }));

  /* ---- (g) 复制歌名：优先同步 execCommand，入参 = 歌名（不带歌手） ----
   * ⚠️ 2026-10-11 复制改同步 execCommand 优先（产品行为变更，非放宽）：
   * 旧断言只验 clipboard.writeText 被调；新链路手势内同步 execCommand 优先，
   * 同步成功就不再走 SDK。因而改验 execCommand 被调、文本=歌名、writeText 未被调。 */
  await clickTab(page, 'imp:1');
  await sleep(250);
  const copyTitle = await D(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-title').textContent);
  await D(() => { window.__execCalls = []; window.__clipCalls = []; window.__forceExecFalse = false; });
  await D(() => { document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-more').click(); });
  await sleep(150);
  await D(() => document.getElementById('copyNameBtn').click());
  await sleep(250);
  g.copyName = await D(() => ({ exec: window.__execCalls.slice(), calls: window.__clipCalls.slice(), toast: document.getElementById('toast').textContent, toastHidden: document.getElementById('toast').hidden }));
  assert('copy-song-name-writes-clipboard',
    g.copyName.exec.length === 1 && g.copyName.exec[0].text === copyTitle &&
    g.copyName.exec[0].text.indexOf('—') < 0 && g.copyName.calls.length === 0 &&
    g.copyName.toastHidden === false,
    JSON.stringify({ ...g.copyName, copyTitle }));

  /* ---- (g2) 同步失败 → 退异步兜底：execCommand 返 false，clipboard.writeText 接手 ---- */
  const copyTitle2 = await D(() => document.querySelectorAll('#queueList .q-row')[1].querySelector('.q-title').textContent);
  await D(() => { window.__execCalls = []; window.__clipCalls = []; window.__forceExecFalse = true; });
  await D(() => { document.querySelectorAll('#queueList .q-row')[1].querySelector('.q-more').click(); });
  await sleep(150);
  await D(() => document.getElementById('copyNameBtn').click());
  await sleep(300);
  g.copyFallback = await D(() => ({ exec: window.__execCalls.slice(), calls: window.__clipCalls.slice(), toast: document.getElementById('toast').textContent, toastHidden: document.getElementById('toast').hidden }));
  assert('copy-song-name-sync-fallback',
    g.copyFallback.exec.length === 1 && g.copyFallback.exec[0].text === copyTitle2 &&
    g.copyFallback.calls.length === 1 && g.copyFallback.calls[0] === copyTitle2 &&
    g.copyFallback.toastHidden === false && g.copyFallback.toast === '已复制歌名',
    JSON.stringify({ ...g.copyFallback, copyTitle2 }));

  /* ---- (g3) coverSrc 纯函数：B站图床转同源代理，其余原样 ---- */
  g.coverSrc = await D(() => {
    const f = window.__playerDebug.coverSrc;
    return {
      hdslb: f('https://i1.hdslb.com/bfs/archive/rain.jpg'),
      hdslbSub: f('https://i2.hdslb.com/a.jpg'),
      netease: f('https://p1.music.126.net/abc/x.jpg?param=200y200'),
      selfRoute: f('/api/apps/hanako-simple-player/routes/_fixture/cover.png'),
      relative: f('docs/x.png'),
      empty: f('')
    };
  });
  assert('cover-src-proxies-hdslb',
    /\/widget\/api\/music\/cover\?url=/.test(g.coverSrc.hdslb) &&
    decodeURIComponent(g.coverSrc.hdslb.split('url=')[1]) === 'https://i1.hdslb.com/bfs/archive/rain.jpg' &&
    /\/widget\/api\/music\/cover\?url=/.test(g.coverSrc.hdslbSub) &&
    g.coverSrc.netease === 'https://p1.music.126.net/abc/x.jpg?param=200y200' &&
    g.coverSrc.selfRoute === '/api/apps/hanako-simple-player/routes/_fixture/cover.png' &&
    g.coverSrc.relative === 'docs/x.png' && g.coverSrc.empty === '',
    JSON.stringify(g.coverSrc));

  /* ---- (h) 最近播放：连播 A→B→C → C,B,A；重播 A → A 到最前 ---- */
  await D(() => {
    const Dbg = window.__playerDebug;
    Dbg.recordRecent({ id: 'netease:aaa', title: 'A', list: 'imp:1' });
    Dbg.recordRecent({ id: 'netease:bbb', title: 'B', list: 'imp:1' });
    Dbg.recordRecent({ id: 'netease:ccc', title: 'C', list: 'imp:1' });
  });
  g.recentOrder = await D(() => window.__playerDebug.recentState().map((t) => t.title));
  assert('recent-order-newest-first',
    g.recentOrder.slice(0, 3).join(',') === 'C,B,A',
    JSON.stringify(g.recentOrder));
  await D(() => window.__playerDebug.recordRecent({ id: 'netease:aaa', title: 'A', list: 'imp:1' }));
  g.recentReplay = await D(() => window.__playerDebug.recentState().map((t) => t.title));
  assert('recent-replay-moves-to-front',
    g.recentReplay.slice(0, 3).join(',') === 'A,C,B',
    JSON.stringify(g.recentReplay));

  /* ---- (i) 超限：丢最旧（末尾）、不丢正在播 ---- */
  await D(() => {
    const Dbg = window.__playerDebug;
    for (let i = 0; i < 120; i++) Dbg.recordRecent({ id: 'netease:o' + i, title: 'O' + i, list: 'imp:1' });
  });
  g.recentOverflow = await D(() => {
    const st = window.__playerDebug.recentState();
    return { len: st.length, first: st[0].title, last: st[st.length - 1].title, hasO0: st.some((t) => t.title === 'O0'), hasO20: st.some((t) => t.title === 'O20') };
  });
  assert('recent-overflow-drops-oldest',
    g.recentOverflow.len === 100 && g.recentOverflow.first === 'O119' &&
    g.recentOverflow.hasO0 === false && g.recentOverflow.hasO20 === true,
    JSON.stringify(g.recentOverflow));

  /* ---- (j) recent 行的菜单：不显示「移动到…」，但移除 + 复制仍在（不改旧行为） ---- */
  await clickTab(page, 'recent');
  await sleep(250);
  await D(() => { const r = document.querySelector('#queueList .q-row'); if (r) r.querySelector('.q-more').click(); });
  await sleep(150);
  g.recentMenu = await D(() => ({
    rows: document.querySelectorAll('#queueList .q-row').length,
    moveHidden: document.getElementById('moveBtn').hidden,
    removeExists: !!document.getElementById('removeBtn'),
    copyExists: !!document.getElementById('copyNameBtn')
  }));
  assert('recent-row-hides-move-keeps-remove-copy',
    g.recentMenu.rows > 0 && g.recentMenu.moveHidden === true &&
    g.recentMenu.removeExists === true && g.recentMenu.copyExists === true,
    JSON.stringify(g.recentMenu));

  report.lists = g;
  await page.close();
}


/* 当前歌单搜索 + 新增置顶：通过真实行按钮、导入入口和持久化验业务行为。 */
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  persistedPlaylist = TRACKS.map((t, i) => i < 2 ? { ...t, name: i ? 'Alpha Two' : 'Alpha One', author: 'Alice' } : { ...t });
  persistedPlaylist.push({ id: 'netease:900051', name: '旧喜欢', author: '旧歌手', url: goUrl(900051), list: 'fav', mode: '在线' });
  persistedPlaylist.push(...[2, 1, 4].map((i) => ({ id: `scan-${i}.mp3`, name: `扫描曲目 ${i}`, url: WAV_URL, list: 'local', mode: '本地' })));
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__playerDebug && document.querySelector('#listTabs .list-tab[data-list="imp:1"]'));
  await clickTab(page, 'imp:1');
  const original = await page.evaluate(() => window.__playerDebug.listTracks('imp:1'));
  const otherOriginal = await page.evaluate(() => window.__playerDebug.listTracks('imp:2'));
  const input = async (query) => page.evaluate((q) => {
    const el = document.getElementById('queueSearchInput');
    el.value = q; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, query);
  const closed = await page.$eval('#queueSearch', (el) => getComputedStyle(el).display === 'none');
  await page.click('#queueSearchBtn');
  const entry = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    return { open: getComputedStyle(document.getElementById('queueSearch')).display !== 'none', focused: document.activeElement.id,
      beforeRename: r('queueSearchBtn').right <= r('renameBtn').left, beforeAdd: r('renameBtn').right <= r('importBtn').left };
  });
  assert('queue-search-entry-before-rename-and-add', closed && entry.open && entry.focused === 'queueSearchInput' && entry.beforeRename && entry.beforeAdd, JSON.stringify(entry));
  const hitsBefore = searchHits;
  await input('  ＡＬＰＨＡ   alice  ');
  const filtered = await rowTitles(page);
  assert('queue-search-title-and-artist-within-current-list', filtered.join(',') === 'Alpha One,Alpha Two' && searchHits === hitsBefore &&
    await page.$eval('#queueCount', (el) => el.textContent) === '2 / 20' && await page.$eval('#queueBtnCount', (el) => el.textContent) === '20', JSON.stringify(filtered));
  await input('不存在的关键词');
  assert('queue-search-no-match-keeps-list-intact', await rowCount(page) === 0 && await page.$eval('#queueList', (el) => el.textContent.includes('没有匹配的歌曲')) &&
    JSON.stringify(await page.evaluate(() => window.__playerDebug.listTracks('imp:1'))) === JSON.stringify(original));
  await page.click('#queueSearchClear');
  assert('queue-search-clear-restores-original-order', (await rowTitles(page)).join('|') === original.map((t) => t.title).join('|') &&
    await page.$eval('#queueSearchInput', (el) => el.value) === '');
  await input('在线曲目 12');
  await page.evaluate(() => document.querySelector('#queueList .q-hit').click());
  await page.waitForFunction(() => window.__playerDebug.currentUid() === 'imp:1|netease:900011');
  await page.click('#nextBtn');
  await page.waitForFunction(() => window.__playerDebug.currentUid() === 'imp:1|netease:900012');
  assert('queue-search-play-keeps-full-playback-order', await rowCount(page) === 1 && await page.evaluate(() => window.__playerDebug.currentUid()) === 'imp:1|netease:900012');
  await page.evaluate(() => document.querySelector('#queueList .q-fav').click());
  const fav = await page.evaluate(() => window.__playerDebug.listTracks('fav'));
  assert('queue-fav-adds-to-top-without-moving-source', fav[0].id === 'netease:900011' && fav[1].id === 'netease:900051' &&
    JSON.stringify(await page.evaluate(() => window.__playerDebug.listTracks('imp:1'))) === JSON.stringify(original), JSON.stringify(fav));
  await page.focus('#queueSearchInput');
  await page.keyboard.press('Escape');
  const firstEsc = await page.evaluate(() => ({ value: document.getElementById('queueSearchInput').value, open: !document.getElementById('queueSearch').hidden, rows: document.querySelectorAll('#queueList .q-row').length }));
  await page.keyboard.press('Escape');
  assert('queue-search-escape-clears-then-closes', firstEsc.value === '' && firstEsc.open && firstEsc.rows === 20 && await page.$eval('#queueSearch', (el) => getComputedStyle(el).display === 'none'));
  await page.click('#queueSearchBtn'); await input('alpha');
  await clickTab(page, 'imp:2');
  assert('queue-search-resets-on-list-switch', await rowCount(page) === 6 && await page.$eval('#queueSearchInput', (el) => el.value === '') && await page.$eval('#queueSearch', (el) => el.hidden));

  // 文件批量导入的返回顺序是 B、A、重复 B；要整批置顶、去重、旧顺序及播放指针不动。
  await clickTab(page, 'imp:1');
  const playingUid = await page.evaluate(() => window.__playerDebug.currentUid());
  const importFiles = async () => {
    await page.evaluate(() => {
      window.hana.resources.pick = async () => ({ resources: [{ path: '/fixture/新增B.mp3' }, { path: '/fixture/新增A.mp3' }, { path: '/fixture/新增B.mp3' }] });
      document.getElementById('importBtn').click();
      document.querySelector('[data-import="file"]').click();
    });
    await page.waitForFunction(() => document.getElementById('importNote').textContent.includes('新增') || document.getElementById('importNote').textContent.includes('没有新曲目'));
  };
  await importFiles();
  await page.waitForFunction(() => window.__playerDebug.listTracks('imp:1').length === 22);
  const imported = await page.evaluate(() => window.__playerDebug.listTracks('imp:1'));
  assert('batch-import-prepends-in-order-and-dedupes', imported.slice(0, 2).map((t) => t.title).join(',') === '新增B,新增A' &&
    JSON.stringify(imported.slice(2)) === JSON.stringify(original) && JSON.stringify(await page.evaluate(() => window.__playerDebug.listTracks('imp:2'))) === JSON.stringify(otherOriginal) &&
    await page.evaluate(() => window.__playerDebug.currentUid()) === playingUid, JSON.stringify(imported.slice(0, 3)));
  await importFiles(); await sleep(250);
  assert('duplicate-import-keeps-existing-order', JSON.stringify(await page.evaluate(() => window.__playerDebug.listTracks('imp:1'))) === JSON.stringify(imported));

  // 移到目标歌单也是一次新增，要在已有喜欢前面；同曲已在目标时仍去重。
  await page.evaluate(() => window.__playerDebug.moveTrackTo('imp:1|新增A.mp3', 'fav'));
  const movedFav = await page.evaluate(() => window.__playerDebug.listTracks('fav'));
  assert('move-to-list-prepends-new-track', movedFav[0].id === '新增A.mp3' && movedFav[1].id === 'netease:900011' && movedFav[2].id === 'netease:900051', JSON.stringify(movedFav));

  // B站「全部喜欢」批量入口复用合并，不能逐项置顶导致分集顺序反转。
  await page.evaluate((url) => {
    const D = window.__playerDebug, bv = 'BV118411B7XU';
    D.renderResults([{ id: 'bilibili:' + bv, title: '合集', url, mode: '在线' }]);
    D.biliPartsFeed(bv, [
      { id: 'bilibili:' + bv + ':p1', title: '分集一', url, page: 1 },
      { id: 'bilibili:' + bv + ':p2', title: '分集二', url, page: 2 }
    ]);
    D.biliPartsFavAll(0);
  }, WAV_URL);
  const parts = await page.evaluate(() => window.__playerDebug.listTracks('fav'));
  assert('batch-fav-keeps-part-order-at-top', parts.slice(0, 2).map((t) => t.title).join(',') === '分集一,分集二' && parts[2].id === '新增A.mp3', JSON.stringify(parts));
  await page.evaluate(() => window.__playerDebug.biliPartsFavAll(0));
  assert('batch-fav-repeat-keeps-order', JSON.stringify(await page.evaluate(() => window.__playerDebug.listTracks('fav'))) === JSON.stringify(parts));

  // 本地重扫：旧顺序 2、1，已删除文件 4 要摘掉；新增文件 3 放到最前。
  await page.evaluate(() => {
    window.hana.resources.pick = async () => ({ resources: [{ path: '/fixture/local-music' }] });
    document.getElementById('importBtn').click();
    document.querySelector('[data-import="folder"]').click();
  });
  await page.waitForFunction(() => window.__playerDebug.activeList() === 'local' && window.__playerDebug.listTracks('local').map((t) => t.id).join(',') === 'scan-3.mp3,scan-2.mp3,scan-1.mp3');
  const localOrder = await page.evaluate(() => window.__playerDebug.listTracks('local').map((t) => t.id));
  assert('local-rescan-prepends-new-keeps-old-order-and-removes-missing', localOrder.join(',') === 'scan-3.mp3,scan-2.mp3,scan-1.mp3', JSON.stringify(localOrder));
  await page.evaluate(() => { document.getElementById('importBtn').click(); document.querySelector('[data-import="folder"]').click(); });
  await page.waitForFunction(() => document.getElementById('toast').textContent === '本地文件夹：3 首');
  assert('local-rescan-existing-files-keep-count-and-order', (await page.evaluate(() => window.__playerDebug.listTracks('local').map((t) => t.id))).join(',') === localOrder.join(','));
  await clickTab(page, 'imp:1');

  // 真 DOM 尺寸和实际截图：三种布局、深浅主题，标题长时按钮也不能被挤出。
  for (const [width, height] of [[312, 420], [465, 930], [1040, 780]]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await sleep(380);
    await page.evaluate(() => {
      const p = document.getElementById('player');
      if ((p.getAttribute('data-layout') === 'compact' && p.getAttribute('data-page') !== 'queue') ||
          (p.getAttribute('data-layout') === 'wide' && p.getAttribute('data-drawer') !== '1')) document.getElementById('queueBtn').click();
      if (document.getElementById('queueSearch').hidden) document.getElementById('queueSearchBtn').click();
      document.getElementById('queueTitle').textContent = '这是一个很长很长的歌单名称，应该省略而不推走搜索按钮';
    });
    await sleep(380);   // 抽屉/整页交叉动画落定后再量和截图
    await page.mouse.move(1, 1);
    for (const tone of ['light', 'dark']) {
      await page.evaluate((t) => window.__fixtureTheme(t), tone);
      const fits = await page.evaluate(() => {
        const box = document.getElementById('queue').getBoundingClientRect();
        const r = document.getElementById('queueSearchBtn').getBoundingClientRect();
        const input = document.getElementById('queueSearchInput').getBoundingClientRect();
        const rows = document.getElementById('queueList').getBoundingClientRect();
        const buttons = ['queueSearchBtn', 'renameBtn', 'importBtn'].map((id) => document.getElementById(id).getBoundingClientRect());
        return { visible: r.width > 0 && buttons.every((b) => b.left >= Math.max(0, box.left) && b.right <= Math.min(innerWidth, box.right)), input: input.width > 100 && input.left >= box.left && input.right <= box.right,
          rows: rows.height > 0, overflow: document.getElementById('queue').scrollWidth > document.getElementById('queue').clientWidth };
      });
      assert(`queue-search-fits-${width}-${tone}`, fits.visible && fits.input && fits.rows && !fits.overflow, JSON.stringify(fits));
      await (await page.$('#queue')).screenshot({ path: path.join(outDir, `queue-search-${width}-${tone}.png`) });
    }
  }
  // 等待保存链完成，再用新文档读回；搜索是临时显示，新增顺序必须持久化。
  await page.waitForFunction(async (api) => {
    const data = await fetch(api + '/widget/api/playlist?appSurfaceSession=fake-ticket').then((r) => r.json());
    return data.tracks.some((t) => t.id === 'bilibili:BV118411B7XU:p2');
  }, {}, API);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__playerDebug && window.__playerDebug.listTracks('fav').length >= 5);
  assert('new-track-order-survives-reload', JSON.stringify(await page.evaluate(() => window.__playerDebug.listTracks('fav'))) === JSON.stringify(parts) && await page.$eval('#queueSearch', (el) => el.hidden));
  await page.close();
}

await browser.close();
server.closeAllConnections();
server.close();

const failed = report.selfCheck.filter((c) => !c.passed);
const narrowFailed = report.narrowSelfCheck.filter((c) => !c.passed);
const assertFailed = report.assertions.filter((a) => !a.ok);
const realErrors = [...new Set(report.runtimeErrors)];
const wiringOk =
  report.wiring.imp1 && report.wiring.imp1.rows === 20 &&
  report.wiring.imp1.dup.length === 0 &&
  report.wiring.imp2 && report.wiring.imp2.rows === 6 &&
  report.wiring.imp2.dup.length === 0 &&
  report.wiring.crossList && report.wiring.crossList.imp2HasSearch === true &&
  report.wiring.geoStableOnSwitch === true &&
  report.wiring.localAfterPick && report.wiring.localAfterPick.rows === 3 &&
  report.wiring.localAfterPick.dup.length === 0 &&
  report.wiring.importPlaylist && report.wiring.importPlaylist.tabsAfter === report.wiring.importPlaylist.tabsBefore + 1 &&
  /* ⚠️ importSingle 断言 2026-10-11 有意修正：链接单曲不再落当前列表，改落 fav。
   * 旧断言（after === before + 1）编码的是旧落点行为；新断言锁新行为：
   * 当前列表不变、不新增列表、fav 多一条。 */
  report.wiring.importSingle && report.wiring.importSingle.favRows === 1 &&
  report.wiring.importSingle.active === report.wiring.importSingle.activeBefore &&
  report.wiring.importSingle.tabsAfter === report.wiring.importSingle.tabsBefore &&
  report.wiring.importSingle.hasUnitList === false &&
  report.wiring.removed === 1 &&
  report.wiring.rename && report.wiring.rename.hasInput === true &&
  report.wiring.rename.headerTitle === '我的歌单' && report.wiring.rename.tabTitle === '我的歌单' &&
  report.darkFallback.changed === true;
const migrationOk = report.migration && report.migration.idempotent === true &&
  report.migration.firstTabs.map((t) => t.label).join(',') === '我的喜欢,最近播放,本地,本地音乐,鸣潮,在线音乐,未分类,旧包名' &&
  report.migration.firstCounts.per['fav'] === 0 &&
  report.migration.firstCounts.per['recent'] === 0 &&
  report.migration.firstCounts.per['local'] === 0 &&
  report.migration.firstCounts.per['imp:1'] === 3 &&
  report.migration.firstCounts.per['imp:2'] === 4 &&
  report.migration.firstCounts.per['imp:3'] === 3 &&
  report.migration.firstCounts.per['imp:4'] === 2 &&
  report.migration.firstCounts.per['imp:5'] === 3 &&
  report.migration.norm && report.migration.norm.oldToNew === report.migration.norm.curKept &&
  report.migration.savedOldPrefixCount === 0 && report.migration.savedNewPrefixCount >= 3;
const lifecycleOk = report.lifecycle && report.lifecycle.crossOk === true && report.lifecycle.blockedOk === true && report.lifecycle.snapshotTrackOk === true && report.lifecycle.seekFollowOk === true;

fs.writeFileSync(path.join(outDir, 'verify.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  selfCheckPassed: report.selfCheck.length - failed.length,
  selfCheckTotal: report.selfCheck.length,
  failedCases: failed.map((f) => ({ case: f.case, failed: f.failed.map((x) => x.name + ' | ' + x.detail) })),
  narrowSelfCheck: `${report.narrowSelfCheck.length - narrowFailed.length}/${report.narrowSelfCheck.length}`,
  narrowFailed: narrowFailed.map((f) => ({ case: f.case, failed: f.failed.map((x) => x.name + ' | ' + x.detail) })),
  assertions: `${report.assertions.length - assertFailed.length}/${report.assertions.length}`,
  failedAssertions: assertFailed,
  search: report.search,
  wiringOk,
  migrationOk,
  lifecycleOk,
  theme: report.theme,
  wiring: report.wiring,
  four: report.four,
  migration: report.migration,
  oldprefix: report.oldprefix,
  lifecycle: report.lifecycle,
  ambient: report.ambient,
  darkFallback: report.darkFallback,
  expectedProbes: [...new Set(report.expectedProbes)],
  runtimeErrors: realErrors.slice(0, 20),
  outDir
}, null, 2));
process.exit(failed.length || narrowFailed.length || assertFailed.length || !wiringOk || !migrationOk || !lifecycleOk || realErrors.length ? 1 : 0);

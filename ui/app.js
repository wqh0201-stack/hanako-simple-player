/* ============================================================
   Hana 极简播放器 · 生产 UI
   纯原生 JS：真 <audio> 驱动、后端路由拉真数据、记忆走 hana.storage.global
   主题只消费宿主 hana.theme（不定义同名变量）
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var SHOT = params.get('shot') === '1';
  if (SHOT) document.body.classList.add('is-shot');

  /* ---------- 当前主题的深浅（权威源）----------
   * 宿主在 iframe URL 里给了 hana-theme-appearance（'light' | 'dark'）=「当前主题
   * 属于深还是浅」。这才是 App 该看的答案；prefers-color-scheme 是操作系统的口音，
   * 与 Hana 主题无关。先落到 <html data-appearance>，让主题样式表还没拉回来的
   * 那一瞬（沉浸色/纱极性）也读得到。
   * 【别拿系统深浅去挑宿主给的两套调色板 —— 那就是当初两个 bug 的根因。】 */
  var HOST_APPEARANCE = params.get('hana-theme-appearance') || '';
  if (HOST_APPEARANCE === 'dark' || HOST_APPEARANCE === 'light') {
    document.documentElement.setAttribute('data-appearance', HOST_APPEARANCE);
  }

  /* ---------- 卡片鉴权 ----------
   * App 卡片的 iframe URL 带 `appSurfaceSession`。后端路由（/api/apps/<id>/routes/...）
   * 靠它鉴权 —— 宿主**不**给页面注入 cookie、也不替页面加头，必须自己带上。
   * fetch 走 header（`X-Hana-App-Surface-Session`，与旧 UI 同路）；
   * <audio>/封面这类改不了头的，走 query（宿主两种都认）。
   * 票只在发请求时贴，存进 playlist.json 的永远是干净 URL。 */
  var SURFACE_SESSION = params.get('appSurfaceSession') || '';
  var SESSION_HEADER = 'X-Hana-App-Surface-Session';
  function sameOrigin(url) {
    try { return new URL(url, location.href).origin === location.origin; }
    catch (e) { return url.charAt(0) === '/'; }
  }
  function withSession(url) {
    if (!SURFACE_SESSION || !url) return url;
    if (url.indexOf('appSurfaceSession=') >= 0) return url;
    if (!sameOrigin(url)) return url;
    return url + (url.indexOf('?') > -1 ? '&' : '?') + 'appSurfaceSession=' + encodeURIComponent(SURFACE_SESSION);
  }
  function apiFetch(url, init) {
    init = init || {};
    if (SURFACE_SESSION) {
      var h = new Headers(init.headers || {});
      if (!h.has(SESSION_HEADER)) h.set(SESSION_HEADER, SURFACE_SESSION);
      init.headers = h;
    }
    return fetch(url, init);
  }

  /* ---------- 后端 ----------
   * 页面由宿主从 /api/apps/<id>/ui/ 下发，路由挂在 /api/apps/<id>/routes/ 下：
   * 同源相对路径，plain fetch 即可（与旧 UI 一致，不需要 surface session）。 */
  var APP_ID = (function () {
    var m = /^\/api\/apps\/([^/]+)\/ui(?:\/|$)/.exec(location.pathname || '');
    return m ? m[1] : 'hanako-simple-player';
  })();
  var API = '/api/apps/' + APP_ID + '/routes';

  /* 旧包名迁移（改名留下的债）。
   * 本 App 从 `hanako-audio-player` 改名成 `hanako-simple-player` 之后，磁盘上
   * playlist.json 里存的是当初写死的**旧包名前缀**绝对路径
   * （/api/apps/<旧id>/routes/…）。旧 app 已停用、路由不再注册，这些地址一律 404 ——
   * 表现是「一点播放就 404，元素加载失败，却被提示成自动播放被拦」。
   * 读时归一：把「任意 appId 的 /routes/ 前缀」改成当前 appId；只有真正指向某个
   * app 路由前缀的才动，其余（本地媒体相对路径 / 外链）原样保留。
   * ⚠️ 判据写成「appId ≠ 当前就归一」，别写死单个旧包名 —— 将来再改名照样能治。 */
  var APP_ROUTE_RE = /^\/api\/apps\/([^/]+)\/routes(\/.*)?$/;
  var appUrlRewrote = false;   // 归一是否真的改过东西（boot 时据此触发一次全量回写自愈）
  function normalizeAppUrl(url) {
    var s = String(url || '');
    var qi = s.indexOf('?');
    var pathPart = qi >= 0 ? s.slice(0, qi) : s;
    var query = qi >= 0 ? s.slice(qi) : '';
    var m = APP_ROUTE_RE.exec(pathPart);
    if (!m || m[1] === APP_ID) return s;
    appUrlRewrote = true;
    return '/api/apps/' + APP_ID + '/routes' + (m[2] || '') + query;
  }

  var ENDPOINT = {
    playlist: API + '/widget/api/playlist',
    track: API + '/api/track',
    nowPlaying: API + '/api/now-playing',
    lrcLoad: API + '/widget/api/lrc/load',
    lrcSave: API + '/widget/api/lrc/save',
    musicLrc: API + '/widget/api/music/lrc',
    lrcProxy: API + '/widget/api/music/lrc-proxy',
    ttml: API + '/widget/api/music/ttml',
    song: API + '/widget/api/music/song',
    musicPlaylist: API + '/widget/api/music/playlist',
    search: API + '/widget/api/music/search',
    hot: API + '/widget/api/music/hot',
    charts: API + '/widget/api/music/charts',
    chartTracks: API + '/widget/api/music/chart-tracks',
    radios: API + '/widget/api/music/radios',
    radioPrograms: API + '/widget/api/music/radio-programs',
    biliParts: API + '/widget/api/music/bili-parts',
    importFile: API + '/widget/api/import-file',
    scanFolder: API + '/widget/api/scan-folder',
    playbackState: API + '/api/playback-state'
  };

  function apiJson(url, init) {
    return apiFetch(url, init).then(function (r) {
      return r.text().then(function (txt) {
        var body = null;
        try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = null; }
        return { ok: r.ok, status: r.status, body: body };
      });
    });
  }
  function apiGetJson(url) { return apiJson(url, { cache: 'no-store' }); }
  function apiPostJson(url, data) {
    return apiJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }
  function apiDeleteJson(url) { return apiJson(url, { method: 'DELETE' }); }
  function apiText(url) {
    return apiFetch(url, { cache: 'no-store' }).then(function (r) {
      return r.text().then(function (txt) { return { ok: r.ok, status: r.status, text: txt }; });
    });
  }

  var MODES = [
    { key: 'list', label: '列表循环', icon: 'i-repeat' },
    { key: 'one', label: '单曲循环', icon: 'i-repeat-one' },
    { key: 'shuffle', label: '随机播放', icon: 'i-shuffle' }
  ];

  /* ---------- 曲目对象 ----------
   * 接口约定：{ id, name, url, mode, dur, group, pic? }，在线导入时 author 另存。
   * id：本地 = 文件名（含扩展名）；在线 = `server:metingId`。
   * 老数据没有 id 时自己派生稳定键（不能不给——后端按稳定 id 去重，
   * 空 id 会把几条无 url 的老条目并成一条，那是数据损失）。 */
  function deriveId(t, url) {
    var id = String(t.id || '').trim();
    if (id) return id;
    var mg = /\/widget\/media\/([^/?#]+)/.exec(url);
    if (mg) return decodeURIComponent(mg[1]);
    var go = /\/music\/go\/([A-Za-z0-9_-]+)(?:\?[^#]*)?/.exec(url);
    var server = /[?&]server=([^&#]+)/.exec(url);
    if (go) return (server ? decodeURIComponent(server[1]) : 'netease') + ':' + go[1];
    var qid = /[?&]id=([^&#]+)/.exec(url);
    if (qid && server) return decodeURIComponent(server[1]) + ':' + decodeURIComponent(qid[1]);
    /* 旧版导入的「在线」曲目只有搜索词（searchKey），没有 url/id。
     * 给它一个稳定的 search: 键，别用歌名（同名会互相覆盖）。 */
    if (t.searchKey) return 'search:' + String(t.searchKey).trim();
    return 'name:' + String(t.name || t.title || '').trim();
  }

  /* 归属列表：'local' = 本地（固定文件夹），'imp:N' = 第 N 个导入歌单。
   * 同一首歌可以同时存在于多个列表 —— 稳定 id 会重复，所以列表内定位一律用
   * uid = `list|id`（见 uidOf），不能用裸 id。 */
  function listOf(t) { return String((t && t.list) || '').trim(); }
  function uidOf(t) { return listOf(t) + '|' + String((t && t.id) || ''); }

  function normalizeTrack(raw) {
    var t = raw && typeof raw === 'object' ? raw : {};
    /* 读时归一：旧包名（或任意非当前 appId）的 /routes/ 前缀改写成当前 appId，
     * 保证改名前的历史曲目也能播。 */
    var url = normalizeAppUrl(t.url || '');
    var mode = t.mode === '在线' ? '在线' : (t.mode === '本地' ? '本地' : (t.group === '在线音乐' ? '在线' : '本地'));
    var title = String(t.name || t.title || '').trim() || '未命名';
    var author = String(t.author || '').trim();
    var id = deriveId(t, url);
    var list = listOf(t);
    return {
      id: id,
      list: list,
      uid: list + '|' + id,
      title: title,
      /* 只放真歌手（author）：拿不到就空。绝不用 group 冒充（来源重做）。 */
      artist: author,
      author: author,
      url: url,
      source: mode === '在线' ? 'online' : 'local',
      mode: mode,
      group: String(t.group || '').trim(),
      pic: String(t.pic || '').trim(),
      lrcUrl: String(t.lrcUrl || t.lrc || '').trim(),
      dur: Number(t.dur) > 0 ? Number(t.dur) : 0,
      raw: t
    };
  }

  /* 回写形状：保留未识别字段（后端去重会合并同 id 的补充信息，别丢） */
  function toStoredTrack(t) {
    var out = {};
    var k;
    for (k in t.raw) if (Object.prototype.hasOwnProperty.call(t.raw, k)) out[k] = t.raw[k];
    out.id = t.id;
    out.list = t.list;
    out.name = t.title;
    /* 落盘也写归一后的地址：让 playlist.json 每次保存逐步自愈，
     * 旧前缀化石自己变成新前缀，以后再改名不再留债。 */
    out.url = normalizeAppUrl(t.url);
    out.mode = t.mode;
    out.dur = t.dur || 0;
    out.group = t.group;
    if (t.author) out.author = t.author; else delete out.author;
    if (t.pic) out.pic = t.pic; else delete out.pic;
    if (t.lrcUrl) out.lrcUrl = t.lrcUrl; else delete out.lrcUrl;
    delete out.title;
    delete out.lrc;
    return out;
  }

  /* 歌词设置属于音频，不属于歌单。喜欢/最近播放/导入列表可以各有一份副本。 */
  function inheritLyricSettings(t) {
    var src = findAnyById(t.id);
    if (!src || !src.raw) return;
    ['lyricOffset', 'lyricMatch'].forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(t.raw, key) &&
          Object.prototype.hasOwnProperty.call(src.raw, key)) t.raw[key] = src.raw[key];
    });
  }
  function setTrackLyricOffset(t, ms) {
    var entries = state.tracks.filter(function (x) { return x.id === t.id; });
    if (entries.indexOf(t) < 0) entries.push(t);
    entries.forEach(function (x) {
      if (!x.raw) x.raw = {};
      if (ms === null) delete x.raw.lyricOffset;
      else x.raw.lyricOffset = ms;
    });
  }

  /* ---------- 状态（接口约定的 playback-state 字段） ---------- */
  var state = {
    tracks: [],
    lists: [],          // [{ id:'local'|'fav'|'imp:N', name }]，顺序即顶部切换条顺序
    activeList: 'fav',  // 全新会话默认落在「我的喜欢」（它排切换条最前，当首页）
    localDir: '',       // 本地固定文件夹绝对路径（空 = 没设过）
    currentUid: '',
    progress: 0,
    volume: 0.8,
    muted: false,
    mode: 'list',
    playing: false,
    needsResume: false, // 自动播放被拦时的「继续播放」引导
    follow: true,
    page: 'play',
    drawer: false,
    splitRatio: 0.62,   // 长卡：舞台占比（可拖分隔线），默认 62%
    lyricLines: [],
    loadError: ''
  };

  /* ---------- 记忆：播放状态走后端路由，歌单元数据走 hana.storage.global ----------
   * 播放状态改后端路由的原因（拖进/拖出 bug）：hana.storage.global.set 是异步 IPC，
   * 页面卸载时可能来不及发出；而「拖进/拖出 = 整份文档被换掉」需要旧文档在 pagehide
   * 时把快照可靠地交给宿主。后端路由可以用 sendBeacon / keepalive fetch，专为卸载时
   * 发一次请求设计，能跨文档存活。快照落 app-data/playback.json。
   * 歌单元数据（顺序 + 名字）与本地文件夹路径仍走 hana.storage.global，它们不涉及卸载竞速。 */
  function hanaStorage() {
    return (window.hana && window.hana.storage && window.hana.storage.global) || null;
  }
  function unwrapStored(v) {
    if (v && typeof v === 'object' && !Array.isArray(v) && ('value' in v)) return v.value;
    return v;
  }
  /* 真实播放位置：优先读媒体时钟（`audio.currentTime`），而不是 state.progress ——
   * 后者只在 timeupdate（~250ms 一次，后台还会被节流）里更新，落盘时可能已经晚了好几秒。
   * 续播落点未到位时（pendingSeek>0）以 state.progress 为准（那是要去的目标位置）。 */
  function liveProgress() {
    var t = currentTrack();
    if (t && t.url && !(pendingSeek > 0) && isFinite(audio.currentTime) && audio.currentTime > 0) {
      if (audio.getAttribute('src') === withSession(t.url)) return audio.currentTime;
    }
    return state.progress;
  }

  function snapshot() {
    var ct = currentTrack();
    /* 在播判定：正常看 state.playing；但卸载时若刚还在播（<1.2s），
     * 即便 audio 已被迫 pause 也仍算在播 —— 否则新文档不会续播。 */
    var playing = !!state.playing || (unloading && lastPlayingAt && (Date.now() - lastPlayingAt) < 1200);
    return {
      currentId: state.currentUid,
      activeList: state.activeList,
      progress: Math.round(liveProgress() * 10) / 10,
      volume: state.volume,
      muted: !!state.muted,
      mode: state.mode,
      playing: !!playing,
      /* 随机模式的来路：拖进/拖出会整份换文档，不落盘就丢了 */
      shuffleTrail: shuffleTrail.slice(-SHUFFLE_TRAIL_MAX),
      /* 当前曲目整条带上（拖进/拖出 = 整份文档被换掉）。
       * playlist.json 的写入是异步的：点搜索结果直接播的那一刻，盘上可能还没有这条
       * （没有任何 savePlaylist 触发过），新文档按 currentId 找不到 → 回退到列表第一首。
       * 把整条曲目放进快照，新文档可直接重建，不再赌盘上的 playlist 够不够新。 */
      currentTrack: ct ? toStoredTrack(ct) : null
    };
  }

  /* 常规写入：串行链 + **真节流**（不是防抖）。
   * 之前写成 900ms 防抖：连续播放时 timeupdate 每 ~250ms 重置一次定时器，
   * 于是**播放期间一次都不落盘** —— 盘上留着的永远是「上一个显式动作」
   * （切歌/暂停/拖动进度条那一下）。拖动到 3:00 后再播到 4:30 切卡片，
   * 新文档读回的就是 3:00。改成「最多每 1.2s 写一次」，位置始终跟着实际播放走。 */
  var writeChain = Promise.resolve();
  var writeTimer = 0;
  var lastWriteAt = 0;
  var WRITE_MIN_GAP = 1200;
  function persistNow() {
    clearTimeout(writeTimer);
    writeTimer = 0;
    lastWriteAt = Date.now();
    var snap = snapshot();
    writeChain = writeChain.then(function () {
      return apiPostJson(ENDPOINT.playbackState, snap).then(function (res) {
        if (!res.ok) console.warn('[player] playback-state 写入失败', res.status);
      }).catch(function (e) {
        console.warn('[player] playback-state 写入异常', e);
      });
    });
    return writeChain;
  }
  function persistThrottled() {
    var now = Date.now();
    if (now - lastWriteAt >= WRITE_MIN_GAP) { persistNow(); return; }   // 距上次写够久 → 立即写
    if (writeTimer) return;                                            // 已排了尾部写，不重复排
    writeTimer = setTimeout(persistNow, WRITE_MIN_GAP - (now - lastWriteAt));
  }
  function persistState() { persistThrottled(); }

  /* 卸载落盘：sendBeacon（首选）→ keepalive fetch（兜底）。
   * 票走 query（同 withSession 口径，宿主 header/query 两种都认）。 */
  function beaconPlayback() {
    var snap = snapshot();
    var url = withSession(ENDPOINT.playbackState);
    var body = JSON.stringify(snap);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) return true;
      }
    } catch (e) { /* 落到 keepalive fetch */ }
    try {
      apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      });
      return true;
    } catch (e) { /* 都不行就算了 */ }
    return false;
  }

  function loadPlaybackState() {
    return apiGetJson(ENDPOINT.playbackState).then(function (res) {
      if (res.ok && res.body && res.body.ok && res.body.state && typeof res.body.state === 'object') {
        return res.body.state;
      }
      return null;
    }).catch(function () { return null; });
  }

  /* ---------- 歌单：列表元数据 + 本地固定文件夹 ----------
   * 列表元数据（顺序 + 原始名）与本地文件夹路径都存 hana.storage.global；
   * 曲目本身仍写在 playlist.json（每条带 list 字段）。
   * 宿主存储不可用时（纯浏览器 / 无宿主 / 卡在 SDK 落地前）退化为内存态：
   * 功能照常，只是不跨重启。绝不写 localStorage（契约）。 */
  var LISTS_KEY = 'player-lists';
  var LOCALDIR_KEY = 'player-local-dir';
  var FIRST_RUN_KEY = 'player-cookie-notice-seen';   // 首次 cookie 说明是否已读
  var memStore = {};

  /* 读存储，返回 { ok, value }：ok=false 表示这次**没读到**（宿主未就绪 / 超时 / 报错）。
   * 存储走宿主桥（v2 应用态存储经宿主代调 server），刚 reload 时桥可能还没应答，
   * 所以超时给宽（5s）；调用方据此避免拿「默认值」覆盖盘上的真实数据。 */
  function storeRead(key) {
    var st = hanaStorage();
    var fallback = Object.prototype.hasOwnProperty.call(memStore, key) ? memStore[key] : null;
    if (!st) return Promise.resolve({ ok: false, value: fallback });
    return Promise.resolve(st.get(key, { timeoutMs: 5000 })).then(function (raw) {
      var v = unwrapStored(raw);
      if (v !== null && v !== undefined) memStore[key] = v;
      return { ok: true, value: v === undefined ? null : v };
    }).catch(function () { return { ok: false, value: fallback }; });
  }
  function storeGet(key) {
    return storeRead(key).then(function (r) { return r.value; });
  }
  function storeSet(key, value) {
    memStore[key] = value;
    var st = hanaStorage();
    if (!st) return Promise.resolve();
    return Promise.resolve(st.set(key, value)).catch(function (e) {
      console.warn('[player] ' + key + ' 写入失败', e);
    });
  }

  function findList(id) {
    for (var i = 0; i < state.lists.length; i++) if (state.lists[i].id === id) return state.lists[i];
    return null;
  }
  function ensureList(id, name) {
    var l = findList(id);
    if (!l) { l = { id: id, name: name || id }; state.lists.push(l); }
    else if (name && !l.name) l.name = name;
    return l;
  }
  function listNum(id) {
    var m = /^imp:(\d+)$/.exec(String(id || ''));
    return m ? parseInt(m[1], 10) : 999999;
  }
  /* 没有保存名字时的默认显示名（元数据丢失时用，避免标题显示 imp:1） */
  function defaultListName(id) {
    if (id === 'fav') return '我的喜欢';
    if (id === 'recent') return '最近播放';
    if (id === 'local') return '本地';
    var m = /^imp:(\d+)$/.exec(String(id || ''));
    return m ? '歌单 ' + m[1] : String(id || '');
  }

  /* 歌单名压缩（切换条展示用）：罐头歌单叫「Can_0201喜欢的音乐」→ 显示「Can_0201」。
   * 规则可预期：先去掉「喜欢的音乐 / 的歌单 / 歌单」这类后缀，标点归一，
   * 仍超过 8 字就截断加省略号。完整名放 title 悬停。自动名「歌单 3」归一成编号。 */
  function compressListName(name) {
    var raw = String(name == null ? '' : name).trim();
    if (!raw) return '';
    var auto = /^(?:歌单|单曲|本地文件)\s+(\d+)$/.exec(raw);
    if (auto) return auto[1];
    var s = raw.replace(/\s*(?:的)?(?:喜欢的音乐|喜欢的歌曲|喜欢的歌|喜欢的单曲|的歌单|歌单)$/, '').trim();
    if (!s) s = raw;
    s = s.replace(/[，、]/g, ',').replace(/[。]/g, '.').replace(/[：]/g, ':').replace(/\s+/g, ' ').trim();
    if (s.length > 8) s = s.slice(0, 8) + '…';
    return s;
  }

  /* 切换条上显示的列表名：我的喜欢 / 本地固定；导入歌单走压缩名，没有名字退编号。 */
  function listDisplayName(l) {
    if (!l) return '';
    if (l.id === 'fav') return '我的喜欢';
    if (l.id === 'recent') return '最近播放';
    if (l.id === 'local') return '本地';
    var name = String(l.name || '').trim();
    var shown = compressListName(name);
    if (shown) return shown;
    return String(l.id || '').replace(/^imp:/, '');
  }

  /* 曲目的「来源」名 = 它所属列表的名字（本地 →「本地」）。列表没了就退回默认名。 */
  function sourceName(t) {
    var id = listOf(t);
    var l = findList(id);
    if (l && l.name) return l.name;
    if (id === 'local') return '本地';
    if (id) return defaultListName(id);
    return t.mode === '在线' ? '在线' : '本地';
  }
  function nextImportId() {
    var max = 0;
    for (var i = 0; i < state.lists.length; i++) {
      var m = /^imp:(\d+)$/.exec(state.lists[i].id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return 'imp:' + (max + 1);
  }
  function saveLists() { storeSet(LISTS_KEY, state.lists); }

  /* ---------- 我的喜欢（fav 固定列表）----------
   * 判定用**稳定 id**（不是 uid）：同一首歌在不同列表里 uid 不同，用 uid 判会
   * 出现「在原歌单点过心、切到我的喜欢里心是灭的」。
   * 加入 = 在 fav 列表里放一份副本；取消 = 只摘掉 fav 那份，原歌单纹丝不动。
   * 这沿用了现有约定：同一首歌可同时存在于多个列表。 */
  function favEntryOf(stableId) {
    var id = String(stableId || '').trim();
    if (!id) return null;
    for (var i = 0; i < state.tracks.length; i++) {
      var t = state.tracks[i];
      if (t.list === 'fav' && t.id === id) return t;
    }
    return null;
  }
  function isFav(stableId) { return !!favEntryOf(stableId); }

  function findAnyById(stableId) {
    var id = String(stableId || '').trim();
    for (var i = 0; i < state.tracks.length; i++) {
      if (state.tracks[i].id === id) return state.tracks[i];
    }
    return null;
  }

  function addFav(stableId) {
    if (favEntryOf(stableId)) return true;
    var src = findAnyById(stableId);
    if (!src) return false;
    ensureList('fav', '我的喜欢');
    var stored = toStoredTrack(src);   // 借用回写形状，保住 pic/author/lrcUrl/raw 补充字段
    stored.list = 'fav';
    state.tracks.push(normalizeTrack(stored));
    savePlaylist();
    return true;
  }

  /* 取消喜欢。若正在播的恰好是 fav 里那份副本，不能直接掋掉指针：
   *  · 原歌单/其他列表里有同一首歌 → 把播放指针转过去（无缝，不打断）；
   *  · 确实没有别的副本 → 打 detached（只够播完当前这首，不回写盘，
   *    下次启动不会把「我的喜欢」里已取消的那首重建）。 */
  function removeFav(stableId) {
    var id = String(stableId || '').trim();
    if (!id) return false;
    var playingEntry = null;
    state.tracks = state.tracks.filter(function (t) {
      if (!(t.list === 'fav' && t.id === id)) return true;
      if (t.uid === state.currentUid) { playingEntry = t; return true; }   // 暂留
      return false;
    });
    if (playingEntry) {
      var alt = null;
      for (var i = 0; i < state.tracks.length; i++) {
        var x = state.tracks[i];
        if (x.id === id && x.uid !== playingEntry.uid) { alt = x; break; }
      }
      if (alt) {
        state.currentUid = alt.uid;
        state.tracks = state.tracks.filter(function (t) { return t.uid !== playingEntry.uid; });
      } else {
        playingEntry.detached = true;
      }
    }
    savePlaylist();
    return false;
  }

  /* 切换喜欢。返回切换后的状态。 */
  function toggleFav(stableId) {
    if (isFav(stableId)) return removeFav(stableId);
    return addFav(stableId);
  }

  /* 「最近播放」：任何来源播过的歌都自动记进去，最近在前。
   * 按**稳定 id** 去重（同曲不同列表的副本只记一条）；已在则移到最前（重播更新顺序）。
   * 不是收藏，所以**不看红心**；也不落 detached 的临时条目。
   * 上限 RECENT_MAX 条，超出丢最旧。写盘交给调用方（playTrack 里已 persistNow）。 */
  var RECENT_MAX = 100;
  function recordRecent(t) {
    if (!t || !t.id) return;
    ensureList('recent', '最近播放');
    var id = t.id;
    var existing = null;
    for (var i = 0; i < state.tracks.length; i++) {
      if (state.tracks[i].list === 'recent' && state.tracks[i].id === id) { existing = state.tracks[i]; break; }
    }
    if (existing) {
      // 已在最近播放：若内容有更新（封面/歌手/时长补齐）就刷新，顺序不用改（本来就在最后）。
      var src = toStoredTrack(t);
      src.list = 'recent';
      var fresh = normalizeTrack(src);
      fresh.uid = existing.uid;
      var idx = state.tracks.indexOf(existing);
      if (idx >= 0) state.tracks[idx] = fresh;
      // 移到该列表末尾（visibleTracks 按 state.tracks 顺序，末尾 = 最新）
      state.tracks.splice(idx, 1);
      state.tracks.push(fresh);
    } else {
      var stored = toStoredTrack(t);
      stored.list = 'recent';
      state.tracks.push(normalizeTrack(stored));
    }
    // 超限：从最旧的（recent 里最靠前的）开始丢
    var recents = [];
    for (var j = 0; j < state.tracks.length; j++) if (state.tracks[j].list === 'recent') recents.push(j);
    var over = recents.length - RECENT_MAX;
    for (var k = 0; k < over; k++) {
      // 不能丢掉正在播的那首（丢了 currentTrack 会找不到）
      var dropIdx = recents[k];
      if (state.tracks[dropIdx] && state.tracks[dropIdx].uid !== state.currentUid) state.tracks.splice(dropIdx, 1);
    }
  }

  /* 把一颗红心按当前状态刷成「亮/灭」。按钮可复用（队列行、播放页各一个）。 */
  function paintFav(btn, t) {
    if (!btn) return;
    var on = !!(t && isFav(t.id));
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var label = on ? '取消喜欢' : '加入我的喜欢';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  /* 红心反馈：填充立即更新，比例 1 → 1.16 → .98 → 1（只作用于图标，不动布局）。 */
  function popHeart(btn) {
    if (!btn) return;
    btn.classList.remove('is-pop');
    void btn.offsetWidth;
    btn.classList.add('is-pop');
    clearTimeout(btn._popT);
    btn._popT = setTimeout(function () { btn.classList.remove('is-pop'); }, 400);
  }

  /* 每个列表内按 uid 去重（跨列表不去重 —— 同一首歌在两个歌单里是合理的）。
   * 保留首次出现的位置，后出现的同 uid 项并入（补齐 pic/author 之类）。 */
  function dedupeWithinLists(tracks) {
    var seen = {};
    var out = [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (!t.uid) t.uid = uidOf(t);
      if (seen[t.uid] !== undefined) { out[seen[t.uid]] = t; continue; }
      seen[t.uid] = out.length;
      out.push(t);
    }
    tracks.length = 0;
    for (var j = 0; j < out.length; j++) tracks.push(out[j]);
  }

  /* 旧数据迁移（幂等）：
   *  · 本地列表 = 严格等于那个固定文件夹（拍板），所以旧数据不再往 local 塞；
   *    一律按原 group 各自成一个导入列表，按首次出现顺序编 1/2/3…
   *  · group 缺失 → "未分类"
   *  · 每个列表内按稳定 id 去重；跨列表不去重
   *  · 已经带 list 字段的数据原样保留，再跑一次不改变结构
   * 返回是否真正改写了曲目（需要回写 playlist.json）。 */
  function migrateLists(tracks, savedLists) {
    var i, t;
    var needsAssign = false;
    for (i = 0; i < tracks.length; i++) {
      if (!String(tracks[i].list || '').trim()) { needsAssign = true; break; }
    }

    /* 「我的喜欢」是固定列表：任何迁移路径下都保证它在，且不可删/不可重命名。
     * 它排在排序函数的第一位（见下），所以这里只需确保存在。 */
    if (needsAssign) {
      var groupToId = {};
      var ordered = [];
      var seq = 0;
      for (i = 0; i < tracks.length; i++) {
        t = tracks[i];
        var list = String(t.list || '').trim();
        if (!list) {
          var g = String(t.group || '').trim() || '未分类';
          if (!groupToId[g]) { seq++; groupToId[g] = { id: 'imp:' + seq, name: g }; ordered.push(groupToId[g]); }
          list = groupToId[g].id;
        }
        t.list = list;
        t.uid = uidOf(t);
      }
      state.lists = [{ id: 'local', name: '本地' }];
      for (i = 0; i < ordered.length; i++) state.lists.push(ordered[i]);
    } else {
      state.lists = [];
      ensureList('local', '本地');
      if (savedLists && savedLists.length) {
        for (i = 0; i < savedLists.length; i++) {
          var s = savedLists[i];
          if (s && s.id && s.id !== 'local') ensureList(String(s.id), String(s.name || s.id));
        }
      }
      for (i = 0; i < tracks.length; i++) {
        t = tracks[i];
        if (t.list && t.list !== 'local') ensureList(t.list, defaultListName(t.list));
        t.uid = uidOf(t);
      }
    }

    dedupeWithinLists(tracks);
    ensureList('fav', '我的喜欢');   // 固定列表，永不缺位
    ensureList('recent', '最近播放');   // 固定列表，永不缺位
    /* 切换条顺序：我的喜欢 → 最近播放 → 本地 → 导入歌单（imp:N 按编号）。 */
    var listRank = function (id) {
      return id === 'fav' ? 0 : (id === 'recent' ? 1 : (id === 'local' ? 2 : 3));
    };
    state.lists.sort(function (a, b) {
      var ra = listRank(a.id), rb = listRank(b.id);
      if (ra !== rb) return ra - rb;
      if (ra === 3) return listNum(a.id) - listNum(b.id);
      return 0;
    });
    return needsAssign;
  }

  /* SDK 是 ES module，可能比本脚本晚落地；宿主没给就走无宿主降级（不留 localStorage） */
  function waitForHana(timeoutMs) {
    return new Promise(function (resolve) {
      if (window.hana) return resolve(true);
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(false); } }, timeoutMs);
      window.addEventListener('hana-sdk-ready', function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /* 首次使用提示：只弹一次。
   * 条件卡得紧：**只有「存储确实读过且读到空」才弹** ——
   * 存储不可用（纯浏览器 / 宿主未就绪 / 测试无头环境）时读不到，就不弹，
   * 否则每次启动都弹一次，那是骚扰不是提示。 */
  function closeFirstRun(remember) {
    var el = $('firstRun');
    if (el) el.hidden = true;
    if (remember) storeSet(FIRST_RUN_KEY, 1);
  }
  function maybeShowFirstRun(read) {
    var el = $('firstRun');
    if (!el || SHOT) return;                 // 截图模式不打扰（保持图确定性）
    if (!read || read.ok !== true) return;   // 读不到 → 不弹
    if (read.value) return;                  // 已读过 → 不弹
    el.hidden = false;
    var ok = $('firstRunOk');
    if (ok && !ok._bound) { ok._bound = true; ok.addEventListener('click', function () { closeFirstRun(true); }); }
  }

  /* ---------- 播放列表：读写都走后端（与工具侧共用 playlist.json） ---------- */
  function loadPlaylist() {
    return apiGetJson(ENDPOINT.playlist).then(function (res) {
      if (!res.ok || !res.body || !Array.isArray(res.body.tracks)) {
        throw new Error('playlist 接口异常 ' + res.status);
      }
      return res.body.tracks.map(normalizeTrack);
    });
  }

  var saveChain = Promise.resolve();
  function savePlaylist() {
    /* detached 曲目（删列表时被豁免、只为播完当前那首的运行时条目）不回写盘：
     * 否则下次启动会按它的 list 把已删列表重建出来。 */
    var payload = { tracks: state.tracks.filter(function (t) { return !t.detached; }).map(toStoredTrack) };
    saveChain = saveChain.then(function () {
      return apiPostJson(ENDPOINT.playlist, payload).then(function (res) {
        if (!res.ok) console.warn('[player] playlist 写入失败', res.status);
        return res;
      });
    }).catch(function (e) {
      console.warn('[player] playlist 写入异常', e);
    });
    return saveChain;
  }

  /* 把新曲目并入指定列表（按 uid 去重，保留原位置；同 uid 覆盖补充信息）。
   * 返回真正新增的条数。 */
  function mergeTracks(incoming, listId) {
    var index = {};
    var i;
    for (i = 0; i < state.tracks.length; i++) index[state.tracks[i].uid] = i;
    var added = 0;
    for (i = 0; i < incoming.length; i++) {
      var t = normalizeTrack(incoming[i]);
      inheritLyricSettings(t);
      t.list = listId;
      t.uid = uidOf(t);
      if (index[t.uid] !== undefined) {
        state.tracks[index[t.uid]] = t;
      } else {
        index[t.uid] = state.tracks.length;
        state.tracks.push(t);
        added++;
      }
    }
    return added;
  }

  /* ---------- 元素 ---------- */
  var frame = $('frame');
  var player = $('player');
  var sceneTop = $('sceneTop');
  var queue = $('queue');
  var queueHead = $('queueHead');
  var listTabs = $('listTabs');
  var queueList = $('queueList');
  var lyrics = $('lyrics');
  var lyricWrap = $('lyricWrap');
  var lyricScrim = $('lyricScrim');
  var drawerScrim = $('drawerScrim');
  var seek = $('seek');
  var vol = $('vol');
  var toastEl = $('toast');
  var audio = $('audio');

  /* ---------- 工具 ---------- */
  function icon(id, cls) {
    return '<svg class="icon ' + (cls || '') + '" aria-hidden="true"><use href="#' + id + '"></use></svg>';
  }
  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function visibleTracks() {
    var out = [];
    for (var i = 0; i < state.tracks.length; i++) {
      if (state.tracks[i].list === state.activeList) out.push(state.tracks[i]);
    }
    return out;
  }
  function trackByUid(uid) {
    if (!uid) return null;
    for (var i = 0; i < state.tracks.length; i++) {
      if (state.tracks[i].uid === uid) return state.tracks[i];
    }
    return null;
  }
  function currentTrack() {
    var t = trackByUid(state.currentUid);
    if (t) return t;
    var vis = visibleTracks();
    return vis[0] || state.tracks[0] || null;
  }
  function currentIndex() {
    var vis = visibleTracks();
    for (var i = 0; i < vis.length; i++) {
      if (vis[i].uid === state.currentUid) return i;
    }
    return -1;
  }
  /* 时长：优先拿真实 <audio> 的（本地/在线都可能比列表里存的准） */
  function trackDuration(t) {
    if (!t) return 0;
    if (t.uid === state.currentUid && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return Number(t.dur) > 0 ? Number(t.dur) : 0;
  }
  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }
  /* 真实歌名里会有引号/尖括号，进 innerHTML 前必须转义 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* 封面：有 pic 就用在线封面，没有（或加载失败）就露兜底渐变 */
  function coverImage(url) {
    return url ? 'url(' + JSON.stringify(withSession(url)) + '), var(--cover-fallback)' : 'var(--cover-fallback)';
  }
  /* 舞台封面专用：不叠兜底层 —— contain 的留白要让底下的环境色透出来，
   * 而不是盖一块纸（队列行的小封面仍用 coverImage，那里留白小、叠兜底更稳）。 */
  function coverStageImage(url) {
    return url ? 'url(' + JSON.stringify(withSession(url)) + ')' : 'var(--cover-fallback)';
  }
  function coverUrlOnly(url) {
    return url ? 'url(' + JSON.stringify(withSession(url)) + ')' : 'none';
  }

  /* ============================================================
     封面主色调（背景色来源）
     网易式：右列（歌词那侧）铺一层「封面主色调」平色，封面右缘淡出融进去。
     —— 不再用「封面模糊照片」当底（照片里的集中色会被糊成一坨暖块）。
     做法：整图降采样 → 4bit 量化统计 → 取占比最多的色（跳过近中性，
     没有才退回全图最多）。同时算亮度定字色极性 data-ambient。
     封面带 CORS，canvas 取像素不 taint；非 CORS / 解码失败静默退回主题极性。
     ============================================================ */
  var coverAR = 0;             // 封面画幅比（只读自然尺寸，不碰 canvas）
  var coverProbeToken = 0;     // 切歌竞态：过期结果丢弃
  var ambientCache = {};       // pic → { color, polarity }（或 null=失败）
  var stagePic = '';           // 当前舞台封面

  function lumOf(c) {
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
  }

  /* RGB → HSL（h 0~360, s/l 0~1）。 */
  function toHsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var h = 0, s = 0, l = (mx + mn) / 2;
    if (d > 1e-6) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  /* HSL → RGB。 */
  function fromHsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    function f(n) {
      var k = (n + h / 30) % 12;
      var a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    }
    return [f(0), f(8), f(4)];
  }
  /* 背景撞色：取主色的互补色相（转 150° 附近，够撞但不髿），
   * 再按极性定亮度 —— 深纱上提亮、浅纱上压深，保证在纱上可读。
   * 输入主色 + 'light'/'dark'（当前极性）。 */
  function accentFrom(color, polarity) {
    var hsl = toHsl(color);
    var h = hsl[0] + 150;                       // 互补偏一点，避开刺眼的纯 180
    var s = Math.max(0.42, Math.min(0.72, hsl[1] * 0.9 + 0.22)); // 保底彩度
    var l = polarity === 'dark' ? 0.72 : 0.40;  // 深纱亮、浅纱暗
    return fromHsl(h, s, l);
  }
  function rgbStr(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
  /* 解析 CSS 计算出的颜色字符串 → [r,g,b]。
   * 主题变量可能是 #rrggbb / rgb(a)() / color-mix 算完的 rgb() 串；
   * 宿主主题文件里也确有 #FFF 这种三位写法（delve 主题），一并认。 */
  function rgbStr2arr(s) {
    if (!s) return null;
    s = String(s).trim();
    var m = s.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h.replace(/(.)/g, '$1$1');
      if (h.length < 6) return null;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
    return null;
  }

  /* 占比最多的色（4bit/通道量化）。近中性色（灰/黑/白）降权，优先取有彩的：
   * 纯灰底当背景平淡，封面里的彩才是「主色调」的观感来源。 */
  function dominantColor(data, w, h) {
    var buckets = {};
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      var r = data[i], g = data[i + 1], b = data[i + 2];
      var key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      var bk = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
      bk.n++; bk.r += r; bk.g += g; bk.b += b;
    }
    var best = null, bestColored = null;
    for (var k in buckets) {
      if (!Object.prototype.hasOwnProperty.call(buckets, k)) continue;
      var x = buckets[k];
      var avg = [Math.round(x.r / x.n), Math.round(x.g / x.n), Math.round(x.b / x.n)];
      var mx = Math.max(avg[0], avg[1], avg[2]), mn = Math.min(avg[0], avg[1], avg[2]);
      var sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (!best || x.n > best.n) best = { n: x.n, c: avg };
      if (sat >= 0.14 && (!bestColored || x.n > bestColored.n)) bestColored = { n: x.n, c: avg };
    }
    return bestColored ? bestColored.c : (best ? best.c : null);
  }

  /* 平面主色下选字色极性：哪种纱（浅纱墨字 / 深纱纸字）在该底色上对比度更高。 */
  function polarityFor(color) {
    var cs = getComputedStyle(document.documentElement);
    function hex(s) {
      var m = /^#([0-9a-f]{6})$/i.exec(String(s).trim());
      if (!m) return null;
      var v = parseInt(m[1], 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }
    function ratio(a, b) {
      var la = lumOf(a), lb = lumOf(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }
    function over(fg, bg, a) { return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)]; }
    var sets = [
      { key: 'light', veil: hex(cs.getPropertyValue('--veil-paper')), text: hex(cs.getPropertyValue('--on-veil-ink')), a: parseFloat(cs.getPropertyValue('--veil-paper-a')) },
      { key: 'dark', veil: hex(cs.getPropertyValue('--veil-ink')), text: hex(cs.getPropertyValue('--on-veil-paper')), a: parseFloat(cs.getPropertyValue('--veil-ink-a')) }
    ];
    var best = null;
    for (var i = 0; i < sets.length; i++) {
      var s = sets[i];
      if (!s.veil || !s.text || !(s.a > 0)) continue;
      var bg = over(s.veil, color, s.a);
      var ct = ratio(s.text, bg);
      if (!best || ct > best.ct) best = { key: s.key, ct: ct };
    }
    return best ? best.key : (lumOf(color) > 0.45 ? 'light' : 'dark');
  }

  function themePolarity() {
    /* 优先读宿主给的权威深浅（data-appearance），其次主题字面量 light/dark，
     * 再次按真实底色 --hk-surface 算，最后才退系统深浅。
     * data-theme 现在装的是主题 id（midnight / warm-paper …），不再当深浅用；
     * 之前只认字面量 'dark'/'light'，既接不住主题 id、又掉回系统深浅，
     * 于是「系统浅色 + 主题深色」时纱/字挑错极性。 */
    var ap = document.documentElement.getAttribute('data-appearance');
    if (ap === 'dark' || ap === 'light') return ap;
    /* 按实际底色算，排在 data-theme 字面量之前 ——
     * HTML 里有写死的 data-theme="light" 占位，先信它会在真·auto 时把系统深色钉成浅。 */
    try {
      var s = getComputedStyle(document.documentElement).getPropertyValue('--hk-surface').trim();
      var c = rgbStr2arr(s);
      if (c) return lumOf(c) > 0.5 ? 'light' : 'dark';
    } catch (e) { /* 读不到就继续退 */ }
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
    catch (e) { return 'light'; }
  }

  /* 把「当前主题深浅」落到 <html data-appearance>，供 CSS 选压在强调色上的字
   * （--hk-on-accent）等。三个分支：
   *   - 宿主主题已生效（主题样式表定义了 --bg）→ 按实际底色 --hk-bg 算（换主题后自动跟上）；
   *   - 主题还没回来、但 URL 有权威值 → 用 HOST_APPEARANCE 垫；
   *   - 真·auto（两者都无）→ 读 --hk-bg（此时 = fallback，本来就按系统深浅切）→ 与 CSS 兜底一致。
   * 总之不用系统深浅去猜宿主主题的深浅；系统深浅只在真·auto 时才该参与。 */
  function syncAppearance() {
    var ap = '';
    try {
      var cs = getComputedStyle(document.documentElement);
      var hasHost = !!cs.getPropertyValue('--bg').trim();
      if (!hasHost && HOST_APPEARANCE) {
        ap = HOST_APPEARANCE;
      } else {
        var c = rgbStr2arr(cs.getPropertyValue('--hk-bg').trim());
        if (c) ap = lumOf(c) > 0.5 ? 'light' : 'dark';
      }
    } catch (e) { /* 读不到就退 URL 值 */ }
    if (!ap) ap = HOST_APPEARANCE;
    if (ap && document.documentElement.getAttribute('data-appearance') !== ap) {
      document.documentElement.setAttribute('data-appearance', ap);
    }
  }

  /* 「悬停抬升」的两档物理得按【真实底色】选，不能猜主题名。
   * 宿主主题 id 有十来个（warm-paper / midnight / high-contrast / delve …），
   * data-theme 只有 light/dark 两种写法，靠名字判会误判。
   * 直接读 --hk-surface（= 控制条 / 队列那层面板色，也是 .player 的底色桥）算相对亮度。
   * .5 不写死 —— 取 [0.5] 附近都给 light（浅纸那一片都在 0.8+，深板岩在 0.06）。 */
  function resolveTone() {
    var raw = '';
    try { raw = getComputedStyle(player).getPropertyValue('--hk-surface').trim(); }
    catch (e) { raw = ''; }
    var c = rgbStr2arr(raw) || (themePolarity() === 'light' ? [252, 250, 245] : [65, 77, 86]);
    return lumOf(c) > 0.5 ? 'light' : 'dark';
  }
  function applyTone() {
    syncAppearance();   // 先把当前主题深浅落到 data-appearance（--hk-on-accent 等要用）
    var tone = resolveTone();
    if (player.getAttribute('data-tone') !== tone) player.setAttribute('data-tone', tone);
  }
  /* 无宿主主题时（走 CSS 的 prefers-color-scheme 兜底），macOS 切深浅不会派主题事件，
   * 得自己听 —— 否则 data-tone 停在启动那一刻，悬停光在浅底上用了深底那套。 */
  try {
    var toneMq = matchMedia('(prefers-color-scheme: dark)');
    var onToneMq = function () { setTimeout(applyTone, 0); };
    if (toneMq.addEventListener) toneMq.addEventListener('change', onToneMq);
    else if (toneMq.addListener) toneMq.addListener(onToneMq);
  } catch (e) { /* 老引擎：不管，启动时那一判已够用 */ }

  function applyAmbient(res) {
    if (!res || !res.color) {
      /* 取色失败 / 无封面：撤掉主色底，退回主题纸面；字色跟主题 */
      player.style.removeProperty('--ambient-color');
      player.style.removeProperty('--ambient-accent');
      player.classList.remove('ambient-ok');
      player.setAttribute('data-ambient', player.classList.contains('nocover') ? 'none' : themePolarity());
      return;
    }
    player.style.setProperty('--ambient-color', rgbStr(res.color));
    /* 当前句高亮：用背景撞色（互补色相 + 按极性定亮度），不跟随主题强调色 */
    player.style.setProperty('--ambient-accent', rgbStr(accentFrom(res.color, res.polarity)));
    player.classList.add('ambient-ok');
    player.setAttribute('data-ambient', res.polarity);
  }

  /* 取色还没回来时的临时态：先按主题极性亮字，出结果再校正 */
  function applyAmbientPending() {
    if (!player.classList.contains('nocover')) player.setAttribute('data-ambient', themePolarity());
  }

  /* 取色用小图：网易云封面支持 ?param=100y100（约 25KB），省流量也快 */
  function ambientUrl(url) {
    var u = withSession(url);
    if (/\.music\.126\.net/.test(u) && u.indexOf('param=') < 0) {
      u += (u.indexOf('?') > -1 ? '&' : '?') + 'param=100y100';
    }
    return u;
  }

  /* 取封面主色调（与画幅探测分开：非 CORS 封面也要量得出画幅） */
  function probeAmbient(pic, token) {
    if (Object.prototype.hasOwnProperty.call(ambientCache, pic)) {
      applyAmbient(ambientCache[pic]);
      return;
    }
    var img = new Image();
    var settled = false;
    function done(res) {
      if (settled) return;
      settled = true;
      ambientCache[pic] = res || null;
      if (token !== coverProbeToken) return;
      applyAmbient(res);
    }
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var SW = 40, SH = 40;
        var cv = document.createElement('canvas');
        cv.width = SW; cv.height = SH;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, SW, SH);
        var data = ctx.getImageData(0, 0, SW, SH).data;
        var color = dominantColor(data, SW, SH);
        done(color ? { color: color, polarity: polarityFor(color) } : null);
      } catch (e) {
        /* 非 CORS 封面 / 解码失败 / getImageData 抛 SecurityError → 静默退回 */
        done(null);
      }
    };
    img.onerror = function () { done(null); };
    img.src = ambientUrl(pic);
  }

  /* 舞台指标（纯呈现）：封面锚定「左/上/下」三边、满高贴左；
   * 宽度 = 舞台高 × 画幅比（方图就是方的），溢出交给 scene 裁。
   * 过渡：封面右缘与歌词底层共用同一个「接缝」--seam 和「带宽」--band，
   * 在一个水平带里做镜像 alpha mask（网易式）——两边严丝合缝交汇。 */
  function updateStageMetrics() {
    var sceneEl = $('scene');
    if (!sceneEl) return;
    var w = sceneEl.clientWidth;
    var h = sceneEl.clientHeight;
    if (!(w > 0) || !(h > 0)) return;
    var ar = coverAR > 0 ? coverAR : 1;
    var coverW = Math.max(96, h * ar);
    /* 带宽：跟舞台宽走，夹在 120~220 */
    var band = Math.max(120, Math.min(220, w * 0.19));
    /* 接缝：淡出带末端（seam+band/2）必须收在封面右缘内 —— 否则封面 mask 走到
     * 元素边界还没淡完，就会被硬切一刀（那条接缝）。留 8px 余量，末端落在封面宽
     * 的 ~94% 处（与高手做法一致：淡出在封面内部就结束，末尾一段全透）。 */
    var seam = coverW - band * 0.5 - 8;
    /* 但也不能太靠左：夹在舞台宽的 32%~58% */
    seam = Math.max(w * 0.32, Math.min(seam, w * 0.58));
    /* 歌词列起点：宽窗下跟随面板宽度线性右移（网易式：右缘锚定，左缘占面板宽的比
   * 随宽度缓慢上升）—— 封面固定三边、不跟随；窄卡仍叠进过渡带，与封面右缘重叠。
   * 线性系数由网易两档实测反推：911px→0.513、1253px→0.526。 */
    var contentX;
    if (player.getAttribute('data-layout') === 'wide') {
      var ratio = 0.478 + 0.000038 * w;
      ratio = Math.max(0.48, Math.min(ratio, 0.56));
      contentX = w * ratio;
      /* 下限：不落进封面实体中部（贴在封面右缘的羽化带里）；上限：留最小列宽 */
      contentX = Math.max(contentX, coverW * 0.72);
      contentX = Math.min(contentX, w - 210);
    } else {
      contentX = Math.max(w * 0.30, seam - band * 0.30);
    }
    player.style.setProperty('--cover-w', Math.round(coverW) + 'px');
    player.style.setProperty('--seam', Math.round(seam) + 'px');
    player.style.setProperty('--band', Math.round(band) + 'px');
    player.style.setProperty('--content-x', Math.round(contentX) + 'px');
    if (stagePic) probeAmbient(stagePic, coverProbeToken);
    measureLyricTop();
  }
  /* 歌词阅读列必须从标题块下方开始，否则歌名/歌手/元信息会与歌词行叠字。
   * 标题块高度随歌名行数与 meta 有无变化，所以量而不是写死。 */
  function measureLyricTop() {
    var sceneEl = $('scene');
    if (!sceneEl) return;
    var host = sceneTop;
    if (!host || host.offsetParent === null) return;
    var hb = host.getBoundingClientRect();
    var sb = sceneEl.getBoundingClientRect();
    var gap = 10;
    var top = Math.max(44, Math.round(hb.bottom - sb.top + gap));
    player.style.setProperty('--lyric-top', top + 'px');
  }
  function probeCover(pic) {
    var token = ++coverProbeToken;
    if (!pic) {
      coverAR = 0;
      applyAmbient(null);
      updateStageMetrics();
      return;
    }
    applyAmbientPending();
    /* 画幅比例：只读 Image 自然尺寸 —— 绝不碰 canvas（非 CORS 封面也要量得出来） */
    var img = new Image();
    img.onload = function () {
      if (token !== coverProbeToken) return;
      coverAR = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 0;
      updateStageMetrics();   /* 尺寸齐了再由它触发取色（带可见右缘比例） */
    };
    img.onerror = function () {
      if (token !== coverProbeToken) return;
      coverAR = 0;
      updateStageMetrics();
    };
    img.src = withSession(pic);
  }
  function applyCovers() {
    var t = currentTrack();
    var pic = t && t.pic ? t.pic : '';
    stagePic = pic;
    /* 呈现层标记：无封面时走「纸面留白」兜底（只切 CSS 变量，不动业务） */
    player.classList.toggle('nocover', !pic);
    $('cover').style.backgroundImage = coverStageImage(pic);
    /* 晕开层：同一张封面的模糊放大副本（取色失败时的兜底） */
    $('coverHaze').style.backgroundImage = coverUrlOnly(pic);
    probeCover(pic);
    var rows = queueList.querySelectorAll('.q-row');
    for (var i = 0; i < rows.length; i++) {
      var tr = trackByUid(rows[i].getAttribute('data-uid'));
      var el = rows[i].querySelector('.q-cover');
      if (el && tr) el.style.backgroundImage = coverImage(tr.pic || '');
    }
  }

  /* ============================================================
     渲染
     ============================================================ */
  /* 元信息行（罐头指定）：来源 = 这首歌所属歌单名，格式「来源·<歌单名>」，
   * 用间隔点。本地列表 →「来源·本地」。不再吃 group（v1 遗留），也不再显示专辑
   * （后端无此字段，硬留只会多一个空标签）。 */
  function metaLine(t) {
    return '来源·' + sourceName(t);
  }

  /* 控制条曲目信息（宽窗专属）：歌名一行 + 歌手一行；没曲目就清空。
   * 只作用于文字节点，不动红心与布局。 */
  function setCtlTrack(t) {
    var copy = $('ctlTitle');
    if (!copy) return;
    var nameEl = $('ctlTitleText'), artistEl = $('ctlArtist');
    if (nameEl) nameEl.textContent = t ? (t.title || '') : '';
    if (artistEl) artistEl.textContent = t ? (t.author || '') : '';
    copy.title = t ? ((t.title || '') + (t.author ? ' · ' + t.author : '')) : '';
  }
  /* 切歌时给曲目信息一次「从下方 5px 回位」的入场（只作用于文字）。 */
  function flashCtlTrack() {
    var box = $('controls');
    if (!box) return;
    box.classList.remove('is-changing');
    void box.offsetWidth;
    box.classList.add('is-changing');
    clearTimeout(flashCtlTrack._t);
    flashCtlTrack._t = setTimeout(function () { box.classList.remove('is-changing'); }, 320);
  }

  /* 歌手名行：舞台上的歌手名同时是「搜这位歌手」的入口（三种布局都能开搜索页）。
   * actionable=false 时只当一行字看（无曲目时的引导语 / 拿不到歌手），禁用点击并隐去搜索字形。 */
  function setArtistLine(text, actionable) {
    var btn = $('trackArtist');
    if (!btn) return;
    var name = $('trackArtistName');
    if (name) name.textContent = text || '';
    btn.hidden = !text;
    btn.disabled = !actionable;
    var label = actionable ? ('搜索歌手：' + text) : '';
    btn.title = label;
    if (actionable) btn.setAttribute('aria-label', label);
    else btn.removeAttribute('aria-label');
  }

  /* 空列表时的引导语：＋ 住在队列面板头部（#importBtn），而队列在三种布局里位置不同 ——
   * 长卡常驻在下方、窄卡是独立一页、独立窗是右侧抽屉（都从右下角队列键进）。
   * 所以不能一律说「右上角」（那是极简版早期的位置，控制条/队列重排后就失效了）。 */
  function emptyImportHint() {
    if (player.getAttribute('data-layout') === 'long') return '点下方播放列表里的 ＋ 添加';
    return '点右下角队列里的 ＋ 添加';
  }

  /* 换布局（长卡/窄卡/独立窗）后 ＋ 的位置跟着变，空列表引导语要重写。 */
  function refreshEmptyHint() {
    if (currentTrack()) return;
    setArtistLine(emptyImportHint(), false);
  }

  function renderTrack() {
    var t = currentTrack();
    var favBtn = $('stageFavBtn');
    var favTextBtn = $('favBtn');
    /* 播放页红心是空标签（只有外壳），图标得自己塞（只塞一次）。 */
    if (favBtn && !favBtn.querySelector('use')) favBtn.innerHTML = icon('i-heart');
    if (!t) {
      $('trackTitle').textContent = '还没有曲目';
      setArtistLine(emptyImportHint(), false);
      $('trackMeta').textContent = '';
      setCtlTrack(null);
      lyricState = 'idle'; renderAsk();
      paintFav(favBtn, null);
      paintFav(favTextBtn, null);
      if (favBtn) favBtn.hidden = true;   // 没曲目可喜欢，不留孤零零一颗心
      seek.max = '0';
      $('durTime').textContent = '--:--';
      applyCovers();
      syncMediaSession();
      return;
    }
    $('trackTitle').textContent = t.title;
    /* 副标题只放真歌手：拿不到就留空省略，不把来源/分组冒充歌手（R3）。
     * 有歌手时它同时是「搜这位歌手」的入口。 */
    setArtistLine(t.author || '', !!t.author);
    $('trackMeta').textContent = metaLine(t);
    setCtlTrack(t);
    paintFav(favBtn, t);
    paintFav(favTextBtn, t);
    if (favBtn) favBtn.hidden = false;
    var d = trackDuration(t);
    seek.max = String(d || 0);
    $('durTime').textContent = d ? fmtTime(d) : '--:--';
    applyCovers();
    measureLyricTop();
    syncMediaSession();
  }

  /* 歌单切换条的溢出处理：原生横向滚 + 两侧按需渐隐 + 当前项跟随。
   * 为什么不能只靠 overflow-x：滚动条藏了，用户看不出「后面还有」。
   * 为什么不能每次重渲染都把当前项滚进来：点心/移出也会重渲染，那会抢走用户手动滚的位置；
   * 所以只在「激活项真的换了」时才滚（lastActiveTabId 比对）。 */
  var lastActiveTabId = null;
  var TAB_PAD = 14;   // 与 .list-tabs 左右 padding 一致，改 CSS 要同步
  function updateTabFade() {
    if (!listTabs) return;
    var max = listTabs.scrollWidth - listTabs.clientWidth;
    var over = max > 1;
    listTabs.classList.toggle('is-scroll-l', over && listTabs.scrollLeft > 1);
    listTabs.classList.toggle('is-scroll-r', over && listTabs.scrollLeft < max - 1);
  }
  function ensureTabVisible(tab) {
    if (!tab || !listTabs) return;
    var sl = listTabs.scrollLeft, vw = listTabs.clientWidth;
    var l = tab.offsetLeft, r = l + tab.offsetWidth;
    if (l < sl + TAB_PAD) listTabs.scrollLeft = Math.max(0, l - TAB_PAD);
    else if (r > sl + vw - TAB_PAD) listTabs.scrollLeft = r - vw + TAB_PAD;
    updateTabFade();
  }
  function renderListTabs() {
    if (!listTabs) return;
    var html = '';
    for (var i = 0; i < state.lists.length; i++) {
      var l = state.lists[i];
      var label = listDisplayName(l);
      var active = l.id === state.activeList;
      html += '<button class="list-tab' + (active ? ' is-active' : '') + '" id="listTab' + i + '" type="button" role="tab"' +
        ' aria-selected="' + (active ? 'true' : 'false') + '" data-list="' + esc(l.id) + '"' +
        ' title="' + esc(l.name || label) + '">' + esc(label) + '</button>';
    }
    listTabs.innerHTML = html;
    if (state.activeList !== lastActiveTabId) {
      lastActiveTabId = state.activeList;
      ensureTabVisible(listTabs.querySelector('.list-tab.is-active'));
    }
    updateTabFade();
  }

  /* 列表空时的安静引导（不是空白） */
  function emptyGuide() {
    if (state.activeList === 'fav') {
      return '<li class="q-empty q-guide">' +
        '<p class="q-guide-text">还没有喜欢的歌</p>' +
        '<p class="q-guide-hint">在队列或播放页点亮红心，就会收到这里</p>' +
        '</li>';
    }
    if (state.activeList === 'recent') {
      return '<li class="q-empty q-guide">' +
        '<p class="q-guide-text">还没有播放记录</p>' +
        '<p class="q-guide-hint">播放过的歌会自动收在这里，最近的在最前</p>' +
        '</li>';
    }
    if (state.activeList === 'local') {
      if (!state.localDir) {
        return '<li class="q-empty q-guide">' +
          '<p class="q-guide-text">还没有选择本地文件夹</p>' +
          '<button class="q-guide-btn" id="localPickBtn" type="button">' +
            icon('i-folder', 'icon-sm') + '<span>选择文件夹</span>' +
          '</button>' +
          '</li>';
      }
      return '<li class="q-empty q-guide">' +
        '<p class="q-guide-text">这个文件夹里还没有音频文件</p>' +
        '<button class="q-guide-btn" id="localRescanBtn" type="button">' +
          icon('i-repeat', 'icon-sm') + '<span>重新扫描</span>' +
        '</button>' +
        '</li>';
    }
    return '<li class="q-empty">这个歌单还没有曲目</li>';
  }

  function renderQueue() {
    renderListTabs();
    var vis = visibleTracks();
    var html = '';
    for (var i = 0; i < vis.length; i++) {
      var t = vis[i];
      var cur = t.uid === state.currentUid;
      html += '<li class="q-row' + (cur ? ' is-current' : '') + '" id="qRow' + i + '" data-id="' + esc(t.id) + '" data-uid="' + esc(t.uid) + '">' +
        '<button class="q-hit" id="qHit' + i + '" type="button" title="' + esc(t.title + (t.artist ? ' — ' + t.artist : '')) + '">' +
          '<span class="q-cover"></span>' +
          '<span class="q-meta">' +
            '<span class="q-title">' + esc(t.title) + '</span>' +
            /* 队列第二行：有歌手显歌手，没有就留空（不让 group 再冒充） */
            '<span class="q-artist">' + esc(t.author || '') + '</span>' +
          '</span>' +
          /* 正在播放指示：行内 SVG（不走 <use>，否则选择器进不了 shadow tree，条形动画不会生效） */
          '<span class="q-eq"><svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M6.5 9.5v9"/><path d="M12 5.5v13"/><path d="M17.5 11.5v7"/>' +
          '</svg></span>' +
          '<span class="q-dur">' + (t.dur ? fmtTime(t.dur) : '--:--') + '</span>' +
        '</button>' +
        '<button class="q-fav' + (isFav(t.id) ? ' is-on' : '') + '" id="qFav' + i + '" type="button" aria-pressed="' + (isFav(t.id) ? 'true' : 'false') + '" aria-label="' + (isFav(t.id) ? '取消喜欢' : '加入我的喜欢') + '" title="' + (isFav(t.id) ? '取消喜欢' : '加入我的喜欢') + '">' + icon('i-heart') + '</button>' +
        '<button class="q-more" id="qMore' + i + '" type="button" aria-label="更多操作：' + esc(t.title) + '">' + icon('i-more') + '</button>' +
      '</li>';
    }
    if (!html) html = emptyGuide();
    queueList.innerHTML = html;
    applyCovers();
    var n = vis.length;
    $('queueCount').textContent = String(n);
    $('queueBtnCount').textContent = String(n);
    // 队列头显示当前列表名（重命名后这里可见）；本地页固定「本地」
    var act = findList(state.activeList);
    var qt = $('queueTitle');
    if (qt && !renaming) qt.textContent = (act && act.name) || '播放队列';
    var rb = $('renameBtn');
    if (rb) rb.hidden = !(act && act.id !== 'local' && act.id !== 'fav' && act.id !== 'recent');
  }

  /* 把正在播的那首滚进队列可视区中部。切列表 / 切歌时调（罐头拍板）。
   * 为什么不在 renderQueue 里无条件重建后就居中：点心/移出等操作也会重渲染，
   * 那时不该抢用户的滚动位置。所以只在两个明确时机调。 */
  function centerCurrentInQueue() {
    if (!queueList) return;
    var row = queueList.querySelector('.q-row.is-current');
    if (!row) return;
    var rTop = row.offsetTop;
    var rH = row.offsetHeight;
    var vH = queueList.clientHeight;
    var max = queueList.scrollHeight - vH;
    if (max <= 0) return;   // 内容不滚，无需居中
    var target = Math.max(0, Math.min(rTop - vH / 2 + rH / 2, max));
    queueList.scrollTop = target;
  }

  function renderResume() {
    var btn = $('resumeBtn');
    if (btn) btn.hidden = !state.needsResume;
  }

  function renderProgress() {
    var t = currentTrack();
    if (!t) {
      seek.value = '0';
      $('curTime').textContent = '0:00';
      seek.style.setProperty('--fill', '0%');
      return;
    }
    var d = trackDuration(t);
    var p = d ? Math.min(state.progress, d) : state.progress;
    seek.value = String(p);
    $('curTime').textContent = fmtTime(p);
    seek.style.setProperty('--fill', (d ? (p / d * 100) : 0).toFixed(2) + '%');
  }

  function renderVolume() {
    var v = Math.round(state.volume * 100);
    /* 静音时滑条归零（轨道也空），但 state.volume 原样保留 —— 取消静音直接回来，不用另存“上次音量”。 */
    var shown = state.muted ? 0 : v;
    vol.value = String(shown);
    vol.style.setProperty('--fill', shown + '%');
    var muted = state.muted || v === 0;
    /* 音量档：弧线 1/2/3 条随音量递增（静音走 X）。三档弧线同心，越响越宽。 */
    var lvl = v >= 67 ? 3 : (v >= 34 ? 2 : 1);
    $('muteBtn').innerHTML = icon(muted ? 'i-volume-mute' : ('i-volume-' + lvl));
    $('muteBtn').setAttribute('aria-label', muted ? '取消静音' : '静音');
    $('muteBtn').title = muted ? '取消静音' : '静音';
  }

  function renderMode() {
    var m = MODES.filter(function (x) { return x.key === state.mode; })[0] || MODES[0];
    var btn = $('modeBtn');
    btn.innerHTML = icon(m.icon);
    btn.setAttribute('aria-label', '播放模式：' + m.label + '（点击切换）');
    btn.title = '播放模式：' + m.label;
  }

  function renderPlayState() {
    /* 播放/暂停两枚字形都在 DOM 里（.glyph-play / .glyph-pause），交叉淡入淡出由
       #player[data-playing] 切换 —— 不重写 innerHTML，圆与位置不跳。 */
    var btn = $('playBtn');
    btn.setAttribute('aria-label', state.playing ? '暂停' : '播放');
    btn.title = state.playing ? '暂停' : '播放';
    player.setAttribute('data-playing', state.playing ? '1' : '0');
  }

  /* 歌词不再有用户开关：有词就显歌词，无词时只剩封面 + 涟漪。
   * data-lyrics 保留为常量 "1" —— CSS 的换层交叉动画以它做命名空间，别删。 */
  function renderLyricMode() {
    player.setAttribute('data-lyrics', '1');
  }

  /* ============================================================
     指针涟漪（Canvas 2D 装饰层）：兼顶旧「频谱」的位置
     ------------------------------------------------------------
     2026-10-10 采用「流光」：照 docs/player-ui/ripple-lab.html 的 light 模式移植
     双缓冲高度场 → 水面法线化成明暗（低分辨率放大成柔光）+ 压扁圆环。
     音频反应：captureStream() 另拷一路接 Analyser（绝不用 createMediaElementSource），
     鼓点落波、低频定强度；跨源抛错则退回纯指针，绝不静音。
     强度两档（由 #player[data-haslyrics] 决定）：无词 0.50（放），有词 0.32（收）；
     数值对齐 lab 的「波澜」滑杆。
     层序：涟漪在薄纱之上、文字之下 —— 封面区与歌词区都可见，又不压字。
     行为约定：
       · 指针移动累计路程才落波；按下 → 更大的多层环；
       · 播放且空闲时低频自起（一呼一吸）；无波期间不起 rAF；
       · 暂停后约 400ms 收敛，随后停止；暂停期间忽略指针，不会被鼠标唤醒；
       · 截图模式冻结当前帧；reduced-motion / 页面隐藏 / 离开视口 → 停调度。
     ============================================================ */
  var rippleHandle = null;

  function initRipples() {
    var scene = $('scene');
    var canvas = $('rippleCanvas');
    if (!scene || !canvas || !canvas.getContext) return null;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var waves = [], trail = [], raf = 0, timer = 0, last = 0, accumulator = 0;
    var width = 0, height = 0, dpr = 1;
    var cols = 0, rows = 0, field = null, previous = null, fieldEnergy = 0;
    var playing = !!(audio && !audio.paused && !audio.ended);
    var destroyed = false, inView = true, drain = 0;
    var point = null, travel = 0, emitted = 0, inputAt = 0, sinceInject = 0;
    var low = null, lc = null, pixels = null, rgbCache = null, rgbKey = '';
    var dprQuery;
    var pointerOptions = { passive: true, capture: true };
    var MAX_WAVES = 22, MAX_TRAIL = 40;
    /* 强度两档：无词更放（水面当主角），有词更收（不扰读词）。
       数值对齐 docs/player-ui/ripple-lab.html 的「波澜」滑杆（0.5 比 lab 最低档 0.6 略轻）。 */
    function strength() { return (player && player.getAttribute('data-haslyrics') === '1') ? 0.32 : 0.50; }

    function shot() { return document.body.classList.contains('is-shot'); }
    function blocked() {
      return destroyed || (reduce && reduce.matches) || shot() || document.hidden ||
        !inView || !width || !height;
    }
    function clear() { ctx.clearRect(0, 0, width, height); }
    function stop() { cancelAnimationFrame(raf); clearTimeout(timer); raf = timer = last = accumulator = 0; }
    function resetPointer() { point = null; travel = 0; sinceInject = 0; }
    function needsFrame() {
      return !!(waves.length || trail.length || fieldEnergy > 0.00002 || drain > 0);
    }

    /* ============================================================
       音频反应（真 FFT）：把 <audio> 的音频另拷一路接 AnalyserNode，
       鼓点落波、低频定强度 —— 水面跟着音乐起伏。

       只走 captureStream()、**绝不** createMediaElementSource：
         后者把元素输出重定向进 Web Audio 且不可逆；跨源音频（网易 CDN）
         一旦进去浏览器会输出全零（歌在播、时间在走，但完全没声音），
         而全曲共用一个 <audio>，一次建链就再也退不回。
       captureStream() 不碰元素输出：同源（走 music/go 的同源分片代理）拿到
       MediaStream 能读频域；跨源抛错 → 捕获后退回纯指针，**绝不静音**。
       ============================================================ */
    var audioCtx = null, msSrc = null, analyser = null, freqData = null;
    var audioReady = false, audioBuilding = false, audioRaf = 0;
    var bass = 0, bassAvg = 0, lastBeat = 0, beatCount = 0, readAt = 0;

    function audioSupported() {
      return !!(window.AudioContext || window.webkitAudioContext) && !!(audio && audio.captureStream);
    }
    function attachAudio() {
      if (audioCtx.state !== 'running') return false;
      try {
        var stream = audio.captureStream();
        var tracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
        if (!tracks.length) throw new Error('no audio track');
        var ms = audioCtx.createMediaStreamSource(stream);
        var an = audioCtx.createAnalyser();
        an.fftSize = 4096;                // 44.1k 下 ≈10.8Hz/bin：40~180Hz 低频才有足够分辨率
        an.smoothingTimeConstant = 0.65;
        an.minDecibels = -90; an.maxDecibels = -15;
        var g = audioCtx.createGain();
        g.gain.value = 0;                 // 副本静音：只取数据，不与元素自身出声叠加
        ms.connect(an); an.connect(g); g.connect(audioCtx.destination);  // 图要通到 destination，Analyser 才会被拉数据
        msSrc = ms; analyser = an;
        freqData = new Float32Array(an.frequencyBinCount);
        audioReady = true; audioBuilding = false;
        startAudioLoop();
        return true;
      } catch (e) {
        detachAudio();                     // 跨源 / 不支持：退回纯指针，绝不静音
        return false;
      }
    }
    function buildAudio() {
      if (audioBuilding || audioReady || !audioSupported() || !audio.src) return;
      audioBuilding = true;
      if (!audioCtx) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { audioBuilding = false; return; }
      }
      if (audioCtx.state === 'running') { if (attachAudio()) return; }
      audioCtx.resume().then(function () { if (!attachAudio()) audioBuilding = false; })
        .catch(function () { audioBuilding = false; });
    }
    function detachAudio() {
      stopAudioLoop();
      if (msSrc) { try { msSrc.disconnect(); } catch (e) {} msSrc = null; }
      if (analyser) { try { analyser.disconnect(); } catch (e) {} analyser = null; }
      freqData = null; audioReady = false; audioBuilding = false;
      bass = 0; bassAvg = 0;
    }
    function startAudioLoop() { if (!audioRaf && audioReady) audioRaf = requestAnimationFrame(audioLoop); }
    function stopAudioLoop() { if (audioRaf) { cancelAnimationFrame(audioRaf); audioRaf = 0; } }
    function audioLoop() {
      audioRaf = 0;
      if (destroyed || !audioReady) return;
      if (!blocked() && playing) readSignal(performance.now(), null);
      audioRaf = requestAnimationFrame(audioLoop);
    }
    /* 读频域：40~180Hz 的能量当「低频」；超过滑动均值 1.28 倍且够响 → 落一个波。 */
    function readSignal(now, forceBass) {
      if (forceBass == null && (!analyser || !audioReady)) return;
      if (forceBass == null && now - readAt < 30) return;
      readAt = now;
      if (forceBass != null) bass = forceBass;
      else {
        try { analyser.getFloatFrequencyData(freqData); } catch (e) { return; }
        var binHz = audioCtx.sampleRate / analyser.fftSize;
        var lo = Math.max(1, Math.floor(40 / binHz)), hi = Math.min(freqData.length, Math.ceil(180 / binHz));
        var energy = 0, count = 0;
        for (var n = lo; n < hi; n++) { energy += Math.pow(10, freqData[n] / 10); count++; }
        bass = Math.sqrt(energy / Math.max(1, count));
      }
      bassAvg = bassAvg * 0.93 + bass * 0.07;
      if (bass > 0.014 && bass > bassAvg * 1.28 && now - lastBeat > 300) {
        lastBeat = now; beatCount++;
        drop(0.60 + Math.sin(beatCount * 2.4) * 0.19, 0.52 + Math.cos(beatCount * 1.7) * 0.19, Math.min(1.9, 0.7 + bass * 6));
      }
    }

    function size() {
      if (destroyed || shot()) return;   // 截图时连 backing store 都不改
      var w = canvas.clientWidth, h = canvas.clientHeight;
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (w === width && h === height && ratio === dpr && field) return;
      width = w; height = h; dpr = ratio;
      canvas.width = Math.max(1, Math.round(w * ratio));
      canvas.height = Math.max(1, Math.round(h * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      /* 高度场网格：约每 4.8 CSS px 一格，封顶 260×160（照 lab）。 */
      cols = Math.max(3, Math.min(260, Math.round(width / 4.8)));
      rows = Math.max(3, Math.min(160, Math.round(height / 4.8)));
      field = new Float32Array(cols * rows);
      previous = new Float32Array(cols * rows);
      /* 流光要一块低分辨率画布：高度场先化成明暗图，再放大成柔光。 */
      if (!low) { low = document.createElement('canvas'); lc = low.getContext('2d'); }
      low.width = cols; low.height = rows;
      pixels = lc.createImageData(cols, rows);
      fieldEnergy = 0;
      resetPointer();
      if (!blocked()) draw();
    }

    /* 局部高斯扰动：把一个波「注入」高度场。 */
    function inject(nx, ny, radius, power) {
      if (!field) return;
      var x = nx * (cols - 1), y = ny * (rows - 1), r = Math.ceil(radius * 2.4);
      for (var j = Math.max(1, Math.floor(y) - r); j < Math.min(rows - 1, Math.ceil(y) + r); j++) {
        for (var i = Math.max(1, Math.floor(x) - r); i < Math.min(cols - 1, Math.ceil(x) + r); i++) {
          var d = (i - x) * (i - x) + (j - y) * (j - y);
          field[j * cols + i] += Math.exp(-d / (radius * radius)) * power;
        }
      }
      fieldEnergy = 1;
    }

    /* 落一个波包（按下 / 呼吸 / 指针累计路程）：环 + 高度场能量。 */
    function drop(x, y, power) {
      if (blocked()) return;
      if (waves.length >= MAX_WAVES) waves.shift();
      waves.push({
        x: x, y: y, age: 0, power: power,
        life: 2.9 + power * 0.35, phase: Math.random() * 6.28
      });
      inject(x, y, 1.7 + power * 0.7, power * strength() * 1.8);
      wake();
    }

    /* 双缓冲高度场推进：邻域平均 + 阻尼，波会真的传播与干涉。 */
    function stepField() {
      var sum = 0;
      for (var y = 1; y < rows - 1; y++) {
        for (var x = 1; x < cols - 1; x++) {
          var i = y * cols + x;
          var v = ((field[i - 1] + field[i + 1] + field[i - cols] + field[i + cols]) * 0.5 - previous[i]) * 0.976;
          previous[i] = v; sum += v * v;
        }
      }
      var swap = previous; previous = field; field = swap;
      fieldEnergy = sum / (cols * rows);
    }

    /* 把 --hl-accent 解成 [r,g,b]：能从 rgb() 串直接取就直接取，取不到用 1×1 画布兜底。 */
    function resolveRGB(col) {
      if (col === rgbKey && rgbCache) return rgbCache;
      var out, m = /rgba?\(([^)]+)\)/.exec(col);
      if (m) {
        var q = m[1].split(/[,\s\/]+/);
        out = [parseFloat(q[0]) || 0, parseFloat(q[1]) || 0, parseFloat(q[2]) || 0];
      } else {
        var probe = document.createElement('canvas'); probe.width = probe.height = 1;
        var pc = probe.getContext('2d'); pc.fillStyle = col; pc.fillRect(0, 0, 1, 1);
        var d = pc.getImageData(0, 0, 1, 1).data; out = [d[0], d[1], d[2]];
      }
      rgbCache = out; rgbKey = col; return out;
    }

    /* 流光：把高度场当水面法线，用「边缘 + 坡度」化成明暗，低分辨率放大 —— 波过处一片柔光漫开。 */
    function paintField(fade, s) {
      if (!pixels) return;
      var rgb = resolveRGB(getComputedStyle(canvas).color);
      var data = pixels.data;
      for (var y = 1; y < rows - 1; y++) {
        for (var x = 1; x < cols - 1; x++) {
          var i = y * cols + x, o = i * 4;
          var dx = field[i + 1] - field[i - 1], dy = field[i + cols] - field[i - cols];
          var edge = Math.abs(dx * 0.65 + dy * 0.85), slope = Math.sqrt(dx * dx + dy * dy);
          var a = Math.min(0.64, (edge * 0.22 + slope * 0.06) * s);
          data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = Math.round(a * 255);
        }
      }
      lc.putImageData(pixels, 0, 0);
      ctx.globalAlpha = fade;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(low, 0, 0, width, height);
    }

    /* 压扁的椭圆环（水面透视），形状带一点随机扰动。 */
    function ringPath(w, r, phase) {
      var x = w.x * width, y = w.y * height;
      ctx.beginPath();
      for (var n = 0; n <= 88; n++) {
        var a = n / 88 * Math.PI * 2;
        var def = 1 + Math.sin(a * 3 + w.phase + phase) * 0.014 + Math.sin(a * 7 - w.age) * 0.005;
        var px = x + Math.cos(a) * r * def, py = y + Math.sin(a) * r * 0.68 * def;
        if (n === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }

    function draw() {
      clear();
      if (reduce && reduce.matches) return;
      // CSS 负责解析 var() / color-mix()，Canvas 只接收计算后的颜色。
      ctx.strokeStyle = getComputedStyle(canvas).color;
      var fade = drain > 0 ? Math.min(1, drain / 0.4) : 1;
      var s = strength();
      if (fieldEnergy > 0.00001) paintField(fade, s);
      for (var i = 0; i < waves.length; i++) {
        var w = waves[i], p = w.age / w.life;
        var birth = Math.min(1, w.age / 0.10), end = Math.pow(1 - p, 1.8);
        var reach = Math.min(width, height) * (0.44 + w.power * 0.14);
        var radius = 8 + reach * (1 - Math.pow(1 - p, 2));
        for (var k = 0; k < 4; k++) {
          var r = radius - k * (10 + w.power * 5) * (1 - p * 0.45);
          if (r < 3) continue;
          var alpha = birth * end * (0.60 - k * 0.105) * Math.min(1.4, s) * fade;
          ringPath(w, r, k * 0.3);
          ctx.lineWidth = k === 0 ? 5 : 2.5; ctx.globalAlpha = alpha * 0.075; ctx.stroke();
          ctx.lineWidth = k === 0 ? 1.25 : 0.7; ctx.globalAlpha = alpha; ctx.stroke();
        }
        if (w.age < 0.55) {
          ctx.globalAlpha = (1 - w.age / 0.55) * 0.8 * fade; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.arc(w.x * width, w.y * height, 2 + w.age * 14, 0, Math.PI * 2); ctx.stroke();
        }
      }
      if (trail.length > 1) {
        for (var t = 1; t < trail.length; t++) {
          ctx.strokeStyle = getComputedStyle(canvas).color;
          ctx.globalAlpha = Math.max(0, 1 - trail[t].age / 0.65) * 0.45 * Math.min(1, s) * fade;
          ctx.lineWidth = 0.65 + 1.8 * (1 - trail[t].age / 0.65);
          ctx.beginPath();
          ctx.moveTo(trail[t - 1].x * width, trail[t - 1].y * height);
          ctx.lineTo(trail[t].x * width, trail[t].y * height);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    function breathe() {
      timer = 0;
      if (blocked() || !playing) return;
      // 鼠标仍在缓慢移动时，不让呼吸波与交互争抢。
      if (performance.now() - inputAt < 4500) { schedule(); return; }
      drop(0.25 + Math.random() * 0.5, 0.3 + Math.random() * 0.4, 0.7);
      schedule();
    }
    function schedule() {
      if (!timer && playing && !blocked()) {
        timer = setTimeout(breathe, 5000 + Math.random() * 2500);
      }
    }
    function wake() {
      if (blocked() || (!playing && drain <= 0)) return;
      if (!needsFrame()) { schedule(); return; }
      clearTimeout(timer); timer = 0;
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    }
    function frame(now) {
      raf = 0;
      if (blocked()) { stop(); return; }
      var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (!playing) {
        drain = Math.max(0, drain - dt);
        if (!drain) {
          waves.length = 0; trail.length = 0;
          if (field) { field.fill(0); previous.fill(0); }
          fieldEnergy = 0; clear(); return;
        }
      }
      for (var i = waves.length - 1; i >= 0; i--) {
        waves[i].age += dt;
        if (waves[i].age >= waves[i].life) waves.splice(i, 1);
      }
      for (var t = trail.length - 1; t >= 0; t--) {
        trail[t].age += dt;
        if (trail[t].age > 0.65) trail.splice(t, 1);
      }
      accumulator += dt;
      if (fieldEnergy > 0.00002) {
        var steps = 0;
        while (accumulator >= 1 / 60 && steps < 3) { stepField(); accumulator -= 1 / 60; steps++; }
      } else accumulator = 0;
      if (!waves.length && !trail.length && fieldEnergy < 0.00002) {
        fieldEnergy = 0;
        if (field) { field.fill(0); previous.fill(0); }
      }
      draw();
      if (needsFrame()) raf = requestAnimationFrame(frame);
      else { last = 0; schedule(); }
    }

    function sync() {
      if (destroyed) return;
      stop(); resetPointer();
      if (reduce && reduce.matches) {
        waves.length = 0; trail.length = 0;
        if (field) { field.fill(0); previous.fill(0); }
        fieldEnergy = 0; drain = 0; clear(); return;
      }
      if (shot()) return;   // 保留最后一帧及波的年龄
      size();
      if (!blocked()) { draw(); wake(); }
    }
    function resume() { if (destroyed || playing) return; playing = true; drain = 0; buildAudio(); startAudioLoop(); sync(); }
    function pause(immediate) {
      if (destroyed) return;
      if (!playing && immediate !== true) return;   // audio 的事件对象不视作 immediate
      playing = false;
      stopAudioLoop();
      drain = immediate === true ? 0 : 0.4;
      if (immediate === true) { waves.length = 0; trail.length = 0; }
      sync();
    }

    function position(e) {
      var r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, t: performance.now() };
    }
    function allowed(e) {
      return playing && !blocked() && e.isPrimary !== false && e.pointerType !== 'touch';
    }
    function move(e) {
      if (!allowed(e)) return;
      var p = position(e);
      inputAt = p.t;
      if (point) {
        var dx = (p.x - point.x) * width, dy = (p.y - point.y) * height;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var speed = dist / Math.max(1, p.t - point.t);
        travel = speed > 0.055 ? travel + dist : 0;
        sinceInject = speed > 0.055 ? sinceInject + dist : 0;
        /* 指针不再「见动就喂」：累计走够 8px 才落一笔，波才散得开；慢速游走完全不落笔。 */
        if (speed > 0.07 && sinceInject > 8) {
          trail.push({ x: p.x, y: p.y, age: 0 });
          if (trail.length > MAX_TRAIL) trail.shift();
          inject(p.x, p.y, 1.6, Math.min(1.4, speed) * strength() * 0.35);
          sinceInject = 0;
          wake();
        }
        if (travel > 30 && p.t - emitted > 130) {
          drop(p.x, p.y, Math.min(1.0, 0.35 + speed * 0.3));
          travel = 0; emitted = p.t;
        }
      }
      point = p;
    }
    function down(e) {
      if (!playing || blocked() || e.isPrimary === false || e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button,input')) return;
      var p = position(e);
      inputAt = p.t;
      drop(p.x, p.y, 1.8);
    }

    function watchDpr() {
      if (!window.matchMedia) return;
      if (dprQuery && dprQuery.removeEventListener) dprQuery.removeEventListener('change', dprChanged);
      dprQuery = window.matchMedia('(resolution: ' + window.devicePixelRatio + 'dppx)');
      if (dprQuery.addEventListener) dprQuery.addEventListener('change', dprChanged);
    }
    function dprChanged() { watchDpr(); sync(); }

    var resize = window.ResizeObserver ? new ResizeObserver(sync) : null;
    if (resize) resize.observe(canvas);
    var visibility = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting; sync();
    }) : null;
    if (visibility) visibility.observe(canvas);
    var classes = window.MutationObserver ? new MutationObserver(sync) : null;
    if (classes) classes.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    if (reduce && reduce.addEventListener) reduce.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', sync);
    scene.addEventListener('pointermove', move, pointerOptions);
    scene.addEventListener('pointerdown', down, pointerOptions);
    scene.addEventListener('pointerleave', resetPointer, pointerOptions);
    scene.addEventListener('pointercancel', resetPointer, pointerOptions);
    if (audio) {
      audio.addEventListener('play', resume);
      audio.addEventListener('pause', pause);
      audio.addEventListener('ended', pause);
      audio.addEventListener('emptied', function () { detachAudio(); pause(); });
    }
    watchDpr();
    // 初始状态跟随当前 audio（可能是恢复的“在播”态，也可能未播）
    playing = !!(audio && !audio.paused && !audio.ended);
    sync();

    return {
      resume: resume,
      pause: pause,
      /* 测试用：读波数 / 手动喂一圈（与 __playerDebug 同类的探针） */
      stats: function () { return { waves: waves.length, trail: trail.length, field: fieldEnergy, playing: playing, raf: !!raf, w: width, h: height, cols: cols, rows: rows, strength: strength() }; },
      poke: function (x, y, strong) { drop(x, y, strong ? 1.8 : 0.8); return waves.length; },
      /* 测试用：音频链状态 / 直接喂一个低频（真机走同一条 readSignal） */
      audioState: function () { return { ready: audioReady, bass: bass, beats: beatCount, waves: waves.length }; },
      audioPoke: function (level) { lastBeat = 0; readSignal(performance.now(), level == null ? 0.08 : level); return waves.length; },
      destroy: function () {
        if (destroyed) return;
        destroyed = true; stop(); detachAudio(); waves.length = 0; trail.length = 0; clear();
        if (resize) resize.disconnect();
        if (visibility) visibility.disconnect();
        if (classes) classes.disconnect();
        if (reduce && reduce.removeEventListener) reduce.removeEventListener('change', sync);
        if (dprQuery && dprQuery.removeEventListener) dprQuery.removeEventListener('change', dprChanged);
        document.removeEventListener('visibilitychange', sync);
        window.removeEventListener('resize', sync);
        scene.removeEventListener('pointermove', move, pointerOptions);
        scene.removeEventListener('pointerdown', down, pointerOptions);
        scene.removeEventListener('pointerleave', resetPointer, pointerOptions);
        scene.removeEventListener('pointercancel', resetPointer, pointerOptions);
        if (audio) {
          audio.removeEventListener('play', resume);
          audio.removeEventListener('pause', pause);
          audio.removeEventListener('ended', pause);
          audio.removeEventListener('emptied', pause);
        }
      }
    };
  }

  function renderLyrics() {
    var has = state.lyricLines.length > 0;
    player.setAttribute('data-haslyrics', has ? '1' : '0');
    syncPanels(true);   // 可见层若变了，做一次交叉淡入淡出
    var html = '';
    if (!has) {
      /* 无词不再显示「暂无歌词」—— 改由频谱接管（motion 5） */
      html = '';
    } else {
      for (var i = 0; i < state.lyricLines.length; i++) {
        html += '<p class="lyric-line" data-i="' + i + '">' + esc(state.lyricLines[i].text) + '</p>';
      }
    }
    lyrics.innerHTML = html;
  }

  function renderChrome() {
    if (lyricAlign && (state.page !== 'play' || state.drawer || (searchPage && !searchPage.hidden))) closeLyricAlign();
    player.setAttribute('data-page', state.page);
    player.setAttribute('data-drawer', state.drawer ? '1' : '0');
    player.setAttribute('data-search', (searchPage && !searchPage.hidden) ? '1' : '0');
    drawerScrim.hidden = !(player.getAttribute('data-layout') === 'wide' && state.drawer);

    // 搜索入口按钮：已开时提示「收起搜索」
    var seBtn = $('searchEntryBtn');
    if (seBtn) {
      var sOpen = !!(searchPage && !searchPage.hidden);
      seBtn.setAttribute('aria-expanded', sOpen ? 'true' : 'false');
      var sLabel = sOpen ? '收起搜索' : '搜索歌曲';
      seBtn.title = sLabel;
      seBtn.setAttribute('aria-label', sLabel);
    }

    var qBtn = $('queueBtn');
    var lay = player.getAttribute('data-layout');
    var isLong = lay === 'long';
    qBtn.classList.toggle('is-static', isLong);
    qBtn.disabled = isLong;
    var qLabel = isLong ? '播放队列（常驻显示）'
      : (lay === 'compact'
        ? (state.page === 'queue' ? '回到播放' : '打开队列')
        : (state.drawer ? '收起队列' : '展开队列'));
    qBtn.title = qLabel;
    qBtn.setAttribute('aria-label', qLabel);
  }

  /* ============================================================
     歌词
     ============================================================ */
  var lyricIndex = -1;
  var lyricGen = 0;
  var lyricBaseOffset = 0;     // 词源自带的提前量（ms）；绝不回写到用户调整
  var lyricAlign = null;      // 草稿，只在「完成」时写 raw / playlist
  var lyricPress = null;
  var lyricAlignRaf = 0;
  var lyricHintTimer = 0, lyricHintCount = 0;
  var lyricSuppressClickUntil = 0;
  var LYRIC_OFFSET_LIMIT = 600000;

  function validLyricOffset(v) {
    var n = typeof v === 'number' ? v : 0;
    return isFinite(n) ? Math.max(-LYRIC_OFFSET_LIMIT, Math.min(LYRIC_OFFSET_LIMIT, Math.round(n))) : 0;
  }
  function savedLyricOffset(t) { return validLyricOffset(t && t.raw && t.raw.lyricOffset); }
  function lyricTimeAt(mediaTime) {
    var off = lyricAlign ? lyricAlign.draft : savedLyricOffset(currentTrack());
    return mediaTime + (lyricBaseOffset + off) / 1000;
  }
  function describeLyricOffset(ms) {
    return ms ? '歌词' + (ms > 0 ? '提前 ' : '延后 ') + (Math.abs(ms) / 1000).toFixed(2) + 's' : '原始节奏';
  }

  function sizeLyricPad() {
    var h = lyricWrap.clientHeight;
    if (!h) return;
    var pad = lyricAlign ? Math.round(h / 2) : Math.max(28, Math.round(h / 2 - 26));
    lyrics.style.paddingTop = pad + 'px';
    lyrics.style.paddingBottom = pad + 'px';
  }

  function centerCurrentLine(instant) {
    if (!state.follow || lyricAlign) return;
    var el = lyrics.querySelector('.lyric-line.is-current');
    if (!el) return;
    var target = el.offsetTop - lyrics.offsetTop - lyricWrap.clientHeight / 2 + el.offsetHeight / 2;
    lyrics.scrollTo({ top: Math.max(0, target), behavior: instant ? 'auto' : 'smooth' });
  }

  function updateLyricIndex(instant) {
    var idx = -1;
    var time = lyricTimeAt(liveProgress());
    for (var i = 0; i < state.lyricLines.length; i++) {
      if (state.lyricLines[i].t <= time + 0.01) idx = i; else break;
    }
    if (idx === lyricIndex) return;
    lyricIndex = idx;
    var nodes = lyrics.querySelectorAll('.lyric-line');
    for (var j = 0; j < nodes.length; j++) {
      var d = j - idx;
      nodes[j].classList.toggle('is-current', d === 0);
      nodes[j].classList.toggle('is-near', Math.abs(d) === 1);
    }
    if (state.follow) centerCurrentLine(instant);
  }

  /* 歌词跟随：滚完停 3s 自动回归（motion 2）。
   * 去掉「回到当前歌词」按钮 —— 不再需要手动回。
   * 定时器在交互进行中不触发；每次滚动/指针交互重置计时。 */
  var followTimer = 0;
  function clearFollowTimer() { if (followTimer) { clearTimeout(followTimer); followTimer = 0; } }
  function scheduleResume() {
    clearFollowTimer();
    if (state.follow || lyricAlign || lyricPress) return;
    followTimer = setTimeout(function () { followTimer = 0; resumeFollow(); }, 3000);
  }
  function pauseFollow() {
    if (lyricAlign) return;
    lyrics.classList.add('is-browsing');   // 3 行聚焦：滚动时全部行显形
    if (state.follow) state.follow = false;
    scheduleResume();
  }
  function resumeFollow() {
    clearFollowTimer();
    state.follow = true;
    lyrics.classList.remove('is-browsing');
    centerCurrentLine(false);
  }

  /* 校准时用连续的「时间 → 行中心」插值，普通阅读仍按句居中。
   * 播放时钟始终前进；鼠标只改变固定的提前量，停手/松手不会重新锚定音频时间。 */
  function measureAlignLines() {
    if (!lyricAlign) return;
    var nodes = lyrics.querySelectorAll('.lyric-line');
    lyricAlign.points = [];
    for (var i = 0; i < nodes.length; i++) {
      lyricAlign.points.push({ t: state.lyricLines[i].t, y: nodes[i].offsetTop - lyrics.offsetTop + nodes[i].offsetHeight / 2, node: nodes[i] });
    }
    lyricAlign.width = lyrics.clientWidth;
    lyricAlign.height = lyrics.clientHeight;
  }
  function alignPosition(time) {
    var pts = lyricAlign.points;
    if (!pts.length) return 0;
    if (time <= pts[0].t) return pts[0].y;
    for (var i = 1; i < pts.length; i++) {
      if (time < pts[i].t) {
        var prev = pts[i - 1], next = pts[i];
        return prev.y + (next.y - prev.y) * (time - prev.t) / (next.t - prev.t);
      }
    }
    return pts[pts.length - 1].y;
  }
  function alignDragScale() {
    var pts = lyricAlign.points, now = lyricTimeAt(liveProgress()), samples = [];
    for (var i = 1; i < pts.length; i++) {
      var dt = pts[i].t - pts[i - 1].t, dy = pts[i].y - pts[i - 1].y;
      if (Math.abs(pts[i].t - now) <= 20 && dt >= 0.15 && dt <= 12 && dy > 0) samples.push(dt * 1000 / dy);
    }
    samples.sort(function (a, b) { return a - b; });
    return Math.max(10, Math.min(250, samples.length ? samples[Math.floor(samples.length / 2)] : 80));
  }
  function paintLyricAlign() {
    if (!lyricAlign) return;
    if (lyricAlign.width !== lyrics.clientWidth || lyricAlign.height !== lyrics.clientHeight) measureAlignLines();
    updateLyricIndex(true);
    var position = alignPosition(lyricTimeAt(liveProgress()));
    lyrics.scrollTo({ top: Math.max(0, position - lyrics.clientHeight / 2), behavior: 'instant' });
    var nearest = null, distance = Infinity;
    lyricAlign.points.forEach(function (p) {
      var d = Math.abs(p.y - position);
      if (d < distance) { nearest = p; distance = d; }
    });
    if (nearest !== lyricAlign.candidate) {
      if (lyricAlign.candidate) lyricAlign.candidate.node.classList.remove('is-align-candidate');
      if (nearest) nearest.node.classList.add('is-align-candidate');
      lyricAlign.candidate = nearest;
    }
    var label = describeLyricOffset(lyricAlign.draft);
    if ($('lyricAlignValue').textContent !== label) $('lyricAlignValue').textContent = label;
  }
  function stopAlignFrames() {
    if (lyricAlignRaf) cancelAnimationFrame(lyricAlignRaf);
    lyricAlignRaf = 0;
  }
  function startAlignFrames() {
    if (!lyricAlign || lyricAlignRaf || document.hidden || audio.paused) return;
    function frame() {
      lyricAlignRaf = 0;
      if (!lyricAlign || document.hidden) return;
      paintLyricAlign();
      if (!audio.paused) lyricAlignRaf = requestAnimationFrame(frame);
    }
    lyricAlignRaf = requestAnimationFrame(frame);
  }
  function hideLyricHint() {
    clearTimeout(lyricHintTimer);
    $('lyricAlignHint').hidden = true;
  }
  function openLyricAlign() {
    if (lyricAlign) return true;
    var t = currentTrack();
    if (!t || lyricState !== 'ready' || !state.lyricLines.length || !lyricWrap.clientHeight || state.page !== 'play') return false;
    lyricAlign = { uid: t.uid, gen: lyricGen, original: savedLyricOffset(t), draft: savedLyricOffset(t), points: [], saving: false };
    clearFollowTimer(); hideLyricHint();
    state.follow = false;
    lyrics.classList.remove('is-browsing');
    lyricWrap.classList.add('is-aligning');
    $('lyricAlignTools').hidden = false;
    $('lyricAlignGuide').hidden = false;
    // 上下都留足半屏：首句/末句也能到现在线，不受普通阅读 padding 的限制。
    lyrics.style.paddingTop = lyrics.clientHeight / 2 + 'px';
    lyrics.style.paddingBottom = lyrics.clientHeight / 2 + 'px';
    measureAlignLines(); paintLyricAlign(); startAlignFrames();
    return true;
  }
  function clearLyricPress(rollback) {
    var p = lyricPress;
    if (!p) return;
    clearTimeout(p.timer);
    lyricPress = null;
    if (p.dragging) lyricSuppressClickUntil = Date.now() + 350;
    lyricWrap.classList.remove('is-align-dragging');
    if (rollback && p.dragging && lyricAlign) { lyricAlign.draft = p.original; paintLyricAlign(); }
    try { if (lyricWrap.hasPointerCapture(p.id)) lyricWrap.releasePointerCapture(p.id); } catch (e) {}
    if (!lyricAlign) scheduleResume();
  }
  function closeLyricAlign() {
    clearLyricPress(false); stopAlignFrames();
    lyricAlign = null;
    lyricWrap.classList.remove('is-aligning', 'is-align-dragging');
    $('lyricAlignTools').hidden = true;
    $('lyricAlignGuide').hidden = true;
    lyrics.querySelectorAll('.is-align-candidate').forEach(function (el) { el.classList.remove('is-align-candidate'); });
    sizeLyricPad();
    lyricIndex = -1;
    state.follow = true;
    clearFollowTimer();
    lyrics.classList.remove('is-browsing');
    updateLyricIndex(true);
  }
  function changeLyricOffset(amount) {
    if (!lyricAlign || lyricAlign.saving) return;
    lyricAlign.draft = validLyricOffset(amount === null ? 0 : lyricAlign.draft + amount);
    paintLyricAlign();
  }
  function commitLyricAlign() {
    var edit = lyricAlign, t = currentTrack();
    if (!edit || edit.saving || !t || t.uid !== edit.uid || lyricGen !== edit.gen) return;
    edit.saving = true;
    var originals = state.tracks.filter(function (x) { return x.id === t.id; }).map(function (x) {
      return { track: x, present: Object.prototype.hasOwnProperty.call(x.raw, 'lyricOffset'), value: x.raw.lyricOffset };
    });
    setTrackLyricOffset(t, edit.draft);
    $('lyricAlignDone').disabled = true;
    savePlaylist().then(function (res) {
      $('lyricAlignDone').disabled = false;
      if (!res || !res.ok) {
        originals.forEach(function (x) { if (x.present) x.track.raw.lyricOffset = x.value; else delete x.track.raw.lyricOffset; });
        edit.saving = false;
        toast('歌词调整暂未保存，请重试');
        return;
      }
      if (lyricAlign === edit) closeLyricAlign();
      persistNow();
      toast(edit.draft ? describeLyricOffset(edit.draft).replace('歌词', '歌词已') : '歌词已恢复原始节奏');
    });
  }
  function beginAlignDrag(p) {
    if (!openLyricAlign() || lyricAlign.saving) return;
    p.dragging = true;
    p.original = lyricAlign.draft;
    p.scale = alignDragScale();  // 一次拖动只量一次，播放经过间奏也不改尺子
    lyricWrap.classList.add('is-align-dragging');
    try { lyricWrap.setPointerCapture(p.id); } catch (e) {}
    var selection = window.getSelection();
    if (selection) selection.removeAllRanges();
  }
  lyricWrap.addEventListener('wheel', function (e) {
    if (lyricAlign) { e.preventDefault(); return; }
    pauseFollow();
    if (lyricState === 'ready' && lyricHintCount < 3) {
      lyricHintCount++;
      hideLyricHint(); $('lyricAlignHint').hidden = false;
      lyricHintTimer = setTimeout(hideLyricHint, 2500);
    }
  }, { passive: false });
  lyricWrap.addEventListener('touchstart', pauseFollow, { passive: true });
  lyricWrap.addEventListener('touchmove', function () { scheduleResume(); }, { passive: true });
  lyricWrap.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || e.pointerType !== 'mouse' || e.target.closest('.lyric-align-tools')) return;
    if (lyricState !== 'ready' || !state.lyricLines.length || (lyricAlign && lyricAlign.saving)) return;
    // 保留原生滚动条的拖拽，别把滚动条长按识别成歌词校准。
    if (e.clientX >= lyrics.getBoundingClientRect().right - 10) { pauseFollow(); return; }
    clearLyricPress(true);
    pauseFollow(); clearFollowTimer();
    var p = lyricPress = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false, timer: 0 };
    if (lyricAlign) { beginAlignDrag(p); e.preventDefault(); }
    else p.timer = setTimeout(function () { if (lyricPress === p) beginAlignDrag(p); }, 450);
  });
  lyricWrap.addEventListener('pointermove', function (e) {
    var p = lyricPress;
    if (!p || p.id !== e.pointerId) return;
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) clearTimeout(p.timer);
      return;
    }
    e.preventDefault();
    lyricAlign.draft = validLyricOffset(p.original - (e.clientY - p.y) * p.scale);
    paintLyricAlign();
  });
  // 松手只停止拖动，绝不拿松手时刻重算偏移；工具保留，能继续试听/微调。
  lyricWrap.addEventListener('pointerup', function () { clearLyricPress(false); });
  lyricWrap.addEventListener('pointercancel', function () { clearLyricPress(true); });
  lyricWrap.addEventListener('lostpointercapture', function () { clearLyricPress(true); });
  lyricWrap.addEventListener('pointerleave', function () { if (lyricPress && !lyricPress.dragging) clearLyricPress(false); });
  window.addEventListener('pointerup', function () { clearLyricPress(false); });
  window.addEventListener('blur', function () { clearLyricPress(true); });
  lyrics.addEventListener('scroll', function () { if (!state.follow) scheduleResume(); }, { passive: true });
  lyrics.addEventListener('click', function (e) {
    if (lyricAlign || Date.now() < lyricSuppressClickUntil) return;
    var line = e.target.closest('.lyric-line');
    if (line) seekLyricLine(Number(line.getAttribute('data-i')));
  });
  function seekLyricLine(i) {
    var line = state.lyricLines[i], t = currentTrack();
    if (!line || !t) return;
    var time = Math.max(0, line.t - (lyricBaseOffset + savedLyricOffset(t)) / 1000);
    if (isFinite(audio.duration) && audio.duration > 0) time = Math.min(time, audio.duration);
    try { audio.currentTime = time; } catch (e) { return; }
    state.progress = time;
    resumeFollow(); updateLyricIndex(true); renderProgress(); persistNow();
  }
  $('lyricAlignEarlier').addEventListener('click', function () { changeLyricOffset(50); });
  $('lyricAlignLater').addEventListener('click', function () { changeLyricOffset(-50); });
  $('lyricAlignReset').addEventListener('click', function () { changeLyricOffset(null); });
  $('lyricAlignDone').addEventListener('click', commitLyricAlign);
  audio.addEventListener('play', startAlignFrames);
  audio.addEventListener('pause', function () { stopAlignFrames(); paintLyricAlign(); });
  audio.addEventListener('seeked', paintLyricAlign);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearLyricPress(true); if (lyricAlign) closeLyricAlign(); }
  });

  /* 纯解析：候选歌词也会过 parseLrc，不能在这里改正在显示的词源偏移。 */
  function parseLrcDocument(text) {
    var re = /\[offset\s*:\s*([+-]?\d+)\s*\]/gi, match, offset = 0;
    while ((match = re.exec(String(text || '')))) offset = validLyricOffset(Number(match[1]));
    return { lines: parseLrc(text), advanceMs: offset };
  }

  /* LRC：[mm:ss.xx] 行级时间戳，一行可带多个 */
  /* 占位词识别：有些纯音乐曲目，歌词源会回一句「这似乎是一首纯音乐呢」「纯音乐，请欣赏」之类，
   * 当成正常歌词显示反而遮住背景。视作「无词」（交给涟漪/封面）。 */
  function lyricIsPlaceholder(lines) {
    if (!lines || !lines.length) return true;
    // 只看前 3 句，防误伤正经歌词
    var head = lines.slice(0, 3).map(function (l) { return String(l.text || ''); }).join(' ');
    if (!head.trim()) return true;
    return /纯音乐|請欣賞|请欣赏|尽情欣赏|無歌詞|无歌词|暂无歌词|instrumental/i.test(head);
  }

  function parseLrc(text) {
    if (!text) return [];
    var out = [];
    var lines = String(text).split(/\r?\n/);
    var re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      re.lastIndex = 0;
      var stamps = [];
      var m;
      while ((m = re.exec(line))) {
        var frac = m[3] ? parseInt(m[3].length >= 3 ? m[3] : m[3] + '0', 10) : 0;
        stamps.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac / 1000);
      }
      if (!stamps.length) continue;
      var body = line.replace(re, '').trim();
      for (var s = 0; s < stamps.length; s++) out.push({ t: stamps[s], text: body });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  /* TTML（AMLL 逐字库）：只取行级 —— 剥掉字级 <span>，留 <p begin> 文本 */
  function parseTtmlTime(v) {
    var m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(String(v || ''));
    if (!m) return 0;
    return (parseInt(m[1] || '0', 10) * 3600) + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
  }
  function parseTtml(text) {
    if (!text || !/<p[\s>]/i.test(text)) return [];
    var out = [];
    var re = /<p\b[^>]*\bbegin="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g;
    var m;
    while ((m = re.exec(text))) {
      var body = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (body) out.push({ t: parseTtmlTime(m[1]), text: body });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  function onlineIdOf(t) {
    /* 只认真正的 Meting 数字 id（server:123 / …/music/go/123），
     * search: 开头的伪 id 不是 id，交给 lrcUrl / 搜索路径。 */
    var m = /^[a-z]+:(\d+)$/.exec(String(t.id || ''));
    if (m) return m[1];
    var g = /\/music\/go\/([0-9]+)/.exec(t.url || '');
    return g ? g[1] : '';
  }
  function onlineServerOf(t) {
    /* 先看 url 上的 server（在线曲目都有），再退到 id 前缀。
     * 旧版 searchKey 曲目的 id 是 `search:…` 伪前缀，不能当 server 用。 */
    var s = /[?&]server=([^&#]+)/.exec(t.url || '');
    if (s) return decodeURIComponent(s[1]);
    var m = /^([a-z]+):/.exec(String(t.id || ''));
    if (m && m[1] !== 'search') return m[1];
    return 'netease';
  }

  /* 归一化标题：去空白、去括号后缀（(Live)/(伴奏) 等）、小写。 */
  function normLyricTitle(s) {
    return String(s || '').toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[（(【\[].*?[）)】\]]/g, '');
  }
  function normLyricAuthor(s) {
    return String(s || '').toLowerCase().replace(/[\s\u3000\/、,，&]+/g, '');
  }

  /* ============================================================
     歌词关键词清洗（cleanLyricQuery）
     ------------------------------------------------------------
     为什么需要它：B站（以及部分搬运源）的曲目标题是**一整条广告**，
     「【4K珍藏】南拳妈妈《下雨天》MV极致修复！（收录于2008年专辑《…》）」；
     而 author 字段是 **UP 主**不是歌手。原来跨源兜底直接拿
       [title, author].join(' ')
     去搜，等于拿一句广告去搜歌 —— 匹配算法再准也没用（搜索这一步就废）。
     实测（2026-10-11，真实 B站搜索结果 20 条）：
       · 脏串搜不到；换成「下雨天 南拳妈妈」第一条即命中。

     解析优先级（罐头拍板）：
       ① 有《》→ 取第一个「不在括号内」的《》内容当歌名（最强锚点）；
       ② 无《》→ 去成对括号 → 剥噪声词（画质/音质/字幕/营销/场景/结构词）
                 → 在分隔符处截断取前段；
       ③ 顺手抽歌手：紧邻书名号或分隔符、≤8 个 CJK 字（或 ≤3 个拉丁词）、
          不含数字与残留符号 —— **取不到就留空，宁可空也不塞错的**。
     守卫：合集/串烧/纯音乐/伴奏这类标题判为 ok=false，不做自动兜底
     （那类视频本来就不该配到原唱的词），只留给「手动匹配」出手。

     这是纯函数：同一份会被用在**两端** —— 匹配端 pickLyricHit + 关键词构造端
     crossLyric。两端必须走同一份，否则一处改了另一处会漂。
     ============================================================ */
  var LQ_SEP = /[|｜丨\/／\u2013\u2014\u2015\-–—~～·・♪♫☆★✦✧，,。.；;：:！!？?「」『』‘’“”]+/;
  var LQ_EDGE = /^[\s\-–—_|｜丨\/／·・☆★✦✧♫♪，,。.；;：:！!？?]+|[\s\-–—_|｜丨\/／·・☆★✦✧♫♪，,。.；;：:！!？?]+$/g;
  var LQ_NOISE_EN = ['4k', '8k', '2k', '1080p', '2160p', '1440p', '720p', '480p', 'hd', 'hdr', 'uhd',
    'hi-res', 'hires', 'hi-fi', 'hifi', 'lossless', 'flac', 'ape', 'mv', 'pv', 'playlist', 'bgm', 'official'];
  var LQ_NOISE_MIX = ['hr音质', '无损音质', '高品质', '官方mv', '官方版'];
  var LQ_NOISE_CN = [
    '百万豪装录音棚', '录音棚', '大声听', '自测全网最清', '全网最清',
    '超清', '高清', '蓝光', '无损', '母带', '黑胶',
    '动态歌词', '歌词版', '字幕版', '中日字幕', '双语字幕', '中文字幕', '字幕',
    '修复版', '修复', '重制版', '重制', '完整版', '纯享版', '纯享', '收藏级', '珍藏版', '珍藏',
    '原版', '正式版', '简体', '繁体', '超清版',
    '指法技巧精讲', '技巧精讲', '精讲', '教程', '指法',
    '神作', '超治愈', '超感人', '超好听', '极致', '究极', '天花板', '私藏馆', '私藏', '宝藏', '必听',
    '助眠', '解压', '治愈', '放松', '背景音乐',
    '歌单', '合集', '精选', '串烧', '盘点', '终于弹了这首',
    '纯音乐', '伴奏', '钢琴曲', '轻音乐', '钢琴版'
  ];
  /* 合集 / 器乐类：命中即不做自动兜底（交给手动匹配）。
   * 注意「歌单」不算 —— 搬运标题里「循环歌单」很常见，容易被误伤。 */
  var LQ_COLLECTIONY = /合集|合辑|串烧|盘点|playlist|\d{2,}\s*首|首连播|连播|精选集/i;
  var LQ_INSTRUMENTAL = /纯音乐|伴奏|instrumental|钢琴曲|轻音乐|钢琴版|卡拉\s*ok/i;

  function lqUniqSpaces(s) { return String(s || '').replace(/[\s\u3000]+/g, ' ').trim(); }
  function lqEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function lqStripBrackets(s) {
    return String(s || '').replace(/[（(【\[｛{「『《][^）)】\]｝}」』》]*[）)】\]｝}」』》]/g, ' ');
  }
  function lqStripNoise(s) {
    var t = ' ' + String(s || '') + ' ';
    var i;
    for (i = 0; i < LQ_NOISE_EN.length; i++) t = t.replace(new RegExp('\\b' + lqEsc(LQ_NOISE_EN[i]) + '\\b', 'gi'), ' ');
    for (i = 0; i < LQ_NOISE_MIX.length; i++) t = t.replace(new RegExp(lqEsc(LQ_NOISE_MIX[i]), 'gi'), ' ');
    for (i = 0; i < LQ_NOISE_CN.length; i++) t = t.split(LQ_NOISE_CN[i]).join(' ');
    t = t.replace(/\b\d{3,4}[pP]?\b/g, ' ');
    t = t.replace(LQ_EDGE, ' ');
    t = t.replace(/^\s*[\u4e00-\u9fa5]\s+/, '');      // 前导单字（「在 买辣椒也用券」的「在」）
    return lqUniqSpaces(t);
  }
  /* 第一个「不在括号内」的《》内容 —— 括在【】/（）里的书名号是专辑名，不算。 */
  function lqFirstBookTitle(s) {
    var str = String(s || ''), re = /《([^》]+)》/g, m;
    while ((m = re.exec(str))) {
      var before = str.slice(0, m.index);
      var open = (before.match(/[（(【\[｛{「『]/g) || []).length;
      var close = (before.match(/[）)】\]｝}」』]/g) || []).length;
      if (open === close) return lqUniqSpaces(m[1]);
    }
    return '';
  }
  function lqHasCJK(s) { return /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(s); }
  function lqHasAlpha(s) { return /[a-zA-Z]/.test(s); }
  var LQ_BAD_NAME = /[《》【】（）()「」『』|｜丨\/／：:，,。.；;！!？?~～·・♪♫☆★]/;
  /* 歌手候选是否像个人名：≤8 个 CJK 字 / ≤3 个拉丁词，不含数字与残留符号。 */
  function lqIsNameLike(s) {
    var t = lqUniqSpaces(s);
    if (!t || /\d/.test(t)) return false;
    if (LQ_BAD_NAME.test(t)) return false;
    if (!lqHasCJK(t) && !lqHasAlpha(t)) return false;
    if (lqHasCJK(t)) return t.replace(/\s/g, '').length <= 8;
    return t.split(/\s+/).length <= 3 && t.length <= 24;
  }
  function lqTidySong(s) {
    var t = lqUniqSpaces(s);
    if (!t) return '';
    t = lqUniqSpaces(String(t).replace(LQ_EDGE, ' '));
    if (lqHasCJK(t)) {
      var seg = (t.split(LQ_SEP)[0] || '').trim();
      t = seg || (t.split(/\s+/)[0] || t);
    }
    return lqUniqSpaces(String(t).replace(LQ_EDGE, ' '));
  }
  /* 洗出来的歌名像不像真的（不含残留分隔符、长度合理）。 */
  function lqSongPlausible(s) {
    var t = lqUniqSpaces(s);
    if (!t) return false;
    if (LQ_SEP.test(t)) return false;
    if (lqHasCJK(t)) return t.replace(/\s/g, '').length <= 20;
    return t.length <= 60 && t.split(/\s+/).length <= 12;
  }
  function cleanLyricQuery(title, author) {
    var raw = lqUniqSpaces(title);
    var song = '', artist = '';
    var bt = lqFirstBookTitle(raw);
    if (bt) {
      song = lqTidySong(bt);
      var idx = raw.indexOf('《' + bt);
      var head = idx > 0 ? raw.slice(0, idx) : '';
      var tailAll = raw.slice(idx + ('《' + bt + '》').length);
      var hc = lqStripNoise(lqStripBrackets(head));
      if (lqIsNameLike(hc)) artist = hc;
      if (!artist) {
        var parts = tailAll.split(LQ_SEP).map(function (x) { return lqStripNoise(lqStripBrackets(x)); }).filter(Boolean);
        for (var i = 0; i < parts.length; i++) { if (lqIsNameLike(parts[i])) { artist = parts[i]; break; } }
      }
    } else {
      var noBr = lqStripBrackets(raw);
      var segs = noBr.split(LQ_SEP).map(function (x) { return lqStripNoise(x); }).filter(Boolean);
      if (segs.length >= 2 && lqIsNameLike(segs[0])) {
        artist = segs[0];
        song = lqTidySong(segs.slice(1).join(' '));
      } else {
        song = lqTidySong(segs.join(' ') || noBr);
      }
    }
    song = lqUniqSpaces(song);
    artist = lqIsNameLike(artist) ? lqUniqSpaces(artist) : '';
    if (artist && song && artist === song) artist = '';
    var collectiony = LQ_COLLECTIONY.test(raw) || LQ_INSTRUMENTAL.test(raw);
    var ok = lqSongPlausible(song) && !collectiony;
    return { song: song, artist: artist, keyword: [song, artist].filter(Boolean).join(' '), ok: ok };
  }

  /* 曲目 → 歌词搜索用的一组字段。返回 null = 这首不做自动兜底（合集/纯音乐）。
   * 脏标题（B站那类）→ 用解析出的歌名+歌手，**丢掉 UP 主**；
   * 干净标题 → 歌名原样 + 原始歌手（这时 author 是真歌手，别丢）。 */
  function lyricQueryOf(title, author) {
    var c = cleanLyricQuery(title, author);
    if (!c.ok) return null;
    var raw = lqUniqSpaces(title);
    var dirty = c.song !== raw;
    var song = c.song || raw;
    var artist = dirty ? c.artist : (c.artist || String(author || '').trim());
    return { song: song, artist: artist, keyword: [song, artist].filter(Boolean).join(' '), dirty: dirty };
  }

  /* 从搜索结果里挑一个「标题对得上」的（作者对得上加权），防同名不同版本乱匹配。
   * 只有当标题完全相等，或标题部分包含 + 作者也对得上时才接受；
   * 没有歌手的曲目（纯音乐等）只认标题完全相等。宁可没词，不可错配。
   * 查询词与候选标题都先过 cleanLyricQuery（两端同一份规则）。 */
  function pickLyricHit(list, title, author) {
    var q = lyricQueryOf(title, author);
    if (!q) return null;
    var want = normLyricTitle(q.song);
    if (!want) return null;
    var wantA = normLyricAuthor(q.artist);
    var best = null, bestScore = 0;
    for (var i = 0; i < (list || []).length; i++) {
      var it = list[i];
      if (!it || !it.url) continue;
      var nm = normLyricTitle(cleanLyricQuery(it.title, it.author).song || it.title);
      if (!nm) continue;
      var exact = nm === want;
      var ts = exact ? 3 : (nm.indexOf(want) >= 0 || want.indexOf(nm) >= 0 ? 2 : 0);
      if (!ts) continue;
      var na = normLyricAuthor(it.author);
      var as = (wantA && na && (na === wantA || na.indexOf(wantA) >= 0 || wantA.indexOf(na) >= 0)) ? 2 : 0;
      // 接受条件：标题完全相等，或（标题部分包含且作者对得上）。
      // 没有歌手时不做部分匹配 —— 防纯音乐被配成同名歌曲的人工版。
      if (!exact && !as) continue;
      var score = ts + as;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  /* 降级链：离线库 → 绑定的关键词 → music/lrc → lrc-proxy → ttml(404 退空) → **跨源兜底**。
   * 每次带代次，迟到响应不许覆盖新歌。 */
  function loadLyrics(t) {
    if (lyricAlign) closeLyricAlign();
    clearLyricPress(false); hideLyricHint();
    var gen = ++lyricGen;
    lyricBaseOffset = 0;
    state.lyricLines = [];
    lyricIndex = -1;
    lyricState = 'loading';     // 三态之一：只有最终确实无词才亮入口（防每次换曲闪一下）
    renderLyrics();
    renderAsk();
    sizeLyricPad();
    if (!t || !t.title) { lyricState = 'none'; renderAsk(); return; }

    function done(lines, cacheText, baseOffset) {
      if (gen !== lyricGen) return;
      // 占位词（「这似乎是一首纯音乐呢」等）当空处理：不占歌词层，回到封面 + 涟漪。
      // 不落盘这句，免得下次读离线库又当它有词。
      if (lyricIsPlaceholder(lines)) { lines = []; cacheText = null; }
      state.lyricLines = lines;
      lyricBaseOffset = validLyricOffset(baseOffset);
      lyricIndex = -1;
      renderLyrics();
      sizeLyricPad();
      updateLyricIndex(true);
      if (cacheText) apiPostJson(ENDPOINT.lrcSave, { name: t.title, lrc: cacheText }).catch(function () {});
    }
    function doneLrc(text, cacheText) {
      var doc = parseLrcDocument(text);
      return done(doc.lines, cacheText, doc.advanceMs);
    }
    function ttmlTry() {
      if (gen !== lyricGen) return Promise.resolve();
      var id = onlineIdOf(t);
      if (!id) return Promise.resolve();
      var platform = onlineServerOf(t) === 'tencent' ? 'qq' : 'ncm';
      return apiText(ENDPOINT.ttml + '?id=' + encodeURIComponent(id) + '&platform=' + platform).then(function (r) {
        if (gen !== lyricGen) return;
        if (r.ok && /<tt[\s>]/i.test(r.text)) {
          var lines = parseTtml(r.text);
          if (lines.length) return done(lines, null);
        }
      }).catch(function () {});
    }
    function online() {
      if (gen !== lyricGen) return Promise.resolve();
      var id = onlineIdOf(t);
      // 1) 有 meting id → music/lrc（后端直接问 meting，不受 host 白名单限制）
      if (id) {
        return apiText(ENDPOINT.musicLrc + '?id=' + encodeURIComponent(id) + '&server=' + encodeURIComponent(onlineServerOf(t))).then(function (r) {
          if (gen !== lyricGen) return;
          if (r.ok && r.text && !/^lyric fetch failed/.test(r.text)) return doneLrc(r.text, r.text);
          return proxy();
        }).catch(function () { return proxy(); });
      }
      return proxy();

      // 2) 拿到的是 lrc 文件地址而非 id → lrc-proxy
      function proxy() {
        if (gen !== lyricGen) return Promise.resolve();
        if (!(t.lrcUrl && /^https?:/i.test(t.lrcUrl))) return ttmlTry();
        return apiText(ENDPOINT.lrcProxy + '?url=' + encodeURIComponent(t.lrcUrl)).then(function (r) {
          if (gen !== lyricGen) return;
          if (r.ok && r.text && !/^lyric fetch failed/.test(r.text)) return doneLrc(r.text, r.text);
          return ttmlTry();
        }).catch(function () { return ttmlTry(); });
      }
    }

    // 跨源兜底：本平台/本 id 拿不到词时，拿「清洗后的歌名+歌手」去别的平台搜一次，
    // 命中标题匹配的首条再取词。只兜 online 曲目；本地文件不动（避免纯音乐乱配）。
    //
    // 关键词构造（关键一步）：**不能**再拿 t.title 原文拼 —— B站标题是一整条广告，
    // 拿它去搜必然空手。改为过 lyricQueryOf（= cleanLyricQuery + 脏标题时丢掉 UP 主）。
    // 若用户手动绑过（raw.lyricMatch），优先用它。
    function crossLyric() {
      if (gen !== lyricGen) return Promise.resolve();
      if (state.lyricLines.length) return Promise.resolve();    // 已有词，不兜
      if (t.mode !== '在线') return Promise.resolve();
      var bound = lyricMatchOf(t);
      var q = bound ? { song: bound.song, artist: bound.artist, keyword: [bound.song, bound.artist].filter(Boolean).join(' ') } : lyricQueryOf(t.title, t.author);
      if (!q || !q.keyword) return Promise.resolve();          // 合集/纯音乐 → 不自动兜底

      var cur = onlineServerOf(t);
      var servers = ['netease', 'tencent', 'kugou'].filter(function (s) { return s !== cur; });
      if (bound) servers.unshift(cur);                          // 手动绑过：先试本平台

      function next(i) {
        if (gen !== lyricGen || i >= servers.length) return Promise.resolve();
        var sv = servers[i];
        return apiGetJson(ENDPOINT.search + '?keyword=' + encodeURIComponent(q.keyword) + '&server=' + encodeURIComponent(sv)).then(function (res) {
          if (gen !== lyricGen) return;
          var list = (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) ? res.body.results : [];
          // 手动绑定时只认用户输入的关键词，不再对标题做二次筛选
          var hit = bound ? pickByQuery(list, q.keyword) : pickLyricHit(list, t.title, t.author);
          var hid = hit ? onlineIdOf(hit) : '';
          if (!hid) return next(i + 1);
          return apiText(ENDPOINT.musicLrc + '?id=' + encodeURIComponent(hid) + '&server=' + encodeURIComponent(sv)).then(function (r) {
            if (gen !== lyricGen) return;
            if (r.ok && r.text && !/^lyric fetch failed/.test(r.text)) {
              var lines = parseLrc(r.text);
              if (lines.length) return doneLrc(r.text, r.text);   // 标题对上了才落盘
            }
            return next(i + 1);
          }).catch(function () { return next(i + 1); });
        }).catch(function () { return next(i + 1); });
      }
      return next(0);
    }

    // 手动绑定优先于离线库：绑定过就先用它重取一次（离线库可能没存住 / 被清）。
    function runBoundFirst() {
      var bound = lyricMatchOf(t);
      if (!bound || !bound.keyword) return Promise.resolve(false);
      var gen0 = gen;
      return apiGetJson(ENDPOINT.search + '?keyword=' + encodeURIComponent(bound.keyword) + '&server=netease').then(function (res) {
        if (gen0 !== lyricGen) return true;
        var list = (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) ? res.body.results : [];
        var hit = pickByQuery(list, bound.keyword);
        var hid = hit ? onlineIdOf(hit) : '';
        if (!hid) return false;
        return apiText(ENDPOINT.musicLrc + '?id=' + encodeURIComponent(hid) + '&server=netease').then(function (r) {
          if (gen0 !== lyricGen) return true;
          if (r.ok && r.text && !/^lyric fetch failed/.test(r.text)) {
            var lines = parseLrc(r.text);
            if (lines.length) { doneLrc(r.text, r.text); return true; }
          }
          return false;
        }).catch(function () { return false; });
      }).catch(function () { return false; });
    }

    apiGetJson(ENDPOINT.lrcLoad + '?name=' + encodeURIComponent(t.title)).then(function (res) {
      if (gen !== lyricGen) return;
      if (res.ok && res.body && res.body.ok && res.body.lrc) return doneLrc(res.body.lrc, null);
      // 离线库没有：先试用户绑定的关键词，再走常规链
      return runBoundFirst().then(function (bound) { if (bound || gen !== lyricGen) return; return online(); });
    }).catch(function () { return online(); })
    .then(function () { return crossLyric(); })
    .then(function () {
      if (gen !== lyricGen) return;
      lyricState = state.lyricLines.length ? 'ready' : 'none';
      renderAsk();
    });
  }

  /* ---------- 无词入口 + 手动匹配（罐头拍板：单入口、有词不打扰） ---------- */
  var lyricState = 'idle';   // idle | loading | ready | none
  function renderAsk() {
    var el = $('lyricAsk');
    if (!el) return;
    /* 只在当前曲目「确实无词」且看着播放页时亮。加载中不亮 —— 否则每次换曲都会闪。
     * 纯音乐（占位词被当无词）也亮：那类恰恰最需要手动救（罐头认可）。 */
    el.hidden = !(lyricState === 'none' && state.page === 'play' && currentTrack());
  }

  function lmNote(msg, isErr) {
    var el = $('lmNote');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-err', !!isErr);
  }
  function openLyricMatch() {
    var pop = $('lyricMatchPop');
    if (!pop) return;
    var t = currentTrack();
    if (!t) return;
    var c = cleanLyricQuery(t.title, t.author);
    var bound = lyricMatchOf(t);
    // 预填：优先已绑定的，否则精简结果（精简结果可能是空 —— 那就让用户自己输）
    if ($('lmSong')) $('lmSong').value = (bound && bound.song) || c.song || '';
    if ($('lmArtist')) $('lmArtist').value = (bound && bound.artist) || c.artist || '';
    var sub = $('lmOrigin');
    if (sub) {
      sub.textContent = '原标题：' + String(t.title || '').slice(0, 60) +
        (c.ok ? '（已自动精简，可手改）' : '（标题像合集/纯音乐，请手动填）');
    }
    lmNote('');
    pop.hidden = false;
    var go = $('lmGoBtn');
    if (go && !go._bound) {
      go._bound = true;
      go.addEventListener('click', submitLyricMatch);
    }
    var nameField = $('lmSong');
    if (nameField) setTimeout(function () { try { nameField.focus(); nameField.select(); } catch (e) {} }, 30);
  }
  function closeLyricMatch() {
    var pop = $('lyricMatchPop');
    if (pop) pop.hidden = true;
  }

  /* 用用户输入的「歌名+歌手」搜一次、取词、绑定，并落盘。
   * 绑定写进 raw.lyricMatch（随 playlist.json 走），下次换曲先认它。 */
  function submitLyricMatch() {
    var t = currentTrack();
    if (!t) return;
    var song = lqUniqSpaces($('lmSong') ? $('lmSong').value : '');
    var artist = lqUniqSpaces($('lmArtist') ? $('lmArtist').value : '');
    var keyword = [song, artist].filter(Boolean).join(' ').trim();
    if (!keyword) { lmNote('先填一个歌名', true); return; }
    var go = $('lmGoBtn');
    if (go) go.disabled = true;
    lmNote('正在搜索…');
    var gen = lyricGen;                      // 跟当前歌词代次走（用户中途切歌就放弃）
    var servers = [];
    [onlineServerOf(t) || 'netease', 'netease', 'tencent', 'kugou'].forEach(function (s) {
      if (servers.indexOf(s) < 0) servers.push(s);
    });
    var i = 0;
    function step() {
      if (i >= servers.length) {
        if (go) go.disabled = false;
        lmNote('没找到这首歌的歌词，换个关键词试试', true);
        return;
      }
      var sv = servers[i++];
      apiGetJson(ENDPOINT.search + '?keyword=' + encodeURIComponent(keyword) + '&server=' + encodeURIComponent(sv)).then(function (res) {
        var list = (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) ? res.body.results : [];
        var hit = pickByQuery(list, keyword);
        var hid = hit ? onlineIdOf(hit) : '';
        if (!hid) return step();
        apiText(ENDPOINT.musicLrc + '?id=' + encodeURIComponent(hid) + '&server=' + encodeURIComponent(sv)).then(function (r) {
          if (r.ok && r.text && !/^lyric fetch failed/.test(r.text)) {
            var lines = parseLrc(r.text);
            if (lines.length && !lyricIsPlaceholder(lines)) {
              bindLyricMatch(t, song, artist, keyword);
              if (go) go.disabled = false;
              closeLyricMatch();
              toast('歌词已绑定：' + (hit.title || keyword));
              return;
            }
          }
          step();
        }).catch(function () { step(); });
      }).catch(function () { step(); });
    }
    step();
  }

  function bindLyricMatch(t, song, artist, keyword) {
    if (!t.raw || typeof t.raw !== 'object') t.raw = {};
    t.raw.lyricMatch = { song: song || '', artist: artist || '', keyword: keyword || '', at: Date.now() };
    // 换词源后旧校准不再成立；同音频的所有歌单副本一起更新。
    state.tracks.forEach(function (x) { if (x.id === t.id) x.raw.lyricMatch = t.raw.lyricMatch; });
    setTrackLyricOffset(t, null);
    savePlaylist();
    // 重跑一次歌词链（loadLyrics 会先认绑定），立即显示上线
    if (t.uid === state.currentUid) loadLyrics(t);
  }

  /* 「重新精简」：把两个输入框重置回自动精简的结果。 */
  function resetLyricMatch() {
    var t = currentTrack();
    if (!t) return;
    var c = cleanLyricQuery(t.title, t.author);
    if ($('lmSong')) $('lmSong').value = c.song || '';
    if ($('lmArtist')) $('lmArtist').value = c.artist || '';
    lmNote(c.ok ? '' : '这首的标题像合集/纯音乐，自动精简不可靠，建议自己填', false);
  }

  /* 手动匹配绑定：存在曲目 raw.lyricMatch = { song, artist, keyword, at }。
   * 随 playlist.json 落盘（toStoredTrack 会把 raw 原样带回），拆窗贴回也在。 */
  function lyricMatchOf(t) {
    var m = t && t.raw && t.raw.lyricMatch;
    if (!m || typeof m !== 'object') return null;
    var song = lqUniqSpaces(m.song), artist = lqUniqSpaces(m.artist);
    var keyword = lqUniqSpaces(m.keyword) || [song, artist].filter(Boolean).join(' ');
    if (!keyword) return null;
    return { song: song, artist: artist, keyword: keyword };
  }

  /* 手动绑定用：按用户关键词取「看起来最匹配」的一条。
   * 用户既然手动输了词，就不再拿原曲名去筛 —— 只要求关键词的每个词都出现在
   * 候选的「标题+歌手」里，避免拿到第一条不相关的。 */
  function pickByQuery(list, keyword) {
    var words = String(keyword || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return (list || [])[0] || null;
    var firstWithUrl = null;
    for (var i = 0; i < (list || []).length; i++) {
      var it = list[i];
      if (!it || !it.url) continue;
      if (!firstWithUrl) firstWithUrl = it;
      var hay = (String(it.title || '') + ' ' + String(it.author || '')).toLowerCase();
      var all = true;
      for (var w = 0; w < words.length; w++) { if (hay.indexOf(words[w]) < 0) { all = false; break; } }
      if (all) return it;
    }
    return firstWithUrl;
  }

  /* ============================================================
     音频引擎
     ============================================================ */
  var pendingSeek = 0;
  var pendingAutoplay = false;
  var durSaveTimer = 0;

  function scheduleDurSave() {
    clearTimeout(durSaveTimer);
    durSaveTimer = setTimeout(function () { savePlaylist(); }, 1500);
  }

  function loadAudio(t, seekTo, autoplay) {
    if (!t || !t.url) {
      audio.removeAttribute('src');
      try { audio.load(); } catch (e) {}
      pendingAutoplay = false;
      return;
    }
    var srcUrl = withSession(t.url);
    var same = audio.getAttribute('src') === srcUrl;
    if (!same) {
      audio.src = srcUrl;
      try { audio.load(); } catch (e) {}
    }
    pendingSeek = seekTo > 0 ? seekTo : 0;
    pendingAutoplay = !!autoplay;
    scheduleSeekRetry();
    if (same && pendingAutoplay && audio.paused) {
      // 同一首（恢复场景）：直接播
      audio.play().catch(onAutoplayBlocked);
      pendingAutoplay = false;
    }
  }

  /* 卸载期：拖进/拖出 = 整份文档被换掉，audio 销毁可能补发一次 pause。
   * 那一下不能当成「用户暂停」写回 playing=false，否则新文档读到 false 就永不续播。
   * 但 pause 有时跑在 pagehide 前面（那时 unloading 还没置位）—— 所以另记
   * lastPlayingAt，快照时若「刚还在播」就仍算在播，不让一次被迫暂停把续播灭掉。 */
  var unloading = false;
  var lastPlayingAt = 0;

  function flushOnTeardown() {
    unloading = true;   // 之后 audio 销毁补发的 pause 不写回
    // 每次 pagehide / 隐藏都立即把完整快照交给宿主（sendBeacon / keepalive，跨文档可靠）。
    // 不做「只落一次」的锁：重复落同一份快照无害，漏落才会丢状态。
    try { beaconPlayback(); } catch (e) {}
  }
  window.addEventListener('pagehide', flushOnTeardown);
  /* 有些宿主拆 iframe 时不派 pagehide/visibilitychange（直接移除节点），
   * unload 也不保证 —— 所以真正靠得住的是上面的**周期落盘**；
   * 这几条只是「能赶上就赶上」的额外保险。 */
  window.addEventListener('unload', flushOnTeardown);
  window.addEventListener('beforeunload', flushOnTeardown);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushOnTeardown();
    else unloading = false;   // 只是被隐藏后又回来（并未真卸载）
  });
  window.addEventListener('pageshow', function () { unloading = false; });

  /* play() 失败有两种完全不同的原因，别混为一谈：
   *   · NotAllowedError —— 浏览器自动播放策略拦截（没有用户手势）。这才是
   *     「继续播放」引导该管的事。
   *   · 其它（NotSupportedError 等）—— 媒体本身加载失败（源 404 / 解码不了），
   *     跟自动播放无关；真实原因由 audio 的 'error' 事件给出，这里不再冒充。
   * 之前不分青红皂白一律报「自动播放被拦」：改名后旧前缀 404 全被说成「被拦」，
   * 把排查方向带偏了。 */
  function onAutoplayBlocked(e) {
    if (e && e.name === 'AbortError') return;
    state.playing = false;
    if (e && e.name === 'NotAllowedError') {
      // 不归零：保留进度与暂停态，给一个轻量的「继续播放」引导（而不是 toast 完就停死）
      state.needsResume = true;
      renderPlayState();
      renderResume();
      toast('自动播放被拦，点「继续播放」');
      return;
    }
    // 加载/解码类失败：只收播放态，真相交给 audio 'error' 处理（不弹假的「被拦」）
    state.needsResume = false;
    renderPlayState();
    renderResume();
  }

  /* 恢复进度：loadedmetadata 时媒体往往还不可 seek（seekable=[0,0]），此时赋
   * currentTime 会被忽略或夹到已缓冲范围。把 seek 挂到多个就绪事件上，并配一个短重试
   * 定时器，可 seek 了再落。落成功后清 pendingSeek。这是续播能接上位置的关键。 */
  var seekRetryTimer = 0;
  /* 续播起播：落点没到位前先不出声。否则会先从头/错误位置放出来几百毫秒，
   * 再跳到正确位置 —— 听感就是「退回上一句重放」。落点到位（或放弃）后再 play。 */
  function maybeResumeAutoplay() {
    if (!pendingAutoplay || pendingSeek > 0) return;
    if (audio.paused) {
      pendingAutoplay = false;
      audio.play().catch(onAutoplayBlocked);
    } else {
      pendingAutoplay = false;
    }
  }
  function scheduleSeekRetry() {
    if (seekRetryTimer || !(pendingSeek > 0)) return;
    var tries = 0;
    /* 续播落点可能要等媒体缓冲/可 seek 才能落（分片代理尤甚），窗口给宽一点（约 9s）；
     * 等起播时不能抱太久（最多 ~3s）—— 宁可接受一次轻微错位，也别让新文档长时间不发声。
     * 放弃时清 pendingSeek，否则 timeupdate 会永远被挡住、进度条冻死。 */
    var cap = pendingAutoplay ? 20 : 60;
    seekRetryTimer = setInterval(function () {
      tries++;
      applyPendingSeek();
      if (pendingSeek <= 0 || tries > cap) {
        clearInterval(seekRetryTimer); seekRetryTimer = 0;
        if (pendingSeek > 0) { pendingSeek = 0; renderProgress(); }
        maybeResumeAutoplay();
      }
    }, 150);
  }
  function applyPendingSeek() {
    if (!(pendingSeek > 0) || audio.seeking) return;
    var sk = audio.seekable;
    if (!sk || !sk.length || sk.end(0) <= 0) return;   // 还不可 seek，等下一个事件/重试
    var dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    var target = dur ? Math.min(pendingSeek, Math.max(0, dur - 0.25)) : pendingSeek;
    // 目标超出当前可 seek 范围就先不落，等缓冲跟上来
    if (sk.end(0) < target) return;
    try { audio.currentTime = target; } catch (e) { return; }
    pendingSeek = 0;
    renderProgress();
    maybeResumeAutoplay();
  }

  audio.addEventListener('loadedmetadata', function () {
    var t = currentTrack();
    var real = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    if (t && real > 0 && !(Number(t.dur) > 0)) { t.dur = real; scheduleDurSave(); }
    applyPendingSeek();
    renderTrack();
    renderQueue();
    renderProgress();
    maybeResumeAutoplay();   // 落点已到位/无落点才起播；否则等重试把 seek 落下去
  });
  audio.addEventListener('loadeddata', applyPendingSeek);
  audio.addEventListener('canplay', applyPendingSeek);
  audio.addEventListener('progress', applyPendingSeek);
  audio.addEventListener('seeked', function () {
    if (!isFinite(audio.currentTime)) return;
    state.progress = audio.currentTime;
    renderProgress();
    updateLyricIndex(true);
    syncPositionState(true);
  });

  audio.addEventListener('timeupdate', function () {
    if (!isFinite(audio.currentTime)) return;
    if (!audio.paused) lastPlayingAt = Date.now();
    /* 续播落点还没到位时，不要拿刚起播的 0 把 state.progress 冲掉 ——
     * 那会让刚落盘的位置立刻变 0（下一次拖走就从头播）。落点到位或放弃后自动恢复。 */
    if (pendingSeek > 0) { updateLyricIndex(false); syncPositionState(); return; }
    state.progress = audio.currentTime;
    renderProgress();
    updateLyricIndex(false);
    syncPositionState();
    persistState();
  });

  audio.addEventListener('play', function () {
    state.playing = true;
    state.needsResume = false;
    renderPlayState();
    renderResume();
    msPlayback('playing');
    if (rippleHandle) rippleHandle.resume();
  });
  audio.addEventListener('pause', function () {
    // 卸载逼出的暂停不写回（否则新文档永不续播）
    if (unloading) return;
    state.playing = false;
    renderPlayState();
    msPlayback('paused');
    if (rippleHandle) rippleHandle.pause();
  });
  audio.addEventListener('ended', function () { onTrackEnd(); });
  audio.addEventListener('error', function () {
    var t = currentTrack();
    if (!t || !t.url) return;
    state.playing = false;
    renderPlayState();
    toast('播放失败：' + t.title);
  });

  /* ============================================================
     系统「正在播放」（macOS 控制中心 / 媒体键）
     宿主是 Electron，Chromium 把 navigator.mediaSession 桥到 macOS 的 MediaRemote：
     metadata → 面板的标题/歌手/封面，action handler → 面板按钮与键盘媒体键。
     **没注册 handler 的命令，系统不转发给页面**（按了没反应），所以上一曲/下一曲/
     进度得显式接上；默认动作只兜播放/暂停。
     ============================================================ */
  var mediaSessionApi = (typeof navigator !== 'undefined' && navigator.mediaSession) ? navigator.mediaSession : null;

  function msPlayback(name) {
    if (!mediaSessionApi) return;
    try { mediaSessionApi.playbackState = name; } catch (e) {}
  }

  var lastPosAt = 0;
  /* 进度：系统靠这条外推进度条；不报的话面板上那条是浏览器默认值，未必对。
   * 时长未知时报了会抛，所以先判有效时长；节流约 1s，seek/切歌后强制刷。 */
  function syncPositionState(force) {
    if (!mediaSessionApi || typeof mediaSessionApi.setPositionState !== 'function') return;
    var dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    if (!dur) return;
    var now = Date.now();
    if (!force && now - lastPosAt < 900) return;
    var pos = isFinite(audio.currentTime) ? Math.max(0, Math.min(audio.currentTime, dur)) : 0;
    try {
      mediaSessionApi.setPositionState({
        duration: dur,
        playbackRate: audio.playbackRate > 0 ? audio.playbackRate : 1,
        position: pos
      });
      lastPosAt = now;
    } catch (e) {}
  }

  /* 系统面板的封面必须**同源**：跨源图 Chromium 拓不到像素，artwork 会被静默丢掉
   * （面板退回占位图）。所以经 App 自己的路由代理一次，顺带把网易云封面要成 512。 */
  function msArtwork(pic) {
    if (!pic) return [];
    var proxied = API + '/widget/api/music/cover?size=512&url=' + encodeURIComponent(pic);
    return [{ src: withSession(proxied), sizes: '512x512', type: 'image/jpeg' }];
  }

  /* 元数据：只喂真字段，拿不到就不给（宁可空着，也别拿歌单名冒充歌手） */
  function syncMediaSession() {
    if (!mediaSessionApi) return;
    var t = currentTrack();
    if (!t) {
      try { mediaSessionApi.metadata = null; } catch (e) {}
      msPlayback('none');
      return;
    }
    var meta = { title: t.title || '未命名' };
    if (t.author) meta.artist = t.author;
    meta.album = sourceName(t);
    var art = msArtwork(t.pic);
    if (art.length) meta.artwork = art;
    try { mediaSessionApi.metadata = new MediaMetadata(meta); } catch (e) {}
    syncPositionState(true);
  }

  function msSeekBy(delta) {
    var dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    var to = Math.max(0, (audio.currentTime || 0) + delta);
    if (dur) to = Math.min(to, dur);
    try { audio.currentTime = to; } catch (e) { return; }
    state.progress = to;
    renderProgress();
    updateLyricIndex(true);
    syncPositionState(true);
  }

  function msStep(dir) {
    var i = stepIndex(dir);
    var vis = visibleTracks();
    if (i >= 0 && vis[i]) playTrack(vis[i].uid);
  }

  /* handler 一次性挂上：面板按钮 / 媒体键 → 与页面内控件同一套逻辑 */
  (function bindMediaSessionActions() {
    if (!mediaSessionApi || typeof mediaSessionApi.setActionHandler !== 'function') return;
    function on(name, fn) { try { mediaSessionApi.setActionHandler(name, fn); } catch (e) {} }
    on('play', function () { if (!currentTrack()) return; audio.play().catch(onAutoplayBlocked); persistNow(); });
    on('pause', function () { audio.pause(); persistNow(); });
    on('previoustrack', function () { msStep(-1); });
    on('nexttrack', function () { msStep(1); });
    on('stop', function () {
      audio.pause();
      try { audio.currentTime = 0; } catch (e) {}
      state.playing = false;
      state.progress = 0;
      renderPlayState();
      renderProgress();
      syncPositionState(true);
      persistNow();
    });
    on('seekbackward', function (d) { msSeekBy(-((d && d.seekOffset) || 10)); });
    on('seekforward', function (d) { msSeekBy((d && d.seekOffset) || 10); });
    on('seekto', function (d) {
      if (!d || typeof d.seekTime !== 'number') return;
      var dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      var to = dur ? Math.min(d.seekTime, dur) : d.seekTime;
      if (d.fastSeek && typeof audio.fastSeek === 'function') {
        try { audio.fastSeek(to); } catch (e) { audio.currentTime = to; }
      } else {
        try { audio.currentTime = to; } catch (e) { return; }
      }
      syncPositionState(true);
    });
  })();

  /* ============================================================
     随机播放的「上一曲」：回家的路
     随机的下一曲是掷骰子，上一曲不是 —— 它得回到**刚听过的那一首**。
     所以随机模式里留一条「听过的路」（uid 栈，末尾永远是当前曲目）：
       · 换曲（下一曲 / 自动续播 / 点队列）→ 压栈
       · 上一曲 → 先弹掉当前，再取新的末尾；路上没有（刚开始、或换了歌单）
         → 退回顺序上一首，不再随机（再随机一次就是你提的那个毛病）
     栈随快照落盘，拖进/拖出换文档也还在。
     ============================================================ */
  var SHUFFLE_TRAIL_MAX = 50;
  var shuffleTrail = [];

  function shuffleTrailPush(uid) {
    if (!uid) return;
    if (shuffleTrail[shuffleTrail.length - 1] === uid) return;
    shuffleTrail.push(uid);
    if (shuffleTrail.length > SHUFFLE_TRAIL_MAX) {
      shuffleTrail.splice(0, shuffleTrail.length - SHUFFLE_TRAIL_MAX);
    }
  }

  /* 往回走一步：返回上一条的 uid，没有来路返回 ''。
   * 顺带把已不在当前歌单的旧条目弹掉（切歌单后那条路就断了）。 */
  function shuffleBackUid() {
    var vis = visibleTracks();
    var cur = state.currentUid;
    if (shuffleTrail.length && shuffleTrail[shuffleTrail.length - 1] === cur) shuffleTrail.pop();
    while (shuffleTrail.length) {
      var uid = shuffleTrail[shuffleTrail.length - 1];
      for (var k = 0; k < vis.length; k++) if (vis[k].uid === uid) return uid;
      shuffleTrail.pop();
    }
    return '';
  }

  function stepIndex(dir) {
    var vis = visibleTracks();
    var n = vis.length;
    if (!n) return -1;
    var i = currentIndex();
    if (i < 0) return dir >= 0 ? 0 : n - 1;
    if (state.mode === 'shuffle') {
      if (n === 1) return 0;
      if (dir < 0) {
        var back = shuffleBackUid();
        for (var k = 0; k < n; k++) if (vis[k].uid === back) return k;
        return (i - 1 + n) % n;      // 没有来路：按顺序往回，别随机
      }
      var j = i;
      while (j === i) j = Math.floor(Math.random() * n);
      return j;
    }
    return (i + dir + n) % n;
  }

  function onTrackEnd() {
    if (state.mode === 'one') {
      audio.currentTime = 0;
      audio.play().catch(onAutoplayBlocked);
      return;
    }
    var i = stepIndex(1);
    var vis = visibleTracks();
    if (i >= 0 && vis[i]) playTrack(vis[i].uid);
  }

  var resolveGen = 0;

  /* 旧版导入的在线曲目只有 searchKey：按搜索词搜完整音频（主源失败依次降级）。
   * 命中后把 url/pic/lrcUrl 补进曲目并回写列表，再交给音频引擎。 */
  function ensurePlayable(t) {
    if (t.url) return Promise.resolve(t);
    var raw = t.raw || {};
    var key = String(raw.searchKey || '').trim();
    if (!key) { toast('无法获取音频：' + t.title); return Promise.resolve(null); }
    var primary = raw.searchServer || 'netease';
    var servers = [primary].concat(['netease', 'tencent', 'kugou'].filter(function (s) { return s !== primary; }));
    var token = ++resolveGen;
    toast('搜索 ' + t.title + '…');
    function tryServer(i) {
      if (i >= servers.length) return Promise.resolve(null);
      return apiGetJson(ENDPOINT.search + '?keyword=' + encodeURIComponent(key) + '&server=' + servers[i]).then(function (res) {
        if (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) {
          for (var j = 0; j < res.body.results.length; j++) {
            if (res.body.results[j] && res.body.results[j].url) return res.body.results[j];
          }
        }
        return tryServer(i + 1);
      }).catch(function () { return tryServer(i + 1); });
    }
    return tryServer(0).then(function (hit) {
      if (token !== resolveGen) return null;
      if (!hit || !hit.url) { toast('所有源均未找到：' + t.title); return null; }
      t.url = hit.url;
      if (hit.pic) t.pic = hit.pic;
      if (hit.lrc) t.lrcUrl = hit.lrc;
      if (hit.author) { t.author = hit.author; t.artist = hit.author; }
      raw.url = t.url;
      raw.mode = t.mode;
      if (t.author) raw.author = t.author;
      if (t.pic) raw.pic = t.pic;
      if (t.lrcUrl) raw.lrcUrl = t.lrcUrl;
      savePlaylist();
      return t;
    });
  }

  function playTrack(uid, keepProgress) {
    var t = trackByUid(uid);
    if (!t) return;
    var changed = uid !== state.currentUid;
    if (changed && lyricAlign) closeLyricAlign();
    state.currentUid = uid;
    /* 记入「最近播放」（任何来源播的歌都记，最近在前）。
     * 不记 detached 的临时条目（那是列表被删后只够播完的残体）。
     * 只在真正换曲时记，同一首重复播不反复重排。 */
    if (changed && !t.detached) recordRecent(t);
    if (changed && state.mode === 'shuffle') shuffleTrailPush(uid);
    if (changed && !keepProgress) state.progress = 0;
    /* 换曲时立刻把列表落盘：最近播放/当前曲目必须能在下一次拖进拖出时被找到。
     * 以前只有「dur 未知」的曲目会因 loadedmetadata 触发一次 savePlaylist，
     * 搜索/榜单里带 dur 的曲目（尤其 B站）就永远不落盘 —— 拖走即丢歌。 */
    if (changed) savePlaylist();
    if (changed) {
      lyricIndex = -1;
      state.follow = true;
      clearFollowTimer();
      if (lyrics) lyrics.classList.remove('is-browsing');
      flashCtlTrack();   // 曲目信息入场（从下方 5px 回位）
    }
    state.playing = true;
    state.needsResume = false;
    renderTrack();
    renderQueue();
    if (changed) centerCurrentInQueue();   // 切歌时把新曲滚进视野中部（罐头拍板）
    renderProgress();
    renderPlayState();
    renderResume();
    updateLyricIndex(true);
    if (changed) loadLyrics(t);
    if (t.url) {
      loadAudio(t, changed ? 0 : state.progress, true);
    } else {
      // 无 url：可能是旧版 searchKey 曲目，异步解析后再播
      ensurePlayable(t).then(function (ok) {
        if (!ok || state.currentUid !== t.uid) return;
        renderTrack();
        renderQueue();
        loadLyrics(t);
        loadAudio(t, 0, true);
      });
    }
    persistNow();
    if (t.mode === '在线') apiPostJson(ENDPOINT.nowPlaying, { title: t.title, source: '在线' }).catch(function () {});
  }

  /* ============================================================
     控件
     ============================================================ */
  $('playBtn').addEventListener('click', function () {
    if (!currentTrack()) return;
    if (audio.paused) audio.play().catch(onAutoplayBlocked);
    else audio.pause();
    persistNow();
  });

  /* 「继续播放」引导：自动播放被拦时点一下恢复 */
  if ($('resumeBtn')) {
    $('resumeBtn').addEventListener('click', function () {
      if (!currentTrack()) return;
      audio.play().then(function () {
        state.needsResume = false;
        renderResume();
      }).catch(function () { /* 仍被拦就留着按钮 */ });
      persistNow();
    });
  }

  $('prevBtn').addEventListener('click', function () {
    var i = stepIndex(-1);
    var vis = visibleTracks();
    if (i >= 0 && vis[i]) playTrack(vis[i].uid);
  });

  $('nextBtn').addEventListener('click', function () {
    var i = stepIndex(1);
    var vis = visibleTracks();
    if (i >= 0 && vis[i]) playTrack(vis[i].uid);
  });

  $('modeBtn').addEventListener('click', function () {
    var i = MODES.map(function (m) { return m.key; }).indexOf(state.mode);
    state.mode = MODES[(i + 1) % MODES.length].key;
    renderMode();
    persistNow();
  });

  seek.addEventListener('input', function () {
    var v = parseFloat(seek.value) || 0;
    state.progress = v;
    if (currentTrack()) { try { audio.currentTime = v; } catch (e) {} }
    renderProgress();
    updateLyricIndex(false);
    persistState();
  });

  vol.addEventListener('input', function () {
    state.volume = (parseInt(vol.value, 10) || 0) / 100;
    state.muted = state.volume === 0;
    audio.volume = state.volume;
    audio.muted = state.muted;
    renderVolume();
    persistState();
  });

  $('muteBtn').addEventListener('click', function () {
    if (state.muted || state.volume === 0) {
      state.muted = false;
      if (state.volume === 0) state.volume = 0.6;
    } else {
      state.muted = true;
    }
    audio.muted = state.muted;
    audio.volume = state.volume;
    renderVolume();
    persistState();
  });

  /* ---------- 音量浮层：悬停 / 聚焦向上弹出竖条，移开即收 ----------
   * 点按钮仍是「切静音」（上面那条）。浮层挂在 .vol-group 里，
   * 鼠标从按钮挪到浮层上不算离开组，所以不会中途收起；拖动滑条期间也不收。 */
  var volGroup = player.querySelector('.vol-group');
  var muteBtn = $('muteBtn');
  var volPopShown = false;
  var volCloseTimer = 0;
  var volDragging = false;

  function openVolPop() {
    if (volCloseTimer) { clearTimeout(volCloseTimer); volCloseTimer = 0; }
    if (volPopShown) return;
    volPopShown = true;
    volGroup.classList.add('is-open');
    muteBtn.setAttribute('aria-expanded', 'true');
  }
  function closeVolPop() {
    if (volCloseTimer) { clearTimeout(volCloseTimer); volCloseTimer = 0; }
    if (!volPopShown) return;
    volPopShown = false;
    volGroup.classList.remove('is-open');
    muteBtn.setAttribute('aria-expanded', 'false');
  }
  function closeVolPopSoon() {
    if (volCloseTimer) clearTimeout(volCloseTimer);
    volCloseTimer = setTimeout(function () { volCloseTimer = 0; closeVolPop(); }, 90);
  }

  if (volGroup) {
    volGroup.addEventListener('pointerenter', openVolPop);
    volGroup.addEventListener('pointerleave', function () {
      if (!volDragging) closeVolPopSoon();
    });
    volGroup.addEventListener('focusin', openVolPop);
    volGroup.addEventListener('focusout', function (e) {
      if (!volGroup.contains(e.relatedTarget)) closeVolPop();
    });
    vol.addEventListener('pointerdown', function () { volDragging = true; openVolPop(); });
    document.addEventListener('pointerup', function () {
      if (!volDragging) return;
      volDragging = false;
      if (!volGroup.matches(':hover') && !volGroup.contains(document.activeElement)) closeVolPopSoon();
    });
  }

  $('favBtn').addEventListener('click', function () {
    var t = currentTrack();
    if (!t) return;
    var nowOn = toggleFav(t.id);
    renderTrack();
    renderQueue();
    popHeart(this);
    toast(nowOn ? '已加入我的喜欢' : '已取消喜欢');
  });

  /* 歌词显隐：有词/无词交叉淡入淡出（motion 4）。
   * 无词时不再有「替身内容」要交班——涟漪常驻在底层（不随这首变化），
   * 所以只需歌词本身入场/退场。display 不能过渡 → 过渡期间用 .is-swap-*
   * 强制挂载，到时摘类回到 resting 的 display:none（延迟卸载）。 */
  var SWAP_MS = 220;
  var lastPanel = null;   // 'lyric' | 'blank'，只在「歌词显示态真的变了」时才过渡

  function syncPanels(animate) {
    var has = player.getAttribute('data-haslyrics') === '1';
    var next = has ? 'lyric' : 'blank';
    if (lastPanel === next) return;
    if (lastPanel && animate) swapPanels(has);
    lastPanel = next;
  }

  function swapPanels(lyricsOn) {
    var show = lyricsOn ? lyricWrap : null;
    var hide = lyricsOn ? null : lyricWrap;
    // 退场：保持挂载淡出，到时摘类
    if (hide) {
      clearTimeout(hide.__swapT);
      hide.classList.remove('is-swap-in');
      hide.classList.add('is-swap-out');
      hide.__swapT = setTimeout(function () {
        hide.classList.remove('is-swap-out');
        hide.__swapT = 0;
      }, SWAP_MS);
    }
    // 入场：淡入 + 轻微上浮
    if (show) {
      clearTimeout(show.__swapT); show.__swapT = 0;
      show.classList.remove('is-swap-out');
      show.classList.remove('is-swap-in');
      void show.offsetWidth;
      show.classList.add('is-swap-in');
    }
  }

  /* 队列呼出/收回：进加 .is-anim 滑入；出加 player.is-q-leaving 滑出，
   * 动画结束再摘类回到 resting 的 display:none（延迟卸载，可打断）。 */
  var queueLeaveTimer = 0;
  var queueEnterTimer = 0;

  function pulseQueueAnim() {
    var q = $('queue');
    if (!q) return;
    q.classList.remove('is-anim');
    // 强制回流后重加，保证连点同一方向也能重放
    void q.offsetWidth;
    q.classList.add('is-anim');
  }

  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function cancelQueueLeave() {
    clearTimeout(queueLeaveTimer); queueLeaveTimer = 0;
    clearTimeout(queueEnterTimer); queueEnterTimer = 0;
    player.classList.remove('is-q-leaving');
    player.classList.remove('is-q-in');
  }

  /* 降级（reduced-motion）：不做延迟卸载，直接卸 */
  function beginQueueLeave(ms) {
    if (reducedMotion()) return;
    player.classList.remove('is-q-in');
    player.classList.add('is-q-leaving');
    clearTimeout(queueLeaveTimer);
    queueLeaveTimer = setTimeout(function () {
      player.classList.remove('is-q-leaving');
      queueLeaveTimer = 0;
    }, ms);
  }

  /* 入场镜像：播放页留在原地左滑淡出，队列从右滑入（矮卡整页交叉） */
  function beginQueueEnter(ms) {
    if (reducedMotion()) return;
    player.classList.remove('is-q-leaving');
    player.classList.remove('is-q-in');
    void player.offsetWidth;
    player.classList.add('is-q-in');
    clearTimeout(queueEnterTimer);
    queueEnterTimer = setTimeout(function () {
      player.classList.remove('is-q-in');
      queueEnterTimer = 0;
    }, ms);
  }

  function setDrawer(open) {
    if (open) {
      cancelQueueLeave();
      state.drawer = true;
      renderChrome();
      pulseQueueAnim();
    } else {
      state.drawer = false;
      renderChrome();
      beginQueueLeave(280);   // 同帧内重新挂载，不留中间帧
    }
    persistState();
  }

  function setCompactPage(next) {
    if (next === 'queue') {
      cancelQueueLeave();
      state.page = 'queue';
      renderChrome();
      renderAsk();                // 队列页不显无词入口
      beginQueueEnter(260);   // 整页交叉：播放页左滑出 + 队列右滑入
    } else {
      state.page = 'play';
      renderChrome();
      renderAsk();
      beginQueueLeave(260);
    }
    persistState();
  }

  $('queueBtn').addEventListener('click', function () {
    var layout = player.getAttribute('data-layout');
    if (layout === 'wide') setDrawer(!state.drawer);
    else if (layout === 'compact') setCompactPage(state.page === 'play' ? 'queue' : 'play');
    else { renderChrome(); persistState(); }   // long：队列常驻，无抽屉
  });

  $('backBtn').addEventListener('click', function () { setCompactPage('play'); });

  /* 播放页红心（曲名下方 meta 旁）：点一下切换对当前曲的喜欢。 */
  if ($('stageFavBtn')) $('stageFavBtn').addEventListener('click', function () {
    var t = currentTrack();
    if (!t) return;
    var nowOn = toggleFav(t.id);
    renderQueue();
    renderTrack();
    popHeart(this);
    toast(nowOn ? '已加入我的喜欢' : '已取消喜欢');
  });

  $('drawerCloseBtn').addEventListener('click', closeDrawer);

  function closeDrawer() { setDrawer(false); }

  drawerScrim.addEventListener('click', closeDrawer);

  /* ---------- 队列行 / 浮层 ---------- */
  var moreTargetUid = null;
  var morePop = $('morePop');
  var importPop = $('importPop');
  var listPop = $('listPop');
  var importNote = $('importNote');
  var importBusy = false;

  function setNote(msg) { if (importNote) importNote.textContent = msg || ''; }

  function closePops() {
    morePop.hidden = true;
    importPop.hidden = true;
    if (listPop) listPop.hidden = true;
    $('importBtn').setAttribute('aria-expanded', 'false');
    moreTargetUid = null;
    suppressTabId = '';
  }

  function placePop(pop, anchor) {
    var pr = queue.getBoundingClientRect();
    var ar = anchor.getBoundingClientRect();
    pop.hidden = false;
    var w = pop.offsetWidth;
    var h = pop.offsetHeight;
    var top = ar.bottom - pr.top + 6;
    if (top + h > pr.height - 8) top = Math.max(8, ar.top - pr.top - h - 6);
    var left = ar.right - pr.left - w;
    left = Math.max(8, Math.min(left, pr.width - w - 8));
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }

  queueList.addEventListener('click', function (e) {
    // 空列表引导按钮（本地页）
    if (e.target.closest('#localPickBtn')) { pickLocalFolder(); return; }
    if (e.target.closest('#localRescanBtn')) { syncLocalFolder(true); return; }

    // 红心：加/取消「我的喜欢」。不改列表归属，只动 fav 那份副本。
    var favHit = e.target.closest('.q-fav');
    if (favHit) {
      e.stopPropagation();
      var fr = favHit.closest('.q-row');
      var ft = trackByUid(fr.getAttribute('data-uid'));
      if (ft) {
        var nowOn = toggleFav(ft.id);
        renderQueue();
        renderTrack();
        toast(nowOn ? '已加入我的喜欢' : '已取消喜欢');
      }
      return;
    }

    var more = e.target.closest('.q-more');
    if (more) {
      e.stopPropagation();
      var row = more.closest('.q-row');
      moreTargetUid = row.getAttribute('data-uid');
      var t = trackByUid(moreTargetUid);
      $('moreTitle').textContent = t ? t.title + ' — ' + t.artist : '';
      importPop.hidden = true;
      placePop(morePop, more);
      return;
    }
    var hit = e.target.closest('.q-hit');
    if (hit) {
      var li = hit.closest('.q-row');
      playTrack(li.getAttribute('data-uid'));
    }
  });

  /* 顶部歌单切换条 */
  var suppressTabId = '';   // 长按弹删除浮层后，紧随释放的 click 不当作切列表
  if (listTabs) {
    // 溢出提示：滚动位置一变就重算两侧渐隐；宿主改宽（ResizeObserver）也要跟着重算
    listTabs.addEventListener('scroll', updateTabFade, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(updateTabFade).observe(listTabs);
    // 鼠标竖滚轮 → 横向滚（触控板/触摸本来就能横滑；鼠标用户原来只能按住 shift）
    listTabs.addEventListener('wheel', function (e) {
      if (listTabs.scrollWidth - listTabs.clientWidth <= 1) return;
      var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      listTabs.scrollLeft += d;
    }, { passive: false });
    listTabs.addEventListener('click', function (e) {
      var tab = e.target.closest('.list-tab');
      if (!tab) return;
      if (suppressTabId && tab.getAttribute('data-list') === suppressTabId) { suppressTabId = ''; return; }
      var id = tab.getAttribute('data-list');
      if (!id || id === state.activeList) return;
      renaming = false;
      state.activeList = id;
      renderQueue();
      centerCurrentInQueue();   // 切回该列表时，把正在播的那首滚进视野中部
      renderTrack();
      persistState();
    });
    // 双击当前项 → 重命名（内联输入，轻量）
    listTabs.addEventListener('dblclick', function (e) {
      var tab = e.target.closest('.list-tab.is-active');
      if (tab) startRename();
    });
    // 右键导入列表 → 删除确认（轻量浮层，不用模态）
    listTabs.addEventListener('contextmenu', function (e) {
      var tab = e.target.closest('.list-tab');
      if (!tab) return;
      var id = tab.getAttribute('data-list');
      if (!id || id === 'local') return;   // 本地不可删，不弹
      e.preventDefault();
      openListPop(tab);
    });
    // 长按导入列表 → 同上（移动端手感）
    listTabs.addEventListener('pointerdown', function (e) {
      var tab = e.target.closest('.list-tab');
      if (!tab) return;
      var id = tab.getAttribute('data-list');
      if (!id || id === 'local') return;
      cancelListPress();
      listPressTimer = setTimeout(function () { listPressTimer = 0; openListPop(tab); }, 520);
    });
    ['pointerup', 'pointercancel', 'pointerleave', 'pointermove'].forEach(function (ev) {
      listTabs.addEventListener(ev, cancelListPress);
    });
  }

  /* ---------- 歌单重命名（内联编辑，不用模态） ---------- */
  var renaming = false;
  function startRename() {
    var l = findList(state.activeList);
    if (!l || l.id === 'local' || l.id === 'fav' || l.id === 'recent') return;  // 本地/我的喜欢/最近播放名固定
    var host = $('queueTitle');
    if (!host || host.querySelector('input')) return;
    renaming = true;
    host.innerHTML = '<input class="list-name-input" id="listNameInput" type="text" maxlength="40" aria-label="歌单名">';
    var inp = $('listNameInput');
    inp.value = l.name || '';
    inp.focus();
    try { inp.select(); } catch (e) {}
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
    });
    inp.addEventListener('blur', commitRename);
  }
  function commitRename() {
    var inp = $('listNameInput');
    if (!inp) return;
    var l = findList(state.activeList);
    var v = String(inp.value || '').trim();
    if (l && v) { l.name = v; saveLists(); }
    renaming = false;
    renderQueue();  // 重渲染队列头，输入框自然移除
  }
  function cancelRename() { renaming = false; renderQueue(); }
  if ($('renameBtn')) $('renameBtn').addEventListener('click', function (e) { e.stopPropagation(); startRename(); });

  /* ---------- 歌单删除（长按 / 右键导入列表，拍板 4）---------- */
  var listPressTimer = 0;
  var listDeleteTarget = null;
  function cancelListPress() {
    if (listPressTimer) { clearTimeout(listPressTimer); listPressTimer = 0; }
  }
  function openListPop(tab) {
    if (!tab) return;
    var id = tab.getAttribute('data-list');
    if (!id || id === 'local' || id === 'fav' || id === 'recent') return;   // 固定列表不出删除菜单
    var l = findList(id);
    if (!l) return;
    listDeleteTarget = id;
    var title = $('listPopTitle');
    if (title) title.textContent = '删除「' + (l.name || defaultListName(id)) + '」？';
    closePops();
    placePop(listPop, tab);
    suppressTabId = id;   // 紧随长按释放的 click 不当作切列表
  }
  /* 删除一个导入列表：删元数据 + 删该列表下所有曲目条目。
   * 正在播的那首被删时：继续播完，只把列表从切换条拿掉 —— 办法是**豁免当前曲目**
   * （在 state.tracks 里给它打 detached 标记、保留运行时条目；否则 currentTrack() 找不到它，
   * 标题/进度/歌词会崩）。detached 条目不回写盘（见 savePlaylist），下次启动不会把已删列表重建。
   * 本地列表不可删（它是固定文件夹的投影）。 */
  function deleteList(id) {
    id = String(id || '');
    if (!id || id === 'local') { toast('本地列表不可删除'); return false; }
    if (id === 'fav') { toast('「我的喜欢」不可删除，逐首取消红心即可'); return false; }
    if (id === 'recent') { toast('「最近播放」不可删除'); return false; }
    var l = findList(id);
    if (!l) return false;
    var keepUid = state.currentUid;
    var dropped = 0;
    state.tracks = state.tracks.filter(function (t) {
      if (t.list !== id) return true;
      if (t.uid === keepUid) { t.detached = true; return true; }   // 豁免正在播的那首
      dropped++;
      return false;
    });
    state.lists = state.lists.filter(function (x) { return x.id !== id; });
    saveLists();
    if (state.activeList === id) {
      state.activeList = findList('local') ? 'local' : (state.lists[0] ? state.lists[0].id : 'local');
    }
    savePlaylist();   // 全量回写（detached 条目不落盘）
    renderQueue();
    renderTrack();
    renderProgress();
    persistNow();
    toast('已删除歌单「' + (l.name || defaultListName(id)) + '」' + (dropped ? '，' + dropped + ' 首' : ''));
    return true;
  }
  if (listPop) {
    $('listDeleteBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      var id = listDeleteTarget;
      listDeleteTarget = null;
      closePops();
      if (id) deleteList(id);
    });
    $('listCancelBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      listDeleteTarget = null;
      closePops();
    });
  }

  /* 删除：先本地移除（即时反馈），再叫后端删列表 + 清 media/lyrics；失败回滚 */
  $('removeBtn').addEventListener('click', function () {
    if (!moreTargetUid) return;
    var uid = moreTargetUid;
    var target = trackByUid(uid);
    var wasCurrent = uid === state.currentUid;
    var idx = currentIndex();
    closePops();

    var prevTracks = state.tracks.slice();
    var prevUid = state.currentUid;
    var prevProgress = state.progress;

    state.tracks = state.tracks.filter(function (x) { return x.uid !== uid; });
    if (wasCurrent) {
      var vis = visibleTracks();
      if (vis.length) {
        var next = vis[Math.min(idx < 0 ? 0 : idx, vis.length - 1)];
        state.currentUid = next.uid;
        state.progress = 0;
        playTrack(next.uid);
      } else {
        state.currentUid = '';
        state.progress = 0;
        state.playing = false;
        audio.removeAttribute('src');
        try { audio.load(); } catch (e) {}
        lyricIndex = -1;
        state.lyricLines = [];
        renderLyrics();
        renderTrack();
        renderPlayState();
      }
    }
    renderQueue();
    renderProgress();
    persistNow();
    toast('已从队列移除');

    // 后端按 id + list 定位（同一首歌在两个歌单里各自独立删除）
    var qs = '?id=' + encodeURIComponent(target ? target.id : '') +
             '&list=' + encodeURIComponent(target ? target.list : '');
    function rollback() {
      toast('移除失败，已恢复');
      state.tracks = prevTracks;
      state.currentUid = prevUid;
      state.progress = prevProgress;
      renderQueue();
      renderTrack();
      renderProgress();
    }
    apiDeleteJson(ENDPOINT.track + qs).then(function (res) {
      if (!res.ok) rollback();
    }).catch(rollback);
  });

  $('importBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    var open = importPop.hidden;
    closePops();
    if (open) {
      setNote('');
      placePop(importPop, $('importBtn'));
      $('importBtn').setAttribute('aria-expanded', 'true');
      var input = $('linkInput');
      if (input) setTimeout(function () { input.focus(); }, 30);
    }
  });

  function afterImport(added, label) {
    renderQueue();
    renderTrack();
    if (added > 0) {
      savePlaylist();
      toast(label + '：新增 ' + added + ' 首');
      setNote('已新增 ' + added + ' 首');
    } else {
      toast(label + '：没有新曲目（可能已存在）');
      setNote('没有新曲目（可能已存在）');
    }
  }

  /* 新建一个导入列表并切过去 */
  function newImportList(namePrefix) {
    var id = nextImportId();
    var l = { id: id, name: namePrefix + ' ' + id.replace(/^imp:/, '') };
    state.lists.push(l);
    saveLists();
    state.activeList = id;
    return id;
  }

  /* 单曲 / 本地文件的归处（拍板 1）：归到**当前激活列表**；
   * 当前页是本地列表时（本地严格等于固定文件夹，塞不进去）退化为新建/复用
   * 一个名为 nameIfLocal 的导入列表（复用同名列表，避免越建越多），并切过去。 */
  function resolveImportTarget(nameIfLocal) {
    if (/^imp:/.test(state.activeList) && findList(state.activeList)) return state.activeList;
    for (var i = 0; i < state.lists.length; i++) {
      if (state.lists[i].id !== 'local' && state.lists[i].name === nameIfLocal) {
        state.activeList = state.lists[i].id;
        return state.lists[i].id;
      }
    }
    var id = nextImportId();
    state.lists.push({ id: id, name: nameIfLocal });
    saveLists();
    state.activeList = id;
    return id;
  }

  /* 在线链接导入：单曲 / 歌单
   *  · 歌单 → 新建一个导入列表（按导入顺序编号，名「歌单 N」，可重命名），并切过去
   *  · 单曲 → 归入当前激活列表；当前是本地列表时新建/复用名为「单曲」的导入列表 */
  function importLink(raw) {
    var v = String(raw || '').trim();
    if (!v) { setNote('请先粘贴链接'); return; }
    var isPlaylist = /playlist|toplist|album|discover\/toplist/i.test(v) || /\/album\?/.test(v);
    var idm = /[?&]id=(\d+)/.exec(v);
    var id = idm ? idm[1] : (/^\d+$/.test(v) ? v : '');
    if (!id) { setNote('无法从链接里识别歌曲 / 歌单 id'); return; }
    setNote('正在解析…');
    var url = isPlaylist
      ? ENDPOINT.musicPlaylist + '?id=' + encodeURIComponent(id) + '&server=netease'
      : ENDPOINT.song + '?id=' + encodeURIComponent(id) + '&server=netease';
    apiGetJson(url).then(function (res) {
      if (!res.ok || !res.body || !res.body.ok) {
        setNote('解析失败：' + ((res.body && res.body.error) || res.status));
        return;
      }
      var list = isPlaylist ? (res.body.tracks || []) : (res.body.track ? [res.body.track] : []);
      var targetId = isPlaylist ? newImportList('歌单') : resolveImportTarget('单曲');
      /* 歌单真名（netease 官方接口给的 meta.name）：写进列表元数据，切换条显示压缩名。
       * 后端取不到时 meta 缺失，列表保持自动名「歌单 N」（切换条退回编号）。 */
      if (isPlaylist) {
        var meta = res.body.meta;
        var metaName = meta && String(meta.name || '').trim();
        if (metaName) {
          var nl = findList(targetId);
          if (nl) {
            nl.name = metaName;
            if (meta.creator) nl.creator = String(meta.creator).trim();
            saveLists();
          }
        }
      }
      var added = mergeTracks(list, targetId);
      afterImport(added, isPlaylist ? '在线歌单' : '在线单曲');
      var input = $('linkInput');
      if (input) input.value = '';
    }).catch(function () { setNote('解析失败：网络错误'); });
  }

  /* 本地文件 / 文件夹：需要宿主文件选择器（hana.resources.pick）。
   * 纯浏览器里拿不到磁盘绝对路径 —— 明确提示，不假装能用。 */
  function hostPick(input) {
    if (!window.hana || !window.hana.resources || typeof window.hana.resources.pick !== 'function') {
      return Promise.reject(new Error('宿主不支持文件选择'));
    }
    return window.hana.resources.pick(input);
  }

  /* 扫描本地固定文件夹，**替换** local 列表内容（拍板：本地 = 严格等于该文件夹）。
   * 扫描失败时不动已存内容（不误删）。 */
  function syncLocalFolder(announce) {
    if (!state.localDir) return Promise.resolve(0);
    ensureList('local', '本地');
    return apiGetJson(ENDPOINT.scanFolder + '?path=' + encodeURIComponent(state.localDir)).then(function (r) {
      if (!r.ok || !r.body || !r.body.ok) {
        if (announce) toast('扫描失败：' + ((r.body && r.body.error) || r.status));
        return 0;
      }
      // 先拿掉旧的 local 曲目，再放入本次扫描结果（替换语义）
      state.tracks = state.tracks.filter(function (x) { return x.list !== 'local'; });
      var added = mergeTracks(r.body.files || [], 'local');
      // 正在播的那首若被本次替换移除，保留当前播放指针不强行切歌
      savePlaylist();
      renderQueue();
      if (announce) toast(added > 0 ? '本地文件夹：' + added + ' 首' : '文件夹里没有音频文件');
      return added;
    }).catch(function () { if (announce) toast('扫描失败：网络错误'); return 0; });
  }

  /* 选本地固定文件夹（入口：本地页引导按钮 / 导入面板「本地文件夹」） */
  function pickLocalFolder() {
    if (importBusy) return;
    importBusy = true;
    setNote('请选择文件夹…');
    hostPick({ mode: 'directory' }).then(function (res) {
      var ref = res && res.resources && res.resources[0];
      var dir = ref && ref.path;
      if (!dir) { setNote('未选择文件夹'); importBusy = false; return; }
      state.localDir = String(dir);
      storeSet(LOCALDIR_KEY, state.localDir);
      if (!findList('local')) ensureList('local', '本地');
      state.activeList = 'local';
      setNote('正在扫描…');
      return syncLocalFolder(true);
    }).catch(function (e) {
      setNote(e && e.message ? e.message : '文件夹选择不可用');
    }).then(function () { importBusy = false; });
  }

  function importLocalFiles() {
    if (importBusy) return;
    importBusy = true;
    setNote('请选择文件…');
    hostPick({ mode: 'file', multiple: true }).then(function (res) {
      var refs = (res && res.resources) || [];
      var paths = refs.map(function (r) { return r && r.path; }).filter(Boolean);
      if (!paths.length) { setNote('未选择文件'); importBusy = false; return; }
      setNote('导入 ' + paths.length + ' 个文件…');
      return Promise.all(paths.map(function (p) {
        return apiGetJson(ENDPOINT.importFile + '?path=' + encodeURIComponent(p))
          .then(function (r) { return (r.ok && r.body && r.body.ok) ? r.body : null; })
          .catch(function () { return null; });
      })).then(function (items) {
        // 本地文件不再往「本地列表」（那严格等于固定文件夹），归到当前导入列表；
        // 当前页是本地时新建/复用名为「本地文件」的导入列表。
        var target = resolveImportTarget('本地文件');
        afterImport(mergeTracks(items.filter(Boolean), target), '本地文件');
      });
    }).catch(function (e) {
      setNote(e && e.message ? e.message : '文件选择不可用');
    }).then(function () { importBusy = false; });
  }

  /* ---------- 歌手补齐（拍板 3，一次性全量）----------
   * 旧数据（有 searchKey、无 author）逐首走 music/search 取首条 author 写回。
   * 串行/≤3 并发 + 节流；单项失败不中断；幂等（已有 author 跳过）；带进度。
   * 只在用户点「补全歌手」时跑，**不**开机自动跑。 */
  var backfilling = false;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function backfillTargets() {
    var out = [];
    for (var i = 0; i < state.tracks.length; i++) {
      var t = state.tracks[i];
      if (String(t.author || '').trim()) continue;                    // 幂等：已有歌手跳过
      if (String((t.raw && t.raw.searchKey) || '').trim()) out.push(t);
    }
    return out;
  }
  function backfillArtists() {
    if (backfilling) return Promise.resolve();
    var targets = backfillTargets();
    if (!targets.length) { toast('歌手已齐，无需补全'); setNote('歌手已补全'); return Promise.resolve(); }
    backfilling = true;
    var btn = $('backfillBtn');
    if (btn) btn.disabled = true;
    var cursor = 0, done = 0, ok = 0;
    setNote('补全歌手 0/' + targets.length + '…');
    toast('开始补全 ' + targets.length + ' 首的歌手');

    function worker() {
      if (cursor >= targets.length) return Promise.resolve();
      var t = targets[cursor++];
      var key = String((t.raw && t.raw.searchKey) || '').trim();
      var server = String((t.raw && t.raw.searchServer) || 'netease');
      return apiGetJson(ENDPOINT.search + '?keyword=' + encodeURIComponent(key) + '&server=' + encodeURIComponent(server))
        .then(function (res) {
          if (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) {
            for (var j = 0; j < res.body.results.length; j++) {
              var a = res.body.results[j] && String(res.body.results[j].author || '').trim();
              if (a) { t.author = a; t.artist = a; if (t.raw) t.raw.author = a; ok++; break; }
            }
          }
        })
        .catch(function () { /* 单项失败不中断整体 */ })
        .then(function () {
          done++;
          setNote('补全歌手 ' + done + '/' + targets.length + '…');
          if (done % 25 === 0) savePlaylist();   // 中途落盘，防打断丢进度
          return sleep(80).then(worker);         // 节流
        });
    }
    var runners = [];
    for (var k = 0; k < 3; k++) runners.push(worker());   // ≤3 并发
    return Promise.all(runners).then(function () {
      backfilling = false;
      if (btn) btn.disabled = false;
      savePlaylist();
      renderQueue();
      renderTrack();
      setNote('歌手补全完成：' + ok + '/' + targets.length);
      toast('歌手补全完成：' + ok + '/' + targets.length);
    });
  }

  /* ============================================================
     搜索页（罐头最初需求：左下角换搜索入口 + 一个搜索页）
     ------------------------------------------------------------
     入口长在独立窗口（wide）控制条最左；点开是一张整页浮层：
     输入框 + 平台选择 + 结果列表，每行主体点一下直接播、行尾一颗红心
     收藏到「我的喜欢」（加入 = 红心，同一件事；播放 ≠ 喜欢）。
     后端 /widget/api/music/search 已存在，这里只做界面与落库。
     ============================================================ */
  var SEARCH_SERVERS = [
    { id: 'netease', label: '网易云' },
    { id: 'bilibili', label: 'B站' },
    { id: 'tencent', label: 'QQ' },
    { id: 'kugou', label: '酷狗' }
  ];
  var searchServer = 'netease';
  var searchScope = 'song';   // 'song' 搜歌曲 / 'artist' 搜歌手（后台同一关键词接口）
  var searchResults = [];
  var searchBusy = false;
  var searchSeq = 0;   // 代次：连打两次搜索，旧响应不许覆盖新结果
  var SEARCH_PAGE = 30;         // 每页条数（前后端同口径；后端默认也是 30）
  var searchKeyword = '';       // 本次搜索的关键词（翻页沿用，避免翻到一半改了输入框）
  var searchTotal = 0;          // 结果总数（后端 total；缺失/0 时退化为已载入条数）
  var searchLoadingMore = false; // 翻页在途闸：滚动事件很密，防重复触发
  var searchScrollBound = false; // 无限滚动监听只绑一次
  var searchPaginated = false;   // 当前结果区是否属于「搜索层」（可翻页）。详情层（榜单/电台）为 false
  var discoverLoaded = false;   // 推荐区是否已拉过
  var hotSongs = [];            // 热门推荐（歌曲）
  var discoverCharts = [];      // 榜单
  var discoverSheets = [];      // 推荐歌单
  var discoverRadios = [];      // 热门电台
  /* B站分P（多 P 视频的展开）：
   *  · 搜索结果里**没有**分P数，只能查 pagelist 才知道「这条有几个 P」与每 P 的标题，
   *    所以分集标记是一道二段式的：先探测（长视频才探）、再按需拉列表。
   *  · probe   bvid -> 分P数（>1 才挂分集入口；-1 = 探测在途）。只有「时长≥10min」的行参与探测。
   *  · open    bvid -> true（该行展开中）。按 bvid 而非行索引，重渲染不丢状态。
   *  · cache   bvid -> [{...}] | 'loading'（点开时拉，拉过就复用）。
   *  · probesLeft 本轮搜索还能探测多少条（不预取整页 30 条）。
   */
  var BILI_PART_MIN_DUR = 600;   // 秒：≥ 10 分钟才当疑似合集去探分P（正常单曲 3-5 min 摸不到）
  var BILI_PROBE_MAX = 10;       // 一轮搜索最多探这么多条
  var biliProbe = {};
  var biliOpen = {};
  var biliPartsCache = {};
  var biliProbesLeft = 0;
  var searchPage = $('searchPage');
  var searchList = $('searchList');
  var searchNoteEl = $('searchNote');
  var searchInput = $('searchInput');
  var searchServersEl = $('searchServers');
  var searchScopeEl = $('searchScope');
  var searchSectionEl = $('searchSection');
  var searchDiscoverEl = $('searchDiscover');
  var hotListEl = $('hotList');
  var chartsGridEl = $('chartsGrid');
  var radiosGridEl = $('radiosGrid');

  function setSearchNote(msg) { if (searchNoteEl) searchNoteEl.textContent = msg || ''; }
  function setSearchSection(msg) {
    if (!searchSectionEl) return;
    if (msg) { searchSectionEl.textContent = msg; searchSectionEl.hidden = false; }
    else { searchSectionEl.textContent = ''; searchSectionEl.hidden = true; }
  }
  function renderSearchScope() {
    if (!searchScopeEl) return;
    var btns = searchScopeEl.querySelectorAll('.search-scope-btn');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-scope') === searchScope;
      btns[i].classList.toggle('is-active', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function serverLabel(id) {
    for (var i = 0; i < SEARCH_SERVERS.length; i++) if (SEARCH_SERVERS[i].id === id) return SEARCH_SERVERS[i].label;
    return id;
  }

  /* 平台条的溢出提示：卡片里它横滑（滚动条藏了），两侧按需渐隐 —— 照歌单切换条那套。
   * 宽窗不溢出 → 两个类都不加，mask 退化成全不透明（不生效）。 */
  function updateServerFade() {
    if (!searchServersEl) return;
    var max = searchServersEl.scrollWidth - searchServersEl.clientWidth;
    var over = max > 1;
    searchServersEl.classList.toggle('is-scroll-l', over && searchServersEl.scrollLeft > 1);
    searchServersEl.classList.toggle('is-scroll-r', over && searchServersEl.scrollLeft < max - 1);
  }
  function renderSearchServers() {
    if (!searchServersEl) return;
    var html = '';
    for (var i = 0; i < SEARCH_SERVERS.length; i++) {
      var s = SEARCH_SERVERS[i];
      html += '<button class="search-server' + (s.id === searchServer ? ' is-active' : '') + '" id="searchServer_' + esc(s.id) + '" type="button"' +
        ' data-server="' + esc(s.id) + '" aria-pressed="' + (s.id === searchServer ? 'true' : 'false') + '">' +
        esc(s.label) + '</button>';
    }
    searchServersEl.innerHTML = html;
    updateServerFade();   // 重渲染后溢出情况可能变了（比如刚开页时量不到）
  }

  /* ── B站分P：探测 / 拉列表 / 展开 ────────────────────────
   * 搜索结果没有分P字段，所以「这行是不是合集」要先探一次 pagelist。
   * 探测只对**时长达标**的 B站行做（正常单曲摸不到阈值），且一轮搜索有上限；
   * 拉到的条数缓存起来，重渲染不重复请求。 */
  function isBiliTrack(r) {
    var id = String((r && (r.id || r.url)) || '');
    return /^bilibili:/.test(id) || /[?&]server=bilibili/.test(String((r && r.url) || ''));
  }
  function biliBvid(r) {
    var id = String((r && r.id) || '').replace(/^bilibili:/, '').split('_')[0];
    if (id) return id;
    var m = /\/music\/go\/([A-Za-z0-9]+)/.exec(String((r && r.url) || ''));
    return m ? m[1] : '';
  }

  /* 分P继承主行封面：pagelist 不返回图，同一支视频共一张封面，所以把主行的 pic 盖到每个分P上。
   * 子行缩略图与「播该P时的舞台封面」都吃这张图（playSearchHit → track.pic → applyCovers）。 */
  function stampPartsPic(list, pic) {
    var p = String(pic || '').trim();
    if (!p || !Array.isArray(list)) return list;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && !String(list[i].pic || '').trim()) list[i].pic = p;
    }
    return list;
  }

  /* 探测一批结果里哪些是多 P（每行各自独立，不阻塞渲染）。只在「本轮还剩额度」时发起。 */
  function probeBiliParts(list) {
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!isBiliTrack(r)) continue;
      if (!(Number(r.dur) >= BILI_PART_MIN_DUR)) continue;   // 短片不值得探
      var bv = biliBvid(r);
      if (!bv || biliProbe[bv] !== undefined) continue;       // 已探过 / 在途
      if (biliProbesLeft <= 0) break;                         // 本轮额度用完
      biliProbesLeft--;
      biliProbe[bv] = -1;
      (function (bvid, pic) {
        apiGetJson(ENDPOINT.biliParts + '?bvid=' + encodeURIComponent(bvid)).then(function (res) {
          var n = (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) ? res.body.results.length : 0;
          biliProbe[bvid] = n;
          if (res.ok && res.body && res.body.ok) biliPartsCache[bvid] = stampPartsPic(res.body.results, pic);   // 缓存，点开不再请求
          renderSearchResults();
        }).catch(function () {
          biliProbe[bvid] = 0;
          renderSearchResults();
        });
      })(bv, r.pic);
    }
  }

  /* 点开/收起某行的分集树。列表没拉过就先拉（探测已缓存则直接用）。 */
  function toggleBiliParts(r) {
    var bv = biliBvid(r);
    if (!bv) return;
    if (biliOpen[bv]) { delete biliOpen[bv]; renderSearchResults(); return; }
    biliOpen[bv] = true;
    if (Array.isArray(biliPartsCache[bv])) { renderSearchResults(); return; }
    biliPartsCache[bv] = 'loading';
    renderSearchResults();
    var pic = r && r.pic;
    apiGetJson(ENDPOINT.biliParts + '?bvid=' + encodeURIComponent(bv)).then(function (res) {
      var list2 = (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) ? res.body.results : [];
      biliPartsCache[bv] = stampPartsPic(list2, pic);
      if (list2.length) biliProbe[bv] = list2.length;
      renderSearchResults();
    }).catch(function () {
      biliPartsCache[bv] = [];
      renderSearchResults();
    });
  }

  /* 分集行尾红心：单曲进「我的喜欢」（与主行红心同一套语义）。
   * 分P曲目尚未入库（搜索结果只是列表），所以借 addTrackToTarget 落 fav；
   * 已在 fav 则走 removeFav（与原行红心 toggleSearchFav 一致）。 */
  function togglePartFav(part) {
    if (!part) return;
    var id = deriveId(part, part.url);
    if (isFav(id)) { removeFav(id); toast('已取消喜欢'); }
    else { addTrackToTarget(part); }
    renderQueue(); renderTrack();
    renderSearchResults();
  }

  /* 把某条视频的全部分集导入成一个新歌单（imp:N）——长合集本该可整体管理，
   * 不塞「我的喜欢」（134 首混进收藏夹很难收拾）。走 mergeTracks 同一条路。 */
  function importBiliParts(r) {
    var bv = biliBvid(r);
    var parts = biliPartsCache[bv];
    if (!Array.isArray(parts) || !parts.length) { toast('分集还没拉到，稍后再试'); return; }
    var nameRaw = String(r.title || 'B站合集').trim() || 'B站合集';
    var id = nextImportId();
    state.lists.push({ id: id, name: nameRaw });
    saveLists();
    var items = parts.map(function (p) {
      var o = Object.assign({}, p);
      o.list = id;
      o.mode = '在线';
      o.group = '在线音乐';
      if (!o.title && o.page) o.title = 'P' + o.page;
      return o;
    });
    var added = mergeTracks(items, id);
    state.activeList = id;
    savePlaylist();
    renderAll();
    toast('已导入「' + nameRaw + '」共 ' + added + ' 首');
  }

  /* 把某条视频的全部分集加入「我的喜欢」 */
  function favAllBiliParts(r) {
    var bv = biliBvid(r);
    var parts = biliPartsCache[bv];
    if (!Array.isArray(parts) || !parts.length) { toast('分集还没拉到，稍后再试'); return; }
    ensureList('fav', '我的喜欢');
    var n = 0;
    for (var i = 0; i < parts.length; i++) {
      if (!isFav(deriveId(parts[i], parts[i].url))) n += addTrackToTarget(parts[i]) ? 1 : 0;
    }
    renderQueue(); renderTrack();
    renderSearchResults();
    if (!n) toast('这些分集都已在「我的喜欢」里');
  }

  /* 分集子面板（展开时嵌在主行下方的那块树）。 */
  function renderPartsTree(r, idx) {
    var bv = biliBvid(r);
    var parts = biliPartsCache[bv];
    var h = '';
    if (parts === 'loading' || parts === undefined) {
      return '<div class="bili-tree"><div class="bili-subtools"><span class="bili-count">正在拉取分集…</span></div></div>';
    }
    if (!Array.isArray(parts) || !parts.length) {
      return '<div class="bili-tree"><div class="bili-subtools"><span class="bili-count">分集拉取失败</span></div></div>';
    }
    h += '<div class="bili-tree"><div class="bili-subtools">'
      + '<button class="bili-tbtn primary" type="button" data-bili-all="' + idx + '">全部加入我的喜欢</button>'
      + '<button class="bili-tbtn" type="button" data-bili-imp="' + idx + '">导入成歌单</button>'
      + '<span class="bili-count">共 ' + parts.length + ' 集</span>'
      + '</div><ol class="bili-plist">';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var pid = deriveId(p, p.url);
      var on = isFav(pid);
      var thumb = String(p.pic || '').trim();
      var thumbStyle = thumb
        ? ' style="--cover-image:url(&quot;' + esc(withSession(thumb)).replace(/"/g, '') + '&quot;);--cover-fallback:none"'
        : '';
      h += '<li class="bili-prow">'
        + '<button class="bili-phit" type="button" data-bili-p="' + i + '" data-bili-row="' + idx + '" title="' + esc(String(p.title || '')) + '">'
          + '<span class="q-cover bili-pcover"' + thumbStyle + '></span>'
          + '<span class="bili-pidx">P' + esc(String(p.page || (i + 1))) + '</span>'
          + '<span class="bili-pname">' + esc(String(p.title || ('P' + (i + 1)))) + '</span>'
          + '<span class="bili-pdur">' + (Number(p.dur) > 0 ? fmtTime(p.dur) : '--:--') + '</span>'
        + '</button>'
        + '<button class="search-fav' + (on ? ' is-on' : '') + '" type="button" data-bili-fav="' + i + '" data-bili-row="' + idx + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + (on ? '取消喜欢' : '加入我的喜欢') + '" title="' + (on ? '取消喜欢' : '加入我的喜欢') + '">' + icon('i-heart', 'icon-sm') + '</button>'
        + '</li>';
    }
    h += '</ol></div>';
    return h;
  }

  /* 是否为搜索层里的一条普通结果：推荐区不做分P展开，保持轻。 */
  function showPartsFor(r, i) {
    if (!searchPaginated) return false;   // 详情层（榜单/电台）不展开分P
    if (!isBiliTrack(r)) return false;
    var n = biliProbe[biliBvid(r)];
    return n === -1 || n > 1;             // 在途或确为多 P 才挂入口
  }

  /* 该行是否已是「确实多P」（已探到 >1）—— 点击分流用它。
   * 探测在途（-1）或 1 集时不接管点击，避免还没探完就把播放点了。 */
  function isMultiPartRow(r, i) {
    if (!showPartsFor(r, i)) return false;
    return Number(biliProbe[biliBvid(r)]) > 1;
  }

  /* 搜索结果行：封面 + 标题/歌手 + 行尾红心（收藏到我的喜欢）。
   * B站多 P 视频在标题后挂一枚「分集 N」，点开在行下长出分集树（不跳页）。 */
  function renderSearchResults() {
    if (!searchList) return;
    if (!searchResults.length) {
      searchList.innerHTML = '<li class="search-empty">' +
        (searchBusy ? '正在搜索…' : '在上方输入歌名或歌手，回车开始搜索') + '</li>';
      return;
    }
    var html = '';
    for (var i = 0; i < searchResults.length; i++) {
      var r = searchResults[i];
      var title = String(r.title || r.name || '').trim() || '未命名';
      var author = String(r.author || '').trim();
      var favOn = isFav(deriveId(r, r.url));
      var bv = biliBvid(r);
      var showParts = showPartsFor(r, i);
      var open = !!biliOpen[bv];
      var pn = biliProbe[bv];
      var mark = '';
      if (showParts) {
        var cnt = pn > 1 ? String(pn) : '';
        /* 纯提示器：不可点、无按钮语言。展开靠点行主体/标题（见点击分流）。 */
        mark = '<span class="bili-mark">分集' + (cnt ? ' <span class="bili-n">' + cnt + '</span>' : '') + '</span>';
      }
      /* 有分P的行：标题行换成展开/收起（点击交给行主体分流），不播放；
       * 无分P：正常播放。aria-label 跟着变，给读屏一个真语义。 */
      var hint = showParts ? (open ? '收起分集：' : '展开分集：') + title : '播放 ' + title;
      html += '<li class="search-row' + (open ? ' is-open' : '') + (showParts ? ' has-parts' : '') + '" id="searchRow' + i + '" data-i="' + i + '">' +
        '<button class="search-hit" id="searchHit' + i + '" type="button" data-i="' + i + '" aria-label="' + esc(hint) + '">' +
          '<span class="q-cover"></span>' +
          '<span class="q-meta">' +
            '<span class="q-line1"><span class="q-title">' + esc(title) + '</span>' + mark + '</span>' +
            '<span class="q-artist">' + esc(author) + '</span>' +
          '</span>' +
        '</button>' +
        '<button class="search-fav' + (favOn ? ' is-on' : '') + '" id="searchFav' + i + '" type="button" data-i="' + i + '"' +
          ' aria-pressed="' + (favOn ? 'true' : 'false') + '" aria-label="' + (favOn ? '取消喜欢' : '加入我的喜欢') + '" title="' + (favOn ? '取消喜欢' : '加入我的喜欢') + '">' +
          icon('i-heart', 'icon-sm') +
        '</button>' +
        (showParts && open ? renderPartsTree(r, i) : '') +
      '</li>';
    }
    // 翻页尾巴：仅在「搜索层 + 还有下一页」时出现（详情层不挂，见 searchPaginated）
    if (searchPaginated && searchResults.length < searchTotal) {
      html += '<li class="search-more" id="searchMore">' +
        (searchLoadingMore ? '正在加载…' : '') + '</li>';
    }
    searchList.innerHTML = html;
    applySearchCovers();
  }

  /* 搜索结果封面：搜索结果里带 pic（封面地址），与队列同一套 cover 变量 */  function applySearchCovers() {
    if (!searchList) return;
    var rows = searchList.querySelectorAll('.search-row');
    for (var i = 0; i < rows.length; i++) {
      var idx = Number(rows[i].getAttribute('data-i'));
      var r = searchResults[idx];
      var cov = rows[i].querySelector('.q-cover');
      if (!cov || !r) continue;
      var pic = String(r.pic || '').trim();
      if (pic) {
        cov.style.setProperty('--cover-image', 'url("' + withSession(pic).replace(/"/g, '') + '")');
        cov.style.setProperty('--cover-fallback', 'none');
      } else {
        cov.style.removeProperty('--cover-image');
        cov.style.setProperty('--cover-fallback', 'var(--hk-surface)');
      }
    }
  }

  var searchLeaveTimer = 0;

  function openSearch() {
    if (!searchPage || !searchPage.hidden) return;   // 已开就不重复开
    clearTimeout(searchLeaveTimer); searchLeaveTimer = 0;
    player.classList.remove('is-s-leaving');
    searchPage.hidden = false;
    renderChrome();
    renderSearchServers();
    renderSearchScope();
    renderSearchResults();
    bindSearchScroll();   // 无限滚动：结果列表触底加载下一页（只绑一次）
    if (!String((searchInput && searchInput.value) || '').trim()) loadDiscover();   // 空白页预置推荐
    // 从左侧滑入（与队列抽屉同一套语言；reduced-motion 下退为淡入）
    searchPage.classList.remove('is-anim');
    void searchPage.offsetWidth;
    searchPage.classList.add('is-anim');
    clearTimeout(searchLeaveTimer);
    searchLeaveTimer = setTimeout(function () { searchPage.classList.remove('is-anim'); searchLeaveTimer = 0; }, 300);
    if (searchInput) setTimeout(function () { try { searchInput.focus(); } catch (e) {} }, 30);
  }
  function closeSearch() {
    if (!searchPage || searchPage.hidden) return;
    clearTimeout(searchLeaveTimer); searchLeaveTimer = 0;
    searchLoadingMore = false;   // 关页时若正翻页，别把「正在加载…」尾巴留到下次重开
    searchPage.classList.remove('is-anim');
    player.classList.add('is-s-leaving');
    renderChrome();                                   // data-search 立即转 0
    searchLeaveTimer = setTimeout(function () {
      player.classList.remove('is-s-leaving');
      searchPage.hidden = true;
      searchLeaveTimer = 0;
    }, 290);
  }
  function toggleSearch() {
    if (searchPage && !searchPage.hidden) closeSearch(); else openSearch();
  }

  /* 点歌手名：以这位歌手为关键词直接搜歌手 —— 关键词预填、范围切「搜歌手」、立刻出结果。
   * 搜索页在三种布局都能开：入口不必占控制条空间，舞台上的歌手名就是入口。 */
  function openArtistSearch(name) {
    name = String(name || '').trim();
    if (!name) return;
    if (searchInput) searchInput.value = name;
    if (searchPage && searchPage.hidden) openSearch();   // 关键词已填 → openSearch 不再拉推荐区
    searchScope = 'artist';
    renderSearchScope();
    doSearch();
  }

  /* 搜索页内的「返回」：按层级退 —— 详情层（搜索结果/榜单/电台）→ 推荐区根层 →
   * 再按才退出搜索（罐头拍板）。左下角入口按钮不跑这套，直接 toggle 退出。 */
  function searchGoBack() {
    if (!searchPage || searchPage.hidden) return;
    if (!discoverActive()) { clearSearch(); return; }   // 详情 → 回推荐区
    closeSearch();                                       // 根层 → 退出搜索
  }

  /* 推荐区显示/隐藏：未搜索时显示推荐区、隐藏结果表；搜索时相反。
   * 两者共用同一个滚动容器高度（.search-discover 与 .search-list 都 flex:1，
   * 同时只显示一个，布局不跳）。 */
  function setDiscoverVisible(on) {
    if (searchDiscoverEl) searchDiscoverEl.hidden = !on;
    if (searchList) searchList.hidden = on;
    if (searchSectionEl && on) setSearchSection('');
    // 「返回」标签随层级变：详情层「返回」，根层「收起」
    var bb = $('searchBackBtn');
    if (bb) {
      var lbl = bb.querySelector('span');
      if (lbl) lbl.textContent = on ? '收起' : '返回';
      bb.setAttribute('aria-label', on ? '收起搜索' : '返回上一页');
    }
  }
  function discoverActive() {
    return !!(searchDiscoverEl && !searchDiscoverEl.hidden);
  }

  /* 推荐区：热门歌曲 + 榜单/歌单 + 热门电台，三块各自并行拉（拉不到就空着）。
   * 只在搜索页空白时拉一次，后续缓存。 */
  function loadDiscover() {
    setDiscoverVisible(true);
    if (discoverLoaded) { setSearchNote(''); return; }
    discoverLoaded = true;
    if (hotListEl) hotListEl.innerHTML = '<li class="discover-loading">加载中…</li>';
    if (chartsGridEl) chartsGridEl.innerHTML = '<p class="discover-loading">加载中…</p>';
    if (radiosGridEl) radiosGridEl.innerHTML = '<p class="discover-loading">加载中…</p>';

    apiGetJson(ENDPOINT.hot + '?limit=6').then(function (res) {
      hotSongs = (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) ? res.body.results : [];
      renderHotSongs();
    }).catch(function () { hotSongs = []; renderHotSongs(); });

    apiGetJson(ENDPOINT.charts + '?limit=8').then(function (res) {
      var b = (res.ok && res.body) || {};
      discoverCharts = b.charts || [];
      discoverSheets = b.sheets || [];
      renderCharts();
    }).catch(function () { discoverCharts = []; discoverSheets = []; renderCharts(); });

    apiGetJson(ENDPOINT.radios + '?limit=8').then(function (res) {
      discoverRadios = (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) ? res.body.results : [];
      renderRadios();
    }).catch(function () { discoverRadios = []; renderRadios(); });
  }

  function coverVars(el, pic) {
    if (!el) return;
    pic = String(pic || '').trim();
    if (pic) {
      el.style.setProperty('--cover-image', 'url("' + withSession(pic).replace(/"/g, '') + '")');
      el.style.setProperty('--cover-fallback', 'none');
    } else {
      el.style.removeProperty('--cover-image');
      el.style.setProperty('--cover-fallback', 'var(--hk-surface)');
    }
  }

  var HOT_MAX = 6;   // 热门歌曲只显前 6 条：多了会把下面「榜单/电台」顶出屏（真机反馈）

  /* 热门歌曲：复用搜索结果行的样子（行尾红心） */
  function renderHotSongs() {
    if (!hotListEl) return;
    if (!hotSongs.length) {
      hotListEl.innerHTML = '<li class="discover-loading">（推荐暂时拉不到）</li>';
      return;
    }
    var html = '';
    var n = Math.min(hotSongs.length, HOT_MAX);
    for (var i = 0; i < n; i++) {
      var r = hotSongs[i];
      var favOn = isFav(deriveId(r, r.url));
      html += '<li class="search-row" id="hotRow' + i + '" data-hot="' + i + '">' +
        '<button class="search-hit" id="hotHit' + i + '" type="button" data-hot="' + i + '" aria-label="播放 ' + esc(String(r.title || '').trim()) + '">' +
          '<span class="q-cover"></span>' +
          '<span class="q-meta"><span class="q-title">' + esc(String(r.title || '').trim()) + '</span>' +
          '<span class="q-artist">' + esc(String(r.author || '').trim()) + '</span></span>' +
        '</button>' +
        '<button class="search-fav' + (favOn ? ' is-on' : '') + '" id="hotFav' + i + '" type="button" data-hot="' + i + '"' +
          ' aria-pressed="' + (favOn ? 'true' : 'false') + '" aria-label="' + (favOn ? '取消喜欢' : '加入我的喜欢') + '" title="' + (favOn ? '取消喜欢' : '加入我的喜欢') + '">' +
          icon('i-heart', 'icon-sm') +
        '</button></li>';
    }
    hotListEl.innerHTML = html;
    var rows = hotListEl.querySelectorAll('.search-row');
    for (var j = 0; j < rows.length; j++) {
      coverVars(rows[j].querySelector('.q-cover'), hotSongs[Number(rows[j].getAttribute('data-hot'))].pic);
    }
  }

  /* 榜单 / 推荐歌单：横向卡片，点一张拉它的前 N 首进结果区 */
  function renderCharts() {
    if (!chartsGridEl) return;
    var items = discoverCharts.map(function (x) { return Object.assign({}, x, { _kind: 'chart' }); })
      .concat(discoverSheets.map(function (x) { return Object.assign({}, x, { _kind: 'sheet' }); }));
    if (!items.length) { chartsGridEl.innerHTML = '<p class="discover-loading">（榜单暂时拉不到）</p>'; return; }
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      html += '<button class="discover-card" id="chartCard' + i + '" type="button" data-kind="' + c._kind + '" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">' +
        '<span class="discover-card-cover"></span>' +
        '<span class="discover-card-name">' + esc(c.name) + '</span>' +
        (c.note ? '<span class="discover-card-note">' + esc(c.note) + '</span>' : '') +
      '</button>';
    }
    chartsGridEl.innerHTML = html;
    var cards = chartsGridEl.querySelectorAll('.discover-card');
    for (var j = 0; j < cards.length; j++) {
      coverVars(cards[j].querySelector('.discover-card-cover'), c_picAt(items, cards[j].getAttribute('data-id')));
    }
  }
  function c_picAt(items, id) {
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i].pic;
    return '';
  }

  /* 热门电台：横向卡片，点一张拉它的节目（每期是可播长音频） */
  function renderRadios() {
    if (!radiosGridEl) return;
    if (!discoverRadios.length) { radiosGridEl.innerHTML = '<p class="discover-loading">（电台暂时拉不到）</p>'; return; }
    var html = '';
    for (var i = 0; i < discoverRadios.length; i++) {
      var r = discoverRadios[i];
      html += '<button class="discover-card" id="radioCard' + i + '" type="button" data-radio="' + esc(r.id) + '" data-name="' + esc(r.name) + '">' +
        '<span class="discover-card-cover"></span>' +
        '<span class="discover-card-name">' + esc(r.name) + '</span>' +
        '<span class="discover-card-note">' + esc(r.category || '') + (r.programCount ? ' · ' + r.programCount + ' 期' : '') + '</span>' +
      '</button>';
    }
    radiosGridEl.innerHTML = html;
    var cards = radiosGridEl.querySelectorAll('.discover-card');
    for (var j = 0; j < cards.length; j++) {
      var rid = cards[j].getAttribute('data-radio');
      var pic = ''; for (var k = 0; k < discoverRadios.length; k++) if (String(discoverRadios[k].id) === rid) pic = discoverRadios[k].pic;
      coverVars(cards[j].querySelector('.discover-card-cover'), pic);
    }
  }

  /* 点开一张榜单/歌单 → 拉前 N 首，改由结果列表展示（可逐首播放/收藏） */
  function openChart(id, name) {
    if (!id) return;
    setDiscoverVisible(false);
    setSearchSection(name || '榜单');
    searchBusy = true;
    searchPaginated = false;   // 详情层不翻页（罐头拍板：只有搜索层挂翻页）
    searchTotal = 0;
    var gen = ++searchSeq;
    searchResults = [];
    renderSearchResults();
    setSearchNote('正在拉取曲目…');
    apiGetJson(ENDPOINT.chartTracks + '?id=' + encodeURIComponent(id) + '&n=30').then(function (res) {
      if (gen !== searchSeq) return;
      searchBusy = false;
      var list = (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) ? res.body.results : [];
      searchResults = list;
      searchTotal = list.length;
      renderSearchResults();
      setSearchNote(list.length ? ('共 ' + list.length + ' 首') : '这个榜单暂时取不到曲目');
    }).catch(function () {
      if (gen !== searchSeq) return;
      searchBusy = false;
      searchResults = [];
      renderSearchResults();
      setSearchNote('拉取失败：网络错误');
    });
  }

  /* 点开一档电台 → 拉它的节目（每期是个可播长音频） */
  function openRadio(id, name) {
    if (!id) return;
    setDiscoverVisible(false);
    setSearchSection(name || '电台');
    searchBusy = true;
    searchPaginated = false;   // 详情层不翻页
    searchTotal = 0;
    var gen = ++searchSeq;
    searchResults = [];
    renderSearchResults();
    setSearchNote('正在拉取节目…');
    apiGetJson(ENDPOINT.radioPrograms + '?radioId=' + encodeURIComponent(id) + '&limit=30').then(function (res) {
      if (gen !== searchSeq) return;
      searchBusy = false;
      var list = (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) ? res.body.results : [];
      searchResults = list;
      searchTotal = list.length;
      renderSearchResults();
      setSearchNote(list.length ? ('共 ' + list.length + ' 期（每期是可播的长音频）') : '这档电台暂时取不到节目');
    }).catch(function () {
      if (gen !== searchSeq) return;
      searchBusy = false;
      searchResults = [];
      renderSearchResults();
      setSearchNote('拉取失败：网络错误');
    });
  }

  /* 一次搜索请求（首屏 / 翻页共用）。带代次守卫：在途时改了关键词，旧响应自动丢弃。
   * offset/limit 是可选的请求参数（后端缺省即第一页）；返回体形状与不分页时一致，只是 total 现在有意义。 */
  function fetchSearchPage(gen, kw, server, offset, onDone, onFail) {
    apiGetJson(ENDPOINT.search + '?keyword=' + encodeURIComponent(kw) + '&server=' + encodeURIComponent(server) +
        '&offset=' + offset + '&limit=' + SEARCH_PAGE)
      .then(function (res) {
        if (gen !== searchSeq) return;
        var list = (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) ? res.body.results : [];
        var total = Number(res.body && res.body.total);
        onDone(list, total > 0 ? total : 0);
      })
      .catch(function () { if (gen !== searchSeq) return; onFail(); });
  }

  function doSearch() {
    if (searchBusy) return;
    var kw = searchInput ? String(searchInput.value || '').trim() : '';
    if (!kw) { setSearchNote('先输入关键词'); return; }
    searchBusy = true;
    var gen = ++searchSeq;
    biliProbe = {}; biliOpen = {}; biliPartsCache = {}; biliProbesLeft = BILI_PROBE_MAX;   // 新搜索：重置分P探测
    searchKeyword = kw;          // 翻页沿用这次的关键词（中途改输入框不影响在途翻页）
    searchPaginated = true;      // 搜索层可翻页（详情层不置这面旗）
    searchLoadingMore = false;
    searchTotal = 0;
    if (searchList) searchList.scrollTop = 0;
    setDiscoverVisible(false);
    setSearchSection(searchScope === 'artist' ? '歌手结果' : '歌曲结果');
    setSearchNote('正在搜索…');
    searchResults = [];
    renderSearchResults();
    fetchSearchPage(gen, kw, searchServer, 0, function (list, total) {
      searchBusy = false;
      // total 缺失/为 0（如老响应）→ 退化为本页条数，不报假数也不拦死翻页
      searchTotal = total > 0 ? total : list.length;
      if (!list.length) {
        searchResults = [];
        renderSearchResults();
        setSearchNote('没搜到「' + kw + '」，换个关键词或平台试试');
        return;
      }
      searchResults = list;
      renderSearchResults();
      probeBiliParts(list);   // 探测本页哪些是 B站多P合集（长视频才探，有额度上限）
      setSearchNote('共 ' + searchTotal + ' 条 · 来自' + serverLabel(searchServer));
    }, function () {
      searchBusy = false;
      searchResults = [];
      renderSearchResults();
      setSearchNote('搜索失败：网络错误');
    });
  }

  /* 触底加载下一页（无限滚动）。
   * 三重护栏：仅搜索层、非在途、未到 total。
   * 代次沿用当前 searchSeq（不新开）：同一关键词的下一页，中途发新搜索会自动作废旧页。 */
  function loadMoreSearch() {
    if (!searchPaginated || searchBusy || searchLoadingMore) return;
    if (!searchKeyword) return;
    if (searchResults.length >= searchTotal) return;   // 已到 total，没有下一页
    searchLoadingMore = true;
    var gen = searchSeq;
    var offset = searchResults.length;
    var kw = searchKeyword, server = searchServer;
    renderSearchResults();   // 进入「正在加载…」尾巴
    fetchSearchPage(gen, kw, server, offset, function (list, total) {
      searchLoadingMore = false;
      // 追加去重：按稳定 id，防源在翻页边界重复回上一页末尾
      var seen = {};
      for (var i = 0; i < searchResults.length; i++) seen[deriveId(searchResults[i], searchResults[i].url)] = 1;
      var added = 0;
      for (var j = 0; j < list.length; j++) {
        var id = deriveId(list[j], list[j].url);
        if (!id || seen[id]) continue;
        seen[id] = 1;
        searchResults.push(list[j]);
        added++;
      }
      // 源到底（回空 / 全是重复，如 B站 1000 截顶）：把 total 收敛为已载入数，尾巴消失
      if (!list.length || !added) searchTotal = searchResults.length;
      else if (total > 0 && total > searchTotal) searchTotal = total;
      renderSearchResults();
      probeBiliParts(list);   // 追加页同样探一次
      setSearchNote('共 ' + searchTotal + ' 条 · 来自' + serverLabel(server));
    }, function () {
      searchLoadingMore = false;
      renderSearchResults();   // 失败就收起尾巴，下次滚动再试
    });
  }

  /* 无限滚动：结果列表触底 → 加载下一页。
   * 监听对象就 .search-list（它自己 overflow-y:auto，页身不滚 —— 所以触底判定用自己这层）。 */
  function onSearchListScroll() {
    if (!searchList || searchList.hidden || !searchPaginated) return;
    if (searchList.scrollTop + searchList.clientHeight >= searchList.scrollHeight - 120) loadMoreSearch();
  }
  function bindSearchScroll() {
    if (searchScrollBound || !searchList) return;
    searchScrollBound = true;
    searchList.addEventListener('scroll', onSearchListScroll, { passive: true });
  }

  /* 清空搜索：回到推荐区 */
  function clearSearch() {
    if (searchInput) searchInput.value = '';
    searchSeq++;
    searchBusy = false;
    searchLoadingMore = false;
    searchPaginated = false;
    searchTotal = 0;
    searchKeyword = '';
    searchResults = [];
    biliProbe = {}; biliOpen = {}; biliPartsCache = {}; biliProbesLeft = 0;   // 清空搜索：分P状态一并清
    renderSearchResults();
    setSearchSection('');
    loadDiscover();
  }

  /* 搜索结果 / 推荐区的行尾红心 = 收藏，落到「我的喜欢」（与红心同一心智）。
   * 之前错把导入的规矩（落当前歌单 / 新建隐形「搜索」歌单）套到搜索上，
   * 而开卡默认就在「我的喜欢」，导致收藏后人在原处、看不到 —— 罐头拍板修正。 */
  function searchTargetList() {
    return 'fav';
  }

  /* 把一条曲目加进「我的喜欢」（搜索结果、热门、榜单、电台共用同一落库路径）。
   * 与红心一致：按稳定 id 去重，已在则不再加。 */
  function addTrackToTarget(r) {
    if (!r) return false;
    ensureList('fav', '我的喜欢');
    var id = deriveId(r, r.url);
    var target = searchTargetList();
    var already = false;
    for (var j = 0; j < state.tracks.length; j++) {
      if (state.tracks[j].id === id && state.tracks[j].list === target) { already = true; break; }
    }
    if (already) {
      toast('「我的喜欢」里已有这首');
      return false;
    }
    mergeTracks([r], target);
    savePlaylist();
    renderQueue();
    renderTrack();   // 若正播这首，播放页/控制条的红心跟着点亮
    toast('已加入「我的喜欢」：' + (r.title || r.name || ''));
    return true;
  }

  /* 搜索 / 热门行尾红心：加入 = 收藏到「我的喜欢」，与队列行红心同一套心智。
   * 搜索结果不一定已在库里，所以「加」借 addTrackToTarget（按稳定 id 落 fav），
   * 「取消」走 removeFav。点行主体只播放，不落喜欢（罐头拍板：播放 ≠ 喜欢）。 */
  function toggleSearchFav(r) {
    if (!r) return;
    var id = deriveId(r, r.url);
    if (isFav(id)) {
      removeFav(id);
      renderQueue(); renderTrack();
      toast('已取消喜欢');
    } else {
      addTrackToTarget(r);   // 自带 toast「已加入我的喜欢」
    }
    renderSearchResults();
    renderHotSongs();
  }

  /* 点搜索结果/热门行 = 直接播（不需先加入）。
   * 播完自动进「最近播放」（由 playTrack 里的 recordRecent 负责），
   * 所以不建永久列表也能在队列里看到它。 */
  function playSearchHit(r) {
    if (!r || !r.url) { toast('这首暂无播放地址'); return; }
    ensureList('recent', '最近播放');
    var target = 'recent';
    var id = deriveId(r, r.url);
    // 若已在某处（含刚刚播过的副本），直接播那一份（保 uid 稳定）
    var found = null;
    for (var i = 0; i < state.tracks.length; i++) {
      if (state.tracks[i].id === id) { found = state.tracks[i]; break; }
    }
    if (!found) {
      var stored = Object.assign({}, r);
      stored.list = target;
      var nt = normalizeTrack(stored);
      state.tracks.push(nt);
      found = nt;
    }
    // 不切激活列表（不打断搜索上下文）；播放本身会由 recordRecent 把它记进最近播放
    playTrack(found.uid);
    renderSearchResults();
  }

  if ($('searchEntryBtn')) $('searchEntryBtn').addEventListener('click', toggleSearch);

  /* 无词入口 + 手动匹配面板（罐头拍板：单入口、有词不打扰） */
  if ($('lyricAskBtn')) $('lyricAskBtn').addEventListener('click', openLyricMatch);
  if ($('lmCancelBtn')) $('lmCancelBtn').addEventListener('click', closeLyricMatch);
  if ($('lmResetBtn')) $('lmResetBtn').addEventListener('click', resetLyricMatch);
  if ($('lyricMatchPop')) {
    // 点遮罩处关闭（点卡内不关）
    $('lyricMatchPop').addEventListener('click', function (e) {
      if (e.target === $('lyricMatchPop')) closeLyricMatch();
    });
  }
  ['lmSong', 'lmArtist'].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitLyricMatch(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeLyricMatch(); }
    });
  });
  /* 舞台歌手名 = 通用搜索入口（搜索页不依赖宽窗，只是入口按钮只在独立窗） */
  if ($('trackArtist')) $('trackArtist').addEventListener('click', function () {
    var n = $('trackArtistName');
    openArtistSearch(n ? n.textContent : '');
  });
  if ($('searchBackBtn')) $('searchBackBtn').addEventListener('click', searchGoBack);
  if ($('searchGoBtn')) $('searchGoBtn').addEventListener('click', doSearch);
  if (searchInput) {
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
      else if (e.key === 'Escape') { e.preventDefault(); clearSearch(); }
    });
  }
  if (searchScopeEl) {
    searchScopeEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.search-scope-btn');
      if (!btn) return;
      var sc = btn.getAttribute('data-scope');
      if (!sc || sc === searchScope) return;
      searchScope = sc;
      renderSearchScope();
      if (searchInput) searchInput.placeholder = sc === 'artist' ? '搜歌手名' : '搜歌名 / 歌手';
      if (searchInput && String(searchInput.value || '').trim()) doSearch();   // 换范围自动重搜
      else clearSearch();   // 无关键词 → 回推荐区（搜索服务不适用，重新展示）
    });
  }
  if (searchServersEl) {
    // 溢出提示：滚动位置一变就重算两侧渐隐；宿主改宽（ResizeObserver）也要跟着重算。
    // 竖滚轮 → 横滚：滚动条藏了，鼠标用户否则没法滚（触控板/触摸本来就能横滑）。
    searchServersEl.addEventListener('scroll', updateServerFade, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(updateServerFade).observe(searchServersEl);
    searchServersEl.addEventListener('wheel', function (e) {
      if (searchServersEl.scrollWidth - searchServersEl.clientWidth <= 1) return;
      var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      searchServersEl.scrollLeft += d;
    }, { passive: false });
    searchServersEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.search-server');
      if (!btn) return;
      var id = btn.getAttribute('data-server');
      if (!id || id === searchServer) return;
      searchServer = id;
      renderSearchServers();
      if (searchInput && String(searchInput.value || '').trim()) doSearch();   // 换平台自动重搜
    });
  }
  if (searchList) {
    searchList.addEventListener('click', function (e) {
      /* 分集面板内的交互先于通用分支 */
      var all = e.target.closest('[data-bili-all]');
      if (all) { favAllBiliParts(searchResults[Number(all.getAttribute('data-bili-all'))] || null); return; }
      var imp = e.target.closest('[data-bili-imp]');
      if (imp) { importBiliParts(searchResults[Number(imp.getAttribute('data-bili-imp'))]); return; }
      var partHit = e.target.closest('.bili-phit');
      if (partHit) {
        var row = searchResults[Number(partHit.getAttribute('data-bili-row'))];
        var plist = row ? biliPartsCache[biliBvid(row)] : null;
        if (Array.isArray(plist)) playSearchHit(plist[Number(partHit.getAttribute('data-bili-p'))]);
        return;
      }
      var partFav = e.target.closest('.search-fav[data-bili-fav]');
      if (partFav) {
        var row2 = searchResults[Number(partFav.getAttribute('data-bili-row'))];
        var plist2 = row2 ? biliPartsCache[biliBvid(row2)] : null;
        if (Array.isArray(plist2)) togglePartFav(plist2[Number(partFav.getAttribute('data-bili-fav'))]);
        return;
      }
      var play = e.target.closest('.search-hit');
      if (play) {
        var pi = Number(play.getAttribute('data-i'));
        /* 多 P 行：点行/标题 = 展开·收起（不播放、不加入喜欢）；其余行 = 播放（不变） */
        if (isMultiPartRow(searchResults[pi], pi)) { toggleBiliParts(searchResults[pi]); return; }
        playSearchHit(searchResults[pi]); return;
      }
      var btn = e.target.closest('.search-fav');
      if (!btn) return;
      toggleSearchFav(searchResults[Number(btn.getAttribute('data-i'))]);
    });
  }
  /* 推荐区交互：热门歌曲逐首可播可加；榜单/歌单/电台卡片点开拉列表 */
  function bindDiscover() {
    if (hotListEl) {
      hotListEl.addEventListener('click', function (e) {
        var play = e.target.closest('.search-hit');
        if (play) { playSearchHit(hotSongs[Number(play.getAttribute('data-hot'))]); return; }
        var btn = e.target.closest('.search-fav');
        if (!btn) return;
        var i = Number(btn.getAttribute('data-hot'));
        if (hotSongs[i]) toggleSearchFav(hotSongs[i]);
      });
    }
    if (chartsGridEl) {
      chartsGridEl.addEventListener('click', function (e) {
        var card = e.target.closest('.discover-card');
        if (!card) return;
        openChart(card.getAttribute('data-id'), card.getAttribute('data-name'));
      });
    }
    if (radiosGridEl) {
      radiosGridEl.addEventListener('click', function (e) {
        var card = e.target.closest('.discover-card');
        if (!card) return;
        openRadio(card.getAttribute('data-radio'), card.getAttribute('data-name'));
      });
    }
  }
  bindDiscover();

  importPop.addEventListener('click', function (e) {
    var item = e.target.closest('[data-import]');
    if (item) {
      var kind = item.getAttribute('data-import');
      if (kind === 'file') importLocalFiles();
      else if (kind === 'folder') pickLocalFolder();
      else if (kind === 'backfill') backfillArtists();
      return;
    }
    if (e.target.closest('#linkAddBtn')) {
      importLink($('linkInput') ? $('linkInput').value : '');
    }
  });
  var linkInput = $('linkInput');
  if (linkInput) {
    linkInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); importLink(linkInput.value); }
    });
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.pop') || e.target.closest('.q-more') || e.target.closest('#importBtn')) return;
    closePops();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (lyricAlign && !lyricAlign.saving) { e.preventDefault(); closeLyricAlign(); return; }
    var lm = $('lyricMatchPop');
    if (lm && !lm.hidden) { closeLyricMatch(); return; }   // 手动匹配面板最上层
    if (volPopShown) { closeVolPop(); return; }   // 最瞬时的浮层先收
    if (searchPage && !searchPage.hidden) { searchGoBack(); return; }   // 分层退：详情→推荐区→退出
    if (!morePop.hidden || !importPop.hidden) { closePops(); return; }
    if (player.getAttribute('data-layout') === 'wide' && state.drawer) closeDrawer();
  });

  /* ============================================================
     布局：按容器尺寸切三种形态
     ============================================================ */
  /* ---------- 控制面连续换位（静听 · 连续布局）----------
   * 跨断点时，周边槽位（模式 / 音量 / 红心）从「当前可见位置」滑到新位置：
   * 先量旧矩形，提交新布局，再用 WAAPI 把差值反向位移回零。可打断 —— 新一轮
   * 直接取消上一轮动画、从当前视觉位置接上，不加等待锁。中央三键用百分比定位
   * 自然跟随宽度，全程 44×44 / 中心距 52，不做 scale/FLIP。 */
  function arrangeControls(nextForm, nextDensity) {
    var footer = $('controls');
    if (!footer) {
      player.setAttribute('data-layout', nextForm);
      player.setAttribute('data-ctl', nextDensity);
      return;
    }
    var movable = [$('modeBtn'), $('volGroup'), $('favBtn')];
    var fr = footer.getBoundingClientRect();
    var before = movable.map(function (el) {
      if (!el) return null;
      var b = el.getBoundingClientRect();
      return { x: b.left - fr.left, y: b.top - fr.top, w: b.width, h: b.height };
    });
    movable.forEach(function (el) {
      if (el && el._ctlFlip) { el._ctlFlip.cancel(); el._ctlFlip = null; }
    });
    player.setAttribute('data-layout', nextForm);
    player.setAttribute('data-ctl', nextDensity);
    if (reducedMotion() || SHOT) return;
    var afr = footer.getBoundingClientRect();
    movable.forEach(function (el, i) {
      var b0 = before[i];
      if (!el || !b0 || !b0.w) return;
      var b = el.getBoundingClientRect();
      var dx = b0.x - (b.left - afr.left);
      var dy = b0.y - (b.top - afr.top);
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      el._ctlFlip = el.animate(
        [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'translate(0,0)' }],
        { duration: 340, easing: 'cubic-bezier(.22,.61,.36,1)' }
      );
    });
  }

  var layout = 'long';
  var ctlForm = null, ctlDensity = null;
  function applyLayout() {
    var r = frame.getBoundingClientRect();
    var w = r.width;
    var h = r.height;
    var next = w >= 720 ? 'wide' : (h < 560 ? 'compact' : 'long');
    /* 窄容器（真机聊天卡实测 ~312px）控制条走紧凑排布（R6）：
     * 只收排布不藏控件，断言里 control-visible:* 仍然逐个校验。 */
    player.setAttribute('data-bar', w < 420 ? 'tight' : 'loose');
    /* 控制面自身的换行点（400）与全局 data-bar（420）分开 —— 后者还管舞台文字。 */
    var density = w < 400 ? 'narrow' : 'normal';
    var formChanged = next !== layout;
    var ctlChanged = formChanged || density !== ctlDensity;
    if (ctlChanged && ctlForm !== null) {
      arrangeControls(next, density);   // 量旧位置 → 提交新属性 → 位移回零
    } else if (ctlChanged) {
      player.setAttribute('data-layout', next);
      player.setAttribute('data-ctl', density);
    }
    if (ctlChanged) { ctlForm = next; ctlDensity = density; }
    if (formChanged) {
      layout = next;
      if (next !== 'wide') state.drawer = false;
      if (next !== 'compact') state.page = 'play';
      /* 搜索页不再因「离开宽窗」而强收：舞台上的歌手名是三种布局通用的入口，
       * 卡片里也开得了（宽窄只在头部排布上有别）。用户自己用「返回」退出。 */
      renderChrome();
      refreshEmptyHint();   // 空列表引导语里 ＋ 的方位随布局变（长卡下方 / 窄卡另一页 / 独立窗抽屉）
    }
    updateStageMetrics();
    sizeLyricPad();
    updateLyricIndex(true);
    if (lyricAlign) { measureAlignLines(); paintLyricAlign(); }
    positionSplitHandle();
  }
  if (window.ResizeObserver) {
    new ResizeObserver(applyLayout).observe(frame);
  } else {
    window.addEventListener('resize', applyLayout);
  }

  /* ---------- 舞台/队列 可拖分隔线（仅长卡，motion/布局）----------
   * 拖动改封面区/队列区比例，写 --stage-flex/--queue-flex；松手落盘（player-split）。
   * 只动 flex，不动 width/height；可打断（指针一抬就结束）。 */
  var SPLIT_KEY = 'player-split';
  var splitHandle = $('splitHandle');
  var stageEl = $('stage');
  function setSplit(ratio, persist) {
    var r = Math.max(0.25, Math.min(0.78, ratio));
    state.splitRatio = r;
    player.style.setProperty('--stage-flex', String(Math.round(r * 100)));
    player.style.setProperty('--queue-flex', String(Math.round((1 - r) * 100)));
    positionSplitHandle();
    if (persist) storeSet(SPLIT_KEY, r);
  }
  function positionSplitHandle() {
    if (!splitHandle || player.getAttribute('data-layout') !== 'long') return;
    /* 交界 = scene 的底（不是 #stage 的底 —— stage 把 queue 也包进去了）。
     * top 相对 #stage（position:relative 的祖先）。 */
    var sceneEl = $('scene');
    if (!sceneEl) return;
    var sbr = sceneEl.getBoundingClientRect();
    var stb = stageEl.getBoundingClientRect();
    splitHandle.style.top = Math.round(sbr.bottom - stb.top) + 'px';
  }
  if (splitHandle && stageEl) {
    splitHandle.hidden = false;
    var splitting = false;
    splitHandle.addEventListener('pointerdown', function (e) {
      if (player.getAttribute('data-layout') !== 'long') return;
      splitting = true;
      player.classList.add('is-splitting');
      try { splitHandle.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    splitHandle.addEventListener('pointermove', function (e) {
      if (!splitting) return;
      /* 指针相对分区容器（#stage）的高度比 = 封面区占比。
       * 用 stage 自身的矩形做基准（它已排除控制条），不要用 frame。 */
      var stb = stageEl.getBoundingClientRect();
      var avail = stb.height || 1;
      var y = e.clientY - stb.top;
      setSplit(y / avail, false);
    });
    function endSplit() {
      if (!splitting) return;
      splitting = false;
      player.classList.remove('is-splitting');
      setSplit(state.splitRatio, true);
      updateStageMetrics();
      sizeLyricPad();
    }
    splitHandle.addEventListener('pointerup', endSplit);
    splitHandle.addEventListener('pointercancel', endSplit);
    window.addEventListener('resize', positionSplitHandle);
  }

  /* ============================================================
     主题（跟随 Hana 当前主题）
     优先级：宿主显式注入的变量 > @media prefers-color-scheme 兜底 > 写死默认。
     style.css 的 --hk-* 桥已保证优先级；这里负责「让宿主值真的进来」：
     宿主把 hana-css / hana-palette-* 拼进 iframe URL，但 SDK 只在用户换主题
     （THEME_CHANGED）时才拉样式表，初始并不拉 —— 线上从未见过 theme.css 请求，
     --accent 一直落兜底就是这个原因。这里自己补初始注入：
       1) 有 hana-css → 注入单份（= 宿主当前主题，权威）；
       2) 兼容老宿主只给 palette 对时 → 按 hana-theme-appearance 选一套，仍不看系统深浅；
       3) 都没有但知道主题名 → 自己拉 /api/apps/theme.css?theme=…；
       4) 全都没有（真·auto）→ 不注水，交给 CSS 兜底层（prefers-color-scheme）。
     拉不到就静默降级，绝不硬编宿主主题值。
     ⚠️ 初始注入必须用【当前主题】，不能用 prefers-color-scheme 去挑宿主给的深浅两套 ——
     那等于拿操作系统的深浅决定 App 配色，而不是拿 Hana 主题。
     hana-theme-appearance 才是「当前主题属于深还是浅」的权威答案，
     宿主在 iframe URL 里已经给了；系统深浅只是浏览器的口音，两回事。 */
  function setThemeStyle(key, css) {
    var el = document.querySelector('style[data-app-theme="' + key + '"]');
    if (!css) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.setAttribute('data-app-theme', key);
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = css;
  }
  function fetchThemeCss(url) {
    return apiText(url).then(function (r) {
      return (r.ok && r.text && r.text.indexOf('{') >= 0) ? r.text : '';
    }).catch(function () { return ''; });
  }
  var themeGen = 0;
  function injectHostTheme(snap, isUpdate) {
    var gen = ++themeGen;
    function put(url, key, media) {
      return fetchThemeCss(url).then(function (css) {
        if (gen !== themeGen || !css) return;
        if (media) css = '@media (prefers-color-scheme: ' + media + ') {\n' + css + '\n}';
        setThemeStyle(key, css);
      });
    }
    if (isUpdate && snap && snap.cssUrl) {
      /* 运行时换主题：单份覆盖，初始的 palette 对必须撤掉，避免夜间态串色 */
      setThemeStyle('palette-light', '');
      setThemeStyle('palette-dark', '');
      return put(snap.cssUrl, 'base', '');
    }
    if (!isUpdate) {
      /* 当前主题（hana-css）无条件注入，不包 media —— 与 isUpdate 分支等价。
       * 真·auto 时宿主给的是 theme.css?theme=auto，服务端取不到文件、
       * fetchThemeCss 返回空 → 不注水，正好落到 CSS 的 prefers-color-scheme 兜底层。 */
      var cssUrl = params.get('hana-css');
      if (cssUrl) return put(cssUrl, 'base', '');
      /* 兼容：老宿主只给 palette 对、不给 hana-css 时，按 hana-theme-appearance 选，
       * 仍不看系统深浅（真实宿主恒给 hana-css，这条基本用不到，纯兜底）。 */
      var lightCss = params.get('hana-palette-light-css');
      var darkCss = params.get('hana-palette-dark-css');
      if (lightCss && darkCss) {
        var ap = params.get('hana-theme-appearance');
        return put(ap === 'dark' ? darkCss : lightCss, 'base', '');
      }
    }
    var name = (snap && snap.theme) || params.get('hana-theme') || '';
    if (name) return put('/api/apps/theme.css?theme=' + encodeURIComponent(name), 'base', '');
    return Promise.resolve();
  }
  function applyHostTheme() {
    var forced = params.get('theme');
    if (forced) { document.documentElement.setAttribute('data-theme', forced); applyTone(); return; }
    try {
      if (window.hana && window.hana.theme) {
        var snap0 = window.hana.theme.getSnapshot ? window.hana.theme.getSnapshot() : null;
        if (snap0 && snap0.theme) document.documentElement.setAttribute('data-theme', snap0.theme);
        injectHostTheme(snap0, false);
        if (typeof window.hana.theme.subscribe === 'function') {
          var first = true;
          window.hana.theme.subscribe(function (s) {
            if (s && s.theme) document.documentElement.setAttribute('data-theme', s.theme);
            /* 换主题（可能是异步拉样式表）之后重判一次底色，「悬停抬升」的深浅跟着走。 */
            setTimeout(applyTone, 0);
            setTimeout(applyTone, 120);
            /* 首次回调是当前快照回放，注入已在上面做过，不重复 */
            if (first) { first = false; return; }
            injectHostTheme(s, true);
          });
        }
        return;
      }
    } catch (e) { /* 无宿主主题：交给 CSS 兜底层 */ }
    injectHostTheme(null, false);
  }

  /* ============================================================
     初始化
     ============================================================ */
  function renderAll() {
    applyTone();
    renderTrack();
    renderQueue();
    renderProgress();
    renderVolume();
    renderMode();
    renderPlayState();
    renderLyricMode();
    renderLyrics();
    renderAsk();
    renderResume();
    renderChrome();
  }

  function applyTracks(tracks) {
    state.tracks = tracks;
    if (!state.tracks.length) { state.currentUid = ''; }
    else if (!trackByUid(state.currentUid)) {
      var vis = visibleTracks();
      state.currentUid = (vis[0] || state.tracks[0]).uid;
    }
  }

  function restorePlayback(pb) {
    if (pb) {
      if (typeof pb.volume === 'number' && isFinite(pb.volume)) state.volume = Math.max(0, Math.min(1, pb.volume));
      state.muted = !!pb.muted;
      if (pb.mode === 'one' || pb.mode === 'shuffle' || pb.mode === 'list') state.mode = pb.mode;
      if (Array.isArray(pb.shuffleTrail)) {
        shuffleTrail = pb.shuffleTrail
          .filter(function (x) { return typeof x === 'string' && x; })
          .slice(-SHUFFLE_TRAIL_MAX);
      }
    }
    renderVolume();
    renderMode();
    renderLyricMode();
    audio.volume = state.volume;
    audio.muted = state.muted;

    // 恢复当前曲目：优先 uid（list|id）；旧版存的是裸 id，兼容回退
    var t = trackByUid(pb && pb.currentId);
    if (!t && pb && pb.currentId) {
      for (var i = 0; i < state.tracks.length; i++) {
        if (state.tracks[i].id === pb.currentId) { t = state.tracks[i]; break; }
      }
    }
    // 盘上都没有：用快照里自带的整条曲目重建（刚播就拖走，playlist.json 还没落盘）
    if (!t && pb && pb.currentTrack && typeof pb.currentTrack === 'object') {
      var ct = normalizeTrack(pb.currentTrack);
      if (ct.id && ct.url) {
        var wantList = listOf(ct) || 'recent';
        if (!findList(wantList)) {
          wantList = findList('recent') ? 'recent' : (findList('local') ? 'local' : (state.lists[0] ? state.lists[0].id : 'local'));
        }
        ct.list = wantList;
        ct.uid = uidOf(ct);
        var already = trackByUid(ct.uid);
        if (already) {
          t = already;
        } else {
          ensureList(wantList, defaultListName(wantList));
          state.tracks.push(ct);
          t = ct;
          savePlaylist();   // 重建完顺手落盘，下次拖进拖出就不用再靠快照了
          saveLists();
        }
      }
    }
    if (!t) t = visibleTracks()[0] || state.tracks[0] || null;
    if (!t) {
      renderTrack();
      renderQueue();
      renderProgress();
      renderPlayState();
      return;
    }
    state.currentUid = t.uid;
    state.progress = pb && Number(pb.progress) > 0 ? Number(pb.progress) : 0;
    var wantPlay = !!(pb && pb.playing);
    state.playing = false;
    /* 先把音频发出去（发请求、连上游、缓冲都要时间），再做渲染 ——
     * 队列可能几百行，不该挡在起播前面。 */
    if (t.url) {
      loadAudio(t, state.progress, wantPlay);
    }
    renderTrack();
    renderQueue();
    renderProgress();
    renderPlayState();
    updateLyricIndex(true);
    loadLyrics(t);
    if (!t.url && wantPlay) {
      ensurePlayable(t).then(function (ok) {
        if (!ok || state.currentUid !== t.uid) return;
        renderTrack();
        renderQueue();
        loadLyrics(t);
        loadAudio(t, state.progress, true);
      });
    }
  }

  /* 列表名快照：只在真名确实变了才重渲染 */
  function listNamesKey() {
    var out = [];
    for (var i = 0; i < state.lists.length; i++) out.push(state.lists[i].id + '=' + (state.lists[i].name || ''));
    return out.join('|');
  }

  function boot() {
    renderAll();
    applyLayout();
    rippleHandle = initRipples();   // 指针涟漪（不读音频；reduced-motion/截图内部自处理）

    /* 拖进/拖出 = 新文档从零 boot，"静默"全落在这段。把与宿主 SDK 无关的事先发出去：
     * 播放列表 / 播放状态都走后端 HTTP 路由（票在 URL query 上），不必等 hana 落地。
     * SDK 只在读歌单名 / 本地目录 / 主题订阅时等（"改名不持久化"那条纪律不变）。 */
    var dataReady = Promise.all([
      loadPlaylist().catch(function (e) {
        state.loadError = e && e.message ? e.message : String(e);
        console.warn('[player] playlist 读取失败', e);
        return null;
      }),
      loadPlaybackState()
    ]);
    /* boot() 跑在 app.js（defer）里，早于 sdk.js（module）——那时 window.hana 还没有，
     * hanaStorage() 为 null。所以存储读取必须先等宿主 SDK 落地；否则永远读回 null，
     * 而回写默认名会把用户改过的歌单名覆盖回「歌单 N」（改名不持久化的根因）。 */
    var sdkReady = waitForHana(2000);

    dataReady.then(function (results) {
      var tracks = results[0];
      var pb = results[1];
      /* 先用派生名把列表立起来：首屏不等存储读取（宿主桥没应答时不至于卡住） */
      if (tracks) {
        var needsAssign = migrateLists(tracks, null);
        applyTracks(tracks);                             // 先落 state.tracks
        if (needsAssign) savePlaylist();                 // 再回写（savePlaylist 读的是 state.tracks）
        /* 旧包名叫名迁移：本次读时若有前缀被归一（改名留下的债），
         * 立即全量回写一次，让 playlist.json 首次启动就把化石洗成活字；
         * 之后不再改（appUrlRewrote 已不置位）。不污染不拖到“何时才保存”。 */
        else if (appUrlRewrote) savePlaylist();
      } else {
        state.lists = [{ id: 'local', name: '本地' }];
      }
      // 恢复当前列表
      if (pb && pb.activeList && findList(pb.activeList)) state.activeList = pb.activeList;
      else if (!findList(state.activeList)) state.activeList = 'local';
      restorePlayback(pb);                               // ← 不等 SDK，尽早起播
      if (!tracks) toast('列表加载失败，请稍后重试');
      if (params.get('assert') === '1') setTimeout(runSelfCheck, 60);
      /* 主题与存储仍等 SDK：主题订阅要 hana.theme；存储读不到绝不能回写默认值。
       * 再读存储：读到就套用真名 / 本地目录 / 分隔比例。 */
      return sdkReady.then(function () {
        applyHostTheme();
        applyTone();                                   // 主题值落地后重判一次底色
        return Promise.all([storeRead(LISTS_KEY), storeRead(LOCALDIR_KEY), storeRead(SPLIT_KEY)]);
      });
    }).then(function (reads) {
      var listsRead = reads[0], dirRead = reads[1], splitRead = reads[2];
      if (dirRead.value) { state.localDir = String(dirRead.value); syncLocalFolder(false); }
      var sp = splitRead.value;
      if (typeof sp === 'number' && sp > 0 && sp < 1) setSplit(sp, false);
      if (listsRead.ok && state.tracks.length) {
        var before = listNamesKey();
        if (migrateLists(state.tracks, listsRead.value)) savePlaylist();
        saveLists();
        if (before !== listNamesKey()) renderAll();
      }
      /* 首次使用提示：再读一次一个专用 key（不拿 listsRead 代表一切）。 */
      storeRead(FIRST_RUN_KEY).then(maybeShowFirstRun);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ============================================================
     自检：?assert=1 时在页面里跑一遍清单并输出到 #report
     （dev 截图/断言用；不参与正常使用）
     ============================================================ */
  function runSelfCheck() {
    var checks = [];
    var fr = frame.getBoundingClientRect();

    function add(name, ok, detail) {
      checks.push({ name: name, ok: !!ok, detail: String(detail === undefined ? '' : detail) });
    }
    function inside(r) {
      return r.left >= fr.left - 1 && r.top >= fr.top - 1 &&
             r.right <= fr.right + 1 && r.bottom <= fr.bottom + 1;
    }
    function shown(el) {
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (el.closest('[hidden]')) return false;   // 隐藏的祖先（搜索页未唤出时整页不参与版面）
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    /* 1. 不出现整页滚动条 */
    var de = document.documentElement;
    add('no-page-scroll',
      de.scrollHeight <= window.innerHeight + 1 && de.scrollWidth <= window.innerWidth + 1,
      'doc ' + de.scrollWidth + 'x' + de.scrollHeight + ' / viewport ' + window.innerWidth + 'x' + window.innerHeight);

    /* 2. 横向不溢出 */
    add('no-h-overflow',
      player.scrollWidth <= player.clientWidth + 1 && queueList.scrollWidth <= queueList.clientWidth + 1,
      'player ' + player.scrollWidth + '/' + player.clientWidth);

    /* 3. 顶栏在容器内可见 */
    var topbar = (player.getAttribute('data-layout') === 'compact' && state.page === 'queue')
      ? queue : sceneTop;
    var tr = topbar.getBoundingClientRect();
    add('topbar-visible', shown(topbar) && inside(tr),
      Math.round(tr.left) + ',' + Math.round(tr.top) + ' ' + Math.round(tr.width) + 'x' + Math.round(tr.height));

    /* 4. 右上 100x40 宿主安全区没有控件 */
    var safe = { left: fr.right - 100, top: fr.top, right: fr.right, bottom: fr.top + 40 };
    var hits = [];
    player.querySelectorAll('button, input').forEach(function (el) {
      if (!shown(el)) return;
      var r = el.getBoundingClientRect();
      if (r.right > safe.left && r.left < safe.right && r.bottom > safe.top && r.top < safe.bottom) {
        hits.push(el.id || el.className);
      }
    });
    add('host-safe-clear', hits.length === 0, hits.join(','));

    /* 5. 播放控制全在容器内 */
    ['playBtn', 'prevBtn', 'nextBtn', 'modeBtn', 'seek', 'muteBtn', 'favBtn', 'queueBtn'].forEach(function (id) {
      var el = $(id);
      add('control-visible:' + id, shown(el) && inside(el.getBoundingClientRect()), '');
    });
    // 音量：默认收起（三种布局都是），展开后竖条完整可见且在容器内
    var volGrp = player.querySelector('.vol-group');
    var volSlider = $('vol');
    var volClosed = !shown(volSlider);
    volGrp.classList.add('is-open');
    var volOpenOk = shown(volSlider) && inside(volSlider.getBoundingClientRect());
    volGrp.classList.remove('is-open');
    add('vol-pop-hover-slider', volClosed && volOpenOk,
      'closed=' + volClosed + ' open=' + volOpenOk);

    /* 6/7. 队列能滚到底，且滚动时顶栏不动 */
    var queueVisible = shown(queueList) && queueList.scrollHeight > queueList.clientHeight;
    if (queueVisible) {
      var before = topbar.getBoundingClientRect();
      queueList.scrollTop = 0;
      var atTop = queueList.scrollTop;
      queueList.scrollTop = queueList.scrollHeight;
      var atBottom = queueList.scrollTop;
      var after = topbar.getBoundingClientRect();
      var reached = atBottom + queueList.clientHeight >= queueList.scrollHeight - 2;
      add('queue-scroll-bottom', reached && atBottom > atTop,
        'scrollTop ' + Math.round(atTop) + ' -> ' + Math.round(atBottom) + ' / content ' + queueList.scrollHeight + ' / view ' + queueList.clientHeight);
      add('topbar-stable-on-scroll',
        Math.abs(before.top - after.top) < 0.5 && Math.abs(before.height - after.height) < 0.5,
        'top ' + before.top.toFixed(1) + ' -> ' + after.top.toFixed(1));
      queueList.scrollTop = params.get('queuepos') === 'bottom' ? queueList.scrollHeight : 0;
    } else {
      add('queue-scroll-bottom', true, 'n/a（本状态下队列不滚动：内容不足或已隐藏）');
      add('topbar-stable-on-scroll', true, 'n/a（同上）');
    }

    var hasLyrics = player.getAttribute('data-haslyrics') === '1';
    /* 7b. 歌词只滚自己：不牵动顶栏、控制条、队列 */
    if (hasLyrics && shown(lyrics) && lyrics.scrollHeight > lyrics.clientHeight + 1) {
      var topBefore = sceneTop.getBoundingClientRect().top;
      var ctlBefore = $('controls').getBoundingClientRect().top;
      var qBefore = queueList.scrollTop;
      var saved = lyrics.scrollTop;
      lyrics.scrollTop = lyrics.scrollHeight;
      var okIso = Math.abs(sceneTop.getBoundingClientRect().top - topBefore) < 0.5 &&
                  Math.abs($('controls').getBoundingClientRect().top - ctlBefore) < 0.5 &&
                  Math.abs(queueList.scrollTop - qBefore) < 0.5;
      add('lyric-scroll-isolated', okIso,
        'topbar ' + topBefore.toFixed(1) + '->' + sceneTop.getBoundingClientRect().top.toFixed(1) +
        ' / controls ' + ctlBefore.toFixed(1) + '->' + $('controls').getBoundingClientRect().top.toFixed(1) +
        ' / queueScroll ' + qBefore + '->' + queueList.scrollTop);
      lyrics.scrollTop = saved;
    } else {
      add('lyric-scroll-isolated', true, 'n/a（歌词关闭或本状态下歌词不滚动）');
    }

    /* 8. 歌词不横向溢出 */
    if (hasLyrics && shown(lyrics)) {
      add('lyric-no-overflow', lyrics.scrollWidth <= lyrics.clientWidth + 1,
        'lyrics ' + lyrics.scrollWidth + '/' + lyrics.clientWidth);
    } else {
      add('lyric-no-overflow', true, 'n/a（歌词关闭）');
    }

    /* 9. 无词时：只留封面 + 涟漪；蒙层/渐变必须保持在线（涟漪常驻在底层，不交班） */
    var rippleEl = $('rippleCanvas');
    if (!hasLyrics) {
      add('ripple-when-no-lyrics',
        !shown(lyricWrap) && shown(lyricScrim) && (reducedMotion() || !rippleEl || shown(rippleEl)),
        'wrap=' + getComputedStyle(lyricWrap).display +
        ' scrim=' + getComputedStyle(lyricScrim).display);
    } else if (shown($('scene'))) {
      add('lyrics-shown-when-lyrics-on', shown(lyricWrap) && shown(lyricScrim), '');
    } else {
      add('lyrics-shown-when-lyrics-on', true, 'n/a（本状态整页是队列页，舞台整体隐藏）');
    }

    /* 9b. 标题块与歌词文字不得重叠（无词时该区无文字，跳过） */
    if (shown($('scene')) && hasLyrics && shown(lyricWrap)) {
      var tb = sceneTop.getBoundingClientRect();
      var band = lyricWrap.getBoundingClientRect();
      add('title-not-overlap-content', band.top >= tb.bottom - 1,
        'titleBottom=' + Math.round(tb.bottom) + ' contentTop=' + Math.round(band.top));
    }

    /* 9c. 搜索页不得遮住底部控制条：它挂在 .stage 内，底线应 <= 控制条顶边 */
    var spEl = $('searchPage');
    if (spEl && !spEl.hidden) {
      var spR = spEl.getBoundingClientRect();
      var ctlR = $('controls').getBoundingClientRect();
      add('search-page-not-cover-controls', spR.bottom <= ctlR.top + 1,
        'searchBottom=' + Math.round(spR.bottom) + ' controlsTop=' + Math.round(ctlR.top));
    } else {
      add('search-page-not-cover-controls', true, 'n/a（搜索页未开）');
    }
    /* 10. 字号下限 */
    var small = [];
    player.querySelectorAll('*').forEach(function (el) {
      if (!shown(el)) return;
      if (!el.textContent.trim() && el.tagName !== 'INPUT') return;
      var fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 11) small.push((el.id || el.className || el.tagName) + '=' + fs);
    });
    add('font-min-11px', small.length === 0, small.join(','));

    /* 11. 悬停抬升（发光）
     * ① 底色极性判对：浅纸（相对亮度 > 0.5）走 light 档，深板岩走 dark 档；
     * ② 控制条辅助位悬停真的换了表面色 + 上了辉光（不再是 --hk-hover 那块底）；
     * ③ 图标位（辅助位 / 中央三键 / 播放键）都有辉光，且强度分两档。 */
    (function () {
      add('tone-matches-surface-polarity',
        (function () {
          var cs = getComputedStyle(player);
          var s = (cs.getPropertyValue('--hk-surface') || '').trim();
          var m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
          var c = m ? [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])]
                    : (themeLabel() === 'dark' ? [65, 77, 86] : [252, 250, 245]);
          function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
          var L = 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
          var want = L > 0.5 ? 'light' : 'dark';
          return player.getAttribute('data-tone') === want;
        })(),
        'surface=' + (getComputedStyle(player).getPropertyValue('--hk-surface') || '').trim() +
        ' tone=' + player.getAttribute('data-tone'));

      /* 伪类没法用 getComputedStyle 读（第二个参数只认 ::before/::after），
       * 所以直接扫样式表：找 selectorText 命中该选择器、且声明了 box-shadow 的规则。 */
      var hoverRule = function (needle) {
        var out = [];
        try {
          var sheets = document.styleSheets;
          for (var i = 0; i < sheets.length; i++) {
            var rules = sheets[i].cssRules || [];
            for (var j = 0; j < rules.length; j++) {
              var r = rules[j];
              if (!r.selectorText || !r.style) continue;
              if (r.selectorText.indexOf(needle) < 0) continue;
              if (r.selectorText.indexOf(':hover') < 0) continue;
              out.push({ sel: r.selectorText, shadow: r.style.boxShadow || '', bg: r.style.background || r.style.backgroundColor || '' });
            }
          }
        } catch (e) { /* 读不到样式表就算了，下面报空 */ }
        return out;
      };

      var auxRule = hoverRule('.queue-btn');
      var auxShadow = auxRule.map(function (r) { return r.shadow; }).join(' | ');
      add('hover-glow-replaces-gray',
        auxRule.length > 0 && !!auxShadow && auxShadow.indexOf('var(--hv-') >= 0,
        'rules=' + auxRule.length + ' shadow=' + String(auxShadow).slice(0, 52));

      var wantSels = [
        '#searchEntryBtn', '.queue-btn', '.transport > .icon-btn', '.play-btn', '.fav-btn-bar', '.q-more', '.q-fav'
      ];
      /* #searchEntryBtn 在样式表里写作 .search-entry，单独映射 */
      var selFor = function (id) { return id === '#searchEntryBtn' ? '.search-entry' : id; };
      var missing = wantSels.filter(function (id) {
        var sel = selFor(id);
        return !hoverRule(sel).some(function (r) { return r.shadow && r.shadow.indexOf('var(--hv-') >= 0; });
      });
      add('hover-glow-on-all-controls', missing.length === 0, missing.join(','));

      var pc = getComputedStyle(player);
      var ring = (pc.getPropertyValue('--hv-ring') || '').trim();
      var ringStrong = (pc.getPropertyValue('--hv-ring-strong') || '').trim();
      add('hover-glow-two-tiers', !!ring && !!ringStrong && ring !== ringStrong,
        'ring=' + ring.slice(0, 22) + ' | strong=' + ringStrong.slice(0, 22));
    })();

    /* 12. 无 emoji */
    var emoji = /\p{Extended_Pictographic}/u.test(player.textContent);
    add('no-emoji', !emoji, '');

    /* 12. 根容器：无外描边/外阴影；顶部两角圆、下两角直角。
     *     宿主在独立窗里会把 App 面裁圆，卡片里不裁 —— 所以卡片壳自己补上顶部圆角，
     *     值跟宿主 token 走（body[data-shell] 两条，见 style.css）。 */
    var cs = getComputedStyle(player);
    var topR = parseFloat(cs.borderTopLeftRadius) || 0;
    var botR = parseFloat(cs.borderBottomLeftRadius) || 0;
    add('root-corners-and-no-shadow',
      topR >= 12 && botR === 0 && cs.boxShadow === 'none' &&
      cs.borderTopWidth === '0px' && cs.borderLeftWidth === '0px',
      cs.borderRadius + ' / ' + cs.boxShadow);

    var payload = {
      type: 'self-check',
      case: [window.innerWidth + 'x' + window.innerHeight, themeLabel(), hasLyrics ? 'lyrics-on' : 'no-lyrics', player.getAttribute('data-layout')].join(' / '),
      passed: checks.filter(function (c) { return !c.ok; }).length === 0,
      checks: checks
    };
    var rep = $('report');
    if (rep) rep.textContent = JSON.stringify(payload, null, 2);
    return payload;
  }
  function themeLabel() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }
  window.__playerSelfCheck = runSelfCheck;
  /* 自检钩子：涟漪可观测状态 + 测试时手动喂波（测试用）。 */
  window.__playerDebug = {
    rippleState: function () { return rippleHandle ? rippleHandle.stats() : { exists: false }; },
    ripplePoke: function (x, y, strong) { return rippleHandle ? rippleHandle.poke(x, y, strong) : 0; },
    rippleAudio: function () { return rippleHandle ? rippleHandle.audioState() : { exists: false }; },
    rippleAudioPoke: function (level) { return rippleHandle ? rippleHandle.audioPoke(level) : 0; },
    /* 跨源歌词兜底的匹配判定（测试用）：不依赖网络，直接喂结果集。 */
    pickLyricHit: pickLyricHit,
    lyricIsPlaceholder: lyricIsPlaceholder,
    normLyricTitle: normLyricTitle,
    normLyricAuthor: normLyricAuthor,
    /* 歌词关键词清洗（测试用）：纯函数，直接喂标题/歌手。 */
    cleanLyricQuery: cleanLyricQuery,
    lyricQueryOf: lyricQueryOf,
    pickByQuery: pickByQuery,
    lyricMatchOf: lyricMatchOf,
    parseLrcDocument: parseLrcDocument,
    lyricAlignState: function () {
      return { active: !!lyricAlign, dragging: !!(lyricPress && lyricPress.dragging),
        draft: lyricAlign ? lyricAlign.draft : null, saved: savedLyricOffset(currentTrack()),
        base: lyricBaseOffset, time: lyricTimeAt(liveProgress()), index: lyricIndex,
        media: liveProgress(), follow: state.follow, raf: !!lyricAlignRaf,
        copies: state.tracks.filter(function (t) { return currentTrack() && t.id === currentTrack().id; }).map(function (t) { return { uid: t.uid, offset: t.raw.lyricOffset }; }) };
    },
    bindLyricMatch: bindLyricMatch,
    currentTrack: currentTrack,
    lyricAskState: function () { return { state: lyricState, hidden: $('lyricAsk') ? $('lyricAsk').hidden : null, popHidden: $('lyricMatchPop') ? $('lyricMatchPop').hidden : null }; },
    openLyricMatch: openLyricMatch,
    closeLyricMatch: closeLyricMatch,
    resetLyricMatch: resetLyricMatch,
    bindLyricMatch: bindLyricMatch,
    /* 搜索页（测试用）：不依赖真实网络，直接喂结果验证渲染/落库。 */
    openSearch: openSearch,
    closeSearch: closeSearch,
    renderResults: function (list) { searchSeq++; searchBusy = false; searchPaginated = false; searchTotal = (list || []).length; searchLoadingMore = false; setDiscoverVisible(false); searchResults = list || []; renderSearchResults(); },
    /* 翻页（测试用）：真走 doSearch / loadMoreSearch 的控制流，只是不依赖键盘与滚动事件。 */
    setKeyword: function (kw) { if (searchInput) searchInput.value = kw || ''; },
    setServer: function (id) { searchServer = id; renderSearchServers(); },
    doSearch: doSearch,
    loadMore: loadMoreSearch,
    setPaginated: function (on) { searchPaginated = !!on; },
    scrollListToBottom: function () {
      if (!searchList) return 0;
      searchList.scrollTop = searchList.scrollHeight;
      return searchList.scrollTop;
    },
    setScope: function (sc) { searchScope = sc; renderSearchScope(); },
    /* 首次提示（测试用）：直接喂一个 read 结果，验弹/不弹的条件。
     * 每次先复位 hidden，避免上一次调用残留状态影响判定。 */
    firstRunState: function () { var el = $('firstRun'); return { hidden: el ? el.hidden : null }; },
    firstRunTry: function (read) {
      var el = $('firstRun');
      if (el) el.hidden = true;
      maybeShowFirstRun(read);
      return el ? el.hidden : null;
    },
    clearSearch: clearSearch,
    /* B站分P（测试用）：不依赖真实网络 —— 探测/拉列表都可直接喂。 */
    biliPartsState: function () { return { probe: JSON.parse(JSON.stringify(biliProbe)), open: Object.keys(biliOpen), cacheKeys: Object.keys(biliPartsCache), probesLeft: biliProbesLeft }; },
    biliPartsProbe: function (bvid, n) { biliProbe[bvid] = n; renderSearchResults(); },
    biliPartsFeed: function (bvid, list) { biliPartsCache[bvid] = list; biliProbe[bvid] = list.length; renderSearchResults(); return list.length; },
    biliPartsToggle: function (idx) { toggleBiliParts(searchResults[idx]); },
    biliPartsImport: function (idx) { importBiliParts(searchResults[idx]); },
    biliPartsFavAll: function (idx) { favAllBiliParts(searchResults[idx]); },
    renderDiscover: function (o) {
      o = o || {};
      hotSongs = o.hot || []; discoverCharts = o.charts || []; discoverSheets = o.sheets || []; discoverRadios = o.radios || [];
      discoverLoaded = true;
      renderHotSongs(); renderCharts(); renderRadios();
    },
    searchState: function () { return { server: searchServer, scope: searchScope, results: searchResults.length, total: searchTotal, paginated: searchPaginated, loadingMore: searchLoadingMore, keyword: searchKeyword, open: !!(searchPage && !searchPage.hidden), discoverVisible: discoverActive() }; },
    /* 旧包名迁移（测试用）：纯函数，不依赖网络/真实磁盘。 */
    normalizeAppUrl: normalizeAppUrl,
    appId: function () { return APP_ID; }
  };
})();

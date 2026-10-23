# B站音源「没有随音乐的涟漪」排查 · 2026-10-22

> **只读排查**：未改运行时代码、未部署、未 reload、未播放用户歌单、未新增测试。
> **基线**：仓库 `hanako-audio-player-simple`，安装构建 `1003131822`。仓库与安装包的 `ui/app.js` 涟漪段 diff 为空 —— 这**只证明当前部署一致**，不能证明历史行为，也不能证明运行期实际状态。
> **证据等级约定**：本文把「本地受控实验证明的机制」「源码/文档可核对的事实」「对生产的推断」「尚未取得的读数」严格分开；没有取得的读数一律写「未取得」，不用推断补位。

---

## 0. 一句话结论（按证据等级）

- **已证实（本地受控实验）**：当一个 `<audio>` 的**最终媒体来源是跨源**时，`audio.captureStream()` 会抛 `SecurityError`；而元素**照常出声**、`readyState` 与时间轴照常推进。这**足以**产生用户描述的症状（音乐在放、没有音频驱动的涟漪、指针涟漪正常）。
- **已证实（源码）**：`ui/app.js` 里给 `<audio>` 赋 `src` 的只有 `loadAudio()` 一处，URL 是 `music/go` 路由；该路由有两条 **302 兜底**分支，会把上游 CDN 直链直接交给 `<audio>`。
- **未验证（生产）**：B站 曲目播放时，`<audio>` 的最终响应到底是不是跨源；也没有取得 `captureStream` 的实际失败原因、`rippleAudio()` 的实际读数、或服务端那次 Range 请求的响应头。
- **因此**：本报告**不主张**已定位到生产根因，只给出「一个已被证明能造成同样症状的机制」+「需要什么读数才能确认/否定」+「若确认后可选的修法及其风险」。

---

## 1. 已证实

### 1.1 本地受控实验（Chrome 155 headless，夹具全本地生成，不依赖外网）

夹具：ffmpeg 生成 80Hz+900Hz 混音 8s；`serve.py` 起两个源（`127.0.0.1:8801` 同源且 Range→206、`127.0.0.1:8802` 跨源），`/redir` 是 8801 上 302 到 8802。采集链路逐字复刻 `attachAudio`：`captureStream → MediaStreamSource → Analyser(4096, .2) → Gain(0) → destination`。原始读数见 `bili-audio-ripple-20261022/`。

| 用例 | 结果 | 文件 |
|---|---|---|
| 同源 mp3（206 分片） | 轨道 1，bass 峰 **−41.8 dB** | `capture-matrix.json` |
| **同源 → 302 → 跨源** | **`SecurityError: Cannot capture from element with cross-origin data`**；`readyState 4`、时间照走、播放正常 | 同上 |
| 直接跨源 mp3 | 同上 `SecurityError` | 同上 |
| 同源 fMP4（AAC，以 `video/mp4` 提供，B站 m4s 形状） | 轨道 1，bass 峰 **−41.5 dB** | 同上 |
| 同源 mp3 以 `application/octet-stream` 提供 | 轨道 1，bass 峰 **−41.8 dB** | 同上 |
| 同源 FLAC-in-MP4（48k，Hi-Res 形状） | 轨道 1，bass 峰 **−41.5 dB** | `flac-mp4.json` |
| 挂链时点：`loadedmetadata`(readyState 1) / `play` / `playing` | 轨道 1；开播后都有能量 | `attach-timing.json` |
| 先挂链（readyState 1）再开播 | 开播后仍读到 **−41.7 dB** | `early-attach.json` |
| B站真实 PCDN 节点（`xy…mcdn.bilivideo.cn:8082`） | `fetch(Range: bytes=0-1023)` → **206**、`content-length: 1024`；`<audio>` 能播（duration 266.88、时间前进）；跨源 `captureStream` → `SecurityError` | `cdn-probe.json` |

**这组实验能支持的结论（仅此而已）**：
1. 跨源**足以**造成「出声但无音频涟漪」，且不影响指针涟漪。
2. 上述容器/编码/`Content-Type`/挂链时点在**本地同源条件下不构成采集障碍** —— 但它们**没有被证明**在生产里一定不是障碍（生产有代理分片、真实 CDN、宿主 Chromium 版本等差异）。

### 1.2 源码事实（可逐行核对）

- `ui/app.js:4911`：`audio.src = withSession(t.url)` 是**唯一**给该元素赋 `src` 的地方（另有两处 `removeAttribute('src')`）。所有曲目 URL 都指向 `music/go`（`playlist.json` 835 条全量核对，无一例外）。
- `lib/register-routes.js:290-320`：`music/go` 有两条 302 兜底 —— fetch 抛错（`:306`）、响应无 `content-range`（`:309-313`，注释写「至少保住播放」）。两条都直接 `c.redirect(url)`。
- `ui/app.js:2740-2768`（`attachAudio`）：`captureStream()` 或 `getAudioTracks()` 失败 → `detachAudio(); return false`，退回纯指针。catch 里**不区分**「跨源」「无轨道」「AudioContext 未 running」。
- `ui/app.js:2769-2782`（`buildAudio`）：`if (audioBuilding || audioReady || …) return;` —— 失败后不会自动重试，要等下一次 `play` 事件。
- `ui/app.js:3235`：`if (audioReady) { schedule(); return; }` —— `audioReady=true` 时随机呼吸波被压掉。
- `lib/bilibili.js:149-160`（`pickBestAudio`）：只保留 `baseUrl`，`backupUrl` 全部丢弃；按带宽排序取最高。
- 宿主 `allowedHosts` 匹配用 `URL.hostname`（`~/.hanako/artifacts/server/1.1.35…/bundle/index.js`，`PLUGIN_NETWORK_HOST_NOT_ALLOWED` 分支前 `const s = e.hostname.toLowerCase()`）—— 因此「端口 8082 导致白名单拒绝」这一条假设可以排除（仅此一条）。

### 1.3 生产观测（只有用户口径，不含读数）

用户 2026-10-22 反馈：**网易云音源随音乐涟漪正常；B站音源没有随音乐的涟漪，鼠标经过仍有指针涟漪。**
用户**没有**说明：是否每首 B站 都如此、是否偶发、画布上有没有随机呼吸环、播放时是否报错。

### 1.4 现有验证覆盖（文档与源码可核对）

- `RIPPLE-PRODUCTION-DONE.md` 的真机复跑命令用的是**本地 m4a**（`RIPPLE_SONG=…/B站音频/花一匁.m4a`），走的是本地文件，不经过 `music/go` 代理。
- `REMOVE-AUDIO-REACTIVE-TESTS-20261016.md`：2026-10-16 起 21 条真实音频反应断言整族删除。
- 现存唯一相关断言 `ripple-crosssource-degrades-without-silencing`（`tools/verify-ui.mjs:3024`）是 **stub `captureStream` 抛错**后断言 `ready === false` —— 它验证的是「降级不静音」，**不是**「真实音频能被采到」。
- 因此在现有套件里，「采集失败 → 纯指针」与「正常」都可能通过；套件不能回答本次问题。

---

## 2. 待验证（生产侧，尚无读数）

以下每一条都是**空的**，不能用本地实验或推断替代：

| 待验证项 | 为什么必须实测 | 现状 |
|---|---|---|
| B站 曲目播放时 `<audio>` 的**最终响应是否跨源**（是否 302 到 `*.bilivideo.*`） | 这是把本地机制接到生产上的关键缺口 | 未取得。`ui_action read_state` 对已挂载播放器卡返回 `{}`；App 没有注册只读诊断工具/面板；按约定不用 CDP / `browser.evaluate` / Token / 脚本绕路 |
| `captureStream` 的**实际失败原因** | `attachAudio` 的 catch 不分类；`ready=false` 可能来自跨源、无轨道、AudioContext 未 running、或其它 attach 错误 | 未取得 |
| `rippleAudio()` 的读数（`ready` / `analysing` / `envBass` / `onsets`） | 公开钩子是 `window.__playerDebug.rippleAudio()`（另有 `rippleState()`）；只在页面上下文可读，当前无合规入口 | 未取得 |
| 服务端那次 `Range: bytes=0-2097151` 的响应头 | 决定 302 兜底是「无 `content-range`」还是「fetch 抛错」 | 未取得。注意：`cdn-probe.json` 里 `Content-Range: null` **不能**当缺失证据 —— 它不在 CORS 响应安全列表，跨源 JS 永远读不到 |
| 现象是否稳定复现（每首 / 偶发 / 特定曲目） | 决定这是「路径问题」还是「个别上游/网络问题」 | 未取得（用户未说明） |
| B站 曲目是否命中 Hi-Res FLAC / 杜比 | 影响选流与后续排查方向 | 未取得（需真实 cookie 走一次 playurl） |

**已明确作废的判据（本轮自己写错、这里更正）**：

- ~~用 `audio.currentSrc` / `srcOrigin` 判断最终响应是否同源~~ —— `capture-matrix.json` 里 302 之后 `currentSrc` **仍然是 `http://127.0.0.1:8801/redir`**。`currentSrc` 反映的是「元素被赋予的 URL」，不是最终响应来源。
- ~~用 `ready === false` 坐实跨源~~ —— 同上，`ready=false` 有多种成因。
- ~~用 CORS 读不到 `Content-Range` 推断上游没发~~ —— 自相矛盾。

---

## 3. 与本次现象相容的机制（假设，非结论）

按「已被证明能造成同样症状」排序，均**未经生产验证**：

**H1：`music/go` 对 B站 走了 302 兜底，`<audio>` 最终跨源 → `captureStream` 抛错 → 纯指针。**
支持：本地实验证明该机制的症状完全一致（出声、无音频涟漪、指针正常）；源码里 302 兜底确实存在；`<audio>` 的 `src` 只来自这条路由。
不支持/未知：没有生产证据表明发生了 302；也不知道触发的是「无 `content-range`」还是「fetch 抛错」。有源码依据可排除的只有「端口 8082 导致白名单拒绝」这一条；`maxResponseBytes` 2.5 MiB 上限、15s 超时、PCDN 节点对 2 MiB Range 的行为都未测。

**H2：采集正常，但能量低于用户自调门槛。**
支持：`player-ripple-tune` 现值 `bassThreshold .0137`（量程上限 .028）、`beatThreshold .0178`（上限 .036）、`hatThreshold .0018`（上限 .0036），都在量程偏右。
可区分之处：H2 下 `audioReady=true`，呼吸波被压掉（`ui/app.js:3235`），画布**整块不动**；H1 下 `audioReady=false`，呼吸波会恢复，**每几秒掉一个随机环**。用户未说明有没有随机环 —— 这个观察只能当**辅助**，不能当实锤（正常静音段、页面不可见、`reduced-motion` 等也会影响画面）。

**H3：其它采集失败（无轨道 / AudioContext 未 running / attach 时序）。**
本地实验对「挂链时点」「早挂链」两种情形都读到了能量，**不支持**这两条；但生产宿主 Chromium 版本、页面可见性、AudioContext 策略与本地不同，不能据此排除。

---

## 4. 候选修复（仅候选，均未实施；附前提与风险）

> 前提：**先拿到 §2 的读数再决定做不做、做哪一层。** 下面任何一条都不得以「牺牲播放」为代价，也不得为修涟漪扩域名/加权限。

### C1（后端，候选）B站 选流/兜底时不丢备份 URL

`pickBestAudio` 目前只保留 `baseUrl`（`lib/bilibili.js:149-160`），`backupUrl`（常见为 `upos-*` 主机）被丢弃。若 §2 证实 302 来自「主 URL 不可代理」，可让 `resolveAudioUrl` 同时缓存主/备，路由在主 URL 拿不到 `content-range` 时**尝试备份**再决定是否 302。

必须一并考虑（否则会引入新故障）：
- 全部上游都失败时仍要能**播放**（保留 302 作为最后手段，不能改成「永不 302」）。
- 失败/放弃的上游 `Response` 要**显式取消并释放**（宿主对每个 App 进程有 32 条共享流配额，空转 60s 才回收；`PITFALLS.md` 已记录过 `APP_HTTP_STREAM_LIMIT` 引发的偶发播放失败）。
- 切歌 / seek 会重发 Range，备份重试会放大请求数与耗时，需评估与 32 流配额、`AUDIO_CHUNK` 大小的关系。
- 不加新域名、不改 `/widget/api/...` 旧路径。

### C2（后端，候选）B站 分片调小

把 B站 的 `AUDIO_CHUNK`（现 2 MiB）降到 512 KiB，降低 PCDN 对超大 Range 不按规矩回的概率。风险同上（请求数变多、切歌更频繁），且**不能解决**「fetch 抛错」类问题。属于试验性调整，需实测对比。

### C3（前端，候选）失败原因可观测

`attachAudio` 的 catch 现在不区分原因。可以只做**记录**（例如把最近一次失败原因挂在已有 `audioState()` 里返回，不改行为、不改调度）。这条的价值是把 §2 的空缺补上，而不是修涟漪。

### 已否决 / 暂不采纳

- **1.2s 静音看门狗 → `detachAudio()` 交给呼吸波**：不采纳。正常静音段（前奏、间奏、纯人声）会误判；且呼吸波不是音乐涟漪，等于用另一种随机动画冒充恢复。
- **`createMediaElementSource`**：禁止（跨源全零且不可逆，项目已有实测记录）。
- **放宽 `bassThreshold` / 加大 `visualGain`**：不做（把无信号伪装成有反应）。
- **把 `ready === false` 或 `currentSrc` 当作跨源判据**：作废（见 §2）。

---

## 5. 若要推进，需要的最小现场条件

1. **一次真实的 `<audio>` 网络记录**：B站 曲目播放时，首个媒体请求是 `206` 且 URL 仍是 `/api/apps/.../music/go/...`，还是 `302` 到 `*.bilivideo.*`。这一条能直接判 H1 成立/不成立。
2. 若 302 成立：一次**服务端**的 Range 头探测（`Range: bytes=0-2097151` + 现有 UA/Referer），看 `content-range` 是否存在、`content-length` 是否 ≤2.5 MiB —— 区分「无头」与「fetch 抛错」。
3. 若 302 不成立：需要 `rippleAudio()` 的 `ready/envBass/onsets` 读数（当前无合规入口；`ui_action read_state` 返回 `{}`），才能判 H2/H3。
4. 用户侧辅助观察（只作辅助）：B站 播放时画布上有没有**间隔几秒的随机小环**。有 → 更接近「采集失败」；完全没有 → 更接近「采集到了但没能量」或「分析未运行」。

在 1 或 3 拿到之前，不建议动任何运行时代码 —— 包括 C1/C2。

> **2026-10-22 更新（一）**：只读诊断入口已接入（卡片：队列抽屉头部「复制音频诊断」；独立窗：`hana.window.onInspect` → 宿主 inspect/read_state）。字段、判读表与实测范围见 [`BILI-AUDIO-RIPPLE-DIAGNOSTICS-20261022.md`](BILI-AUDIO-RIPPLE-DIAGNOSTICS-20261022.md)。
>
> **2026-10-22 更新（二）**：用户真实 1823 现场已取回：采集正常；bass/kick 的门槛相对采样瞬间的 band RMS 上界偏高（单帧数值支持，非严格证明），mid/high 原始值未取。见 [`BILI-AUDIO-RIPPLE-TRIGGER-ANALYSIS-20261022.md`](BILI-AUDIO-RIPPLE-TRIGGER-ANALYSIS-20261022.md)。

---

## 6. 原始实验（保留，未改动）

目录 `docs/player-ui/handoffs/bili-audio-ripple-20261022/`：

- `capture-matrix.json` — 同源 / 302 跨源 / 直连跨源 / fMP4 / octet-stream 原始读数（含「302 后 `currentSrc` 仍是原 URL」这条关键反例）
- `attach-timing.json` — `loadedmetadata` / `play` / `playing` 三个挂链时点
- `early-attach.json` — 先挂链再开播（不支持「早挂永久静音」）
- `cdn-probe.json` — B站 PCDN 节点 206 与跨源 `captureStream` 报错（含 `Content-Range` 读不到的说明）
- `flac-mp4.json` — FLAC-in-MP4 同源可采
- `probe.html` / `probe3.html` / `probe5.html` / `serve.py` — 可复跑夹具（本地生成音频，不依赖外网）

复跑：`python3 serve.py`（8801/8802）+ ffmpeg 生成 `tone.mp3` / `tone-frag.mp4`，Chrome `--headless=new --autoplay-policy=no-user-gesture-required` 打开 `probe.html`，结果 POST 回 `/report`。

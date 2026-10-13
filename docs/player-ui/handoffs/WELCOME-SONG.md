# 首次使用的欢迎歌 + 首次卡（2026-10-12）

对应待办 `FRONTEND-TODO-2026-10-12.md` 第 3 项。**已部署**，构建号 1003131665。

## 需求（罐头）

默认安装状态下啥也没有，希望首次打开能听到一首歌，有封面、有歌词。曲目指定
《Everything's Alright》（网易云 id `1460626792`，塞壬唱片-MSR / DJ OKAWARI / 澤田かおり），
单独放一个歌单「塞壬唱片」。

**不打包任何媒体资源。** 只走我们自己的在线取源（`music/go` 跳板 + Meting 节点），
所以不涉「随包再分发」的授权问题；音轨/封面/歌词都按常规在线曲目那套懒加载。

另：有了欢迎歌，舞台的「点…＋ 添加」空态引导就不再出现（它只在无当前曲目时显示），
所以新用户会失去「＋ 在哪」的指路。罐头拍板：把这条指路并进首次卡，点「知道了」永久消失。

## 首次卡（合并「怎么加歌」）

原 `#firstRun` 只是一张 cookie 说明卡（「想听到完整音源？」）。现在合并成一张欢迎卡：

- 标题改「欢迎使用小花音乐播放器」；
- 新增一行 `#frAddHint`：「想加歌：点<位置>，可以用链接、本地文件或文件夹添加。」
  其中位置由 `importSpotText()` 按布局给（长卡「下方播放列表里的 ＋」/ 窄卡与独立窗
  「右下角队列里的 ＋」）—— 与空态引导语 `emptyImportHint()` 共用同一份口径，避免漂移。
- 打开时 `fillFirstRunAddHint()` 填一次；换布局时若卡还开着也重写（`applyLayout` 的
  `formChanged` 分支，与 `refreshEmptyHint()` 并列）。
- cookie 那两行原样保留。

**注意**：卡上**没有**加 `aria-modal` / 焦点接管 —— 那是待办里被罐头否掉的第 5 项，
本轮不扩大范围（`role="dialog"` + `aria-labelledby` 照旧）。

「知道了」→ `closeFirstRun(true)` → `storeSet(FIRST_RUN_KEY, 1)`，**永久消失**（沿用既有 key）。

## 实现

`ui/app.js`：

- 新增常量 `WELCOME_KEY = 'player-welcome-seeded'`、`WELCOME_LIST_NAME = '塞壬唱片'`、
  `WELCOME_TRACK_ID = 'netease:1460626792'`。
- `welcomeTrack()` 返回一首标准在线曲目形状（`url` = `API + '/widget/api/music/go/1460626792?server=netease'`，
  带 `pic` 封面与 `dur: 250`），与链接导入 / 搜索结果同一形状，不需要任何新后端。
- `maybeSeedWelcome(read)`：**闸门卡得紧**，与首次 cookie 提示同一条纪律 ——
  1. `SHOT`（截图模式）不播；
  2. `read.ok !== true`（存储读不到：宿主未就绪 / 纯浏览器）不播；
  3. `read.value`（播过）不播；
  4. `state.tracks.length`（已有曲目）不播 —— 不碰用户数据。
  全通过才：建「塞壬唱片」导入列表（`nextImportId()`，排切换条最后）→ `mergeTracks` 放一首 →
  `savePlaylist()` → `storeSet(WELCOME_KEY, 1)` 打标 → `activeList` 切到它 →
  `loadAudio(wt, 0, false)`（**默认待播放，不自动出声**）→ `persistNow()`。
- `boot()`：在 `storeRead(FIRST_RUN_KEY)`（首次提示）旁并列一条
  `storeRead(WELCOME_KEY).then(...)`，且用 `listsLoaded` 标记把「播放列表确实读到」与
  「读到空」区分开 —— 加载失败（`listsLoaded = false`）时绝不播种，免得把一次网络抖动
  当成「全新安装」，往用户的真空列表里塞歌。
- 测试探针 `welcomeSeedTry(read, scenario)`：在 state 快照上造场景跑完还原，不污染主夹具；
  `scenario = 'empty'` 模拟全新安装（清空 tracks、activeList 回 fav）。

## 行为边界（罐头拍板）

- 删掉「塞壬唱片」歌单、或后来把列表清空后，**不再补回**（标已打）。
- **不自动进「我的喜欢」**（`favCount === 0`）。
- 默认待播放：首屏能看到封面与标题、歌名在队列里，点播放键就响；不抢用户注意力自动出声。
- 用户之后导入的无封面歌曲仍用现有斜纹兜底，斜纹暂不删。

## 验收

`node tools/verify-ui.mjs` **310/310** 断言（新增 4 条：欢迎歌 2 条 + 首次卡 2 条）、
布局 12/12、窄卡 4/4、零运行时错误。

- `welcome-song-seeds-once-when-empty`：四个场景一次验完 —— 有曲目/读不到/播过都不播，
  空且未播才播；且播出来的那条 `listName === '塞壬唱片'`、`trackId === 'netease:1460626792'`、
  `url` 走 `music/go/1460626792?server=netease`、`activeList` 落到该歌单、`favCount === 0`。
- `welcome-song-not-reseeded`：标已置后再点 → 不重复播，也不把空列表重新填满。
- `first-run-card-teaches-how-to-add`：首次卡弹（未读过）且标题/位置句正确（当前宽窗 →
  「右下角队列里的 ＋」）。
- `first-run-card-hint-follows-layout`：宽窗→长卡后，还开着的卡里位置句变「下方播放列表里的 ＋」。

后端未碰（仍 22/22）。`tools/verify-backend.mjs` 与既有单测无关。

## 部署

2026-10-12 部署回路（AGENTS.md §4）：

1. `node tools/bump-build.mjs`（1003131663 → 1003131664 → **1003131665**，同步 `_build.json` + 两个 html）。
2. 整包同步 `ui/`（app.js / index.html / standalone.html / style.css / _build.json）进
   `~/.hanako/apps/hanako-simple-player/ui/`。
3. `extension_manager reload app:hanako-simple-player`。
4. 核对：宿主快照 `~/.hanako/.cache/app-ui-snapshots/.../snap-BHFXWB/` 的 `_build.json` = `1003131665`，
   `index.html` 能 grep 到「欢迎使用小花音乐播放器」，`app.js` 有 `importSpotText`。

⚠️ 尚未真机复核。真机看点：首屏是否看到「塞壬唱片」+ 封面 + 点播放是否出声 + 歌词是否出来；
首次卡位置句是否符合当前布局；点「知道了」后重开是否不再出现。

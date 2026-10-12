# AGENTS.md · hanako-simple-player

这是 **Hana v2 App「音频播放器」** 的源码仓库。
**这不是宿主安装目录**——安装目录是 `~/.hanako/apps/hanako-simple-player/`，那是部署目标
（宿主会把它快照进 `.cache/app-ui-snapshots/`），别把它当工作区。

**许可证是 AGPL-3.0，不是 MIT。** 本仓是 [openhanako-labs/openhanako-audio-player](https://github.com/openhanako-labs/openhanako-audio-player)
（AGPL-3.0）的**衍生作品**，必须同证分发：别改回 MIT，也别把它当可以闭源/商用的东西
（要闭源得上游的商业授权）。README 与 `LICENSE` 已按 AGPL-3.0 写好。

**远端与分支**：本地 `fork` remote 指 `wqh0201-stack/openhanako-simple-player`（2026-10-09 起常驻）。
`hana-simple` 是**本仓这版**、也是 fork 的默认分支；`master` 是上游原样；
`fix/same-origin-audio-proxy` 是给上游的 PR 分支（基于上游 master，与本版历史不相连）。
推送：`git push fork hana-simple`。

---

## 0. 动手前先读技能：Hana App 的官方做法都在 `hana-app-creator` 里

本仓库的代码是**一个 Hana v2 App**。凡是涉及 App 本体的东西——manifest、SDK、
卡片（card）、窗口（window）、surface、权限与审批、安装/重载生命周期——
**先读技能，别凭记忆、也别从旧代码反推**：

| 要什么 | 在哪 |
|---|---|
| 技能入口 | `~/.hanako/skills/hana-app-creator/SKILL.md` |
| 打包的 Builder 工作流（隔离开发 / 卡片交互 / reload 检查） | `~/.hanako/skills/hana-app-creator/references/builder.md` |
| 完整契约（宿主权威，最新） | `~/.hanako/artifacts/server/<ver>/APPS.md`（英文 `APPS_EN.md`） |
| 环境自检 | `node ~/.hanako/skills/hana-app-creator/scripts/check_env.mjs` |
| 静态校验 | `node ~/.hanako/skills/hana-app-creator/scripts/validate_app.mjs --dir <app> --json` |
| 打包 | `node ~/.hanako/skills/hana-app-creator/scripts/pack_app.mjs` |
| SDK 类型包 | `~/.hanako/skills/hana-app-creator/assets/sdk/*.tgz` |

技能里跟本 App **直接相关**的几条（要点，细节回技能原文）：

- 聊天里的 v2 App iframe/webview 卡片要**按可用的聊天列宽设计**。
  `hana.ui.resize({ width })` 会被宿主分配的上限卡住；`hana.envelope`
  报告当前分配、随布局变化——**不要假设固定像素上限**。
- App 自有窗口：`await hana.ready()` 之后用公开的 `hana.window` API。
  自定义标题栏 = `chrome: "custom"` + `control("toggle-fullscreen")`；
  普通 iframe 没有原生窗口桥。
- `runTool` 只是窄口径直测（空会话/消息上下文），**不代表真实会话**，别拿它当验收。
- 安装生命周期：声明了哪些受保护能力，`defineApp` 第一次回调前就生效，
  别加定时器/重试去等授权。reload 立即应用普通本地编辑；只有 manifest 扩权
  才需要重新审批（取消则旧实例继续跑）。
- 沙箱禁用清单（`position:fixed`、直接 `localStorage`、`window.open`、表单提交、
  重复文档外壳、字号 < 11px …）以技能为准。

---

## 1. 这个 App 是什么

- 音频播放器：本地/在线播放、歌词（自动匹配 + 逐字 + 离线库 + 会话横幅）、
  黑胶唱盘 / 文字 PV / 歌词三模式、配色主题与音频反应。
- 前端是**单文件** `ui/index.html`（+ 孪生 `ui/standalone.html`），**无构建步骤**
  （没有打包器，改完直接跑）。这是历史包袱，**重构也要保持单文件**。
- 后端 `index.js` + `lib/`（routes / meting / cookies / state），前端通过
  `/api/apps/hanako-simple-player/routes/...` 与一批旧的 `/widget/api/...` 调它。
- 两种承载，尺寸都由宿主给、且会变：聊天卡片（实测约 465×930）、
  独立窗口（`manifest.json` 里 `detachedDefaultSize` = 1040×780，可缩放）。

## 2. 硬约束（踩了必炸）

1. **孪生文件**：`ui/index.html` 与 `ui/standalone.html` 内容必须一致，
   **只差那 5 行 AudioContext 调试块**（`window.__reactiveState`）。改一个必须同步另一个。
2. **构建号**：改完跑 `node tools/bump-build.mjs`，它同步 `ui/_build.json` +
   两个 html 里的 `window.__HANA_BUILD`。
3. **PV 块是生成物**：`ui/index.html` 里 `PV:BEGIN` 与 `PV:END` 之间由
   `node pv/build.mjs` 生成，**别手改**（下次构建会冲掉）。PV 源在 `pv/`。
4. **宿主快照 UI**：宿主在 app 加载时把 `ui/` 拷进
   `~/.hanako/.cache/app-ui-snapshots/`，之后只认快照——**改了文件不会自动生效**，
   要重载 app。
5. **宿主/沙箱**：不用 `position:fixed`；聊天卡片里右上角 **100×40 CSS px**
   是宿主控件安全区（别放文字/控件）；**顶部两角要圆**——宿主只在独立窗里把 App 面
   裁圆（iframe 吃 `--radius-lg`），卡片里不裁，所以卡片壳自己补（见 §6）；无外描边/
   外阴影；**禁 emoji**（用 SVG 线描）；字号**不低于 11px**；颜色走 CSS 变量、不硬编码。

## 3. 目录

```
hanako-simple-player/
├── manifest.json          # v2 清单：cards.player，route /index.html，
│                          #   detached /standalone.html，1040×780
├── index.js               # v2 App 入口（apply(ctx)）
├── lib/
│   ├── state.js           # 播放状态
│   ├── register-routes.js # 后端路由（含 /widget/api/... 旧路径，别改）
│   ├── register-tools.js  # 暴露给模型的工具
│   ├── meting.js          # 在线音源（多节点降级）
│   └── cookies.js         # 读取 app-data/cookies.env
├── ui/
│   ├── index.html         # ★ 主 UI（单文件，约 1.8 万行）
│   ├── standalone.html    # ★ 孪生（只差 5 行调试块）
│   ├── _build.json        # {"build":"..."}
│   ├── sdk.js             # 宿主 SDK
│   └── face-portrait.png
├── pv/                    # 文字 PV 引擎源（src + css）；build.mjs 生成 PV 块
├── themes/                # default / spectrum / waveform 三个可视化主题
├── tools/                 # bump-build.mjs 等
└── docs/REFACTOR-BRIEF.md # ★ 前端重构交接简报（开工前先读）
```

app-data（`~/.hanako/app-data/hanako-simple-player/`：`playlist.json` /
`cookies.env` / `lyrics/`）**不在本仓库**，安装/重装不碰它。

## 4. 部署回路

1. 在本仓库改。
2. 同步 `ui/` 进 `~/.hanako/apps/hanako-simple-player/`；
   **或**更省事：把本仓库装成本地来源
   （`extension_manager install`，source `local`），以后能直接 `reload`。
3. `node tools/bump-build.mjs`。
4. **重载 app（必须，别省）**：`extension_manager reload app:hanako-simple-player`。
   页面**不会**自己刷新 —— `index.html` 里只写了 `window.__HANA_BUILD` 标记，**没有** _build.json
   轮询块，光同步文件不生效。忘了这步 = 罐头看到的还是旧版。（2026-10-10 踩过：只推了文件没 reload，
   罐头以为没生效；更早一次还漏同步 CSS → `.cell` 退化成块级、元素竖堆。）

> 一句话：**改完 → 同步 `ui/` 整包（index/standalone/style/_build）→ `reload` app**。三步缺一不可。

## 5. 当前任务

**前端重构 + 极简版接线**。原型（`docs/player-ui/`）已落进生产 `ui/`，接线完成并部署。

- 交接与结论：`docs/player-ui/WIRING-DONE.md`（宿主主题变量、旧列表 searchKey 形状、部署回路）
- 多歌单改造（列表精简 + 顶部切换 + 本地固定文件夹 + 夜间兜底）：`docs/player-ui/REFINE-DONE-LISTS.md`
- 第二轮（四项拍板 + 拖进/拖出生命周期修复）：`docs/player-ui/REFINE-DONE-LISTS-2.md`
- 第三轮（来源重做 + 歌单真名 + 歌手补齐 + 歌单可删）：`docs/player-ui/REFINE-DONE-SOURCES.md`（**未部署**，等审）
- 第四轮（封面环境色：读封面右缘像素 → 竖向渐变铺满 + 歌词两态薄纱 + 封面右缘 mask）：
  `docs/player-ui/REFINE-DONE-AMBIENT.md`；深色封面夹具由
  `node tools/make-fixture-covers.mjs` 生成
- 第五轮（动效复审修复 + 频谱真律动）：`docs/player-ui/REFINE-DONE-MOTION-2.md`（**已部署**，构建号 1003131565）。
  要点：歌词/频谱交叉淡入淡出、队列退场（含矮卡整页交叉）、指针悬停不再重置自动回归；
  频谱接真音频需**同源媒体** → `music/go` 改分片流式代理（原理见知识库
  `20-资料/Web Audio 频谱反应-同源媒体与CORS陷阱.md`）
- 歌单改名不持久化修复：`docs/player-ui/REFINE-DONE-RENAME-PERSIST.md`（**已部署**，构建号 1003131567）。
  根因：`boot()` 早于 `sdk.js` 执行，`window.hana` 未就绪 → 读存储永远 null，
  回写默认名把真名冲掉（详见知识库 `20-资料/Hana App 卡片UI-主题变量与存储接线.md`）
- 系统「正在播放」接线（macOS 控制中心 / 媒体键）：`ui/app.js` 的 `syncMediaSession()`
  （挂在 `renderTrack()`）+ `syncPositionState()`（`timeupdate` / `seeked`）+ 一次性
  `bindMediaSessionActions()`（play/pause/上下曲/seek/stop）。**封面必须同源**：
  跨源图会被 Chromium 静默丢弃（面板退回占位图），所以加了 `lib/register-routes.js`
  的 `/widget/api/music/cover` 代理路由，artwork 只吃它。**已部署**，构建号 1003131572
  （封面 2026-10-09 真机确认）。
  原理与坑：知识库 `20-资料/macOS 正在播放-Web App 接线（mediaSession）.md`。
  2026-10-09 真机验收：面板标题/歌手/封面 + 上一曲/下一曲 + 媒体键（F7/F8/⏯）全部可用。
  仅剩边界：宿主自己出声时的面板归属（音频焦点之争）。
- 随机播放的「上一曲」修好了（原来也随机到另一首）：随机模式里留一条「听过的路」
  （uid 栈，`shuffleTrail`），上一曲先弹当前再取末尾，走空则退回顺序上一首；
  下一曲仍随机（罐头要的手感）。栈随 playback-state 快照落盘。**已部署**（随红心那轮带上），
  交接见 `docs/player-ui/SHUFFLE-PREV.md`（只有 `ui/app.js` 一个文件）。
- 红心挪常驻位 / 歌词开关删除 / 自动居中（2026-10-09，**已部署**，构建号 1003131578）：
  ① 控制条最左那颗「歌词」文字按钮删掉，原位换成红心「喜欢」（`#favBtn`，`.fav-text`）——
     三种布局常驻，永远够得着（之前只有队列行 + 播放页 meta 两处，队列滚走就点不到）。
     队列行 / 播放页两处保留。**修了一个真 bug：播放页 `#stageFavBtn` 一直是空标签**
     （只有外壳没 `icon()`），肉眼看不见 —— 现在 `renderTrack()` 里补 `icon('i-heart')`。
  ② 未点亮的空心线条改用**撞色 `--hl-accent`**（与歌词当前句高亮同一套），
     否则在封面上太淡看不见。三处入口共用。
  ③ **歌词显隐开关整个删除**（`state.lyrics` / `lyricsVisible` / `renderLyricToggle` / 自检里的
     `lyricToggle` 引用全清）。新逻辑：**有词就显歌词、没词才出频谱**（频谱降为兜底）。
     `data-lyrics` 保留为常量 `'1'` —— CSS 换层动画以它做命名空间，**别删**。
  ④ 切列表 / 切歌时用 `centerCurrentInQueue()` 把正在播的那首滚进队列可视区中部。
     点心/移出等重渲染**不触发**，不抢用户滚动位置。
  断言：`control-bar-fav-toggles` / `queue-center-on-list-switch` / `stage-fav-toggles-and-syncs-row`
  （含图标存在性）—— 验收计数升到 **68/68**。
- 跨源安全 + 歌词兜底（2026-10-09，**已部署**，构建号 1003131580）：
  ① **拆一颗真雷：跨源音频接 `createMediaElementSource` 会输出全零（真·静音）**。
     它是单程票（不可逆），而全曲共用一个 `<audio>`，一次建链后所有跨源歌一起哑。
     改成 `audio.captureStream()` → `MediaStreamSource` → `Analyser`（副本增益 0，不叠音）：
     同源能读数据；跨源直接抛 `SecurityError`，被捕获后**元素照常出声**、退 `is-reactive`
     回 CSS `specPulse`。`loadAudio` 换源时调 `resetReactive()`，允许同源/跨源交替。
     （实测：同源 `fmax=255`；跨源 `createMediaElementSource` 下 `fmax=0/dev=0` 无报错，
     `captureStream` 下抛错但播不断。）断言 `reactive-uses-captureStream-not-mediaElementSource`。
  ② 歌词降级链尾部新增**跨源兜底**：本平台/本 id 没词时，拿「标题+歌手」去其余 4 个平台
     搜一次，`pickLyricHit` 按「标题完全相等 / 部分包含+作者对得上」接受（宁缺毋滥，
     只在 `mode==='在线'` 与当前无词时触发）。断言 `lyric-crosssource-match-rules`。
     ⚠️ 别改回 `createMediaElementSource`：跨源会静音且不可逆（原理与实测见
     知识库 `20-资料/Web Audio 频谱反应-同源媒体与CORS陷阱.md`）。
- 搜索页（罐头最初需求，2026-10-09，**已部署**，构建号 1003131584）：
  ① 左下角控制条那块（`.controls-info`，原本显示歌名/歌手 `ciTitle`/`ciArtist`）换成**搜索入口**，
     仅独立窗口（`data-layout="wide"`）显示（窄卡/长卡控制条本来就没这格）。`ciTitle`/`ciArtist` 已删。
  ② 新增**搜索页**（`#searchPage`，整页浮层盖住 stage+controls）：输入框 + 5 平台选择 +
     **搜歌曲 / 搜歌手**范围切换 + 结果列表（每行「加入」）。结果归入**当前激活列表**，
     本地/我的喜欢时新建/复用名为「搜索」的导入列表（与 `resolveImportTarget` 同口径）。
  ③ **热门推荐**：搜索页空白时预置，后端新路由 `/widget/api/music/hot` 走网易云官方
     `/api/personalized/newsong`（`music.163.com` 已在白名单），拉不到静默回空。
  ④ 竞态：`loadHot` 与 `doSearch` 共用代次 `searchSeq`，热门回填不覆盖用户已发起/已输入的搜索结果。
  断言：`search-entry-visible-in-window` / `search-entry-hidden-in-card` / `search-page-lists-results` /
  `search-add-into-active-list` / `search-page-esc-closes` / `search-scope-song-and-artist` / `search-hot-recommendations`。
  动效/视觉沿用现有语言（同一条 cubic-bezier、轻位移不抢镜、统一按压反馈、reduced-motion 退为纯淡入）。
  后端 `verify-backend.mjs` 仍 10/10（新增路由不改既有单测）。⚠️ **搜索结果会引入非网易云曲目**，
  即前面那颗「跨源静音雷」的真实验证场景。
  **后续修正（2026-10-10，罐头真机反馈，构建号 1003131588）**：
  ① 搜索页从「盖整卡」改为**只盖舞台**（移到 `.stage` 内）—— 底部控制条全程可见可用（断言
     `search-page-not-cover-controls`）。
  ② 「加入」改为**直落「我的喜欢」**（不再落当前歌单 / 新建隐形「搜索」歌单）—— 搜索心智 = 收藏，
     与红心一致（断言 `search-add-goes-to-fav`）。
  ③ 推荐区：热门歌曲限 **6 条**（多了会把下面顶出屏）、榜单/歌单/电台改**横滑一行**——三块一屏可见。
- 搜索页交互定稿（2026-10-10，**已部署**，构建号 1003131590）：
  ① **抽屉式探出/收回**：左下角搜索入口点一下从**左侧**滑入、再点一下滑出（与队列抽屉同一套
     `cubic-bezier(0.22,0.61,0.36,1)` + `is-s-leaving` 延迟卸载，可打断）。
  ② **层级**（罐头拍板）：**队列抽屉(30) > 遮罩(28) > 搜索页(22) > 歌词/封面**。搜索页开时队列仍能呼出、
     且压在其上。
  ③ **分层返回**：搜索页内「返回」/ Esc 按层级退 —— 详情层（搜索结果/榜单/电台）→ 推荐区根层 →
     再按才退出搜索（标签随层级变「返回 / 收起」）；左下角入口按钮**直接** toggle 退出。
  ④ **占位词当无词**：歌词源回的「这似乎是一首纯音乐呢」「纯音乐，请欣赏」等占位句
     （`lyricIsPlaceholder`，只看前 3 句）视作无词 —— 不再占歌词层，回到封面 + 涟漪；
     且不落盘（避免下次读离线库又当它有词）。
  断言：`search-entry-toggles` / `search-back-layered` / `lyric-placeholder-treated-as-empty`。
- 「最近播放」（2026-10-10，**已部署**，构建号 1003131592）：新增固定列表 `recent`（罐头拍板）。
  ① 排序：我的喜欢 → **最近播放** → 本地 → 导入歌单；命名/不可删/不可重命名同 fav。
  ② `recordRecent()`：**任何来源**播过的歌自动记进去（不只是搜索），按稳定 id 去重，
     最近的在最前（重播则移到末尾），上限 100 条（超出丢最旧，不丢正在播的）。
     在 `playTrack()` 里换曲时调，`detached` 临时条目不记。
  ③ 搜索结果/热门行主体（`.search-hit`）**点一下直接播**（不必先加入）——
     播完自动进最近播放，所以不建永久列表也能在队列看到它。不切激活列表（不打断搜索上下文）。
     （行尾那颗按钮的最终形态见下条：由「加入」改为红心。）
  断言：`search-hit-plays-directly` / `recent-list-records-played`；迁移断言加入 recent 空列表。
- 搜索行尾「加入」→ 红心 + 涟漪改版（2026-10-10，**已部署**，构建号 1003131594）：
  ① **加入 = 心**（罐头拍板）：搜索结果 / 热门推荐行尾按钮由「＋加入」文字改为**红心**，
     与队列行红心同一套视觉（未点亮撞色描线、点亮实心）。加入 = 收藏到「我的喜欢」，
     与红心本就是同一件事（之前错把它和「点行播放」并成一个动作，已纠正）。
     顺带移除 `_inList` / `markSearchInList` / `hotSongInList` 这套「已在列表」旧机制——
     红心状态直接由 `isFav()` 现算。
  ② **播放 ≠ 喜欢**（罐头拍板）：点行主体**只播放**，不落喜欢；播过的仍自动进「最近播放」。
  ③ **涟漪改版为「等高线波场」**：指针涟漪整层重写为双缓冲高度场 + 等高线 + 压扁圆环，
     照 `docs/player-ui/ripple-lab.html` 移植；仍**不读音频**。层序 z-index 2 → 3
     （薄纱之上、文字之下），强度两档（有词收 1.0 / 无词放 1.9，由 `data-haslyrics` 决定）。
  断言：`search-fav-toggles-fav`（原 `search-add-goes-to-fav`）/ `play-does-not-fav`。
- 控制条重排：搜索/队列对称 + 歌名回控制条（2026-10-10，**已部署**，构建号 1003131597）：
  ① **搜索与队列两端对称**（罐头拍板）：搜索入口从左侧竖列（原 `.controls-info`）挪进按钮行
     最左端，收成**纯图标**；最右的队列也收成**纯图标**（宽窗隐藏 `.qb-label`，数字/「正在播放」
     提示不再占位）。两端同高、左右呼应。
  ② **歌名回到控制条**（罐头拍板）：把 `f2c7269` 那步删掉的歌名加回来 —— 新元素 `#ctlTitle`
     （在 `renderTrack()` 里跟当前曲同步），**固定宽度**（`flex: 0 0 240px`，长短歌名不影响右侧，
     超出省略号）；只显示歌名一行。
  ③ **大卡片专属**：搜索图标与歌名都只在 `data-layout="wide"`（独立窗口）显示；窄卡/长条不显示
     （那里本来就没搜索这格）。`.controls-info` / `.ci-title` / `.ci-artist` 旧规则已删。
  ④ **三段式网格 = 播放键钉在底栏正中**（罐头拍板，2026-10-10，**已部署**，构建号 1003131606）：
     `.btn-row` 改回 `display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)`（`a7fa4ad` 原版写法），
     三格 `.cell-left/.cell-center/.cell-right`：左格 `[🔍 歌名 ♡ ⟳]` 贴左、中格 `[⏮ ▶ ⏭]`、右格 `[🔊 | ☰]` 贴右。
     两翼 1fr 等宽 → 中格恒居中，**播放键固定落在底栏正中**，不受左右内容宽窄影响（`ctl-play-centered-wide` 断言 <2px）。
     踩过的坑：中间曾改扁平 `flex + space-between`，播放键会漂到 ~60%；且**部署只同步了 HTML、漏了 CSS** →
     `.cell` 无样式退化成块级、元素竖着堆（罐头看到的「左右各挤成一坨」）。**部署必须整包同步 index/standalone/style/_build**。
  断言：`search-entry-visible-in-window`（改判自身 display + 位置）/ `ctl-endpoints-symmetric-wide` /
  `ctl-play-centered-wide`（新，播放键居中）/ `search-entry-hidden-in-card` / `ctl-title-hidden-in-card`。
- 推荐区（2026-10-10，**已部署**，构建号 1003131585）：搜索页空白时开**三个推荐区**
  （罐头要「两种都要」）——
  ① 热门推荐（歌曲，可逐首加入）；② 榜单 · 歌单（点开拉前 30 首）；③ 热门电台（点开拉节目）。
  后端四个新路由（均走 `music.163.com` 官方接口，已在白名单；拿不到静默回空）：
  `/widget/api/music/hot`（已有）、`/charts`（toplist + personalized/playlist）、
  `/chart-tracks`（v6 详情取曲目）、`/radios`（djradio/recommend/v1）、
  `/radio-programs`（dj/program/byradio，**必须带 Referer** 否则 code:-462）。
  电台节目音轨（`mainSong.id`）走 Meting `type=url` 跳板即可播（302 → `*.music.126.net`，与普通歌同路）。
  ⚠️ 电台是**播客长音频**（约 50 分钟/期），时长/歌词/频谱按歌设计，真机播放手感需单独验。
  接口实测矩阵（含哪些端点走不通）见知识库 `20-资料/网易云热门榜单与电台接口实测.md`。
  断言：`search-discover-three-blocks` / `search-chart-opens-tracks` / `search-radio-opens-programs`。
- **悬停抬升（发光）**（2026-10-10，**已部署**，构建号 1003131622，罐头拍板）：罐头给了张截图（音量键悬停态），
  要「像音量条那样发光」，不要现在那块 `--hk-hover` 灰底。新增一组 `--hv-*` token（定义在 `.player`，不是 `:root`——要吃作用域里的 `--hk-*`）：
  ① **两档强度**：`--hv-surface`/`--hv-ring` 给辅助位；`--hv-surface-strong`/`--hv-ring-strong`
     给中央三键与播放键（更强一档，焦点仍在播放键）。
  ② **两种物理**（`.player[data-tone]` 切）：深底（默认）真发光——表面提亮并染一档强调色 + 同色外辉 + 内辉；
     浅底用影——表面提到近白 + 同色柔光 + 软投影。**浅纸上的白光晕不成立**（比纸更亮就是白，加到极限也看不见），
     所以浅底必须是「浮起来」而不是「亮起来」；手感一致，借的力不同。
  ③ **光色 = `--hk-accent`，不跟封面**：控制条与队列是常驻面板不是沉浸区，封面换歌就换色的话按钮会跟着晃；
     封面主色的撞色只留给 `--hl-accent` 那族（歌词当前句 / 红心描线）。
  ④ **`data-tone` 按底色亮度算，不猜主题名**（`resolveTone()` 读 `--hk-surface` 算 WCAG 相对亮度，`>0.5`→light）：
     宿主主题 id 有十来个（`high-contrast` 是浅色主题、名字里没有 light），`data-theme` 只有 light/dark 两种写法，靠名字判会误判。
     接线在 `renderAll()` 开头 / `applyHostTheme()`（forced + 订阅回调，两个 setTimeout 盖异步拉样式表）/ boot 的 `sdkReady.then`，
     另听 `matchMedia('(prefers-color-scheme: dark)')` 的 change（**没宿主主题时** macOS 切深浅不派主题事件）。
  ⑤ **列表行只极轻提亮、不整行发光**（整行光会变成一条条亮带），光只给行内图标；
     且队列容器有 `overflow` 裁切 → 行内图标走 `--hv-ring-icon`（以 inset 为主、外扩收一档）。
  ⑥ **播放键不再缩放**：旧 hover 是 `transform: scale(1.025)`，改成只发光 —— 换位 FLIP（WAAPI）与红心 `heartPop`
     都用 transform，hover 缩放会跟它们抢同一个属性。
  搜索页的悬停**没动**（罐头明确说不用改）。断言新增 `tone-matches-surface-polarity` / `hover-glow-replaces-gray` /
  `hover-glow-on-all-controls` / `hover-glow-two-tiers`，验收 **114/114**（布局 12/12、窄卡 4/4、零运行时错误）。
  目视脚本 `node tools/shoot-hover.mjs`（真悬停＋按元素矩形裁图，深浅四种组合）。
  **2026-10-10 真机已复核（罐头确认「都 ok」）**：深底发光、浅底浮起两套物理都成立，播放键与辅助键的
  强度分层也成立（主键没被抢戏），列表行内图标的光未被容器裁边。
  交接：`docs/player-ui/REFINE-DONE-HOVER-GLOW.md`；原理与坑见知识库
  `20-资料/深底用光浅底用影-悬停态在两种底色上.md`（含「伪类读不了 `getComputedStyle(el, ':hover')`，断言得扫样式表」）。
- 空列表引导语指错了地方（2026-10-11，**已部署**，构建号 1003131623，罐头反馈）：
  「没有任何曲目时提示词不对，应该是点击下方播放列表里的 + 号添加」。
  根因：这句写的是「用右上角的 ＋ 导入」—— 那个方位是极简版早期的，控制条重排 + 队列
  改成面板头部之后早就不成立；而 `＋`（`#importBtn`）在队列面板头部，队列在三种布局里
  位置各异（长卡常驻下方 / 窄卡独立一页 / 独立窗右侧抽屉），一句话写死哪种都是错的。
  改为 `emptyImportHint()` 按布局给说法：长卡「点下方播放列表里的 ＋ 添加」，窄卡与独立窗
  「点右下角队列里的 ＋ 添加」；并在 `applyLayout()` 的 `formChanged` 分支 `refreshEmptyHint()`
  重写（拖窗换布局后方位跟着变）。断言 `empty-hint-names-the-right-place` /
  `empty-hint-follows-layout-change`（新增 `fixtureMode=empty` 夹具），验收 **116/116**。
  交接：`docs/player-ui/EMPTY-HINT-FIX.md`；模式已沉淀知识库
  `20-资料/UI 文案写死控件方位-结构重排就失效.md`（改控件结构后要 grep 方位词，别只搜 id）。
- **歌词标题精简 + 手动匹配**（2026-10-11，**已部署**，构建号 1003131637，罐头需求）：
  两条需求 —— ① 加个动作把标题精简后再匹配；② 允许用户自己改关键词适配。
  **先厘清：根因不在匹配算法，在喂进去的名字本来就是假的。** 用真实 B站搜索结果验实三条假设
  （B站无数字 id / `author` 是 UP 主 / 标题尾巴没清），并挖出**更靠上游的元凶**：
  跨源兜底原样拿 `[title, author].join(' ')` 去搜 —— 实长「【4K珍藏】南拳妈妈《下雨天》MV极致修复！… 郭总说」，
  **搜索这一步就废了**，改 `pickLyricHit` 只治一半（干净串「下雨天 南拳妈妈」一搜即中，已印证）。
  ① **`cleanLyricQuery(title, author)` 纯函数**：`《》` 优先（取第一个不在括号内的）→ 无书名号则去括号
     + 剥噪声词（4K/Hi-Res/无损/字幕/神作/助眠/合集…）→ 分隔符截断 → 抽歌手（紧邻书名号或分隔符、
     ≤8 CJK 字或 ≤3 拉丁词、不含数字符号；**取不到就空，宁缺毋滥**）。守卫：合集/串烧/纯音乐/伴奏 →
     `ok=false` 不自动兜底（「歌单」不算 —— 「循环歌单」会误伤）。
  ② **两端共用同一份**：匹配端 `pickLyricHit`（查询词与候选都过清洗）+ 关键词构造端 `crossLyric`
     （改走 `lyricQueryOf()` = 脏标题时**丢掉 UP 主**、净标题则歌名原样 + 保留真歌手）。
  ③ **手动匹配：单入口、有词不打扰**（罐头拍板，原「歌名旁常驻按钮」已否）。只在**确实无词**时
     歌词区正中出现胶囊按钮（挂 `.scene`，无词时 `.lyric-wrap` 是 `display:none` 塞不进）；
     **三态** `loading/ready/none` 只有 `none` 亮（防换曲闪一下）；纯音乐也亮。面板预填精简结果、
     可手改重搜；**绑定写 `raw.lyricMatch` 随 `playlist.json` 落盘**（拆窗贴回也在），
     下次换曲先试绑定再走常规链。
  断言新增 5 条（`lyric-query-cleaned-for-bili-titles` / `lyric-query-skips-collection-and-instrumental` /
  `lyric-dirty-title-matches-after-clean` / `lyric-ask-hidden-when-lyrics-present` /
  `lyric-match-panel-opens-and-prefills`），验收 **132/132**；后端未碰，仍 19/19。
  交接：`docs/player-ui/LYRIC-MATCH-DONE.md`。
- 无头验收：`node tools/verify-ui.mjs`（12/12 布局自检 + 4/4 窄卡 + **132/132** 断言 + 接线冒烟 + 迁移 + 跨文档生命周期（含「快照自带曲目」续播）+ 来源/真名/补齐/删除 + 红心/我的喜欢 + 环境色两态/兜底 + 动效五项 + 跨源安全/歌词兜底 + 歌词清洗/手动匹配 + 搜索页/推荐区 + 涟漪 + 控制条对称/歌名 + 切换条溢出/跟随 + 音量浮层 + 悬停抬升 + 空列表引导语）
- 图标工具：`node tools/measure-icons.mjs`（量每个 symbol 在 24×24 里的实际内容外接框）。
  改控制面图标尺寸前先跑它 —— 图标「看起来多大」取决于内容外接框，不取决于 CSS 框宽。
- 指针涟漪（2026-10-10，**已部署**，构建号 1003131586）：**旧「频谱」整层替换为 Canvas 2D 指针涟漪**。
  方案与行为约定：`docs/player-ui/RIPPLE-CANVAS-2D.md`（罐头拿提示词请教前端高手后的作品，已落地）。
  层序改为：封面(z1) → 涟漪(z2) → 蒙层(z3) → 歌词/标题(z4)；涟漪落在文字与蒙层下方，
  所以**常驻**，不再跟歌词互斥（无词时画面 = 封面 + 涟漪）。
  行为：指针移动累计距离才落波、按下更大一圈、播放且空闲时低频自起（呼吸波）；
  暂停约 350ms 收敛后停 rAF；截图/ reduced-motion / 隐藏 / 离屏全停调度；DPR 封顶 2。
  ⚠️ 当时**不读音频**（`captureStream` / `AnalyserNode` 整条链删掉），从根上避开跨源静音雷；
  2026-10-10 罐头改拍板**把音频接回来驱动涟漪**，见下方「涟漪接真音频」一条。
  断言：`ripple-layer-when-no-lyrics` / `motion-lyric-crossfade` /
  `motion-ripple-when-no-lyrics` / `motion-ripple-poke-adds-wave`。
  真机待验：浅深主题观感、三种布局下涟漪密度、歌词可读性是否受扰。
- 涟漪接真音频 + 流光（2026-10-10，构建号 1003131601）：
  ① 画法从「等高线」换「**流光**」：照 `docs/player-ui/ripple-lab.html` 的 light 模式移植——
    高度场当水面法线化成明暗、低分辨率放大成柔光（`paintField`）+ 压扁圆环。
    强度两档对齐 lab 的「波澜」滑杆：**无词 0.50 / 有词 0.32**。
  ② 音频反应：`<audio>.captureStream()` 另拷一路 → `AnalyserNode`（**fftSize 4096**、smoothing 0.65）
    → 40~180Hz 低频能量；超滑动均值 1.28 倍且够响 → 落一个波，力度由低频定。
    **只走 captureStream，绝不 `createMediaElementSource`**（跨源输出全零且不可逆）；
    跨源抛错则退回纯指针，绝不静音。同源靠 `music/go` 的分片代理。
  ⚠️ fftSize 是坑：沿用旧频谱柱的 128 时每 bin 有 344Hz 宽，40~180Hz 全挤进 bin 0，
    bass 恒 0、鼓点永不触发（看着「接上了」其实没反应）；4096（10.8Hz/bin）才通。
    详见知识库 `20-资料/Web Audio 频谱反应-同源媒体与CORS陷阱.md` §五。
  断言：`reactive-uses-captureStream-not-mediaElementSource`（源码级守卫）/ `motion-ripple-reactive-to-audio`。
  真机待验：真实网易曲目下的鼓点灵敏度（阈值 0.014 是 lab 的经验值）。
- 第六轮（舞台底部渐隐 + 顶部圆角，2026-10-09 罐头拍板）：
  ① `.scene::after` 的舞台底部渐隐**已整个撤掉**：先是从「固定 72px 刷主题面色」改成「按舞台高比例
     `clamp(36px, 9%, 72px)`、化进 `--ambient-color`」，真机看过之后罐头拍板**连这道也去掉** ——
     舞台底边直接硬切到控制条，全屏只留歌词那侧往左的淡入（`.lyric-scrim`）。
  ② `.player` 顶部两角自己补圆角（`14px 14px 0 0`，只上两角）—— 宿主只裁独立窗，
     卡片不裁；`.frame` 底色改 `--hk-surface`，让角上露出卡面色而不是页面色。
  断言 `bottom-fade-removed`（反断言，防回归）/ `top-corners-rounded` / `corner-reveals-card-surface`。
  详情 `docs/player-ui/REFINE-DONE-AMBIENT.md` §五-3
- 红心 / 我的喜欢（2026-10-09，**已部署**，构建号 1003131576）：
  新增固定列表 `fav`「我的喜欢」——排切换条**最前**、当默认首页（`state.activeList` 初值 `fav`）、
  **不可删**（长按不出浮层，`deleteList`/`openListPop` 都挡）、**不可重命名**（`startRename` 挡）。
  判定红心按**稳定 id**（`t.id`）而非 uid —— 同一首歌在不同列表 uid 不同，用 uid 会「原歌单点过、
  我的喜欢里灭」。加入 = 在 fav 放一份副本（`addFav` 借 `toStoredTrack` 保 pic/author/lrcUrl/raw）；
  取消 = 只摘 fav 那份（`removeFav`），原歌单纹丝不动；若正播 fav 那份，有其他副本则转指针，
  否则打 `detached`（播完不落盘）。入口两处：队列行右侧 `.q-fav` + 播放页 `.fav-btn`（meta 行内）。
  图标 `i-heart` 线描，点亮 `fill:currentColor` + 强调色。
  ⚠️ **fav 是「无归属」的额外列表**，会出现在切换条最前；与 `local` 一样不吃 `imp:N` 编号。
  断言 `fav-row-toggles-on` / `fav-list-collects-and-labels` / `fav-state-by-stable-id-cross-list` /
  `fav-unfav-keeps-original-list` / `fav-not-deletable` / `stage-fav-toggles-and-syncs-row`。
- **音源改回内置 + 首次 cookie 提示**（2026-10-11，**已部署**，构建号 1003131626，罐头拍板）：
  前情：一度把 Meting 节点抽成外置 `sources.json` + apply 脚本。**后修正**（见
  `docs/player-ui/SOURCES-BUILTIN.md`）：判据校准为「**只保证自己不加新的；公开可获取的没问题**」——
  那 4 个地址**上游仓库本就公开**（其 `master` 的 meting.js/manifest 就列着，我们 fork `master`
  与上游 SHA 一致），我们只是继承，写回合规；且内置后**装完即用**（白名单静态表，无需 apply 脚本）。
  ① **节点写回**：`lib/meting.js` 的 `NODES` 数组、`manifest.json` 的 4 个节点主机。
  ② **外置那套已删**：`lib/sources.js` / `sources.example.json` / `tools/apply-sources.mjs` /
     `.gitignore` 那条 / 搜索页导入入口与提示条。
  ③ **新增首次使用 cookie 提示**：一次性轻浮层 `#firstRun`（文案「想听到完整音源？」+「怎么填：
     问你的 Hana，或看 README」）。**只弹一次的判据卡得紧**：只有「存储确实读过且读到空」才弹；
     存储不可用/截图模式不弹（否则每次启动都骚扰）。断言 `first-run-notice-shows-once`。
  ④ 保留 `normalizeTrack` 的 `name/artist` 别名修复（外置那轮唯一真正有价值的改动）。
  验收：verify-backend 10/10、verify-ui（搜源 3 条已随外置一并撤，新增首次提示 1 条）。
- 音源改造（2026-10-10，罐头拍板「按你说的」，构建号 1003131604）：**删酷我/百度，接 B站**。探活结论见知识库《音乐音源探活与层级》。改动：
  ① `ui/app.js` 的 `SEARCH_SERVERS` 改为 网易云 / B站 / QQ / 酷狗（删酷我、百度；两处跨源回退列表同步）；`lib/meting.js` 的 `ALLOWED_SERVERS` 删 kuwo/baidu。
  ② 新增 `lib/bilibili.js`：搜视频抽音轨（search → view → playurl，选最高带宽 dash.audio）；`lib/register-routes.js` 的 `/music/search` 对 `server=bilibili` 走它，`resolveAudioUrl` 加 bilibili 分支（id=bvid，走 go 跳板同源分片代理），go 的 fetch 与 cover 路由对 B站带 Referer。
  ③ `manifest.json` allowedHosts 加 `api.bilibili.com`、`*.hdslb.com`、`*.bilivideo.cn`、`*.bilivideo.com` —— **属扩权，reload 需重新审批**。
  验收：verify-backend 10/10、verify-ui 89/89（布局 12/12、窄卡 4/4、wiring/migration/lifecycle 全绿、零运行时错误）。
  未做：QQ/酷狗仍「搜得到播不了」（公共节点无直链，要救需 cookie）；B站无 LRC 歌词源（退回无词）。
- 歌单切换条溢出（2026-10-10，**已部署**，构建号 1003131607）：歌单攒多了右端被硬切，看不出「后面还有」。
  ① **不加滚动条**（罐头拍板）：滚动条继续隐藏（`scrollbar-width:none` + `::-webkit-scrollbar{height:0}`），
     改在 `.list-tabs` 上**按需两侧渐隐**（`mask-image`，变量 `--tab-fade-l/r`，JS 依 scrollLeft 切
     `is-scroll-l` / `is-scroll-r`）—— 给的是「后面还有」的提示，不是滚动条。
  ② **切列表时当前项自动跟进来**：`ensureTabVisible()`（nearest 语义，只在激活项不可见时才滚），
     且**只在激活 id 真的变了时才滚**（`lastActiveTabId` 比对）—— 点心/移出等重渲染不抢用户手动滚的位置。
  ③ 鼠标竖滚轮映射为横滚（触控板/触摸本来就能横滑）；`ResizeObserver` 跟宿主改宽重算渐隐。
  断言：`list-tabs-overflow-fade` / `list-tabs-active-scrolls-into-view`（夹具 playlist 改成按 id 返回不同名，
  好造多个歌单撑溢）。
- 底栏左右翼均匀分布（2026-10-10，**已部署**，构建号 1003131608）：宽窗「两端各挤一坨」→
  左格 `space-between`（🔍·歌名·♡·⟳ 四项等距，歌名固定 160px）、右格 `flex-end` 成组（🔊—☰）；
  中格仍**只放**「⏮ ▶ ⏭」→ 播放键恒落正中。窄卡（`.cell{display:contents}` +
  `repeat(7,1fr)` + `justify-items:center`）按钮行展平 7 等分、队列收纯图标，play 也正中。
  ⚠️ 2026-10-10 起 **`.vol-group` 不再展平**（里面挂了音量浮层），见下方「音量：单按钮」一条。
  只动 `ui/style.css`（DOM 早就是三段式）；`ctl-play-centered-wide` / `ctl-endpoints-symmetric-wide` 未破。
  交接：`docs/player-ui/CONTROL-BAR-BRIEF.md`（给前端大师的底栏上下文）。
- 音量：单按钮 + 悬停向上弹竖条（2026-10-10，**已部署**，构建号 1003131609，罐头拍板）：
  旧「静音键 + 横滑条」（且滑条只在宽窗显示）→ **一颗按钮**：点 = 切静音，
  鼠标悬停（或键盘聚焦）**向上弹出竖向滑条**，移开即收。三种布局通用（窄卡/长卡同样弹）。
  ① 结构：`#vol` 从横条搬进 `.vol-pop`（`.vol-group` 的绝对定位子元素，父级加 `position:relative`）。
     `.vol-group::before` 是一道 12px 透明「连通悬停区」，补上按钮与浮层之间那 8px 空隙 ——
     否则指针上行时会 `pointerleave`、浮层中途收起。拖动滑条期间（`volDragging`）也不收。
  ② 竖条画法：**横向 `<input type=range>` 旋转 -90°**（`rotate(-90deg)`），轨道渐变
     「左→右 = 小→大」随之变成「下→上」，轨道/滑块样式直接复用 `.range` 那套，不另写。
     实测拖动映射正确（拖到 22% → `audio.volume` 0.22）。这条没碰音频链，与 `captureStream` 那套无关。
  ③ 皮跟现有浮层走（`--hk-surface` + `--hk-hairline` + `--hk-pop-shadow`，与 `.pop` 同款），
     动画：淡入 + 上浮 10px + `scale(.94)`，`cubic-bezier(.22,.61,.36,1)` 0.2s；
     reduced-motion 退为纯淡入。`z-index:25`（盖搜索页 22，压在队列 30/遮罩 28 之下）。
  ④ 窄卡 7 等分不受影响：`.vol-group` 仍算**一格**（只含按钮），只是不再 `display:contents`。
  ⑤ Esc 先收浮层（在搜索页/弹层之前）；`aria-expanded` 随开关同步。
  ⑥ **静音时滑条归零**、取消静音回原音量（构建号 1003131610，罐头反馈）：`renderVolume()` 里
     `shown = state.muted ? 0 : v` 只改**显示值**，`state.volume` 始终保留 → 取消静音原样回来，
     不必另存「上次音量」；拖动滑条仍走 `state.muted = state.volume === 0`。
  ⑦ **浮层 z-index 25 → 40**（构建号 1003131610，罐头反馈）：呼出歌单抽屉(30)时原会被盖住，
     现在压过抽屉(30)/遮罩(28)/搜索页(22)。（遮罩与抽屉只铺在 `.stage` 内，控制条在外，按钮一直够得着。）
  断言：`vol-pop-closed-by-default` / `vol-pop-opens-on-hover` / `vol-pop-above-queue` /
  `vol-vertical-drag-sets-volume` / `vol-click-mutes`（含滑条归零）/ `vol-unmute-restores-volume` /
  `vol-pop-closes-on-leave` / `vol-pop-opens-long` / `vol-pop-opens-compact`；
  自检新增 `vol-pop-hover-slider`（替换原 `control-visible:vol`）。
  交接：`docs/player-ui/REFINE-DONE-VOLUME.md`。
- **「静听 · 连续布局」控制条**（2026-10-10，**已部署**，构建号 1003131612）：按
  `docs/player-ui/QUIET-CONTROLS-HANDOFF.md` 把选定草图落进生产。底部从「三段式网格 + 窄卡七等分」
  改成**一张控制面**：常规高 100、特别窄 112，所有槽位绝对定位；三种尺寸只重排周边槽位，
  中央三键（上一首·播放·下一首）几何中心恒在面正中，全程 44×44、中心距 52/52、整组宽 148。
  ① **图标换 Lucide 形状**（11 个 symbol：search/heart/repeat/repeat-one/shuffle/prev/play/pause/next/list/close），
     许可 `ui/LUCIDE-LICENSE.txt`；线描 19/`1.65`、上下一首 18 实心 `1.3`、播放暂停 19 实心 `1.5`；
     **实心规则挂图标职责，不挂 `.transport`**（卡片被展平时才不会退成空心）。
  ② **槽位**：宽窗 `--ctl-pad:24`（搜索 `P+22` / 曲目信息 `P+52`+红心 / 模式 `C-112` / 音量 `C+112` / 队列 `W-P-22`）；
     长卡窄卡 `--ctl-pad:12`（搜索与曲目信息收起、红心落 `P+22`）；**特别窄（宽<400，`data-ctl="narrow"`）
     模式与音量上移一行**（时间线两侧）。400 独立于全局 `data-bar` 的 420。
  ③ **连续换位** `arrangeControls()`：跨断点量旧矩形 → 提交新布局 → WAAPI 反向位移回零 340ms，可打断；
     中央三键不做 FLIP。播放/暂停同位置双字形交叉；红心弹跳；切歌曲目信息入场；reduced-motion 全退即时。
  ④ **音量原样保留**（内部结构/交互/动效一律没动），只把外层提为绝对定位参与响应式。
     ⚠️ 坑一：`.vol-group` 自带 `position:relative`，当响应式槽位时必须显式 `position:absolute`，
     否则 `left/bottom` 变相对位移、按钮飘到控制条上方。
     ⚠️ 坑二：外层**绝不能给 `z-index`** —— 给了就成 stacking context，浮层里写的 40 只在罩内算数，
     出罩只剩外层的号；而浮层是往上长进 `.stage` 的，与搜索页(22)/遮罩(28)/抽屉(30) 几何重叠，
     结果滑条被盖住拖不动（罐头真机报的「抽屉打开动不了音量条」，构建号 1003131612 修）。
     断言不能只比 z-index 数字，得用 `document.elementFromPoint` 做命中测试
     （`vol-pop-hit-under-drawer` / `vol-pop-hit-under-search`）。
  验收：`node tools/verify-ui.mjs` **103/103** 断言（新增 `ctl-transport-geometry` / `ctl-flank-slots-wide`）、
  12/12 布局、4/4 窄卡、零运行时错误。交接：`docs/player-ui/QUIET-CONTROLS-DONE.md`。
- 控制面图标尺寸对齐（2026-10-10，**已部署**，构建号 1003131617，罐头真机反馈）：
  「除了播放键，图标大小不一致，音量显著偏小」。根因：图标框虽然都是 19px，但每个 symbol
  在 24×24 网格里**画的面积不同**（`node tools/measure-icons.mjs` 量的内容外接框）：
  search 18×18 / heart 20×17 / shuffle·repeat 20×20 / list 18×14 / **volume 14.7×12** ——
  所以音量在同一个框里看上去小一截。按「视觉外接框对齐到随机（shuffle，20 网格单位）」逐个换算框宽：
  search/queue **21**、mode（线描）**19**、prev/next **20**、volume/volume-mute **28**；heart 与 play 不变。
  只改 `ui/style.css`（三个槽位拆开给尺寸），几何与断言未破。
  **续（同日，构建号 1003131618）**：罐头再反馈两点 —— ① 音量弧线要随音量变（最低 1 条、
  最高 3 条，静音仍走 X）；② 28px 框下音量线太粗。重绘为 `i-volume-1/2/3`（扬声器不动，
  三档弧线**同心**，圆心 ≈ 扬声器嘴 (11.94,12)，半张角 40°，半径 3.8/6.5/9.2），
  `renderVolume()` 按 34/67 两档切图标。
  **再续（同日，构建号 1003131619）**：罐头说「音量还是比随机按钮小很多」——上一版按
  **最大边**对齐是错的判据：随机图标是满格的 20×20，音量天生扁（喇叭+弧），宽度一样也显小。
  改成把**喇叭本体画大**（9×15 网格单位，原 7.4×12）＋弧线同心外扩，框 **24px** +
  `stroke-width: 1.31`（描边按框宽反比缩，**渲染出来**才和别的图标一样细：19px×1.65 与
  24px×1.31 都 ≈ 1.31px）。**教训：图标「看起来多大」看视觉面积/高度，不看最大边。**
  断言 `vol-icon-levels`。验收 **111/111**。
- **点歌手名 → 直接搜这位歌手**（2026-10-10，**已部署**，构建号 1003131616）：
  罐头要的「点歌词上面的歌手直接跳转搜索」。**先厤清：搜索页从来不依赖宽窗** ——
  `.search-page` 是 `position:absolute; inset:0` 长在 `.stage` 里的，`.stage` 三种布局都有；
  有尺寸门槛的只是**入口**（控制条最左那颗 🔍，窄卡排不下）。
  ① 舞台歌手名 `#trackArtist` 从 `<p>` 改成 `<button>`：视觉不变，多一枚 11px / opacity .4
     的搜索字形（`.ta-go`）作提示；拿不到歌手时 `disabled` + `hidden` + 隐字形，不留能点的空壳。
     统一走 `setArtistLine(text, actionable)`。入口**零新增元素**（那行字本来就显示着，
     不占控制条一寸 —— 罐头拍板「元素平衡得刚好，不需要搜索按钮」）。
  ② 点它 = `openArtistSearch()`：关键词预填这位歌手 + 范围切「搜歌手」+ 立刻 `doSearch()`，
     一次点击到位；退出交给左上角「返回」（沿用分层返回）。
  ③ **拆掉 `applyLayout()` 里「离开宽窗就强收搜索页」那条守卫** —— 它的前提（卡片里开不了
     搜索页）没了，留着反而会在卡片里把用户刚开的页误杀（宿主 ResizeObserver 一抖就中）。
  ④ 窄卡（312×494）实测头部自然折三行（返回+输入框 185px / 平台条 / 范围），不横溢，
     控制条全程可见。先自然折，真机看过再决定要不要收一版头部。
  断言 `artist-line-inert-without-artist` / `artist-line-clickable-with-artist` /
  `artist-search-opens-and-searches` / `artist-search-usable-in-narrow-card`，
  验收 **110/110**。交接：`docs/player-ui/ARTIST-SEARCH-DONE.md`。
- **卡片里搜索页头部收矮**（2026-10-10，**已部署**，构建号 1003131620）：
  罐头真机反馈「窄卡里搜索页那三行头部会不会显高」—— 会。原来四行（返回+输入框+搜索 /
  平台条 / 范围 / 「结果」标签）约 137px，占掉那张 560×500 卡的三分之一舞台。
  ① **四行 → 两行**：平台条与范围并排（套了个 `.search-filters` 容器 —— 两者都是筛选条件，
     一个选去哪找、一个选找什么），卡片里省掉「歌曲结果 / 歌手结果」标签（范围按钮选中态
     + 底部「共 N 条 · 来自 X」已说全）。实测头部 137 → 94px，结果列表可见高度 → 280px(561)
     / 262px(312)。
  ② **宽窗跟着变一行**（平台+范围并到输入框那行，头部 63px），「结果」标签在宽窗保留。
  ③ 极窄（312）平台条改横滑（`flex-wrap:nowrap` + `overflow-x:auto` + 藏滚动条），
     **范围固定在右侧恒可见** —— 从歌手名进来时范围已定好，平台很少改，优先级对。
     截断处按**歌单切换条那套两侧按需渐隐**（`mask-image` + JS 依 `scrollLeft` 切
     `is-scroll-l/r`，挂 `scroll` + `ResizeObserver`），另补竖滚轮→横滚；
     宽窗不溢出 → 两个类都不加，mask 退化成全不透明。
  ④ ⚠️ **坑**：第一版收完 312 那档还是三行 —— **返回键被顶到单独一行**。根因不在平台/范围，
     而在 `.search-bar` 是 `flex:1 1 auto`、basis 取内容尺寸，而 `<input>` 固有宽度很大，
     使「返回+搜索框」那行的假设尺寸超容器、flex 在搜索框前就断了行。修法：非宽窗下
     `.search-bar { flex: 1 1 0; min-width: 140px }`。**窄容器里要跟别的东西并排的输入框，
     `flex-basis` 别留 auto。**
  断言 `search-head-compact-two-rows` / `search-head-narrow-two-rows` / `search-head-wide-single-row`
  （「结果」标签那条用「临时拿掉 hidden 再读计算样式」才验得到 CSS 规则），验收 **114/114**。
  交接：`docs/player-ui/SEARCH-HEAD-COMPACT.md`。
- 拖进/拖出「播放不割裂」（2026-10-10，**已部署**，构建号 1003131613 → **1003131614**）：修罐头报的
  「独立窗播 B站歌 → 贴回卡片后停播/换歌/不进最近播放；网易云歌还在但从头播」。
  机制前提：拆窗/停靠 = **每个窗口文档都是全新 iframe**，只能靠旧文档 `pagehide` 落快照、
  新文档读回续播；旧快照只带 `currentId`，歌还得靠 `playlist.json` 认领，bug 出在认领。
  ① **B站丢歌**：`playTrack` 换曲只写 playback-state、不写 playlist；过去只有「dur 未知 →
     loadedmetadata 补时长 → 1.5s 后 savePlaylist」这条偶然路径会落盘。Meting 搜索结果被
     `normalizeTrack` 丢了 `dur`（=0）所以会落；**B站 `dur` 在搜索结果里就有 → 不落 →
     新文档认不到 → 回退到列表第一首（且最近播放里没有）**。修：快照新增
     `currentTrack`（整条），新文档 uid/裸 id 都找不到时直接重建；`playTrack` 换曲即 `savePlaylist()`。
  ② **网易云从头播**：起播后首个 `timeupdate`（t≈0）会把 `state.progress` 冲成 0 并落盘；
     且 seek 重试窗口只有 3s（分片代理常来不及可 seek）。修：`pendingSeek>0` 时 `timeupdate`
     不写 progress；窗口 3s→9s，放弃时清 `pendingSeek`；快照 `playing` 加兜底（卸载时「刚还在播」
     <1.2s 仍算在播，防 `pause` 抢在 `pagehide` 前写回 false）。
  ③ 第二轮（罐头：「还会中断一会会，但不会从头开始了」——听感是**退回上一句重放**）：
     a) 快照进度改用**媒体时钟** `audio.currentTime`（`liveProgress()`），不再取滞后的
        `state.progress`（后者只随 timeupdate/防抖更新）；
     b) 新增 `maybeResumeAutoplay()`：**seek 落点未到位前不出声**，否则会先从头/错误位置
        放几百毫秒再跳（等起播窗口 ~3s，暂停恢复 ~9s）；
     c) boot 提速：`loadPlaylist/loadPlaybackState` 走 HTTP 路由、不等 SDK，与 `waitForHana`
        并行；`restorePlayback()` 不等 SDK 就起播，`loadAudio` 提到队列渲染之前。
  ④ 第三轮（罐头：「跳到 3 分钟，播到 4 分半再切，回来从 3 分钟开始」）：
     **`persistThrottled` 是防抖不是节流** —— 连续播放时 `timeupdate` 每 ~250ms 把 900ms
     定时器重置，播放期间**零写入**，盘上留着的是「上一个显式动作」（拖动进度条就是之一）。
     改成**真节流**（最多每 1.2s 写一次）。另：宿主拆 iframe 可能不派 `pagehide`/
     `visibilitychange`，所以周期落盘才是命脉，另补 `unload`/`beforeunload` 保险。
  断言新增 `lifecycle.snapshotTrackOk`（播种「当前曲目不在 playlist 里」的快照，新文档必须
  恢复成同一首 + 进度≥4.5s）、`crossOk` 里的 `firstPlayAt`（起播那一刻的位置必须已是续播点）、
  与 `lifecycle.seekFollowOk`（跳转后落盘位置必须跟着实际播放走）。验收 **106/106** 断言。
  交接：`docs/player-ui/REFINE-DONE-RESUME.md`。
- 原始背景/根因/边界：`docs/REFACTOR-BRIEF.md`、`docs/player-ui/CONTRACT.md`、`docs/player-ui/WIRING.md`
- **主题注入按「Hana 当前主题」而非「系统深浅」**（2026-10-11，**已部署**，构建号 1003131624）：
  用户报「深色卡面上两角露近白补丁 + 强调色不跟随主题」，两者同一根因 —— 初始注入把宿主给的
  两套调色板包成 `@media (prefers-color-scheme: light/dark)`，用**操作系统深浅**挑色，而不是用
  **Hana 当前主题**（触发：系统浅色 + midnight）。修法：初始分支**无条件注入 `hana-css`**（当前主题，
  不包 media）；palette 对只作老宿主兜底、按 `hana-theme-appearance` 选；`themePolarity()` 改为优先读
  `data-appearance`（由 `app.js` 顶部 + `syncAppearance()` 落地，按实际底色算，换主题自动跟上）；
  连带修同族的 `--hk-on-accent`（也挂在系统 media 上，浅色主题下会拿近白字压浅蓝强调色）。
  接管：`docs/player-ui/REFINE-DONE-THEME-APPEARANCE.md`；原理见知识库
  `20-资料/Hana App 卡片UI-主题变量与存储接线.md`「初始注入绝不能用系统深浅挑主题」。
  验收 **118/118**（新增 `theme-real-host-shape-uses-current-theme` 等三条，旧实现必挂）。
- **B站分P（多 P 视频）展开与导入**（2026-10-11，构建号 1003131641）：罐头反馈「搜索结果很多是一
  个地址塞很多分P，只能播第一 P、也拿不到分P标题」。**根因**：搜索结果里**没有任何分P字段**
  （`episode_count_text` 只对 PGC 有值，UGC 分P视频恒为空；逐字段 diff 单P/多P 无任何分P线索），
  而取流只读 `view.data.cid` —— 那个字段**恒等于 P1 的 cid**，所以永远只到第一 P。分P数与每 P 的
  `part`（干净歌名）只在 `x/player/pagelist` 里（实测 ~200ms、无风控）。
  ① **id 带 cid**：`bilibili:<bvid>_<cid>`（`_` 分隔，go 路由 `[A-Za-z0-9_-]+` 放行；bvid 无 `_` 不歧义）——
     否则同一视频所有 P 落库去重成一条（134 P 塌成 1）。**单P行为不变**（搜索仍 `bilibili:<bvid>`，
     `parseBiliTrackId` 回 cid 0 → 回落 view 取 P1）。
  ② **分P入口是二段式的**（搜索无分P字段，N 只能查）：只对**时长 ≥10min** 的 B站行探一次 pagelist，
     一轮最多探 10 条（`BILI_PROBE_MAX`），探到 >1 才挂「分集 N」并缓存；点开时没缓存才现拉。
     ⚠️ 这是对「懒查询、不预取」的一处**有意收紧**（完全不预取就永远拿不到 N）。
  ③ **形态（罐头两轮改定）**：分集标记**跟在标题后**（`flex:none` 永远完整，标题先缩省略号）+ 红心钉行尾；
     标记与标题**同一根水平中线**（定高 18px + 居中，歪的根因是 flex 基线对齐、大小字基线错位）；
     树形展开 `grid-template-rows:0fr→1fr`（高度真从零长，340ms 同缓动），子面板限高滚动（134P 会 4000+px）。
  ④ **落点**：子行红心 = 收藏到「我的喜欢」（与主行/搜索红心同一 `isFav()` 口径，不做选择框）；
     头部「全部加入我的喜欢」= 批量收藏；「导入成歌单」= 整条导成新 `imp:N`（走 `mergeTracks`，不塞收藏夹）。
  ⑤ 搭车：手动匹配歌词弹窗补一句静态提示 `#lmAlignHint`（「歌词绑定后若与节奏不齐，长按歌词拖动即可对齐」，
     **不复用会被动态改写的 `#lmNote`**）。
  验收：verify-backend **22/22**、verify-ui **158/158**（12/12 布局、4/4 窄卡、零运行时错误）。
  交接：`docs/player-ui/BILI-PARTS-DONE.md`。
- **B站分P 真机验收修复**（2026-10-11，构建号 1003131643，罐头真机 5 条）：
  ① **Bug A · 播某一P后整个搜索界面封面全消失**：`.player.nocover .q-cover { background-image: var(--cover-fallback) }`
     这条 (0,2,1) 压过 `.q-cover` 自己的 (0,1,0)，把**所有**列表封面的真图整片清掉（播无 pic 的分P
     就给 .player 挂 nocover）。该规则写在极简版早期（当时 `.q-cover` 还没有 `var(--cover-image)`），
     后来列表改成按变量取图就成了元凶 —— **直接删掉**（`.q-cover` 自带 fallback 兜底）。
  ② **Bug B · 分P不继承总封面**：pagelist 不给图，同一支视频共一张。选**前端继承**：
     `stampPartsPic()` 把主行 pic 盖到每个分P（探测缓存/现拉两处都调），子行新增 `.bili-pcover` 缩略图吃它。
     顺带修：搜索/热门/榜单行的 `--cover-image` 原本**没走 `withSession`**（生产是跨源 CDN 所以没暴露，
     同源图会 403）。**本轮没动 lib/**（选前端方案），部署只同步 `ui/`。
  ③ **交互（罐头定稿）**：**有分P的行点行/标题 = 展开·收起（不播放）**，无分P行点= 播放（`isMultiPartRow`
     按「已探到 >1」分流，探测在途不接管）；**「分集 N」= 纯静态提示**（去掉 role/tabindex/hover/箭头，
     `pointer-events:none`）；标题 `ellipsis` 限长 + 红心 `flex:0 0 auto` 不被挤出主行（`flex-wrap` 只给树换行）。
  验收：verify-backend 22/22、verify-ui **167/167**（新增 6 条：纯提示/多点展开/单点播放/nocover 不丢封面/
     分P继承封面/红心不换行；再补 2 条：长标题不断行/无导引线）。
     **续（同日两轮，构建号 1003131646）**：
     ④ **长标题把红心挤下一行**：`.search-hit` 的 `flex:1 1 auto` → **`flex:1 1 0`**。
        flex-wrap 换行是**先按 flex-basis 分行再压缩**，basis:auto 取内容 max-content 宽，
        长标题（nowrap）撑出巨大原始宽 → 主体独占第1行、红心掉第2行（与标题长短无关，
        只要内容宽 > 容器就触发）。basis:0 后主体只拿剩余宽，标题 ellipsis，红心恒同行。
        断言 `search-long-title-keeps-fav-inline`。
     ⑤ **分集子行竖向导引线删掉**（罐头：「滚一下 p6 就没这条线了」）：`.bili-plist::before`
        是 absolute 挂在滚动容器上的，`top:0;bottom:4px` 撑的是**可视高**非内容总高，
        只盖首屏 —— 本来就画不了全程。断言 `bili-parts-no-guide-line`。
  交接：`docs/player-ui/BILI-PARTS-FIX.md`。
- **歌词「挑 / 换」**（2026-10-11，构建号 1003131647，罐头需求「匹配错了要能挑和改」）：
  ① **长按工具条加「换歌词」**：`#lyricAlignTools` 第一行原只有 `<output>原始节奏</output>`，
     改成 `.lyric-align-top`（output flex:1 + `#lyricAlignSwap`）。点它 `closeLyricAlign()` + `openLyricMatch()`
     （先收工具条防两浮层叠；`openLyricMatch` 本不受 renderAsk 限制，所以**有词也能换**）。
     样式沿用工具条语言（11px/`--hk-muted`/hover `--hv-surface`+`--hv-ring-icon`，22px 矮一档）。
     ⚠️ 连带修：既有断言 `lyric-align-controls-fit-and-hit-in-narrow-card` 原本用
     `querySelectorAll('button')[0..3]` 判「四动作一行」，加按钮后会数到 5 个而误判 ——
     单行判定已收敛到 `.lyric-align-actions button`。
  ② **手动匹配改「列候选让人挑」**（根治）：`submitLyricMatch` 不再「搜到第一条就绑」，
     改搜各源→攒候选（相关度=关键词命中词数，一条不沾的不列）→列最多 5 条（歌名+歌手+平台胶囊），
     **点哪条绑哪条**（罐头拍板：点=直接绑定）。
  ③ **确定性取词**（这轮的真根）：只存 keyword 不够 —— `runBoundFirst` 原来按关键词重搜、
     `pickByQuery` 取第一条，用户在列表里选了 tencent 那条，重载可能又解回 netease。
     所以绑定加上选中的源与 id：`raw.lyricMatch={…, server, mid, title}`；`runBoundFirst` 有 mid
     就直接用 `server+mid` 取词，没有才回退（兼容老数据）。保留 `bindLyricMatch` 清旧 lyicOffset 的逻辑。
  验收：verify-backend 22/22、verify-ui **171/171**（新增 4 条：工具条有换歌词/能开面板/
     列候选（选前未绑）/点哪条绑哪条）。未动 lib。交接：`docs/player-ui/LYRIC-PICK-DONE.md`。
- **首次使用的欢迎歌 + 首次卡**（2026-10-12，**已部署**，构建号 1003131665，罐头需求）：
  默认安装状态空列表，希望首开能听到一首歌、有封面有歌词。指定《Everything's Alright》
  （网易云 `1460626792`，塞壬唱片-MSR / DJ OKAWARI / 澤田かおり），单独放歌单「塞壬唱片」。
  **不打包任何媒体**，只走 `music/go` 跳板 + Meting 取在线源（避开随包再分发的授权问题）。
  闸门同「首次 cookie 提示」那条纪律：只在「播放列表确实读到 + 确实为空 + 没播过」时播一次，
  加载失败/存储读不到/截图模式都不播；删歌单或清空后不再补回；不进「我的喜欢」。
  默认待播放（挂 audio 不出声），点播放键即响。
  另：有了欢迎歌后空态引导语不再出现，所以把「＋ 在哪」并进首次卡（标题「欢迎使用小花音乐播放器」
  + `#frAddHint`，位置句按布局给），点「知道了」永久消失（沿用 `player-cookie-notice-seen`）。
  断言 `welcome-song-seeds-once-when-empty` / `welcome-song-not-reseeded` /
  `first-run-card-teaches-how-to-add` / `first-run-card-hint-follows-layout`，验收 **310/310**。
  交接：`docs/player-ui/WELCOME-SONG.md`。
- 待办：独立窗/小卡音频不中断（pagehide/beacon 落盘 + 续播，2026-10-10 两轮：快照自带曲目 +
  换曲即落盘 + 进度护栏 + 媒体时钟进度 + seek 落点前不起播 + boot 提速，构建号 1003131614，
  **真机已复核（2026-10-10，罐头确认「ok 了」）**；剩余「一小段静默」是换文档重连媒体的固有代价，
  原理上除不掉）；
  本地文件夹选择需真机点一次确认；环境色纱的厚度/深底字色/封面右缘淡出宽度**需真机看一眼**
  （见 REFINE-DONE-AMBIENT.md §五）。
  §五-3（底部渐隐）已改（第六轮）：**底部渐隐整个撤掉**（底边硬切，只留歌词那侧往左的淡入）；
  顶部圆角一并补上（14px），均待真机复核。

> 注：早期 `docs/REFACTOR-BRIEF.md` 里的「PV / 唱盘 / 主题面板」等要求已被 2026-10-08 的
> `CONTRACT.md` 取代，以极简版为准。

## 6. 视觉规范

**主题跟随宿主 Hana（`hana.theme`，快照 + 订阅），含夜间主题——别自己另起一套明暗。**
SDK 默认已把宿主主题样式表注入页面（`ui/sdk.js` 的 `followHostTheme`），
所以**别定义同名 `--bg/--text/--accent` 去盖宿主**。强调色只用在「当前 / 激活 / 强调」上。

两套皮别混：
- **卡片 / 文档**：Hana house-style —— 纸 `#F8F4ED` / 卡面 `#FFFDF7` / 墨 `#2A2622` /
  唯一强调色远山蓝 `#537D96`（`~/.hanako/recipes/hana-folio/references/house-style.md`）。
- **Hana App 界面（本 App 活在这里）**：深板岩 `#34424B` / 面 `#414D56` /
  强调藕荷粉 `#C99AAF` / 文字 `#E1EAF0`·`#9FB1BC`（小截图取色，权威以 `hana.theme` 为准）。

通用：小圆角约 5px；只 SVG 线描图标（禁 emoji）；字号 ≥ 11px；禁左竖线当区块装饰。

**顶部圆角自己补**（2026-10-09 定）：宿主**只在独立窗/浏览器视图**里把 App 面裁圆
（iframe 吃 `--radius-lg`），**聊天卡片里不裁** —— 所以 `.player` 自己补上两角：
`border-radius: 14px 14px 0 0`（只上两角，下两角交给宿主窗口/控制条）。
**14px 是罐头定的**：宿主转发给 App 的圆角 token 只有 `--radius-chat-card` /
`--radius-chat-card-inner`（8/6px），比卡片容器那道弧小一半，两道叠着看小那道像素步进外露，
真机上就是「粗糙」；14px 跟容器弧（约 16px）同量级又收一点。
宿主自己裁得更紧时它的 clip 会盖住我们，不打架。
（宿主另有 `--corner-radius-scale`，圆角偏好倍数、默认 1；想跟随就写 `calc(14px * var(--corner-radius-scale, 1))`。）
角上露出的颜色由 `.frame` 的背景给（必须是卡面色 `--hk-surface`；用页面色 `--hk-bg` 会露出一块深一号的补丁）。

**决策（已定）**：自带配色面板已砍，主题**只跟随宿主**（决策 A，删改清单见
`docs/REFACTOR-BRIEF.md` §4.2）。

# docs/player-ui · 前端文档索引

极简播放器**前端**的全部历史与在役文档都收在这里。结构性纪律在根
[`AGENTS.md`](../../AGENTS.md)，版本流水在 [`docs/CHANGELOG.md`](../CHANGELOG.md)，
本文只负责**指路**。

## 这个目录怎么分的

| 位置 | 装什么 | 性质 |
|---|---|---|
| `README.md` | 本索引 | 导航 |
| `CONTRACT.md` | 极简版 UI 定稿执行契约（**唯一权威的规格**） | 在役 |
| `REFACTOR-BRIEF.md` | 前端重构的需求原文（重构起点，历史背景） | 参考 |
| `FRONTEND-CRITIQUE-2026-10-12.md` | `/impeccable critique` 评审问题清单（含证据） | 参考 |
| `FRONTEND-TODO-2026-10-12.md` | 上条评审的用户取舍与排序（实施前先读原文） | 待办 |
| `handoffs/` | **每轮改动的技术交接稿**（46 份，见下表） | 历史 |
| `archive/` | 开工前的旧简报（已被 CONTRACT 取代） | 历史 |
| `archive/prototype/` | 淘汰的 UI 原型（`app.js`/`index.html`/`style.css`、`alt-mine/`、`dev/`） | 历史 |
| `ripple-lab*.html` | 涟漪实验台（`tools/` 里 4 个脚本会引用，**别删**） | 在役工具 |
| `assets/` | 夹具封面（`verify-ui.mjs` 依赖，**别删**）+ ETE 验收截图 | 在役夹具 |
| `refs/` | 设计参考（`quiet-controls/` 定稿源） | 参考 |
| `screenshots/` | 历次验收截图 | 历史 |

> 交接稿命名约定：`*-DONE` 是完成记录，`*-FIX` 是修复记录，`*-HANDOFF` 是定稿+接线说明。
> 想看某一版对用户意味着什么，去 [`CHANGELOG`](../CHANGELOG.md)，别翻这里。

## handoffs/ · 按主题分组

### 接线与骨架（最早）
| 文件 | 一句话 |
|---|---|
| [WIRING.md](handoffs/WIRING.md) | 后端接线表：URL、请求/响应形状、缺口 |
| [WIRING-DONE.md](handoffs/WIRING-DONE.md) | 原型 → 生产 `ui/` 融合完成记录 |
| [MARKET-ENROLL-1.0.0.md](handoffs/MARKET-ENROLL-1.0.0.md) | 1.0.0 市场登记流程 |

### 音源 / 导入 / 歌单
| 文件 | 一句话 |
|---|---|
| [SOURCES-BUILTIN.md](handoffs/SOURCES-BUILTIN.md) | 音源改回内置 + 首次 cookie 提示 |
| [REFINE-DONE-SOURCES.md](handoffs/REFINE-DONE-SOURCES.md) | 来源重做 · 歌单真名 · 歌手补齐 · 歌单可删 |
| [BILI-PARTS-DONE.md](handoffs/BILI-PARTS-DONE.md) | B站多 P 视频展开与导入 |
| [BILI-PARTS-FIX.md](handoffs/BILI-PARTS-FIX.md) | B站分P 真机验收修复 |
| [BILI-HIRES-DONE.md](handoffs/BILI-HIRES-DONE.md) | 登录解锁 Hi-Res FLAC / 杜比 |
| [BILI-COVER-MATCH-DONE.md](handoffs/BILI-COVER-MATCH-DONE.md) | B站合集封面补全（网易云单源） |
| [FIX-BILI-COVER-COPY.md](handoffs/FIX-BILI-COVER-COPY.md) | B站封面防盗链 + 复制歌名同步化 |
| [ARTIST-SEARCH-DONE.md](handoffs/ARTIST-SEARCH-DONE.md) | 点歌手名直接搜这位歌手 |
| [PLAYLIST-SEARCH-PREPEND.md](handoffs/PLAYLIST-SEARCH-PREPEND.md) | 当前歌单搜索 + 新增置顶 |
| [REFINE-DONE-LISTS.md](handoffs/REFINE-DONE-LISTS.md) | 多歌单 + 本地固定文件夹 + 夜间兜底 |
| [REFINE-DONE-LISTS-2.md](handoffs/REFINE-DONE-LISTS-2.md) | 四项拍板 + 拖拽生命周期修复 |
| [REFINE-DONE-LISTS-3.md](handoffs/REFINE-DONE-LISTS-3.md) | 歌单管理体验（落点 / 队列菜单 / 最近播放） |
| [REFINE-DONE-RENAME-PERSIST.md](handoffs/REFINE-DONE-RENAME-PERSIST.md) | 重命名持久化 |
| [REFINE-DONE-RESUME.md](handoffs/REFINE-DONE-RESUME.md) | 拖进/拖出「播放不割裂」修复 |

### 歌词
| 文件 | 一句话 |
|---|---|
| [LYRIC-MATCH-DONE.md](handoffs/LYRIC-MATCH-DONE.md) | 歌词标题精简与手动匹配 |
| [LYRICS-SYNC-DONE.md](handoffs/LYRICS-SYNC-DONE.md) | 歌词节奏手动对齐 |
| [LYRIC-PICK-DONE.md](handoffs/LYRIC-PICK-DONE.md) | 歌词「挑 / 换」——匹配错了能自选 |
| [LYRIC-FLOW-DONE.md](handoffs/LYRIC-FLOW-DONE.md) | 响应式歌词与连续波浪 |
| [LYRIC-FOLLOW-FIX.md](handoffs/LYRIC-FOLLOW-FIX.md) | 跟随不再卡死（丢松手事件自愈）+ 点歌词跳句也走 0.5s 回位动画 |
| [PLAYLIST-PERF-DONE.md](handoffs/PLAYLIST-PERF-DONE.md) | 歌单展开继续逐帧流动、播放指示不再每帧布局、长句与慢歌性能自验 |
| [PLAYLIST-PERF-ACCEPT-1003131699.md](handoffs/PLAYLIST-PERF-ACCEPT-1003131699.md) | 独立验收：真机手感流畅、无头 12/12 + 87/87 + 后端 132/132；全量 UI 与真机长卡/窄卡待验 |

### 沉浸播放页（ETE）
| 文件 | 一句话 |
|---|---|
| [IMMERSIVE-ETE-DONE.md](handoffs/IMMERSIVE-ETE-DONE.md) | 沉浸播放页与歌词阅读轴总交接 |
| [IMMERSIVE-ETE-AUTOHIDE-FIX.md](handoffs/IMMERSIVE-ETE-AUTOHIDE-FIX.md) | 沉浸底栏出窗计时修正 |
| [IMMERSIVE-ETE-LONG-CARD-FIX.md](handoffs/IMMERSIVE-ETE-LONG-CARD-FIX.md) | 长卡恢复常驻底栏与上方封面 |
| [IMMERSIVE-ETE-WINDOW-IDLE-FIX.md](handoffs/IMMERSIVE-ETE-WINDOW-IDLE-FIX.md) | 独立窗口用「无指针活动」判隐藏 |

### 涟漪（音频可视化）
| 文件 | 一句话 |
|---|---|
| [RIPPLE-CANVAS-2D.md](handoffs/RIPPLE-CANVAS-2D.md) | Canvas 2D 指针涟漪方案与可粘贴实现 |
| [RIPPLE-LAB.md](handoffs/RIPPLE-LAB.md) | 涟漪实验台说明 |
| [RIPPLE-AUDIO-DONE.md](handoffs/RIPPLE-AUDIO-DONE.md) | 涟漪接真音频分层落地 |
| [RIPPLE-LAYER-SEPARATION-FIX.md](handoffs/RIPPLE-LAYER-SEPARATION-FIX.md) | 涟漪三层分离检测修复 |
| [RIPPLE-LAYER-COLORS-DONE.md](handoffs/RIPPLE-LAYER-COLORS-DONE.md) | 涟漪三层配色生产落地 |
| [RIPPLE-MIDHIGH-DONE.md](handoffs/RIPPLE-MIDHIGH-DONE.md) | 中高频灵敏度 + 踩镲路径 + 四层环 |
| [RIPPLE-TOOLBOX-DONE.md](handoffs/RIPPLE-TOOLBOX-DONE.md) | 涟漪参数「玩具箱」面板 |

### 控制栏 / 音量 / 视觉打磨
| 文件 | 一句话 |
|---|---|
| [QUIET-CONTROLS-HANDOFF.md](handoffs/QUIET-CONTROLS-HANDOFF.md) | 「静听」控制栏定稿与接线 |
| [QUIET-CONTROLS-DONE.md](handoffs/QUIET-CONTROLS-DONE.md) | 「静听 · 连续布局」控制条实现 |
| [REFINE-DONE-VOLUME.md](handoffs/REFINE-DONE-VOLUME.md) | 音量：单按钮 + 悬停弹竖条 |
| [REFINE-DONE-AMBIENT.md](handoffs/REFINE-DONE-AMBIENT.md) | 封面环境色 + 渐变遮罩重做 |
| [REFINE-DONE-HOVER-GLOW.md](handoffs/REFINE-DONE-HOVER-GLOW.md) | 悬停抬升（发光） |
| [REFINE-DONE-MOTION-2.md](handoffs/REFINE-DONE-MOTION-2.md) | 第二轮动效 |
| [REFINE-DONE-THEME-APPEARANCE.md](handoffs/REFINE-DONE-THEME-APPEARANCE.md) | 主题注入按「Hana 当前主题」而非系统深浅 |
| [REFINE-DONE-TABS.md](handoffs/REFINE-DONE-TABS.md) | 歌单切换条溢出：两侧渐隐 + 当前项跟随 |
| [SEARCH-HEAD-COMPACT.md](handoffs/SEARCH-HEAD-COMPACT.md) | 卡片里搜索页头部收矮 |
| [SEARCH-COVER-MOTION.md](handoffs/SEARCH-COVER-MOTION.md) | 搜索返回封面 + 统一抽屉动效 |
| [EMPTY-HINT-FIX.md](handoffs/EMPTY-HINT-FIX.md) | 空列表引导语指错修复 |
| [SHUFFLE-PREV.md](handoffs/SHUFFLE-PREV.md) | 随机播放「上一曲」= 回家，不是再掷骰子 |
| [REFINE-DONE-SEARCH-PAGINATION.md](handoffs/REFINE-DONE-SEARCH-PAGINATION.md) | 搜索分页 |

### 首开体验
| 文件 | 一句话 |
|---|---|
| [WELCOME-SONG.md](handoffs/WELCOME-SONG.md) | 首次欢迎歌 + 首次卡 |

## 清理记录

- 2026-10-13：`docs/player-ui/` 重组。46 份交接稿收进 `handoffs/`；淘汰原型（顶层
  `app.js`/`index.html`/`style.css` + `alt-mine/` + `dev/`）移进 `archive/prototype/`；
  `REFACTOR-BRIEF.md` 从 `docs/` 顶层归位到本目录；清掉 4 个 `.DS_Store`、孤儿封面
  `assets/can-cover-kaze.jpg`、旧备份 `ripple-lab-layers.bak-hierarchy.html`。

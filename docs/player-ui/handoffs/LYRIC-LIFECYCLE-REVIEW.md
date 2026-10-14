# 歌词 detach/reattach 波浪与跟随失效 · 独立审核（终审 · 候选 1003131701，已定稿）

> 审查方：独立审核（Hana sub，write 授权）。
> 日期：2026-10-14。**状态：1701 静态终审定稿——已确认项与待真机项分列**；不宣称宿主故障已验收通过。
> 范围：只读排查 + **对冻结候选做静态终审** + 核对主 agent 原始结果；不改 `ui/app.js`、`tools/verify-ui.mjs`（主 agent 独占），
> 不改既有基线文档；不部署、不 reload、不碰生产数据/歌单。本轮及上一轮**均未启动浏览器**（按指示避免污染主 agent 性能采样）。
>
> **独立性声明**：本审核**只独立跑过早期的 21 条 lifecycle 子集**（`/tmp/hana-lyric-lifecycle-review`，候选早期快照）。
> **31 条版 / 118 条 / 12 条 / 后端 132 条均为核对主 agent 的原始 json 结果，不是我独立复跑所得**，不得记作本人独立复现。

---

## 0. 版本锚点与冻结证据

| 件 | 1701 值 | 说明 |
|---|---|---|
| build | `1003131701` | 最终候选（本地，未部署未发版） |
| manifest version | `1.1.5` | 未动 |
| HEAD | `e8a97aca54dabcea33005cfe5bb4bf5cb4f1fedd` | 工作树含未提交性能基线（**保留，未 reset/clean/checkout**） |
| `ui/app.js` | `5571366f619de38a1a5752a20e4f75c8c20f519b78b1383f72499ba4f66c6358` | 候选（本地实测一致） |
| `ui/style.css` | `23cbdc90b86d2868534d4fec695b78ca2376be0ad9d4abdf3f99d081d3400428` | **= 1699 基线**（`cssBaselineRetained:true`） |
| `ui/_build.json` | `e8d6ab58051d1d62d7aaf2bf6de4bc40bde817cd447e66abf5fe5c0857dd56e8` | build 1701 |
| `tools/verify-ui.mjs` | `b617b3fa6533963e6428e0a5529be63ba2d39047de0447ce8c8d02fceb108be6` | 候选 |
| 安装目录 | `installedStillBaseline:true`（app.js 仍 `77b069f9…` = 1699） | **确认未部署** |

- `final-1701/source-checks.json`：`twins:true`、两 HTML `htmlBuilds` 均 `1003131701`、`installedStillBaseline:true`、`manifest.json` 未变（`24c3e719…`）。
- **三份 diff 用途**（原稿曾误判，已更正）：`**-app.diff` = 相对 1699 的增量 app.js 补丁（审查对象）；`**-working-tree.diff` = 含既有性能基线的工作树 patch（`VERIFY_UI_DIR` 注入、`lyric-slow` 夹具、`--lyric-perf-only`、1699 的性能改动等），非本候选语义；`baseline-worktree.patch` = 1699 在途性能基线保留件（app.js SHA `77b069f9…`）。
- **1700 系中间稿**：`candidate-app.diff`（1700 版）与 `candidate-v2.log` 28/28、`baseline-v2.log` 18/28、`baseline-final.log` 20/31 保留为历史对照。终稿以 `final-1701/` 为准。

### 结果台账（1701 串行结果已落盘，见 `final-1701/`）

| 项 | 产物（`final-1701/`） | 结果 | 来源 |
|---|---|---|---|
| 1699 负对照 | `baseline/verify-lyric-lifecycle.json` | **19/31**，12 红（预期 exit 1） | 主 agent |
| 1701 lifecycle | `summary.json` + `lyrics/verify-lyrics.json` | **31/31**、runtimeErrors `[]` | 主 agent（已核对 json） |
| 1701 lyrics 汇总 | `lyrics/verify-lyrics.json` | **118/118**、failed `[]`、runtimeErrors `[]` | 主 agent（已核对 json） |
| 1701 perf | `perf/verify-lyric-perf.json` | **12/12**；`LayoutCount` 四场（closed/opened/reclosed/long）**均 8** | 主 agent（已核对 json） |
| 1701 慢歌（外部 LRC） | `song/verify-lyric-perf.json` | **12/12**；`externalLrc:true`、146 帧/moving 134、maxStepPx 0.215、travel 25.18、21.5→23.65s、两行（51/25.575） | 主 agent（已核对 json） |
| 1701 backend | `final-1701/backend.log` | **132/132，failed=[]，exit 0**（主 agent 最终补记：已重跑并核对落盘原始输出） | 主 agent；非 sub 独立复跑 |
| 1700 中间稿 | `candidate-v2.log` 等 | 28/28；已加 **superseded** 路标，非终稿 | 主 agent |

**关键读数已逐项核对**（`summary.json`）：
- 两轮 detach：`frameRecoveries` 各 **1**、`maxPendingFrames` **1**；`movingRatio` 1 / 0.9815，`scrollingRatio` 1 / 1；ratio 形态 compact / long，detached 均 wide，reattached 均 long。
- 合成提示：`readds` **0**、`flowing` 7（R3 正面证据）。
- `positive`（真实 frame 0 预算 → 恢复，漏 RO/IO）：`layout:"wide"`、`needsMeasure:false`、`height:571`；`frameRestored`、`pausedGeometry` **同样 width/height 正、layout wide、needsMeasure false**——**1701 的形态误判修复在无头侧确认**。

- 本人独立复跑（**仅早前**）：`--lyric-lifecycle-only` → 21/21 / failed=[] / runtimeErrors=[]（`/tmp/hana-lyric-lifecycle-review`，候选早期快照）。**31 条版未由我独立复跑。**

## 1. 症状 → 机制（已确认）

用户分治：长卡正常 · 拖成独立窗**概率**失效 · 音频高亮继续 · 波浪/跟随停 · 切歌无效 · 重开插件恢复 · wide→compact/long 立即恢复。

**根因（机制级，已确认）**：1699 的恢复入口不止 RO/IO（还有 `RO(frame)→applyLayout`、音频 `syncLyricFrames` 族、`visibilitychange`、window `resize`），但**没有任何一条从媒体事件走到 `sizeLyricPad()` 重测**：

- `ResizeObserver(lyricWrap)` → `measureLyricTop(); sizeLyricPad();`（要求尺寸变化被观测到）
- `ResizeObserver(frame)` → `applyLayout()` → `sizeLyricPad()`（同上）
- `IntersectionObserver(lyricWrap)` → `lyricInView` + `syncLyricFrames()`（**只同步，不重测**）
- 音频 `['play','playing','pause','ended','seeking','seeked','emptied','waiting']` → `syncLyricFrames()`
- `visibilitychange`、reduced-motion change → `syncLyricFrames()`；window `resize` → `applyLayout`/`positionSplitHandle`

`syncLyricFrames` 只 paint+start、**不调 `sizeLyricPad`**；`paintLyricFlow` 在空 `centers` 时早退。detach 后几何被清空/从未测量时，若 RO 无新通知、IO 又派发一次迟到 `isIntersecting:false`，就**无任何重测路径** ⇒ 波浪/跟随永久停、切歌不救、改比例立即救。与用户描述严格吻合，并被基线红项族（`detach-N-lost-frame-self-heals`、`stale-offscreen`、`positive-budget`、`real-frame`、`paused-zero-budget`、`real-zero-frame`）复现。

## 2. 1700 → 1701 增量逐条核对（本次终审对象）

`candidate-app.diff`（1699→1701）里相对 1700 的**新增仅约 11 行**，三处：

| # | 位置 | 更改 |
|---|---|---|
| 1 | 新 helper `refreshLyricLayout()`（约 6 行） | 读 `frame.clientWidth/clientHeight`；**正尺寸闸门** `if (!(w>0 && h>0)) return;`；`next = w>=720?'wide':(h<560?'compact':'long')`；仅当 `next !== player.getAttribute('data-layout')` 才 `applyLayout()` |
| 2 | `applyLayout()` 顶部（+2 行） | `if (!(w>0 && h>0)) { lyricNeedsMeasure = true; stopLyricFrames(); return; }`——迁窗/挂载的 0×0 中间态**不再当 compact 提交** |
| 3 | 三个调用点 | `recoverLyricSurface` 立即（`cancelLyricFrame(); refreshLyricLayout(); measureLyricTop();`）+ 下一帧补测；`recoverLyricOnMediaPulse` **仅几何无效时**（`needsMeasure || !height || !width`）调一次 |

### 2.1 递归 / 初始化风险：无（已核对）

- **无递归**：`applyLayout()` 全路径**不调** `refreshLyricLayout()`。它调 `arrangeControls`、`renderChrome`(→`syncLyricFrames`) 、`updateStageMetrics`、`refreshLyricVisibility`、`sizeLyricPad`、`updateLyricIndex`、`positionSplitHandle`——均不回到 `refreshLyricLayout`。`refreshLyricLayout → applyLayout` 是单向边，无环。
- **函数声明提升**：`refreshLyricLayout`(≈3461) 与 `applyLayout`(≈7681) 同一 IIFE 内的函数声明，提升后互见；二者只**在运行时**（boot 之后）触发，`frame`/`player` 已于 ≈1253/1254 赋值。事件监听在 ≈3844+ 挂载，早于任何回调。
- **初始化**：`boot()` 直接 `applyLayout()`（≈7991）。正尺寸下行为与改动前一致；**0×0 下由「提交 compact」改为「早退保留 HTML 默认 `data-layout="long"` + `lyricNeedsMeasure=true`」**，正是本次要修的「误判 compact」。随后正尺寸经 frame RO 或媒体脉冲/生命周期 → `refreshLyricLayout` 补正形态。语义自洽。
- **无属性/内部变量失配**：早退分支不写 `data-layout`，故 `player.getAttribute('data-layout')` 与内部 `layout`/`ctlForm` 保持同旧；`refreshLyricLayout` 用属性做比较是安全代理，命中即进 `applyLayout`，其内部 `formChanged` 必为真，正常提交。

### 2.2 形态推断只在正尺寸：成立

`refreshLyricLayout` 与 `applyLayout` 都在 `w>0 && h>0` 才继续；零预算下 `refreshLyricLayout` 直接 return（**不会**再算 `next='compact'` 去调 `applyLayout`）。这正是 1700 漏掉的形态（`final-1701/baseline.log` 的 `positive-budget`/`real-frame` 显示 `layout:"compact"`、`width:667/height:0`），1701 已堵。

### 2.3 稳态媒体脉冲不增加布局读取：成立

`recoverLyricOnMediaPulse` 的守卫是 `if (lyricNeedsMeasure || !g.height || !g.width) refreshLyricLayout();`——稳态（`needsMeasure=false`、几何正）全部为**变量读**，不碰 DOM；`!lyricInView` 与末尾 `measureLyricTop/sizeLyricPad` 分支同样被同一条件挡住。稳态每帧只走 `startLyricFrames()`（读 `performance.now()`、`canFlowLyrics` 读 `audio.*` 与 clock，**无布局读**）。**符合要求**。

### 2.4 R3 仍消解（复核）

`sizeLyricPad` 正常路径不调 `stopLyricFrames`（只在零尺寸分支调）；`applyLayout` 正常路径的 `renderChrome→syncLyricFrames` 仅在 `formChanged` 时触发。连续缩放**未跨形态边界**时 `refreshLyricLayout` 命中 `next===属性` → 不调 `applyLayout` → 不摘层。**合成层每帧建销已消除**（断言 `resize-keeps-compositor-hints-stable`：`readds===0`）。跨边界时仅一次 applyLayout（一次摘+加），属真实布局切换，可接受。

### 2.5 小瑕疵（非阻塞）

1. **可能的双重 `sizeLyricPad`**：`recoverLyricSurface` 里若 `refreshLyricLayout()` 触发了 `applyLayout()`，而 `applyLayout` 内部已 `refreshLyricVisibility(); sizeLyricPad();`，外层随后又调一次 → 每次恢复多测一次。幂等、仅恢复路径（非稳态），成本可忽略。
2. **度量口径不一致**：`refreshLyricLayout` 用 `clientWidth/clientHeight`，`applyLayout` 用 `getBoundingClientRect().width/height`。当前 `frame` 无边框/滚动条，二者相等，阈值一致，无实际风险；建议注释里点明。
3. **`window resize → recoverLyricSurface`**：在 RO 存在的路径下，resize 现额外做一次 frame 尺寸读（即便形态未变）。仅桌面改变窗口时发生，非稳态播放，影响低。
4. **`lyricNeedsMeasure=true` 在 `recoverLyricSurface` 开头无条件置位**：`hana.lifecycle`/`envelope` 订阅会立即回放一次快照（`sdk.js:3047/3060`），即订阅时各触发一次恢复——一次测量，无害。

## 3. 更正前稿的过时事实（沿用）

1. **「paint 内 canFlow 是候选新增」→ 错**：它是 1699 基线已有（`baseline-worktree.patch` 1698→1699）；候选回调内**未**新增完整扫描。R5 降级为「1699 既有每帧开销，非候选回归」。
2. **「`raf:true` 即非失帧」→ 错**：真机 detach 典型签名正是 `raf:true` 但回调不执行；判失帧看 **`frameAge`**（>250ms）与 `position/residual` 变化，**不能凭布尔否定**。
3. **「原版恢复只有 RO/IO」→ 不严谨**：§1 已列全；精确缺口是**无入口返回 `sizeLyricPad`**。
4. `baseline-worktree.patch` 非候选 diff（§0）。

## 4. 可反证条件（真机一读定分支）

`__playerDebug.lyricFlowState()` 现可读 `height/width/measuredWidth/maxScroll/needsMeasure/inView/surfaceVisible/canFlow/frameAge/frameRecoveries`（+ `data-layout`）。真机 detach 后采样：

| 观察 | 指向 | 判定 |
|---|---|---|
| `height>0`、`needsMeasure:true`、`frameAge` 停 >250 | 纯重测缺口 | 媒体脉冲应救 → **候选有效** |
| `height:0` 持续 >10s | 持续零尺寸 | 媒体脉冲救不到 → **仅部分有效**（残留 R4） |
| `height>0` 但 `data-layout` 与实际窗口不符 | 形态误判 | 1701 应已堵；若仍现即回归 |
| `raf:true` 但 `frameAge` 持续 >250、`position` 冻结 | **失帧** | 等 250ms 兜底/恢复信号；永不自愈 = 兜底未覆盖 |
| `surfaceVisible:false` 且切回前台/切歌后仍 false | **R1 命中** | lifecycle 闸门卡死（切歌不重置快照） |
| `frameRecoveries` 递增 | 250ms 兜底被触发 | **正面证据** |
| `frameRecoveries` 不增而 `raf` 恢复 | 恢复来自 RO/IO/pageshow/媒体脉冲 | 兜底未参与 |

> 硬判据（采样窗口）：500ms 内 `position` 变化 ≥4 次且 `frameAge<50`；`height === #lyricWrap.clientHeight`；`surfaceVisible:true`；`needsMeasure:false`；`data-layout` 与窗口实宽一致。

## 5. 已确认结论（静态 + 无头可证）

- **A. 根因确认**（§1）。
- **B. 候选修复确认**（限定无头注入的故障形状）：失帧自愈（`frameAge` 兜底 + epoch/handle）；迟到 IO `false` 后无 resize 恢复；`sizeLyricPad` 零尺寸失效 + `needsMeasure` 链路；`recoverLyricSurface` 先重测再判可见避免零 budget 早退；媒体脉冲/`playing` 均挂且稳态不读几何；SDK `lifecycle`/`envelope` 接公开权威、`pagehide` cleanup、repeated `pageshow` 不起播；两轮真实文档导航 × wide→compact/long→wide 全过；连续缩放合成提示零重加（R3 正面证据）。
- **C. 1701 增量（本次终审）**：`refreshLyricLayout` + `applyLayout` 正尺寸闸门，**消除 0×0 误判 compact**；helper/`applyLayout` **无递归、无初始化风险**；形态推断**只在正尺寸**发生；**稳态媒体脉冲不增加布局读取**；**R3 仍消解**（§2.4）。
- **D. 静态一致性**：`twins:true`、HTML build 均 1701、CSS 未改、**安装目录仍 1699（未部署）**、manifest 未变。
- **E. 主 agent 原始结果核对（1701）**：lifecycle `31/31`、lyrics `118/118`、perf `12/12`（`LayoutCount` 四场均 8）、慢歌外部 LRC `12/12`（`externalLrc:true`），全部 `runtimeErrors:[]`；负对照 1699 `19/31`（预期 exit 1）。两轮 detach 的 `frameRecoveries` 各 1、`maxPendingFrames` 1、比率 1 / 0.9815 与 1 / 1；合成提示 `readds:0`；真实 frame 恢复路径 `layout:"wide"` + `needsMeasure:false`。**与 §2 的静态推论一致。**

## 6. 待真机结论（**未验收通过**，不得记成已修好）

1. **宿主是否真的漏 `visible` 事件** —— 未证实。`hana.lifecycle` 是公开 SDK 绘制权威，候选尊重它正确；但「真机 detach 只推 `false` 不补 `true`」无真机证据。若无头夹具补推 `true`、真机不补，R1 风险依旧。
2. **detach 后 `lyricWrap` 是否真的持零尺寸** —— 未证实（残留 R4）：候选能救「曾是正数未重测」，未必能救「持续零尺寸」。
3. **真机 detach 的故障形状**（WebContents 迁移 / iframe 整体尺寸 0 / 合成器限流 rAF）与无头注入（`stack` 匹配丢帧、`.style.display`、`page.goto` 新文档）**不同**；脚本注释已标 "not native Hana detach"。交接必须同样表述，**不得把 `zero-mount`、`real-frame`、`stale-offscreen`、`positive-budget` 当作真机已通过**。
4. **1701 专项结果已落盘并核对**（lifecycle 31/31、lyrics 118/118、perf 12/12、慢歌 12/12、负对照 19/31），均为**主 agent 无头证据**；主最终交接为 `LYRIC-LIFECYCLE-DONE-1003131701.md`。无头通过**不等于**真机通过，不得记成宿主故障已验收。

## 7. 回归建议（真机 detach/reattach × 比例，≥3 轮）

- **轮 1 · 纯 detach/reattach**：长卡播放 → 拖成独立窗停 10s 采样（`frameAge`/`frameRecoveries`/`height`/`data-layout`）→ wide→compact→long→wide 各停 5s → 回拖长卡 → 立即重复一次。
- **轮 2 · 闸门交叉**：(a) detach 后**不碰比例**只播 15s（R4 判别）；(b) 播放中切会话再切回（R1 判别 `surfaceVisible` false→true 闭环）；(c) 暂停→resize→恢复播放（needsMeasure 死锁判别）。
- **轮 3 · 比例矩阵**：wide/long/compact 各做 detach→立即改比例→reattach，确认「靠 resize 救」与「靠 detach 救」互不依赖；**重点核 `data-layout` 是否与实际窗口一致**（1701 新修点）。

任一轮落在「必须 resize 才恢复」或「形态误判」⇒ 报告标 **部分有效**，不得记成通过。

## 8. 残留风险（非阻塞，供后续）

- **R4（未消解）**：持续零尺寸形态的恢复仍依赖一次外部正尺寸信号；若真机落在该形态，需新增「不依赖宿主观测的重测触发」或宿主文档生命周期接口（与 `AUDIO-OWNER-ORPHAN-HOST.md` 同源）。
- **R1（边界）**：需在交接明确「宿主漏 visible 事件」尚未证实，保持未知。
- **R5（降级）**：`paintLyricFlow` 每帧 `canFlowLyrics()` 遍历 clock，为 1699 既有开销；可缓存到 `lyricIndex` 变化点。

## 9. 未做 / 未测

- 未部署、未 reload、未发版、未 bump manifest version；未碰生产歌单/`app-data`。
- 未改 `ui/app.js`、`tools/verify-ui.mjs`、既有基线文档；只写本文件（`LYRIC-LIFECYCLE-REVIEW.md`）。
- 本两轮**均未启动浏览器**；31 条 / 118 条 / 12 条 / 132 条均为**核对主 agent 原始 json**，非本人独立复跑（本人仅独立跑过早期 21 条子集）。
- 主 agent 最终补记：后端输出实际为 `final-1701/backend.log`（文件，并非 `backend/` 目录），已完成 132/132、failed=[]、exit 0，并回写 `summary.json`。此补记由主 agent 核对，未冒称 sub 独立复跑。

## 10. 终审结论（分两栏）

**已确认（可在无头/静态层断言）**

1. 根因：1699 无「媒体事件 → `sizeLyricPad` 重测」路径，detach 后几何失效即永久停（§1），基线 19/31 红项族复现。
2. 1700→1701 增量安全有效：`refreshLyricLayout` + `applyLayout` 正尺寸闸门消除 0×0 误判 compact；**无递归/无初始化风险**；形态推断**只在正尺寸**；**稳态媒体脉冲不增加布局读取**；R3 仍消解（§2）。
3. 恢复链、失帧兜底（`frameAge`+epoch/handle）、零尺寸失效、SDK `lifecycle`/`envelope` 接入、`pagehide` cleanup、repeated `pageshow` 不自动起播，逻辑自洽且与主 agent 原始结果一致（§5 E）。
4. 静态一致性：twins、HTML build 1701、CSS 未改、**安装目录仍 1699（未部署）**、manifest 未变。

**待真机（不得记为已修好）**

1. 宿主是否真的漏 `visible` 事件（R1 边界）未证实；
2. detach 后是否持**持续零尺寸**（残留 R4）未证实；
3. 真机 detach 的故障形状（WebContents 迁移 / iframe 整体 0 / 合成器限流 rAF）与无头注入不同；
4. 无头 31/31、118/118、12/12 **不是真机通过**。

> 本审核为**静态终审 + 核对主 agent 原始结果**，不下「真机通过」结论；真机验收留给罐头。

# 前端评审问题清单（给 Codex 评估）

来源：`/impeccable critique`（2026-10-12），目标 `ui/index.html`（孪生 `ui/standalone.html`）+ `ui/style.css` + `ui/app.js`。
健康分 **30/40（Good，75%）**。本文档列出 9 个问题 + 误报判定 + 环境事实，供第三方独立复评。

> 这份文档**只做描述与建议，不改任何代码**。评审方请自行核实行号与结论；行号基于本仓当前工作树（build `1003131661`，`git status` 有未提交改动）。

---

## 0. 环境与取证方法

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/SSD/hanadesk/hanako-audio-player-simple`（分支 `hana-simple`） |
| 架构 | Hana v2 App，**单文件前端、无构建步骤**。`ui/index.html` + `ui/app.js`（7170 行）+ `ui/style.css`（2686 行） |
| 孪生约束 | `ui/index.html` 与 `ui/standalone.html` 内容必须一致，**只差 5 行 AudioContext 调试块**（`window.__reactiveState`）。改一个必须同步另一个 |
| 承载与尺寸 | 聊天卡片（实测约 465×930，最窄 312×494）；独立窗（`manifest.json` 的 `detachedDefaultSize` = 1040×780） |
| 布局断点 | `data-layout`：`w>=720 → wide`，`h<560 → compact`，否则 `long`；`data-bar`：`w<420 → tight`；`data-ctl`：`w<400 → narrow` |
| 机械检测 | `/Users/can/.hanako/skills/impeccable/scripts/impeccable detect --json ui/index.html ui/standalone.html`，exit 2 |
| 浏览器实测 | puppeteer-core（`/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core`）+ 系统 Chrome，本地静态服务 + 假后端（伪造 `/widget/api/playlist`、`/api/playback-state`，播到「有队列 + 有曲目 + 有歌词」的真实状态）。测试脚本落在 `/tmp/hap-*.mjs`，截图 `/tmp/hap-b/`、`/tmp/hap-crit/` |

**未做**：Hana 宿主真机验收（本机无独立 Electron 运行时，`--smoke` 不可用）。所有结论均在系统 Chrome 里复现，**不代表宿主环境的最终表现**。

---

## 1. 机械检测原始命中（CLI，真实跑出）

| 规则 | 严重度 | 每文件数量 | 定位 / 证据 |
|---|---|---|---|
| `low-contrast` | warning | 6 | 主：`#9fb1bc on #414d56` = **3.9:1**（深色卡面次要文字）。另有若干 `:hover state` 条目（**判定为误报，见 §11**） |
| `cramped-padding` | warning | 1 | `.frame` 子元素贴容器边且无内缩 |
| `tiny-text` | warning | 1 | 「11px body text」 |
| `repeating-stripes-gradient` | advisory | 1 | `ui/style.css:131` `--cover-fallback` 第一层的 `repeating-linear-gradient(135deg, … 0 1px, transparent 1px 13px)` |
| `cream / beige palette` | advisory（浏览器可视化 banner） | 3 档全部命中 | 页面底色 `rgb(248,244,237)` = `--fallback-bg` |
| `bounce or elastic easing` | advisory（浏览器可视化 banner） | 3 档全部命中 | `ui/style.css:420` `.play-btn { cubic-bezier(0.34, 1.56, 0.64, 1) }` |

浏览器可视化：注入 `detect.js` 成功（`document.title` 与 `<script>` 注入均可用），overlay 真实渲染。控制台报 `[impeccable] 2 anti-patterns found`（长卡）/ `1 anti-pattern found`（宽窗、窄卡）。长卡 overlay 标出的是 `low contrast text`。

---

## 2. 对比度实测（浏览器量的，含 alpha 合成）

方法：把 UI 推到真实状态，逐元素取 `getComputedStyle` 的 `color` 与最近实底祖先的 `background-color`，按 WCAG 相对亮度公式算，含 alpha 前置合成。

| 元素 | 主题 | 前景 / 背景 | 字号 | 比值 | WCAG AA |
|---|---|---|---|---|---|
| `#durTime`（总时长） | 浅（无宿主兜底） | `#8E9196` / `#F8F4ED` | 11px | **2.88** | ✗ 需 4.5 |
| `#durTime` | 深（`--hk-bg`） | `#9FB1BC` / `#34424B` | 11px | 4.68 | ✓（贴线） |
| `#durTime` | 深（卡面 `--hk-surface`） | `#9FB1BC` / `#414D56` | 11px | **3.9** | ✗ |
| `#curTime` | 浅 | `#6B6158` / `#F8F4ED` | 11px | 5.51 | ✓ |
| `#modeBtn` 图标 | 浅 | `#6B6158` / `#F8F4ED` | — | 5.51 | ✓ |
| `#favBtn` 红心 | 浅 | `#537D96` / `#F8F4ED` | — | 4.04 | 非文本需 3:1 → 过 |
| `#favBtn` 悬停 | 浅 | `#537D96` / `#EDF0F0` | — | 3.86 | 非文本 → 过 |
| `#playBtn` 字形 | 浅 | `#FFFDF7` / `#537D96` | — | 4.35 | 非文本 → 过 |
| `.list-tab` 未选中 | 浅 | `#FFFDF7` / `#537D96` | 12px | 4.35 | ✗ 微差 |
| `.list-tab` 未选中 | 深 | `#2A3238` / `#537D96` | 12px | **2.94** | ✗ |

**根因**：`--hk-faint` → `var(--text-light, var(--fallback-faint))`，而 `--fallback-faint` 浅色档是 `#8E9196`（`ui/style.css:20`）、深色档与 `--fallback-muted` 共用 `#9FB1BC`（`ui/style.css:32-33`）。`--hk-faint` 用在 `#durTime`、`.q-dur`（`ui/style.css:1113`）、`.bili-pdur`、`.q-guide-hint`、`.lm-cand-src` 等多处。

---

## 3. 九项问题

### 问题 1 ｜ [P1] 页面内零键盘快捷键

- **位置**：`ui/app.js:6335` 是**全文件唯一**的业务 `keydown`，且开头即 `if (e.key !== 'Escape') return;`。另有四处局部的 Enter 处理（`4770` 改名框、`6195` 歌手搜索、`6208` 搜索输入、`6325` 链接输入）。
- **现象**：空格 / ←→ / ↑↓ / M 全部无绑定。快进退只能拖 `#seek`，音量只能悬停 `#muteBtn` 弹竖条后拖，暂停只能点 `#playBtn`（控制条位于底部）。
- **证据**：`grep -n "keydown" ui/app.js` 全量结果即上述 5 条；浏览器实测 `#playBtn` 在 1040×780 下中心坐标约 (520, 690)，与舞台区域垂直距离约 690px。
- **为什么是问题**：独立窗 1040×780 是桌面语境，空格暂停是这些用户的肌肉记忆。`prefers-reduced-motion` 与 `mediaSession`（`ui/app.js:3883` 的 `msPlayback` / `syncMediaSession`）都接了，唯独页面内键位空缺 —— 这是不对称的漏项，不是刻意留白（若刻意，应在 AGENTS.md 有记录，实际没有）。
- **建议改法**：在 `ui/app.js:6335` 那层加一个前置分支，先判输入上下文再分发：

  ```js
  var t = e.target;
  var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (!typing) {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); $('playBtn').click(); return; }
    if (e.key === 'ArrowLeft')  { seekBy(-5); return; }
    if (e.key === 'ArrowRight') { seekBy(5);  return; }
    if (e.key === 'ArrowUp')    { /* 音量 +5% */ return; }
    if (e.key === 'ArrowDown')  { /* 音量 -5% */ return; }
    if (e.key === 'm' || e.key === 'M') { $('muteBtn').click(); return; }
  }
  ```

  全部走已有按钮的 click 处理，**不新建状态路径**；`seekBy` 复用现有 seek 落盘逻辑（注意别绕过 `pendingSeek` 护栏）。
- **风险点**：`Space` 必须 `preventDefault`（否则页面滚动）；`#seek` 是 `<input type=range>`，聚焦时 ←→ 会被浏览器原生吃掉，需要决定是否在 range 聚焦时让位给原生行为。独立窗里宿主是否也注册了全局热键，需真机确认不冲突。
- **验证建议**：`node tools/verify-ui.mjs` 加断言（`Space` → `state.playing` 翻转；`ArrowLeft` → `audio.currentTime` 减 5；输入框聚焦时上述全部不生效）。

---

### 问题 2 ｜ [P1] 关键小字对比度不达 AA（最差 2.88:1）

- **位置**：`ui/style.css:20`（`--fallback-faint: #8E9196`）、`:32-33`（深色档 `--fallback-muted` 与 `--fallback-faint` 同值 `#9FB1BC`）、`:49` 与 `:70`（`--hk-faint` 桥）、`:1113`（`.q-dur`）、`:1787` 上游的 `#durTime` 消费链；`.list-tab` 未选中态的 `color: var(--hk-muted)`（`ui/style.css:957-970`）。
- **现象**：见 §2 表格。`#durTime` 浅色档 2.88:1，深色卡面档 3.9:1；`.list-tab` 深色档 2.94:1。探测器在 `ui/index.html` 上独立报了 6 处 `low-contrast`。
- **为什么是问题**：时长是用户反复读的信息（还有多久、要不要切歌），11px 再降到 2.88:1，在低质量屏或户外基本是一块灰。注意**宿主注入主题时**（`--text-light` 由宿主给）表现不同 —— 这个 2.88 是**兜底调色板**下的值，只在宿主未注入（开发预览、SDK 未就绪窗口期）时出现。但深色卡面 3.9:1 是兜底与部分宿主主题都会踩到的。
- **建议改法**：
  1. `--fallback-faint` 浅色档从 `#8E9196` 调到 ≥4.5:1（对 `#F8F4ED` 约需 `#6E6A63` 一带；请自行算准）。
  2. 深色档把 `--fallback-faint` 从 `--fallback-muted` 里**分开**（`:32-33` 现在是同一个值），压卡面 `#414D56` 时 ≥4.5:1。
  3. `.list-tab` 未选中态若在强调底上显示，字色改吃 `--hk-on-accent` 而不是 `--hk-muted`。
  4. 改完把算出的比值写进注释防回归。
- **风险点**：`--hk-faint` 同时承担「最弱一档信息」的语义，整体加深会削弱层级；建议**只加深关键读值**（时长类），保留角标类。注意宿主注入时会覆盖，别改宿主变量。
- **验证建议**：写一个对比度扫描脚本（本仓 `tools/` 下已有 puppeteer 基础设施），把 `#durTime` / `.q-dur` / `.list-tab` / `.q-artist` 纳入断言，两主题各跑一遍。

---

### 问题 3 ｜ [P1] 涟漪调节 6 滑条是工程面板泄漏进用户面

- **位置**：`ui/index.html:66-112`（`#rippleToolBtn` + `#rippleToolPop`，6 个 `<input type=range>`：`rt_visualGain` / `rt_bassDrive` / `rt_onsetSens` / `rt_midHighSens` / `rt_maxAudioWaves` / `rt_onsetCooldown`）；样式 `ui/style.css:1305`（按钮，34×34，**仅 `data-layout="wide"` 显示**）；默认值 `ui/app.js:1838-1843`（`RIPPLE_DEFAULTS`）；存储键 `player-ripple-tune`。
- **现象**：面板直接浮在播放舞台左下角，6 个滑条 + 一个「重置为默认」。每个滑条只有一句 11px 短语（如「低音把水面推多高」），无分组、无预设、无「什么情况下该动它」。
- **证据**：浏览器实测 `#rippleToolBtn` 在 465×930 与 312×494 是 `display:none`，在 1040×780 是 `display:flex` 34×34。→ 只在最不容易造成干扰的大屏出现（这个选址判断是对的）。
- **为什么是问题**：全界面唯一「决策点可见选项 > 4」的地方（6 个），违反认知负荷清单的 Minimal choices。对一款以「安静克制」为卖点的播放器，这是最大的气质断层。但注意：**它只在宽窗出现，且需要用户先点那颗 34px 的低透明度图标**，实际打扰半径比看上去小 —— 评估时请给这一点合理权重。
- **建议改法**：两段式。默认给 3 档预设（柔和 / 标准 / 澎湃），每档配一句人话，当前档用选中态标出；一个「高级」折角再展开原 6 个滑条，并给每根补一句「什么时候你会想动它」。**存储键与参数语义不变**（`RIPPLE_DEFAULTS` 的 6 个字段名保持），只改呈现层与入口。
- **风险点**：预设档位要映射到那 6 个连续参数，映射表需要有依据（建议按 `docs/player-ui/handoffs/RIPPLE-LAB.md` 的标定数据反推，别拍脑袋）。改后原断言里引用 `#rippleToolPop` 内部 id 的会失效。
- **验证建议**：截图对比三档预设在同一段音频下的水面形态差异；断言「预设档切换 → 6 个参数按映射表落地」。

---

### 问题 4 ｜ [P2] toast 无 `role="status"` / `aria-live`

- **位置**：`ui/index.html:315` `<div class="toast" id="toast" hidden></div>`；写入出口 `ui/app.js:1001` 的 `toast(msg)`。
- **现象**：实测 `role` 与 `aria-live` 均为 `null`。而所有关键反馈都走它：`已加入我的喜欢` / `已取消喜欢` / `已从队列移除` / `所有源均未找到：曲名` / `自动播放被拦，点「继续播放」` / `已删除歌单「X」，3 首` / `播放失败：曲名`。
- **为什么是问题**：红心点下去视觉变了但读屏静默 → 用户重复点 → **重复点会取消喜欢**。这是静默成功引发的二次错误，不是纯体验瑕疵。
- **建议改法**：`#toast` 加 `role="status"` 与 `aria-live="polite"`；对失败类（`播放失败`、`所有源均未找到`、`播放失败`）另走 `role="alert"` 或临时切 `assertive`。`toast()` 是单一出口（`app.js:1001`），改一处。
- **风险点**：`role="alert"` 会打断读屏当前朗读，用得过多反而吵；建议只在失败类用。`hidden` 切换在部分读屏上不触发播报，可能需要改成内容清空 + 常驻节点（需真机验证）。**这一条我无法在本机验证读屏行为**，只能验证属性存在性。
- **验证建议**：真机 VoiceOver 实测（当前环境无）。

---

### 问题 5 ｜ [P2] `#firstRun` 不吃 Esc、不接管焦点、无焦点回收

- **位置**：`ui/index.html:349-356`（`#firstRun` / `.fr-card`，`role="dialog"` 但**无 `aria-modal`**，按钮 `#firstRunOk`）；Esc 链 `ui/app.js:6335-6346`（**不含 `#firstRun`**）；显示逻辑 `ui/app.js:724-737`（`maybeShowFirstRun` / `closeFirstRun`，仅 `hidden` 切换）。
- **现象**：Esc 分层链依次收 校准工具条 → 手动匹配歌词 → 音量浮层 → 涟漪面板 → 搜索页 → 各类浮层 → 抽屉，独独没有它。打开/关闭都不移动焦点。
- **为什么是问题**：它只弹一次（`FIRST_RUN_KEY` 记忆已读），但弹出那一刻是用户**第一次**进 App。此刻 Tab 会跑到背后被挡住的控制条上（视觉不可见），Esc 关不掉。文案本身也偏开发者向（`cookies.env`、「问你的 Hana」）。
- **建议改法**：Esc 链顶端加 `#firstRun`（判未 hidden 且未标记已读）；打开时焦点移到 `#firstRunOk`，关闭时焦点还回触发元素或 `#playBtn`；补 `aria-modal="true"` 并把背景 `inert`（`ui/app.js:843` 的 `controls.inert = hidden` 已有先例可抄）。文案建议同步改：把「在 cookies.env 里填一次登录 cookie」改成用户视角的一句话。
- **风险点**：`inert` 加在哪些容器上要谨慎 —— 弹层在 `.player` 内部，若对 `.player` 整体 inert 会把弹层自己一起冻住。需要只对舞台与控制条 inert。
- **验证建议**：断言「弹出时 `document.activeElement === #firstRunOk`」「Esc 后 `#firstRun.hidden === true`」「关闭后焦点回到 `#playBtn`」。

---

### 问题 6 ｜ [P2] 一批交互命中盒 < 44×44（浏览器实测）

- **位置与实测值**：

  | 元素 | 选择器 / 定义处 | 尺寸 | 备注 |
  |---|---|---|---|
  | 队列头三键 | `.icon-btn`（`ui/style.css:978`）`#renameBtn` / `#importBtn` / `#drawerCloseBtn` | 30×30 | 三处共用同一类 |
  | 队列行更多 / 红心 | `.q-more`（`:1119`）/ `.q-fav`（`:1164`） | 30×30 | `.q-fav` 窄卡 26px（`:1184`） |
  | 歌单切换 | `.list-tab`（`:957`，`padding: 5px 12px` + `line-height:1.3`） | 高 **28** | 宽度 ≥50，仅高度不足 |
  | 播放页红心 | `.fav-btn`（`:668`）`#stageFavBtn` | 26×26 | 窄卡 **22×22**（`:683`） |
  | 涟漪调节 | `.ripple-tool-btn`（`:1305`） | 34×34 | 仅宽窗 |
  | 空态按钮 | `.q-guide-btn`（`:1018`） | 高 **35** | 如「选择文件夹」 |

- **为什么是问题**：这 App 明确支持到 312×494 的聊天卡，那就得按触摸标准。312 卡上点头顶 22px 的红心误触率很高，点错会切列表或开抽屉。桌面鼠标场景影响小。
- **建议改法**：命中盒与视觉尺寸**解耦** —— 用伪元素覆盖或 `padding` + 负 `margin` 扩张到 ≥44×44，视觉尺寸不动。`#stageFavBtn` 窄卡至少 32px。`.list-tab` 高度提到 36 需同步调 `listTabs` 的 `--tab-fade-l/r` 掩码。
- **风险点**：`ui/style.css:400-421` 有一组 `:active { transform: scale(0.96) }`，扩命中盒时别把相邻按钮的按压区叠在一起（尤其 `.q-more` 与 `.q-fav` 是紧邻的 sibling）。`#splitHandle` 与 `#seek` 之类的 range 滑轨本体不应按 44px 计。
- **验证建议**：写断言「所有可见 button 的 `getBoundingClientRect()` 宽高 ≥44（排除 range 与 `[hidden]`）」。我这次的脚本可直接搬。

---

### 问题 7 ｜ [P3] 红心用了歌词高亮色 `--hl-accent`，会随封面漂移

- **位置**：`--hl-accent` 定义在 `ui/style.css:112`（`var(--hk-accent)`）；红心三处消费它在 `.fav-btn`（`:668-682`）、`.fav-btn-bar`（`:1144`）、`.q-fav`（`:1164-1186`）。环境色生效时 `--ambient-accent` 由 `ui/app.js:1338` 从封面主色派生并覆盖。
- **现象**：换一首歌（换封面）红心描线色会变。浅色档实测红心 4.04:1、悬停 3.86:1，本就在及格线徘徊。
- **为什么是问题**：一是「喜欢」跟着封面换色，用户会以为状态变了；二是 `ui/style.css:296-311` 的注释**明确写了**「控制条与队列是常驻面板，不是沉浸区；封面换一首歌就换色的话按钮会跟着晃」，光晕系统遵守了这条，红心没遵守 —— 这是内部不一致，不是审美分歧。
- **建议改法**：给「喜欢」独立一档 `--fav-color`，默认 `--hk-accent`，在浅色封面上自动加深一档（或把红心也纳入 `probeAmbient` 的对比度择优）。若「随封面变」是有意为之（让红心在深色封面上也被看见），把这个判断写进注释并固定一个下限对比度。
- **风险点**：红心当前是**唯一**用撞色在封面上保证可见的元素；改成固定色后深色封面上可能又看不见。两难，需要实测几种封面再拍板。**这一条建议先由用户决定语义，再动代码。**
- **验证建议**：深/浅封面各一张截图对比。

---

### 问题 8 ｜ [P3] 无封面兜底是 45° 细斜纹

- **位置**：`ui/style.css:131`，`--cover-fallback` 的第一层：`repeating-linear-gradient(135deg, color-mix(...--hk-text 2.5%...) 0 1px, transparent 1px 13px)`。
- **现象**：探测器标 `repeating-stripes-gradient`（advisory）。45° 细斜纹是「占位图」的通用视觉签名。
- **为什么是问题**：无封面曲目（本地导入音频常见）的**第一眼印象**就是这块斜纹，与「极简克制」的调性不搭。属 P3，不影响功能。
- **建议改法**：删掉第一层，保留现有的第二、三层（径向渐变 + 线性渐变）—— 它们已经构成一个安静的兜底。删掉后比现在更克制。
- **风险点**：几乎没有。`--cover-fallback` 只作 CSS 兜底，`--cover-image` 有真图时被覆盖。
- **验证建议**：截图对比无封面曲目在三种布局下的观感。

---

### 问题 9 ｜ [P3] 两处字号破了自家 ≥11px 规约

- **位置**：`ui/style.css:1959-1965` `.lm-cand-src { font-size: 10px }`（手动匹配歌词的候选来源角标）；`ui/style.css:2652` `.bili-pidx { font-size: 10.5px }`（B站分集序号）。
- **规约出处**：`AGENTS.md` §2 硬约束第 5 条「字号**不低于 11px**」；`docs/player-ui/CONTRACT.md` 也写了「所有字 >=11px」。
- **为什么是问题**：自家规约被自己破说明**没有机械检查在管这条**，后续新组件会跟着破。
- **建议改法**：两处提到 11px（`.bili-pidx` 是数字列，加宽一点不影响布局；`.lm-cand-src` 是胶囊角标，注意 `padding: 1px 6px` 下的高度变化）。顺手把「渲染字号 < 11px」扫描加进 `tools/verify-ui.mjs` 的页面内自检。
- **验证建议**：全表扫描断言（我这次的脚本已实现，可直接搬）。

---

## 4. 误报判定（请评审方复核这几条）

| 探测器结论 | 判定 | 依据 |
|---|---|---|
| `low-contrast: :hover state 1.8:1 — #e1eaf0 on #adadb3` / `1.1:1 — #c99aaf on #adadb3` | **误报** | `#adadb3` 在 `ui/` 全目录 grep **零命中**。它是探测器为合成 hover 背景自造的中灰。真实悬停实测：`.icon-btn` 9.51:1（浅）/ 8.78:1（深），红心悬停 3.86 / 3.57 —— 悬停反而更好 |
| `cramped-padding` on `.frame` | **误报** | `manifest.json` 的 `cards[].cardForm: "edge-to-edge"` 是宿主契约要求的满出血。值得在 CSS 里留一行说明免得再被标 |
| `cream / beige palette`（浏览器 banner） | **语境误报，但含真信息** | 命中的是第三优先级兜底 `--fallback-bg: #F8F4ED`，真机永远被宿主主题覆盖。真信息：宿主未注入主题时（开发预览、无头测试、SDK 未就绪窗口期）这个 App 长成 Hana 纸感，与它真正住的深板岩面**不是一套** |
| `bounce or elastic easing`（浏览器 banner） | **确有其事，判为有意** | `ui/style.css:420` `.play-btn` 的 `cubic-bezier(0.34,1.56,0.64,1)` 是刻意的弹性回弹。是否保留属审美决策，不是 bug |
| `tiny-text: 11px body text` | **与自家规约一致，非问题** | 11px 是 AGENTS.md 定的下限。探测器按它自己 12px 的偏好报的 |
| `repeating-stripes-gradient` | **真存在** | 见问题 8 |

---

## 5. 未纳入本清单但值得知道的事

1. **演示数据残留在生产 DOM**：`#trackTitle` 初值「风经过的地方」、`#curTime` `1:03`、`#durTime` `4:44`、`#queueCount` / `#queueBtnCount` `12`、`#seek` 的 `max="284" value="63"`、`#vol value="72"`。运行时全被 JS 覆盖（实测有真实数据时残留为 0），无功能影响，但是宿主快照首帧的闪烁源。
2. **modal 语义不完整**：`#lyricMatchPop .lm-card`（`ui/index.html:320`）与 `#firstRun .fr-card`（`:350`）都是 `role="dialog"` 但无 `aria-modal`；`inert` 全代码只用于 `controls`（沉浸模式），没有一处 modal 用它关背景。
3. **窄卡平台条横滑无提示**：搜索页头部在窄卡用 `mask-image` 两端渐隐 + 竖滚轮转横滚，功能完整但没有视觉提示告诉用户可以滑（`ui/style.css:955-956` 的 `is-scroll-l/r` 由 JS 按 `scrollLeft` 切）。
4. **窄卡无分隔线调节**：`#splitHandle` 在窄卡 `hidden`，没有替代路径。合理但值得记一笔。
5. **`audio error` 分支文案不够精确**：`ui/app.js:3997` 只说「播放失败：曲名」，而 `onAutoplayBlocked`（`:3883`）已经正确分流了 `NotAllowedError` 与加载失败 —— 两处标准不一致。

---

## 6. 给评审方的建议核查顺序

1. 先跑 `node tools/verify-ui.mjs`（基线应 **296/296** 左右，含 12/12 布局、4/4 窄卡、零运行时错误），确认工作树没坏。
2. 复跑 `impeccable detect --json ui/index.html ui/standalone.html`，核对 §1 的数量与规则名。
3. 用本仓 `tools/verify-ui.mjs` 的假后端套路起真实状态，复测 §2 的对比度表（我用的脚本模式：起静态服务 + 伪造 `/widget/api/playlist` 与 `/api/playback-state`）。
4. 对 9 条问题逐条判定：**同意 / 部分同意 / 不同意**，不同意的请给反证（代码位置或实测数据）。
5. 对每条的「建议改法」评估：可行性、风险、是否能保持单文件与孪生约束、是否需要同步 `standalone.html`、改完是否需要 `node tools/bump-build.mjs` + `extension_manager reload app:hanako-simple-player`。

## 7. 硬约束提醒（改任何一条前必读）

- `ui/index.html` 与 `ui/standalone.html` 必须同步（只差 5 行 AudioContext 调试块）。
- 改完跑 `node tools/bump-build.mjs`（同步 `ui/_build.json` + 两个 html 的 `window.__HANA_BUILD`）。
- `ui/index.html` 里 `PV:BEGIN` / `PV:END` 之间是生成物，别手改。
- 宿主快照 UI：改了文件不会自动生效，必须 reload app。
- 禁 `position:fixed`；聊天卡右上角 100×40 CSS px 是宿主控件安全区；顶部两角要圆；禁 emoji；字号 ≥11px；颜色走 CSS 变量不硬编码。
- 许可证 **AGPL-3.0**（衍生自 openhanako-labs/openhanako-audio-player），不是 MIT。

---

*生成自 `/impeccable critique`，快照在 `.impeccable/critique/2026-10-12T10-05-20Z__ui-index-html.md`。本文档不修改任何源码。*

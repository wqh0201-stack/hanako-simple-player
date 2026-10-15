# 任务书 · 歌名/来源入口 + 单曲获取封面（目标版本 1.1.7）

> 交付对象：codex。验收方：Hana 侧（本会话统筹 DeepMind）。
> 本文件是**唯一的需求来源**；与代码注释冲突时以本文件为准，与 `AGENTS.md` 冲突时以 `AGENTS.md` 为准。
> 动笔前必读，按序：`AGENTS.md` → `~/.hanako/skills/hana-app-creator/SKILL.md` →
> `~/.hanako/artifacts/server/<最新版本>/APPS.md`（宿主契约权威，路径用 `ls` 找最新版）。
> 仓库路径：`/Volumes/SSD/hanadesk/hanako-audio-player-simple`。许可证 AGPL-3.0，别改。

---

## 0. 一句话目标

同一批 UI 改动里做两件独立的小事：

- **A｜封面上的歌名和「来源」变成入口**：歌名点一下 = 用这首歌名去搜；「来源·歌单名」点一下 = 跳到这首所属的歌单并把这首滚到中间；两处 hover 有轻微反馈。
- **B｜队列行 ⋯ 菜单加一项「获取此曲封面」**：给这一首单曲去在线补/换一张封面。

两件事都只动前端 `ui/`，可以一起做、一起部署、一起验收。

---

## 0.5 基线（动手前先读）

- `manifest.json` / `package.json` version = `1.1.6`；构建号 `1003131705`（`ui/_build.json`）。
- 开工时工作树应为**干净**（`git status` 无输出）。若已有在途改动，先回报 Hana，别覆盖。
- 开工先跑一遍 `node tools/verify-ui.mjs` 与 `node tools/verify-backend.mjs`，**记录你自己的基线**
  （通过与失败集合）。后续断言以此为准，别照抄历史数字。
- 需要打桩宿主接口时，沿用 `verify-ui.mjs` 现有桩法；封面接口走 `ENDPOINT.coverCatalog`，
  可参考 `tools/verify-cover-catalog.mjs`。

---

## 1. 需求 A｜封面上的歌名与来源变入口

### A1. 歌名可点 → 用歌名去搜

**现状**：`#trackTitle` 是 `ui/index.html` / `ui/standalone.html` 里的
`<h1 class="track-title" id="trackTitle">`，纯文字，只有 `textContent` 与 `title` 属性；
渲染在 `renderTrack()`（`ui/app.js` 约 2042 / 2057 行）。

**行为**：有曲目时，点歌名 → 打开搜索页并搜索这首歌名，等价于现有「点歌手名搜歌手」的歌曲版：

- `searchInput.value` = 当前曲目歌名；
- `searchScope = 'song'`（默认值，见 `ui/app.js:6635`）；
- `openSearch()` → `doSearch()`。

参考实现：`openArtistSearch()`（`ui/app.js` 约 7048 行）与它在 `ui/app.js:7487` 的绑定。

**边界**：无曲目时（`renderTrack` 里标题显示「还没有曲目」）歌名**不可点、不应有按钮语义**。

**实现自由**：真 `button`，或 `role="button" + tabindex="0"`（键盘 Enter / Space 都要能触发）。
但必须：

- 视觉仍是现在那行大字标题（不缩字号、不改排布）；
- 不破坏 `ui/app.js` 约 3543 行 `getComputedStyle($('trackTitle')).fontSize` 的峰值字号测量；
- 无障碍名称清楚（例如 `aria-label="搜索这首歌：<曲名>"`）。

### A2. 「来源·歌单名」可点 → 跳歌单并居中

**现状**：`#trackMeta` 是 `<p class="track-meta" id="trackMeta">`，内容由
`metaLine(t)`（`ui/app.js:1977`）生成 = `'来源·' + sourceName(t)`（`sourceName` 见 `ui/app.js:739`）。

**行为**：点它 → 切到这首曲所属的歌单，并把这首滚到列表中间：

1. `state.activeList = listOf(t)`（`listOf` 见 `ui/app.js:164`）；
2. `renderQueue()`；
3. 按当前布局**先打开面板**再定位：
   - `long`（长卡）：队列常驻，**不需要打开**，直接切 + 居中；
   - `compact`（窄卡）：`setCompactPage('queue')` 切到队列页；
   - `wide`（独立窗）：`setDrawer(true)` 打开右侧抽屉；
4. `centerCurrentInQueue()`（`ui/app.js:2279`）。

**边界**：

- 无曲目时不可点；
- 这首歌已不在任何用户歌单（`listOf` 取不到 / 列表被删）→ 退回它所在的在线 / 本地列表，
  **不报错、不跳空**；
- 别和紧邻的红心按钮 `#stageFavBtn` 冲突（点击区域不要重叠、事件不要冒泡到红心）。

**居中时机**：`setDrawer` / `setCompactPage` 用的是 `transform` 动画（元素仍在布局中，
`clientHeight` 有效）。若发现动画过程中居中不准，就在动画回调里再居中一次；不要为此改成
`display:none` 之类的重排方案。

### A3. 两处 hover 轻微反馈

- 罐头选「悬停时轻微变化就够」：**不加额外图标**，只做轻微提亮 / 变色。
- 走现有 CSS 变量，**不另起明暗 / 主题**；强调色只用在「当前 / 激活 / 强调」；字号 ≥ 11px。

---

## 2. 需求 B｜⋯ 菜单「获取此曲封面」

### B1. 菜单项

在 `morePop`（`ui/index.html` 的 `.pop-more`，含 `removeBtn` / `moveBtn` / `copyNameBtn`）里，
**「复制歌名」之后**加一项「获取此曲封面」：

- 自己的 id（例如 `getCoverBtn`），`class="pop-item"`，带一枚**线描 SVG 图标**（项目禁 emoji；
  `#i-copy` / `#i-disc` 之外如需新图标，按现有 `<symbol>` 方式补，viewBox 24）；
- 目标曲用现有 `moreTargetUid`（`ui/app.js:5284` / 5719）取。

### B2. 行为（罐头拍板）

**单曲级在线补封面；即使这首已有封面也重新搜一张。**

点击后：

1. 取歌手：`t.author`（等于 `t.artist`，见 `normalizeTrack`）；为空则用 `cleanCoverQuery(t.title)`
   里的歌手线索；**仍拿不到歌手** → `toast('这首没有歌手信息，先补全歌手或用歌单级「补全封面」')`，不做别的。
2. 走现有 `coverCatalog` 链路（`ENDPOINT.coverCatalog` 见 `ui/app.js:103`；`coverData` 见 `ui/app.js:6461`）：
   `kind=artist` → `kind=albums` → `kind=album` → 拼 `dictionary` → `pickCoverMatch(t.title, artist, dictionary)`
   取最佳匹配。
3. 命中：`applyCoverMatch(id, match, artist, at)`（`ui/app.js` 约 6527 行）覆盖 `t.pic`
   （原封面会存进 `raw.coverMatch.originalPic`，可被 `restoreCovers` 恢复）→ `savePlaylist()` 落盘 →
   `renderQueue()` / `renderTrack()` 刷新 → `toast` 成功。
4. 未命中 / 探图失败：`toast` 明确提示，**不改封面**。

**要点**：

- 这是**单曲**版本。整歌单批量版（`openCoverPanel` / `startCoverFill`）**保持不变，别动它的行为**。
- 现有 `coverTargets` 只针对 `bilibili:` 曲目；本功能**不要**沿用那个过滤，应支持任意曲目
  （有歌手即可）。
- 请求中禁用该菜单项防连点；失败一律走 toast，不弹惊悚错误。

### B2b. 恢复路径（修订，2026-10-15 统筹确认）

**允许**把 `restoreCovers` 的**恢复目标**从「仅 B站曲目」扩到「任意平台、只要该曲
`raw.coverMatch.originalPic` 存在」。

- **理由**：单曲「获取此曲封面」对任意平台都会备份原图，若恢复入口仍只认 B站，
  非 B站的原图就没有取回路径，「可恢复」名不副实。
- **边界**：**补全 / 搜索路径保持不变**（`coverTargets` / `startCoverFill` 仍只处理 B站曲目）；
  只放宽**恢复**一侧的目标范围（新增一个「按 `coverMatch.originalPic` 存在」的恢复目标集合即可，
  不要复用 `coverTargets` 的 B站过滤）。恢复入口位置不变。
- 相关文案若带「B站」限定需同步修正，别让用户误以为只能恢复 B站；断言相应更新。

### B3. 交互形态

- **一键完成，不新开面板**；进度 / 结果用现有 `toast` 反馈。
- **设计假设**：一键自动取最佳匹配。若你认为需要「列候选让用户挑」这种更可控的形态，
  **先回报 Hana 再定**，别自行扩 UI。

---

## 3. 不要碰

- `lib/` 后端（audio-owner / mood 等已有逻辑），本任务纯前端。
- `playlist.json` 形状、`uid` 规则（`uid = list|id`）、歌词相关逻辑。
- 整歌单级「补全封面」面板的行为。
- 既有断言不要改松来消除红项。

---

## 4. 交付与部署（严格按 AGENTS.md §4）

1. 改 `ui/app.js`、`ui/style.css`、`ui/index.html`、`ui/standalone.html`。
   **孪生文件必须同步**：两个 html 除 `body` 的 `data-shell`（`card` / `window`）外内容一致。
2. `manifest.json` / `package.json` 版本 `1.1.6 → 1.1.7`。
3. `node tools/bump-build.mjs`（同步 `ui/_build.json` 与两个 html 的 `window.__HANA_BUILD`）。
4. `docs/CHANGELOG.md` 新增 `## 1.1.7` 段，写「对用户意味着什么」。
5. 技术交接 `docs/player-ui/handoffs/SONG-ENTRY-COVER-DONE.md`：改动文件与原因、需求对应情况、
   原始验证输出、断言编号、版本与构建号、开放问题的证据、待 Hana 真机验收项。
6. 部署：`ui/` **整包**同步到 `~/.hanako/apps/hanako-simple-player/`（index / standalone /
   style.css / _build.json），再 `extension_manager reload app:hanako-simple-player`。
   **光同步文件不 reload 不生效。**
7. 完成后直接给 Hana 发消息（协作约定见 `docs/COLLABORATION-HANA-CODEX.md`）。

---

## 5. 验收清单（供 Hana 独立复跑，Codex 先自验）

**A. 静态**

- [ ] `ui/index.html` 与 `ui/standalone.html` 除 `data-shell` 外内容一致
- [ ] 版本 = `1.1.7`；构建号已 bump 且 `_build.json` 与两个 html 三处一致
- [ ] 官方静态校验 0 error

**B. 无头 UI（`tools/verify-ui.mjs` + 新增断言）**

- [ ] 有曲目时点歌名 → 搜索页打开、关键词 = 曲名、`searchScope === 'song'`
- [ ] 无曲目时歌名不可点（无按钮语义 / 点击无反应）
- [ ] 点「来源」→ `state.activeList` 切到 `listOf(t)`，且当前曲被居中；
      `long` 直接定位、`compact` 切到队列页、`wide` 打开抽屉
- [ ] `morePop` 含「获取此曲封面」项；打桩 `coverCatalog` 命中时 `t.pic` 被替换，
      且 `t.raw.coverMatch.originalPic` 记录了原图
- [ ] 无歌手 / 未命中 / 请求失败三条路径：不崩、有 toast、不改封面
- [ ] 既有断言全部保持通过（不得改松）

**C. 真机（Hana 做，Codex 不宣称）**

- [ ] 聊天卡片 + 独立窗各点一次歌名 / 来源 / 获取封面，记录实际现象
- [ ] 窄卡、独立窗下点「来源」能正确打开面板并定位到这首
- [ ] 浅 / 深主题下 hover 反馈正常、不明显跳眼

---

## 6. 边界说明

- 本任务**纯前端**，不改后端；但仍按 §4 整包同步 `ui/` 再 reload（构建号变了）。
- 发版（tag / GitHub Release / 市场 PR 更新）**不在本任务范围**，需用户点头、Hana 真机验收通过后由 Hana 执行。

---

## 7. 返修 · 获取封面缺过程反馈（2026-10-15，罐头真机反馈）

### 7.1 现象与根因（Hana 已定位）

罐头真机点「获取此曲封面」：**等待期间没有任何提示**，不知道它在获取中（最终获取成功）。

根因：`ui/app.js` 的 `toast()`（约 1471 行）只显示 **2600ms 就自动隐藏**；而单曲补封面是
「`kind=artist` → 逐张 `kind=album` → 匹配」的**多请求、数秒**过程。那句
`toast('正在获取此曲封面…')` 2.6 秒后就消失，等待期间界面无任何进行中指示。
（`$('getCoverBtn').disabled = true` 无效：点击后菜单已被 `closePops()` 关掉，用户看不到按钮态。）

### 7.2 要求

1. **进行中提示必须持续可见，直到出现结果**，不随 2.6 秒超时消失。
2. 结束时收起进行中提示，并用结果提示收尾（成功 / 没找到 / 失败），三条路径都要有明确收尾。
   成功路径的 toast（「已获取此曲封面」）**保持现状**（已实测正常）。
3. **罐头指定形态（以这个为准）**：获取期间在**封面左上角**显示一个**小号加载圆圈（spinner）**，
   获取结束即消失。用纯 CSS 或 SVG 线描（**禁 emoji**），尺寸克制、颜色走 CSS 变量；
   左上角正好避开聊天卡片右上角 100×40 的宿主控件安全区。
   实现方式你定（一个小元素 + 开关类即可）；保持 ES5、不新增权限、不改后端、字号 ≥ 11px。
4. 等待较久时可附阶段进度文案（如「读取专辑 3/12」），可复用 `startCoverFill` 里已有的计数逻辑；
   若不附文案，单有 spinner 也可接受。
5. **可选优化（请先给证据再定，不强制）**：单曲补封面时改为「边读专辑边匹配、命中即停」，
   避免为单曲枚举该歌手**全部**专辑（当前是读完全部专辑再匹配）。
   若能显著缩短等待，请给出改动前后的耗时对比；若质量有风险，回报 Hana 再定。

### 7.3 返修验收

- [ ] 真机（卡片 / 独立窗）点「获取此曲封面」：点击后**立即**出现持续可见的进行中提示，
      等待期间**不消失**，直到出现结果提示
- [ ] 无歌手 / 未命中 / 请求失败：都有明确的结束提示
- [ ] 既有断言不放松；新增断言覆盖「进行中提示在结果出现前保持可见」
- [ ] 构建号 bump、孪生 HTML 同步、CHANGELOG、交接文档按 §4
- [ ] 真机复验由 Hana 做

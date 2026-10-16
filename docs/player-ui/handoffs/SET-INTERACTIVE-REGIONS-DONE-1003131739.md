# 横条接入 `setInteractiveRegions` · Codex 交接

2026-10-16。版本 **1.1.7**，构建 **1003131739**（基线 1738）。
任务方：DeepMind（统筹）→ 码农实现与自验。**部署与真机验收由 DeepMind 执行。**
本轮**只改 `ui/app.js`**（外加 bump 出的 `_build.json` / 两个 HTML 的构建号），
未动 manifest、未扩权、未改后端、未改 app-data、未碰 `ui/style.css`。

---

## ① 改了什么

### `ui/app.js`（唯一实现文件；`node --check` 通过）

在 `setAttrIf` 之后新增一段「宿主标题带交互区」模块（约 60 行），四个函数 + 1 个状态对象：

- `hostInteractiveRegions()` — 现查 `window.hana.surface.setInteractiveRegions`。
  **不缓存**判定结果（宿主可能晚挂载能力），拿不到就返回 `null` → 走降级。
- `stripInteractiveRectangles()` — 算出要上报的矩形集合：
  `#seek`（铺满整条，它就是拖进度的命中区）+ `#playBtn/#prevBtn/#nextBtn/#modeBtn/#favBtn/#muteBtn`，
  音量浮层展开时再加 `#volGroup`。**只收当前真的可见的**（`hidden` / `offsetParent===null` / 零尺寸都跳过），
  契约硬上限 64 个，超出截断。
- `pushInteractiveRegions()` — 真正调用。先算 key（四舍五入到整 px 拼接），
  **与上次相同就跳过调用**（契约明确要求「跳过未改变的集合」，也避免悬停/拖动时反复 IPC）。
  失败进 `.catch` / `try-catch`，只写 `console.warn` 和 `lastError`，**绝不抛、绝不改现有交互**。
- `syncInteractiveRegions()` — 用 `requestAnimationFrame` 合并同一帧的多次请求。

### 挂钩点（4 处，全部在既有布局节奏上，不进逐帧路径）

| 挂钩 | 位置 | 作用 |
|---|---|---|
| `arrangeStrip()` 结尾 | app.js:8235 | 每次横条重排（含 resize）后重算 —— 主路径 |
| `applyLayout()` 形态切换 | app.js:8429 | **退出横条时**重算 → 空集合，清掉宿主侧打洞 |
| `openVolPop` / `closeVolPop` | app.js:5287 / 5295 | 音量浮层开合改变集合 |
| `visibilitychange` | app.js:8365 | 隐藏时重算（集合为空） |

### `window.__playerDebug.interactiveRegions()`（真机验收探针）

返回 `{ supported, applied, lastError, count, rects, cardHeight, stripTop, stripBottom }`。
`rects` 是当前集合，`stripTop/stripBottom` 用来当场算与 44px 带的重叠量。

### 构建号

`node tools/bump-build.mjs` → **1003131739**，三处一致（`_build.json` + `index.html` + `standalone.html`）。

---

## ② 依据（为什么这条路走得通 —— 纠正 APPS.md 的过时口径）

契约 `APPS.md`（host 1.1.7-beta，约 1342 行）写的是：

> 「已握手的 v2 App **黑板主卡和拆窗主卡**可以调用 `hana.surface.setInteractiveRegions`」

这句让上一轮（1736）不敢用。**但宿主实际实现不是这样**。`desktop/dist-renderer/assets/ChatTranscript-HTqDLXaz.js` 里的能力声明是：

```js
{ name: PP.SET_INTERACTIVE_REGIONS,
  allowedSlots: ["card"],
  requiresGrant: false,          // ← 不需要任何权限授权
  validatePayload: R3,
  async handle(e, t) { return P3(e), e.setInteractiveRegions(t.regions), { applied: true } } }
```

- `allowedSlots: ["card"]` —— **聊天流卡（surfaceKind=home）在支持范围内**，不限黑板/拆窗。
- `requiresGrant: false` —— **不需要任何 manifest 权限**。⇒ 按任务要求第 1 条，
  我没有扩权、也没改 manifest。且本项目 `minAppVersion` 已是 `0.1017.0`，
  ≥ 契约要求的 `0.950.0`，门槛已满足。
- 失败时抛的是具名错误（`APP_SURFACE_TITLEBAR_UNAVAILABLE` / `APP_SURFACE_NOT_READY` /
  `APP_SURFACE_UNAUTHORIZED`），这正是我们做 feature-detect + 静默降级的理由。

**修复机制**也得到宿主 CSS 印证（`ChatTranscript-DpoxT8u5.css`）：

```css
._appTitlebarInteractiveRegion_7cf55{position:absolute;pointer-events:none;-webkit-app-region:no-drag}
```

即宿主会在我们上报的坐标上盖一层 `no-drag` 补丁 —— 正是压制那条 `drag` 带的正确手段。
而那条带本身（根因 E1）：

```css
._tileTop_19ca0{position:absolute;top:0;left:0;right:0;z-index:5;
  height:var(--titlebar-h, 44px);pointer-events:none;-webkit-app-region:drag}
```

坐标系：契约明确「iframe 视口的 CSS 像素」，即 `getBoundingClientRect()` 的值，**不含 DPR**。
我直接传 rect 原值，未做任何缩放。

---

## ③ 自验结果

### 基础检查（AGENTS.md §8，未跑全量回归）

| 项 | 结果 |
|---|---|
| 构建号三处一致 | **1003131739**（三个文件各 1 处） |
| 孪生 HTML | 仅 `data-shell` 不同 |
| `node --check ui/app.js` | 通过 |
| `git diff --check` | 通过 |

### 专项夹具 `evidence/strip-height-卡顿-1003131738/verify-regions.mjs` → **16/16 PASS**

```
A1-A4  去掉该 API → supported=false、不 applied、无新增报错、仍进横条   （降级路径）
B1-B9  有该 API   → supported=true、applied=true、确实调用了宿主 API、
                   矩形恰 4 键且有限、宽高>0、含与 44px 带重叠的矩形、
                   最大矩形≈整条宽（seek）、无新增报错
C1-C4  resize 后重新上报；退出横条后上报**空集合**（无残留打洞）；无报错
```

复跑：`node docs/player-ui/handoffs/evidence/strip-height-卡顿-1003131738/verify-regions.mjs`

> 说明：夹具里 App SDK 会报 `requires an App surface route`（本地没 `/api/apps/:appId/ui`
> 这条宿主路由）。这是**裸浏览器既有的背景噪声**，与本次改动无关，断言里已按 pattern 筛掉。
> 另外夹具踩到一个坑并已修正：真 `ui/sdk.js` 加载时会覆盖 `window.hana.surface`，
> 所以 stub 不能塞在 `evaluateOnNewDocument`（会被冲掉），必须等 SDK 就绪后替换 ——
> 这也顺带暴露了实现里「缓存 supported」的隐患，已改成每次现查。

---

## ④ 真机验收步骤（DeepMind 执行）

1. 从本仓库整包同步 `ui/` → `~/.hanako/apps/hanako-simple-player/`，
   `extension_manager reload app:hanako-simple-player`，核对构建 **1003131739**。
2. 打开聊天页那张播放器卡，把**竖向高度拉到最矮**（这是唯一的复现位）。
3. 只读探针先确认上报生效（Console）：
   ```js
   window.__playerDebug.interactiveRegions()
   ```
   期望：`supported: true`、`applied: true`、`lastError: ""`、`count` 约 7，
   `rects` 里第一个矩形宽度接近整条（seek），`stripTop/stripBottom` 落在 44px 带内。
4. **操作实测**（判定「通了」的核心）：
   - 在最矮高度下**点播放/上一首/下一首/模式/红心/喇叭** —— 应**即时响应**，不再迟滞；
   - 在最矮高度下**拖进度条** —— 应跟随手指，不再丢帧/拖不动；
   - 把竖向高度**拉高**再测一遍 —— 应与最矮时**一样丝滑**（两者手感一致即为通）。
5. 边界复核：拉高退出横条形态后，探针 `count` 应变为 0（无残留打洞）。

### 判定「通了」

最矮高度下的点击/拖拽手感**追平**高横条，且探针 `applied: true`。

### 判定「没通」

最矮高度仍然卡，或探针出现下列之一：
- `supported: false` → 宿主版本没有这个 API（不太可能，本机 1.1.7-beta 有）；
- `applied: false` + `lastError` 是 `APP_SURFACE_TITLEBAR_UNAVAILABLE` /
  `APP_SURFACE_NOT_READY` / `APP_SURFACE_UNAUTHORIZED` 之一
  → **宿主不认这张卡**（最可能的失败模式）；
- `applied: true` 但仍然卡 → 说明 44px 拖动带不是（唯一）根因，需回到 E1–E4 重估。

---

## ⑤ 降级行为

任一环节拿不到能力（旧宿主、未握手、unready、抛错），`hostInteractiveRegions()` 返回 `null`，
`pushInteractiveRegions()` 直接 return：**不调用、不抛错、不改任何 DOM/样式**。
行为**完全等于 1738 现状**（也就是说最坏情况就是维持现在的卡，不会更差）。
唯一痕迹是一次 `console.warn('[player] setInteractiveRegions 降级', …)`，
以及探针里的 `lastError`。

---

## ⑥ 未验证 / 风险

- **「宿主是否认这张具体卡」只能真机验**。依据来自宿主源码的能力声明
  （`allowedSlots:["card"]`），但本卡实例实际会不会走到 `handle` 成功分支，
  我没有运行时证据 —— 这是本轮最大的不确定项。
- 我**未**读到 `_appTitlebarInteractiveRegion` 的 JSX 挂载点（bundle 混淆、极长），
  它与 `_tileTop` 的**层级/裁剪关系**是从 CSS 语义（`no-drag` 补丁）推断的，未在 DOM 里直接观测。
- 本地夹具**无法复现**「矮高度卡」（缺宿主覆盖层），所以夹具只验上报逻辑与降级，
  **不能**当作本 bug 的回归手段 —— 真机手感是唯一验收标准。
- 上报时机用 `requestAnimationFrame`：若宿主对 rAF 有特殊调度（本项目未发现），
  可能延后一帧；当前按既有代码风格（同 `updateLyricIndex`/`applyLayout` 处的 rAF 用法）处理。

---

## ⑦ 若真机不通 → 几何避让退路（完整方案，待拍板后实施）

复算脚本 `overlap-recompute.mjs` 显示：条高下限 56px 时，**卡片矮于 100px 几何上放不下**
（56 条 + 44 带 = 100，且还要留上下各 12px 余量 → 需 ≥124px）。
所以几何避让**覆盖不到最窄段**，这点必须讲清楚：

- **可治区间**：宿主高 ≥124px 时，把 `--strip-y` 下限从 `0px` 抬到 `44px`，
  条整体压到拖动带之下，可完全脱离该带。
- **极矮档（<124px）的保底策略**：条无法下移，只能接受重叠。三个选项（待选）：
  1. 条高下限从 56 降到 ~44，塞进 44~88 区间 → 仍与带重叠约 44px（治不了，只是减小面积）；
  2. 极矮档**不显示横条**，退回一个只含播放键的极简胶囊并**上移到带下**（若空间够）；
  3. 极矮档接受重叠，**只把 seek 与播放键报给 `setInteractiveRegions`**（即本方案的缩小版）。
- **结论**：几何避让对 ≥124px 有效、对最窄段（用户真正的痛点区）**无效或退化**，
  因此优先级低于本方案。若本方案真机不通，我建议先试「本方案 + 抬高 `--strip-y` 下限」叠加，
  而不是纯几何避让。

---

## 证据位置

- 实现：`ui/app.js`（搜索 `setInteractiveRegions`）
- 夹具：`docs/player-ui/handoffs/evidence/strip-height-卡顿-1003131738/verify-regions.mjs`
- 复算：`docs/player-ui/handoffs/evidence/strip-height-卡顿-1003131738/overlap-recompute.mjs`
- 根因：`docs/player-ui/handoffs/evidence/strip-height-卡顿-1003131738/ROOT-CAUSE.md`
- 宿主依据：`~/.hanako/artifacts/server/1.1.7-beta-darwin-arm64-198f61dadf951412-ga7c30c843f9fc7ca/`
  `desktop/dist-renderer/assets/ChatTranscript-HTqDLXaz.js`（能力声明）、
  `ChatTranscript-DpoxT8u5.css`（`_tileTop_19ca0` / `_appTitlebarInteractiveRegion_7cf55`）、
  `APPS.md`（「标题栏内的交互区域」节）

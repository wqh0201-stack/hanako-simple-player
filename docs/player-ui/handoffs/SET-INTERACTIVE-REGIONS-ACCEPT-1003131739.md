# 横条接入 `setInteractiveRegions` · Hana 独立验收（本地部署 + 真机）

2026-10-16。构建 **1003131739**，版本 1.1.7。本轮**只做本地部署验收**：不发版、不改源码、
不碰 `app-data`、不发布 Release / 市场 PR。

被验收对象：[SET-INTERACTIVE-REGIONS-DONE-1003131739.md](SET-INTERACTIVE-REGIONS-DONE-1003131739.md)（码农交接）。
环境：本机 HanaAgent 生产宿主（PID 5156，端口 27958，`1.1.7-beta-darwin-arm64`）。

---

## 0. 结论速览

| 项 | 结果 | 证据 |
|---|---|---|
| 源哈希（仓库 / 安装目录 / 宿主快照） | **三方一致** | §1 |
| 整包同步 `ui/` + reload | **已完成**，宿主快照 serving `1003131739` | §1 |
| 基础检查（构建号三处一致 / 孪生 / JS 语法 / `git diff --check`） | **全过** | §2 |
| 实现复核（feature-detect / rAF 合并 / 静默降级 / 退出清空） | **通过** | §2 |
| 宿主能力声明纠正（`allowedSlots:["card"]`、`requiresGrant:false`） | **属实** | §3 |
| **真机实测（用户本人）** | **通了——最矮高度手感追平高横条** | §4 |

**一句话**：根因（宿主全宽 44px 拖动带覆盖横条）已定位并在真机上修好；最矮高度下按钮与进度拖动手感
追平高横条，用户判定"完美"。本轮无运行时 trace 探针（无 JS evaluate 能力），验收依据是**用户真机手感**。

---

## 1. 同步与哈希核对

本轮只改 `ui/app.js`（`ui/style.css` 哈希与 1738 相同，未动）。仓库产物 SHA-256：

```
c6d046c79478d48d001e8190da27d93253a12276e844a802ac30d63816055711  ui/app.js
42e13cc38ceed1cd42c578c6b1b5de200231f4207cded7a56d82317e29e7aaab  ui/style.css
46bef2f4edfb29b60f714b080d862c8bf22a009887107e6503de474819e3af1b  ui/index.html
91768cf905e1d4fa9bffef6844c30a807eef5659722b496359fd3ca60aefb32f  ui/standalone.html
333b37a288fa1f123266a48d3222502c9924be8e14dfaf03d62eef4f1010d8c0  ui/_build.json
```

动作：`rsync -a --checksum ui/ → ~/.hanako/apps/hanako-simple-player/ui/`，目标目录五文件哈希与仓库一致。
随后 `extension_manager reload app:hanako-simple-player` → `Reloaded app:hanako-simple-player from its current on-disk code`。
宿主日志（`~/.hanako/logs/2026-10-15_22-43-25.log`）：

```
[11:12:38.608] app route app "v2-hanako-simple-player" registered
[11:12:38.628] plugin-loader-v2: plugin "hanako-simple-player" v1.1.7 loaded
```

宿主 UI 快照：新快照 `.../app-ui-snapshots/run-5156-.../snap-194aR1/`，`_build.json = 1003131739`，
五文件 SHA-256 与仓库一致。
`manifest.json` 仓库与安装目录一致，**无扩权、无需重新审批**（本轮也不需要新权限，见 §3）。

---

## 2. 基础检查与实现复核

- **构建号三处一致**：`_build.json` / `index.html` / `standalone.html` 均 `1003131739`。
- **孪生 HTML 一致**：仅 `<body data-shell="card|window">` 一行不同。
- **JS 语法**：`node --check` 通过 `ui/app.js`、`ui/sdk.js`、`index.js`、`lib/*.js`。
- **`git diff --check`**：clean。
- **宿主日志**：reload 后无与 App 相关的 error（日志里的 `cache_contract_violation` 是会话提示词缓存，
  与本 App 无关）。
- **实现复核（`ui/app.js`，Hana 直读）**：
  - `hostInteractiveRegions()` **每次现查** `window.hana.surface.setInteractiveRegions`，不缓存支持判定（宿主晚挂载也能识别）；
  - `stripInteractiveRectangles()` 只收**当前真实可见**的控件（`hidden` / `offsetParent===null` / 零尺寸都跳过），
    含 `#seek` 整条 + 六个共享按钮，音量浮层展开时加 `#volGroup`，超 64 个截断；
  - `pushInteractiveRegions()` 按 key 跳过未变化的集合（避免悬停/拖动时反复 IPC），
    失败进 `catch` → 只 `console.warn` + 记 `lastError`，**不抛错、不改现有交互**；
  - `syncInteractiveRegions()` 用 `requestAnimationFrame` 合并同帧；挂钩 4 处在既有布局节奏上
    （`arrangeStrip` 结尾、`applyLayout` 形态切换、音量浮层开合、`visibilitychange`），不进逐帧路径；
  - **退出横条**时 `stripInteractiveRectangles()` 返回空集合 → 上报空集合，清掉宿主侧打洞。

---

## 3. 宿主能力声明纠正（重要）

交接指出 `APPS.md`「只限黑板/拆窗主卡」是**过时口径**。Hana 直读宿主渲染器 bundle 复核，**属实**：

```js
// desktop/dist-renderer/assets/ChatTranscript-HTqDLXaz.js
{ name: PP.SET_INTERACTIVE_REGIONS,
  allowedSlots: ["card"],        // ← 聊天流卡（surfaceKind=home）在支持范围内
  requiresGrant: false,          // ← 不需要任何 manifest 权限
  validatePayload: R3,
  async handle(e, t) { return P3(e), e.setInteractiveRegions(t.regions), { applied: true } } }
```

- 具名失败码确实存在：`APP_SURFACE_TITLEBAR_UNAVAILABLE`(×4) / `APP_SURFACE_NOT_READY`(×1) / `APP_SURFACE_UNAUTHORIZED`(×1)。
- 配套压制规则确实存在：`._appTitlebarInteractiveRegion_7cf55{position:absolute;pointer-events:none;-webkit-app-region:no-drag}`。

⇒ 上一轮（1736）因这句旧文档而不敢走这条路，是**被过时文档劝退**，不是技术不可行。
`manifest.json` 本轮未改，也不需要改。

---

## 4. 真机验收（用户本人实测）

- 部署后在真实聊天卡（`wb-card-plugin-webview-card-mva80ikf-5`，`surfaceKind=home`）实测：
  **把横条竖向高度拉到最矮**（原复现位）后，按钮点击与进度条拖动的**手感追平高横条**，不再卡顿。
- 用户结论：**「完美了这次」**。
- **未执行运行时探针**：本会话工具对这张 App WebView 无 JS evaluate / Console 读取能力
  （`ui_action.describe_elements` 对它返回 `Unknown API action`），`window.__playerDebug.interactiveRegions()`
  未能由 Hana 侧采集；因此「`applied: true`」这一条**没有运行时证据**，验收结论以用户手感为准。
  这与 1736 轮的观测能力限制一致。

---

## 5. 未覆盖 / 边界

- 无运行时 trace / 无 `applied` 采样：`setInteractiveRegions` 是否真被宿主接受，只有间接证据
  （手感变化 + 宿主源码依据 + 配套 `no-drag` 补丁 CSS）。若日后手感回退，优先重跑探针确认。
- 本地浏览器夹具**先天复现不了**本 bug（缺宿主覆盖层），不能作为本 bug 的回归手段；
  码农的 `verify-regions.mjs`（16/16）只验上报逻辑与降级路径。
- 几何避让退路（`--strip-y` 下限抬到 44px）**未实施**：复算显示它覆盖不到最窄段
  （条高下限 56 + 带 44 = 100，含上下余量需 ≥124px），本轮既有方案已解决问题，无需退路。
- 按 AGENTS.md §8，普通功能更新不跑发版前全量回归；未发 Release / 市场 PR。

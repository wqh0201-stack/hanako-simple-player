# 横条共用真实控件与原生显隐 · Hana 独立验收（本地部署）

2026-10-16。构建 **1003131737**，版本 1.1.7。本轮**只做本地部署验收**：不发版、不改源码、
不碰 `app-data`、不发布 Release / 市场 PR。

被验收对象：[SHARED-STRIP-CONTROLS-DONE-1003131737.md](SHARED-STRIP-CONTROLS-DONE-1003131737.md)（Codex 交接）。
环境：本机 HanaAgent 生产宿主（PID 5156，端口 27958，`1.1.7-beta-darwin-arm64`）。

---

## 0. 结论速览

| 项 | 结果 | 证据 |
|---|---|---|
| 源哈希（Codex source-checks / 仓库 / 安装目录 / 宿主快照） | **四方一致** | §1 |
| 整包同步 `ui/` + reload | **已完成**，宿主快照 serving `1003131737` | §1 |
| 真机卡 DOM 命中本轮新结构（代理节点已删、真实节点已搬入横条） | **命中** | §2 |
| 基础检查（构建号三处一致 / 孪生一致 / JS 语法 / `git diff --check`） | **全过** | §3 |
| 连续点按、进度空白区拖动、缩窄再切回大卡（真实输入） | **待用户真机实测** | §4 |
| 随机输入卡滞是否消失 | **不能由本轮部署结论断言**（本地夹具无宿主原生鼠标/标题拖动命中） | §4 |

**一句话**：部署到位，且本轮**有 DOM 结构级证据**——真机卡里旧的代理节点（`stripPlay/stripPrev/…`）已消失、
真实节点（`playBtn/prevBtn/nextBtn/modeBtn/favBtn/muteBtn/seek/volGroup`）已搬进横条，确系新构建在跑。
基础检查全过；随机卡滞是否消除必须由用户真实体验判定，本轮架构简化**不等于**宿主问题已证伪。

---

## 1. 同步与哈希核对

仓库 `ui/` 产物 SHA-256（与 Codex `touchbar/shared-1003131737/basic-checks.json` 逐项相同）：

```
e83429f10844e0380546c4fe26ba539bc96e79f4052fe94b7a6c17934f0930bf  ui/app.js
f8f59622f01ecbb261568c50ab9ef7f55fc8a7c7325be3a0dffb7831c57227df  ui/style.css
26e9ed45aa5b1e880dbd32bf0e172164e9e4d89f6cd44ed10d5e431f328a7302  ui/index.html
3b0c13a10cc2660f2c5cac2daf50aa8964b3923d2a8fa4c8c8c103bc1158369e  ui/standalone.html
15ce62db6777d027bb98c3275daf1169ec27cc227f634382ca81fae267203f2b  ui/_build.json
```

动作：`rsync -a --checksum ui/ → ~/.hanako/apps/hanako-simple-player/ui/`。
目标目录五文件哈希与仓库**完全一致**（上表逐项相同；`sdk.js` / `face-portrait.png` / `LUCIDE-LICENSE.txt` 未变动）。

随后 `extension_manager reload app:hanako-simple-player` → `Reloaded app:hanako-simple-player from its current on-disk code`。
宿主日志（`~/.hanako/logs/2026-10-15_22-43-25.log`）：

```
[09:03:36.139] app route app "v2-hanako-simple-player" withdrawn
[09:03:36.243] app route app "v2-hanako-simple-player" registered
[09:03:36.267] plugin-loader-v2: plugin "hanako-simple-player" v1.1.7 loaded
```

宿主 UI 快照：reload 后生成新快照
`~/.hanako/.cache/app-ui-snapshots/run-5156-98d094d5-6fed-4fc3-83b1-59fac5284dd4/snap-jOtjDd/`，
其 `_build.json = 1003131737`，五文件 SHA-256 与仓库一致。

本轮 `manifest.json` 仓库与安装目录一致，**无扩权、无需重新审批**。

---

## 2. 真机卡实例（聊天卡片 / 横条）— 本轮有 DOM 结构级证据

卡实例 `wb-card-plugin-webview-card-mva80ikf-5`（`cardEntityId: plugin-card:hanako-simple-player:player`，
`surface:home`，`runtimeStatus: mounted`、`domStatus: ready`、`actionsStatus: ready`、`visible: true`）。
本轮该实例 id 与上一轮相同，但**内容已刷新为新构建**——DOM 结构直接命中本轮改动：

- **代理节点已全部消失**：DOM 中**不再有** `stripPlay / stripPrev / stripNext / stripMode / stripFav /
  stripVolumeBtn / stripVol / stripSeek` 第二套交互节点。
- **真实节点已搬入横条**（`#stripControls` 内）：
  `#modeBtn`（`mode icon-btn strip-btn`）、`#prevBtn`、`#playBtn`（`play-btn strip-btn strip-play`）、
  `#nextBtn`、`#favBtn`（`heart fav-btn fav-btn-bar strip-btn`）、
  `#volGroup`（`volume-wrap vol-group strip-volume`）含 `#muteBtn`。
- **进度是同一根原生 range**：`#seek`（`range range-seek strip-seek`），已无 `stripSeek`。

这与交接「四态共用同一批 DOM 节点，横条进入时把真实控件搬入、退出时搬回」逐条对上，
是本轮**唯一可用 DOM 结构区分构建**的一轮，结论：宿主实际加载并渲染的是 1003131737。

---

## 3. 基础检查

- **构建号三处一致**：`_build.json` / `index.html` / `standalone.html` 均 `1003131737`（仓库与安装目录同）。
- **孪生 HTML 一致**：`index.html` 与 `standalone.html` 仅 `<body data-shell="card|window">` 一行不同。
- **JS 语法**：`node --check` 通过 `ui/app.js`、`ui/sdk.js`、`index.js`、`lib/*.js` 及本轮三个验收入口
  `tools/verify-player-interaction.mjs` / `verify-touchbar.mjs` / `verify-strip-flow.mjs`。
- **`git diff --check`**：clean。
- **宿主日志**：reload 后无 `error`/`exception`；仅一条既存 WARN
  `[mood] 宿主拒绝 /心情 别名，改为仅注册 /mood`（与本次改动无关）。
- **app-data 未改动**：未写 `playlist.json` / `cookies.env` / `lyrics/`。

---

## 4. 真机体验验收（交用户本人实测，Hana 不代测）

按交接「Hana 部署与实际体验」第 3 步，待用户实测回执后补记。**注意：真实按钮 ID 已变更，
操作/自动化请用 `playBtn / prevBtn / nextBtn / modeBtn / favBtn / muteBtn`、进度 `seek`、音量 `vol`，
不要再沿用旧代理 ID。**

1. **连续点按**：右下角移入 → 下一曲 → 播放/暂停 → 上一曲快速往返；观察是否仍出现**随机输入卡滞**。
2. **进度拖动**：在无按钮的**进度空白区**点击与拖动（本轮取消「只允许底部 16px」限制，整块空白可操作）。
3. **缩窄再切回**：横条缩窄 → 再切回大卡（465×930 长卡），确认控件回到底栏、无遗留隐藏项。

> ⚠️ 判定口径（沿用交接要求）：mounted/ready、哈希一致、合成 click **都不代表**随机输入故障已消除。
> 若用户仍遇卡滞，保留「宿主探查未定位」的原结论，继续处理真实输入观察能力；
> **不把本轮架构简化当作宿主问题已解决的证明**。

若仍有卡滞，请记录**卡片尺寸、承载（聊天卡/独立窗）、主题、实际路径/操作序列与截图或录像**，
写入 `SHARED-STRIP-CONTROLS-ACCEPT-1003131737.md` 交回 Codex。

---

## 5. 未覆盖 / 边界

- 本轮**有** DOM 结构级构建证据（代理节点删除 + 真实节点搬入），见 §2；这是与前两轮不同之处。
- 生产宿主原生鼠标命中、标题拖动区域与真实输入时序**本轮未取得决定性证据**；本地 Chrome 夹具的
  `27/27` 交互专项（含空白区点按/拖动、节点身份保持）不能替代真机判定。
- HTTP 直读宿主 serving 的 `ui/index.html` 仍返回 **403**（鉴权闸门），未能用 URL 字节复读 serving 构建号。
- 按 AGENTS.md §8，普通功能更新**不跑发版前全量回归**；Codex 的交互专项 27/27 与页面操作观察
  本轮未在 Hana 侧复跑。

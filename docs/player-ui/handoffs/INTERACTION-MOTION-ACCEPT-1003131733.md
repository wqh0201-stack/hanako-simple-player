# 横条交互与四态动效修复 · Hana 独立验收（本地部署）

2026-10-16。构建 **1003131733**，版本 1.1.7。本轮**只做本地部署验收**：不发版、不改源码、
不碰 `app-data`、不发布 Release / 市场 PR。

被验收对象：[INTERACTION-MOTION-DONE-1003131733.md](INTERACTION-MOTION-DONE-1003131733.md)（Codex 交接）。
环境：本机 HanaAgent 生产宿主（PID 5156，端口 27958，`1.1.7-beta-darwin-arm64`）。

---

## 0. 结论速览

| 项 | 结果 | 证据 |
|---|---|---|
| 源哈希（Codex source-checks / 仓库 / 安装目录 / 宿主快照） | **四方一致** | §1 |
| 整包同步 `ui/` + reload | **已完成**，宿主快照 serving `1003131733` | §1 |
| 真机卡实例实时结构命中新构建标记 | **命中** | §2 |
| 基础检查（构建号三处一致 / 孪生一致 / JS 语法 / `git diff --check`） | **全过** | §3 |
| 真机手感（用户实测） | **待用户**（按约定交本人实测） | §4 |
| 未覆盖：HTTP 直读 ui 路由 | 403（鉴权闸门），改用哈希 + DOM 闭环 | §5 |

**一句话**：部署到位，加载闭环成立（源哈希四方一致 + 宿主快照为新构建 + 真机卡 DOM 出现本轮新结构标记），
基础检查全过；体验手感按约定交用户本人实测，本轮 Hana 不代测。

---

## 1. 同步与哈希核对

仓库 `ui/` 产物 SHA-256（与 Codex `touchbar/interaction-2026-10-16/basic-checks.json` 逐项相同）：

```
650069e0f83f512fa46cd1d52affcca11ee065012411e2d039b10c455de52c19  ui/app.js
8f0f9aa472cf6fd8b795233fbef25b01bd94297ca18e51c2009b91725b5f1faf  ui/style.css
b9115e0af5aff1b997d04c59cb1deebe20bdf557c1e8ff9aa8f0034108867720  ui/index.html
6be51409c41925d312818d6bced24978d450fba11113303aacb49f34e06bf206  ui/standalone.html
309edd6adff6f0a9d83a49e6c61305ff52b62a4320477662a0b9b0823bf022c6  ui/_build.json
```

动作：`rsync -a --checksum ui/ → ~/.hanako/apps/hanako-simple-player/ui/`。
目标目录五文件哈希与仓库**完全一致**（上表逐项相同；`sdk.js` / `face-portrait.png` / `LUCIDE-LICENSE.txt` 未变动，哈希亦一致）。

随后 `extension_manager reload app:hanako-simple-player` → `Reloaded app:hanako-simple-player from its current on-disk code`。
宿主日志（`~/.hanako/logs/2026-10-15_22-43-25.log`）：

```
[07:07:51.060] app route app "v2-hanako-simple-player" withdrawn
[07:07:51.203] app route app "v2-hanako-simple-player" registered
[07:07:51.225] plugin-loader-v2: plugin "hanako-simple-player" v1.1.7 loaded
```

宿主 UI 快照：reload 后生成新快照
`~/.hanako/.cache/app-ui-snapshots/run-5156-98d094d5-6fed-4fc3-83b1-59fac5284dd4/snap-uVG3o0/`，
其 `_build.json = 1003131733`，五文件 SHA-256 与仓库一致；旧快照 `snap-rhusJ1`（`1003131729`）已被清除。

> ⚠️ 同步凭据用哈希，不用构建号：本轮同步前，安装目录 `ui/`（旧 `1003131729`）与仓库 `ui/`（`1003131733`）
> 的 `app.js`/`style.css` 字节就不同。构建号相同不代表内容相同，必须 SHA-256 对齐。

本轮无 manifest 变更（`manifest.json` 仓库与安装目录一致），**无需重新审批**。

---

## 2. 真机卡实例（聊天卡片 / 横条）

卡实例 `wb-card-plugin-webview-card-mv9nfp3a-1`，`cardEntityId: plugin-card:hanako-simple-player:player`，
`surface:home`（聊天卡片），`runtimeStatus: mounted`、`domStatus: ready`、`actionsStatus: ready`。

DOM 命中本轮**新结构标记**（页面真实状态，非探针注入）：

- `#stripPlay` 内**同时**存在 `span.play-glyph.glyph-play` 与 `span.play-glyph.glyph-pause`
  → 对应交接「横条播放/暂停改为**固定的双字形层**，不再反复替换 innerHTML」。
  交叉核对：旧构建 `git show HEAD:ui/index.html` 只有 **1** 处 `glyph-pause`，新构建 **2** 处。
- `#stripSeek` 为 `input[type=range]`，样式 `.strip-seek{position:absolute;left:0;right:0;bottom:0;height:16px}`
  → 对应「进度命中区收在条内下沿 **16px**」。
- `.player` 带 `ambient-ok` 类；横条结构完整（`stripCover` / `stripBar` / `strip-field-played` /
  `stripFront` / `stripIdentity` / `stripLyric` / `stripControls` / `stripVolumeGroup` 齐备）。

结论：宿主实际加载并渲染的是本轮新构建。

---

## 3. 基础检查

- **构建号三处一致**：`_build.json` / `index.html` / `standalone.html` 均 `1003131733`（仓库与安装目录同）。
- **孪生 HTML 一致**：`index.html` 与 `standalone.html` 仅 `<body data-shell="card|window">` 一行不同，其余字节一致。
- **JS 语法**：`node --check` 通过 `ui/app.js`、`ui/sdk.js`、`index.js`、`lib/*.js`（共 16 个文件）。
- **`git diff --check`**：clean（无空白错误）。
- **宿主日志**：reload 后无 `error`/`exception`；仅有一条既存 WARN
  `[mood] 宿主拒绝 /心情 别名，改为仅注册 /mood`（与本次改动无关）。
- **app-data 未改动**：未写 `playlist.json` / `cookies.env` / `lyrics/`。

---

## 4. 真机体验验收（交用户本人实测，Hana 不代测）

按交接第 5 步清单，待用户实测回执后补记：

1. 应用激活后，横条快速移入 / 首击 / 连续点击是否顺畅；按钮是否误触进度。
2. 四种形态的播放/暂停连点、切歌、模式、喜欢、音量及按压反馈。
3. 歌词换句与控件显隐是否自然；横条底部 16px 进度拖动。
4. 横条 ↔ 大卡片双向切换、快速反向时背景是否仍闪烁。

当前该卡正停在**横条形态**（聊天卡片），可直接上手。

---

## 5. 未覆盖 / 边界

- HTTP 直读宿主 serving 的 `ui/index.html` 返回 **403**（鉴权闸门），未能用 URL 字节复读 serving 构建号；
  改用**宿主快照哈希 + 真机 DOM 新标记**闭环。
- 交接声明的宿主边界「从未激活的原生应用外移入但宿主未派发指针事件」本轮**未改**，不在验收范围。
- 按 AGENTS.md §8，普通功能更新**不跑发版前全量回归**；Codex 的交互专项 25/25 本轮未在 Hana 侧复跑。
- 真实宿主事件 / 合成帧未在本轮直接测量；体验结论以用户实测为准，不能把本地夹具当真实宿主通过。

# 横条播放键与封面微调 · Hana 独立验收（本地部署）

2026-10-16。构建 **1003131736**，版本 1.1.7。本轮**只做本地部署验收**：不发版、不改源码、
不碰 `app-data`、不发布 Release / 市场 PR。

被验收对象：[STRIP-SIZE-DONE-1003131736.md](STRIP-SIZE-DONE-1003131736.md)（Codex 交接）。
环境：本机 HanaAgent 生产宿主（PID 5156，端口 27958，`1.1.7-beta-darwin-arm64`）。

---

## 0. 结论速览

| 项 | 结果 | 证据 |
|---|---|---|
| 源哈希（Codex source-checks / 仓库 / 安装目录 / 宿主快照） | **四方一致** | §1 |
| 整包同步 `ui/` + reload | **已完成**，宿主快照 serving `1003131736` | §1 |
| 真机卡实例 | **reload 后重建**（新实例 id），mounted/ready/visible，无报错 | §2 |
| 基础检查（构建号三处一致 / 孪生一致 / JS 语法 / `git diff --check`） | **全过** | §3 |
| 播放键上沿是否仍触发宿主拖动条 | **待用户真机实测**（本地夹具无宿主拖动把手） | §4 |
| 封面缩小 3% 后的视觉平衡 | **待用户实测** | §4 |
| 未覆盖：本轮只改 `style.css`，真机 DOM 无结构标记可区分构建 | 用哈希 + 卡重建闭环 | §5 |

**一句话**：部署到位，加载闭环成立（源哈希四方一致 + 宿主快照为新构建 + 卡实例在 reload 后重建），
基础检查全过；「播放键上沿是否还撞拖动把手」属宿主交互项，本地夹具无法判定，按约定交用户真机实测。

---

## 1. 同步与哈希核对

仓库 `ui/` 产物 SHA-256（与 Codex `touchbar/size-1003131736/basic-checks.json` 逐项相同）：

```
6aad7a56c8bb8c6932145024191d0409bc993c685cf4645de4086af76479919d  ui/app.js
2411f3dec4e62e27c6ba03e5b1a8779f63bca009a6d5c5168866b81a17c6fec1  ui/style.css
7a14d0ce16ba5fa4550ab48c3ff4cd90fe4604f83bad79480cbcdc642b0ca0b7  ui/index.html
46671be7de606501e40fef83050861eb339865b1f81c824796f7bb032f2a2d4f  ui/standalone.html
8e2136e809409397ba0af0c2f03bf22886bc97373a10098a3b67d29109986193  ui/_build.json
```

动作：`rsync -a --checksum ui/ → ~/.hanako/apps/hanako-simple-player/ui/`。
目标目录五文件哈希与仓库**完全一致**（上表逐项相同；`sdk.js` / `face-portrait.png` / `LUCIDE-LICENSE.txt` 未变动）。
注：本轮 `app.js` 哈希与上一轮 1003131734 相同（`6aad7a56…`），改动只在 `style.css`。

随后 `extension_manager reload app:hanako-simple-player` → `Reloaded app:hanako-simple-player from its current on-disk code`。
宿主日志（`~/.hanako/logs/2026-10-15_22-43-25.log`）：

```
[08:26:32.884] app route app "v2-hanako-simple-player" withdrawn
[08:26:33.000] app route app "v2-hanako-simple-player" registered
[08:26:33.020] plugin-loader-v2: plugin "hanako-simple-player" v1.1.7 loaded
```

宿主 UI 快照：reload 后生成新快照
`~/.hanako/.cache/app-ui-snapshots/run-5156-98d094d5-6fed-4fc3-83b1-59fac5284dd4/snap-wNWICS/`，
其 `_build.json = 1003131736`，五文件 SHA-256 与仓库一致。

本轮 `manifest.json` 仓库与安装目录一致，**无扩权、无需重新审批**。

---

## 2. 真机卡实例（聊天卡片 / 横条）

reload 后，聊天页上的小花播放器卡**重建为新实例** `wb-card-plugin-webview-card-mva80ikf-5`
（上一轮为 `wb-card-plugin-webview-card-mva5w9z8-3`），
`cardEntityId: plugin-card:hanako-simple-player:player`，`surface:home`，
`runtimeStatus: mounted`、`domStatus: ready`、`actionsStatus: ready`、`visible: true`、`focused: true`。

样式改动与交接一致（`style.css` 1003131734 → 1003131736 diff 已核）：

- `.strip-btn.strip-play`：`width/height/flex-basis` 32 → **28px**，新增 `margin: 0 2px`，`border-radius:50%` 保留；
  `.strip-play .icon` 由 18px → **16px**。
- `.strip-cover`：`left: 12px → 12.96px`、`top: calc(var(--strip-y) + .96px)`、`width/height: 64 → 62.08px`；
  进度条仍 64px。

> 说明：本轮只动 `style.css`，真机 DOM 无结构标记可区分构建，故“卡实际跑的是 1003131736”由
> **快照哈希一致 + 卡实例在 reload 后重建** 闭环，而非 DOM 结构比对。

---

## 3. 基础检查

- **构建号三处一致**：`_build.json` / `index.html` / `standalone.html` 均 `1003131736`（仓库与安装目录同）。
- **孪生 HTML 一致**：`index.html` 与 `standalone.html` 仅 `<body data-shell="card|window">` 一行不同。
- **JS 语法**：`node --check` 通过 `ui/app.js`、`ui/sdk.js`、`index.js`、`lib/*.js`（共 16 个文件）。
- **`git diff --check`**：clean。
- **宿主日志**：reload 后无 `error`/`exception`；仅一条既存 WARN
  `[mood] 宿主拒绝 /心情 别名，改为仅注册 /mood`（与本次改动无关）。
- **app-data 未改动**：未写 `playlist.json` / `cookies.env` / `lyrics/`。

---

## 4. 真机体验验收（交用户本人实测，Hana 不代测）

按交接「Hana 部署与用户反馈」第 3 步，待用户实测回执后补记：

1. **播放键上沿是否仍触发拖动条**：在真实聊天卡 / 独立窗里，从播放键**上沿**进入并按下拖动，
   观察是否被宿主的中央拖动把手截获（本轮只是把圆形与命中框缩到 28px、上沿多留 2px，
   本地夹具没有宿主拖动把手，不能据此判定已消除）。
2. **封面缩小后的视觉平衡**：横条封面缩了 3%（62.08px），看与 64px 进度条、左侧内收是否协调、不显突兀。
3. 顺带确认横条视觉重心未变（按钮中心、相邻键位置、间距维持原样）。

若播放键上沿仍重叠拖动条，请记录**卡片尺寸、承载（聊天卡/独立窗）、主题、实际重叠范围与截图/录像**，
写入 `STRIP-SIZE-ACCEPT-1003131736.md` 交回 Codex 对齐下一步。

---

## 5. 未覆盖 / 边界

- 本轮为 `style.css` 改动，真机 DOM 无结构标记，故未做 DOM 级构建比对（改用哈希 + 卡重建）。
- 宿主拖动把手属宿主侧交互，本地无头夹具不具备该把手，**不能据本地结果判定宿主截获问题已消除**——
  这是本轮唯一必须真机确认的项。
- 卡实例为 webview 插件卡，宿主未开放 `describe_elements`，`ui_edit` 读源码只对 Chalkboard 实例开放，
  故未做元素级计算样式采样。
- HTTP 直读宿主 serving 的 `ui/index.html` 仍返回 **403**（鉴权闸门），未能用 URL 字节复读 serving 构建号。
- 按 AGENTS.md §8，普通功能更新**不跑发版前全量回归**；Codex 的本地页面尺寸观察（822×94 / 400×94）
  本轮未在 Hana 侧复跑。

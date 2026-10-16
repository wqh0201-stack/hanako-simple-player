# 横条悬停、间距与音量越界返修 · Hana 独立验收（本地部署）

2026-10-16。构建 **1003131734**，版本 1.1.7。本轮**只做本地部署验收**：不发版、不改源码、
不碰 `app-data`、不发布 Release / 市场 PR。

被验收对象：[STRIP-HOVER-DONE-1003131734.md](STRIP-HOVER-DONE-1003131734.md)（Codex 交接）。
环境：本机 HanaAgent 生产宿主（PID 5156，端口 27958，`1.1.7-beta-darwin-arm64`）。

---

## 0. 结论速览

| 项 | 结果 | 证据 |
|---|---|---|
| 源哈希（Codex source-checks / 仓库 / 安装目录 / 宿主快照） | **四方一致** | §1 |
| 整包同步 `ui/` + reload | **已完成**，宿主快照 serving `1003131734` | §1 |
| 真机卡实例 | **reload 后重建**（新实例 id），mounted/ready，无报错 | §2 |
| 基础检查（构建号三处一致 / 孪生一致 / JS 语法 / `git diff --check`） | **全过** | §3 |
| 真机手感（相邻按钮悬停、间距、缩窄音量） | **待用户实测** | §4 |
| 未覆盖：本轮改的是 CSS + 布局逻辑，真机 DOM 无结构标记可区分构建 | 用哈希 + 卡重建闭环 | §5 |

**一句话**：部署到位，加载闭环成立（源哈希四方一致 + 宿主快照为新构建 + 卡实例在 reload 后重建），
基础检查全过；悬停/间距/缩窄音量属手感项，按约定交用户实测，本轮 Hana 不代测。

---

## 1. 同步与哈希核对

仓库 `ui/` 产物 SHA-256（与 Codex `touchbar/hover-1003131734/basic-checks.json` 逐项相同）：

```
6aad7a56c8bb8c6932145024191d0409bc993c685cf4645de4086af76479919d  ui/app.js
ec924d778f040778e808d9933d5c7c8bba9ab0f7afd2fc6cce45bdb2ad6c02bd  ui/style.css
a2eb35e03560b2bf3bfb11c484728bd99465267ec5cf2a4f32606d8ca131684b  ui/index.html
8e20c09b9aa8b72846c36fbb7aa4bf5eeb1c650f8f21409b671057e96385ba04  ui/standalone.html
cfa493e77544610bc7fe2338447e58c90a613369b90dc72bfc6d27cb90b5e57b  ui/_build.json
```

动作：`rsync -a --checksum ui/ → ~/.hanako/apps/hanako-simple-player/ui/`。
目标目录五文件哈希与仓库**完全一致**（上表逐项相同；`sdk.js` / `face-portrait.png` / `LUCIDE-LICENSE.txt` 未变动）。

随后 `extension_manager reload app:hanako-simple-player` → `Reloaded app:hanako-simple-player from its current on-disk code`。
宿主日志（`~/.hanako/logs/2026-10-15_22-43-25.log`）：

```
[07:57:08.743] app route app "v2-hanako-simple-player" withdrawn
[07:57:08.836] app route app "v2-hanako-simple-player" registered
[07:57:08.859] plugin-loader-v2: plugin "hanako-simple-player" v1.1.7 loaded
```

宿主 UI 快照：reload 后生成新快照
`~/.hanako/.cache/app-ui-snapshots/run-5156-98d094d5-6fed-4fc3-83b1-59fac5284dd4/snap-7dF3Rx/`，
其 `_build.json = 1003131734`，五文件 SHA-256 与仓库一致（上一轮 `snap-uVG3o0` 只余 `_build.json`，已被清理）。

本轮 `manifest.json` 仓库与安装目录一致，**无扩权、无需重新审批**。

---

## 2. 真机卡实例（聊天卡片 / 横条）

reload 后，聊天页上的小花播放器卡**重建为新实例** `wb-card-plugin-webview-card-mva5w9z8-3`
（上一轮为 `wb-card-plugin-webview-card-mv9nfp3a-1`），
`cardEntityId: plugin-card:hanako-simple-player:player`，`surface:home`，
`runtimeStatus: mounted`、`domStatus: ready`、`actionsStatus: ready`、`visible: true`。

页面正常渲染：`.player.ambient-ok`，横条结构齐备（`stripLayout` / `stripBar` / `strip-field-played` /
`stripFront` / `stripSeek`(range) / `stripIdentity` / `stripLyric` / `stripVolumeGroup` 等），
当前曲目正常显示（含中日合并歌词）。

> 说明：本轮改动集中在 `style.css` 与 `app.js` 的**布局/悬停逻辑**，没有新增可据以区分构建的 DOM 结构标记，
> 因此“卡实际跑的是 1003131734”由 **快照哈希一致 + 卡实例在 reload 后重建** 闭环，而非 DOM 结构比对。

---

## 3. 基础检查

- **构建号三处一致**：`_build.json` / `index.html` / `standalone.html` 均 `1003131734`（仓库与安装目录同）。
- **孪生 HTML 一致**：`index.html` 与 `standalone.html` 仅 `<body data-shell="card|window">` 一行不同。
- **JS 语法**：`node --check` 通过 `ui/app.js`、`ui/sdk.js`、`index.js`、`lib/*.js`（共 16 个文件）。
- **`git diff --check`**：clean。
- **宿主日志**：reload 后无 `error`/`exception`；仅一条既存 WARN
  `[mood] 宿主拒绝 /心情 别名，改为仅注册 /mood`（与本次改动无关）。
- **app-data 未改动**：未写 `playlist.json` / `cookies.env` / `lyrics/`。

---

## 4. 真机体验验收（交用户本人实测，Hana 不代测）

按交接「Hana 部署与用户体验」一节，待用户实测回执后补记：

1. 右下角移入 → 下一曲 → 暂停 → 上一曲，快速往返；**旧键高亮是否立即撤掉、新键是否立即亮**（重点）。
2. 三键间距是否变疏松（10→6px 连续收敛）；缩窄时是否**先收间距、再隐藏次要键**。
3. 音量已展开时继续缩窄：**不应出现右侧截断或越界**，浮层应先关闭、焦点移回播放键。
4. 所有横条按钮保持 32×32px，不缩到 30px；按压反馈仍在（内部图形 45ms/140ms），命中盒不缩放。

若仍有滞留/越界，请记录尺寸、承载、主题、实际路径与截图/录像，写入
`STRIP-HOVER-ACCEPT-1003131734.md` 交回 Codex。

---

## 5. 未覆盖 / 边界

- 本轮为 CSS + 布局逻辑改动，真机 DOM 无结构标记，故未做 DOM 级构建比对（改用哈希 + 卡重建）。
- 卡实例为 webview 插件卡，宿主未开放 `describe_elements`，`ui_edit` 读源码也不可用（非 Chalkboard 实例），
  故未做元素级计算样式采样；悬停/间距属手感项，以用户实测为准。
- HTTP 直读宿主 serving 的 `ui/index.html` 仍返回 **403**（鉴权闸门），未能用 URL 字节复读 serving 构建号。
- 按 AGENTS.md §8，普通功能更新**不跑发版前全量回归**；Codex 的探针结果（15/15、27/27、15 档宽度）本轮未在 Hana 侧复跑。
- 交接声明的宿主边界与播放时序链路本轮未改，不在验收范围。

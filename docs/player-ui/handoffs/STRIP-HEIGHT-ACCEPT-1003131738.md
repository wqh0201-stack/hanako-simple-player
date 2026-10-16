# 横条高度自适应 · Hana 独立验收（本地部署）

2026-10-16。构建 **1003131738**，版本 1.1.7。本轮**只做本地部署验收**：不发版、不改源码、
不碰 `app-data`、不发布 Release / 市场 PR。

被验收对象：[STRIP-HEIGHT-DONE-1003131738.md](STRIP-HEIGHT-DONE-1003131738.md)（Codex 交接）。
环境：本机 HanaAgent 生产宿主（PID 5156，端口 27958，`1.1.7-beta-darwin-arm64`）。

---

## 0. 结论速览

| 项 | 结果 | 证据 |
|---|---|---|
| 源哈希（Codex source-checks / 仓库 / 安装目录 / 宿主快照） | **四方一致** | §1 |
| 整包同步 `ui/` + reload | **已完成**，宿主快照 serving `1003131738` | §1 |
| 实现落地（高度 clamp 公式） | **在安装/快照 `style.css` + `app.js` 命中** | §2 |
| 真机卡存活、1737 真实节点架构保留 | **mounted/ready**，真实节点齐全、无代理节点 | §2 |
| 基础检查（构建号三处一致 / 孪生一致 / JS 语法 / `git diff --check`） | **全过** | §3 |
| 上下拉伸、缩放上下限、窄宽退让（真实宿主） | **待用户真机实测** | §4 |

**一句话**：部署到位（哈希四方一致 + 快照为新构建 + 卡存活且 1737 架构完整），基础检查全过；
本轮为 CSS + 布局逻辑改动、无 DOM 结构标记，故未做 DOM 级构建比对。上下拉伸/上下限/退让交用户真机实测。

---

## 1. 同步与哈希核对

仓库 `ui/` 产物 SHA-256（与 Codex `touchbar/height-1003131738/basic-checks.json` 逐项相同）：

```
0f91c000cf85c23ba8db817c87f7ec6d9e9402493956e06160081e8cf9da29a6  ui/app.js
42e13cc38ceed1cd42c578c6b1b5de200231f4207cded7a56d82317e29e7aaab  ui/style.css
17239ea1a00afe047c6f8dfecbaf05199b400d054c4ff33bb83e06e825dbf557  ui/index.html
6a535defb2232650aa5ffb355797e750fc888eee6d9e4396ada92807f69f9ffe  ui/standalone.html
ad548a84114f98ec6f6da04f3976f31f6d5b22297f972a1f53d602931c90ef47  ui/_build.json
```

动作：`rsync -a --checksum ui/ → ~/.hanako/apps/hanako-simple-player/ui/`。
目标目录五文件哈希与仓库**完全一致**（上表逐项相同；`sdk.js` / `face-portrait.png` / `LUCIDE-LICENSE.txt` 未变动）。

随后 `extension_manager reload app:hanako-simple-player` → `Reloaded app:hanako-simple-player from its current on-disk code`。
宿主日志（`~/.hanako/logs/2026-10-15_22-43-25.log`）：

```
[09:24:13.263] app route app "v2-hanako-simple-player" withdrawn
[09:24:13.368] app route app "v2-hanako-simple-player" registered
[09:24:13.392] plugin-loader-v2: plugin "hanako-simple-player" v1.1.7 loaded
```

宿主 UI 快照：reload 后生成新快照
`~/.hanako/.cache/app-ui-snapshots/run-5156-98d094d5-6fed-4fc3-83b1-59fac5284dd4/snap-lDz84P/`，
其 `_build.json = 1003131738`，五文件 SHA-256 与仓库一致（上一轮 `snap-jOtjDd` 已被清理）。

本轮 `manifest.json` 仓库与安装目录一致，**无扩权、无需重新审批**。

---

## 2. 实现落地与真机卡状态

**实现核对**（安装/快照 `style.css` + `app.js` 直读，与交接一致）：

- `app.js`：`player.style.setProperty('--strip-height', Math.max(56, Math.min(96, h - 24)) + 'px')`
  —— 即 `clamp(56px, 容器高 − 24px, 96px)`，正常伸缩段上下各留 12px。
- `style.css`：`.strip-bar { top: var(--strip-y); height: var(--strip-height) }`；
  `.strip-cover { width/height: calc(var(--strip-height) * .97) }`（封面恒为条高 97%，保持 3% 缩小比例）；
  `--strip-cover-inset: calc(var(--strip-height) * .015)`；`.strip-bar { left: calc(24px + var(--strip-height)) }`
  —— 进度条左缘跟随封面占位。

**真机卡**：实例 `wb-card-plugin-webview-card-mva80ikf-5`（`surface:home`，`runtimeStatus: mounted`、
`domStatus: ready`、`actionsStatus: ready`、`visible: true`）。DOM 仍为 1737 的真实节点架构
（`#seek`、`#modeBtn`、`#prevBtn`、`#playBtn`、`#nextBtn`、`#favBtn`、`#muteBtn`、`#volGroup` 在横条内），
**无任何代理节点**，说明 1737 的共用真实控件未被本轮破坏。

> 说明：本轮只改 `style.css` 与 `app.js` 的布局逻辑，**没有可据以区分构建的 DOM 结构标记**；
> 且该卡实例 id 与上一轮相同（宿主 reload 时原地刷新 iframe，不重建实例）。
> 因此“卡实际跑的是 1003131738”由 **快照哈希一致 + 卡存活且 1737 架构完整** 闭环，而非 DOM 结构比对。

---

## 3. 基础检查

- **构建号三处一致**：`_build.json` / `index.html` / `standalone.html` 均 `1003131738`（仓库与安装目录同）。
- **孪生 HTML 一致**：`index.html` 与 `standalone.html` 仅 `<body data-shell="card|window">` 一行不同。
- **JS 语法**：`node --check` 通过 `ui/app.js`、`ui/sdk.js`、`index.js`、`lib/*.js` 及 `tools/verify-touchbar.mjs`。
- **`git diff --check`**：clean。
- **宿主日志**：reload 后无 `error`/`exception`；仅一条既存 WARN
  `[mood] 宿主拒绝 /心情 别名，改为仅注册 /mood`（与本次改动无关）。
- **app-data 未改动**：未写 `playlist.json` / `cookies.env` / `lyrics/`。

---

## 4. 真机体验验收（交用户本人实测，Hana 不代测）

按交接「Hana 部署与用户体验」，待用户实测回执后补记：

1. **上下拉伸**：把横条拉高/压低，确认**中间段平滑变化**（条高随容器高连续变化），
   到两端后**停止缩放**（下限 56px、上限 96px），且始终垂直居中。
2. **封面**：封面始终略小于进度条（97%）并居中，比例不跳。
3. **左右拉长不增高**：只左右拉宽时，条高应保持不变。
4. **窄宽退让**：缩窄时控件与音量仍应**提前退让**（音量整组先隐藏，必要时再收次要键），不越界。

> ⚠️ 判定口径：本轮**没有**修改宿主输入命中，**不以高度自适应的结果宣称随机卡滞已根治**。
> 若仍遇卡滞，保留「宿主输入链未取得决定性证据」的原结论继续处理。

若尺寸异常或仍有卡滞，请记录**卡片尺寸（宽×高）、承载（聊天卡/独立窗）、主题、操作序列与截图或录像**，
写入 `STRIP-HEIGHT-ACCEPT-1003131738.md` 交回 Codex。

---

## 5. 未覆盖 / 边界

- 本轮为 CSS + 布局逻辑改动，真机 DOM 无结构标记，故未做 DOM 级构建比对（改用哈希 + 卡存活闭环）。
- 生产宿主真实拉伸手势、原生鼠标命中与输入时序**本轮未取得决定性证据**；本地夹具尺寸观察
  （11 组尺寸、封面/条中心误差 < .02px）不能替代真机判定。
- HTTP 直读宿主 serving 的 `ui/index.html` 仍返回 **403**（鉴权闸门），未能用 URL 字节复读 serving 构建号。
- 按 AGENTS.md §8，普通布局更新**不跑发版前全量回归**；Codex 的尺寸观察本轮未在 Hana 侧复跑。

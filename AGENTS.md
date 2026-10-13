# AGENTS.md · hanako-simple-player（小花音乐播放器）

一个 Hana v2 App：本地 / 在线音乐播放器，跟随宿主主题，含歌词与音频反应涟漪。
**许可证 AGPL-3.0**（衍生自上游，别改回 MIT）。当前版本 1.0.7。

> 本文件是**常驻纪律摘要**，会被每次请求全量加载 —— 只放「任何任务都成立」的事，
> 保持精简。版本变更、踩坑根因、待办都在二级文档，见文末「文档地图」。
> 仓库结构会变，下面的路径以现状为准，**优先用能力地图（§3）定位，别死记路径**。

---

## 0. 动手前先读技能：Hana App 的官方做法都在 `hana-app-creator` 里

凡是涉及 App 本体（manifest、SDK、卡片、窗口、surface、权限与审批、安装/重载生命周期），
**先读技能，别凭记忆、也别从旧代码反推**：

| 要什么 | 在哪 |
|---|---|
| 技能入口 | `~/.hanako/skills/hana-app-creator/SKILL.md` |
| Builder 工作流（隔离开发 / 卡片交互 / reload 检查） | `~/.hanako/skills/hana-app-creator/references/builder.md` |
| 完整契约（宿主权威，最新） | `~/.hanako/artifacts/server/<ver>/APPS.md`（英文 `APPS_EN.md`） |
| 环境自检 / 静态校验 / 打包 | `~/.hanako/skills/hana-app-creator/scripts/{check_env,validate_app,pack_app}.mjs` |

几条跟本 App 直接相关、且容易踩的（细节回技能原文）：

- 聊天卡片按**可用列宽**设计，别假设固定像素上限（`hana.ui.resize` 会被宿主上限卡住）。
- `runTool` 只是窄口径直测，**不代表真实会话**，别拿它当验收。
- 安装生命周期：声明了受保护能力，`defineApp` 第一次回调前就生效，
  别加定时器/重试等授权。`reload` 立即应用普通本地编辑；只有 **manifest 扩权**才需重新审批。
- 沙箱禁用清单（`position:fixed`、直接 `localStorage`、`window.open`、表单提交、
  重复文档外壳、字号 < 11px …）以技能为准。

## 1. 这是什么

- 音频播放器：本地 / 在线播放（网易云、B站、QQ、酷狗），歌词自动匹配与横幅，
  封面环境色背景，指针涟漪（接真音频），三种承载形态自适应。
- 前端 `ui/`：`index.html`（页面壳）+ `app.js`（全部逻辑，ES5，无构建）+ `style.css`（全部样式）。
  **无打包器，改完直接跑**。
- 后端 `index.js` + `lib/`，前端经 `/api/apps/hanako-simple-player/routes/...` 与旧路径 `/widget/api/...` 调它。
- 两种承载、尺寸由宿主给且会变：聊天卡片（实测约 465×930，最窄 312×494）、
  独立窗口（`manifest.json` 的 `detachedDefaultSize` = 1040×780）。

## 2. 硬约束（踩了必炸）

1. **孪生文件**：`ui/index.html` 与 `ui/standalone.html` 内容必须一致，
   只差 body 的 `data-shell`（`card` / `window`）。改一个必须同步另一个。
2. **构建号**：改完跑 `node tools/bump-build.mjs`，它同步 `ui/_build.json` +
   两个 html 里的 `window.__HANA_BUILD`。
3. **部署必须整包同步 `ui/`**（index / standalone / **style.css** / _build.json）再 reload ——
   见 §4。漏 CSS 会让布局退化成竖堆。
4. **宿主快照 UI**：宿主加载时把 `ui/` 拷进 `~/.hanako/.cache/app-ui-snapshots/`，
   之后只认快照 —— 改了文件不会自动生效，**必须 reload**。
5. **宿主/沙箱**：不用 `position:fixed`；聊天卡片右上角 **100×40 CSS px** 是宿主控件安全区；
   顶部两角要自己补圆（见 §6）；禁 emoji（用 SVG 线描）；字号 ≥ 11px；颜色走 CSS 变量、不硬编码。

## 3. 能力地图（结构会变，按职责定位）

- **前端页面壳** `ui/index.html` / `ui/standalone.html`：DOM 骨架 + 内联 `<symbol>` 图标集，
  外链 `sdk.js`（宿主 SDK）、`app.js`、`style.css`。
- **前端逻辑** `ui/app.js`：全部状态与交互。数据形状由 `data-*` 属性驱动；
  关键交互元素带稳定 id（供 agent 在真实卡片里点击）。
- **前端样式** `ui/style.css`：三态布局（`data-layout`：wide / long / compact）+
  断点（`data-bar` / `data-ctl`）+ 动效 + 主题变量桥（`--hk-*`）。
- **后端入口** `index.js`：v2 App `apply(ctx)`，注册工具与路由。
- **后端模块** `lib/`：
  - `register-routes.js` — HTTP 路由（**含 `/widget/api/...` 旧路径，别改**）
  - `register-tools.js` — 暴露给模型的工具
  - `state.js` — 播放状态
  - `meting.js` — 在线音源（多节点降级，节点内置；**只保证自己不加新的**）
  - `bilibili.js` — B站搜视频抽音轨
  - `cover-catalog.js` — 网易云官方元数据（B站合集补封面）
  - `cookies.js` — 读 `app-data/cookies.env`
- **工具** `tools/`：`bump-build.mjs`（构建号）、`pack-release.mjs`（出发布包）、
  `verify-ui.mjs` / `verify-backend.mjs`（验收）、`measure-icons.mjs`（量图标外接框）等。
  **`tools/` 里三个运行时工具是装载依赖，打包别整目录排除。**
- **app-data**（`~/.hanako/app-data/hanako-simple-player/`：`playlist.json` / `cookies.env` / `lyrics/`）
  **不在本仓库**，安装/重装不碰它。

## 4. 部署回路

1. 在本仓库改。
2. 同步 `ui/` **整包**进 `~/.hanako/apps/hanako-simple-player/`；
   或更省事：把本仓库装成本地来源（`extension_manager install`，source `local`），以后直接 `reload`。
3. `node tools/bump-build.mjs`。
4. **重载 app（必须，别省）**：`extension_manager reload app:hanako-simple-player`。
   页面**不会**自己刷新（`index.html` 里没有 _build.json 轮询块），光同步文件不生效。

> 一句话：**改完 → 同步 `ui/` 整包 → `reload` app**。三步缺一不可。

## 5. 文档地图

**当前状态**：版本 1.0.7，构建号见 `ui/_build.json`。已部署、真机验收通过。

**二级文档**（本文件只留纪律，下面这些按需查）：

| 想要什么 | 去哪 |
|---|---|
| 版本变更、每版给用户带来什么 | [`docs/CHANGELOG.md`](docs/CHANGELOG.md) |
| 踩过的坑、根因、「别改回 XX」 | [`docs/PITFALLS.md`](docs/PITFALLS.md) |
| 待办、待真机验收、评审遗留 | [`docs/TODO.md`](docs/TODO.md) |
| 每轮详细技术交接（改了什么文件 / 断言编号） | `docs/player-ui/*-DONE.md` |
| 前端契约与重构背景 | `docs/player-ui/CONTRACT.md`、`docs/REFACTOR-BRIEF.md` |
| 开工前的旧简报（历史，已被 CONTRACT 取代） | `docs/player-ui/archive/` |
| 重构前的设计稿 / 图片提示词（历史） | `docs/archive/design-proposals/` |

> 早期待办书里的「PV / 唱盘 / 主题面板」等要求已被 `CONTRACT.md` 取代，以极简版为准。

## 6. 视觉规范

**主题跟随宿主 Hana（`hana.theme`，快照 + 订阅），含夜间主题 —— 别自己另起一套明暗。**
SDK 默认把宿主主题样式表注入页面（`ui/sdk.js` 的 `followHostTheme`），
**别定义同名 `--bg/--text/--accent` 去盖宿主**。强调色只用在「当前 / 激活 / 强调」上。

两套皮别混：

- **卡片 / 文档**：Hana house-style —— 纸 `#F8F4ED` / 卡面 `#FFFDF7` / 墨 `#2A2622` /
  唯一强调色远山蓝 `#537D96`（`~/.hanako/recipes/hana-folio/references/house-style.md`）。
- **Hana App 界面（本 App 活在这里）**：深板岩 `#34424B` / 面 `#414D56` /
  强调藕荷粉 `#C99AAF` / 文字 `#E1EAF0`·`#9FB1BC`（近似色，权威以 `hana.theme` 为准）。

顶部圆角自己补：`.player` 写 `border-radius: 14px 14px 0 0`（只上两角）——
宿主只在独立窗裁圆，卡片里不裁；`.frame` 底色给 `--hk-surface`，
角上露出卡面色而不是页面色。想跟随圆角偏好写 `calc(14px * var(--corner-radius-scale, 1))`。

通用：小圆角约 5px；只 SVG 线描图标（禁 emoji）；字号 ≥ 11px；禁左竖线当区块装饰。

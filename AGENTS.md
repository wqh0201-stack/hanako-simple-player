# AGENTS.md · hanako-simple-player（小花音乐播放器）

一个 Hana v2 App：本地 / 在线音乐播放器，跟随宿主主题，含歌词与音频反应涟漪。
**许可证 AGPL-3.0**（衍生自上游，别改回 MIT）。当前版本 1.3.0。

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

> 这是**本地回路**。**对外发版**（封包 → GitHub Release → 市场 PR）是另一条链，
> 见 §5 文档地图，动手前先读那份清单再动。

## 5. 文档地图

**当前状态**：版本 1.3.0，构建号见 `ui/_build.json`。已部署、真机验收通过。

**二级文档**（本文件只留纪律，下面这些按需查）：

| 想要什么 | 去哪 |
|---|---|
| 版本变更、每版给用户带来什么 | [`docs/CHANGELOG.md`](docs/CHANGELOG.md) |
| 踩过的坑、根因、「别改回 XX」 | [`docs/PITFALLS.md`](docs/PITFALLS.md) |
| 待办、待真机验收、评审遗留 | [`docs/TODO.md`](docs/TODO.md) |
| **Hana 发任务 → Codex 执行 → 直接回 Hana 验收** | [`docs/COLLABORATION-HANA-CODEX.md`](docs/COLLABORATION-HANA-CODEX.md) |
| **对外发版**（封包 → GitHub Release → 市场 PR） | 知识库 `/Volumes/SSD/知识库/20-资料/Hana App 发版到市场（本地封包-GitHub Release-market PR）.md`；本仓登记记录 [`docs/player-ui/handoffs/MARKET-ENROLL-1.0.0.md`](docs/player-ui/handoffs/MARKET-ENROLL-1.0.0.md) |
| 每轮详细技术交接（改了什么文件 / 断言编号） | [`docs/player-ui/handoffs/`](docs/player-ui/handoffs/)（46 份，索引见 [`docs/player-ui/README.md`](docs/player-ui/README.md)） |
| 前端契约与重构背景 | `docs/player-ui/CONTRACT.md`、`docs/player-ui/REFACTOR-BRIEF.md` |
| 开工前的旧简报 / 淘汰的 UI 原型（历史） | `docs/player-ui/archive/`（原型在 `archive/prototype/`） |
| 重构前的设计稿 / 图片提示词（历史） | `docs/archive/design-proposals/` |

> 早期待办书里的「PV / 唱盘 / 主题面板」等要求已被 `CONTRACT.md` 取代，以极简版为准。

> 仓库根目录的 `OH-Works/` 是**罐头自己的截图暂存夹**（未跟踪）。它就该以未跟踪状态待在本地：
> **别提交、别删、别加进 `.gitignore`** —— `git status` 里看到它属于正常，不用问、不用处理。

## 6. 视觉规范

**主题跟随宿主 Hana（`hana.theme`，快照 + 订阅），含夜间主题 —— 别自己另起一套明暗。**
SDK 默认把宿主主题样式表注入页面（`ui/sdk.js` 的 `followHostTheme`），
**别定义同名 `--bg/--text/--accent` 去盖宿主**。强调色只用在「当前 / 激活 / 强调」上。

两套皮别混：

- **卡片 / 文档**：Hana house-style —— 纸 `#F8F4ED` / 卡面 `#FFFDF7` / 墨 `#2A2622` /
  唯一强调色远山蓝 `#537D96`（`~/.hanako/recipes/hana-folio/references/house-style.md`）。
- **Hana App 界面（本 App 活在这里）**：深板岩 `#34424B` / 面 `#414D56` /
  强调藕荷粉 `#C99AAF` / 文字 `#E1EAF0`·`#9FB1BC`（近似色，权威以 `hana.theme` 为准）。

圆角交给宿主，应用一个角都不画：`.player` 四角一律直角 —— 聊天卡片由宿主裁卡面，
独立窗由窗口/系统裁（macOS 原生圆角窗 / Windows frame:false 方角窗）。
`.frame` 底色仍给 `--hk-surface`（垫底，防万一露出时是卡面色而非页面色）。

通用：小圆角约 5px；只 SVG 线描图标（禁 emoji）；字号 ≥ 11px；禁左竖线当区块装饰。

## 7. 常驻协作方式

本项目固定采用 **Hana 发任务、Codex 实现与自验、Hana 独立验收**。
开工、宿主探查、交接或返修前读 [协作约定](docs/COLLABORATION-HANA-CODEX.md)。
用户已授权 Codex 通过 **Computer Use** 激活桌面 **HanaAgent**，在对应项目会话直接发送
探查请求、进度、交接及返修回复；在此范围沿用授权，无需每次重新确认。
共享仓库承接任务书、原始输出和验收报告；发送后确认消息已提交，验收结论以证据为准。

## 8. 测试节奏（别一律跑全量）

**全量回归只在发版前跑**；普通功能更新不跑。区分清楚：

- **普通功能更新**：改完 → `ui/` 整包同步 → `reload` → 只做**基础检查**
  （构建号三处一致、孪生 HTML 一致、页面能加载无报错），然后**交用户实际使用，
  以用后反馈为主**。不要跑 `verify-ui.mjs` 全量套件；专项只跑**改动触及的那块**
  （见下文），别为一次小改动新写一堆积压套件。
- **发版前（Release / 市场 PR）**：才跑全量 —— `node tools/verify-ui.mjs` +
  `node tools/verify-backend.mjs`，数字写进 Release / PR 自测报告。
- 例外：用户点名要，或改动触及**播放链路 / 宿主契约 / 权限**这类高风险区时，
  在发版前额外补对应专项。

> 一句话：**平时「基础检查 + 用户用完反馈」，发版前才全量回归。**
> 别把「每轮必跑全量」当纪律 —— 本轮改个样式也跑 600 条断言，是白烧时间。

### 全量不跑 ≠ 专项不跑（别把两者一起省掉）

全量里大部分断言跟当次改动无关（搜索 / ete / 歌曲 / 涟漪 / 封面 / 队列 …），
平时跑它们只是重复验证上次发版已验过的东西。**省的是全量，不是专项**：

- **改了哪块，就跑哪块的专项**：`node tools/verify-ui.mjs --strip-lyrics-only`、
  `--strip-flow-only`、`--touchbar-only`、`--interaction-only` 等（`--xxx-only`
  分支见 `tools/verify-ui.mjs`，各一两分钟）。这是「本次改动真生效、且没砸到旁边」
  的唯一证据，比全量里那 600 条里的无关项有用得多。
- **专项本身也可能已经坏了**：2026-10-17 实测 `verify-strip-lyrics.mjs` 因星尘改 canvas
  后仍等已删除的 DOM 节点，**长期以抛异常方式终止**（不是「红几条」，是崩溃、
  后面的断言一条没跑到）。正因它平时被跳过才一直没人发现。
  所以「某条专项跑不通」不要默认成环境问题或历史遗留，多半是真缺陷或真过期。
- **判断专项是否可信**：跑完看是否真有断言在验数据 —— 必要时做一次突变检验
  （故意破坏生产代码对应逻辑），套件应失败；跑得过且改坏了也不红，就是恒真断言。

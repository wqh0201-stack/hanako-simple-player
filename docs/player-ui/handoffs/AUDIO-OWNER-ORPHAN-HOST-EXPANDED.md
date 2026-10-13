# AUDIO-OWNER-ORPHAN-HOST-EXPANDED · 扩查：孤儿 owner 自愈到底靠什么

> 执行：哦鲸鲸。日期：2026-10-13。用户指令：「接手工作，允许你扩大探查范围」，并授权并行派发分身探查。
> 范围：**只读探查**——不改生产源码 / 断言 / manifest / 版本 / 构建号 / app-data，不部署、不 reload、不清正式 owner、不启动第二个 Codex。
> 上游：`AUDIO-OWNER-ORPHAN-REPAIR.md`（Codex 返修）、`AUDIO-OWNER-ORPHAN-HOST.md`（我上一轮窄口径探查）、`AUDIO-OWNER-ACCEPT-1.1.1.md`（我上一轮验收）。
> 证据目录：`docs/player-ui/handoffs/audio-owner-1.1.1/probe-expanded-20261013-hana/`（8 份，见 §7）。

---

## 0. 结论（三句话）

1. **宿主公开面确实没有**「旧 UI 文档已结束」的证明，也没有「宿主启动代」；宿主内部有 4 套代次记账，但**都不留墓碑**——撤销后只剩一个布尔假值，`revoked` 与 `unknown` 分不开。这是 Codex 卡住的真正原因，我独立复核确认，并**给出了最小新增接口的精确落点**（§3）。
2. **但有一条不需要宿主改任何东西的路**：`navigator.locks`（Web Locks）。它的锁**由文档持有、文档销毁时由浏览器自动释放**——这正是缺的那条「正向死亡证明」。我不仅查了规范，还在系统 Chrome 里**复刻了宿主的真实文档拓扑**并实测通过（§4）。
3. 建议**双轨**：Web Locks 先落地止血（现在就能做），同时把宿主最小接口作为长期加固交给维护方（§5）。

**1.1.1 验收结论不变：未通过（阻塞）。**

---

## 1. 这轮做了什么

用户放宽口径后，我把探查从「公开契约文本」扩到**宿主真实产物与运行时行为**：

| 来源 | 拿到了什么 |
|---|---|
| 服务端 `bundle/index.js`（320570 行，可读） | surface lease 表 `MIr`、静态 UI 快照管理器 `QIr`（含 **run nonce** 与 `sweepOrphans`）、卡 chrome 桥 `hNr`、`taskLifecycleGenerations`、`appReloadGates` |
| `app-host-entry.js` | App↔宿主 RPC 全枚举：**没有任何 UI 文档 / 视图 / 连接生命周期动词**；bootstrap 载荷无每启动唯一值 |
| 渲染层 `assets/*.js`（vite 压缩） | App UI 挂载（`<iframe sandbox="…allow-same-origin">`）、四条独立 teardown、卡 chrome 注册协议与 **`viewEpoch`（每文档 epoch）** |
| `HanaAgent.app/Contents/Resources/app.asar` → `desktop/main.bundle.cjs` | Electron 各窗口的 **partition 分配**（主窗与拖出窗=默认 session；App 自建窗/隔离环境/浏览器标签=各自分区） |
| 系统 Chrome 155 独立实验 | Web Locks 语义与**宿主拓扑下的跨文档共享**（§4） |

并行派了 5 个「我自己」的分身做只读探查，各写一份报告（§7）；我自己做了宿主产物解包与 Chrome 实验。

---

## 2. 宿主公开面：没有可用的死亡证明（独立复核）

- **没有宿主启动代**：`serverId` / `serverNodeId` / `hostId`（=`serverNodeId`）跨重启稳定；`server-info.json` 每次重写但唯一变的是 `pid`（**勘误**：`token` 也每启动随机，但它是 bearer 秘密、不在公开契约上）；`data-epoch.json` 是数据纪元。公开层连「后端重启」都证不了。
- **没有「旧文档已结束」**：`hana.surface.getContext()` / `hana.viewState` / `hana.lifecycle` / `ctx.surfaces.listCardChromeViews` / `ctx.runtime.*` 逐个核过——**「不在列表」有多种解释**（App 没加载 / 重载中 / socket 断 / 凭据撤 / 真关了），契约自己把它归为 `unknown`。
- **宿主内部确有 4 套代次**：App 装载代 `appGeneration`、后端进程代 `taskLifecycleGenerations`+`appReloadGates`、渲染层卡视图代 `viewEpoch = scopeId:generation`、静态 UI 快照的 `run-<pid>-<nonce>` 目录。**全部未公开，且没有一个覆盖「前端媒体文档」**。
- **关键缺失是「墓碑」**：`MIr.isActive` / `QIr.isActive` 都只返回布尔；`revoke` 的布尔只在调用那一刻有效，之后无痕。所以宿主自己也分不清「被撤销」和「从未存在」。
- **另有一条勘误**：`HanaDocumentContext.generation` 被宿主写死为 `1`（死字段），不能当文档代。

---

## 3. 若要新增：最小接口与精确落点（交给维护方）

宿主内部**已经亲历**三种销毁，只是不落成可查状态：
- `QIr.closeEntry`（App 换代 / 回收 → abort 所有 reader、删该 entry 全部 lease）
- `QIr.sweepOrphans`（新 server 启动 → 上一代 `run-*` 目录整棵删除，**这就是「上一代静态 UI 文档全终止」的现成栅栏**）
- `hNr.disconnect`（socket 断连立即删视图）+ `ui-sessions/release`（宿主主动释放 iframe）

**最小落点（只加只读查询，不新增权限词）**：
- **A（同代内精确 ended）**：在 `MIr.revoke` / `QIr.closeEntry` / `hNr.disconnect` 写墓碑；在已有的卡 chrome 门（`trn` + `APP_SURFACE_METHODS`）加一个只读方法，返回 `{ ok, state: "active" | "ended" | "unknown" }`。`ended` 仅当有墓碑；**「句柄不在表」必须是 `unknown`，不能当 `ended`**。
- **B（跨代整代 ended）**：把 `QIr` 已有的 run nonce 提升为一个只读入口（如 `server-info.json` 加字段，或一条 `GET /api/apps/ui-run`）。App 在 owner 记录里带上它；查不到/不同 → 上一代文档全终止（由 `sweepOrphans` 背书）。
- `documentId` 复用宿主已铸、App 已能读到的 `viewHandle`（卡 chrome）或 `cardInstanceId`（`hana.surface.getContext()`），不必新铸身份。

详细行号、证据与替代方案见 `03-host-internals.md`；公开信号逐条判定见 `01-signal-census.md`。

---

## 4. 不需要宿主改动的那条路：Web Locks（已实测）

**原理**：锁住在浏览器进程里，按 **storage bucket（同源 + 同 session + 同顶层站点）** 共享；**文档被销毁时由浏览器自动释放**（规范 §2.6 + HTML 的 unloading document cleanup steps；规范动机段直接写「tab 崩溃时另一个 tab 会拿到锁」）。
→ 新实例用 `ifAvailable` 抢锁：**抢到 = 旧 owner 已死（浏览器已替我们清账）**；**抢不到 = 有活 owner**。全程不依赖超时、不依赖通知、不依赖宿主接口。
→ 后来者用 `steal: true` 原子抢占，旧持有者收到 `AbortError` 并暂停。

**我实测到的（系统 Chrome 155，脚本与原始输出见 §7）**：
1. `http://127.0.0.1` 是 secure context，`navigator.locks` 可用；宿主那套 `sandbox="allow-scripts allow-forms allow-popups allow-same-origin"` 下同样可用。
2. **摘掉 iframe（不执行任何卸载 JS）→ 锁自动释放**；跨 tab 共享；`steal` 抢占后旧持有者拿到 `AbortError`。
3. **隐藏 / 滚出视口 / 压成 0 尺寸 / 切到后台 tab 都不释放锁** → 活但隐藏的 owner 不会被误判为死。
4. **复刻宿主拓扑**：主窗口（`file://`）里的 App UI iframe 持锁；`window.open('about:blank')` 开的「拖出窗」里嵌同源 iframe → **看得见那把锁、且抢不到**。即卡片与独立窗口**同一 storage bucket**。
   - 依据：`app.asar` 里主窗口与拖出窗的 `webPreferences` **都没有 `partition`** → 默认 session；两者顶层站点都是 `file://`。
5. **前提与风险**：Chromium 的第三方存储分区按**顶层站点**分桶（我的对照实验证实：顶层若变成 `http://127.0.0.1` 第一方，就不共享了）。宿主现为 `file://`，所以成立；但 App 控制不了这一点——**因此必须保留「抢不到锁就保守待命」的退化路径**，不能把 Web Locks 当永不失效的保证。

**它天然覆盖 Codex 的两个反例**：只重建 App 后端（锁在浏览器，不受影响 → 不误抢）；用户手势 + 失联超时（锁还在 → 永不被判死；要抢走 `steal`，通知由浏览器直投，通道失联也拦不住）。

**最小集成落点**（详见 `05-player-integration.md`）：前端 `initAudioOwner` 持锁、`claimAudio` 带 `reap`；后端 `lib/audio-owner.js` 的 `claim` 在 47 行 restore 守卫**之前**加清点、`stop` 补逃生口；`owns()` 与 `yield`/`handoff` 一字不改。

---

## 5. 建议（双轨）

| 轨道 | 内容 | 状态 |
|---|---|---|
| **短期（可立即落地）** | App 内用 Web Locks 做存活判据 + 自愈；保留显式交接做快通道；保留「抢不到锁就待命」的退化 | 需 Codex 实现 + 真机复验 |
| **长期（加固）** | 请宿主维护方按 §3 加只读的 `ended/active/unknown` 与跨代栅栏 | 需维护方，当前阻塞 |

两者不冲突：Web Locks 解决「现在能不能自愈」，宿主接口解决「保证不依赖宿主内部实现细节」。

---

## 6. 仍然待验 / 未核实

- **全部为静态核对 + 系统 Chrome 实验**：**没有在真实 HanaAgent（Electron）里跑过**。真机必须验：两个表面的实际 origin / 顶层站点 / session；宿主 `about:blank` 弹窗的顶层站点；Electron 是否与 Chrome 同行为。
- 未测 bfcache / tab freeze 是否释放锁（已排除 display:none / 滚出视口 / 后台 tab）。
- 未测远程 / 移动端（非 secure context 下 `navigator.locks` 缺失 → 需退化）。
- 未确认 player 当前是否注册 card chrome 视图（影响宿主接口方案 A 的适用性）。
- 并发 boot 接管 flaky（上一轮验收 §1）仍待处理。
- 仓库并发状态：`docs/TASK-mood-onestep-1.1.2.md` 等在途改动保留未动；本轮**未改任何生产源码 / 断言 / 版本 / build / 数据**。

---

## 7. 证据索引（`audio-owner-1.1.1/probe-expanded-20261013-hana/`）

| 文件 | 内容 |
|---|---|
| `01-signal-census.md` | 12 条前端 + 8 条后端 + 9 条内部机制，逐条判定「能否证明旧文档已结束」；明确没有的能力清单；最小新增建议 5 条 |
| `02-iframe-lifecycle.md` | App UI 挂载（src/sandbox/query）、四条独立 teardown、宿主退出无兜底、卡 chrome 注册协议与 `viewEpoch` 语义、`surfaceSession` 字段 |
| `03-host-internals.md` | `MIr`/`QIr`/`hNr`/`YHe`/`taskLifecycleGenerations` 实现事实与行号；ended/unknown 判定；最小接口 A+B 与精确落点 |
| `04-liveness-primitives.md` | 浏览器原语对照表（含规范链接）；只有 Web Locks 能给「对端已死」的正向证明；最小集成设计与真机清单 |
| `05-player-integration.md` | 播放器现状逐函数地图（带行号）、死锁机制级根因、两条自愈路径的最小改动落点、回归风险 |
| `06-weblocks-chromium-probe.md` | Web Locks 基础语义实测（secure context / 自动释放 / 跨 tab / steal / 隐藏不释放 / sandbox 可用） |
| `07-session-partition-finding.md` | `app.asar` 判定：主窗与拖出窗都无 `partition` → 默认 session；对照「确实每窗口一分区」的地方 |
| `08-weblocks-host-shape-probe.md` | **决定性**：复刻宿主文档拓扑，实测卡片 iframe 与拖出窗 iframe 共享同一把锁；含第三方分区对照与前提风险 |

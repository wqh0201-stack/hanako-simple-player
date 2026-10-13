# AUDIO-OWNER-ORPHAN-HOST · 孤儿 owner 自愈所需的宿主信号（只读探查）

> 提问方：Codex（见 `AUDIO-OWNER-ORPHAN-REPAIR.md` §4）。执行：哦鲸鲸。
> 日期：2026-10-13。范围：**只读探查**，不改源码/断言/manifest/版本/build，不清正式 owner，不再部署/reload，不启动第二个 Codex。
> 契约基准：`~/.hanako/artifacts/server/1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133/APPS.md`（3104 行）+ 同产物 `bundle/index.js` + App 自带 `ui/sdk.js`。
> 证据等级：全部为**契约/源码静态核对**（本轮未跑宿主实测）；凡未实测处均标注。

---

## 0. 一句话结论

**已核对的公开 SDK / APPS 里没有「宿主启动代」，也没有「旧文档已结束」的证明。**
宿主**内部确实有** App 生命周期代与媒体代栅栏（`taskLifecycleGenerations`、`appReloadGates`），但它们都是 App **后端进程级**、且**未暴露给 App**，**都不覆盖「前端媒体文档（iframe/renderer）」**。
所以 Codex §5 提的「媒体文档身份 + ended/active/unknown」在本版宿主**没有可接入的公开接口**——这一点与 Codex 的核对结论一致，我独立复核后确认。

---

## 1. 问题一：host 重启 / App reload 如何销毁旧 renderer，公开层能否证明

### 1.1 host 重启

宿主是 Electron。重启 = 主进程 + 所有 renderer 重启，App 后端子进程随之重启。
**但公开层没有任何「每次启动都变」的标识可当启动代：**

| 文件 / 标识 | 语义（源码/元数据原文） | 跨重启 |
|---|---|---|
| `server-node.json` 的 `serverId` / `serverNodeId` | `identityContract: "serverNodeId is the stable identity of one HANA_HOME server node."`；`createdAt` 2026-09-08，文件 mtime 09-08 | **稳定不变** |
| `server-info.json` | `epochPolicy: "regenerable"`、`checkpointPolicy: "Excluded; it is live process discovery state."`、`restorePolicy: "Regenerate after transport binding."`；内容是 `pid/port/host/token/serverId/serverNodeId/studioId/userId` | 每次启动重写，**但唯一变化的是 `pid`**（其余 `serverId` 等取自 `server-node.json`，稳定） |
| `data-epoch.json` | `epoch` 是**数据纪元**（迁移用），不是启动代；当前 `epoch: 2`、`updatedAt` 2026-10-12 | 不随每次启动变 |

生成点：`YEr({now})` → `server_${randomUUID()}`，仅在**首次** seed（`i || YEr(...)`，`i` 为已存在的 `server-node.json`）时调用；之后持久。

**结论**：连「宿主后端重启」这个较弱的命题，公开层都证明不了——`serverId` 稳定；`server-info.json` 每次变但只有 `pid`（Codex 已明确排除 pid）。**「启动代」这条路在公开契约上不存在。**

### 1.2 App reload

`extension_manager reload` / 市场「重新加载」= 重启该 App 子进程 + 重载其 UI 树（`APPS.md:2929`）。
宿主内部有 `appReloadGates` 保证同 App 的旧/新绑定串行（见 §2），但那是**后端**的。
**公开层同样没有「旧 UI 文档已结束」的标记。**

### 1.3 App 侧能拿到的信号，逐个都不够

| 信号 | 契约语义 | 为什么不能授权孤儿恢复 |
|---|---|---|
| `hana.surface.getContext()` | `appId / slot / cardInstanceId` + 可选业务键/会话/视图命名空间（APPS 986） | 卡 ID 可跨 reload 保持；既不是启动代，也不表示旧文档是否存在 |
| `hana.lifecycle` / `hana.surface.runtime.changed` | **本文档**的 `visible / active / maxFrameRate / motion`（`ui/sdk.js:253-299`） | 本实例绘制状态，无对端成员表（我上一轮已修正过一次这个误判） |
| `hana.surface.envelope.changed` | 本卡信封（尺寸/形态）快照 | 与媒体文档生死无关 |
| `ctx.surfaces.listCardChromeViews()` | 列本 App **受支持的活视图**（APPS 2266–2299） | 「不在列表」不等于已静音；App 重载/socket 断开/凭据撤销都会令句柄失效，超时/断线只能 unknown |
| `hana.viewState` 绑定句柄 | 绑定「文档 + 宿主命名空间 + 注册 id」（APPS 2303、2440） | 句柄失效只说明**这个句柄**不能再用，不证明旧文档的媒体已停 |
| 服务级 `runtimeId` | 本 App **受管服务**的运行实例 ID（APPS 2842–2852、2898） | 是**服务**代，不是 App / 宿主装载代，更不是前端文档代 |

**没有一项提供「旧媒体文档已结束」的证明。** 这独立复现了 Codex §4 表格的结论。

---

## 2. 问题二：内部有代机制，但都未公开、且都不是「媒体文档级」

我在 bundle 里找到了宿主内部的「代」机制——**存在，但不可接入**：

1. **`appReloadGates`（内部类 `YHe`）** —— **媒体操作代栅栏**：
   - 字段：`currentGeneration` / `reloadingGeneration` / `active` / `interruptedGenerations`；
   - 方法：`begin(gen, kind)` / `invoke` / `beginReload(gen)` / `cancelReload` / `admitGeneration` / `retireGeneration`；
   - 错误码：`APP_MEDIA_RELOADING`（`App … no longer owns generation …`）、`APP_RELOAD_BUSY`（`has an active media operation`）、`APP_RELOAD_IN_PROGRESS`；
   - 注释：`One gate per App id spans old and replacement bindings.`
   - **但它管的是 App 后端经 `ctx.media` 注册的媒体适配器操作（`beginAppAdapterReload`），不是前端 UI 媒体文档**；也没有暴露给 App。

2. **`taskLifecycleGenerations`** —— App 生命周期代：
   - 注释：`A lifecycle generation prevents a delayed start or crash restart from recreating an App after a disable, uninstall, or root shutdown.`
   - 同样是**后端/任务**级，非前端文档级。

3. **`ui-sessions` / `surface-leases`** —— App 静态 UI 句柄租约（宿主内部路由与凭据细节，APPS 2861 明说随宿主版本变化、作者不得自行拼装）。

**判定**：宿主内部有「App 装载/媒体代」的骨架，但**没有任何一个语义是「前端媒体文档身份 + ended/active/unknown」**，也都**不在公开 SDK/APPS 上**。Codex §5 提的「宿主完成旧代所有 UI 终止的栅栏」在**当前公开面**不存在，需要宿主新增接口。

---

## 3. 对 Codex 四点要求的逐条确认

Codex 要求我在报告里明确的，我独立核对后**全部确认**：

1. **Server 启动代若只证明后端重启，不能证明所有媒体 renderer 已停。** ✅ 确认。而且更强：本版公开层**连后端重启都证明不了**（`serverId` 稳定、`server-info.json` 只有 pid）；即便拿到后端重启信号，也与「前端媒体文档是否已停」无关。
2. **一个 bootId 不能独自覆盖「同代内直接移除单个 iframe」。** ✅ 确认。同代内单独摘掉一个 iframe 时，宿主代不变，只有**该文档**的 ended 才能授权恢复。
3. **需要公开「媒体文档身份 + ended/active/unknown」或「宿主完成旧代所有 UI 终止的栅栏」；socket 断开/超时只能 unknown。** ✅ 确认。现有信号（`listCardChromeViews` 缺失、句柄失效、BC/storage 静默、隐藏、后端重启）**都只能推 unknown**，不能推 ended。
4. **1.1.1 旧记录无 docId，迁移也需宿主确认旧 App 文档全已终止，缺字段不能直接清空。** ✅ 确认。存量 `player-audio-owner` 记录里没有任何文档身份字段，无法自证其文档是否已终止；**缺字段 ⇒ unknown ⇒ 保守待命**，不能当孤儿清空。

---

## 4. 结论与建议

- **公开面缺接口，这是本修复的前置阻塞。** 孤儿自愈无法只在 App 内完成——任何「随机后端 epoch + 清 owner」「手势 + 超时强播」都会踩 Codex §2 的两个反例（活文档被误抢）。Codex 拒绝这两条捷径是对的。
- **最小新增接口**建议采纳 Codex §5 的形状：宿主给**当前 UI** 一个不含凭据的 `documentId` + 生命周期代，并提供 `active / ended / unknown` 的查询；**只有宿主确证 iframe/媒体 renderer 已销毁才能报 `ended`**，socket 断开/超时/隐藏/桥接重绑一律 `unknown`；若给 host 代，则「代已结束」必须蕴含**该代所有媒体文档已终止**（Server 重启本身不满足）。
- 这需要**用户授权扩展到 Hana 宿主正式接口**才能落地；在此之前，1.1.1 的孤儿死锁**无法在 App 内安全修复**。

## 5. 本轮未做 / 未测（照实标注）

- **未跑宿主实测**：host 重启 / App reload 的 renderer 销毁时序是**契约与源码静态核对**结论，未做真机时序抓取（Codex 的 `orphan-repro` 已用 CDP `Page.crash` 覆盖「文档被强制销毁且无 handoff」这一路径）。
- **未读宿主私有文件绕过 SDK**：`server-info.json` 只用于核对元数据语义，不作为身份来源；未解析 token、未用 pid。
- **未改任何生产源码 / 断言 / 版本 / build / 数据**；未部署、未 reload。验收与死锁原始证据见 `AUDIO-OWNER-ACCEPT-1.1.1.md`。

# 01 · 宿主信号普查（音频所有权 1.1.1 · 孤儿 owner 死锁）

> 任务：把一个 App（后端 `ctx` + 前端 `hana.*` SDK）能触达的、任何带**生命周期 / 存活 / 身份**语义的宿主信号穷举成一张表，逐条判定它**能否证明「某个旧 UI 文档已结束」**。
> 执行：哦鲸鲸（并行探查分身）。日期：2026-10-13。范围：**只读**，不改源码 / 测试 / 断言 / manifest / 版本 / 构建号 / app-data，不部署、不 reload、不装东西。本文件是本次唯一产出。
> 契约基准（权威）：`~/.hanako/artifacts/server/1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133/APPS.md`（3104 行）。旁证：同产物 `bundle/index.js`、`bundle/cli.js`、`app-host-entry.js`、`skills2set/hana-app-creator/assets/sdk/hana-app-sdk.tgz`（解出后记作 `app-sdk/dist/*`）、renderer `assets/*.js`、App 自带 `ui/sdk.js`。
> **证据等级：本轮全部为契约 / 源码静态核对，未跑宿主实测。** 凡未实测处一律标注。压缩文件（`bundle/*.js`、renderer `assets/*.js`）单行极长，引用给 **字节偏移 `@N`**（已换算，行号在这些文件里无意义）。

---

## 0. 一句话结论

**公开层（APPS.md + `@hana/app-sdk` 类型包 + `app-host-entry.js` 的 RPC 枚举）里，没有任何一个 App 可触达的信号能证明「某个旧 UI 文档已结束」。** 宿主内部**确实**存在四种「代次 / 存活」记账（App 装载代 `appGeneration` / `getAppRuntimeId`、后端生命周期代 `taskLifecycleGenerations`+`appReloadGates`、renderer 卡视图代 `viewEpoch`、以及 `app-static-ui-access` 的 `run-<pid>-<uuid>` 运行目录 + 内存态 surface lease 表），但它们**全部未公开给 App**，且**没有一个是「前端媒体文档级」的 ended 证明**。唯一能拿到的是「每份文档自身的装载凭证」（`appIframeTicket` / `appSurfaceSession`，以及 chrome 的 `documentNonce` / view token），它们**只能标识本代自己**，无法证明对端已死。结论：孤儿 owner 的权威恢复信号，**需要宿主新增**（形状见 §3）。

---

## 1. 信号普查表

列义：**跨 reload 稳定?** = 同一个逻辑对象在宿主重启 / App reload 后是否拿到同一个值；**能否区分 ended/active/unknown** = 能否据此断言「某个旧文档已结束 / 仍活着 / 无法判定」。所有判据都注明出处。

### A. 前端 `hana.*` SDK（`@hana/app-sdk/ui`，App iframe 内可调）

| # | 名称 | 契约语义（原文 + 出处） | 跨 reload 稳定? | 能否区分 ended/active/unknown | 结论 |
|---|---|---|---|---|---|
| A1 | `hana.surface.getContext()` / `onContextChanged` | 返回宿主盖章的 `{ appId, slot, cardInstanceId }`，另有加性字段 `instanceKey?` / `embeddedSessionId?` / `originSessionId?` / `viewState?`；握手前为 `null`（`APPS.md:986`、`:1010`、`:943`；类型 `app-sdk/dist/_ui-protocol.d.ts:991-1012`；renderer 组装点 `ChatTranscript-CLxbpBJm.js:@710533`） | `cardInstanceId` 跨 reload 保持（它是卡实例 id，非文档 id） | 否。**无任何 generation/epoch 字段**；`cardInstanceId` 只说「哪张卡」，不说「哪个文档、是否还活」 | **不可用** |
| A2 | `hana.viewState`（`enable` → `{initial, signal, get, set, release}`，含 `bindingId` / `available`） | 「`enable()` 在调用那一刻捕获了文档、宿主给的命名空间和注册 id……不会跟着『当前』漂移」（`APPS.md:2303`）；`viewState.bindingId` / `available` 语义 =「只表示『此表面当前是否暂时可用』，不是授权」（`app-sdk/dist/_ui-protocol.d.ts:980-989`） | 布局卡持久恢复；**流内卡只会话内恢复，不跨宿主重启**（`APPS.md:2447`） | 否。`VIEW_STATE_UNAVAILABLE` = 「此表面当前没有可用命名空间 / 视图正被替换」（`APPS.md:2446`）；「命名空间暂停期间句柄保留，同 id 恢复后可继续用同一个句柄」（`:2441`）——**暂停 ≠ 结束** | **不可用**（可作「本句柄是否还代表当前视图」的弱信号，非 ended 证明） |
| A3 | `hana.lifecycle` / `hana.surface.runtime.changed` | 本文档的绘制预算快照 `{ visible, active, maxFrameRate, motion, slot?, reason? }`（`ui/sdk.js:255-316`；类型 `_ui-protocol.d.ts:1014-1023` `PluginSurfaceRuntimeBudget`） | 本实例状态，不跨文档 | 否。只有「本 iframe 是否可见/被限帧」，**没有对端文档成员表** | **不可用** |
| A4 | `hana.surface.envelope.changed` | 挂载位尺寸信封 `{ width, height }`（三态 `fixed/flexible/unbounded`）（`APPS.md:2189-2231`；类型 `_ui-types.d.ts:33-41`） | 与文档生死无关 | 否 | **不可用** |
| A5 | `hana.chrome`（`set` / `onAction` / `registerScrollSource`，及底层的 `BINDING` / `CHALLENGE` / `ACK` 文档握手） | 宿主铸 view token；App 侧 `documentNonce`「由 App 的 chrome SDK **每次脚本运行生成一次**，因此它标识**文档**而非 App……宿主用它区分『同一文档再次回答』与『新文档出现（真 reload）』，但 view token/generation 仍由宿主自己铸」（`app-sdk/dist/_ui-protocol.d.ts:333-345`；`_ui-app-current-view.d.ts:12-20`） | **这是全场唯一一处显式的「文档身份」语义** | **宿主能判**，但 App **只能回显、不能查询**：App 拿不到「另一个 documentNonce 是否还活着」的答案 | **不可用**（除非宿主把「同/异文档」判定结果作为查询暴露，见 §3-1） |
| A6 | `hana.window.getContext()` / `onContextChanged` | 本 App 原生窗口上下文 `{ windowId, appId, agentId, title, platform?, chrome?, isFullScreen?, bounds?, parentWindowId?, data? }`（`app-sdk/dist/ui.d.ts:31-42`；`APPS.md:2967`） | `windowId` 跨窗口生命周期稳定 | 否。仅本 App 自己的窗口，与卡文档无关；**无 generation** | **不可用** |
| A7 | `hana.document.getContext()` 的 `generation` | `HanaDocumentContext = { documentId, viewId, providerId, appId, capabilities, resource, version, generation: number }`（`app-sdk/dist/_ui-types.d.ts:48-57`）；**但宿主生成点把它写死为 `generation: 1`**（`bundle/index.js:152219` `preview-documents/open` 响应，`generation: 1` 字面量） | 是（恒定 1） | 否。**死字段**，无区分能力；且仅「宿主绑定的 Preview 面」有（普通卡返回 `null`，`APPS.md:359`） | **不可用** |
| A8 | iframe URL 上的 `appIframeTicket` | `ui/` 文档装载票据；HMAC-SHA256 签名，密钥落 `{HANA_HOME}/app-iframe-ticket-key`（**文件持久，跨重启不变**，`bundle/index.js:54879` `$Sr`）；TTL `Mae = 300*1e3`（5 分钟，`:54784`）；载荷 `{ schemaVersion:1, ticketId:"ait_<uuid>", appId, surfacePath, action:"apps.iframe", principalId, issuedAt, expiresAt }`（`:54784`） | 签名密钥稳定；**`ticketId` / `issuedAt` 每次签发都新** | 否。能标识「本文档这一代装载」，但**无法证明别的文档已结束**（`APPS.md:1699-1701` 明说它只负责 `ui/` 文档） | **不可用**（可作本代文档的弱标识） |
| A9 | iframe URL 上的 `appSurfaceSession` | 「宿主在签发 iframe 装载票据时一并铸票，随 iframe URL 的 query 下发」（`APPS.md:1699`）；HMAC 签名，密钥落 `{HANA_HOME}/app-surface-session-key`（**文件持久**，`bundle/index.js:54915`）；TTL `yIr = 720*60*1e3`（12 小时，`:55622`）；载荷 `{ sessionId:"aps_<uuid>", appId, principalId, issuedAt, expiresAt, leaseId? }`（`:55622`） | 密钥稳定；`sessionId` / `leaseId` 每次铸票都新 | 否。只标识「本表面这一次会话」，无「对端是否结束」查询 | **不可用**（可作本代文档的弱标识） |
| A10 | `hana.instances.onChanged` / `hana.environments.onChanged` | `{ instanceId \| environmentId, revision, state }`（`app-sdk/dist/ui.d.ts:66-83`；`APPS.md:3029`） | 是（实例/环境 id 稳定） | 否。对象是 App 自己的**隔离实例 / 隔离环境**，与卡文档无关 | **不可用** |
| A11 | `hana.surfaces.onEvent(surfaceId, listener)` | 单向通知 `{ surfaceId, type, payload? }`（`workspace-action` / `workspace-changed` / `host-chat-action`）（`APPS.md:2993`、`:3023`） | — | 否。只报工作区/宿主面事件 | **不可用** |
| A12 | `hana.storage.onChanged` / `hana.storage.global.onChanged` | 只带变化的 `keys`，不带值；「任意一扇门写入后，宿主在既有的 `app_event` 通道上广播一条 `source:"server"` 的变更事件……回调只带发生变化的 `keys`」（`APPS.md:534-538`；`ui/sdk.js:971-983`（`hana.storage.global` 版）、`:1156-1160`（`hana.storage.onChanged`）） | — | 否。**不带写者代次**，无法区分「谁写的 / 上一代是否还在」 | **不可用**（但是自愈协议唯一现成的**广播通道**） |

### B. 后端 `ctx`（App 主入口 `apply(ctx)`，服务端）

| # | 名称 | 契约语义（原文 + 出处） | 跨 reload 稳定? | 能否区分 ended/active/unknown | 结论 |
|---|---|---|---|---|---|
| B1 | `ctx.surfaces.listCardChromeViews()` | 「只列本 App 当前的**活视图**（`viewHandle` / `cardInstanceId` / `cardId` / `appId`）」（`APPS.md:2292`）；「App 未加载（启动期、重载中、已停止）时返回**空列表**……App 重载、视图关闭、socket 断开或凭据撤销都会让旧句柄**立刻失效**」（`:2297`） | 句柄每次会话重铸 | 否。**「不在列表」有多种解释**（App 没加载 / 重载中 / socket 断 / 凭据撤 / 视图真关了），契约把它归为 `unknown` 类，不承诺等于「文档已结束」 | **不可用**（当前最接近的「活视图枚举」，但语义是 unknown） |
| B2 | `ctx.surfaces.getCardChromeView` / `setCardChrome` | 读/写某卡实例**此刻**持有的 chrome 描述与 `revision`；旧句柄失效有稳定 code；超时/断线结果是 `unknown`，不重试（`APPS.md:2292-2297`） | — | 否。句柄失效只说明**这个句柄**不能用 | **不可用** |
| B3 | `ctx.windows.*` / `ctx.instances.*` / `ctx.environments.*` | 本 App 的原生窗口 / 独立数据根实例 / 隔离环境管理：`create/list/get/close/control`、`reload/stop/close/logs`、扩展暂存与审查（`APPS.md:2946-2952`、`:2973-3035`）。需各自 capability | id/revision 稳定 | 否。管的都是 App 自己的窗口/实例/环境，**不含主界面的卡文档** | **不可用** |
| B4 | `ctx.runtime.*`（`start/list/get/stop/watch`）+ `runtimeId` | 本 App 的**受管程序 / 本地服务**运行实例：`start({runtime, profile?, entry?/command?, service?:{port,readyMarker,id?}})`、`list()`、`get(runtimeId)`、`stop(runtimeId)`、`watch(runtimeId)`（`APPS.md:2802`、`:2842`、`:2898`）。`runtimeId` 被称作「runtime generation」（`bundle/index.js:55021` 附近注释：「must name an App and a runtime generation」） | **服务实例代**：服务停止 / 换代后旧句柄失效（`APPS.md:2857`） | 否。它是**受管服务**代，不是 App 装载代、更不是前端文档代 | **不可用**（但见 §3-2 的「App 装载代」候选） |
| B5 | `ctx.storage.global.onChanged`（及 `agent()` 版） | 同 A12；「**宿主进程是唯一写者**」，「`onChanged` 跨门生效……广播……不新开一条总线」（`APPS.md:534-538`） | — | 否。无写者代次 | **不可用**（广播通道） |
| B6 | `ctx.documents.*`（`read` / `readRelated` / `writeExpectedVersion`） | 当前绑定文档的受限读写；只在「工具从真实 Preview 的宿主上下文调用」时可用（`APPS.md:357-368`、`:3021` 末） | — | 否。作用于**绑定文档自身**，不回答别的文档是否还活 | **不可用** |
| B7 | `ctx.appEvents.emit` / `ctx.bus.*` / `ctx.tools.*` / `ctx.commands.*` / `ctx.hooks.*` / `ctx.config.*` / `ctx.launchArgs` 等 | 见 `APPS.md:322-356` 的 `apply(ctx)` 成员速览；`app-host-entry.js:3811` 的 `APP_HOST_CTX_MEMBERS` 为完整成员表 | — | 否。均无生命周期 / 存活语义 | **不可用** |
| B8 | 全部 App-Host RPC 动词 | `app-host-entry.js:7-93` 的 `AppHostMethod` 枚举（`bootstrap` / `app.domain.call` / `tools.*` / `storage.*` / `documents.invoke` / `media.*` / `tasks.*` / `callback.*` …） | — | **枚举里没有任何 generation / lifecycle / liveness 动词** | **明确不存在** |

### C. 宿主内部：存在「代次 / 存活」机制，但未公开给 App

| # | 内部机制 | 语义（源码原文 + 出处） | App 能否触达 | 结论 |
|---|---|---|---|---|
| C1 | App 装载代 `appGeneration` / `appPlatform.currentGeneration(appId)` | `isCurrent: () => … re.currentGeneration(e) === (r.appGeneration ?? 0)`，用于卡 chrome 门禁，失败抛 `APP_CARD_CHROME_STALE`「this App loading generation is no longer live; reload the App before using card chrome」（`bundle/index.js:142687`、`:130985`） | **否**（仅 `ctx` 组装内部注入 `appGeneration`，未出现在公开 ctx 成员里；`APPS.md` 全文无此词） | **未公开**。**这是最接近「App 装载代」的东西**，见 §3-2 |
| C2 | `getAppRuntimeId(appId)` | 注释：「generation currently loaded, or null when the App is not loaded. **Read fresh on every call: a cached epoch would let a stream that outlived its App keep answering for the replacement**」（`bundle/index.js:150147`） | 否（宿主内部 + renderer 经 `currentAppRuntimeId` 读取，`:5938291`） | **未公开** |
| C3 | `taskLifecycleGenerations` / `appReloadGates`（类 `YHe`） | 「A lifecycle generation prevents a delayed start or crash restart from recreating an App after a disable, uninstall, or root shutdown」；`YHe` 有 `admitGeneration` / `retireGeneration` / `markInterrupted` / `canCommitResult`（`bundle/index.js:149733`、`:142980`） | 否 | **未公开**，且是 **App 后端进程级**，**不覆盖前端媒体文档** |
| C4 | renderer 卡视图代 `viewEpoch = ${scopeId}:${generation}` + 活视图表 | 注册记录含 `generation` / `viewEpoch` / `appRuntimeId`（`assets/ChatTranscript-CLxbpBJm.js:@431658`、`:@457371`） | 否（renderer 内部；`listCardChromeViews` 回包只暴露 `viewHandle/cardInstanceId/cardId/definitionId/appId`，`bundle/index.js:130985` 附近 `Qtn` 校验） | **未公开** |
| C5 | `app-static-ui-access` 的 `run-<pid>-<uuid>` 运行目录 + `uiRevision` | 「**Each Host runtime owns its run directory**; captures are bound to App id and runtime generation. **A content revision identifies bytes, not authority**, and live readers retain their exact snapshot until released.」「Process-owned run directories with schemaVersion-1 pid/nonce ownership markers and immutable ui file copies; **live leases are memory-only**」（`bundle/cli.js:4289`、`:4303`）；目录名正则 `^run-([1-9]\d*)-([0-9a-f]{8}-...)$`（`bundle/index.js:56960`）；`uiRevision` 正则 `^sha256:[0-9a-f]{64}$`（`:55021`） | 否（App 看不到自己的 run 目录 / pid / nonce） | **未公开**。**「每 Host runtime 一个 run 目录 + pid/nonce 标记」正是本问题想要的形状**，见 §3-4 |
| C6 | surface lease 表 `appSurfaceLeases`（= `surfaceLeases` / `serviceLeases`） | 内存态，按 `leaseId` 解析，`Obt` 同时校验 `leaseId` + `runtimeId`，`runtimeId` 不匹配即抛 `app_service_generation_stale`（`bundle/index.js:56960` 附近、`:55622`、`Obt`@`:1915958`） | 否（无公开枚举 API） | **未公开**。见 §3-4 |
| C7 | 稳定身份：`serverId` / `serverNodeId` / `hostId` / `deviceId` / `studioId` | `hostId = Lrt(serverNodeId)`——**`hostId` 就是 `serverNodeId`**（`bundle/index.js:262288`）；`serverNodeId` 是「stable identity of one HANA_HOME server node」 | 是（**跨重启不变**） | **不可用**（稳定 ⇒ 不能当启动代）。与已有结论一致，此处独立复核通过 |
| C8 | `server-info.json` 的 `pid` | 每次启动重写；唯一变化字段是 `pid` | 否（每次变） | **不可用**（App 读不到；且语义是宿主进程，不是文档）。与已有结论一致 |
| C9 | `data-epoch.json` 的 `epoch` | **数据纪元**（迁移用），当前 `epoch: 2` | 否（不随每次启动变） | **不可用** |

---

## 2. 明确没有的能力（公开层不存在）

1. **没有「宿主启动代」公开标识。** `serverId` / `serverNodeId` / `hostId`(=serverNodeId) / `deviceId` / `studioId` 全部跨重启稳定（C7）；`server-info.json` 每次变但只有 `pid`（C8）；`data-epoch.json.epoch` 是数据纪元（C9）。`APPS.md` 全文无 `hostId` 词条；`generation` 只作为媒体能力名（`image_generation` / `video_generation` 等，`APPS.md:672`、`:825`）出现，无「代次」语义条目；无 `epoch` 词条。
2. **没有「旧 UI 文档已结束」的证明，也没有这类通知。** 最接近的是 chrome 文档握手里的 `documentNonce`（宿主能判「同/异文档」），但它是 **App→宿主**方向、只作回显，App 拿不到对端存活答案（A5）。chrome 生命周期只区分「文档重载/新文档 → 描述回默认」与「同文档桥重绑 → 保留」（`APPS.md:2261-2262`），这是**写者侧**行为，不构成 ended 证明。
3. **没有「列出本 App 所有活媒体文档 / 活租约」的公开 API。** `ctx.surfaces.listCardChromeViews()` 是唯一「活视图枚举」，但它（a）只列 chrome 可写视图、（b）空表有多种解释、（c）回包不含代次（B1）。
4. **没有公开的「本 App 装载代」读取。** `appGeneration` / `getAppRuntimeId` 内部有（C1、C2），但既不在 `APPS.md`，也不在 `AppHostMethod` 枚举（`app-host-entry.js:7-93`），也不在公开 ctx 成员（`app-host-entry.js:3811`）。
5. **没有可用的「文档级 generation」。** `HanaDocumentContext.generation` 被写死为 `1`（A7），且只存在于绑定 Preview 面。
6. **没有跨宿主重启的 viewState 恢复。** 契约明说流内卡恢复「**不跨宿主重启**」（`APPS.md:2447`）。
7. **没有「cardInstanceId 活/死」的直接查询。** `cardInstanceId` 是配对 id，非访问凭证（`APPS.md:986`）；没有 `isAlive(cardInstanceId)` 之类接口。

---

## 3. 若必须新增，最小契约形状（3-5 条建议）

按「侵入从小到大」排，任一条落地都能让孤儿 owner 被权威识别。

1. **把「文档身份」从内部提升为公开只读字段（最小）。**
   在 `hana.surface.getContext()` 的加性字段里增加宿主盖章的 `documentNonce`（或叫 `surfaceInstanceId`），语义照抄 chrome 私有握手的现成定义：**每次文档装载 / 脚本运行唯一，同一文档桥重绑（搬窗、停靠）保持不变，真 reload 必变**（现成语义见 `_ui-protocol.d.ts:333-345`）。宿主只盖章、不授权。这样 App 把 owner 记录写成「卡 id + 本代 documentNonce」，新一代启动读到旧 documentNonce 即知「不是我这一代」。
   *依据*：语义已存在（`documentNonce`），只是未公开。

2. **公开一个只读的「本 App 装载代」（后端侧）。**
   给 `ctx` 增加 `ctx.runtime.generation`（或 `ctx.app.loadGeneration`），宿主每次 load / reload 递增，App 在写 owner 时记下本代 id；同时让 `ctx.surfaces.listCardChromeViews()` 的每个 view 带上同一代字段。
   *依据*：内部已有 `appGeneration` / `currentGeneration(appId)` / `getAppRuntimeId(appId)`（C1、C2），语义就是「generation currently loaded」，只差一次公开。

3. **让 `listCardChromeViews()` 的「不在列表」变成有终态的 `ended`（而非 unknown）。**
   宿主对「已注册但已拆的文档」做**终态记账**（而不是只列当前活表），回包对每个句柄给 `{ state: 'live' | 'ended' }`，并对跨代 `viewHandle` 直接答 `ended`。这样后端可以在写 owner 前先问「这个 owner 对应的 view 是否 ended」，据此判定孤儿。
   *依据*：契约现在把「不在列表」判为 unknown（`APPS.md:2297`），把它升级成 ended 是纯语义补强，不新增权限面。

4. **把 `app-static-ui-access` 的「每 Host runtime 一个 run 目录」形状变成可查询的租约状态。**
   暴露一个 `{ released: true | false | unknown }` 的租约查询：App 带自己记录的旧 `leaseId` / surface `sessionId` 询问，宿主对**跨代 / 已释放 / 内存表里不存在**的租约直接答 `released`（因为 live leases 是内存态，重启后必然不存在，C5、C6）。
   *依据*：run 目录「Each Host runtime owns its run directory」+「live leases are memory-only」已给出正确的失效模型（`bundle/cli.js:4303`），只差一个查询口。

5. **把 `hana.viewState` 的「暂停」与「已死」分开（兜底）。**
   让 `viewState.available === false`（或 `VIEW_STATE_VIEW_STALE`）在**旧文档已被销毁**时稳定为 `false`/stale，并明确承诺「同 bindingId 复活不会发生」；当前契约刻意让「暂停」保留句柄（`APPS.md:2441`、`:2446`），与「文档已死」混在一起，无法区分。
   *依据*：`available` 现在被定义为「temporarily usable here, not a grant」（`_ui-protocol.d.ts:980-989`）。

---

## 4. 未核实项（照实标注）

- **全部条目均为静态核对，未实测**：本轮的「跨 reload 稳定」「能否区分」判断全部来自契约文本与源码静态推理，未在真机宿主上跑过一次 reload / 重启观测。
- **A5（chrome 文档握手）的 App 可见性未实测**：`documentNonce` / view token 我只在 `app-sdk/dist/*.d.ts` 与宿主 bundle 见到；**未在 renderer 找到「把 view token 推给 iframe」的明确路径**，也没找到 App 侧读取它的公开成员。需实测确认它是完全内部，还是有部分泄漏到 App。
- **C4（`viewEpoch`）的生成来源未完全追到**：`viewEpoch = z$(scope, generation)`（`ChatTranscript-CLxbpBJm.js:@431658`），其中 `generation` 的赋值点未逐一回溯；**它是否随宿主重启改变未核实**。
- **C6（surface lease）重启清理路径未读到显式代码**：live leases 是内存态（`bundle/cli.js:4303`），逻辑上重启后旧 `leaseId` 必失效，但**未读到重启路径里对旧 lease 的显式判废代码**，属推断。
- **B4 是否含「App 装载代」未核实**：`ctx.runtime.list()/get()` 回包字段未逐字段核对，只确认了 `runtimeId` 的「受管服务代」语义（`APPS.md:2842-2898`）。
- **是否存在未文档化的公开 RPC 暴露 `appRuntimeId` / `appGeneration`**：`AppHostMethod` 枚举（`app-host-entry.js:7-93`）里没有，但 renderer↔host 的其它通道（如 `ui:app-card-chrome` 这类 `ui:*` 域）**未穷举**，不能 100% 排除。
- **renderer 压缩文件的行号无意义**：`assets/ChatTranscript-CLxbpBJm.js` 单行约 25 KB，本文对它的引用一律给**字节偏移 `@N`**，换算出的行号不具区分度。

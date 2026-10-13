# 03 · 宿主服务端内部已有钩子 → 最小公开接口提案

> 执行：哦鲸鲸（并行探查分身）。日期：2026-10-13。**只读**：未改任何生产代码 / 测试 / manifest / 版本 / 构建号 / app-data，未部署、未 reload。
> 唯一写入：本文件。
> 来源：`~/.hanako/artifacts/server/1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133/`
> 　- `bundle/index.js`（320570 行，可读非压缩）
> 　- `app-host-entry.js`（4728 行）
> 　- `APPS.md`（2266–2299 卡 chrome、2842–2950 runtime/surfaces）
> 证据等级：**源码静态核对**（逐行 grep -n + 摘录）。凡未实测处单列于 §末。

---

## 0. 一句话结论

**宿主内部已经有四套「UI 文档/视图」生命周期台账**（`MIr` surface lease、`QIr` static-UI 快照、card-chrome 视图表 `i`、`YHe` 媒体代栅栏），它们都能回答「这个句柄**现在**还活不活」，但**都不留墓碑**：撤销后只剩一个布尔假值，`revoked` 与 `unknown` 在查询侧无法区分，`ended` 只存在于宿主 teardown 那一刻的动作里（`closeEntry` / `disconnect` / `release`）且不通知 App。

所以最小改动的落点不是「新造一个启动代」，而是**给已有的撤销路径补一条每文档墓碑，并挂在已有的 `ctx.surfaces`（card-chrome 门）上暴露只读查询**；`documentId` 复用宿主已铸、App 已能读到的 `viewHandle`/`cardInstanceId`，不必新铸身份。区分 `ended` 与 `unknown` 是这件事的**全部意义**：`unknown` 不能授权清 owner（活文档可能只是暂时不可见），只有宿主亲历的销毁才够。

---

## 1. surface lease 注册表（`class MIr`，bundle 56417）

### 1.1 结构

| 行 | 事实 |
|---|---|
| 56417 | `class MIr {` |
| 56418 | `leases = new Map()` —— **view lease 表**（内存） |
| 56419 | `serviceLeases = new Map()` —— **service lease 表**（内存，独立一张） |
| 56420 | `serviceRevocationListeners = new Map()` |
| 56425 | `staticLeasePort;` —— 注释原文：`Dropped on dispose so a closed registry never keeps minting answers for aul_ leases.` |
| 56426 | `constructor(e = Date.now, r = 2048, n = 2048, s = null)` → `(now, limit, serviceLimit, staticLeasePort)` |
| 56519–56521 | `dispose()`：`this.staticLeasePort = null, this.leases.clear(), this.serviceLeases.clear(), ...` |

**实例化点**：`256224` `B = new MIr(Date.now, 2048, 2048, j)`，其中 `j = new QIr({...})`（`256216`），随后 `256723` 作为 `appSurfaceLeases: B` 注入服务端组合根。

### 1.2 三个方法语义（原文摘录）

```js
56429  create(e, r) {
56430    if (typeof e != "string" || !e.trim() || !Number.isFinite(r) || r <= 0)
56431      throw new Error("App surface lease requires an App and a positive lifetime.");
56432    const n = this.now();
56433    for (const [i, o] of this.leases) o.expiresAt <= n && this.leases.delete(i);   // 惰性清过期
56434    if (this.leases.size >= this.limit)
56435      throw ... { code: "APP_SURFACE_LEASE_LIMIT" };
56436    const s = nn();                                                                 // ← randomUUID
56437    return this.leases.set(s, { appId: e, expiresAt: n + r }), s;
56438  }
56439  isActive(e, r) {
56440    if (Q6(r))
56441      return this.staticLeasePort ? this.staticLeasePort.isActive(e, r) : !1;        // aul_ → 委派 QIr
56442    const n = this.leases.get(r);
56443    return n ? n.expiresAt <= this.now() ? (this.leases.delete(r), !1) : n.appId === e : !1;
56444  }
56445  revoke(e, r) {
56446    return Q6(r) ? this.staticLeasePort ? this.staticLeasePort.revoke(e, r) : !1
56446                 : this.leases.get(r)?.appId !== e ? !1 : this.leases.delete(r);
56447  }
```

- **lease 是内存还是持久化**：`MIr` 的 `leases` / `serviceLeases` 全是**内存 Map**，`dispose()` 清空；**无落盘、无跨重启恢复**。（持久化的是 `QIr` 的**快照字节**，见 §1.5，不是 lease 本身。）
- **TTL**：`create(e, r)` 的 `r` 由调用方给。唯一调用点 `55996`：`f = { appId: g, leaseId: s.create(g, uW) }`，`uW = 720 * 60 * 1e3`（`55099`）= **12 小时**。service lease 用 `K5 = 720*60*1e3`（`55099`，同为 12h）。static UI lease 用 `ZIr()` 默认 `obe = 720*60*1e3`（`56966`）。
- **lease id 形状**：view lease = **裸 UUID**（`nn()`，`nn` 即 `node:crypto.randomUUID`，见 `index.js:5` import）；static UI lease = `aul_<uuid>`（`55022` 正则 `rIr`，`55023` `function Q6(t)`）；service lease = `sal_<uuid>`（`56472`）。
- **`staticLeasePort` 是什么**：是 `class QIr`（`56967`）的实例，即 **App 静态 `ui/` 快照访问管理器**（"Static UI access"）。`MIr` 把 `aul_` 前缀的 lease 整体转交给它——`isActive`/`revoke` 都对 `aul_` 委派。这解释了 `dispose` 里那句注释：注册表关闭后不能再替 `aul_` lease 作答。
- **「revoked」与「unknown」能否区分**：**不能**。
  - `isActive` 只返回布尔：revoked / expired / 从未存在 / 不属于该 App → **全是 `false`**。
  - `revoke` 返回布尔：`true` = 撤销时它确实在且属于该 App；`false` = 不在或不属于。**只有 revoke 那一刻**能区分「本来就在」vs「本来就不在」；之后无任何痕迹（`leases.delete` 即抹除）。
  - 全文件只有一处命名 split：`uCe`（`55136`）抛 `app_surface_session_expired`（token 到期，`55167`）vs `app_surface_session_revoked`（lease 不活，`55171-55174`），而后者文案是 `"app surface view is closed or has been replaced"` —— **把「被撤销 / 被换代 / 从未存在」压成一个 code**。
  - 结论：**不是「App 拿不到」，是宿主自己也没留。** 当前语义就是「not active」，天然是 `unknown` 形状，不是 `ended`。
- **是否覆盖 App 的静态 `ui/` 文档（不只托管服务）**：**是**。三条互斥路径：
  1. static `ui/` 快照文档 → `QIr`（`aul_`），经 `staticLeasePort` 委派；
  2. 非快照 leased 视图会话 → `MIr.leases`（`s.create(g, uW)`，`55996`）；
  3. 托管服务 → `MIr.serviceLeases`（`createServiceLease`，`56455`，与 view lease **分表**）。
  另注：静态 UI **文档**实际走的正是第 1 条——App 卡/窗口的 iframe 一律用 `{routeUrl, leased:!0, snapshot:!0}` 取票（见 §1.5 调用点）。

### 1.3 铸票入口（谁在 create）

`POST /apps/iframe-ticket`（`e.post("/apps/iframe-ticket", ...)`，`55865`）：

```js
55963        const I = await o.issue({ appId: g, issuer: w });      // snapshot:true → QIr 铸 aul_ lease
55996      m?.leased === !0 && (f = { appId: g, leaseId: s.create(g, uW) });   // 非快照 leased → MIr 铸
```

### 1.4 撤销入口

| 行 | 路径 | 做什么 |
|---|---|---|
| 56023 | `POST /apps/:appId/ui-sessions/release` | 验签 `cIr(...)` 后 `o.revoke(f, m.leaseId)` —— **只撤 static UI lease（要求 `aul_`）** |
| 56048 | `DELETE /apps/:appId/surface-leases/:leaseId` | host-only；`s.revoke(f,h)` 与 `s.revokeService(f,h)` 同时试，返回 `{ revoked: p || m }` |

### 1.5 `QIr`（`staticLeasePort`）关键点

| 行 | 事实 |
|---|---|
| 56967 | `class QIr {` |
| 56976 | `leases = new Map()` —— static lease 也**只在内存** |
| 56995 | `async issue(e)` → `aul_${nn()}`（`57015`），`expiresAt = now + ttlMs` |
| 57025/57028 | `isActive` / `revoke`（布尔，同 MIr 语义） |
| 57032 | `acquireFile(appId, leaseId, relPath)` —— 供 `56163` 服务文件 |
| 57080 | `liveLease()`：`closed` / 过期 / `entry.phase !== "ready"` / issuer 失活 / **target 换代（`!X7(i, n.entry.target)`）** → 一律 `null` |
| 57126 | `closeEntry(e)`：`e.controller.abort()`；**删掉指向该 entry 的所有 lease**；等 reader 排空；`snapshot.dispose()` |
| 57173 | `initializeStorage()`：建 `~/.hanako/.cache/app-ui-snapshots/run-${process.pid}-${s}`（`57180`，`s = nn()`），写 `owner.json = {schemaVersion:1, pid, nonce:s}` |
| 57207 | `sweepOrphans()`：扫 `run-<pid>-<nonce>` 目录，**pid 已死且 nonce 匹配 ⇒ 整个目录删掉** |
| 57183 | 定时器：`!o.readers.size && (!a || !X7(a, o.target)) && closeEntry(o)` —— **App 换代即关 entry** |

→ **两个「宿主亲历的销毁」事实在这里**：① `closeEntry`（换代/回收时，abort 所有 reader）；② `sweepOrphans`（新 server 启动时，上一代 run 目录整棵删）。它们**语义上就是「这一代文档全部终止」的栅栏**，但都在宿主内部，不通知 App。

---

## 2. App UI 资源授权：`app_surface_session_revoked` 与 `ui-sessions/release`

### 2.1 「The App UI access was revoked」在哪条路径上

`56163`，位于 `GET/HEAD /apps/:appId/ui/*` 的处理器 `u(d)`（`56086` 起，`56171` 挂载 `e.get("/apps/:appId/ui/*", u(!1))`、`e.on("HEAD", ...)`）。上下文（`56143`–`56163`）：

```js
56143        if (YY(g.sessionToken) === yC)          // yC = 2 → 这是 service-view 会话
56144          GY({ ... });                          // 走 service lease 校验
56145        else {
56146          const _ = uCe({ hanakoHome: r.hanakoHome, appId: h, token: g.sessionToken, leases: s });
56149          Q6(_.leaseId) && (y = _.leaseId);      // 只有 aul_ 才当 static UI lease
56150        }
56153        return Tn(f, I, "app UI surface session invalid", A);
56159    if (y) {
56162        const _ = o.acquireFile(h, y, w);
56163        return _ ? await pIr(f, { access: _, ... })
56163                 : o.isActive(h, y) ? _E(f)
56163                 : Tn(f, 403, "The App UI access was revoked", "app_surface_session_revoked");
```

判定链：**静态 UI 文件服务路径**（`/api/apps/<appId>/ui/*`）上，当会话 token 携带的 `aul_` lease 既 `acquireFile` 不出文件、又 `isActive` 为假时 → 403 `app_surface_session_revoked`。

- `uCe`（`55136`）本身也在 `55171-55174` 抛同一 code：token 里带 `leaseId` 但 `leases.isActive` 为假时 → `"app surface view is closed or has been replaced"`。
- 也就是说这条 code 覆盖「被 revoke / 被换代 / entry 关掉 / 从未铸过」四种情况，**不区分**。

### 2.2 `ui-sessions/release` 做什么

| 行 | 事实 |
|---|---|
| 55090 | `Pbt(t)` = `/api/apps/${encodeURIComponent(t)}/ui-sessions/release` |
| 55094 | `xbt(t)`：只接受 `{released: boolean}` |
| 56023 | 路由 handler：body 只允许 `{token}`；`cIr({hanakoHome, appId, token})` 验签并**强制要求 `Q6(a.leaseId)`（必须是 `aul_`）**（`55185`，其中 `55232` 检查）；成功 → `d.json({ released: o.revoke(f, m.leaseId) })` |
| 51671 | 权限表：`POST /api/apps/<appId>/ui-sessions/release` 归 `Fb` scope（页面自持 token 可自释放） |

调用方（`bundle` 内宿主侧）：`252366` 的 App 窗口/surface 取票后用 `Pbt(N.appId)` + `xbt(W)` 释放；`250350` 的 instance surface 同样。**即：宿主在摘掉 iframe 时会主动 `release`，这是一次明确的「该文档结束」动作——但结果只回 `{released:bool}` 给宿主自己，App 侧看不到。**

---

## 3. 卡 chrome 桥（`Bb = ut("app-card-chrome")`，74588）

### 3.1 消息与常量

| 行 | 值 |
|---|---|
| 74588 | `const Bb = ut("app-card-chrome"), oNr = 128, aNr = p0t, cNr = 256, lNr = 15e3, uNr = 128` |
| 70565 | `d0t="app_card_chrome_view_register"`、`aU=..._result`、`f0t="app_card_chrome_view_unregister"`、`rce=..._result`、`Bbe="app_chrome_set"`、`qbe="app_chrome_get"`、`xre="app_card_chrome_result"`、`h0t="ui:app-card-chrome"`、`uRr = Object.freeze([d0t, f0t, xre])` |

### 3.2 视图表形状与生命周期（工厂 `hNr(t)`，74641）

- `74642` `const i = new Map(), o = new Map()` —— **`i` = 视图表**，key = `viewHandle`；**`o` = 待回执表**，key = `requestId`。
- 表项（注册成功时写入，`75052`–`75064`）：

```js
    const xe = Fr.randomUUID(), He = {
      viewHandle: xe, clientId, socket, principalId, owner, deviceId,
      clientKind, scopeKey, profileId, cardInstanceId, appId, appRuntimeId,
      fingerprint: We, origin: ye, message: ve, serviceView: ze,
      viewEpoch: Ee.value, epochKey: Ee.key
    };
```

- 生命周期：`register`（`W`/`M`，`74933`/`74936`）写入 → 每次 `list/get/set` 都用 `T(ce)`（`74815`）重验（client 身份、owner/studio、profile/device、卡绑定、App runtime、service generation）→ 失效则 `i.delete` → `unregister`（`z`，`75069`）或 `disconnect` 删除。

### 3.3 断连语义（`RESULT_DISCONNECTED`）

```js
74683  function p(Y) {              // 按 clientId 清视图 + 待回执置 RESULT_UNKNOWN
74684    for (const [Q, ie] of [...i])
74685      ie.clientId === Y && (m(Q, vr("RESULT_UNKNOWN", "...released before this chrome set was answered")), i.delete(Q));
74686  }
74691  function g(Y) {              // 按 clientId 把待回执置 RESULT_DISCONNECTED
74692    for (const [Q, ie] of [...o])
74693      ie.clientId === Y && y(Q, vr("RESULT_DISCONNECTED", "the UI client disconnected before answering this chrome request"));
74694  }
75248  function J(Y) {              // ← disconnect(socket)
75249    const Q = h(Y);            // socket → clientId
75250    Q && (g(Q), p(Q));         // 先 RESULT_DISCONNECTED，再清视图
75251  }
```

调用点：`78480` WebSocket 客户端断开处 `ge.disconnect(Ue)`（`ge` = 桥，`76912` 构造）。

**关键**：断连是宿主**亲历**的销毁事件，会**立即从视图表删除**该 client 的全部视图。但**App 侧只看到「列表里少了一条」**，拿不到「disconnect 发生了」这个事实。

### 3.4 `listCardChromeViews` 宿主侧实现（`trn`，130982；表查询 `j`，75085）

```js
75085  function j(Y) {                                    // listForApp(authority)
75087    const Q = F(Y);                                  // 校验 {appId, runtimeId}
75088    if (Am(Q)) return Q;
75091    for (const [ge, ce] of [...i]) {
75092      if (ce.appId !== Q.appId || ce.appRuntimeId !== Q.runtimeId) continue;
75093      const Ie = T(ce);                              // 逐条重验
75095      if (Ie !== null) {
75096        C(Ie) && (m(...RESULT_UNKNOWN), i.delete(ge));  // 确定性失效 → 删
75098        continue;                                     // 非确定性失效 → 跳过但不删
75100      ie.push(N(ce));
75101    }
75102    return { ok: !0, views: ie };
75103  }
74904  function N(Y) { return { viewHandle, cardInstanceId, cardId, definitionId, appId }; }   // 返回字段
```

- **返回字段**：`{ viewHandle, cardInstanceId, cardId, definitionId, appId }`（`N`，`74904`；`cardId` 是 App 声明的卡 id，`definitionId` 是通用渲染器定义）。
- **何时返回空**：`{ok:true, views:[]}` —— ① App 没有 runtime（逐条 `T()` 返回 `APP_RUNTIME_UNAVAILABLE`，属确定性失效 → 全删）；② 全部视图被确定性失效；③ 从未注册过。App 侧 `trn.listCardChromeViews`（`131024`）另有前置 `n()`（`130985`）：`!t.isCurrent()`（**App 装载代已换代**）→ 抛 `APP_CARD_CHROME_STALE`；无 `appId/runtimeId` → 抛 `APP_CARD_CHROME_UNAVAILABLE`。与 APPS.md 2266–2299 一致（App 未加载时返回空列表）。
- App 侧校验器 `Qtn`（`130955`）只接受上述字段集（`Gtn`，`130907`），未知字段一律 `null` → `APP_CARD_CHROME_BRIDGE_ERROR`。

---

## 4. App 装载代与媒体栅栏

### 4.1 `taskLifecycleGenerations`（`149734`）

```js
149733  /** A lifecycle generation prevents a delayed start or crash restart from
149734   * recreating an App after a disable, uninstall, or root shutdown. */
149735  taskLifecycleGenerations = new Map();
149918  beginTaskLifecycle(e) {
149919    const r = (this.taskLifecycleGenerations.get(e) ?? 0) + 1;
149920    return this.taskLifecycleGenerations.set(e, r), r;
149921  }
149938  bindingIsCurrent(e) {
149939    return !this.disposed && !e.disposed && this.taskBindings.get(e.appId) === e
149940        && this.taskLifecycleGenerations.get(e.appId) === e.generation;
149941  }
```

- 管什么：**App 后端进程/任务绑定**的代。每次 `runApproved`（`150481`）`beginTaskLifecycle(r.id)` 递增；`reloadBuiltin`（`150317`）、user load（`150266`）都递增。
- 覆盖「前端媒体文档」？**不覆盖**。它只判「这个 App 的 task binding 还是不是当代」，与 renderer/iframe 无关。
- 暴露给 App？**否**。App 侧只在 `trn` 的 `isCurrent` 闭包（`142691`）里被用来判 stale，**读不到代值**；`appGeneration: i`（`150590`）只随 `ctx` 传给宿主内部 facade。

### 4.2 `appReloadGates`（`class YHe`，142981）

```js
142981  class YHe {
142982    active = new Map();
142983    reloadingGeneration = null;
142985    interruptedGenerations = new Set();
142986    currentGeneration = null;
142994-142998  begin(e, r)  → 非当代/正在 reload → APP_MEDIA_RELOADING
143021-143026  beginReload(e, r) → APP_RELOAD_IN_PROGRESS / APP_RELOAD_BUSY
143032  admitGeneration / 143035 retireGeneration / 143038 markInterrupted / 143042 canCommitResult
```

- 一个 App 一条（`One gate per App id spans old and replacement bindings.`，`149736`）。
- 与 `beginAppAdapterReload`（**媒体 runtime 上的方法**，`238560`）配对：后者是 `_store.listPending()` 里 **App 媒体适配器任务**的排队/中断（`adapterId`、`taskId`、`interruptSubmissions`、`settle`、`resume`、`fail`）。
- 覆盖「前端媒体文档」？**不覆盖**。它管的是 **App 后端经 `ctx.media.registerAdapter` 注册的媒体适配器任务**（服务端媒体投递），与前端 iframe/renderer 无关。
- 暴露给 App？**否**。App 只能从 `ctx.media` 拿到自己的 adapter 操作，拿不到 reload gate 的代值或错误码（`APP_MEDIA_RELOADING` 只在宿主内部被吞掉，见 `236413` `if (o?.code === "APP_MEDIA_RELOADING") return Promise.resolve();`）。

---

## 5. App host RPC 面（`app-host-entry.js`）

### 5.1 `AppHostMethod`（`7`–`89`）里有没有「UI 文档 / 视图 / 连接」生命周期方法

**没有。** 全枚举（节选相关项）：

```js
7    var AppHostMethod = {
8      Bootstrap: "bootstrap", AppDomainCall: "app.domain.call", Logger: "logger",
       ToolsRegister/List/ListOwn/Dispose, CommandsRegister/..., ShortcutsRegister/...,
       MessageRenderersRegister/..., BusEmit/Subscribe/Unsubscribe/Handle/Request/...,
       ConfigGet/GetAll/Set/SetMany/GetSchema/GetState/ForkSession/DiscardSession,
       InputStatusSet/Remove, InputBannerSet/Dismiss, LaunchArgsGet/GetAll,
       HooksOnDecision/On/Dispose, NetworkFetch/FetchAbort,
       UserAsk/UserShow/UserDismiss/UserUpdatePanel, RoutesUnregister,
       StorageGet/GetAll/Set/Delete/Keys,
       ResourcesInvoke/Watch/WatchDispose,
65     DocumentsInvoke: "documents.invoke",
66     AppEventsEmit: "appEvents.emit",
67     MediaRegisterAdapter: "media.registerAdapter",
68     MediaUnregisterAdapter: "media.unregisterAdapter",
69     MediaRegisterCapabilitySource: "media.registerCapabilitySource",
70     MediaUnregisterCapabilitySource: "media.unregisterCapabilitySource",
       TasksHandlerRegister/Dispose, ProvidersRegister/Unregister/OperationInvoke/PromptCancel,
       Callback*（含 CallbackMediaAdapterInvoke）...
```

- `MediaRegisterAdapter`（`4455` `registerAdapter` → `4460` RPC）只注册**媒体适配器**（`handleId/adapterId/descriptor`），与「文档/视图/连接」无关。
- `DocumentsInvoke`（`4426`–`4444`）只有 `read` / `readRelated` / `writeExpectedVersion` / `requestView` —— **请求查看一个文档**，不是文档生命周期事件。
- `AppEventsEmit`（`4320`）只是 App → 宿主 emit 事件。
- 视图相关全部走 **`app.domain.call`**（`AppHostMethod.AppDomainCall`）的 `surfaces` 域（`APP_SURFACE_METHODS`，`532`–`537`）：

```js
531  var APP_MANAGED_SURFACE_METHODS = Object.freeze(["open","openHost","get","move","close","workspace"]);
532  var APP_SURFACE_METHODS = Object.freeze([...APP_MANAGED_SURFACE_METHODS,
534    "listCardChromeViews", "getCardChromeView", "setCardChrome"]);
4093  const surfaces = domain("surfaces", APP_SURFACE_METHODS);
```

宿主侧路由：`137134` `t.handle(Ar.AppDomainCall, ...)` → `e[domain][method](...)`，`e.surfaces` 直连 `trn` 门（`142685`）。**这是 App 后端能触达「卡 chrome 视图」的唯一公开面，没有文档/连接生命周期方法。**

### 5.2 bootstrap 载荷里有没有每启动唯一的值

**没有。** 宿主 → 子进程的 bootstrap（`138092`–`138099`）：

```js
    const w = { pluginId, pluginName, entryPath, installDir, dataDir, hanakoHome, network };
```

子进程 handler（`4659`）读的是 `bootstrap.pluginId / pluginName / dataDir / entryPath / installDir`。**无 pid、无 nonce、无启动时间、无 epoch。**

---

## 6. 有没有「每启动唯一且 App 可读」的标识

| 候选 | 生成点 | 跨重启 | App 可读？ |
|---|---|---|---|
| `server-node.json.serverId` / `serverNodeId` | `58171-58172`、`58327`（seed 一次） | **稳定**（本机 `createdAt 2026-09-08`） | 公开契约里**无**入口 |
| `server-info.json` | `257000`–`257031`（server 启动末尾写） | 每启动重写 | 仅文件；**非公开契约** |
| ↳ `pid` / `ownerPid` | 同上 | **变** | 同上 |
| ↳ `token` | `256124` `h = process.env.HANA_TOKEN \|\| randomBytes(16).toString("hex")` | **变**（每启动随机） | 同上，且是**bearer 秘密**，不宜给 App |
| ↳ `serverId/serverNodeId/studioId/userId` | `M.getRuntimeContext()` | **稳定** | — |
| `data-epoch.json.epoch` | 数据纪元（迁移用） | **不随启动变** | 公开层无 |
| `QIr` run-dir nonce（`run-<pid>-<nonce>`，`57180`） | 每次 server 启动 `initializeStorage()`（`57173`） | **变** | **否**（宿主私有缓存目录） |
| app-host-entry 暂存名 `app-host-entry.<pid>-<rand6>.mjs`（`136764`） | 源码模式构建 | 变 | 否（且生产不用） |
| `viewHandle`（`Fr.randomUUID()`，`75052`） | 每次 register | 每视图唯一 | **是**（经 `listCardChromeViews`） |

**核实结论**：`serverId`/`serverNodeId` 确实稳定；但「只有 pid 变」**不准确**——`server-info.json` 里的 **`token` 也是每次启动新随机**。不过 `token` 是宿主 bearer 凭据，不是可公开的启动代，且 `server-info.json` 本身不在公开契约上。**公开契约里仍然没有任何「每启动唯一且 App 可读」的值。**（唯一 App 可读的 per-instance 值是 `viewHandle`，但它是**每视图**唯一，不是每启动唯一。）

---

## 7. 「能否区分 ended / unknown」判定

**当前不能。** 三条独立证据：

1. **查询侧无墓碑**：`MIr.isActive`（`56439`）与 `QIr.isActive`（`57025`）都返回布尔，revoked / expired / 从未存在 / 换代 → 全 `false`；`revoke` 的布尔只在调用那一刻有效（`56445`/`57028`）。
2. **错误码合并**：唯一一处命名 split（`uCe`，`55167` vs `55171`）里，`app_surface_session_revoked` 的文案自述 `"closed or has been replaced"`，把 revoke / 换代 / 未存在合并。
3. **App 可见信号全是 `unknown` 形状**：`listCardChromeViews` 空列表（§3.4）、句柄失效、`VIEW_UNKNOWN`/`VIEW_STALE`/`APP_RUNTIME_UNAVAILABLE`（`74815` `T`）——**没有任何一个能推 `ended`**；socket 断开（`RESULT_DISCONNECTED`，`74691`）虽是宿主亲历的销毁，但只回给**待回执的 chrome 请求**，不落成文档状态，App 查不到。

**宿主内部确实存在「亲历的销毁」三个动作**，它们是 `ended` 的唯一可靠来源，但都没落成可查状态：
- `QIr.closeEntry`（`57126`）：换代/回收 → abort 所有 reader、删掉该 entry 的全部 lease。
- `QIr.sweepOrphans`（`57207`）：新 server 启动 → 上一代 `run-*` 目录整棵删除（**这是「上一代所有静态 UI 文档已终止」的现成栅栏**）。
- `hNr.disconnect`（`75248`）+ `ui-sessions/release`（`56023`）：client 断开 / 宿主主动释放 iframe。

**为什么必须区分 ended 与 unknown**：`unknown`（断线、超时、句柄失效、列表为空）**不足以授权清 owner**——活着的媒体文档可能只是暂时不可见（App 重载中、桥重绑、client 重连、chrome 未注册）。把 `unknown` 当 `ended` 会误抢活文档的音频（Codex §2 的两个反例）。只有「宿主亲历销毁」才证明该文档不会再产生媒体。两者压成一个布尔，App 就只能保守待命 —— 这正是 1.1.1 孤儿 owner 死锁的根因。

---

## 8. 最小接口提案（含落点）

### 8.1 `documentId` 用什么（不新铸身份）

复用宿主**已经铸造、App 已经能读到**的 `viewHandle`（`75052`，`Fr.randomUUID()`，不含凭据，经 `listCardChromeViews` 可见，且与 `cardInstanceId` 绑定）。对未注册 chrome 的媒体 iframe，退而用 **`cardInstanceId + appId`** 组合（`cardInstanceId` 由 `hana.surface.getContext()` 已可得）。

> 若必须覆盖「不注册 chrome 的 iframe」，则需要在 `QIr.issue`（`56995`）把 `aul_` lease 与 `cardInstanceId` 建立映射——这是本提案唯一的**新增内部表**，代价可控（一次 Map 写入）。

### 8.2 最省改动的落点（三选一，按代价递增）

**落点 A（最省，覆盖卡 chrome 视图）——扩 card-chrome 桥**
- 内部：在 `MIr` 加墓碑表 `revoked = new Map()`（`leaseId → {appId, at}`），在 `revoke`（`56445`）与 `QIr.closeEntry`（`57126`，删 lease 处）写入；`hNr` 的 `disconnect`（`75248`）处为被删视图写墓碑。
- 公开：在 `trn`（`130982`）与 `APP_SURFACE_METHODS`（`app-host-entry.js:532`）各加一个方法（如 `getCardChromeViewLifecycle({viewHandle, cardInstanceId})`），在 `hNr` 的 return（`75259`）加 `lifecycleForApp`，在 `Ie`（`76960`）的 operation 联合加 `"lifecycle"`。
- 返回：`{ ok:true, state: "active" | "ended" | "unknown" }`。`ended` 仅当墓碑存在；**墓碑缺失且句柄不在表 → `unknown`**（关键：不能把「不在表」直接当 ended）。
- 覆盖范围：注册过 chrome 的卡。player 若愿意，可让它注册一个最小 chrome 视图来获得该能力（无需新权限）。

**落点 B（覆盖全部静态 `ui/` 文档）——扩 `QIr` 的 run 代**
- 内部：`QIr` 已有 run nonce（`57180`）。把它作为 **`uiRunId`** 写进一个稳定入口（最小做法：`server-info.json` 加字段 `uiRunId`；更好做法：加一条 `GET /api/apps/ui-run` 或经 `ctx.surfaces` 暴露）。
- 语义：App 记录 owner 时同时记 `uiRunId`；查询时若 `uiRunId` 不同 → **上一代所有静态 UI 文档 `ended`**（由 `sweepOrphans` 的整棵删除背书）。同代内单独摘 iframe 仍需落点 A 的 per-document 墓碑。
- 覆盖范围：snapshot 服务的静态 UI 文档（App 卡/窗口 iframe 走的就是这条，见 `252366`）。**不覆盖**直接从目录服务的文档与托管 service 文档。

**落点 C（补齐托管 service 文档）——`createServiceLease` 的对称墓碑**
- 在 `revokeService`（`56492`）与 `closeEntry` 处同样写墓碑；经 `ctx.surfaces` 暴露同一 `state` 查询。属于落点 A/B 的同构扩展。

**推荐组合**：A + B。A 给同代内的精确 `ended`，B 给跨代/跨重启的整代 `ended`；二者都只**新增只读查询**，不改任何现有写入语义、不新增权限词，符合 APPS.md 2918–2925 那条「作者只通过公开 SDK 使用，不自行拼装宿主私有端点」的纪律。

### 8.3 为什么是这个落点

- card-chrome 门（`trn` + `ui:app-card-chrome` bus，`h0t`）**已经具备**：宿主侧视图表、App 侧 facade、宿主注入 authority（`F(Y)`，`74927`）、稳定 Result 形状（`{ok, code, error}`）、以及「App 只能操作自己的视图」的边界。在这里加一个只读 operation，比新开 bus 主题或新 route 省一个数量级的改动，且天然继承现有授权。
- `QIr` 的 run nonce 是**现成的跨代栅栏**（`sweepOrphans` 已在做「上一代全删」），把它从私有缓存目录提到一个只读入口即可，不需要新增任何生命周期逻辑。

---

## 9. 未核实项

1. **未跑宿主实测**：本报告全部为源码静态核对。`closeEntry`/`sweepOrphans`/`disconnect` 的实际触发时序（与 renderer 真正销毁的先后）未做真机抓取。
2. **未确认 `server-info.json` 是否被 App 的 `ctx.resources` 可读**：AppHost 的 Node Permission Model 只放行安装目录 + App 数据 + 「必要宿主只读资源」，`HANA_HOME` 根文件很可能不在其内；未实测，故 §6 只写「非公开契约」而非「不可读」。
3. **未读桌面端 renderer（`desktop/dist-renderer`）**：iframe 卸载与 `releaseStaticHandle` 的调用时序属宿主桌面侧，本轮只看到 bundle 内宿主侧的取票/释放封装（`252366`、`250350`）。
4. **未确认 player 当前是否注册 card chrome 视图**：落点 A 的适用性取决于此；若否，需走 8.1 的 `cardInstanceId + appId` 变体或先补一个最小 chrome 注册。
5. **`APP_SURFACE_LEASE_LIMIT = 2048`（`56426`）与静态 `maxLeases = 4096`（`56993`）**：上限对「长会话累积墓碑」的影响未评估（若加墓碑表需同时设上界，建议比照 `MIr.create` 的惰性清过期）。

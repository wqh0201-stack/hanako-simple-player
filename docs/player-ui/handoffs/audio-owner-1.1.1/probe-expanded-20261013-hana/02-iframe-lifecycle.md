# 02 · 宿主渲染层如何创建与销毁 App UI 文档（iframe）

只读探查。对象：Hana 1.1.0-beta 桌面 renderer（vite 压缩产物）。
来源目录：`/Users/can/.hanako/artifacts/renderer/1.1.0-beta-darwin-arm64-18abc5bdcfeb1f31-g584188fa0437af92/assets/`
主进程：`/tmp/hana-asar/desktop/*.bundle.cjs`
契约：`/Users/can/.hanako/artifacts/server/1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133/APPS.md`

> 下文所有 `文件@偏移` 指该文件内的字符偏移（indexOf 结果，与探查工具 `ctxscan.mjs` 一致）。

---

## 0. 一句话结论

**渲染层对 App UI 文档没有"交接"这回事**：iframe 由 React 直接挂载/卸载，销毁时渲染层只会做三件事中的一部分——向服务端发一条 **fire-and-forget、无 keepalive** 的释放请求（静态 UI 是 `POST /api/apps/:appId/ui-sessions/release`，托管服务是 `DELETE /api/apps/:appId/surface-leases/:leaseId`）、向 WS 发一条 `app_card_chrome_view_unregister`（仅当已拿到 viewHandle 且 socket 还在）、以及纯本地的 bridge/transport 拆解。**宿主进程退出/硬 reload 时页面直接消失，这些请求来不及发出**（没有 `pagehide`/`beforeunload` 兜底、没有 `sendBeacon`、没有 `keepalive`），持久化在服务端的 owner 记录因此成为孤儿。同一张 App 卡在**主窗口**与**拆窗**里跑的是两份 iframe 文档，且分属**不同的 storage partition**，Web Locks / BroadcastChannel 跨不过去。

---

## 1. 挂载路径

### 1.1 组件与 hook

App UI 表面组件在 `AppUiSurface-DlGvCvLP.js`：

- 组件 `tr({appId, routeUrl, service, slot, title, visible, capabilityGrants, agentId, cardInstanceId, followHostColorScheme})` @40234
- 它调用 hook `ft(k.iframeSrc, {pluginId, agentId, slot, visible, readyOnTimeout:false, capabilityGrants, cardInstanceId?, boundConnectionKey, serviceDocument, envelope, envelopeElement})` @40710
- 渲染 `<iframe ref={x} src={k.iframeSrc||void 0} sandbox="allow-scripts allow-forms allow-popups allow-same-origin" title={n} style={{opacity:u==="ready"?1:0,...Mt(T)}} key={D}>` @41647，sandbox 字面量 @41720

`ft` = ChatTranscript 导出的 `rE`（`AppUiSurface` 顶部 `import{... ar as ft ...}from"./ChatTranscript-CLxbpBJm.js"`；ChatTranscript 导出表 `rE as ar`）。`rE` @731977 → `Wz` @708205（真正的 surface host hook）。`Wz` 渲染 iframe 并把 `postMessage` 桥、chrome、viewState 全挂上。

同一 hook 也被别处复用（`ChatTranscript` 里的 `$Te` 卡片、`CardShell` 里的 `pluginWebViewIframe`），sandbox 属性一致，全部含 `allow-same-origin`。

### 1.2 iframe `src` 的构造

src 由 `XG({connection, routeUrl, agentId, ticket, surfaceSession, uiBasePath, theme})` 生成，@692903：

```js
const a = cc(t);                                   // routeUrl 是否静态 App UI：/^\/api\/apps\/([^/]+)\/ui(?:\/|$)/
const l = a && !!o;                                // 有 uiBasePath（= _surface/<token>/ 前缀）
const d = new URL(l ? JG(e,t,o) : On(e,t,{includeTokenQuery:!a}));
r && !l && d.searchParams.set(a ? "appIframeTicket" : "pluginIframeTicket", r);
!a && s && d.searchParams.set("pluginSurfaceSession", s);
a && s && d.searchParams.set(vC, s);               // vC = "appSurfaceSession"
n && d.searchParams.set("agentId", n);
qG(d, e, a, i);                                    // hana-theme / hana-css / hana-theme-appearance / hana-palette-*
const u = YG(e, t, a?null:s||r||null, s, o);
u && d.searchParams.set("hana-asset-base", u);
```

关键事实：

| 场景 | src 形态 | 凭证携带方式 |
|---|---|---|
| 静态 App UI（现代，有 surface session） | `<baseUrl>/api/apps/<appId>/ui/_surface/<surfaceSession.token>/<relpath>?appSurfaceSession=<token>&hana-theme=...&hana-asset-base=<同前缀>` | **路径段** `_surface/<token>` + query `appSurfaceSession`；**不带** `appIframeTicket`、**不带** `token=` |
| 静态 App UI（无 surface session，legacy） | 同上但路径是普通 `/api/apps/<id>/ui/...` | query `appIframeTicket` |
| 插件 UI | `<baseUrl>/api/plugins/<id>/assets?...` | query `pluginIframeTicket` 或 `pluginSurfaceSession` |
| 托管服务文档 | `<serviceBase><entryPath>`（`Fa()` 在 host-color-scheme @94846） | query `appSurfaceSession`(=`Ws`) + `hana-asset-base` |

- `On` = `index-atMI9TZI.js` 的 `Rc`（@208189）：`` `${Zu(e.baseUrl)}${t}` ``，`includeTokenQuery:true` 且连接有 token 时追加 `token=`。**App surface 一律传 `includeTokenQuery:false`**，所以服务器 bearer 不进 iframe URL，改用 surface session。
- `JG()` @692700：把 routeUrl 中 `/api/apps/<id>/ui/` 之后的相对路径重新挂到 `uiBasePath`（`_surface/<token>/`）之下，原 query 原样搬过去。
- `cc()` / `Ym()` @690800：`qm=/^\/api\/apps\/([^/]+)\/ui(?:\/|$)/` 判定静态 App UI 并取 appId。
- `qG()` @692000：额外 query `hana-theme`、`hana-css`、`hana-theme-appearance`、`hana-palette-light-theme/css`、`hana-palette-dark-theme/css`。

### 1.3 iframe 的创建由谁负责

渲染层只负责 DOM `<iframe>`；**窗口级**承载由主进程负责：

- 主窗口 `Ne`：`new BrowserWindow({... webPreferences:{preload: preload.bundle.cjs, contextIsolation:true, nodeIntegration:false, webviewTag:true, backgroundThrottling:false}})`，**无 `partition`** → 默认 session（main.bundle.cjs @1103000）。
- 拆窗（detached card window）= `WebContentsView`：`new WebContentsView({webPreferences:{preload: app-host-view-preload.bundle.cjs, contextIsolation:true, nodeIntegration:false, sandbox:true, webviewTag:(kind==="workspace"), partition:`app-host-view:${viewId}`}})`（main.bundle.cjs @355963）。
- App 独立窗口：`partition: `app-window:${windowId}``（main.bundle.cjs @323545）。
- App review 窗口：`partition: `app-review:${reviewId}``（main.bundle.cjs @361047）。
- 两者都用 `loadFile(dist-renderer/<name>.html)`（`Aa` @1042100 / `an` @1042359），即 `file://`。

拆窗由渲染层用 `window.open` 发起：`window.open("about:blank", "chalkboard-detached:<id>", features)`（preview-session-tabs-BLQlUevp.js @57464；frame name 前缀 `const $t="chalkboard-detached:"` @55468），主进程在 `setWindowOpenHandler` 里按 frameName 命中后建 `app-host-view` 窗口。

---

## 2. 销毁路径（逐场景）

渲染层有**四个**独立 teardown，谁跑取决于场景：

| 名字 | 位置 | 做什么 |
|---|---|---|
| `lo(session)` | ChatTranscript @736191 | 静态 UI：`POST /api/apps/:appId/ui-sessions/release`，body `{token}` |
| `je()` | host-color-scheme @96xxx | 托管服务：`DELETE /api/apps/:appId/surface-leases/:leaseId` |
| `Le()` | ChatTranscript @714180 附近 | 卡 chrome 视图 teardown：删本地 record、发 unregister、dispose transport |
| `$n()` | ChatTranscript @721xxx | bridge teardown：`postMessage(CONTEXT, null)`、摘 `message` 监听、拒掉在途请求 |

### 2.1 卡片/文档关闭（React unmount）

`Wz` 的桥效应清理返回 `$n`（ChatTranscript @721000 附近）：`ee(null)` 向 iframe 发一条 `hana.app...CONTEXT payload:null`；`Ae.removeEventListener("message", it)`；`clearTimeout`；把未回应的 document 请求全部 reject（`"Document iframe was unmounted before it responded."`）。**注意：它不向 iframe 发任何"你要走了"的消息，也不发 unregister**——iframe 是被 React 直接摘掉的。

卡 chrome 视图 teardown `Le`（@714180 附近）：
```js
const Le = () => { const Y=jt.current; jt.current=null, Y&&P$(Y.scope,Y.generation),
  Wt.current?.dispose(), Wt.current=null, ds.current=null, Q(), fn() };
```
`P$(scope,generation)` @438809 从 `Uo` 表删 scope；`Wt.current.dispose()` = chrome transport `II.dispose()` @701000，仅把在途 chrome action 以 `"unknown"` resolve（**不发消息**）；`Q()` 释放 viewState 句柄。

record 级清理在 `dB` 的 effect 返回（ChatTranscript @457716）：
```js
return en.set(n,P), Ep(P), () => {
  en.get(n)===P && en.delete(n), P.activeRequestId && si(P.activeRequestId),
  P.activeRequestId=null, sB(P), X$()
}
```
`sB(P)` @450252 → 若 `viewHandle` 与 transport 都在，`Xd(transport, {type:"app_card_chrome_view_unregister", requestId, viewHandle, viewEpoch, cardInstanceId})`。

静态 UI 的释放走 `S7` hook 的 effect 清理（ChatTranscript @738822）：
```js
() => { k.cancelled=!0, k.attempt?.controller.abort(), l.current===k&&(l.current=null),
        lo(k.session?.held??null), k.session=null }
```
`lo` 的实现（@736191）：
```js
const r = await fetch(On(t.connection, "/api/apps/<appId>/ui-sessions/release", {includeTokenQuery:false}),
  {method:"POST", headers:{"Content-Type":"application/json"}, credentials:"omit",
   body:JSON.stringify({token:n})});
if(!r.ok) throw ...; y7(await r.json())
// .catch(()=>console.error("[use-plugin-surface-url] Static App UI cleanup failed; the Host will expire the unused access"))
```
**没有 `keepalive`，没有 `sendBeacon`，是纯 fire-and-forget。**

### 2.2 App reload

没有专门的"reload"通道；reload 表现为 **appRuntimeId / runtime snapshot 变化**，进而 memo 变化、effect 重跑：

- 静态 UI：`sE(e,t,n)` @739900 → `S7(conn, routeUrl, slot, runtimeRevision)`；`m` 的依赖含 runtime 快照 `h`。`h` 变 → 旧 effect cleanup 先 `lo(旧 session)`，再 `POST /api/apps/iframe-ticket`（body `{routeUrl, snapshot:true}`）拿新 session/ticket，iframe `src` 换新。旧文档被浏览器导航顶掉。
- 卡 chrome：record 的 effect deps 含 `k`（appRuntimeId）与 `h`（runtime sessionId）等（`dB` @454600 的 dep 列表 `[t,n,r,s,a,l,v,w,I,b,S,C,A,k,h,m,y]`）。appRuntimeId 变 → 旧 record `en.delete` + `sB(P)`（unregister）→ 新 record `en.set` + `Ep(P)`（register）。

### 2.3 拖窗 / 拆窗

- 拆窗：`window.open("about:blank", "chalkboard-detached:<id>", features)`（preview-session-tabs @57464）→ 主进程建 **新 `WebContentsView` 窗口（新 partition `app-host-view:<viewId>`）** → 新窗口加载 `app-host-view.html` → 渲染层在新窗口里**重新挂一份 iframe**，重新走 `POST /api/apps/iframe-ticket`。**不是把旧 iframe 搬过去，是新文档。**
- 停靠回主窗同理，反向再新建。
- 唯一"同文档重绑"的通道是 `rebindDocument`，但它只服务**带文档 binding 的 Preview 表面**（ChatTranscript @675772 / @675941、CardShell @306316），**与 App 卡 chrome/owner 无关**。
- 服务文档的停靠/拆窗：`host-color-scheme` 的 `Ra` 用 `appRuntimeId`+service 状态流驱动，换文档即 `pe()` → `DELETE surface-leases`。

### 2.4 宿主退出 / 硬 reload

**没有任何兜底。** 证据：

- 全 renderer 搜 `keepalive` / `pagehide` / `beforeunload`：只命中**草稿保存**（`Xg({keepalive:true})`，ChatTranscript @85993、@86005）与**黑板布局落盘**（`ka({keepalive:true})`，ChatTranscript @518803、@519049）。**没有一条挂在 surface session release 或 surface-lease 上。**
- `lo()` 的 `fetch` 无 `keepalive`；`ne()`（host-color-scheme @95977）虽有 `AbortController` 但只在 10s（`Pa=1e4`）后 abort，也不保证退出前送达。
- 没有 `navigator.sendBeacon`（全 renderer 0 命中）。

所以宿主重启/reload 时：DOM 直接销毁，React cleanup 不一定跑、跑也来不及把 HTTP 送达 → 服务端 `ui-sessions` / `surface-leases` / App 自管的 owner 记录成孤儿。

### 2.5 socket 断开

WS transport 丢失时，渲染层只做**本地**清账，不发 unregister（socket 已断）：
`J$` @446765 的 lifecycle listener：`for(const t of en.values()) t.transport===e.transport && (t.transport=null, t.activeRequestId=null, t.viewHandle=null, status→"idle")`。
服务端侧的句柄失效是**由断连触发**（APPS.md：「App 重载、视图关闭、socket 断开或凭据撤销都会让旧句柄立刻失效」）。

---

## 3. 注册 / 租约协议字段表

### 3.1 卡 chrome 视图注册（host renderer → server，走 WS）

常量块 @428077：
```
ZF = "app_card_chrome_view_register"
uC = "app_card_chrome_view_register_result"
fC = "app_card_chrome_view_unregister"
pC = "app_card_chrome_view_unregister_result"
hC = "app_chrome_set"   mC = "app_chrome_get"   e$ = "app_card_chrome_result"
clientKind ∈ {"desktop","web","mobile","remote"}   (gC @428383)
```

**发送（register）** `Ep` @449235：
```js
{ type:"app_card_chrome_view_register", requestId, clientKind, scope, cardInstanceId,
  viewEpoch, expectedAppRuntimeId,
  streamRegistryId?,   // 仅非 null
  serviceView?,        // 仅托管服务
  messageSource? }     // 仅已验证的流内卡：{sessionId, toolCallId, entryId?}
```

**接收（register_result）** 校验器 `yC` @430418，允许字段集 `p$ = {type, requestId, ok, viewHandle, clientKind, scope, cardInstanceId, viewEpoch, appId, streamRegistryId, appRuntimeId}`，成功值：
```js
{ requestId, viewHandle, clientKind, scope, cardInstanceId, viewEpoch, appId, appRuntimeId, streamRegistryId? }
```
`viewHandle` 由服务端铸，长度上限 128（`n$`）。失败码含 `REGISTRATION_PENDING` / `REGISTRATION_INVALID`（`oB` @451300）。

**发送（unregister）** `sB` @450252：
```js
{ type:"app_card_chrome_view_unregister", requestId, viewHandle, viewEpoch, cardInstanceId }
```
另有 `Qi` @450463 发的"对账式"unregister（`requestId` 前缀 `wdr`，带 `viewHandle`+`viewEpoch`，用于注册结果与本视图不符时）。

**本地 record**（`en.set(n,P)`，@457601）字段全貌：
```
token(自增), host, pluginId(=appId), cardInstanceId, route, streamRegistryId, clientKind,
scopeKey, scope, generation, viewEpoch, connectionKey, fingerprint, runtimeConnectionKey,
appRuntimeId, serviceView, expectation, messageSource, live,
transport, activeRequestId, viewHandle, status("idle"|"registering"|"registered"|"pending"|"failed"), lastErrorCode
```
唯一性键 `EC` @447851 比对：`connectionKey + clientKind + scopeKey + cardInstanceId + viewEpoch + pluginId(=appId) + appRuntimeId + streamRegistryId`。

### 3.2 `viewEpoch` 的语义

- 生成：`z$(scope, generation)` @446275 = `` `${scope.scopeId}:${generation}` ``。
- `scope.scopeId`：`x$()` @438353，按 **iframeWindow** 用 WeakMap `gv` 发号（`++E$`）——**每个 iframe window（即每份文档）一个新号**。
- `generation`：`R$(scope)` @438722，全局计数器 `++T$`，每次**重新把卡视图绑到文档**（`Xe()` 调 `R$`）就 +1。
- 校验：`l$()` @428760 允许"非负安全整数"或"≤128 字符的非空串"，两种形态都收。
- 拒绝语义：`RC` @452377 —— `if(t!==e.viewEpoch) return n("VIEW_STALE","this chrome request belongs to a previous document epoch")`。

**结论：`viewEpoch` 是「这份卡视图 × 这一代文档」的 token，即 per-(iframeWindow, generation)，等价于"每文档 epoch"。** 换文档（新 iframe window）或同窗重绑（generation+1）都会让它变；旧 epoch 的 chrome 请求被 `APP_CHROME_VIEW_STALE` 拒。

### 3.3 `serviceView`（托管服务）

校验 `f$` @428620，字段集 `u$ = {serviceId, path, appRuntimeId, runtimeId, leaseId}`，四个 id 均"有界、不含 `/`、不含 `\`、无控制字符"（`Bu`）。它是**托管服务 surface** 的身份，静态 `ui/` 文档不带。

---

## 4. surface lease / release

| 触发 | 端点 | 方法 | body / 位置 | 谁调 | keepalive |
|---|---|---|---|---|---|
| 静态 `ui/` 文档销毁 | `/api/apps/:appId/ui-sessions/release` | POST | `{token}` | `lo`（ChatTranscript @736191；URL 由 `g7` @735589 拼） | **无** |
| 托管服务文档销毁 | `/api/apps/:appId/surface-leases/:leaseId` | DELETE | 无 body，headers=`Ft(connection)` | `ne`（host-color-scheme @95977） | 无（10s 后 abort） |

**回答"这是给托管服务 surface 还是也给静态 ui/ 文档"：**
`DELETE surface-leases` **只服务托管服务 surface**。它只在 `Ra`（服务表面 hook）里被调；`Ra` 通过 `POST /api/apps/iframe-ticket` 且 body `{appId, service, leased:true}` 拿 handle（`Re` @96xxx），handle 里带 `surfaceSession.leaseId`。
静态 `ui/` 文档**不用** surface-lease，走 `POST /api/apps/:appId/ui-sessions/release`（`lo`）。两条路径的 token 来源也不同：静态 UI 的 token 来自 `app iframe ticket` 回执的 `surfaceSession.token`（`m7` @735200 校验），lease 来自 `leaseId` 字段。

`surfaceSession` 三个字段（`m7` 校验）：`{token, leaseId, expiresAt}`；`leaseId` 形如 `aul_<uuid>`（正则 `c7` @731xxx）。

---

## 5. 同源与分区判定（对 Web Locks 可用性的结论）

> **⚠️ 勘误（2026-10-13，哦鲸鲸复核）**：本节 §5.2/§5.3 把「拆窗卡片」判为 `WebContentsView` + `partition: app-host-view:<viewId>`，**这是误归因**。`app-host-view:<viewId>` 属于 `sdk.surfaces.openHost` 建的 **host view**（App 自建窗口里嵌 Hana 自身 Chat/Preview 的 WebContentsView），**不是**卡片拖出的独立窗口。
> 卡片拖出窗是 `window.open("about:blank", "chalkboard-detached:…")` 建的 **BrowserWindow**，其 `webPreferences` **没有 `partition`** → **默认 session**（`main.bundle.cjs` @1103390 的 `setWindowOpenHandler`，`hi="chalkboard-detached:"`）。主窗口同样无 `partition` → 默认 session。
> 因此 **卡片 iframe 与拖出窗 iframe 同 session**；叠加二者顶层站点同为 `file://`，Web Locks 实测**共享**。详见 `07-session-partition-finding.md`、`08-weblocks-host-shape-probe.md`。本节下文的分区结论以那两份为准。

### 5.1 同源

- **App 卡 iframe**：src 的 origin = `connection.baseUrl` 的 origin（桌面即 `http://127.0.0.1:<port>`）。sandbox 含 `allow-same-origin`（AppUiSurface @41720、CardShell @307446/@1608348、ChatTranscript @758322/@807301），**不是 opaque origin**。
- **宿主 renderer**（主窗与拆窗）：`file://` 加载 `dist-renderer/*.html`（main.bundle @1042294/@1042359）。
- 所以：App iframe 与宿主 renderer **跨源**；但**两份 App iframe 之间同源**（同一 `http://127.0.0.1:<port>`）。

### 5.2 分区

Electron `webPreferences.partition` 一览（main.bundle.cjs）：

| 承载 | partition | 持久性 |
|---|---|---|
| 主窗口 `Ne` | **无**（默认 session） | 持久 |
| 拆窗卡片 `WebContentsView` | `app-host-view:<viewId>` | 内存态（无 `persist:` 前缀） |
| App 独立窗口 | `app-window:<windowId>` | 内存态 |
| App review | `app-review:<reviewId>` | 内存态 |
| card screenshot 离屏窗 | `card-screenshot-<uuid>` | 内存态 |

iframe 的 storage 归属其**嵌入 WebContents 的 session**。因此：

- 主窗口里的 App 卡 iframe → **默认 session**
- 拆窗里的同一张 App 卡 iframe → **`app-host-view:<viewId>` session**
- 两个不同拆窗 → 两个不同 `app-host-view:*`

### 5.3 结论（Web Locks / BroadcastChannel）

- **同一窗口内的多张卡**：同 origin + 同 session → **Web Locks、BroadcastChannel、localStorage、IndexedDB 全部共享**，可用于跨卡协调。
- **主窗口 ↔ 拆窗**：同 origin，**不同 storage partition** → **Web Locks 与 BroadcastChannel 不共享**（Chromium 的 storage key 含 partition，锁管理器与广播通道都按 storage key 分域）。
- **拆窗 ↔ 拆窗**：同上，不共享。

对音频所有权问题的含义：**不能把"谁持有 owner"的互斥交给 Web Locks / BroadcastChannel**——一旦卡片被拖出成独立窗口，那就是另一套存储分区，锁看不见旧文档的锁，广播也收不到。唯一跨窗口/跨分区可见的事实是**服务端记录**（surface session / lease / App 自管 owner），而渲染层在宿主退出时恰好不保证把释放送达（见 §2.4）。

---

## 6. 未核实项

1. **主窗口是否真的用"默认 session"**：main.bundle 里主窗 `Ne` 的 `webPreferences` 无 `partition` 键，据此判为默认 session；未在运行态实测 `session.fromPartition` 结果。
2. **iframe 的 `src` 实际 origin 是否恒为 `http://127.0.0.1:<port>`**：`Zu(baseUrl)` / `rm(connection)` 的内部实现未展开；若存在自定义 scheme 或反代改写，origin 结论需复核。
3. **App SDK 侧是否在自己的 `pagehide` 里释放 surface session**：本报告只覆盖宿主 renderer 的 bundle；App 自己（如音频 App 的 `@hana/app-sdk/ui`）是否补发释放未查。
4. **服务端对 `ui-sessions` / `surface-leases` 的过期回收窗口**：`expiresAt` 存在，但具体 TTL 与孤儿判定的服务端逻辑未查（APPS.md 只说"Host will expire the unused access"）。
5. **拆窗 `viewId` 是否复用**：`app-host-view:${viewId}` 的 `viewId` 生成/复用策略未展开；若同一卡反复拆/钉会否复用同一 partition，会影响"拆窗后能否看到旧锁"的边缘判断。
6. **`Xd` 走的 WS 具体是哪条连接**：`Xd` @437898 发到 `vn`（`fle` @437327 建的 transport）；这条 WS 与 `preview-session-tabs` 里 `__hanaConsumeFra...` 的 frame-message 通道是否同一条，未逐一比对。
7. **`sB` 的 unregister 在宿主退出时是否可能被 flush**：unregister 走 WS（socket 关闭时自然丢），未发现 `keepalive` 兜底；若 WS 底层有发送队列/退避，可能部分送达，未验证。

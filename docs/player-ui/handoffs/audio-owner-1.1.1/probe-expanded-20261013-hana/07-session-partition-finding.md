# 07 · 会话/分区判定：卡片 iframe 与独立窗口是否同一 storage bucket（哦鲸鲸）

> 日期：2026-10-13。范围：**只读探查**（解包 `app.asar` 静态核对 Electron 主进程），未改任何生产源码/断言/版本/build/app-data，未部署、未 reload。
> 来源：`/Applications/HanaAgent.app/Contents/Resources/app.asar` → `desktop/main.bundle.cjs`（已解出到 `/tmp/hana-asar/desktop/main.bundle.cjs`）。
> 目的：Web Locks / BroadcastChannel 都按 **storage bucket（origin + Electron session/partition）** 作用域。若卡片与独立窗不同分区，两者一起失效；这条决定整个「App 内自愈」路线是否成立。

---

## 0. 结论

**卡片 iframe 与「拖出的独立窗口」用的是同一个 Electron session（默认 session），因此同源 + 同分区 = 同一 storage bucket。**
→ `navigator.locks` 与 `BroadcastChannel` 理论上都能跨「聊天卡片 ↔ 独立窗口」共享。
（**静态核对结论，非真机实测**；真机仍需按 `06`/`04` 的清单验一次。）

---

## 1. 证据链

### 1.1 主窗口：默认 session（无 partition）

主窗口 `Ne` 的创建点（`main.bundle.cjs` @1102000 附近）：

```js
const P = { width, height, minWidth:420, minHeight:500, title:"HanaAgent", ...,
  webPreferences: { preload: <preload.bundle.cjs>, contextIsolation:!0,
                    nodeIntegration:!1, webviewTag:!0, backgroundThrottling:!1 } };
Ne = qe("main", P, { windowsMinimalRetry:!0 });
```

**`webPreferences` 里没有 `partition`** → 走 Electron 默认 session。
聊天里的 App 卡片 iframe（渲染层 `AppUiSurface` 的 `<iframe>`）是主窗口的子文档 → 继承默认 session。

### 1.2 独立窗口（卡片拖出）：也是默认 session

渲染层拖窗调用（`preview-session-tabs-BLQlUevp.js` @57477）：

```js
return window.open("about:blank", o, i);   // o = frameName, i = features(含 hanaDetachedLease)
```

主窗口的 `setWindowOpenHandler` 对 `frameName` 前缀 `chalkboard-detached:` 的分支（@1103390 附近）：

```js
const hi = "chalkboard-detached:";        // 定义点 @1047561
...
if (ut.startsWith(hi) && Ge === "about:blank") {
  ... overrideBrowserWindowOptions: { ..., show:!0,
    webPreferences: { preload: <preload.bundle.cjs>, contextIsolation:!0,
                      nodeIntegration:!1, webviewTag:!0 } }   // ← 同样没有 partition
}
```

→ 独立窗口同样落在**默认 session**。

### 1.3 对照：确实存在「每窗口一 partition」的地方（但都不是本场景）

| 用途 | partition | 说明 |
|---|---|---|
| App 自建原生窗口 `sdk.windows.create` | `app-window:${windowId}` | 每个 App 窗口独立分区，关闭时 `clearStorageData`。**播放器的独立窗口不走这条**（走 manifest `detached.route`，由宿主开） |
| App host view（`sdk.surfaces.openHost`） | `app-host-view:${viewId}` | 是 App 窗口里嵌 Hana 自身 Chat/Preview 的 `WebContentsView`，kind = chat/preview/workspace。**播放器不用** |
| App 审查窗口 | `app-review:${reviewId}` | 审查用 |
| 卡片截图 | `card-screenshot-${uuid}` | 截图用 |
| 应用内浏览器 viewer | `persist:hana-browser(-*)`、`za(sessionPath)` | 网页浏览标签用 |

也就是说：**分区隔离是给「App 自建窗口 / 隔离环境 / 浏览器标签」设计的；聊天卡片与其拖出窗口共处默认 session。**

---

## 2. 对方案的直接影响

- 若宿主 App UI 的 iframe `sandbox` 含 `allow-same-origin`（已从渲染层读到：`AppUiSurface-*.js` 的 `sandbox:"allow-scripts allow-forms allow-popups allow-same-origin"`），则：
  - `navigator.locks` 可用（`http://127.0.0.1` 是 secure context，已在 `06` 实测）；
  - 卡片与独立窗口共享同一 lock manager（同 bucket）；
  - 摘除/销毁文档时锁由浏览器自动释放 → 孤儿自愈成立。
- **BroadcastChannel 同理可用**（此前 Q1「未实测」的疑问，按静态核对应可通过；真机仍需验）。

## 3. 未核实项（照实标注）

1. **未在真实宿主里跑**：以上是 `app.asar` 静态核对，未做真机 origin/partition 实测。
2. **App UI iframe 的真实有效 origin**：取决于宿主 App UI 页面的加载方式（是否为同源 `http://127.0.0.1:<port>/api/apps/<id>/ui/...`）与 iframe sandbox 的实际取值；渲染层读到的 sandbox 属性含 `allow-same-origin`，但未在运行时确认。
3. **独立窗口最终文档**：`window.open("about:blank", ...)` 之后渲染层会把它导航到宿主页面；未逐帧确认 App UI 是顶层文档还是再嵌一层 iframe（两种情况下其 session/origin 都仍是默认 session + 宿主源）。
4. **`webviewTag:!0` 是否被用于承载 App UI**：若某条路径用 `<webview partition=...>` 而非 `<iframe>`，分区会不同；播放器卡片的承载是 `<iframe>`（渲染层 `AppUiSurface`），未发现 `<webview>` 路径。
5. 未改任何生产源码 / 断言 / 版本 / build / 数据。

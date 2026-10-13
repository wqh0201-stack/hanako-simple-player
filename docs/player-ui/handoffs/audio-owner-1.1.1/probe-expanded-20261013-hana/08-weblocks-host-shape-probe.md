# 08 · Web Locks 在「宿主真实形态」下的跨文档共享验证（哦鲸鲸）

> 日期：2026-10-13。范围：**只读探查 + 独立 Chrome 实验**，未改任何生产源码/断言/版本/build/app-data，未部署、未 reload。
> 目的：`07` 从 `app.asar` 判定「聊天卡片 iframe 与拖出窗口同处默认 session」。本文件用系统 Chrome 复刻宿主的**文档拓扑**，验证 Web Locks 在这种拓扑下是否真的共享。
> 脚本：`/tmp/weblocks-probe.mjs`、`/tmp/weblocks-sandbox.mjs`、`/tmp/weblocks-hidden.mjs`、`/tmp/wl2.mjs`、`/tmp/wl3.mjs`。系统 Chrome 155.0.8059.40，headless。

---

## 0. 一句话结论

**在宿主的确切拓扑下，Web Locks 共享成立。**
复刻形态：主窗口 `file://` 顶层文档里嵌一个 `http://127.0.0.1:<port>` 的 App UI iframe（取锁）；再用 `window.open("about:blank")` 开第二个窗口、把同样的 App UI iframe 写进去（拖出窗）。第二个 iframe 的 `navigator.locks.query()` **看得见第一个 iframe 持有的锁**，`ifAvailable` 正确拿不到。
→ 卡片 iframe 与拖出窗口的 iframe 处在**同一个 storage bucket**，可以抢同一把锁。

---

## 1. 宿主文档拓扑（复刻依据）

| 事实 | 来源 |
|---|---|
| 主窗口加载 `dist-renderer/index.html`，即 **`file://`** | `main.bundle.cjs` `an(Ne,"index")` → `Aa()` → `loadFile()` @1042096 |
| 主窗口 `webPreferences` 无 `partition` → **默认 session** | @1103000 附近 |
| 聊天卡片 = 主窗口里的 `<iframe src=http://127.0.0.1:<port>/api/apps/<id>/ui/...>`，`sandbox` 含 `allow-same-origin` | 渲染层 `AppUiSurface-*.js` @41647/@41720 |
| 拖出窗口 = 主窗口 `window.open("about:blank","chalkboard-detached:…")` 建的 BrowserWindow，`webPreferences` **无 `partition`** → 默认 session | `main.bundle.cjs` @1103390（`hi="chalkboard-detached:"`）；渲染层 `preview-session-tabs-*.js` @57040 |
| 拖出窗的文档由 opener（`file://`）经 frame-message-sender 写入 → 顶层站点仍是 `file://` | 同上 |

---

## 2. 实验与原始结果

### 2.1 基线语义（同源 iframe / 跨 tab）

```json
{ "s0": { "isSecureContext": true, "hasLocks": true, "hasRequest": true, "hasQuery": true },
  "s1_holderAcquired": true,
  "s1_parentQueryHeldClientIds": ["0507C0F5AF0500F6F1548C9BD0D66C3E"],
  "s1_afterRemoveHeldCount": 0,
  "s1_afterRemoveCanAcquire": true,
  "s2_tabB_queryHeldClientIds": ["BF08961BF3090F738594F8B779AA30A5"],
  "s2_tabB_ifAvailableGot": false,
  "s2_tabA_state": { "acquired": true, "aborted": true, "err": "AbortError" },
  "s2_afterSteal_tabBHolds": 1 }
```

→ `http://127.0.0.1` 是 secure context；**摘掉 iframe（无卸载 JS）锁自动释放**；跨 tab 共享；`steal` 抢占后旧持有者拿到 `AbortError`。

### 2.2 隐藏/移出视口不释放锁

```json
{ "beforeHide": 1, "afterDisplayNone": 1, "afterOffscreen": 1, "afterZeroSize": 1,
  "afterAnotherTabFront": 1, "holderStillAlive": { "acquired": true, "aborted": false } }
```

→ 只有**文档销毁**释放锁；隐藏/滚出视口/后台 tab 都不释放（活但隐藏的 owner 不会被误判为死）。

### 2.3 宿主 sandbox 下可用

```json
{ "sandboxedFrameState": { "hasLocks": true, "secure": true, "origin": "http://127.0.0.1:53071", "acquired": true },
  "parentQueryHeld": ["D5976377E58DE450AD903D974C86CADB"],
  "parentIfAvailable": false, "afterRemoveParentCanAcquire": true }
```

### 2.4 **关键：两个 `file://` 顶层文档、各嵌同源 iframe**

```json
{ "A": { "origin": "http://127.0.0.1:58372", "hasLocks": true, "heldBefore": [], "gotIfAvailable": true, "acquired": true },
  "B": { "origin": "http://127.0.0.1:58372", "hasLocks": true,
         "heldBefore": ["6E21C379ED430E8F455FCAA045A9AC43"], "gotIfAvailable": false },
  "control": { "origin": "http://127.0.0.1:58372", "hasLocks": true, "heldBefore": [], "gotIfAvailable": true, "acquired": true } }
```

- **A、B（顶层均为 `file://`）共享锁**：B 看得见 A 的 `clientId`，`ifAvailable` 拿不到。
- **control（顶层就是 `http://127.0.0.1`，第一方）不共享**：它拿锁成功 → 说明 Chromium 启用了**第三方存储分区（按顶层站点分桶）**。所以「顶层站点一致」是共享的前提。

### 2.5 **最关键：复刻宿主拖出窗形态（`window.open('about:blank')`）**

```json
{ "topLevel": "file:///tmp/wl-main.html",
  "mainIframe": { "tag": "main", "origin": "http://127.0.0.1:58600", "hasLocks": true,
                  "heldBefore": [], "gotIfAvailable": true, "acquired": true },
  "pages": ["about:blank", "file:///tmp/wl-main.html", "file:///tmp/wl-main.html"],
  "detachedIframe": { "tag": "detached", "origin": "http://127.0.0.1:58600", "hasLocks": true,
                      "heldBefore": ["34C8656FAB71ECF10D2D244EC4060F5C"], "gotIfAvailable": false } }
```

→ **主窗 iframe 持锁，`about:blank` 拖出窗里的同源 iframe 看得见这把锁、且抢不到。** 与宿主形态一致。

---

## 3. 判定

| 结论 | 证据 |
|---|---|
| 卡片 iframe 与拖出窗 iframe **同一 storage bucket** | §2.4 §2.5（顶层站点同为 `file://`） |
| 文档销毁 → 锁自动释放（含摘 iframe、关窗、进程被杀） | §2.1（§2.1 的 iframe.remove 无 JS） |
| 活但隐藏/后台的 owner 不会被误判 | §2.2 |
| 后来者可用 `steal` 原子抢占，旧持有者收 `AbortError` | §2.1 |
| **前提**：两个表面的**顶层站点必须一致**（宿主现为 `file://`） | §2.4 的 control 反例 |

**风险（必须写进交接）**：若宿主将来把某个表面改成从 `http://127.0.0.1` 直接加载（第一方），第三方分区会把两者的 bucket 分开，Web Locks 跨表面就失效。App 无法控制这一点 → 因此**必须保留「抢不到锁就保守待命」的退化路径**，不能把 Web Locks 当成永不失效的保证。

## 4. 未核实项

1. **未在真实 HanaAgent（Electron）里跑**：以上为系统 Chrome 155 的实测 + `app.asar` 静态核对；Electron 的 Chromium 同源同版本行为应一致，但未实机验证。
2. **未验证宿主主窗 `about:blank` 弹窗的实际顶层站点**：规范上 `window.open('about:blank')` 继承 opener 源；宿主是否改写未逐帧确认。
3. **未测 bfcache / tab freeze** 是否释放锁（§2.2 已排除 display:none / 滚出视口 / 后台 tab）。
4. **未测远程/移动端**（非 secure context 下 `navigator.locks` 缺失）。
5. 未改任何生产源码 / 断言 / 版本 / build / 数据。

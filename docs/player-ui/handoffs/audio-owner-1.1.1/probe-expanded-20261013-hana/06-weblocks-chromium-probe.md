# Web Locks 真机语义探测（Chromium，哦鲸鲸）

> 日期：2026-10-13。范围：**只读探查**，不改生产源码/断言/manifest/版本/build/app-data，不部署、不 reload。
> 目的：验证「浏览器原语能否给出*正向*的『文档已结束』证明」，用于孤儿 owner 自愈。
> 脚本：`/tmp/weblocks-probe.mjs`、`/tmp/weblocks-sandbox.mjs`（系统 Chrome + puppeteer-core，headless）。
> 说明：本探测验证的是 **Chromium 引擎语义**，不等价于宿主集成验证（分区/同源仍须真机确认，见 §4）。

---

## 0. 一句话结论

**Web Locks API 在 Chromium 上给出的正是我们要的那条证明：锁由「文档」持有，文档被销毁时由浏览器自动释放，且同一 origin 的父页 / iframe / 另一个顶层窗口都能看到并竞争同一把锁。**
它是**浏览器保证**的（不依赖 JS 卸载钩子、不依赖超时、不依赖宿主新接口），且 `steal` 提供原子抢占，被抢者收到 `AbortError`。

---

## 1. 场景 0：安全上下文与 API 存在性

`http://127.0.0.1:<port>`（宿主 App UI 的 origin 形态）：

```json
{ "isSecureContext": true, "hasLocks": true, "hasRequest": true, "hasQuery": true }
```

→ `127.0.0.1` 被当作可信来源，是 secure context，`navigator.locks` 可用。
（注意：`http://<局域网IP>` **不是** secure context，Web Locks 会缺失。远程/移动端接入时需退化路径。）

## 2. 场景 1：同源 iframe 持锁 → 父页可见 → 摘掉 iframe 自动释放

```json
{
  "s1_holderAcquired": true,
  "s1_parentQueryHeldClientIds": ["0507C0F5AF0500F6F1548C9BD0D66C3E"],
  "s1_afterRemoveHeldCount": 0,
  "s1_afterRemoveCanAcquire": true
}
```

- iframe 文档持锁时，**父页** `navigator.locks.query()` 能列出该锁与持有者 `clientId`。
- **把 iframe 从 DOM 摘掉（不执行任何卸载 JS）后，锁被浏览器自动释放**（held 变 0），父页立刻可获取。
- 这就是「旧文档确实已结束」的**正向证明**：不是推断、不是超时，是浏览器在文档销毁时的确定性行为。

## 3. 场景 2：跨顶层窗口（两个 tab，同源）

```json
{
  "s2_tabA_acquired": true,
  "s2_tabB_queryHeldClientIds": ["BF08961BF3090F738594F8B779AA30A5"],
  "s2_tabB_ifAvailableGot": false,
  "s2_tabA_state": { "acquired": true, "aborted": true, "err": "AbortError" },
  "s2_afterSteal_tabBHolds": 1
}
```

- 另一个顶层窗口（同源）能看见 tabA 持有的锁；`ifAvailable: true` 正确拿到 `null`（不抢）。
- `steal: true` **原子抢占**成功，tabA 的 `request` promise 以 **`AbortError`** 拒绝 → 旧持有者可据此暂停。
- 这正是「后来者自动赢」需要的语义，且由浏览器串行化，无竞态。

## 4. 补充：宿主 App UI 用的 sandbox 属性下仍可用

iframe 用宿主的原样 sandbox（`allow-scripts allow-forms allow-popups allow-same-origin`）：

```json
{
  "sandboxedFrameState": { "hasLocks": true, "secure": true, "origin": "http://127.0.0.1:53071", "acquired": true },
  "parentQueryHeld": ["D5976377E58DE450AD903D974C86CADB"],
  "parentIfAvailable": false,
  "afterRemoveParentCanAcquire": true
}
```

- sandbox 带 `allow-same-origin` 时 origin 保留 → `navigator.locks` 可用、与父页共享、摘除即释放。
- （宿主 App UI 的实际 iframe sandbox 见 `02-iframe-lifecycle.md` 的核实结果。）

## 4b. 补充：隐藏/移出视口**不会**释放锁（防「活但隐藏」被误判为死）

脚本 `/tmp/weblocks-hidden.mjs`，持锁的 iframe 依次被隐藏 / 移出视口 / 压成 0 尺寸 / 另一个 tab 切到前台：

```json
{ "beforeHide": 1, "afterDisplayNone": 1, "afterOffscreen": 1,
  "afterZeroSize": 1, "afterAnotherTabFront": 1,
  "holderStillAlive": { "acquired": true, "aborted": false } }
```

→ 只有**文档销毁**才释放锁；「隐藏 / 滚出视口 / 后台 tab」都不释放。这正是「活但隐藏/后台的 owner 不能被误抢」所需要的。
（未测 bfcache 与 Chrome 的 tab freeze；若宿主把 App UI 文档放进 bfcache，需真机确认锁是否保留——见 §6。）

## 5. 对本修复的意义（供判定，不是补丁）

Web Locks 可以直接充当**存活判据**，且覆盖 Codex 的两个反例：

| Codex 反例 | Web Locks 下的结果 |
|---|---|
| 仅重建 App 后端，旧文档仍在播 | 旧**文档**仍持有锁 → 新实例 `ifAvailable` 拿不到 → 不误抢。后端进程重启不改变锁归属。✔ |
| 用户手势 + 失联 1800ms，旧文档仍在播 | 锁不靠通知/超时：旧文档活着就持锁 → 不误抢。✔ |
| 宿主重启 / 旧文档被直接销毁 | 浏览器**自动释放**锁 → 新实例拿到 → 自愈。✔ 无需任何超时。 |
| 同代内直接摘掉单个 iframe | 该文档的锁被自动释放 → 可恢复。✔ 这是 bootId 做不到的那一项。 |

需要真机确认的只剩**集成层**：卡片 iframe 与独立窗口是否**同 storage partition / 同 origin**（这决定两者能否竞争同一把锁）。这一点与 `BroadcastChannel` 的跨窗可用性是同一个未知量——Web Locks 与 BC 都按 origin+partition 作用域。若两者同分区，则路径成立；若独立窗是独立分区，则该路径退化（需回到宿主接口路线）。

## 6. 未做 / 未测

- **未在宿主内实测**：未在真实 App UI iframe 与真实独立窗口之间验证锁共享（需要生产改动或宿主调试口，本轮不做）。
- **未测 `navigator.locks.query()` 的 `pending` 队列与 `steal` 在「持有者主线程卡死」时的时序**（spec 行为是 steal 立即授予、旧持有者稍后收到 AbortError，可能有一段重叠窗口）。
- **未测 bfcache / Chrome tab freeze**：文档进入 bfcache 时锁是否保留未验证；若宿主会把 App UI 文档放进 bfcache，需真机确认（§4b 已排除 display:none / 滚出视口 / 后台 tab 三种）。
- **未测远程/移动端**（非 secure context 下 `navigator.locks` 缺失）。
- 未改任何生产源码 / 断言 / 版本 / build / 数据。

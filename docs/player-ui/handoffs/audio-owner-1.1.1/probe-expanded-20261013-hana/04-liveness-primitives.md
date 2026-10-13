# 04 · 浏览器原生「文档已结束」正向证明 · 原语调研与最小集成设计

日期：2026-10-13（Asia/Shanghai）。执行：哦鲸鲸。
范围：**设计 + 可行性论证**。本轮不改任何生产源码 / 测试 / manifest / 版本 / 构建号 / app-data，不部署、不 reload。只写本文件。
证据等级：全部为**规范原文 + 本仓库既有实测**的静态核对；凡未在真实 Hana 宿主里跑过的，一律标「未实测」。

---

## 0. 一句话结论

**有。`navigator.locks`（Web Locks API）就是那个原语**：它的锁状态住在**浏览器进程**里、按 **storage bucket（≈ 同源 + 同 Electron session）** 共享，且规范明文规定**文档被销毁 / agent 终止时锁由浏览器自动释放**——这正好是「某个 UI 文档确实已结束」的*正向*证明，能在 App 内直接用、不需要宿主新增接口、不需要超时、不需要心跳。

它的唯一前置条件是**该 iframe 必须是同源非不透明源**（`sandbox` 若只有 `allow-scripts`、没有 `allow-same-origin`，源是 opaque，Web Locks 会直接 `SecurityError`，跟已实测的 BroadcastChannel 失效是同一个根因）。这一点必须在真机上确认；在确认之前，它是**最有希望、但尚未验证**的方案。

---

## 1. 原语对照表

判定列口径：**「能给出对端已死的正向证明」= 存在一个由浏览器/运行时保证的机制，使得「对端文档已结束」这件事本身会改变某个**本实例可读**的状态或触发某个**本实例可收**的事件，且不需要对端配合、不依赖超时。**

| 原语 | 规范给出的保证 | 死亡正向证明？ | 同源 iframe | 跨独立窗口 | 本场景判定 |
|---|---|---|---|---|---|
| **Web Locks** `navigator.locks` | ① 锁按 storage bucket 共享，跨「无关 browsing context」的 agent 共用同一个 lock manager（[Web Locks §2.2](https://w3c.github.io/web-locks/)）；② 文档被销毁时执行 unloading document cleanup steps → `terminate remaining locks and requests`，agent 终止同样释放（[§2.6](https://w3c.github.io/web-locks/)；HTML 的 [destroy a document](https://html.spec.whatwg.org/multipage/document-lifecycle.html) 会跑 unloading document cleanup steps）；③ 动机段直接写「knowing when the active tab goes away (navigated, closed, **crashed**)」与「If the 'primary tab' **crashes** or is closed then one of the other tabs will get the lock」（[§1.2](https://w3c.github.io/web-locks/)） | **是**（唯一一个） | ✅ 同 bucket 即可 | ✅ 同一 session 即可 | **首选**。见 §2 |
| **BroadcastChannel** | 按 storage key（origin）+ channel name 匹配收件人，异步投递；`close()` 不通知对端，文档销毁**不发任何事件**（[HTML · Broadcasting to other browsing contexts](https://html.spec.whatwg.org/multipage/web-messaging.html#broadcasting-to-other-browsing-contexts)） | **否**：沉默既可能是死、也可能是忙/断通知 | ✅（同源时） | ✅（同源同 session 时） | 只做**快通道**，不做死亡证明。与既有结论一致 |
| **SharedWorker** | 「Shared workers are shut down when they are no longer referenced by any windows, iframes, or workers」（[MDN · Shared worker lifetime](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#shared_worker_lifetime)，2026-08-27）；但**没有** per-client disconnect 事件，worker 侧只能看到 port 静默 | **否**：worker 只在其「最后一个 client」消失时才整体终止；多个实例共存时 owner 死了 worker 仍活着，无法区分是谁死 | ✅ | ✅ | 不采用。只能做粗粒度存活，做不到「某个文档」级 |
| **ServiceWorker** + `clients.matchAll()` | SW 可枚举「本 origin 的活 client」（Client 移除发生在文档销毁时）。但：注册面在宿主 origin（scope 受限、可能与宿主已有 SW 冲突）、首屏未被 `claim` 前不受控、SW 空闲会被杀（状态需落 IDB） | **半**：理论上能枚举，工程代价与侵入性都大 | ⚠️ 取决于是否受控 | ⚠️ 同上 | 备选，不做首选 |
| **MessagePort / MessageChannel** | 对端销毁时 port 静默「disentangle」，**不发 disconnect 事件** | **否** | ✅ | ✅（需先有握手通道） | 只做传输 |
| **SharedArrayBuffer / Atomics** | 需 cross-origin isolation（COOP/COEP）；App 无法给宿主顶层文档加响应头 | **否**（Atomics 只能心跳，无法证明对端死） | ❌ 实际上拿不到 | ❌ | 不采用 |
| **`document.wasDiscarded`** | 只说明「**本次加载**是上一次被 discard 后重载的」，discard 当刻对开发者不可观察（[WICG Page Lifecycle](https://wicg.github.io/page-lifecycle/)） | **否** | — | — | 与对端死亡无关 |
| **Page Visibility** | hidden ≠ dead；只反映本实例绘制状态 | **否** | — | — | 与既有结论一致（见 `AUDIO-OWNER-PROBE-REVIEW.md` §3） |
| **`pagehide` / `unload` / `beforeunload`** | 只在「优雅卸载」时触发；崩溃 / 强杀 / renderer 被销毁时**根本不跑** | **否**（死了就发不出） | — | — | 只能做交接，不能做死亡证明 |
| **`performance.getEntriesByType('navigation')`** | 只描述**本文档**自己的加载 | **否** | — | — | 无关 |
| **`window.closed`** | 只有你**持有其 WindowProxy** 时才有意义；任意对端拿不到 | **否** | ⚠️ 需先有引用 | ⚠️ 需先有引用 | 不通用 |
| **WebSocket（经 App 后端）** | renderer 被销毁时 TCP 会断，后端可感知 | **半**：但后端可独立重建（反例 1 已实测）；瞬时断连 ≠ 死 | ✅ | ✅ | 不采用（且依赖后端，回到老问题） |
| **IndexedDB 事务** | 持有 agent 死时事务中止，但不暴露「是哪个 agent 死的」 | **否** | — | — | 不采用 |

**表里唯一打勾「是」的只有 Web Locks。** 它的关键差异：**证明状态由浏览器进程持有，且生命周期严格绑定 agent**——不经过 App 后端、不经过任何 App 级消息通道，所以既躲开「后端重建」反例，也躲开「通道失联」反例。

---

## 2. Web Locks 可行性深挖

### 2.1 规范逐条对齐（任务书必查项）

**(a) 文档销毁时锁自动释放？——是。**
Web Locks [§2.6 Termination of Locks](https://w3c.github.io/web-locks/)：
> Whenever the **unloading document cleanup steps** run with a document, **terminate remaining locks and requests** with its agent.
> When an agent terminates, terminate remaining locks and requests with the agent.

而 HTML 的 [`destroy a document`](https://html.spec.whatwg.org/multipage/document-lifecycle.html) 步骤里明确会跑 unloading document cleanup steps（WHATWG HTML，2026-10-05 快照）。也就是说：**iframe 被移除 / browsing context 被丢弃 / renderer 被拆**，都会走到这条释放路径。
规范动机段更直白（[§1.2](https://w3c.github.io/web-locks/)）：「knowing when the active tab goes away (navigated, closed, **crashed**) so that another tab can become active」，「If the 'primary tab' **crashes** or is closed then one of the other tabs will get the lock」。
→ **死亡即释放是规范级承诺，不是实现巧合。** 这正是老方案缺的那块。

> 注意一处措辞：§2.6 末尾有一句 NOTE 说 agent 终止这条「currently only for workers and is vaguely defined」。这针对的是**worker** 的终止路径；**document** 走的是 unloading document cleanup steps，是有明确定义的。renderer 进程整体崩溃这一档，规范覆盖较弱（靠 agent terminates），**列为真机必验项**。

**(b) `query()` 能否列出持有者 `clientId`？——能。**
[§3.2.2](https://w3c.github.io/web-locks/)：`query()` 返回 `{ held: [...], pending: [...] }`，每条 `{ name, mode, clientId }`；规范原文：「The `clientId` field corresponds to a unique context (frame or worker), and is the same value returned by `Client`'s `id` attribute.」
→ 可以列出「谁在持锁」，且 `clientId` 是**帧级**身份（跟 SW 的 `Client.id` 同源同值）。
→ 但**注意**：`query()` 是快照，返回时状态可能已变；它只列「当前持有/排队」的锁，**天然只含活着的 agent**（死者的锁已被释放，根本不会出现）。所以「query 里没有该锁」= 没有活着的持有者——这就是我们需要的正向证明，不需要再拿 `clientId` 去别处核对。

**(c) 能否跨同 storage partition 的不同 iframe / 不同窗口共享？——能，但条件是「同 storage bucket」。**
[§2.2 Lock Managers](https://w3c.github.io/web-locks/)：
> Each **storage bucket** includes one lock manager … Pages and workers (agents) **sharing a storage bucket** opened in the same user agent **share a lock manager** even if they are in **unrelated browsing contexts**.

「storage bucket」由 [Storage Standard](https://storage.spec.whatwg.org/) 定义：storage shed → 按 **storage key**（= origin）分 storage shelf → shelf 里是 storage bucket。所以：
- **同源 + 同一 user agent（同一 Electron session / partition）→ 同一 bucket → 共享 lock manager。** ✅
- **不同 Electron session（不同 `partition`）→ 不同 bucket → 不共享。** ⚠️ 独立窗口是否与主窗口同 session，必须真机确认。
- **opaque origin（不透明源）→ 直接拿不到锁**，见 (e)。

**(d) `steal: true` 的语义与竞态。**
[§3.2.1](https://w3c.github.io/web-locks/) 与 [§4.1 算法](https://w3c.github.io/web-locks/)：
- 请求带 `steal: true` 时，算法对 `held` 里**同名**的锁：从 held 移除，并让该锁的 **released promise 以 `AbortError` 结算**；随后把**本次请求 prepend 到队列头**（插到所有排队请求之前）。
- 约束：`steal` 与 `ifAvailable` 互斥、`steal` 与 `signal` 互斥、`steal` 时 `mode` 必须是 `exclusive`（否则 `NotSupportedError`）。见 [§3.2.1 步骤 6–8](https://w3c.github.io/web-locks/)。
- **竞态与语义关键点**：被抢的**是持有中的锁**，不是回调。规范只让 released promise（即 `request()` 的返回值）以 `AbortError` 结算，**不会 abort 旧持有者的回调**。所以旧持有者要能收到通知，**必须监听 `navigator.locks.request(...)` 的返回值**（`.catch`）。
- 一处规范内部不一致：§3.2.1 散文说「the released promise of such locks will **resolve** with AbortError」，§4.1 算法写「**Reject** lock's released promise with an AbortError」。**以运行时实测为准**（真机必验项）。两种实现下调用方都能通过 `.then/.catch` 拿到 `AbortError`，但代码写法要兼容「resolve(AbortError)」和「reject(AbortError)」两种。
- 因为「prepend 到队列头」，`steal` 还会**越过排队者**：即使旧持有者刚被 B 抢、C 已经在排队，新的 steal 也会插到 C 前面。设计上要避免多个实例无节制 steal（用「用户意图」作闸门）。

**(e) secure context 要求，`http://127.0.0.1` 算不算 secure？——算。**
[Web Locks §3.1](https://w3c.github.io/web-locks/) 的 `NavigatorLocks` / `LockManager` / `Lock` 都带 `[SecureContext]`；MDN 也标 secure context（[MDN Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)，2025-04-03）。
[Secure Contexts §3.1](https://w3c.github.io/webappsec-secure-contexts/)（W3C，2023-11-10）：
- host 落在 `127.0.0.0/8` 或 `::1/128` → Potentially Trustworthy（步骤 4）；
- `localhost` / `*.localhost` → Potentially Trustworthy（步骤 5）；
- scheme 为 `file` → Potentially Trustworthy（步骤 6）；
- **opaque origin → Not Trustworthy（步骤 1）**。

所以宿主若从 `http://127.0.0.1:<port>/api/apps/<id>/ui/...` 加载，**是 secure context，`navigator.locks` 可用**。

**(f) 但真正卡人的不是 secure context，是 opaque origin。**
Web Locks 取锁要 `obtain a local storage bottle map(environment, "web-locks")`（[§2.2](https://w3c.github.io/web-locks/)）。Storage Standard 的 [obtain a storage key](https://storage.spec.whatwg.org/)（2026-10-06）第 2 步：**origin 是 opaque origin → return failure**；bottle map 拿不到 → Web Locks `request()` **reject `SecurityError`**（[§3.2.1 步骤 4](https://w3c.github.io/web-locks/)）。
→ 若宿主的 App iframe 用了 `sandbox="allow-scripts"`（**没有** `allow-same-origin`），源是 opaque：`navigator.locks` 可能仍存在（secure context 判断走 URL，`about:srcdoc` 本身是 potentially trustworthy），但**任何 `request()` 都会 `SecurityError`**。
→ 这和已实测的 BroadcastChannel 反例**同一个根因**（`AUDIO-OWNER-PROBE-REVIEW.md` §2：`allow-scripts` 无 `allow-same-origin` 时，两张 iframe 收发 0 条）。也就是说：**如果 BC 在真实卡片里其实是通的，Web Locks 大概率也通；如果 BC 其实不通，两者一起废。**

### 2.2 为什么它正好命中两个反例

- **反例 1「仅重建 App 后端但旧文档仍在播」**：锁在**浏览器**里，不在 App 后端的 store 里。重建后端不会释放任何锁。旧文档活着 → 仍持锁 → 新实例 `ifAvailable` 拿到 `null`（知道「有活 owner」），**不会误判自己是 owner**，因此不会自动出声；用户要抢则走 `steal`，旧文档收 `AbortError` 后暂停。**全程不产生双出声。**
- **反例 2「用户手势 + 失联超时」**：本设计**完全不用超时判死**。存活的判据只有一条——「锁还在不在」。一个「活着但忙 / 断通知」的文档**仍然持锁**，于是**永远不会被判死**，也就不会被误抢。而「用户手势」在这里只解决 autoplay 授权，不再承担死亡证明的职责。
- 附带命中**原始 bug**：宿主重启 / 强制 reload 后旧文档被直接销毁 → 浏览器跑 unloading document cleanup steps → 锁自动释放 → 新实例 `ifAvailable` 直接拿到 → 自动恢复播放。**不需要旧文档配合、不需要宿主接口、不需要任何超时。**

### 2.3 风险清单（必须在真机上证的）

1. **iframe 源是否非不透明**（有没有 `allow-same-origin`）。决定 Web Locks 能否用。**这是生死项。**
2. **卡片 iframe 与独立窗口是否同一 Electron session / partition**。不同 session → 不共享锁 manager，方案退化为「卡片内自洽、跨窗失效」。
3. **renderer 崩溃（非优雅卸载）是否释放锁**。规范覆盖较弱，靠实现。若 Electron 不释放，方案对「强制杀 renderer」这一档无效（但对 reload / 移除 iframe 这一档有效）。
4. **`steal` 通知的时延与双出声窗口**。`steal` 后新 owner 立刻出声、旧 owner 稍后才跑到 `AbortError` handler，中间有一段重叠。需要在真机量这段窗口，再决定是否加「等旧 owner 暂停确认」的短调度窗。
5. **`steal` 的 released promise 到底是 resolve 还是 reject AbortError**（规范内部不一致）。
6. **autoplay 授权**：`steal` 路径若没有用户手势，`audio.play()` 可能被拦（这是既有问题，不是新问题）。
7. **`file://` 档**：若某些表面走 `file://`，Chromium 对 `file://` 常给 opaque origin，Web Locks 会废。

---

## 3. 最小集成设计（伪代码级）

### 3.1 心智模型

> **锁 = 「当前出声者」这个头衔本身。**
> 持锁 ⟺ 我是唯一被浏览器承认的出声者。
> 锁空闲 ⟺ 不存在活着的出声者（死亡已由浏览器自动清账）。
> 旧文档死了 → 它的锁被浏览器收走 → 新实例不用问任何人就能拿到。

**与「持久化 owner 记录 + 显式交接」的分工：**

| 部件 | 处置 | 理由 |
|---|---|---|
| 全局锁 `player-audio-owner` 里的 **播放快照**（currentTrack / progress / volume / mode / shuffleTrail / playing 意图） | **保留** | 它承担的是「续播语义」，跟「谁出声」正交。跨文档重建文档时仍要靠它接上进度 |
| App 后端串行仲裁（`lib/audio-owner.js` 的 `serial`/`commit`） | **保留**，但降级为**快照写入的串行化** | 它的原价值是「旧 iframe 排队的 POST/beacon 不能夺回 owner」，这个价值与锁无关，仍需要 |
| `claim → pending → yield → handoff` 显式交接 | **保留为快通道 / 优化路径** | 锁能自愈「死 owner」，但拿锁本身不携带「让旧 owner 体面暂停并把快照交出来」的信息。让位仍走既有协议 |
| 「没收到 yield 就永久待命」 | **废弃** | 这是死锁的直接来源。改由锁的存活判据接管 |
| 「1500ms 回读 / 任何静默超时当作可夺权」 | **废弃**（超时只允许用于「重发 / 换通道 / 重读」，**绝不允许用于判死或夺权**） | 反例 2 已证伪 |
| owner 记录里的 `ownerId/generation/pending` | **保留为乐观并发控制**（防旧 generation 的延迟写覆盖），但**不再是出声权的唯一来源** | |

### 3.2 伪代码

```js
/* ============ 锁名与能力探测 ============ */
const AUDIO_LOCK = 'hana-simple-player-audio-owner';
const LOCK_OK = typeof navigator !== 'undefined'
  && navigator.locks && typeof navigator.locks.request === 'function';

/* 一次性探测：拿到 SecurityError 就说明源是 opaque，整套退回旧方案 */
async function probeLocks() {
  if (!LOCK_OK) return false;
  try { await navigator.locks.query(); return true; }   // 拿不到 lock manager 会 SecurityError
  catch (e) { return false; }
}

/* ============ 持有：一个实例从「想出声」到「不再出声」都持有它 ============ */
let lockReleaser = null;     // { promise, resolve }  —— 主动放锁用
let lockRequest  = null;     // request() 返回的 promise —— 收 AbortError 用

function beginHold() {
  const hold = Promise.withResolvers();       // 旧 Chromium 用 new Promise(r => ...) 兜底
  lockReleaser = hold;
  lockRequest = navigator.locks.request(AUDIO_LOCK, /* 默认 exclusive */ () => hold.promise)
    .then(() => { /* 我们主动放锁，正常结束 */ })
    .catch((err) => {
      // 被更新的实例 steal 抢走：浏览器把 AbortError 直接投到本 JS 上下文，
      // 不经过 BroadcastChannel / storage，断通知也躲不掉。
      if (err && err.name === 'AbortError') {
        pauseForOwner(/*takeover*/ true);      // 立刻停声（复用既有 pause 路径）
        needsTakeover = true; renderResume();
      }
    });
}
function endHold() { lockReleaser && lockReleaser.resolve(); lockReleaser = null; }

/* ============ 取声：后来者自动赢，且不产生双出声 ============ */
async function acquireAudio(reason) {
  if (!probeOk) return legacyClaimAudio(reason);   // 探测失败 → 退回旧协议

  // ① 先看「有没有活着的持有者」——这是浏览器给的、唯一的存活判据
  let gotFree = false;
  await navigator.locks.request(AUDIO_LOCK, { ifAvailable: true }, (lock) => {
    if (!lock) return;                 // 有活 owner 持锁
    gotFree = true;
    beginHoldFromExisting(lock);       // 复用这次授予，不重复请求
    return hold.promise;
  });

  if (gotFree) {
    // 锁空闲 = 上一个 owner 已死（或本来没人）。浏览器已替我们清账。
    // 不需要超时、不需要宿主接口、不需要旧文档配合。
    await restoreFromSnapshotIfAny();  // 沿用既有快照续播
    return true;
  }

  // ② 有活 owner。先走既有显式交接（BC/storage claim→yield），让旧 owner 体面暂停并交快照。
  const yielded = await requestYieldFromOwner(reason);   // 既有协议；超时只「待命/重试」，绝不夺权
  if (yielded) { beginHold(); return true; }

  // ③ 通道不通（分区隔离 / 通知丢失），但 owner 活着。
  //    用 steal 让浏览器把 AbortError 直接投给旧 owner —— 这是唯一「不可丢失」的通知通道。
  //    （steal 与 ifAvailable/signal 互斥、mode 必须 exclusive，见规范 §3.2.1）
  beginHold();                                  // 内部用 steal:true 请求
  await navigator.locks.request(AUDIO_LOCK, { steal: true }, () => hold.promise);
  // 此刻旧 owner 已收到 AbortError 并在 pause()。为避免重叠，等它的暂停确认；
  // 这个等待是「调度窗口」，不是死亡判据：旧 owner 死/不存在时本就没有确认可等。
  await waitPauseAckOrSchedulingWindow(/* 例 250ms，仅调度 */);
  return true;
}

/* 让位：既有 handoff/yield 原样保留，只是它不再是「唯一」的让位路径 */
async function yieldTo(claimId, generation) { /* ...既有实现... */ }
```

要点：

1. **`ifAvailable` 是「孤儿自愈」的那一步**，零等待、零超时。它拿不到锁，才说明真有活 owner。
2. **`steal` 是「后来者自动赢」的那一步**，且它的通知通道（AbortError）由浏览器投递，**不依赖 BC/storage**，因此专门覆盖「活 owner 但通道失联」。
3. **全程没有一处把「静默 / 超时」当死亡证明**。唯一的死亡判据是「浏览器有没有替我们把锁收走」。
4. 既有 `pauseForOwner` / `snapshot()` / `ownerCommand` 全部复用；改动面集中在一个 `acquireAudio` 分叉 + 一个 `AbortError` handler。

### 3.3 覆盖两个反例的说明

| 反例 | 老方案怎么死 | 新设计怎么活 |
|---|---|---|
| 仅重建 App 后端，旧文档仍在播 | owner 记录在后端 store 里，后端 epoch 变了就被当孤儿清掉 → 新文档获权 → 双出声 | 锁在浏览器里，重建后端不释放它 → 新实例 `ifAvailable` 得 `null` → 知道有活 owner，不自动出声 |
| 用户手势 + 失联超时 | 旧文档活着但收不到通知，超时后被当死 → 强播 → 双出声 | 旧文档仍持锁 → 永不被判死；要抢就走 `steal`，浏览器**直接**把 AbortError 投给它，通道失联不再妨碍通知 |

---

## 4. 真机验证清单（**这些不跑，方案不成立**）

> 全部在真实 Hana 里跑，只输出安全元信息（不日志化 SDK 凭据、不记录含票据的完整 URL）。

**A. 能力探测（最先做，决定生死）**
1. 在**卡片 iframe** 与**独立窗口**里各读并记录：`location.origin`、`isSecureContext`、`typeof navigator.locks`、`document.querySelector` 拿不到但可用 `window.frameElement`（同源时）读到的 `sandbox` 属性；若跨源读不到，改由宿主侧确认 iframe 的 `sandbox` 取值。
2. 在两个表面各跑一次 `await navigator.locks.query()`，记录：成功 / `SecurityError`。**若卡片里就是 `SecurityError`，方案直接判废**，退回旧协议 + 宿主接口路线。

**B. 跨上下文共享**
3. 卡片 A 持锁（`request` 不 resolve）；同窗卡片 B 与独立窗口 C 各 `query()` → 是否都看到 A 的 `held` 记录、`clientId` 是否一致。
4. 从 B 用 `steal: true` 抢 → 记录 A 的 `request()` 返回值是 **reject 还是 resolve** `AbortError`，以及从「B 拿到锁」到「A 的 handler 跑起来」的毫秒差。
5. 记录从 A 收到 AbortError 到 `audio.paused === true` 的毫秒差（`paused` 同步变、`pause` 事件异步，见 `AUDIO-OWNER-PROBE-REVIEW.md` §4）。用这个数定 §3.2 的调度窗。

**C. 死亡自愈（核心承诺）**
6. 卡片 A 持锁且正在播 → **CDP `Page.crash` / `webContents.forcefullyCrashRenderer()`** 强杀承载 A 的 renderer（无 pagehide、无 JS）→ 从独立窗口 C 跑 `query()`（锁应已不在）与 `ifAvailable`（应立刻拿到）→ 记录是否**自动恢复出声**。
7. 直接 `iframe.remove()`（同代内摘掉单个 iframe，不重启宿主）→ 同上。
8. 整包 reload（`extension_manager reload`）→ 同上。
9. **反例 1 复跑**：只重启 App 后端、保留旧 renderer → 新实例 `ifAvailable` 必须得 `null`（不得自动出声）。
10. **反例 2 复跑**：禁掉 BC + 停掉 storage 通知、旧页继续播 → 新页走 `steal` → 旧页必须收到 AbortError 并暂停；全过程任意时刻 `document.querySelectorAll('audio').filter(a=>!a.paused).length ≤ 1`。

**D. 会话 / 分区**
11. 确认卡片 iframe 与独立窗口用的是**同一个 Electron session（partition）**；若不是，记录退化边界（跨窗锁不通）。

**E. 授权与时序**
12. `steal` 路径下（无用户手势）`audio.play()` 是否被 autoplay 拦；「继续播放」胶囊是否出现、点一下能否恢复。
13. 若存在 `file://` 加载面，单独验 Web Locks 是否可用。

---

## 5. 未核实项（照实标注）

1. **Hana App iframe 的真实 `sandbox` 取值 / 有效源**——`APPS.md` 全文未提 `sandbox` / `allow-same-origin` / `storage partition`；既有 probe 的 `origin:"null"` 读数不能区分「同源继承的 srcdoc」和「真 opaque」。**本轮未跑宿主实测。**
2. **卡片 iframe 与独立窗口是否共享 Electron session / storage bucket**——纯推断，未验证。
3. **renderer 崩溃时 Electron/Chromium 是否释放 Web Locks**——规范覆盖弱（§2.6 NOTE 自称 agent 终止路径 vaguely defined），必须真机证。
4. **`steal` 的 released promise 是 resolve 还是 reject `AbortError`**——规范内部不一致（§3.2.1 散文 vs §4.1 算法）。
5. **`steal` 造成的双出声重叠窗口实际有多长**——未测；§3.2 的调度窗数值是占位。
6. **真实卡片 ↔ 独立窗口的 BroadcastChannel 连通性**——至今未实测（`channel-contract-.../SUMMARY.md` Q1 结论）；它同时决定 Web Locks 是否可用，因为二者共用「非不透明源」这一前提。
7. **`Promise.withResolvers` 在该 Electron 版本是否可用**——未核；不可用则用 `new Promise` 兜底。
8. 本轮**未改任何生产源码 / 测试 / manifest / 版本 / 构建号 / app-data**，未部署、未 reload。全部结论为规范 + 既有实测的静态核对，**不构成任何功能已通过的声明**。

---

## 6. 附：来源清单（含日期）

- Web Locks API（W3C）：<https://w3c.github.io/web-locks/>（快照 2025-09-24）／TR：<https://www.w3.org/TR/web-locks/>。关键节：§1.2（crash 动机）、§2.2（lock manager 按 storage bucket 共享）、§2.6（Termination of Locks）、§3.2.1（steal / ifAvailable / signal 约束）、§3.2.2（query 与 clientId）、§4.1（steal 算法）。
- MDN · Web Locks API：<https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API>（2025-04-03）。
- Storage Standard（WHATWG）：<https://storage.spec.whatwg.org/>（2026-10-06）。关键：obtain a storage key（opaque origin → failure）、obtain a storage bottle map。
- Secure Contexts（W3C）：<https://w3c.github.io/webappsec-secure-contexts/>（2023-11-10）。关键：§3.1 步骤 1/4/5/6。
- HTML Standard：<https://html.spec.whatwg.org/multipage/document-lifecycle.html>（destroy a document / unloading document cleanup steps，2026-10-05 快照）；<https://html.spec.whatwg.org/multipage/web-messaging.html>（BroadcastChannel / postMessage）。
- WICG Page Lifecycle：<https://wicg.github.io/page-lifecycle/>（`wasDiscarded`）。
- MDN · SharedWorker：<https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker>（2026-08-31）；MDN · Using web workers → Shared worker lifetime（2026-08-27）。
- 本仓库既有实测：`docs/player-ui/handoffs/AUDIO-OWNER-PROBE-REVIEW.md`（BC sandbox 反例、pause 时序）、`AUDIO-OWNER-ORPHAN-HOST.md`（公开面无文档级死亡证明）、`AUDIO-OWNER-ORPHAN-REPAIR.md`（两个反例的 CDP 复现）、`audio-owner-1.1.1/host-probe-20261013-hana/broadcast-channel-chrome.json`。

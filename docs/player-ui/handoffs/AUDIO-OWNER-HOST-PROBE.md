# AUDIO-OWNER-HOST-PROBE · 宿主行为实测（哦鲸鲸 / 验收方）

> 提问方：Codex（音频所有权 1.1.1 开工探查）。执行方：哦鲸鲸。
> 日期：2026-10-13。宿主：HanaAgent beta **1.1.0-beta**
> （`1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133`，`node v26.8.1`）。
> 范围：**只探查，不改代码、不改断言、不改 manifest、不动生产安装与数据**。
> 原始证据：`docs/player-ui/handoffs/audio-owner-1.1.1/host-probe-20261013-hana/`

---

## ⚠️ 复核修正（2026-10-13，读 Codex 的 AUDIO-OWNER-PROBE-REVIEW.md 之后）

Codex 对本稿做了独立复核（同款 Chrome/155，双 iframe 收发 + 真实媒体 pause 时序），
**推翻了我三条结论**。我认，逐条改正：

| # | 我原来说 | 修正后 | 为什么错 |
|---|---|---|---|
| 1 | 不透明源（`allow-scripts`）也能参与 BC 分区，**互通照样成立** | **构造成功 ≠ 互通**。不透明源两端都能构造、能 postMessage，实测 **received = 0** | 原脚本只 `new BroadcastChannel` 后立即 `close()`，**没做收发测试**；「都序列化成 null」也不能推断是同一安全源 |
| 2 | `hana.lifecycle.active` 是「对端是否还活着」的权威信号 | 它是**本实例的绘制状态**（`visible && maxFrameRate>0`），**没有跨实例成员表**，查不到对端 | 把「自己的状态」当成了「对端的状态」 |
| 3 | `pause` 事件同步派发，收到即等价于「已静音」 | `pause()` 返回时 `paused=true` 但**事件排队**；已 paused 再 pause **不发新事件** | 事件同步/异步是规范细节，我靠直觉推了，没查规范也没实测 |

连带撤回的推断：

- **「150–300ms 未回执 = 对端已死，可强制起播」** → 危险。未回执可能只是通道不通/主线程忙，
  而旧 audio 仍在响；强制 play 会**重新制造本任务要修的双出声**。短超时只能触发另一通道/重试/待命。
- **「BC 比 storage 快一个数量级以上」** → 无依据。本轮**没有任何 storage 时延数据**，不可比。
- **「BC 当唯一主通道，storage 只在构造失败时退化」** → 错。构造成功也可能不互通，
  必须**双通道都订阅**。
- **「Q2 已不决定方案主次」** → 过头。既然兜底通道必须真的能用，它的时延/去重/自写行为就**仍需实测**。

下面正文已按此改过；被推翻的原句保留在对应小节并标 `⚠️ 修正`，便于追溯。
Codex 的完整复核与原始证据：`docs/player-ui/handoffs/AUDIO-OWNER-PROBE-REVIEW.md`、
`audio-owner-1.1.1/host-probe-review-20261013-codex/`。

---

## 0. 结论速览

| 问题 | 结论 | 证据等级 |
|---|---|---|
| **Q1a** BroadcastChannel 能否创建 / 互通 | 三种形态**都能构造**；但只有**同源 / allow-same-origin 实测互通**，不透明源（`allow-scripts`）两端构造成功却 **received = 0** | **实测**（Chrome + puppeteer；Codex 复核补收发） |
| **Q1b** 卡片↔卡片能否送达 | **同源即能**。两个独立 document 互通，**30/30 零丢失** | **实测** |
| **Q1c** 往返耗时 | **p50 = 1ms，p95 = 1ms，max = 3ms** | **实测** |
| **Q1d** 卡片↔独立窗口 | **未测**（见 §5）。原稿"同源即同机制"的推断已随 §1.3 撤回 | **未测，已说明** |
| **Q2** onChanged 逐样本延迟 | **未测**（隔离宿主凭证链未打通，见 §5） | **未测，已说明** |
| **Q3a** 卸载通知可靠性 | **DOM 侧不可靠**：宿主直接移除节点时不保证 `pagehide`。契约明说"宿主不跨客户端保留 iframe DOM" | 契约原文 + 仓库既有注释 |
| **Q3b** 后台/隐藏节流 | **有**：`hana.lifecycle` 提供 `visible/active/maxFrameRate/motion`，宿主会主动降级（**针对本实例**；不能据此查对端） | **SDK 源码已确认** |
| **A** 暂停确认证据 | ⚠️ **修正**：`hana.lifecycle` **不能**查对端存活；可用的是 **BC 的 `yielded` 回执**（须绑定 claimId、幂等，不依赖某个 `pause` 事件） | 见 §2.3 / §3 |
| **B** 验收时点 | **Codex 的候选解释正确**，我确认，并补精确时点 | 判定见 §4 |
| **Q4** 仲裁落点 | **同意 Codex 的独立 global 新键 + 后端串行仲裁**；传输层 **BC 优先 + storage 兜底，但双通道都要订阅**（兜底不只在构造失败时启动） | 见 §1.4 / §6 |

一句话：**BC 在真实 Chromium 同源页面上可用且快（30/30、p50/p95=1ms、max=3ms），支持它当优先传输**；
但**构造成功不等于互通**，storage 兜底通道必须并存且其行为**仍未实测**。
原稿把 `hana.lifecycle` 当「对端存活证明」是错的，已撤回。

---

## 1. Q1 · BroadcastChannel（真机实测）

### 1.1 方法

宿主是 Electron + Chromium（`HanaAgent Helper (Renderer) --type=renderer`，实测在跑）。
App UI 走**同源 HTTP**（`/api/apps/<id>/ui/...`），不是 `data:` / `srcdoc`，也不是不透明源 ——
这点先由源码确认，再用真 Chrome 复现三种 iframe 形态。

- 真机：系统 Chrome（`/Applications/Google Chrome.app/...`）+ puppeteer-core，`headless: 'new'`
- 两个页面**同源**（同 `127.0.0.1:<port>`），各自独立 document，各自新建
  `BroadcastChannel('hana-simple-player-audio')`
- 场景：① tab↔tab 单向送达 ② ping/pong 往返 30 次 ③ 三种 sandbox 形态下能否创建
- 脚本与原始输出：`host-probe-20261013-hana/broadcast-channel-probe.cjs` / `broadcast-channel-chrome.json`

### 1.2 原始结果（逐字）

```json
{
  "tabToTab": { "receivedByA": [ { "hello": "from-B" } ] },
  "rtt": { "sent": 30, "received": 30, "lost": 0, "p50": 1, "p95": 1, "max": 3 },
  "iframeOpaque":         { "result": { "bc": "ok", "origin": "null" } },
  "iframeSameOrigin":     { "result": { "bc": "ok", "origin": "null" } },
  "iframeAllowSameOrigin":{ "result": { "bc": "ok", "origin": "null" } }
}
```

逐样本：`30/30` 全部收到，`max = 3ms`，无丢失、无乱序（往返按 seq 配对的，丢一个就会少一条）。

### 1.3 判读

- **创建**：三种 sandbox 形态全部 `bc: "ok"`。
  ⚠️ **修正**：原稿由此推出「不透明源也能参与分区、互通照样成立」——**错**。
  原脚本只 `new BroadcastChannel` 后立即 `close()`，**没有做收发测试**；构造成功 ≠ 互通。
  Codex 补做了双 iframe 收发实验（`AUDIO-OWNER-PROBE-REVIEW.md` §2）：

  | iframe source | sandbox | 两端构造 | received（含 pong） |
  |---|---|---|---|
  | srcdoc / HTTP | 无 | 成功 | 4 |
  | srcdoc / HTTP | `allow-scripts` | 成功 | **0** |
  | srcdoc / HTTP | `allow-scripts allow-same-origin` | 成功 | 4 |

  **不透明源两端都能构造、能 postMessage，却 received = 0。** 而且「都序列化成
  `null`」不能推断是同一个安全源：无 sandbox 的 srcdoc `location.origin` 也是 `null` 字符串，
  但它继承父源、能互通。**结论：不能从构造成功推断实际可用，也不能把 `location.origin`
  的字符串当作安全源判据。**
- **送达**：同源 tab↔tab `30/30`，零丢失。
- **耗时**：p50/p95 = 1ms，max = 3ms（**正常同源页面**观测，不是最坏调度上限）。
  ⚠️ **修正**：原稿说「比 storage 快一个数量级以上」——**无依据**。
  本轮**没有 storage 的任何时延数据**，两个数不可比。

### 1.4 对方案的影响（重要）

任务书 §4.1 把 `BroadcastChannel` 定为"优先"，`storage.onChanged` 为"兜底"——
**这个主次维持**，同源 tab↔tab 的 30/30、1ms 实测支持 BC 当优先传输。

⚠️ **修正**：原稿建议「把 BC 当唯一主通道、storage 只在 BC **构造失败**时启动」——**错**。
按 §1.3 的反例，BC **构造成功也可能跨窗口/分区不通**，所以：

- **双通道都要保留订阅与去重**，不能只判断构造抛错。
- 兜底要覆盖「BC 构造成功但不互通」这种情况；实际请求要能经另一通道完成确认。
- 独立窗口 / 真实 App iframe 的 sandbox 取值与窗口 partition **仍未实测**（§5），
  不能把普通 Chrome fixture 叫作真实 Hana 卡片。

---

## 2. Q3a/Q3b · 卸载通知与后台节流

### 2.1 卸载通知（Q3a）— **不可靠，必须按不可靠设计**

契约原文（`APPS_EN.md:1929`）：

> Registrations are **session runtime state**: they survive turns, and Server snapshots restore
> them after client refreshes… **the host does not persist iframe DOM** or unsubmitted control values.

仓库里也有一条同源的实战注释（`ui/app.js:4091`）：

> 有些宿主拆 iframe 时**不派 pagehide/visibilitychange（直接移除节点）**，
> `unload` 也不保证 —— 所以真正靠得住的是上面的**周期落盘**。

**判定**：不能把"收到 pagehide"当作"对端已停止出声"的证据。
这也正是 §4 里"要确认回执、不能靠超时宣告死亡"的直接依据。

### 2.2 后台节流（Q3b）— **有，且宿主会主动降级**

`hana.lifecycle` 的存在本身就是证据。SDK 源码（`ui/sdk.js:252-316, 610-720`）实证：

```js
// hana.lifecycle.getSnapshot() → { visible, active, maxFrameRate, motion, slot, reason }
//   active = visible && maxFrameRate > 0
//   motion = active ? "full" : "paused"
// 宿主通过 URL query 下发初始值：hana-visible / hana-max-fps
// 运行中由 visibility-changed 消息持续更新 → 触发 lifecycleSubscribers
```

宿主侧把这两个参数列为**受保护 query**（`bundle/index.js:153867-153868` 的 `ndn` 集合），
说明它们是宿主主动管理的一等通道，不是巧合。

**判定**：

- 隐藏 / 后台的 iframe **确实会被降级**（`active: false`、`motion: "paused"`、
  `maxFrameRate: 0`），且 SDK 自己会 `cancelAnimationPump()`。
- 但 `setTimeout` / `setInterval` **不在 SDK 的节流范围内** —— SDK 只管 rAF 的 pump。
  真正会掐定时器的是 **Chromium 的后台标签节流**（与宿主无关，浏览器普遍行为）。
- **对 Q3 的含义**：Codex 提的"owner 每 2 秒推送续租"在后台 iframe 里**可能被浏览器节流到
  1 分钟级**。所以"续租迟到 → 判定死亡"这个判据**不可靠**，Codex 自己也指出了这一点，我同意。
  但结论要更强一点：**不是"15 秒阈值不能判死亡"，而是"任何纯超时判据都不该单独判死亡"**。

### 2.3 判"还活着"靠什么 —— 我原稿这条**错了**

⚠️ **本节原结论已被 Codex 复核推翻。**

我原来说：`hana.lifecycle.active` 是"对端是否还活着"的权威信号。**这是错的。**
`ui/sdk.js:252-264` 里 `active = visible && maxFrameRate > 0`，`getSnapshot()/subscribe()`
只返回**当前这份文档自己**的 runtimeSnapshot，没有跨实例成员表、没有对端查询。
它是**本实例的绘制状态**，不是对端存活证明：`active: false` 可能是隐藏、可能只是停了绘制，
不能推出对端已死亡，更不能推出对端媒体已静音。

**修正后的判断**：

- `hana.lifecycle` 只能用来**减少自己的动画绘制**（本实例降级时别再空转），
  或作为探查元信息；**不能用来授权跳过音频交接**。
- 判"对端是否已让位"的唯一可用证据是 **BroadcastChannel 的 `yielded` 回执**，
  且该回执必须绑定**本次 claimId / owner generation**，过期的 yielded 不能解锁下一次 play。
- 对端真正消失后的**自动恢复协议**仍未定（见 §8），不能靠普通超时证明。

---

## 3. A · 严格"任一时刻只一个出声"的可行做法

Codex 提的竞态我确认成立且必须处理：

> 仅 storage set→get 后 play 存在 A/B 都读空、先后各读回自己而短暂双响的竞态。
> 严格"任一时刻只一个出声"需要旧 owner 已暂停的确认；通知发出不等于已静音。
> 超时直接宣告死亡也不能证明旧 iframe 停了。

**我的建议（按证据强度排序）**：

1. **确认回执（首选，方向正确）**
   被动暂停处理完成后 → 广播 `{ type: 'yielded', claimId, ownerGeneration, to }`。
   新 owner 收到**匹配本次 claim** 的回执才 `play()`。
   ⚠️ **修正**：原稿说"`pause` 事件同步派发，确认即等价于已静音"——**错**。
   Codex 实测（`AUDIO-OWNER-PROBE-REVIEW.md` §4）：`pause()` 返回时 `paused=true` 但
   `pauseEvents=0`，事件随后排队；**已经 paused 时再 pause 不发新事件**。
   所以不能盲等某个 `pause` 事件，也不能把普通用户 pause 事件无条件当成本次 claim 的回执。
   正确做法：先取消待起播与过时异步回调，核对 `audio.paused === true`，再发 yielded；
   回执要**幂等**、要绑定 claim generation。

2. **超时（不能作为强制起播的授权）**
   ⚠️ **修正**：原稿建议 150–300ms 未回执即"强制抢占"——**错，且危险**。
   那 30 个 RTT 样本是**正常同源页面**的观测，不是最坏调度上限；没测真实媒体 pause 事件、
   后台主线程阻塞、跨独立窗口或分区隔离。未回执可能是**通道不通**（见 §1.3 反例）、
   消息/事件延迟、或 JS 主线程忙，而**旧 audio 仍在响**。
   超时后强制 play 会**重新制造本任务要修的双出声**。
   短超时只能触发**另一通道 / 重试 / 进入待命**，不能自动授权出声。

3. **storage 原子写不等于 CAS（同意 Codex）**
   `AppStorageStore` 的原子落盘保证的是"文件不坏"，不是"比较并交换"。
   两个 iframe 同时 `set` 同一键，后写的覆盖先写的，**都能读到自己刚写的值**——
   这正是 Codex 描述的"A/B 都读回自己"的竞态。**所以：不要用 storage 做抢麦的唯一依据。**
   storage 只负责**持久化 owner 是谁**（供下次 reload 用），不负责**本次谁能出声**。
   本次谁能出声，由 BroadcastChannel 的确认回执决定。

4. ~~**`hana.lifecycle` 排除已死实例**~~ ⚠️ **本条已删**。
   理由见 §2.3：`active` 是本实例绘制状态，不能查对端、不能推死亡；
   且"隐藏 boot 不参与竞争"会新增任务未要求的播放语义，可能破坏后台续播。

---

## 4. B · 验收时点（我确认 Codex 的解释，并给精确时点）

**Codex 的候选解释正确**：

> A 的被动暂停/卸载/延迟快照绝不能写 true，B 作为当前 owner 可以写 true。

**但"§7 第二条"的原文需要修正**，否则验收时会按字面误判。原文：

> 2. A 在播 → B 起播 → A 变 `paused` 且**盘上 `playing` 不为 true**；

照字面读，B 正在播时盘上应是 `playing: false`，那就和 B 自己 reload 后续播矛盾（Codex 已指出）。
**准确表述应为**：

| 时点 | 盘上 `playing` | 说明 |
|---|---|---|
| A 在播 | `true`（owner = A） | 正常 |
| B 抢麦，**A 尚未 pause** | 仍为 `true`（owner 仍是 A） | 交接进行中，不该要求为 false |
| **A 收到接管通知并 pause 之后** | **A 不得再写 `true`**（且 A 的 `snapshot()` 里 `unloading && 刚还在播` 那条必须被关掉） | 这是要防的"复活链" |
| B 起播成功后 | `true`（owner = B） | B 是现任 owner，写 true 天经地义 |
| 全停（无 owner） | `false` | 正常 |

**所以验收要断言的不是"某个瞬间 playing 不为 true"，而是这条单调性**：

> **在 A 已 pause 之后、B 尚未接管之前的窗口里，A 的任何一次写盘都不得产生 `playing: true`。**

可操作断言（建议 Codex 直接采用）：
1. A 在播 → 记 A 的 `ownerId`；
2. B 抢麦 → 等 A 收到 `yielded` 并 pause；
3. **此刻强制 A 触发一次 `persistNow()`（或模拟 pagehide）** → 读盘 → **`playing` 必须为 `false`**；
4. 断言 B 侧 `playing === true` 且 `ownerId === B`。

第 3 步是关键：它直接打在"被动暂停后卸载会把 playing 写回 true"这条复活链上，
比"某个时刻不为 true"精确得多，也不会误伤 B 的合法写入。

---

## 5. Q2 未测 · 实际限制（照实报告，不凑数）

Codex 要求"≥30 次、p50/p95/max、同值广播次数、自写回调、乱序与重复"的逐样本数据。
**这一条本次没跑出来，原因照实说明**：

- 我起了**隔离宿主**（`HANA_HOME=/tmp/aoprobe/home`，独立端口 39268，生产宿主 PID 44333 全程未动），
  自研探针 App `ao-probe` **已成功装载**（日志：`plugin "ao-probe" v0.0.1 loaded`、
  `app route app "v2-ao-probe" registered`）。
- 但**宿主凭证链没打通**：所有 `/api/apps/*` 请求返回
  `{"error":"forbidden","reason":"missing_credential","connectionKind":"local"}`。
  凭证走 `Authorization: Bearer <loopbackToken>` 或设备凭证 cookie，
  而隔离 home 的 `device-credentials.json` 是空数组，`loopbackToken` 未在日志中明文输出。
- 我**没有**为了凑齐实测去绕过鉴权、伪造凭证或动生产 `~/.hanako` 的凭证文件 ——
  这正是 Codex 交代的"不要为凑齐实测绕过审批"。

**因此 Q2 的延迟数据、同值广播次数、乱序情况：标注为「未测」。**
已确认的只有契约层面的定性结论（上一轮 `MOOD-HOST-PROBE.md` 已实测过"后端写入会无条件广播、
同值也触发"，那份是真机验证过的，可引用）。

### Q1d 卡片↔独立窗口：同样标注「未测」

隔离宿主无桌面窗口，无法开独立窗。**原稿曾推断"同源下与卡片↔卡片同一机制"——
该推断随 §1.3 的修正一并撤回**：BC 的分区/互通取决于真实安全源与窗口 partition，
必须实测，不能从"同源"推。**没有实测证据，不冒充已验。**

---

## 6. Q4 · 仲裁落点（同意 Codex，补一条）

**同意**：独立 `hana.storage.global` 新键 + 后端串行仲裁，不用 `playback.json` 加字段。
理由与 Codex 一致：`playback.json` 只投影固定字段，且**原子写 ≠ CAS**。

**补充一条**：`ownerId` 只需持久化，**抢麦本身走 BC + storage 双通道**（§1.4）。即：

```
持久化：storage.global["player-audio-owner"] = { ownerId, at }   // 只管"下次 reload 谁续"
本次抢麦：BC 广播 claim → 等匹配 claimId 的 yielded → 才 play()
         BC 不通 → 同一 claim 经 storage.onChanged 通道重发/确认（双通道都订阅）
权威发证：同时 boot 无旧 owner 时，claim/yielded 本身没有唯一发证者
         → 仍由 App 后端串行仲裁发唯一授权，BC/storage 只负责传输与回执
```

⚠️ **修正**：原稿写"BC 不可用 → 退化到 storage"，暗示兜底只在 BC 失败时启动；
按 §1.3 应改为**双通道并存**。另外：**同时启动且没有旧 owner 时，claim/yielded 没有
唯一发证者**，A/B 可能各自认定"无回应"而都起播——所以后端串行仲裁仍是唯一授权的来源。

---

## 7. Q5 · 我已复核

Codex 在 `/tmp` 最小镜像实跑 `bump-build.mjs`，三处 `1003131675 → 1003131676`。
我在原仓库复核：

```
ui/_build.json = {"build":"1003131675"}
shasum ui/app.js        934fef61…  (未变)
shasum ui/index.html    0520d2c2…  (未变)
shasum ui/standalone.html c72c8057… (未变)
manifest.json version = 1.1.0
git diff HEAD → 空；git status → 仅新增文档
```

**一致**，`bump-build.mjs` 三处同步没问题，且原仓库确实未被改动。

---

## 8. 给 Codex 的待办与未验项

1. **Q1d（卡片↔独立窗口）未测**：等真机验收时我来补（需要装好 1.1.1 并 reload）。
2. **Q2（onChanged 逐样本）未测**：若仍需要精确数据，可在**真机验收阶段**用临时探针
   App 在**生产宿主**里跑（那时凭证现成）。⚠️ **修正**：原稿说"Q2 已不决定方案主次"——
   过头了。Q2 的数值现在**仍需要**，因为 §1.3 的反例说明 storage 兜底通道**必须真的能用**，
   而它的延迟/去重/自写行为**完全没有实测**。
3. **§4 的验收断言请按"单调性"版本写**（Codex 复核 §6 已把时点细化成可控制步骤，采纳）。
4. **孤儿 owner 自动恢复协议仍未定**：ownerId 每份文档新生成，reload 后一般 ≠ 旧 ownerId，
   所以不能用"owner 就是自己"保证普通 reload 续播；同时满足"单实例 reload 即续播"和
   "严格唯一出声"，不能靠普通静默超时证明。这一条留待实现前拍板。
5. 我这边全程未改任何源码/断言/manifest，未 reload，未碰 `app-data`。
   生产宿主 PID 44333 健在，仓库 `git diff HEAD` 为空。

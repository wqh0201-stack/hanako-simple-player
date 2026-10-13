# 05 · 播放器集成探查：前端协议 + 后端仲裁 + 孤儿自愈落点

> 执行：哦鲸鲸（并行探查分身）。日期：2026-10-13。范围：**只读审计**，未改任何生产代码 / 断言 / manifest / 版本 / build / app-data，未部署、未 reload、未跑测试。
> 契约基准：任务书 `docs/TASK-audio-owner-1.1.1.md`、返修 `docs/player-ui/handoffs/AUDIO-OWNER-ORPHAN-REPAIR.md`、验收 `docs/player-ui/handoffs/AUDIO-OWNER-ACCEPT-1.1.1.md`、宿主探查 `docs/player-ui/handoffs/AUDIO-OWNER-ORPHAN-HOST.md`。
> 源码快照：工作树 `ui/app.js` sha256 `b1dc00af…67eb7`、`lib/audio-owner.js` sha256 `2bc770ee…47b87d`、`lib/register-routes.js` sha256 `ed12c1f7…2b801`。**HEAD = `e9fcf99`，但 1.1.1 audio-owner 实现与在途 mood-onestep 改动均为未提交状态**（见 §6）。
> 行号口径：**对当前未提交工作树**（不是 HEAD）。`ui/app.js` 7902 行、`lib/audio-owner.js` 101 行。

---

## 0. 一句话结论

死锁的**充分条件**是：`lib/audio-owner.js` 里没有任何动作能清掉一条**非自己 own** 的 owner 记录——`yield`（54–60）、`handoff`/`release`（70–81）都要 `owns()`（32），`stop`（62–68）在「别人 own」时只写一个 `pending:{ownerId:''}` 而**不落清**；于是前端唯一的接管入口 `claimAudio` 在 `restore` 时被后端第 **47** 行直接挡回、用户态 claim 只能落成 pending（50–52），全链路永久锁死。两条自愈路径的**最小落点高度重合**：都落在后端 `claim` 分支（46–52）的**前置清点**与 `stop` 分支（62–68）的补口上，前端只在 `initAudioOwner`（355–369）与 `claimAudio`（370–386）各加一处「证明传递」；既有语义（`owns()` 门槛、后来者自动赢、单实例不变）可原样保留。

---

## 1. 前端协议地图（`ui/app.js`，带行号）

### 1.1 状态量（声明 261–267）

| 变量 | 行 | 含义与流转 |
|---|---|---|
| `ownerId` | 261 | 本**文档**自生成的实例 ID（`Date.now().toString(36)+random`）。**每次文档加载都重新生成**——跨 reload 一定是新 ID，这是「同实例重启 owner 就是自己」那条分支实际不可达的原因。 |
| `ownerGeneration` | 262 | 本实例被后端确认的授权代。`0` = 无出声权。只有 `authoritative && record.ownerId===ownerId && !pending`（328–329）或后端 reply 后由 `observeOwner` 置上；被抢（323–324）、被 stop（334）、yield（315）、teardown（4275）都清零。`snapshot()` 与 `requestPlay` 都拿它当「我能不能出声」的门。 |
| `ownerRecord` / `ownerRecordKey` | 263 | 最近一次见到的 owner 记录 + 其 JSON 串（用于内容比较 `changed`）。 |
| `ownerSelfKey` | 263 | **自写标记**：`publishOwner`（278–284）广播前记下自己刚提交的记录串，BC 回环时用来精确丢弃自己的消息。 |
| `ownerChannel` / `ownerSubscription` | 264 | BC 通道句柄 / storage 订阅 disposer。 |
| `ownerYieldId` | 264 | 正在处理的让位 claimId，防重复 yield（311–319）。 |
| `ownerSequence` / `audioRequestGen` | 265 | 请求序号（生成 claimId）/ **请求代**（`requestPlay` 每次 `++`，任何 async 回调靠 `token !== audioRequestGen` 判废）。 |
| `ownerWaiting` | 265 | 等待让位结果的一次性 promise 槽（`{claimId,resolve,timer}`），由 `finishOwnerWait`（297–303）收尾。 |
| `needsTakeover` | 266 | **被动失去出声权**标记：为真时 `snapshot().playing` 恒假（447）、`requestPlay` 前置检查失败、`renderResume` 显示「接管播放」。由 `pauseForOwner(takeover)`（292）置位。 |
| `restoreAwaitHandoff` | 266 | 「本次 restore 抢麦被挡、在等旧 owner 交接」标记。置位后只有 `observeOwner` 336–337 那条（record 清空 + `resume` 为真）会触发 `requestPlay('restore')`。**孤儿场景下永不成立**（record 的 ownerId 永不清空）。 |
| `ownerTearingDown` | 266 | 卸载交接中；期间所有 `requestPlay`/`claimAudio` 直接 return false（373/391）。 |
| `activePlayIntent` / `teardownResumeIntent` | 267 | 起播在途 / 卸载时的续播意图（给 `flushOnTeardown` 4260 与 pageshow 4292 用）。 |

### 1.2 协议函数

- **`ownerCommand(input)` 271–277**：POST `/api/audio-owner`，成功则 `publishOwner`（广播）+ `observeOwner(record, true)`（**权威**）。这是唯一把后端记录标为 authoritative 的入口。
- **`publishOwner(record)` 278–284**：记 `ownerSelfKey`，BC `postMessage`。**只广播，不授权**。
- **`pauseForOwner(takeover)` 285–296**：`++audioRequestGen; ++resolveGen`、清 `pendingAutoplay/activePlayIntent/seekRetryTimer`、**`lastPlayingAt=0`**（关键：关掉「卸载刚还在播」那条写回，§4.3 要求的第 3 点就落在这里）、`state.playing=false`、`needsTakeover=takeover`、`audio.pause()`、重渲染。
- **`finishOwnerWait(allowed)` 297–303**：结算 `ownerWaiting`。
- **`observeOwner(record, authoritative)` 304–339**：协议核心，逐支：
  - 306 单调性：`record.revision < ownerRecord.revision` 直接丢（防乱序）。
  - 310–319 **我方是 owner 且有人排队**：`pauseForOwner` → 清 generation → POST `yield`（带 snapshot）。失败只清 `ownerYieldId`，不假装让位完成。
  - 322–324 **别人是 owner 且内容变了**：若我还在出声则 `pauseForOwner` → 清 generation。
  - 326–329 权威且无 owner → 清 generation；权威且 owner 是我且无 pending → **置 `ownerGeneration=record.generation`**，并结算 `ownerWaiting(true)`。
  - 330 有 pending 且 pending 不是我的 → `finishOwnerWait(false)`。
  - 331–335 record 清空且 `cause==='stop'` → 复位待命。
  - 336–337 record 清空且 `resume` 为真且 `restoreAwaitHandoff` → `requestPlay('restore')`（**续播的唯一自愈口，孤儿时到不了**）。
- **`refreshAudioOwner()` 341–345**：GET 读回，成功即 `observeOwner(record, true)`。读失败不授权。
- **`subscribeAudioOwner()` 346–354**：`hana.storage.global.onChanged`，只看 `player-audio-owner` 键，命中即 `refreshAudioOwner`；订阅后补一次读（352）。**常驻**（BC 不可靠时的兜底）。
- **`initAudioOwner()` 355–369**：构造 BC（357–365，`try/catch` 包住）；`onmessage` 内容比较 + 自写标记双收敛（360 `ownerKey(record)===ownerSelfKey` 丢弃自写），非权威 `observeOwner(record,false)`，然后 `refreshAudioOwner()` 让后端确认（BC 不能自封授权）；最后 `subscribeAudioOwner()`。**boot 第一行调用（7366）**。
- **`claimAudio(reason, token)` 370–386**：POST `claim`。`reply.granted` → true；否则 `needsTakeover=true` 并渲染。**376 是死锁的前端入口**：`reason==='restore'` 时置 `restoreAwaitHandoff=true` 后直接 `return false`（**不再等**，只等后端/BC 后续通知）。用户态则挂 1500ms 一次性回读（379–382），到期 `finishOwnerWait(false)`。
- **`requestPlay(reason)` 387–409**：`++audioRequestGen` 取 token；`claimAudio` 成功后 `audio.play()`，成功即 `persistNow()`；失败走 `onAutoplayBlocked` 并 `release`（403–404）。**这是唯一真正让声音出来的地方。**
- **`pauseAll()` 411–417**：用户主动暂停 → `pauseForOwner(false)` + POST `stop`。**所有实例都停**（§2 语义）。

### 1.3 `snapshot().playing` 判定与续播判定

- **`snapshot()` 443–…，playing 在 447**：
  `playing = !needsTakeover && !!ownerGeneration && (state.playing || (unloading && lastPlayingAt && Date.now()-lastPlayingAt < 1200))`。
  三道门：`needsTakeover` 为真（被抢）恒假；`ownerGeneration` 为 0（无授权）恒假；`unloading && 刚还在播`（拖进/拖出续播）保留。**被接管实例的 `pauseForOwner` 已把 `lastPlayingAt=0`，所以这条写回通路已被 §4.3 关掉**。
- **`flushOnTeardown()` 4257–4281**：`snap.playing` 另算（4260，用 `state.playing||activePlayIntent`），`ownerTearingDown=true`、`unloading=true`，`pauseForOwner`，若 `generation` 非 0 则 `sendBeacon`/`keepalive` POST `handoff`，最后清 generation、退订、关 BC。挂在 `pagehide`/`unload`/`beforeunload`（4283–4285）。
- **`restorePlayback(pb)` 7280–7363**：设 `wantPlay = !!pb.playing`（7334）、`state.playing=false`（7335），`t.url` 则 `loadAudio(t, state.progress, wantPlay, 'restore')`（7341）；无 url 走 `ensurePlayable` 后 `loadAudio(..., true, 'restore')`（7355）。**注意：它自己不调 `requestPlay`**，真正的抢麦在 `loadAudio` → `scheduleSeekRetry` → `maybeResumeAutoplay`（4330–4336）里异步发生。
- **`maybeResumeAutoplay()` 4330–4336**：`pendingSeek` 到位/放弃后，若 `audio.paused` 则 `requestPlay(pendingPlayReason)`。**启动续播的实际抢麦点**。

### 1.4 起播调用点清单（`requestPlay(...)` 全量）

| 行 | 场景 | 备注 |
|---|---|---|
| 338 | `observeOwner`：等待交接中，record 变空且 `resume` 真 | 续播自愈口，孤儿时不可达 |
| 4245 | `loadAudio`：同一首 + 待起播（恢复场景） | 直接起播 |
| 4292 | `pageshow`：文档从 bfcache 回来（`ownerTearingDown` 复位） | `requestPlay('restore')` |
| 4332 | `maybeResumeAutoplay`：落点到位后 | restore / 换曲 autoplay 的公共出口 |
| 4511 | mediaSession `on('play')`（系统媒体键） | `'media'` |
| 4598 | `onTrackEnd` 单曲循环（`mode==='one'`） | `'repeat'` |
| 4701 | `$('playBtn')` 点击（`audio.paused` 时） | `'user'` |
| 4709 | `$('resumeBtn')` 点击 | `'resume'` |

**间接通路**（都汇到 4332）：`playTrack` 4647 → `loadAudio(..., true)` 4681/4689 → `scheduleSeekRetry` → `maybeResumeAutoplay`；`restorePlayback` 7341/7355 → 同上。

### 1.5 「接管播放」chip（`renderResume` 2116–2123）

`btn.hidden = !state.needsResume && !needsTakeover`（2119）；文案 `needsTakeover ? '接管播放' : '继续播放'`（2121）。两个语义共用同一 chip：自动播放被拦（`state.needsResume`）与被抢待命（`needsTakeover`）。**两者可同时成立时按 `needsTakeover` 优先显示「接管播放」**。点击都走 `requestPlay('resume')`（4709）。

### 1.6 BroadcastChannel 的实际用法（357）与收敛

- 通道名 `'hana-simple-player-audio'`（357），`try/catch` 包住构造（356/367）。
- 发送端：`publishOwner` 278–284 —— **先** `ownerSelfKey = ownerKey(record)`，**再** `postMessage`。
- 接收端：`onmessage` 358–365 —— 若 `ownerKey(record) === ownerSelfKey` 直接丢（**精确自写标记**）；否则非权威 `observeOwner(record,false)` + `refreshAudioOwner()`（BC 不授权，仍要后端确认）。
- **三重收敛**：① 自写 key 精确丢弃（360）；② `observeOwner` 的 `revision` 单调丢弃（306）；③ `changed` 内容比较（307）——「内容比较 + 自写标记」即此。注释 359 明确写「接收者从不再 claim」，即收到广播只做 observe，不反手抢麦，避免 A↔B 抖动。

---

## 2. 后端状态机地图（`lib/audio-owner.js`）

单例串行链（`serial` 11–15），`current` 内存缓存 + `storage.global[AUDIO_OWNER_KEY]` 持久化。记录形状 `{ownerId, claimId, at, revision, generation, pending, resume, cause?}`。

- **`load()` 16–22**：内存优先，否则读盘；形状不合法回落空记录（`ownerId:''`）。
- **`owns(record,input)` 32**：`record.ownerId===input.ownerId && record.generation===Number(input.generation)`。**一切让位/交接/释放的硬门槛**。
- **`grant` 33 / `cleared` 35**：`revision+1` 且 `generation=revision+1`（代与版本同步递增）；`cleared` 带 `cause`。
- **`result(record,input)` 37**：`granted = owns(record,{...input,generation:record.generation}) && !record.pending`。

`command(input)` 42–84 各 action：

| action | 行 | 门槛与效果 |
|---|---|---|
| `claim` | 46–52 | ①**47 restore 守卫**：`reason==='restore' && (record.ownerId\|\|record.pending) && record.ownerId!==ownerId` → **直接 return（不改盘）**。②48 自己已 own 且无 pending → 直接 granted。③49 无 owner → `grant`。④50–52 别人 own → 写 `pending{ownerId,claimId,fromGeneration}`。 |
| `yield` | 54–60 | 需 `owns` **且** `pending.claimId===input.claimId`；否则原样返回。落盘 `playing:false` 后按 pending 转 `grant` 或 `cleared`。 |
| `stop` | 62–68 | `owns(record,input) \|\| !record.ownerId` → 落 `playing:false` 并 `cleared`；**否则（别人 own）只 `revision+1` 写一个 `pending:{ownerId:'',claimId:input.claimId}`（67–68），记录仍被别人占着**。 |
| `handoff`/`release` | 70–81 | 需 `owns`；否则原样返回（72）。有 pending 时完成那次让位；无 pending 时 `cleared`，`handoff` 可带 `resume`（78）。 |

**`savePlayback` 接受条件（85–93）**：`record.revision===0`（旧包迁移）**或** `(!ownerId && !pending && !resume && !snapshot.playing && !!input.ownerId)`（无主时只接受「非在播」写）**或** `(owns(record,input) && record.ownerId && !(record.pending && snapshot.playing))`（自己 own 且不覆盖他人排队中的在播写）。

### 2.1 哪些动作永远清不掉非自己 own 的记录（死锁根因）

**清记录（写回 `ownerId:''`）的出口只有三个，全都要求 `owns()`：** `yield` 54–60、`handoff`/`release` 70–81，以及 `stop` 的 `owns||!record.ownerId` 分支 63–65。一条孤儿记录（`ownerId = 已死文档`）的 `generation` 是旧文档的，新文档 `owns()` 恒假：

- `yield`：55 行 `!owns` → 原样返回。
- `handoff`/`release`：72 行 `!owns` → 原样返回。
- `stop`：63 行 `owns||!record.ownerId` 皆假 → 走 67–68 的 else，只把 `pending` 置成 `{ownerId:''}`，**记录仍被孤儿占着**，且这个空 pending 还会挡住后续 claim 的 49 分支。
- `savePlayback`：89–90 两条接受子句都不满足（非 `owns`、record 有 ownerId）→ 拒写。
- `load()` 只在**形状非法**时回落空记录（19–20），孤儿形状完全合法，不会被清。

**结论**：只要「记录的 ownerId 是一个不再存在的文档」，就没有任何请求能把它变成空。前端的 `claimAudio`（restore）被 47 行挡回、用户态 claim 落成 pending（50–52），`restoreAwaitHandoff` 等的那条自愈（336–337）永不到达 → 单实例也一样卡在「接管播放」。这就是 `AUDIO-OWNER-ACCEPT-1.1.1.md` §3 的机制级根因。

---

## 3. 最小改动落点

两条路径共享同一个后端「清点」位置；差异只在「死亡证明」从哪来。**两条都不需要动 `owns()`、不需要动 `yield`/`handoff` 的语义。**

### 路径 A · 宿主文档生命周期（`active/ended/unknown`）

证明来自宿主，最强、最符合返修 §5。当前公开面**没有**此接口（`AUDIO-OWNER-ORPHAN-HOST.md` §1–§3），所以是「待接口」路径。

- **后端 `lib/audio-owner.js`**
  - `createAudioOwner` 签名（9）：新增一个 `documentStatus(docId)` 依赖（与 `writePlayback` 同形）。
  - `claim` 分支 **46–52**：在 **47 行的 restore 守卫之前**插入清点——若 `record.ownerId` 且其文档被权威判为 `ended`，先 `commit(cleared(record, false, 'reap'))` 把记录清掉，再让流程自然落到 49 行 `grant`。这是**保留「后来者自动赢」的唯一位置**（活 owner 走 50–52 的 pending→yield 老路；死 owner 走清点）。
  - `stop` 分支 **62–68**：给 63 行补一个 `|| documentEnded(record)` 逃生口，让非 owner 也能清孤儿（覆盖「没有 pending、用户只想点一下恢复」）。
  - `load()` **16–22 不改**（`read` 走 GET，读不应有清盘副作用）。
  - 清点必须**同时**递增 `revision/generation`（复用 `cleared` 35 的语义），使旧代延迟回包（yield/handoff/savePlayback）全部失效。
- **后端 `lib/register-routes.js` 1456–1461**：把宿主文档状态解析器注入 `audioOwnerFor`（与现有 `writePlayback` 注入并列）。
- **前端 `ui/app.js`**
  - `initAudioOwner` **355–369**：取宿主给的 `documentId`（+其生命周期代）存一个新变量（声明区 261–267）。
  - `claimAudio` **370–386**：每次 claim 带上本文档 `documentId`。**376 行的 restore 早退可以保留**——因为后端清点后 reply 会变成 `granted`，走不到 376。
  - `observeOwner` 无需改：清点后的权威 reply（`ownerId:''`→grant）已由 326–329 正常处理。
  - 净效果：**Path A 可以做到前端近乎零逻辑改动**，自愈全在后端 claim/stop 两处。

### 路径 B · App 内浏览器原语（Web Locks 自动释放）

证明来自浏览器：文档持有一把 `navigator.locks` 独占锁，**文档销毁时浏览器自动释放**；新文档 `ifAvailable` 抢到锁 ⇒ 之前所有持有者已死。不需要宿主新接口，但**依赖跨文档同源/同分区**（与 BroadcastChannel 同一个未知，见 §5）。

- **前端 `ui/app.js`**
  - `initAudioOwner` **355–369**：`navigator.locks.request('hana-simple-player-audio-doc', {mode:'exclusive'}, …)` 持到文档结束（回调里挂一个不 resolve 的 promise）；拿不到 `navigator.locks`（或构造抛错）→ **退化为现状**，不得报错（照 BC 的 `try/catch` 模式）。记一个 `ownerDocLockHeld` 布尔（声明区）。
  - `claimAudio` **370–386**：当 `ownerDocLockHeld` 且 `ownerRecord.ownerId` 非自己时，在 claim payload 里带 `reap:true`（「我持有文档锁 ⇒ 除我以外都是死的」）。
  - `flushOnTeardown` **4257–4281**：**不要**提前释放锁（显式交接已由 `handoff` 完成；锁留到文档死才是证明源）。`pageshow` 4289–4297 的 bfcache 复位不释放锁，天然正确。
  - ES5 约束：app.js 禁 `let/const/箭头/模板串`（AGENTS §3.4），锁代码须用 `var`/`function`/`Promise`。
- **后端 `lib/audio-owner.js`**
  - `claim` 分支 **46–52**：在 47 行守卫前加：若 `input.reap===true` 且 `record.ownerId!==input.ownerId` → `commit(cleared(record, false, 'reap'))`，再走 49 行 `grant`。**与路径 A 同一落点**，只是证明字段不同。
  - `stop` 62–68 同样补一个 `|| input.reap` 逃生口（可选，覆盖无 pending 的手动恢复）。
  - `owns()`（32）与 `yield`/`handoff`（54–60/70–81）**一字不改**。
- **信任边界（必须写进交接）**：锁是浏览器强制的（第二文档抢不到），但后端**只能采信客户端的 `reap` 声明**，无法自证。这比宿主签发的 `ended` 弱，属「本机单用户 App 可接受、非密码学保证」的取舍，需与返修 §5「客户端不能自报新代绕过检查」对齐后拍板。

### 两路径共同要保留的语义

- **后来者自动赢**：活 owner 仍走 50–52 `pending` → `yield`（54–60）自动停；死 owner 走清点。清点**只在权威证明下**触发。
- **活 owner 不误抢**：`active`/`unknown`/抢不到锁 → 一律维持现状（待命），不放宽超时。
- **单实例不变**：`ownerId` 每次文档加载重新生成（261），所以**单实例 reload 也走「跨文档」路径**——正是本次要修的场景。首启无孤儿时，清点不触发，行为与现状逐位相同。
- **硬约束**：孪生 HTML 内容仍须一致（只差 `data-shell`；本次两者都不含 owner 代码，只随 build 号变）、`node tools/bump-build.mjs`、整包同步 `ui/`、前端零构建 ES5、禁 `position:fixed`、禁 emoji。

---

## 4. 风险与回归点

### 4.1 对照 §4.5「单实例行为必须完全不变」

- 最大回归靶：**同一文档内重抢**（`record.ownerId===ownerId`，48 行 granted）路径**不得**被清点影响——清点条件必须是「`record.ownerId` 非自己且证明权威」。
- 首启（record 空）：清点不触发，`restorePlayback`→`maybeResumeAutoplay`→`requestPlay('restore')` 与现状一致。
- 自动下一首 / 切歌 / 连播（`onTrackEnd` 4594、`playTrack` 4647）：只要 generation 正常授予，链路不变。
- 拖进/拖出续播（`unloading && lastPlayingAt<1200`，447）：`pauseForOwner` 已清 `lastPlayingAt`，清点不得新增对该条的写回。

### 4.2 对照 §7 验收标准与既有断言（`tools/verify-audio-owner.mjs`）

| 断言（行） | 风险 |
|---|---|
| `lost-handoff-remains-standby-no-timeout-play`（166） | **最高风险**。它要求「丢弃交接后保持待命」。路径 B 下若夹具用「关掉旧页」模拟死亡，锁自动释放 → 清点触发 → 该断言会翻面。必须明确：**证明不可得时仍待命**；测试需区分「旧页仍活（锁仍被持）」与「旧页真死」。 |
| `paused-grantee-close-releases-permit`（161） | 关闭暂停中的接管者 → `record.ownerId` 应变空。路径 B 下锁释放与之一致，但要保证 `revision/generation` 递增符合该断言预期。 |
| `simultaneous-boot-one-voice-*`（110） | 两文档同 boot：锁只有一个持有者，**不得两边都清点**（否则可能双出声）。证明作用域必须绑定「持锁者」。 |
| `takeover-pauses-preserves-progress`（117）/ `passive-snapshot-false-owner-snapshot-protected`（119）/ `takeover-chip-visible`（120）/ `chip-reclaims-one-voice`（130）/ `manual-pause-stops-all`（132） | 依赖 50–52 pending→yield 与 `savePlayback` 接受条件（89–90）。清点**不得**改动这两处对活 owner 的行为。 |
| `late-grant-does-not-play-after-wait-ended`（159） | 清点必须递增 generation，使旧代延迟回包失效。 |
| `single-reload-explicit-handoff-resumes`（140） | 显式交接路径不变；修好后「无交接的 reload」也应被清点覆盖（新增收益）。 |
| `single-reclick-current-keeps-playing-state`（147）/ `single-auto-next-unchanged`（150） | 单实例回归，见 §4.1。 |

### 4.3 其他牵动

- **`tools/verify-backend.mjs`（基线 114/114）**：`audio-owner` 单测若直接断言 `command` 的 action 集合，新增证明字段/动作须**追加式**，不改旧行为。
- **`tools/verify-ui.mjs`（基线 376/376）**：改 `ui/app.js` 有引入新红的风险；已知唯一 flaky 是 `ripple-max-midhigh-keeps-steady-and-silence-quiet`（headless 下会飘），**不得为消红改松断言**。
- **`savePlayback` 接受条件（89–90）**：清点后 record 变 `ownerId:''`，随后 grant 使 `owns()` 成立——确认「清点→grant→首次 persistNow」这条新序列不触发拒写。
- **`stop` else 分支（67–68）**：给 stop 补清点口时，别把「别人 own 的活 owner」也写进空 pending，破坏 `manual-pause-stops-all`。
- **`result()` 37 的 granted 语义**：确认「同一 command 内先 `commit(cleared)` 再 `grant`」时 `granted` 判定用的是新 record。
- **版本/构建**：`manifest.json` 现 `1.1.1`、`ui/_build.json` `1003131679`；mood-onestep 在途把 1.1.1 让给了 audio-owner 并改号到 1.1.2（`git log e9fcf99`）。落地前先与在途改动对号，避免版本撞车。
- **孪生与整包**：改 `ui/app.js` 必跑 `bump-build`，同步 `index.html`/`standalone.html`/`style.css`/`_build.json` 整包（验收方 §2 的部署口径）。

---

## 5. 未核实项

1. **未跑任何测试**：本报告是纯静态只读审计，`verify-backend`/`verify-ui`/`verify-audio-owner` 均未执行，基线数字引自验收报告而非本轮实测。
2. **Web Locks 在 Hana iframe / 独立窗口的可用性与同源性**：与 BroadcastChannel 是同一个未知。`channel-contract-20261013-134828-hraqbnft/SUMMARY.md` 明确「真实卡片↔独立窗连通性尚未实测」；若 iframe 是不透明源/不同分区，**路径 B 整体失效**（锁也会像 BC 一样不互通）。**必须先做同源/分区探查**。
3. **Web Locks 在 bfcache / 隐藏 / freeze 时的释放时机**：若隐藏即释放，会把「活但隐藏」的 owner 误判为死 → 双出声（正是要修的 bug）。需专门实测。**未核实**。
4. **宿主是否会提供文档生命周期接口**：`AUDIO-OWNER-ORPHAN-HOST.md` 的结论是当前公开面**没有**（连宿主启动代都证明不了）；路径 A 依赖宿主新增 SDK，**当前不可落地**。
5. **`reap` 声明的可接受性**：与返修 §5「客户端不能自报新代绕过检查」的措辞存在张力，需用户/维护方拍板（本机单用户 vs 强保证）。
6. **行号口径**：全部基于**当前未提交工作树**（HEAD `e9fcf99` 之后的 audio-owner 1.1.1 实现 + 在途 mood-onestep 改动）。`git status` 显示 `ui/app.js`、`lib/register-routes.js`、`ui/index.html`、`ui/standalone.html`、`manifest.json`、`tools/verify-*.mjs` 均有未提交改动，落点需在最终树上重新核对行号。
7. **前端 BC 非权威路径能否引发双重清点**：`observeOwner(record,false)`（364）只 observe 不清点，理论上安全；但路径 B 的 `reap` 若也经 BC 传递需另行论证，本轮**未核实**。
8. **`__playerDebug.audioOwner`（7712）** 当前暴露 `ownerId/generation/record/takeover/playing/paused/progress`，可作验收探针；是否需要加 `docLockHeld`/`documentId` 字段**未定**。

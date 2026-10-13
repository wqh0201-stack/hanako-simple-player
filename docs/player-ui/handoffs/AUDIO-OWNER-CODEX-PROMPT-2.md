# 给 Codex 的 Prompt · 1.1.1 孤儿 owner 死锁返修（第二版，扩查后）

> 由哦鲸鲸整理，2026-10-13。用户选择「先把证据整理成 prompt，路线由本人决定」。
> 用法：**整段复制**给 Codex。若用户只选其中一条轨道，删掉另一节的标题与其内容即可（两节互相独立）。
> 证据目录：`docs/player-ui/handoffs/audio-owner-1.1.1/probe-expanded-20261013-hana/`（8 份），汇总 `docs/player-ui/handoffs/AUDIO-OWNER-ORPHAN-HOST-EXPANDED.md`。

---

# 任务：修复 1.1.1 孤儿 owner 死锁（第二版返修，优先级最高）

## 0. 前置

仓库：`/Volumes/SSD/hanadesk/hanako-audio-player-simple`。唯一需求来源仍是 `docs/TASK-audio-owner-1.1.1.md`；工程纪律见 `AGENTS.md`；协作方式见 `docs/COLLABORATION-HANA-CODEX.md`。开工前按序读：`AGENTS.md` → `~/.hanako/skills/hana-app-creator/SKILL.md` → 最新 `APPS.md`。

先读这三份（本轮新增证据，别再重复探查）：
1. `docs/player-ui/handoffs/AUDIO-OWNER-ORPHAN-HOST-EXPANDED.md`（汇总）
2. `docs/player-ui/handoffs/audio-owner-1.1.1/probe-expanded-20261013-hana/05-player-integration.md`（播放器现状 + 最小改动落点，带行号）
3. `docs/player-ui/handoffs/audio-owner-1.1.1/probe-expanded-20261013-hana/08-weblocks-host-shape-probe.md`（Web Locks 在宿主拓扑下的实测）

**当前状态**：1.1.1 / build 1003131679，真机验收**未通过**（`AUDIO-OWNER-ACCEPT-1.1.1.md`）。孤儿死锁未修。你上一轮的返修（`AUDIO-OWNER-ORPHAN-REPAIR.md`）已确认根因，但当时卡在「宿主公开面没有 ended 证明」。本轮新增了**一条不需要宿主改动的路**（轨道一）。

---

## 1. 要修的现象

宿主重启 / 强制 reload 后旧 UI 文档被直接销毁、来不及 `handoff`，持久化 owner 记录成孤儿（`ownerId` 指向已不存在的文档）；新实例的 claim 只能变 `pending`，永久等一个死掉的 owner 让位 → 所有实例（**含单实例**）卡在「接管播放」，点播放 / 上一曲 / 下一曲全无效，无 UI 入口可恢复。

根因（机制级，已在 `05-player-integration.md` §2.1 定位）：`lib/audio-owner.js` 里清记录的三条出口全要 `owns(record, input)`；孤儿记录的 `generation` 属旧文档，新文档 `owns()` 恒假，所以**没有任何请求能把孤儿记录变空**。

---

## 2. 轨道一（推荐先做）：App 内用 Web Locks 做存活判据

### 2.1 为什么它能成立（规范 + 实测）

`navigator.locks`：锁住在浏览器进程里、按 **storage bucket** 共享；**文档被销毁时由浏览器自动释放**（Web Locks §2.6 + HTML 的 unloading document cleanup steps；规范动机段直接写「tab 崩溃时另一个 tab 会拿到锁」）。
→ 新实例 `ifAvailable` 抢锁：**抢到 = 旧 owner 已死**；**抢不到 = 有活 owner**。不依赖超时、不依赖通知、不依赖宿主接口。
→ 后来者 `steal: true` 原子抢占，旧持有者收到 `AbortError` 并暂停。

已实测（系统 Chrome 155，脚本 `/tmp/weblocks-*.mjs`，原始输出见 `06`/`08`）：
- `http://127.0.0.1` 是 secure context，`navigator.locks` 可用；宿主那套 `sandbox="allow-scripts allow-forms allow-popups allow-same-origin"` 下同样可用。
- **摘掉 iframe（不执行任何卸载 JS）→ 锁自动释放**；跨 tab 共享；`steal` 后旧持有者拿到 `AbortError`。
- **隐藏 / 滚出视口 / 压成 0 尺寸 / 切后台 tab 都不释放锁** → 活但隐藏的 owner 不会被误判为死。
- **复刻宿主拓扑**：主窗（`file://`）里的 App UI iframe 持锁；`window.open('about:blank')` 开的拖出窗里嵌同源 iframe → **看得见那把锁、抢不到**。即卡片与独立窗**同一 storage bucket**（依据：`app.asar` 里两者 `webPreferences` 都无 `partition` → 默认 session；顶层站点同为 `file://`）。
- **前提**：Chromium 第三方存储分区按**顶层站点**分桶（对照实验：顶层若为 `http://127.0.0.1` 第一方就不共享）。宿主现为 `file://` 故成立，但 App 控制不了 → **必须保留「抢不到锁就保守待命」的退化路径**。

### 2.2 最小改动落点（不要扩大）

**前端 `ui/app.js`**（ES5：禁 `let/const`、箭头、模板串、`?.`、`class`）：
- `initAudioOwner`（约 355–369）：探测并持有锁。`navigator.locks.request('hana-simple-player-audio-doc', {ifAvailable:true}, …)`，拿到就持到文档结束（回调里挂一个不 resolve 的 promise），并记一个 `ownerDocLockHeld` 布尔；**拿不到 `navigator.locks`（旧环境 / 非 secure context / 不透明源）→ 原样退化为现状，绝不报错**（照现有 BroadcastChannel 的 `try/catch` 写法）。
- `claimAudio`（约 370–386）：当 `ownerDocLockHeld` 为真、且 `ownerRecord.ownerId` 非自己时，在 claim payload 里带 `reap: true`（语义：我持有文档锁 ⇒ 除我之外都已死）。**只在 `reason` 是 boot/restore 或用户显式起播时带；不要在没有锁时带。**
- `flushOnTeardown`（约 4257–4281）与 `pageshow`（约 4289–4297）：**不要提前释放锁**。显式交接仍由 `handoff` 完成；锁留到文档真正销毁才是证明源。
- 后来者显式起播（用户点播放 / 点 chip）走 `steal: true` 抢占；`AbortError` 落到既有的 `pauseForOwner(true)` 路径。

**后端 `lib/audio-owner.js`**：
- `claim` 分支（约 46–52）：在 **47 行 restore 守卫之前**插清点——若 `input.reap === true` 且 `record.ownerId !== input.ownerId` → `await commit(cleared(record, false, 'reap'))`，再让流程自然落到 49 行 `grant`。这是**保留「后来者自动赢」的唯一位置**（活 owner 仍走 50–52 的 `pending`→`yield` 老路）。
- `stop` 分支（约 62–68）：补一个 `|| input.reap` 逃生口，覆盖「没有 pending、用户只想点一下恢复」。
- `owns()`（32）与 `yield`/`handoff`/`release`（54–81）**一字不改**。
- 清点必须**同时递增 `revision/generation`**（复用 `cleared` 的语义），让旧代延迟回包（yield / handoff / savePlayback）全部失效。

### 2.3 必须保留的语义

- **后来者自动赢**：活 owner 仍走 `pending`→`yield` 自动停；死 owner 走清点。清点**只在权威证明（持锁）下**触发。
- **活 owner 不误抢**：抢不到锁 / 探测失败 → 一律维持现状（待命），**不放宽任何超时**。`steal` 只由显式用户意图触发，绝不用于 boot。
- **单实例行为完全不变**（任务书 §4.5）：首启无孤儿时清点不触发，行为与现状逐位相同。
- **信任边界（写进交接）**：后端只能采信客户端的 `reap` 声明，无法自证。这是「本机单用户 App 可接受、非密码学保证」的取舍；前端必须做到「只有真正持锁才发 reap」，且**绝不**在无锁时发。

### 2.4 测试要求（保留全部既有断言，不许改松）

新增断言至少覆盖：
1. 持锁实例 boot 且盘上 `playing:true` → 起播（续播不变）。
2. 抢不到锁的实例 boot → 待命、`#resumeBtn` 显示「接管播放」、**盘上 `playing` 不为 true**。
3. 显式起播 → `steal` 抢占，旧实例 `audio.paused === true`。
4. **旧文档被销毁（CDP `Page.crash` 或直接摘 iframe，无 handoff）→ 新实例自愈并起播**（这是本次的核心收益，原 1.1.1 缺的就是这条）。
5. **反例 1**：只重建 App 后端、保留旧文档 → 新实例不得自动出声（`ifAvailable` 应拿不到锁）。
6. **反例 2**：禁 BC + 停 storage 通知、旧页继续播 → 不得自动出声；显式 `steal` 才抢，且全过程 `paused === false` 的 audio 数 ≤ 1。
7. 单实例回归：续播 / 连播 / 切歌 / reload 后与开工前一致。

注意：
- 既有 `lost-handoff-remains-standby-no-timeout-play` 的语义要**重新界定**：它测的是「交接丢失 + 旧文档仍活着 → 待命」；若夹具用「关掉旧页」模拟死亡，那是**另一种场景**（现在应自愈）。不要为了让它继续绿而放弃自愈，也不要把「旧页仍活」写成「旧页已死」。
- 既有 `simultaneous-boot-one-voice`：两个文档同 boot，**只有一个能持锁**，不得两边都清点。
- headless 夹具用的是真实 Chrome（`tools/verify-ui.mjs` 已用 puppeteer-core + 系统 Chrome），**可以**构造真两个文档 / 两个 iframe 来测真 Web Locks；做不到就说明卡在哪，不要假造通过。

### 2.5 真机验证（你跑不了，列给 Hana）

1. 整包同步 `ui/` + `lib/`，reload，核对实际 build；保存 owner 记录与 paused 状态时间轴。
2. 单实例播到非零进度 → Cmd+Q 再启动 → 新文档自愈续播，进度保留。
3. 卡片 + 独立窗同时在播 → 强制终止 Hana 再启动 → 无 handoff 也恢复，实际只有一个 `audio.paused === false`。
4. 再点另一实例播放 → 旧的停、新的响、chip 可夺回；主动暂停全停。
5. 只停/重建 App 后端、保留旧渲染文档 → 新实例**不得**出声。
6. 直接销毁当前 owner 的 iframe（不执行卸载 JS）→ 另一个实例可恢复。
7. 不清 owner 连续重复 2/3 三次，确认没有「退出写回导致再死锁」。
8. **能力探测（最先做，决定生死）**：在真实卡片与独立窗里各读 `location.origin` / `isSecureContext` / `typeof navigator.locks` / `navigator.locks.query()` 是否抛 `SecurityError`；并在两边各持一把锁互相查询。**若卡片里就是 `SecurityError` 或两边互相看不见锁，轨道一判废，立即回报**，不要硬凑。

---

## 3. 轨道二（长期加固）：宿主最小接口规格（**只产出文档，不动宿主**）

宿主公开面确实没有「旧文档已结束」的证明，也没有「宿主启动代」。宿主内部有 4 套代次记账，但**都不留墓碑**（`MIr.isActive` / `QIr.isActive` 只返回布尔；`revoke` 的布尔只在调用那一刻有效），所以 `revoked` 与 `unknown` 分不开。宿主内部已亲历三种销毁但不落状态：`QIr.closeEntry`（换代/回收）、`QIr.sweepOrphans`（新启动清上一代 `run-*` 目录）、`hNr.disconnect`（socket 断连）+ `ui-sessions/release`。

请把 `03-host-internals.md` 整理成一份**给宿主维护方的最小规格文档**（落 `docs/player-ui/handoffs/AUDIO-OWNER-HOST-INTERFACE-SPEC.md`），要求：
- 只加**只读查询**，不新增权限词、不改现有写入语义；
- 落点 A：在 `MIr.revoke` / `QIr.closeEntry` / `hNr.disconnect` 写墓碑，在已有卡 chrome 门加只读方法返回 `{ ok, state: "active" | "ended" | "unknown" }`；**「句柄不在表」必须是 `unknown`，不是 `ended`**；
- 落点 B：把 `QIr` 已有的 run nonce 提升为只读入口（如 `server-info.json` 加字段或一条 `GET /api/apps/ui-run`），供「上一代整代已终止」判定；
- `documentId` 复用宿主已铸、App 已能读到的 `viewHandle` 或 `cardInstanceId`，不新铸身份；
- 明确写出「为什么必须区分 ended 与 unknown」（活文档可能只是暂时不可见：重载中 / 桥重绑 / client 重连 / chrome 未注册）。

**不要**自己改宿主、不要读宿主私有文件绕过 SDK、不要用 pid / token / 私有 run 目录当身份。

---

## 4. 硬约束

- 不改既有断言、不动 `captureStream` 涟漪链路、不动许可证（AGPL-3.0）。
- 孪生文件：`ui/index.html` 与 `ui/standalone.html` 只差 body 的 `data-shell`。
- 改完跑 `node tools/bump-build.mjs`，核对 `ui/_build.json` 与两个 html 的 build 号一致。
- 部署必须**整包同步** `ui/`（index / standalone / style.css / _build.json）再 reload。
- 前端零构建、ES5；禁 `position:fixed`、禁直接 `localStorage`、禁 emoji、字号 ≥ 11px。
- `manifest.json` 版本号由你判断何时 bump（1.1.1 已被本任务占用；mood-onestep 在途改到 1.1.2，别撞车）。
- 不发布 Release / 市场 PR，不启动第二个 Codex。
- 仓库现有未提交改动（audio-owner 1.1.1 + 在途 mood-onestep）都要保留，别覆盖。

## 5. 交付物

1. 代码改动（本仓库）。
2. `docs/player-ui/handoffs/AUDIO-OWNER-ORPHAN-REPAIR2.md`：改了什么文件与原因、需求对应、**原始验证输出**、断言编号、版本与构建号、轨道一的信任边界与退化路径、仍需 Hana 真机验证的事项（照 §2.5）。
3. 若做轨道二：`AUDIO-OWNER-HOST-INTERFACE-SPEC.md`。
4. 完成后按协作约定直接给 Hana 发消息（Computer Use，桌面 `HanaAgent`，本项目会话），说明交接位置、通过与未通过项、复跑入口。

---

## 6. 先把用户救回来（与返修独立，可立刻做）

用户当前播放器仍卡在孤儿死锁（`global.json` 里 owner 是重启前的 `mv6gxf6vlbltk6`，`revision 40`，`pending` 挂着新实例）。**注意：这一步只能由用户在终端做，Hana 做不到**——Cmd+Q 会让 Hana 自己随宿主一起消失，没有「已退出、未启动」的空档给 agent 动手。

已验证的恢复命令（在**终端**里跑，只删 `player-audio-owner` 一个键，其余键原样保留；已在副本上实跑通过）：

```sh
F="$HOME/.hanako/app-data/hanako-simple-player/storage/global.json" && \
cp "$F" "$F.bak-$(date +%s)" && \
python3 -c "import json,sys;p=sys.argv[1];d=json.load(open(p));d['entries'].pop('player-audio-owner',None);json.dump(d,open(p,'w'),ensure_ascii=False);print('owner cleared')" "$F"
```

步骤：① Cmd+Q **完全退出** Hana（关窗口不算）；② 终端粘贴执行，看到 `owner cleared`；③ 重新打开 Hana。

**这是绕过，不是修复**：只要不落地轨道一（或轨道二的宿主接口），**每次宿主重启都会重新造出孤儿**。所以请把它当作「用户等返修期间的临时出口」写进交接，不要当成问题已解决。

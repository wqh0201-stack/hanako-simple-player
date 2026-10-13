# 任务书 · 播放出声唯一化（目标版本 1.1.1）

> 交付对象：codex。验收方：哦鲸鲸（本仓库常驻 agent）。
> 本文件是**唯一的需求来源**；与代码注释冲突时以本文件为准，与 `AGENTS.md` 冲突时以 `AGENTS.md` 为准。
> 动笔前必读，按序：`AGENTS.md` → `~/.hanako/skills/hana-app-creator/SKILL.md` →
> `~/.hanako/artifacts/server/<最新版本>/APPS.md`（宿主契约权威，路径用 `ls` 找最新版）。
> 仓库路径：`/Volumes/SSD/hanadesk/hanako-audio-player-simple`。许可证 AGPL-3.0，别改。

---

## 0. 一句话目标

同一个 Hana 实例里可以开很多个播放器（聊天卡片、独立窗口、钉住卡……）。
**任一时刻只允许其中一个出声。** 新的那个起播时，正在响的那个自动停；被停的那个
保留曲目与进度、不出声、不写 `playing:true`，用户点它一下就能接回来。

**不关闭任何实例，不做进程级互斥，不改数据形状。**

---

## 1. 背景：已核实的现状（可直接信，不必重查）

验收方已做完只读探测，以下为结论：

1. **每个实例是一个独立 iframe，各持一个 `<audio>`，彼此零协调。**
   全代码库没有 `BroadcastChannel`、没有实例心跳、没有所有权仲裁。
   唯一的跨实例通道是 `hana.storage.global.onChanged`，且**只用于同步歌单名**
   （`subscribeLists()` / `refreshLibrary()`），从不碰播放态。
2. **"reload 全员复活"的根因**是 `restorePlayback()`（`ui/app.js` ~7086）无条件信任
   盘上的 `playing:true`：它 `loadAudio(t, progress, true)` 直接起播。
   而 `app-data/playback.json` 是**全局单例、不分实例**的，所以每个新实例都会读到它。
   reload 一次性重建所有实例 → 全部一起响。这是必然结果，不是偶发。
3. **第二条复活通路**：`snapshot()` 里
   `playing = state.playing || (unloading && 刚还在播)` 会在**页面卸载**时
   把"在播"强行写回盘。这条原本为拖进拖出续播而设。**只做所有权仲裁而不处理它，
   reload 依旧会全员响** —— 必须一起改。
4. **不需要、也不能关闭别的实例。** 宿主契约（`APPS.md`）明确：App 卡片只有
   "显式关闭 / 项目清理 / 生命周期结束"三种情况会被关掉，普通 App 无关闭自己卡片的权限；
   `hana.surface.getContext()` 只给自己的 `appId/slot/cardInstanceId`，拿不到别的实例句柄。
   （`lib/state.js` 顶部注释也留着这条：宿主不给口子，只能从投递端收敛。）
5. **暂停的资源开销可忽略**：`pause()` 后解码停止；涟漪的 FFT 走 `captureStream()`
   + `AnalyserNode`，在 `pause` 事件里会 `detachAudio()` 拆链，不会留空转的静音流。
   涟漪**刻意绕开了 `createMediaElementSource`**（不可逆、跨源会全零静音），
   所以不存在"某实例劫持音频路由把别人搞哑"的风险，`pause()` 是干净动作。

---

## 2. 用户已拍板的语义

**后来者自动赢。** 新开/新点的那个立刻接管，旧的自动停。用户已明确选择此项，
不要再引入"弹窗询问"或"每次都问"。

配套语义：
- 被接管的实例**暂停并待命**，不卸载音频、不清 `currentUid`、不重置进度。
- 被接管的实例**必须给出可见的可恢复入口**（见 §4.4）。
- 用户**主动**在某个实例上点暂停，仍然是所有实例都停（不是"让给别人"）。

---

## 3. 硬约束（踩了必炸，来自 AGENTS.md）

1. **孪生文件**：`ui/index.html` 与 `ui/standalone.html` 内容必须一致，只差 body 的 `data-shell`。
2. **构建号**：改完跑 `node tools/bump-build.mjs`。
3. **部署必须整包同步 `ui/`**（index / standalone / **style.css** / _build.json）再 reload。
4. **前端零构建**：`ui/app.js` 是 ES5 纯 JS，无打包器。**别引入 ES6+ 语法**
   （不用 `let/const`、箭头函数、模板字符串、`?.`、`class`）。
5. 禁 `position:fixed`、禁直接 `localStorage`、禁 emoji（用 SVG 线描）、字号 ≥ 11px。
6. 别定义 `--bg/--text/--accent` 盖宿主主题变量；只消费 `hana.theme`。
7. **别碰这些**（有注释护着的）：
   - `playlist.json` 每条曲目的 `id` / `url` 字段格式
   - `normalizeAppUrl`、`withSession`、`go` 跳板、`trackKey`
   - `localDir` / `player-split` / `player-ripple-tune` / 首次提示与欢迎歌的 storage key
   - `lib/register-routes.js` 里 `/widget/api/...` 的旧路径
   - 涟漪的 `captureStream()` 链路（**严禁**改成 `createMediaElementSource`）
8. 注释写「为什么」不写「是什么」，照本仓库的高密度风格。

---

## 4. 要做的四件事

### 4.1 实例身份与所有权通道

**实例 ID**：本实例自己生成一个 `ownerId`（`Date.now().toString(36) + Math.random().toString(36).slice(2,8)`），
进程内唯一即可。可通过 `window.__playerDebug` 暴露，供验收脚本读。
若 `hana.surface.getContext()` 能拿到 `cardInstanceId`，可以拿它**当附加信息**，
但**不要**当权威（独立窗口/未握手时可能是 null，且我们要的是"音频所有权"不是"卡片身份"）。

**双通道**（两条都实现，互为兜底）：
- ① `BroadcastChannel('hana-simple-player-audio')` —— 优先，零延迟，页面销毁自动释放。
  用 try/catch 包住（老环境可能没有），拿不到就跳过，不得因此报错。
- ② `hana.storage.global.onChanged` —— 兜底。宿主把它**广播到所有实例**
  （`app_event` 通道，卡片/子进程/主进程都订阅同一条），覆盖独立窗口可能不在同一
  browsing context group 的情况。复用 `subscribeLists()` 已有的订阅模式与
  **内容比较防回环**的做法（`listNamesKey()` 那套思路），**不要**新开 SSE、不要心跳轮询。

> ⚠️ 回环是本次最大的正确性风险：A 宣告接管 → B 收到 → B 写盘 → 广播 → A 收到 → A 又宣告……
> 必须用**内容比较 + 自写标记**双重收敛，并在注释里写明为什么。
> 若你实测发现 ② 会连抖或延迟不可接受，**先回报**，别硬凑。

**所有权记录**：写进 `hana.storage.global` 的一个新键，如 `player-audio-owner`
（形状 `{ ownerId, at }`）或后端 `playback.json` 里加一个 `owner` 字段 ——
**你决定哪个更稳，把理由写进交接**。倾向后者：它本来就是跨文档快照，读写链路现成。

### 4.2 起播前宣告接管

**统一入口**：所有会让声音出来的地方，都要先"抢所有权 → 成功才 play"。
已知的调用点（请自己再全局搜一遍 `audio.play()` 确认没漏）：

| 位置 | 场景 |
|---|---|
| `playTrack()` | 选曲/切歌 |
| `$('playBtn')` 点击 | 主播放键 |
| `$('resumeBtn')` 点击 | 「继续播放」引导 |
| mediaSession `on('play')` | 系统媒体键 |
| `restorePlayback()` 里 `loadAudio(t, p, true)` | **启动续播（本次重点）** |
| `onTrackEnded` 单曲循环 / 自动下一首 | 连播 |

建议做法：封一个 `claimAudio()`（返回 boolean）和一个 `requestPlay(reason)`，
把 `audio.play().catch(onAutoplayBlocked)` 统一收进去。**不要**在每个调用点各写一遍逻辑。

**启动续播的判定**（最关键的一处）：
`restorePlayback()` 拿到 `pb.playing === true` 时，**不再无条件起播**，改为：
- 若盘上没有有效 owner（首次 / 上一个 owner 已消失）→ 本实例抢占并起播；
- 若已有 owner 且不是自己 → **加载曲目但保持暂停**，走 §4.4 的待命 UI；
- 若 owner 就是自己（同实例重启）→ 正常续播。

**"上一个 owner 已消失"怎么判**：这是本次最难的一处，也是最容易误伤的地方。
候选做法（你实测后定，把结论与实测证据写进交接）：
- owner 记录里带一个 `at` 时间戳，超过 N 秒视为过期（N 你定，建议 5~15s，说明取值理由）；
- 或 owner 实例周期性（如每 2s）刷新 `at`，靠"心跳断"判定死亡；
- 或两者结合。

> ⚠️ 误判的代价不对称：把"活着的 owner"误判成死了 → 两个一起响（正是本次要修的 bug，
> 修完还犯等于没修）；把"死了的 owner"误判成活着 → 用户点开播放器不出声（明显故障）。
> **宁可偏向后者**，并在交接里说明这个取舍。

### 4.3 被接管时：暂停，且不写 `playing:true`

收到"别人接管了"的通知后：
1. `audio.pause()`（涟漪会自动拆链，不用额外处理）；
2. `state.playing = false`；
3. **关键**：不要触发那条会把 `playing:true` 写回盘的路径。
   注意 `snapshot()` 里 `unloading && 刚还在播` 那条 —— 被接管的实例若此时被卸载，
   仍会把 `playing:true` 写回去。**必须让"被动暂停"把这条也关掉**
   （例如引入一个"我是被抢走的"标记，或在被动暂停时清掉 `lastPlayingAt`）。
4. 更新 UI（见下）。

### 4.4 待命态的可见入口

被接管的实例要有**一眼能懂**的恢复入口。现有 DOM 里已经有一个
`#resumeBtn`（"继续播放" chip，目前只在自动播放被拦时显示）。
**复用它**，文案按情况区分：
- 自动播放被拦 → 维持「继续播放」
- 被别的实例接管 → 显示「接管播放」（或同类文案，你定，要短）

**不要**新造一个弹窗或横幅；**不要**用 `position:fixed`。
若复用 `#resumeBtn` 会与"自动播放被拦"的语义打架（两者可能同时成立），
说明你的处理方式，别默默覆盖。

### 4.5 单实例时行为必须完全不变

只有一个实例时（绝大多数情况），上述机制**不得引入任何可感知差异**：
仍能续播、仍能自动下一首、reload 后仍能接着放。
这一条是回归重点，验收会盯。

---

## 5. 开放问题（没把握，别写死，动手前先探查并回报结论）

1. **通道选择**：`BroadcastChannel` 在宿主的 iframe 里是否真的可用、能否跨独立窗口？
   实测结论写进交接。若不可用，说明退化路径是否足够。
2. **`hana.storage.global.onChanged` 的真实延迟与抖动能不能满足"抢麦"？**
   参考 `docs/player-ui/handoffs/MOOD-HOST-PROBE.md` 里已有的实测方法
   （那份报告证明过该键**同值也会广播**）。
3. **owner 存活判定**最终选哪种？过期时间取多少？误判方向如何取舍？（§4.2 已给倾向）
4. **所有权记录放哪**：`playback.json` 加字段 vs `hana.storage.global` 新键，哪个更稳？
5. **`ui/_build.json` 与两个 html 的构建号**是否由 `bump-build.mjs` 自动同步（是的，但跑完请核对）。

---

## 6. 必须遵守的工程纪律

- 每步单独可验，**不要一次大改**。建议顺序：§4.1 → §4.2 调用点 → §4.3 → §4.4。
- 新增前端逻辑放进 `ui/app.js` 内合适的模块段（照现有分段风格），
  **不要**新建 `ui/*.js`（孪生 html 只外链 app.js / style.css / sdk.js）。
- 需要后端配合（如 ownership 端点）时放进 `lib/`，遵守现有模块划分。
- 注释写根因和踩坑史，照现有密度。

---

## 7. 验收标准

**codex 侧（改完必跑，原始输出贴回交接）**

- 开工前**先跑一次基线**并留底：
  `node tools/verify-backend.mjs`、`node tools/verify-ui.mjs`。
  已知基线：`verify-ui` **366/367**，唯一红项是
  `ripple-max-midhigh-keeps-steady-and-silence-quiet`（既有 flaky，headless 下会飘）。
  **不要改这条断言，也不要为消除红项改松任何既有断言** —— 改基线断言等于作弊。
- 改完后复跑两条：失败集合必须是**开工基线红项的子集**，不得出现新红。
- **新增针对本次功能的断言**，至少覆盖：
  1. 两个实例同时 boot 且盘上 `playing:true` → **只有一个** `audio.paused === false`；
  2. A 在播 → B 起播 → A 变 `paused` 且**盘上 `playing` 不为 true**；
  3. 被接管的实例上 `#resumeBtn` 可见，点击后夺回出声权；
  4. **单实例**下续播/自动下一首/reload 后续播行为与开工前一致（回归）。
  > 若 headless 环境难以构造"两个实例"，说明卡在哪，并提出等价验证方案
  >（如直接驱动所有权 API + 断言状态），**不要跳过、不要假造通过**。
- `node tools/bump-build.mjs` 已跑，核对 `ui/_build.json` 与两个 html 的 build 号一致。
- `manifest.json` 的 `version` 从 `1.1.0` 升到 `1.1.1`（功能版）。
- `docs/CHANGELOG.md` 顶部加一节，写「对用户意味着什么」。

**验收方（哦鲸鲸）侧**

- 独立复跑两条验证，**只看原始输出、不看 codex 的结论**。
- 真机：**整包同步 `ui/` → `extension_manager reload app:hanako-simple-player`**
  （这步 codex 做不了）。
- 真机检查：
  1. 开两个以上播放器（卡片 + 独立窗口），reload → **只有一个出声**；
  2. 在另一个实例上点播放 → 旧的立刻静音，新的出声；
  3. 旧实例上出现可恢复入口，点一下 → 夺回出声权；
  4. 只开一个时，原有行为（续播、连播、切歌）无任何退化。

---

## 8. 分工与边界

- codex **不能**：reload App、真机点卡片、访问宿主运行时。
- codex **能**：改仓库代码、跑 headless 验证脚本、读 `~/.hanako/artifacts/server/<ver>/APPS.md`。
- 一次改不完就分段交付，每段可独立验。宁可小步、别憋大招。
- 拿不准的地方**停下来回报**，不要猜着写死。

## 9. 交付物

- 代码改动（本仓库）。
- `docs/player-ui/handoffs/AUDIO-OWNER-DONE.md`：改了什么文件与原因、需求对应情况、
  原始验证输出、断言编号、版本与构建号、**§5 每个开放问题的实测结论**、
  仍需验收方验证的事项。
- 完成后按 `docs/COLLABORATION-HANA-CODEX.md` 直接给 Hana 发消息（Computer Use，
  桌面应用 `HanaAgent`，本仓库对应会话），说明交接位置、通过与未通过项、复跑入口。

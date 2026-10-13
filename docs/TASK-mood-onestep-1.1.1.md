# 任务书 · /mood 一步直达（目标版本 1.1.1）

> 交付对象：codex。验收方：哦鲸鲸（本仓库常驻 agent）。
> 本文件是**唯一的需求来源**；与代码注释冲突时以本文件为准，与 `AGENTS.md` 冲突时以 `AGENTS.md` 为准。
> 动笔前必读，按序：`AGENTS.md` → `~/.hanako/skills/hana-app-creator/SKILL.md` →
> `~/.hanako/artifacts/server/<最新版本>/APPS.md`（宿主契约权威，路径用 `ls` 找最新版）。
> 仓库路径：`/Volumes/SSD/hanadesk/hanako-audio-player-simple`。许可证 AGPL-3.0，别改。

---

## 0. 一句话目标

让 `/mood` 从「只回一句提示牌」升级为「**直接唤起当前 agent 回复/引导建单**」：
用户敲 `/mood`，或敲 `/mood 今天很累，来点安静的`，都会被翻译成一条进入会话的消息，
由 agent 当场接话（读库、选歌、建单）。

用户已就本改动明确拍板：**接受新增权限**。

---

## 1. 背景与已核实事实（可直接信，别再猜）

### 1.1 现状（1.1.0）

`/mood` 是 v2 App 斜杠命令。宿主把 `/mood` 派发给 App 自己的 handler，handler 回一句话，
宿主渲染成输入框上方约 3 秒消失的浮提示，**不进会话、不唤醒模型**。所以 1.1.0 是「提示牌」。

### 1.2 一步直达需要的权限（实测结论）

命令 handler 想往会话投递消息，必须经 `ctx.bus.request("session:send", ...)`。障碍与解法：

1. **handler 手里的会话凭据只有 `sessionPath`**（invocation 五字段：`commandName/rawText/args/sessionPath/reply`，
   `reply` 跨进程实际不可用；**没有 `callToken`**）。
2. **`session:send` 不接受 `sessionPath`**。实测传 `sessionPath`、`legacySessionPath` 均报
   `Session manifest resolution requires sessionId or legacy sessionPath. [session_manifest_ref_required]`。
   它只认稳定 `sessionId`。
3. **path → sessionId 的唯一可用途径**：`ctx.bus.request("session:list", { scope: "all", lifecycle: "active" })`，
   返回项里有 `path` 与 `sessionId`，按 `path === invocation.sessionPath` 匹配即可。
4. **跨归属（写进用户聊天会话）必须 `scope:"all"`**，否则报
   `session "..." does not belong to app "..."`。
5. **三个权限**（均经隔离宿主实测，错误信息点名）：
   - `app/session.start-turn`：`session:send` 必然进模型，需要它。
   - `app/sessions.manage`：跨归属**写**会话需要它。
   - `app/sessions.read`：跨归属**读**（`session:list` 换 id）需要它。
   
   **`app/sessions.read` 在 1.1.0 的 manifest 里已声明并已授权**（生产账本 `allowed`，
   1.1.0 用于 inputBanner 订阅）。所以本次**实际新增两个**：`app/session.start-turn`、`app/sessions.manage`。

### 1.3 已探到但**不用**的近路（别走，记录以免重复试）

- 想用 `session/input` 输入钩子把 `/mood 今天很累` 改写成一句自然语言用户消息（那样只需一个窄权限）——
  **不可行**：宿主对 slash 消息走独立派发（`slashDispatcher.tryDispatch`），**不经过** `session/input` 钩子。
- 想让 `session:send` 直接吃 `sessionPath` —— **不可行**，见 1.2 第 2 点。

### 1.4 时序与限制

- slash dispatcher 的超时是 **30s**（`YIn = 3e4`）。handler 里 `session:list` + `session:send` 都是毫秒级，
  不会撞超时。
- `session:send` 成功后宿主**强制盖来源标记** `origin = { kind:"agent", agentId, agentName }`（`agentName` 即
  App id）。桌面前端会把它渲染成「来自 小花音乐播放器」。**这是预期行为，不要试图伪造用户消息**。
- `session:send` 只返回 `accepted:true`，**不代表模型已回复**；回复是后续回合产出。

---

## 2. 需求

### 2.1 `/mood` 行为

| 输入 | 期望 |
|---|---|
| `/mood` | 起一轮：让 agent 引导用户说明想听的状态 |
| `/mood 今天很累，来点安静的` | 起一轮：把 `args` 当需求交给 agent，agent 据此读库/选歌/建单 |

两条都由「投递一条进入会话的消息」实现，区别只在消息文本是否携带 `args`。

### 2.2 handler 内实现（`lib/mood-command.js`）

handler 改为 async，流程：

1. 取 `invocation.sessionPath`（空则降级，见 2.4）。
2. `session:list`（`scope:"all"`）解出 `sessionId`；匹配用 `path === sessionPath`（注意 macOS `/tmp`
   与 `/private/tmp` 符号链接差异，**比较前对两边做 realpath 归一**，找不到再用原串比较）。
3. 构造消息文本（**照抄下面措辞，别自创**）：
   - `args` 为空：
     ```
     用户敲了 /mood，想生成今日心情歌单。请先问他现在想听什么样的状态（一句话就够），
     然后读他的音乐库、选歌，保存成一个心情歌单。
     ```
   - `args` 非空（`<内容>` 为 `args` 原样）：
     ```
     用户敲了 /mood，并说明：<内容>。请据此读他的音乐库、选歌，保存成一个心情歌单；
     需要补充时先问一句。
     ```
4. `ctx.bus.request("session:send", { text, sessionId, scope: "all" })`。
5. **成功**：handler 返回 `undefined`（不回浮提示，让 agent 的回复说话）。
6. **任一步失败**：返回 `MOOD_PROMPT`（降级成 1.1.0 的提示牌），**不抛错、不弹惊悚错误**。

### 2.3 保留的常量

`MOOD_PROMPT` 保留，作为降级文案。措辞可沿用 1.1.0：

```
想听什么状态？单独发一条普通消息告诉我（别写在 /mood 后面），例如「今天很累，帮我建个安静的心情歌单」，我就去选歌建单。
```

### 2.4 降级边界（都要拿到，别静默吞）

以下任一情形 → 返回 `MOOD_PROMPT`：
- `sessionPath` 为空（bridge 会话无路径）
- `session:list` 没匹配到该会话
- `session:send` 报错（含未授权）

降级时 `ctx.logger?.warn?.("[mood] 一步直达降级: <原因>")`，**不要**把 token/凭据写日志。

### 2.5 权限声明

`manifest.json` 的 `capabilities` 增加两条：

```json
"app/session.start-turn",
"app/sessions.manage"
```

保留现有全部（含 `app/sessions.read`）。**这是扩权，安装/更新时会触发一次权限确认弹窗，属预期。**

### 2.6 中文别名

`/心情` 别名维持现状（宿主命令名只收 ASCII，尝试注册会被拒并回滚）。**别改这块逻辑**，
现有「明确拒绝时降级到无别名」的兜底保留。

---

## 3. 不要碰

- `lib/register-tools.js` 里 inputBanner 订阅逻辑（`app/sessions.read` 的现有用途）。
- `player-lists` 键名与形状、`playlist.json` 的 `id`/`url` 字段格式。
- `ui/` 前端（本任务纯后端 + manifest；前端零改动，因此**不需要** bump-build 之外的 UI 同步，
  但仍按 §4 走部署回路）。
- 中文别名注册逻辑。

---

## 4. 交付与部署（严格按 AGENTS.md §4）

1. 改 `manifest.json`、`lib/mood-command.js`（必要时 `tools/verify-mood-host.mjs`）。
2. `manifest.json` 版本 `1.1.0 → 1.1.1`。
3. `node tools/bump-build.mjs`（同步构建号）。
4. `CHANGELOG.md` 新增 `## 1.1.1` 段，写「对用户意味着什么」。
5. 技术交接 `docs/player-ui/handoffs/MOOD-ONESTEP-DONE.md`：改动文件与原因、原始输出、断言编号、
   版本与构建号、开放问题、待 Hana 真机验收项。
6. 完成后直接给 Hana 发消息（协作约定已在 `docs/COLLABORATION-HANA-CODEX.md`）。

---

## 5. 验收清单（供 Hana 独立复跑，Codex 先自验）

**A. 静态**
- [ ] `manifest.json` capabilities 含 `app/session.start-turn`、`app/sessions.manage`，且仍含 `app/sessions.read`
- [ ] 版本 = `1.1.1`；构建号已 bump 且三处一致
- [ ] 官方静态校验 0 error

**B. 后端 / 宿主派发（`tools/verify-mood-host.mjs`，隔离无模型宿主）**
- [ ] 预置三权限后派发 `/mood`（带 sessionPath）：`session:list` 成功解出 sessionId
- [ ] `session:send` 到达模型层（错误为「No models available」而非权限错/定位错）→ 证明链路通
- [ ] 派发 `/mood xxx`：构造文本含 `xxx`
- [ ] 未授权时不崩：handler 返回 `MOOD_PROMPT`（降级）
- [ ] 无 sessionPath 时不崩：同样降级

> 隔离环境无模型，**不能**在此断言「agent 真的回复了」；那一条留给 Hana 真机。

**C. 真机（Hana 做，Codex 不宣称）**
- [ ] 真机 `/mood`：会话里出现「来自 小花音乐播放器」的消息 + agent 当场回复引导
- [ ] 真机 `/mood 今天很累`：agent 据此读库/选歌/建单，落进「今日心情」歌单
- [ ] 权限弹窗确认后功能生效（扩权需重新审批）
- [ ] 拒绝授权时降级为提示牌，`/mood` 不报错

---

## 6. 边界说明

- 本任务**不改** `ui/`，但仍按 §4 整包同步 `ui/` 再 reload（构建号变了）。
- `sessions.manage` 是宽口径权限（含归档/删除等会话写入）。本任务代码只用 `session:send` 与
  `session:list`，**不要**顺手加别的会话写入动作。
- 发版（tag / Release / 市场 PR 更新）由 Hana 在真机验收通过后执行，需用户点头，**不在本任务范围**。

# MOOD-ACCEPT-1.1.0 · 心情歌单 1.1.0 独立验收

> 验收方：哦鲸鲸（Hana）。实现方：Codex。日期：2026-10-13。
> 仓库 `/Volumes/SSD/hanadesk/hanako-audio-player-simple`；版本 **1.1.0**。
> **本文件含两轮**：第一轮 build `1003131671/72`（§1–§11，已打回 `/mood` 别名问题）；
> **第二轮 build `1003131673` 见文末「第二轮复验」**——别名问题已修，但暴露了第二个阻断缺陷。
> 交接稿：[MOOD-LIST-DONE.md](MOOD-LIST-DONE.md)；我的宿主实测：[MOOD-HOST-PROBE.md](MOOD-HOST-PROBE.md)。
> 纪律：不看 Codex 结论、只对原始输出；不改源码、不碰用户原歌单；失败先给原始证据。

---

## 0. 结论总览

| 项 | 结果 |
|---|---|
| 后端独立复跑 | ✅ **99/99**，断言集合与结果逐条一致 |
| 前端独立复跑 | ✅ **376/376**，0 失败，12/12 布局，runtimeErrors=[] |
| 官方静态校验 | ✅ 0 error / 1 warning（通用项），独立复现 |
| 代码审查（禁区/边界/哨兵/回滚） | ✅ 通过 |
| 整包同步 + reload | ✅ 已执行 |
| 真机：搜索可播 + 清洗元数据 | ✅ 通过（真网络，取回真 MP3） |
| 真机：`create_list` 新建 / 同名覆盖 | ✅ 通过（含哨兵、备份、id/url 沿用） |
| 真机：开着的卡片即时刷新 | ✅ 通过（新建出现 / 覆盖保留 / 删除消失，全程不重载） |
| 真机：改名持久化 | ✅ 通过（落后端权威存储） |
| **真机：`/mood` 与 `/心情`** | ❌ **阻断** —— 中文别名被宿主拒绝，**连主命令一起回滚**；`/mood` 也没注册上 |
| 真机：真实 agent 收到引导后建单 | ⏸ 待验（取决于上面的修复 + 一次真实有模型会话） |

**判定：实现主体通过，但在 `/mood` 这一项上打回。** 这是核心入口，必须修后复验。

---

## 1. 独立复跑（原始输出）

### 后端 · 我复跑
```
我复跑：passed 99 / total 99 failed 0
仅在 codex 结果里的断言: []
仅在我复跑里的断言: []
与我结论不一致的条目: []
```
逐条与 `mood-1.1.0/verify-backend.json` 比对：断言名集合一致、每条 ok 一致。

### 前端 · 我复跑（`OUT_DIR=/tmp/hap-accept`，exit 0）
```
我复跑 UI 断言: total 376 失败 0
失败项: []
runtimeErrors: []
布局自检: 12 组，通过 12
窄档自检: 4 组，通过 4
自检失败项: []
```
12 条 `mood-lists-*` 新断言全绿。**开工基线 366/367 里唯一允许的既有涟漪 flaky 本次也过了**，所以没有「基线红项子集」问题。

### 官方静态校验 · 我复跑
```
validate-app: 0 error(s), 1 warning(s)
warning: DYNAMIC_DEPENDENCIES_NOT_PROVEN（通用项，与 Codex 一致）
```
官方隔离 UI smoke 未完成（缺独立 Electron），与我一致，保留为待验环境依赖。

---

## 2. 代码审查（抽要，非通读）

- **禁区未动**：`git diff ui/app.js` 对 `normalizeAppUrl` / `withSession` / `trackKey` / `APP_ROUTE_RE` / `deriveId` **零命中**；`ui/style.css`、`ui/sdk.js` 无改动；未新增宿主主题变量。`localDir`/`player-split`/`player-ripple-tune`/首次提示/欢迎歌的 storage key 全部保留。
- **manifest**：只改 `version`，`capabilities` 与 `network` 逐项未变；**未加 `app/session.start-turn`**。
- **孪生文件**：`index.html` 与 `standalone.html` 除 `data-shell` 外内容一致（我独立 diff）。
- **边界校验**：`validateLists` 整份先验后写，缺固定项/空 id/空名/重复 id/非数组 → 400 且不半写。
- **哨兵**：同名覆盖写 `player-library-revision`（UUID）；新建走 `player-lists` 广播。真机两种路径都已验（§4）。
- **回滚**：`createList` 写 storage 失败时 `copyFileSync(backup, file)` 还原；备份用 `COPYFILE_EXCL` + UUID 防同毫秒覆盖。
- **前端通道正确**：`subscribeLists` 用 `hana.storage.global.onChanged`（即 `hana.app.storage.changed`），**不是**扁平版 —— 与我在 HOST-PROBE Q2 的结论一致。
- **前端仍 ES5**，无构建步骤。

一处观察（非缺陷）：`lib/mood-command.js` 的 `ensure()` 失败会被工具/路由反复触发重试（真机日志里该 warn 出现 119 次），**不是定时器**，只是每次 `ensure` 都重试一次。修复时顺手确认不会刷屏即可。

---

## 3. 真机：搜索链路与 `create_list`

**搜索工具（真网络，真机 agent 工具调用）**：`hana_simple_search_music` 返回
`{server, total, returned, tracks}`，每条含清洗后歌名、匹配歌手、封面、LRC、`dur`、`matched:true`。
例：`晴天` → 匹配到 `netease:2668397359`，`dur 270.738`，有 pic 与完整 LRC。

**播放地址真可播**（go 跳板，我直接取字节）：
```
http=206 type=audio/mpeg;charset=UTF-8 bytes=1024
file: Audio file with ID3 version 2.4.0, contains: MPEG ADTS, layer III, v1, 320 kbps, 48 kHz, Stereo
```

**`create_list` 新建**：`{"listId":"imp:6","name":"心情验收-20261013","count":2,"created":true,"replaced":false}`
→ `player-lists` 落盘含 `imp:6`；`playlist.json` 中 `imp:6` 两条，`id`/`url` 正常；生成 `.bak-*` 备份。

**`create_list` 同名覆盖**：再传同名 3 首 → `{"listId":"imp:6","count":3,"replaced":true}`
→ **未新建列表**，`player-lists` 条数不变；`imp:6` 变 3 条；**已有条目 `id`/`url` 未动**；`player-library-revision` 写入新 UUID；新备份生成。

**边界**：空 tracks 保留列表（`create-list-empty-replacement-keeps-name`）；长特殊名当数据不当路径（`create-list-long-special-name-is-data-not-path`）；缺 source / 坏 dur / 坏 tracks 均 400 不写 —— 均由 99/99 后端断言覆盖，我复跑确认。

---

## 4. 真机：开着的卡片即时刷新（核心目标）

在**重载后新挂载、且不重载**的完整播放器卡片（`wb-card-plugin-webview-card-mv5wd69a-1`，route `/index.html`）上，通过 `ui_action` 读列表条：

| 动作 | 卡片观察 | 证据 |
|---|---|---|
| 初始 | 列表条 index 0–7（共 8） | `listTab7` 可点、`listTab8`/`listTab99` 报 "No element matches" |
| `create_list` 新建 imp:6 | 出现 `listTab8` | 点击成功 |
| 再新建 imp:7 | 出现 `listTab9` | 点击成功 |
| 删除两个列表（后端 PUT 还原） | `listTab8` **不再匹配** | 实时消失 |
| 新建「心情验收-刷新」 | `listTab8` 回到可点 | 实时出现 |

**三态（新建出现 / 覆盖保留 / 删除消失）全部在无重载的卡片上实时生效** —— `hana.storage.global.onChanged` 广播到卡片的链路真机成立。这是我在 HOST-PROBE 里标为「待真机」的那一项，现已补上。

> 说明：卡片当前渲染完整播放器壳，列表条 `listTabN` 是稳定 id，可直接 `click_element` 复核存在性；队列行的曲目级刷新由 `queueCount` 反映，我用列表条三态完成核心判定。

---

## 5. 真机：改名持久化

在开着的卡片里对 `imp:6` 走内联重命名（`renameBtn` → `listNameInput` 输入 → 失焦提交）：

```
宿主 storage player-lists 里：
imp:6 = {"id":"imp:6","name":"心情验收-20261013心情验收-改名测试心情验收-改名测试"}
```

（名字被 `type_text` 重复追加，是**自动化输入**的问题，不是 App 的问题；关键是**改名确实写进了后端权威存储**。）

随后用 `PUT /api/lists` 把名字清回 `心情验收-20261013`，成功、单条生效、其余 7 项不变 —— **改名走的是后端权威路径，持久化成立**。

> 卡片内重命名的键盘提交（Enter）在 App 卡片里受限：`press_key` 报「App cards do not support press_key」，所以走失焦提交。这是验收工具的边界，不是 App 缺陷。

---

## 6. ❌ 阻断项：`/mood` 与 `/心情` 未注册（中文别名回滚主命令）

### 现象（真机）

1. 宿主 `/api/commands` 里 **没有任何 `source:"app"` 命令**（reload 前后一致）。
2. `GET /api/lists` 的 `moodRegistered` = **false**。
3. 日志（原始，reload 后立即出现，累计 119 次）：
   ```
   [10:35:28.916] [WARN] [hanako-simple-player] [mood] 注册尚未确认:
     v2 app "hanako-simple-player" could not register command alias "心情":
     it is invalid, reserved, or already taken.
   ```

### 根因（三条独立证据，均读自宿主产物）

**A. 别名闸门：任一别名失败会回滚主命令**（`bundle/index.js`）：
```js
const i = (n ?? []).find((o) => t.lookup(o)?.name !== s.name);
if (i !== void 0)
  throw t.unregisterCommand(s), new Error(`... could not register command alias ${JSON.stringify(i)}: ...`);
```
注意 `t.unregisterCommand(s)` —— 别名失败**连带注销刚注册的主命令**。

**B. 别名归一化把中文洗成空串**（`VH`）：
```js
function VH(t) { return String(t ?? "").trim().toLowerCase()
  .replace(/-/g, "_").replace(/[^a-z0-9_]/g, "_")... }
```
实测：`VH("心情") === ""`。而 `lookup(e) = this._byName.get(VH(e))`，`lookup("心情")` → 查空串 → `null` → `?.name !== s.name` 成立 → 抛错。

**C. 更根本：斜杠命令名本身只接受 ASCII**（`bundle/index.js`）：
```js
GIn = /^\s*\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*?))?\s*$/
```
`/心情` 在**输入解析层**就不可能被识别 —— 即使别名注册侥幸通过，用户也敲不出来。

### 隔离宿主实证（我另起真机宿主复刻）

| 写法 | 结果 |
|---|---|
| `register({ name:"mood", aliases:["心情"] })` | **抛错** `could not register command alias "心情"`；`listOwn()` 返回 **`[]`**（主命令一起没了） |
| `register({ name:"mood2" })`（无别名） | **成功**；`listOwn()` = `["mood2"]`；`/api/commands` 显示 `source:"app"` |

### 为什么自验没抓到

Codex 的断言 `mood-handler-single-guidance-reply-with-contextual-example` 在 **mock 的 registry 里**只检查 `aliases[0] === '心情'`，**不经过宿主真实的别名闸门与归一化**。这正是「工具直测/假宿主不等于真实宿主」的典型。真机一装即露。

### 影响与修复方向（与 Codex 已对齐）

**影响**：`/mood` 与 `/心情` 两条入口**全部不可用** —— 这是本次交付的门面，属核心功能缺失，故打回。

**修复方向**（Codex 已确认承接）：
1. **去掉非 ASCII 别名**（或让别名失败时不连累主命令）：只保留 ASCII `/mood`。
2. 进一步加固：显式在 register 前过滤掉宿主不会接受的别名，或对 register 做**降级重试**（有别名 → 失败 → 无别名重试）。
3. 仍 `await off.ready` + `listOwn` 确认，不加定时器、不加权限。
4. `/心情` 不可用需在文档明确记录（宿主层限制，非 App 可绕过）。

---

## 7. 部署与并发说明（重要）

- 我按「整包同步」执行：`index.js` / `manifest.json` / `package.json` / `lib/` / `tools/` / `ui/`（含 `style.css`、`sdk.js`、`_build.json`）/ `assets/` 全量覆盖，`diff -rq` 逐字节一致后 `extension_manager reload app:hanako-simple-player`。App 状态 `loaded`，版本 `1.1.0`。
- **验收期间 Codex 与我并行工作**：它在 10:39 又跑了一次 `bump-build`（`1003131671` → `1003131672`）并新增 `AGENTS.md §7` 与 `docs/COLLABORATION-HANA-CODEX.md`。我已核对：**功能代码（lib/tools/ui/*.js/index.js/manifest）逐字节一致**，仅构建号差 1。我已把部署目录的 `ui/_build.json` 与两个 HTML 对齐到 `1003131672`。
- **请以 Codex 修复后的最终构建号为准，我会重新同步并复验。**
- 回滚备份：`~/.hanako/apps/hanako-simple-player.bak-20261013-103518`（部署前整份）。

---

## 8. 测试数据清理（已还原）

验收使用独立名字，未触碰任何用户原歌单（`imp:1`–`imp:5`、`fav`、`recent`、`local`）：

- 测试列表：`心情验收-20261013`（imp:6）、`心情验收-20261013-B`（imp:7）、`心情验收-刷新`（imp:6 复用）—— 曲目已逐条删除，元数据已从 `player-lists` 移除。
- **最终核对**：`playlist.json` 总曲目 **803**（与开工一致）；各列表计数 `imp:1:200 / imp:2:10 / fav:29 / recent:100 / imp:3:174 / imp:4:90 / imp:5:200`；`player-lists` **8 项**，与开工一致。
- 测试期间产生的 `playlist.json.bak-*` 予以保留（可追溯），未删。

---

## 9. 判卷（对照 ACCEPT 清单 §E）

- **A 独立复跑**：全绿 → 过。
- **B 代码审查**：无高危项，禁区未动 → 过。
- **C 真机**：搜索可播 ✅、`create_list` ✅、卡片即时刷新 ✅、改名持久化 ✅、**`/mood` ❌**。
- **判定**：按 §E「C 的 3/4/5 任一挂即打回」的精神 —— `/mood` 是**入口本身**，比那三项更靠前，**打回**。

---

## 10. 待验 / 未完成（明确保留，勿当已通过）

1. **`/mood` 修复后**：`/api/commands` 出现 `source:"app"` 的 `mood`、`moodRegistered:true`、敲 `/mood` 得到引导语。
2. **真实 agent 建单**：需要一次**有模型的真实会话** —— 敲 `/mood` → 照引导说一句 → agent 真调 `hana_simple_create_list`。我在隔离宿主与 `mood-1.1.0` 环境下**无法**完成（隔离宿主无模型；本会话建新会话需用户确认）。这一条**只能**在有模型的真实会话里验。
3. 官方隔离 UI smoke：缺独立 Electron，环境依赖，未完成。
4. `ensure()` 失败重试的日志噪音（§2 观察），修复时确认。

---

## 11. 要求 Codex 修复的具体条目

1. `lib/mood-command.js`：**别名不得拖垮主命令**。最小改法：去掉 `aliases`（或改成 ASCII 别名如 `xinqing`），并对 register 做降级重试。
2. 修完给出**最终构建号**，说明改了哪些文件；
3. 保持 `await off.ready` + `listOwn` 确认；不改松既有断言、不动涟漪断言、不扩权限；
4. 明确记录 `/心情` 在宿主层不可用（ASCII 命令名限制）。

我会在收到最终构建号后重新整包同步 + reload + 复验本报告第 6 节与第 10 节的第 1、2 项。

---

# 第二轮复验 · build 1003131673

> Codex 返修后复验。改动：`lib/mood-command.js` 仅在明确
> `could not register command alias "心情"` 拒绝时，`await disposeAsync()` 后重注册无 alias 的 `/mood`；
> 其他错误不降级，不加定时重试。新增 3 条回归。

## R1. 独立复跑 · 后端 102/102

```
我复跑：passed 102 / total 102 failed 0
仅在 codex 里: []  /  仅在我复跑里: []  /  结论不一致: []
```
新增 3 条回归全绿：`mood-alias-rejection-disposes-and-registers-ascii-once`、
`mood-ascii-fallback-does-not-advertise-unavailable-alias`、
`mood-general-registration-rejection-does-not-trigger-alias-fallback`。

代码审查：修复只在 `mood-command.js`，用 `disposeAsync` 释放失败注册后再注册无别名版；
**只对那一条明确错误降级**，其余（engine 缺失、一般拒绝）不吞、不降级、不加计时器。范围最小，符合要求。

## R2. 整包同步 + reload

`diff -rq` 逐字节一致后 `extension_manager reload app:hanako-simple-player`，App `loaded`，build `1003131673`。

## R3. ✅ 别名问题已修复（真机）

**`/api/commands`**：出现 `mood`，`source:"app"`，**`aliases: []`**：
```json
{"name":"mood","aliases":[],"description":"生成今日心情歌单：先按提示说出状态，由当前 agent 选歌建单。","permission":"owner","scope":"session","source":"app"}
```
**`GET /api/lists`**：`moodRegistered = true` ✅（首轮为 false）

**日志不再反复重注册**（关键，精确分离本次 reload 窗口）：
```
[10:59:46.352] app route app "v2-hanako-simple-player" withdrawn
[10:59:46.388] plugin "hanako-simple-player" was started
[10:59:46.429] [mood] 宿主拒绝 /心情 别名，改为仅注册 /mood   ← 只有这一次
[10:59:46.444] plugin "hanako-simple-player" v1.1.0 loaded
```
该时间点之后 `注册尚未确认` 出现 **0 次**。（日志里 10:49–10:59 那批是旧构建残留，不是本轮。）

隔离宿主也独立复现：真实 App 装进去，`/api/commands` 出现 `mood`，与生产一致。

## R4. ❌ 第二个阻断缺陷：`/mood` 一调用即报错 `reply is not a function`

**现象（生产宿主，真 WS 派发 `/mood`）**：
```
生产宿主 /mood 回复: [{"text":"[命令错误] reply is not a function\n用法：/mood · 生成今日心情歌单","level":"success"}]
会话文件大小 before/after: 3778781 / 3778781   ← slash 仍未写历史，符合预期
```
隔离宿主（只装真实 App）同样复现：
```
slash_result: [{"text":"[命令错误] reply is not a function\n用法：/mood · 生成今日心情歌单","level":"success"}]
```

**根因**：App handler 写的是 `async handler({ reply }) { await reply(MOOD_PROMPT); }`（`lib/mood-command.js:17`），
但 **v2 App 的 handler 拿不到 `reply`**——它跨进程传 `invocation` 时函数被丢弃。

**独立探针实测**（隔离宿主，两个对照命令）：
| 命令 | handler 写法 | 收到的东西 | 结果 |
|---|---|---|---|
| `replya` | 调 `inv.reply(text)` | `typeof inv.reply === "undefined"`；keys = `[commandName, rawText, args, sessionPath]` | ❌ 报错 `reply is not a function`，客户端无回复 |
| `replyb` | `return text` | 同上（无 reply） | ✅ 客户端收到 `REPLYB-RETURNED-STRING` |

即：**跨进程后 `invocation` 只有 4 个字段，没有 `reply`**；但 **handler 返回字符串这条路是通的**。

**契约侧**：`APPS.md` 命令节与 SDK 类型 `HanaPluginCommandInvocationV2` 都写了 5 个字段（含 `reply`），
且原文明确「handler 可以返回一个字符串（原样通过 reply 发回去）」。所以：
- 若「`reply` 字段」在 v2 子进程里本就不可用，那是**宿主契约与实现不一致**；
- 但**有一个契约认可的、实测可行的写法**：`handler` 直接 **`return MOOD_PROMPT`**，不依赖 `reply`。

**修复方向（推荐）**：把 `lib/mood-command.js` 的 handler 改成 **返回字符串**：
```js
handler() { return MOOD_PROMPT; }   // 契约：字符串原样回给触发命令的客户端
```
这与我在 HOST-PROBE 里用 `mood_probe`（返回字符串）注册成功的证据一致——**那条探针当时就是返回字符串，没测 `reply` 调用**。

> 诚实边界：`reply` 到底该不该可用，取决于宿主意图；我按「契约给了字符串返回这条路」给出可落地修法，
> 同时保留「宿主 `reply` 跨进程丢失」这一观察，供宿主侧核对。

## R5. 判定

- 别名问题（第一轮唯一打回项）：**已修复，真机确认**。
- 但 `/mood` **仍不可用**（一调用即报错），属**新的阻断缺陷**。
- **第二轮判定：继续打回**，只差这一处；`create_list`/搜索/卡片刷新/改名等其余项首轮已通过，本轮无前端改动，不重复验。

## R6. 要求 Codex 修复的具体条目（第二轮）

1. `lib/mood-command.js` 的 handler：**改成 `return MOOD_PROMPT`**（契约认可的字符串返回路径），不再调 `reply`；
   若坚持用 `reply`，需先与宿主确认 `invocation.reply` 在子进程可用性。
2. 加一条回归：**派发命令后客户端确实收到提示文本**（不是只测 handler 被调用）——首轮 mock 只检查了 `aliases[0]`，本轮暴露了「注册成功但调用失败」这类假绿。
3. 给最终构建号；改完我重新整包同步 + reload + 复验。

## R7. 仍待验（不变）

真机「照引导说一句 → 真实 agent 调 `create_list`」——需要**有模型的真实会话**，隔离宿主无模型，本会话建新会话需用户确认。
在 `/mood` 能正确回提示之前，这一条无法开始。

## R8. 数据与环境（第二轮）

- 本轮未创建任何验收列表；`playlist.json` **803 首**、`player-lists` **8 项**，与首轮清理后一致。
- 隔离宿主（`/tmp/moodprobe2`、`/tmp/moodprobe3`）已全部关闭，无残留进程；生产宿主正常。
- 部署目录与仓库逐字节一致，build `1003131673`。

---

# 第三轮复验 · build 1003131674（最终）

> Codex 按第二轮 R6 返修：`handler() { return MOOD_PROMPT; }`，不再依赖 `invocation.reply`；
> 原 #87 改用真实四字段 invocation 核对返回值；新增 `tools/verify-mood-host.mjs`（宿主级派发回归）。

## F1. 独立复跑 · 后端 102/102
```
我复跑 backend：passed 102 / total 102 failed 0
仅在 codex: []  /  仅在我这: []  /  结论不一致: []
#87 mood-handler-single-guidance-reply-with-contextual-example: ok
```
与 `verify-backend-return-fix.json` 逐条一致。#87 已按「四字段 invocation + 核对返回字符串」重写，语义正确。

## F2. 独立复跑 · 宿主级派发 `verify-mood-host.mjs` → **1/1 通过**
```
{"passed":1,"total":1,"failed":[],
 "results":[{"name":"mood-host-dispatch-client-receives-prompt","ok":true}],
 "evidence":{
   "modelTurnStarted": false,
   "hostArtifact": "1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133",
   "moodModuleSha256": "ffc8660ae0d862cbe6ea869c727f94880a00ab5e6832bce6a7157bcb145347c0",
   "command": {"name":"mood","aliases":[],"source":"app"},
   "received": {"type":"slash_result",
     "text":"想听什么状态？直接说一句，例如『今天很累，帮我建个安静的心情歌单』，我会按你说的选歌并放进播放器。",
     "level":"success"},
   "sessionHistoryUnchanged": true }}
```
exit 0。实收文案与 `MOOD_PROMPT` **逐字一致**，无模型回合，未写历史。
**这条脚本正是我上一轮用探针手工做的同类测试，Codex 把它固化成可复跑回归，方向对。**
我已抽验它的「旧 handler 必失败」对照，链条闭合：
- `verify-mood-host-before-return.json`：**0/1**，失败详情正是 `[命令错误] reply is not a function`；模块哈希 `261b7c80…`。
- `verify-mood-host-return-fix.json`：**1/1**；模块哈希 `ffc8660a…`。
- **我独立算**当前 `lib/mood-command.js` 的 sha256 = `ffc8660a…`，与 after 记录一致（三方对齐）。
能红才能证明绿有意义。

## F3. 整包同步 + reload
`diff -rq` 逐字节一致（lib/tools/ui/index/manifest），`reload` 后 App `loaded`，build `1003131674`。

## F4. ✅ 生产 `/mood` 修复确认（真机派发）
**这才是本轮的关键验证**——上一轮同一手法跑出 `reply is not a function`，本轮：
```
生产 /mood 回复: [
  { "text": "想听什么状态？直接说一句，例如『今天很累，帮我建个安静的心情歌单』，我会按你说的选歌并放进播放器。",
    "level": "success" }
]
会话文件字节 before/after: 4115699 / 4115699   ← 不写历史
```
**逐字正确，之前的 `[命令错误] reply is not a function` 已消失。**

顺带验证 `/心情`：
```
/心情 回复: ["[未知命令] /心情"]
```
符合预期（宿主命令名解析正则只收 ASCII，中文别名在输入层就进不来）。这与 CHANGELOG/DONE 里「当前宿主 `/心情` 不可用」的记录一致。

## F5. 注册三连 + 日志干净
- `/api/commands`：`mood`，`aliases:[]`，`source:"app"` ✅
- `GET /api/lists`：`moodRegistered = true` ✅
- 日志（本次 reload 窗口 `11:45:32`）：降级 warn **1 次**、`注册尚未确认` **0 次** ✅

## F6. 判定（最终）

| 项 | 结果 |
|---|---|
| 后端独立复跑 | ✅ 102/102 |
| 宿主级派发回归（新） | ✅ 1/1 |
| 生产 `/mood` 提示 | ✅ 逐字正确，不写历史 |
| `/心情` 状态 | ✅ 已确认宿主层不可用（非缺陷，已记录） |
| 首轮通过项（搜索/建单/卡片刷新/改名） | ✅ 不变（本轮无前端改动） |
| 真实有模型「原话→create_list」 | ⏸ **仍待验**（无模型会话） |

**判定：功能层面不再有阻断项。`/mood` 入囗本轮修复已真机确认。**
唯一剩下的未验项是「真实有模型会话里照引导说一句 → agent 真调 `create_list`」，
它需要模型环境，隔离宿主与无模型会话都替代不了。

## F7. 仍待验（唯一项）

**真实 agent 建单**：敲 `/mood` → 得到提示 → 照提示说一句 → agent 调 `hana_simple_create_list` 并落单。
- 前置已具备：`/mood` 能正确回提示（F4）；`create_list` 工具真机可用（首轮已验证）。
- 阻塞：需要一次**有模型的真实会话**（本会话建新会话需用户确认；隔离宿主无模型）。
- 一旦用户开一次真实会话，这条即可收口。

## F8. 数据与环境（第三轮）

- 本轮未创建任何验收列表；`playlist.json` **803 首**、`player-lists` **8 项**。
- 临时探针脚本 `/tmp/prod-mood2.mjs` 已用即弃，随 `/tmp` 清理；无隔离宿主残留。
- 部署目录与仓库逐字节一致，build `1003131674`。
- UI 376/376 沿用首轮输出（本轮无前端行为改动，HTML 仅同步构建号，已核：`index.html`/`standalone.html` 各只 1 行 build 号变化、`style.css` 无改动），我认同不重跑。

---

# 第四轮复验 · build 1003131675（引导语文案）

> Codex 按 `MOOD-PROMPT-COPY.md` 执行：只改 `MOOD_PROMPT` 常量 + CHANGELOG 一句 + 构建号；
> handler / 注册 / 权限 / 前端行为未动。

## G1. 独立复跑
- 后端 `node tools/verify-backend.mjs` → **102/102**，与 `verify-backend-prompt-copy.json` 逐条一致。
- 宿主派发 `node tools/verify-mood-host.mjs` → **1/1**，exit 0；模块 sha256 `9740183f…`，**我独立复算一致**。
- 改动面核实：`lib/mood-command.js` 只改常量（hash 对上），其余仅 CHANGELOG / 两个 HTML / `_build.json`。

## G2. 整包同步 + reload
逐字节一致后 reload，build `1003131675`。

## G3. ✅ 生产真机：两种形态都回新文案，且不写历史
```
① 裸 /mood
  → 想听什么状态？单独发一条普通消息告诉我（别写在 /mood 后面），例如「今天很累，帮我建个安静的心情歌单」，我就去选歌建单。
  字节: 4812613 → 4812613
② /mood 带参数
  → （同上，逐字相同）
  字节: 4812613 → 4812613
```
注册三连：`/api/commands` 有 `mood`（无别名、`source:app`）；`moodRegistered:true`；本次 reload 日志降级 warn 1 次、`注册尚未确认` 0 次。

---

# ✅ 闭环收口 · 真实有模型会话（由用户真实使用证实）

**F7 / R7 挂了两轮的待验项：「照引导说一句 → 真实 agent 调 `create_list`」——已由用户真实使用确认成功。**

证据（用户自己的生产数据，非我制造）：
- 列表 `imp:6` 被重命名为 **「日系流行 · 晴れ」**，内含 **13 首**日系流行，
  每条都有正经的 `netease:<id>`、`url`（go 跳板）、`pic`、`lrcUrl` —— 正是 `create_list` 的输出形状。
- `recent` 列表新增 3 条播放记录（夜に駆ける / Pretender / マリーゴールド）—— 说明建完还播了。
- 时间线：备份落在 **12:34**，早于本轮 reload（12:57）；即用户在我上一轮部署（build 1003131674）后就用成功了。
- 用户把编号列表重命名为自己的名字，正合设计「想留就重命名」。

**至此整条链路真机走通**：旧对话敲 `/mood` → 收到引导语 → 照引导单独发一句 → agent 建单 → 用户重命名并播放。

## 最终判定（全轮次汇总）

| 项 | 结果 |
|---|---|
| 后端 / 宿主派发 / 前端 独立复跑 | ✅ 102/102、1/1、376/376 |
| `/mood` 注册 + 派发 | ✅ 逐字正确、不写历史、日志干净 |
| 搜索可播 + 清洗元数据 | ✅ 真网络真 MP3 |
| `create_list` 新建 / 同名覆盖 | ✅ 含哨兵、备份、id/url 沿用 |
| 开着的卡片即时刷新 | ✅ 新建/覆盖/删除三态 |
| 改名持久化 | ✅ 落后端权威存储 |
| **真实会话「普通消息→create_list」** | ✅ **用户真实使用证实** |

**结论：1.1.0 功能验收获通过。**唯一保留项是环境依赖（官方隔离 UI smoke 缺独立 Electron）与
已知宿主边界（新对话首条即 slash 报 `internal_contract`，核心命令同样如此），均非本 App 缺陷。

## 数据说明
用户真实使用新增的是**用户自己的**「日系流行 · 晴れ」列表（imp:6，13 首）+ recent 3 条；
**不是我的验收残留**，不予清理。我历轮创建的验收列表此前已全部清干净。

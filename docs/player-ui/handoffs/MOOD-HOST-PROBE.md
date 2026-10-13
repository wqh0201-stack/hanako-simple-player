# MOOD-HOST-PROBE · /mood 注册时序与宿主行为实测

> 提问方：实现播放器 1.1.0 的 Codex。执行方：哦鲸鲸（验收方）。
> 日期：2026-10-13。宿主：HanaAgent beta **1.1.0-beta**（`1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133`）。
> 目标：只探查 `/mood` 注册可靠时序与相关宿主行为，**不改源码、不碰生产数据**。
> 本文件为新增交接稿，未修改仓库其他文件。

---

## 0. 结论速览

| 问题 | 结论 | 证据等级 |
|---|---|---|
| `ctx.storage.global` 在 apply 阶段可用吗 | **可用**，apply 顶层即可读写 | **真机已验证** |
| `onChanged` 覆盖后端写入吗 | **覆盖**；且写入**无条件广播**（同值也触发） | **真机已验证**（后端进程侧） |
| 卡片侧能否收到 | 通道与契约一致，但无头环境无窗口，**未跑真卡片** | 契约 + 源码已确认，**真机待验** |
| `commands.register` 在 apply 顶层可用吗 | **可用**；返回 disposer 带 `ready` Promise，`await` 后 `listOwn` 读回成功 | **真机已验证** |
| 需要「装载完成信号」吗 | **本宿主不需要**：engine 在任何 App 装载前就已 init 完成 | 源码 + 启动日志 + 真机成功三重 |
| `/mood` 的回复落进会话历史吗 | **不落**；`slash_result` 只发客户端，不进模型上下文 | **真机已验证**（WS 派发）+ 源码 |

**一句话**：Codex 提议的写法（apply 结束时非阻塞注册 + `await disposer.ready` + `listOwn` 回读）**可行且可靠**，实测通过。但 `/mood` 的回复不进历史，这条在文档里已单独提示。

---

## 1. 环境与方法（为什么不是 Builder）

- **本机未安装 Hana Builder App**（`~/.hanako/apps/` 无 builder，工具目录无 `hana_builder`），故走**隔离 headless 宿主**这条路，它对本题更硬：真 `bootstrap.js`、真 `app-host-entry.js` 子进程、真 engine、真 slash registry。
- 起法（完全隔离，独立 `HANA_HOME`）：

  ```bash
  ROOT=/Users/can/.hanako/artifacts/server/1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133
  HANA_HOME=/tmp/moodprobe/home HANA_ROOT="$ROOT" HANA_SERVER_ENTRY="$ROOT/bundle/index.js" \
    "$ROOT/node" bootstrap.js
  ```

  注意两点（都是实测踩出来的）：
  1. 必须用**产物自带的 `$ROOT/node`**（v26.8.1）。系统 Node 22 与之 ABI 不符，`better-sqlite3` 报 `NODE_MODULE_VERSION 147/127` 直接崩。
  2. 必须给 `HANA_ROOT` + `HANA_SERVER_ENTRY`（打包产物校验），否则 `HANA_RUNTIME_ENTRY_MISMATCH`。
- **探针 App**：`/tmp/moodprobe/home/apps/mood-probe`，`capabilities: []`，`index.js` 在 `apply` 里做五件事（见 §3 原始记录），结果落 `app-data/mood-probe/probe.json`。
- **无需人工审批**：隔离 HOME 里预置一条 `extensions/installs.json` 记录，带 `approval.appDeclaration`（`capabilities: []`）。**零能力声明 = 无权限弹窗**，所以能在无人值守下装载。
- 全程只读生产、只写 `/tmp`。生产宿主（PID 28107）全程健在，`app-data/hanako-simple-player/playlist.json` 未动。

---

## 2. 逐问证据

### Q1 · `ctx.storage.global` 在 apply 阶段的实际时序 → **可用**

**真机已验证。** 探针在 `apply` 顶层（不是工具 execute、不是 bus 回调）直接调用：

```js
const v = await ctx.storage.global.get("probe-key");   // → null（未写过）
await ctx.storage.global.set("probe-key", "set-at-apply"); // → ok
const keys = await ctx.storage.global.keys();          // → ["probe-key"]
```

落盘证据（第一次探针运行）：

```json
{ "k": "storage.hasGlobal", "v": true },
{ "k": "storage.get",       "v": null },
{ "k": "storage.set",       "v": "ok" },
{ "k": "storage.keys",      "v": ["mood-probe-key"] }
```

**为什么 apply 阶段就能用（与 `ctx.config` 的区别）**：源码里 `ctx.storage` 的实现是闭包 `Mt(appId)`，每个方法直接 `lPt(hanakoHome, appId)` 拿 `AppStorageStore` 读文件，**不依赖宿主贡献表、也不依赖 engine 服务**。而 `ctx.config` 走贡献表，apply 期间还没登记，所以「答空 / 拒收」（APPS.md 明写）。两者同族是假象，**storage 在 apply 阶段就是通的**。

旁证：同宿主版本、正在运行的 `answer-choice` 就在 `defineApp` 顶层 `await sdk.storage.global.get("form")`，其注释还专门解释了「`ctx.config` 写进去读不回来，所以改用 storage」——与本实测一致。

### Q2 · `onChanged` 是否覆盖后端写入 → **覆盖，且无条件广播**

**真机已验证（后端进程侧）。** 探针在 `apply` 里订阅 `ctx.storage.global.onChanged(cb)`，随后**经后端路由**（HTTP，非同一调用栈）写 storage：

```bash
POST /api/apps/mood-probe/routes/api/probe-write
  body: {"key":"player-lists","value":[...,{"id":"imp:99","name":"今日心情"}]}
```

回调**触发**：

```json
[{ "kind": "storage.changed", "keys": ["player-lists"] }]
```

**无条件性**（对「同名歌单替换曲目」很关键）：同一 key、**完全相同**的值连写两次，回调触发 **2 次**：

```json
[{"keys":["player-rev"]},{"keys":["player-rev"]}]   // 两次，值一模一样
```

**两个必须知道的前端坑**：

1. **必须用 `hana.storage.global.onChanged`**（走 `hana.app.storage.changed`，带 `scope` + `keys`）。
   **别用**扁平的 `hana.storage.onChanged`（走 `hana.storage.changed`，v1 插件通道）——后端写存储时它**收不到**。SDK 里这是两条不同分支。
2. **回环**：前端自己也会收到自己触发的广播，重渲染前必须用内容比较（你们已有 `listNamesKey()`），别用「打标记忽略下一次」。

**仍未验证（真机）**：卡片侧。广播在**宿主那侧**是「向已挂载的同 appId 窗口 post `hana.app.storage.changed`」，源码路径清楚，但无头宿主没有窗口，**没跑真实卡片**。这一条我标 **待真机**：等整包同步 + reload 后，用真实卡片验一次「后端写 → 开着的卡片重拉」。

### Q3 · `/mood` 注册：apply 顶层 vs bus 回调 vs 工具 execute

**真机已验证：apply 顶层同步调用即可，且可靠。**探针在 `apply` 顶层（同步）注册，未 await：

```js
off = ctx.commands.register({ name: "mood-probe", handler: () => "probe ok" });
// off 是 function，带 ready: Promise 与 disposeAsync
await off.ready;                    // → resolved
const own = await ctx.commands.listOwn();  // → ["mood_probe"]
```

**三重交叉验证**：
1. `off.ready` resolved；
2. `listOwn()` 读回 `["mood_probe"]`；
3. 宿主 `/api/commands` 里出现 `source: "app"` 的条目：

```json
{"name":"mood_probe","aliases":[],"description":"probe: registered at end of apply","permission":"owner","scope":"session","source":"app"}
```

（顺带：命令名被归一为下划线 `mood_probe`；`listOwn` 返回的是**归一后**的名字。）

**关于「engine 未挂载」的警告**：对 `ctx.config` 成立，对 `commands` **本宿主不成立**。证据链：

- 源码：`hana-engine` 单元在 engine **构建解析时** `ctx.provide("engine", engine)`；注释明言「`inject: ["engine"]` 的消费者会真正等待构建完成」（v2a δ0 §二）。
- 启动序列（源码 `startServer`）：`await M.init(...)` → 日志「② engine.init 完成」→ 之后才 `pluginRuntimeV2.loadAll(...)`，而 `loadAll` 才 spawn App 子进程。
- 启动日志实测（生产与隔离一致，毫秒级）：

  ```
  [07:41:31.294] ② engine.init 完成
  [07:41:31.341] builtin app jimeng-cli loaded ...
  [07:41:31.425] [answer-choice] loaded
  ```

  engine 早于任何 App ~50ms 完成。

**所以：本宿主不需要额外的「装载完成信号」。** 若要做防御性写法，可靠的收据就是 `off.ready`：`await` 它并 `.catch` 报错即可（SDK 的 `awaitRegistration` 要求返回带 `ready` Promise 的 disposer，否则报 `APP_SDK_HOST_UNSUPPORTED`——裸 `ctx` 与 `sdk.*` 两条路都返回这个形状）。

**注意 Codex 猜想的一处修正**：不必非要「apply 结束时非阻塞启动」。apply 顶层**同步**调用 `ctx.commands.register` 即可，注册动作本身由宿主在 apply 返回后排干。异步化只是让你能 `await ready` 拿到失败回执，不是可用性前提。

### Q4 · `/mood` 回复后用户再发消息，agent 能否自然接上 → **不能，回复不进历史**

**真机已验证（WS 派发）。** 用真 ticket 连 `/ws`，先 `prompt` 再发 `slash`：

```
· ticket = got
· ws = open
· sent.slash = /mood-probe
· ws.messageTypes = {"error":1,"slash_result":1}
· slash_result = [{"text":"probe ok","level":"success"}]
· sessionFile.lines = 0          ← 会话文件仍为空
· sessionFile.containsMoodReply = false
```

即：**命令回复原样送达客户端，但没有写进会话文件**。

**源码同证**（两处独立）：
- 桌面端 `/mood` 分支：`reply` 只是 `ji(Ue, { type: "slash_result", ... })`；该分支内 `appendEntry` / `session:send` / `history` / `triggerTurn` **一个都没有**。
- `SlashCommandDispatcher.tryDispatch` 尾部：`await r.reply(...)` 后直接 `return { handled: true }`，不碰会话写。

**客户端渲染**：`slash_result` → `hana-inline-notice` CustomEvent → **3 秒自消失的浮提示**（`setTimeout(..., 3000)`）。

**结论**：`/mood` 是**提示牌，不是桥**。引导语必须让用户「照着一句话再说一遍」，agent 靠**工具描述** + 那句原话接上，不能指望命令本身传上下文。

> ⚠️ 方法学诚实说明：那次 WS 探测里 `prompt` 一步因隔离环境**无可用模型**（`[chat] submission failed ... code:"UNKNOWN"`，日志「未找到可用模型」）而失败，所以「会话文件为空」**不能单独**用来证明 slash 不落历史。但 `slash_result` 是**干净送达**的（`error` 那条来自 prompt，不是 slash），且源码两处独立确认 slash 分支无任何写历史调用。两者合起来结论成立。

---

## 3. 给实现的具体建议

1. **`ctx.storage.global` 随便用**，apply 里读列表元数据没问题。**唯一注意**：apply 期间写存储时，那次写入的广播在本进程里可能发不出去（源码：engine 未就位时 `warn("could not broadcast")` 后仍**正常写盘**）。所以**别在 apply 里写 `player-lists` 并指望当场广播**；首屏读没问题。
2. **`onChanged` 用 `hana.storage.global.onChanged`**，不要扁平版。用 `listNamesKey()` 做内容比较防回环。
3. **「覆盖歌单内容」要额外通知**：`player-lists` 不变 → 不广播。补一个**版本哨兵键**（如 `player-rev = Date.now()`，写曲目后 `ctx.storage.global.set`）。本实测证明该键**同值也会广播**，但**仍建议每次写递增/时间戳**，语义清晰且便于前端比较。**别自建 SSE**。
4. **`/mood` 注册**：apply 顶层同步 `ctx.commands.register({ name: "mood", aliases: ["心情"], ... })` 即可；`.catch` 挂到 `off.ready` 上以便暴露失败。**不加 `app/session.start-turn`**。
5. **`/mood` 文案**：必须让用户「照说一句」，例：
   > 想听什么状态？直接说一句，例如「今天很累，来点安静的」，我就去建一个心情歌单。
   agent 接到「建一个心情歌单」会命中 `create_list` 工具描述——入口靠**工具描述**，不靠上下文。

---

## 4. 仍未验证 / 边界（请勿当成已通过）

- **卡片侧 onChanged 收到后端写入**：源码与契约一致，但**需真实卡片真机复验**（整包同步 → reload → 后端写 → 卡片重拉）。无头宿主无窗口，本次跑不了。
- **真机 `/mood` → agent 接上建单**：需真实会话 + 有模型，本次隔离环境无模型，**未验**。这属于你们整包交付后的验收项。
- **`commands.register` 在「engine 真的缺席」的宿主上**：本宿主 engine 必到，没构造出缺席场景；`off.ready` 的 reject 路径未实测。
- 隔离宿主起在端口 31478（`--port 27977` 被忽略，宿主自选端口；以 `server-info.json` 为准）。

---

## 5. 原始证据存放

- 探针源码：`/tmp/moodprobe/home/apps/mood-probe/index.js`
- 探针落盘：`/tmp/moodprobe/home/app-data/mood-probe/probe.json`
- WS 派发结果：`/tmp/moodprobe/ws-probe-result.json`
- 隔离宿主启动日志：`/tmp/moodprobe/boot.log`
- 隔离宿主记录：`/tmp/moodprobe/home/server-info.json`

> 这些都是 `/tmp` 一次性产物，随时可删；**没有写进仓库，也没有碰生产 app-data**。

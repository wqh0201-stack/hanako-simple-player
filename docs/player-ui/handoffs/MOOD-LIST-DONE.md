# MOOD-LIST-DONE · 心情歌单 1.1.0

2026-10-13 · Codex 实现；哦鲸鲸验收。版本 **1.1.0**，当前构建 **1003131675**（首轮交接 1003131671）。许可证保留 AGPL-3.0，manifest 能力与网络声明逐项未变。

## 交付范围

列表名字和顺序仍在宿主 `player-lists` 原键，形状仍为 `[{id,name}]`，前端通过后端读写、订阅 `hana.storage.global.onChanged`。`hana_simple_list_music` 增加列表与计数；新增 `hana_simple_search_music` 和同名覆盖的 `hana_simple_create_list`。`/mood` 只回复一句带建单意图的示例，不写历史、不启动回合。当前宿主拒绝中文别名且解析器不接受 `/心情`，只保证 `/mood` 入口；见末尾真实验收返修。

依据：任务书及用户的后续两处修正；固定列表校验按用户明确答复「严格返回 400」。原有 TASK 与 ACCEPT 文件未修改。

| 文件 | 变化与理由 |
|---|---|
| `lib/lists.js` | 原键读写、整份校验、共享串行写者；可选 baseLists 只应用前端实际改动，避免旧快照删掉 agent 新建列表。 |
| `lib/library.js` | 建单覆盖、UI 预留编号、写前 `.bak-*` 备份、原子文件替换及 storage 失败回滚；曲目快照合并保留外部新增与未被本地改动的字段。 |
| `lib/music-metadata.js` | 知识库三条清洗硬规则、版本敏感的歌名匹配、最近时长排序与 >60 秒存疑。 |
| `lib/mood-command.js` / `index.js` | apply 末尾注册，等待原始 disposer.ready，listOwn 回读；缺 engine 时不提交必败注册，无定时重试；随 App 清理。 |
| `lib/register-routes.js` | GET/PUT `/api/lists`；兼容任务书 saveLists 指定的 POST（同一处理器）；POST `/api/lists/allocate` 把 UI 编号归后端。旧 playlist 路由保留，接入可选 baseTracks 与内容哨兵，所有旧路径保留。 |
| `lib/register-tools.js` | 注册两个新工具，保留横幅会话跟随；特殊环境的后续工具/会话回调可补注册，正式首次装载不依赖它们。 |
| `tools/create-list.js` / `tools/search-music.js` | 两段工具描述逐字采用定稿；结果的 source 可原样传递。搜索另回 lrcUrl 便于建单保留歌词地址。 |
| `tools/list-music.js` / `tools/play.js` | 保留原查询参数与可播地址；play 写入也发内容哨兵并使用共享写者，删除了不存在的 30 秒合并承诺。 |
| `lib/meting.js` | 保留官方 dt 转换后的秒数；允许现有官方搜索带 cookie；歌词返回实际成功节点的 URL，避免补齐后又给一个失败节点。未加音源节点。 |
| `ui/app.js` | saveLists 调用点保留，改 POST 保存；boot 后端优先、旧 storage 回落；内容比较去回环；曲目刷新保留正在播的已移除录音；所有日常 nextImportId 调用改为后端预留。 |
| `tools/verify-backend.mjs` / `tools/verify-ui.mjs` | 原断言保留并增加新验收；欢迎曲测试只加 await 适配异步编号，未改断言条件，未改涟漪断言。 |
| `tools/verify-mood-host.mjs` | 同版本隔离宿主装载原样生产 mood 模块，真 slash 派发与 WebSocket 客户端收包，断言文本精确等于 MOOD_PROMPT；无模型、无生产数据。 |
| `tools/pack-release.mjs` | 新运行时工具加入发布白名单，不能漏包。 |
| `manifest.json` / `package.json` / `docs/CHANGELOG.md` | 1.1.0 与面向用户的变更说明。 |
| `ui/_build.json` / 两个 HTML | bump-build 已跑；孪生文档只差 data-shell，三处 build 一致。 |

## 数据与并发保护

- PUT 缺固定项、空 id/名字、重复 id、非数组一律 400，整份校验后才写；空存储读取提供默认三项。POST 与 PUT 同一校验，不改旧存储格式。
- `create_list` 同名替换，空 tracks 合法且保留列表；新列表编号同时检查元数据与曲目中的 orphan `imp:N`。UI 预留和工具建单共享串行队列。历史无 list 数据的批量迁移映射保持原行为，日常新建不再由前端算号。
- 已有录音副本沿用原 id/url 与未知字段；新条目的平台 id、媒体文件名、name: 回退格式与现有 UI 一致。未修改 normalizeAppUrl、withSession、go 跳板、trackKey 或其他现有 storage key。
- 内容哨兵为 **player-library-revision**（每次 UUID，避免同毫秒撞值），同名覆盖、playlist 保存、删除与 play 更新会通知卡片。新建同时写 player-lists，已有宿主广播足够；没有 SSE 或心跳。
- 名称比较使用 listNamesKey（JSON 避免特殊字符分隔碰撞）；曲目比较落盘 raw，音频 loadedmetadata 的运行时时长不会误触发重渲染。自己的写也重拉，不忽略某一条广播。
- 最后补了 baseTracks 合并：若卡片读到旧快照后 agent 新建曲目，卡片只应用自己的改动，保住新增；同一条目的外部封面更新也不被本地改名覆盖。无 baseTracks 的旧客户端仍保留全量替换语义。

## 验证与原始输出

开工：backend **32/32**；本轮实跑 UI **367/367**（验收方原基线 366/367，唯一允许红项仍为既有涟漪 flaky）。

列表阶段：backend **40/40**；新增浏览器专项 **9/9**；全量 UI **376/376**。
工具阶段：backend **85/85**；全量 UI **376/376**。
首轮交接：backend **99/99**；UI **376/376**、12/12 布局自检、wiring/migration/lifecycle 均 true、runtimeErrors 为空。中文 alias 返修后 backend **102/102**；handler 字符串返修后 backend 仍 **102/102**，另增真实宿主派发回归 **1/1**。后端命令改动未重跑前端全量，前端行为验证仍为首轮输出。所有现有断言保留；原 handler 断言改为四字段 invocation 下核对返回字符串，真实送达由新宿主回归覆盖。

原始输出放在本目录 `mood-1.1.0/`，没有用手写摘要替换 stdout。`verify-backend.json` 是首轮完整 99 条结果；`verify-backend-alias-fix.json` 是返修后 102 条；`verify-ui-before.json` 是开工留底；`verify-ui.json` 为首轮最终完整 stdout，`verify-ui-report.json` 为全部断言与浏览器报告。

handler 返回字符串后的原始输出是 `verify-backend-return-fix.json` 与 `verify-mood-host-return-fix.json`；真实回归在修改前的红项也保留为 `verify-mood-host-before-return.json`，确实复现 `reply is not a function`，没有将 level:success 当作提示正确的证据。

官方静态校验在临时目录 `/tmp/hanako-mood-validation/hanako-simple-player` 通过（仓库目录名与 manifest id 不一致，所以必须按真实 App 目录名暂存，不能改 manifest id）。只有通用 dynamic-dependencies warning。

**工具阶段尝试的官方隔离 UI smoke 未完成**：缺独立 Electron，工具实际报 `UI smoke requires an Electron runtime. Set HANA_APP_ELECTRON ...; the packaged Hana desktop executable is not a script runner.` 原始失败输出已存 `validate-smoke-unavailable.txt`。没有把它算成功，也未自动安装 Electron。Chrome 的项目 headless 验证正常；待有开发 Electron 路径后再跑官方 smoke。

## §5 开放问题结论

| 问题 | 结论与证据边界 |
|---|---|
| 1. storage 的 apply 时序 | 验收方使用同版本真实隔离宿主测 get/set/keys 全成功，详见 MOOD-HOST-PROBE.md Q1。实现按异步 RPC await。播放器 apply 不写列表或曲目哨兵，不依赖装载期广播。 |
| 2. onChanged 回环与延迟 | 真实后端进程订阅确认同 key 同值连写触发两次，见 HOST-PROBE Q2。前端使用 global 作用域，headless 内容相等广播的 250ms 观察窗里无列表 DOM 重建、无写回；外部新建与同名内容覆盖均刷新。Hana 后续真实卡片验收确认无重载新建出现、覆盖保留、删除消失，见 MOOD-ACCEPT §4；精确到达延迟与跨窗口广播仍未测量，未把假宿主延迟称为真机数据。 |
| 3. mood 注册位置 | 原候选「只在工具/会话回调」会错过首次入口。真实隔离宿主 apply 调用 register，off.ready resolved，listOwn 读回 mood_probe，宿主 /api/commands 显示 source:app；启动序列 engine.init 在 loadAll 前被 await。采用 apply 末尾先 listOwn 探测、register、await ready、再 listOwn 确认。缺 engine、异步拒绝、ready 成功却无目录条目均有单测。正常启动无需先发话或调工具。 |
| 4. 轻版实际链路 | HOST-PROBE Q4 真 WS 收到 slash_result，源码确认不写历史；隔离环境无模型，不能证明后续 agent 调 create_list。提示示例明确说「今天很累，帮我建个安静的心情歌单」。最终真实有模型会话仍由验收方复跑，不加 start-turn。 |
| 5. 时长阈值 | 同名且相同版本候选按绝对时长差排序；60 秒不标、61 秒标存疑但不丢。只有未知时长时退到搜索顺序；保留可播原源与原源时长。离线边界断言通过，没有依据把阈值缩到 10 秒。 |
| 6. 二次匹配接口 | 最短复用链路是 searchNeteaseOfficial（已有 name/ar/al.picUrl/dt）+ getLyric（已有 Meting LRC 链）。补回被归一化丢掉的 dt，不加端点或音源节点。按查询/歌词 id 缓存，一轮最多 3 个 worker；网易云 cookie 默认整条网易云，显式 provider 仍尊重参数。真网络可播性/封面/歌词须真实验收。 |
| 7. imp:N 并发 | 必须一起改 nextImportId；已改为异步调用 /api/lists/allocate，链接歌单、本地文件、B站合集、欢迎曲全部使用后端预留。与 create_list 共享队列，联合元数据/曲目最大编号；并发四个创建/预留与同名竞争断言通过，不留日常前端算号。 |

## 尚需哦鲸鲸完成的真机验收

1. 独立复跑 backend/UI，看原始 stdout；审查新工具包白名单及数据边界。
2. 同步**整个运行时改动**（index/lib/tools/manifest 等），其中 ui 必须整包（含 style.css、sdk.js、_build.json）；或沿用仓库本地来源，然后 extension_manager reload app:hanako-simple-player。仅 UI 同步会缺新增工具。
3. 从宿主 / 菜单及 App 的 GET /api/lists 返回 moodRegistered（该值来自 listOwn 确认）核实 mood；输入 /mood，照示例说一句，确认真正 agent 选曲并调用 create_list。当前宿主不支持 /心情。
4. 在原来开着的卡片里测试新建与同名覆盖（不重载）、新曲目真播放、封面/歌词；改名后刷新仍在。避免覆盖用户已有列表，使用独立验收名字。
5. 把真机现象与失败证据另存验收报告；不得用本地 mock、工具直测或本交接的陈述替代真实会话结果。

## 新增后端断言编号（原 1–32 保留）

| 编号 | 稳定断言名 |
|---|---|
| 33 | `lists-put-get-shared-key` |
| 34 | `lists-renamed-name-on-disk` |
| 35 | `lists-reject-not-array-without-write` |
| 36 | `lists-reject-empty-id-without-write` |
| 37 | `lists-reject-missing-fixed-without-write` |
| 38 | `lists-reject-blank-name-without-write` |
| 39 | `lists-reject-duplicate-id-without-write` |
| 40 | `lists-stale-ui-save-preserves-agent-list` |
| 41 | `create-list-allocates-above-metadata-and-orphan-tracks` |
| 42 | `create-list-keeps-existing-id-url-and-unknown-fields` |
| 43 | `create-list-other-lists-unchanged` |
| 44 | `create-list-backup-before-write` |
| 45 | `create-list-same-name-replaces-and-dedupes` |
| 46 | `create-list-same-name-publishes-content-revision` |
| 47 | `create-list-empty-replacement-keeps-name` |
| 48 | `create-list-long-special-name-is-data-not-path` |
| 49 | `create-list-reject-blank-name-without-write` |
| 50 | `create-list-reject-missing-source-without-write` |
| 51 | `create-list-reject-bad-tracks-without-write` |
| 52 | `create-list-reject-bad-duration-without-write` |
| 53 | `create-list-and-ui-reservation-share-one-number-sequence` |
| 54 | `create-list-concurrent-same-name-one-list` |
| 55 | `create-list-storage-failure-rolls-back-playlist` |
| 56 | `create-list-queue-recovers-after-failure` |
| 57 | `list-music-metadata-counts-independent-of-track-filter` |
| 58 | `lists-allocate-route-persists-reservation` |
| 59 | `clean-preserves-version-DJ版` |
| 60 | `clean-preserves-version-曼波版` |
| 61 | `clean-preserves-version-Live` |
| 62 | `clean-preserves-version-Remix` |
| 63 | `clean-preserves-version-伴奏` |
| 64 | `clean-preserves-version-cover` |
| 65 | `clean-preserves-version-ver.2` |
| 66 | `clean-book-name-and-singer-without-up` |
| 67 | `clean-singer-prefix-threshold-three` |
| 68 | `clean-prefix-below-three-is-not-split` |
| 69 | `clean-japanese-romanized-alias-not-mis-split` |
| 70 | `clean-up-singer-conservative` |
| 71 | `match-name-and-nearest-duration` |
| 72 | `match-version-does-not-collapse-to-studio` |
| 73 | `match-duration-soft-sixty-second-boundary` |
| 74 | `search-default-bili-clean-metadata-preserves-play-source` |
| 75 | `search-secondary-lyric-and-duration-in-seconds` |
| 76 | `search-unmatched-preserves-source-and-cover` |
| 77 | `search-huge-duration-gap-marks-without-dropping` |
| 78 | `search-lyric-failure-keeps-matched-song` |
| 79 | `search-cookie-default-netease-no-source-mix` |
| 80 | `search-explicit-provider-wins` |
| 81 | `search-limit-clamped-at-thirty` |
| 82 | `search-rejects-empty-query-and-invalid-provider` |
| 83 | `playlist-route-write-publishes-global-revision` |
| 84 | `play-tool-write-publishes-global-revision` |
| 85 | `lists-ui-order-change-persists` |
| 86 | `mood-first-registration-awaits-receipt-and-list-own` |
| 87 | `mood-handler-single-guidance-reply-with-contextual-example` |
| 88 | `mood-dispose-removes-command-and-prevents-late-registration` |
| 89 | `mood-no-engine-does-not-enqueue-doomed-registration` |
| 90 | `mood-event-driven-recovery-without-timer` |
| 91 | `mood-asynchronous-ready-rejection-not-success` |
| 92 | `mood-ready-alone-does-not-prove-registration` |
| 93 | `app-startup-registers-mood-before-tool-or-session-event` |
| 94 | `app-startup-does-not-write-player-storage` |
| 95 | `app-teardown-disposes-mood-command` |
| 96 | `playlist-stale-ui-save-keeps-agent-created-tracks` |
| 97 | `playlist-stale-ui-save-merges-only-local-fields` |
| 98 | `playlist-ui-delete-still-applies-with-snapshot` |
| 99 | `playlist-stale-ui-save-does-not-resurrect-external-deletion` |
| 100 | `mood-alias-rejection-disposes-and-registers-ascii-once` |
| 101 | `mood-ascii-fallback-does-not-advertise-unavailable-alias` |
| 102 | `mood-general-registration-rejection-does-not-trigger-alias-fallback` |

新增前端断言为 #1–9（mood-lists-*）：后端优先及顺序、改名落盘、刷新后名字、自己的广播不渲染、外部建单显示曲目、广播不写回、同名覆盖刷新、无直接 storage 写名字、后端不可用旧 storage 回落。原 367 条仅顺延编号；最终详细顺序见浏览器 report。

## 真实验收返修：中文别名使主命令回滚

Hana 在部署首轮构建 1003131671 后发现 `moodRegistered:false`、`listOwn:[]`，注册报错 `could not register command alias "心情": it is invalid, reserved, or already taken.` 隔离对照中带中文 alias 注册失败、不带 alias 的 ASCII 命令注册成功。首轮 mock 支持中文名、HOST-PROBE 用 ASCII mood_probe，没有覆盖这一宿主限制；Codex 据真实反馈返修，不将原测试结果视作命令实际可用的证明。

独立原始证据见 [MOOD-ACCEPT-1.1.0.md](MOOD-ACCEPT-1.1.0.md) §6；同一报告已确认真实搜索可播、新建/覆盖与备份、卡片即时刷新、改名持久化通过。报告由 Hana 维护，返修复验结论仍待其追加。

Codex 核对同版本 `bundle/index.js` 中 alias 失败后 `unregisterCommand` 的整体回滚，以及 `app-host-entry.js` 的回执：`disposeAsync()` 会等待 ready，失败注册只清理本地。现在仅对上述明确中文 alias 拒绝等待清理回执，再注册无 alias 的 `/mood`；仍等待 ready 后以 listOwn 为硬判据。其他 engine/权限/注册拒绝不触发 alias 降级；不加定时器或权限。

返修构建 **1003131673**，backend **102/102**，原始输出见 `mood-1.1.0/verify-backend-alias-fix.json`。Hana 须重载后独立回读命令目录、复跑真实 `/mood` → 用户带建单意图的原话 → agent create_list 链路；此处尚未宣称返修后的真机验收通过。

## 第二轮返修：handler 返回字符串与真实客户端收包

Hana 的第二轮报告 R3 确认构建 1003131673 的 `/mood` 注册成功，目录 aliases 为空、moodRegistered:true，降级仅一次，后续注册失败日志为零。但 R4 真 WS 调用收到 `reply is not a function`：App 子进程 invocation 只有 commandName/rawText/args/sessionPath，契约中的 reply 函数在实际跨进程路径缺失。契约同时明确允许返回字符串，且 Hana 对照探针确认该路径可用。

现在 handler 为 `handler() { return MOOD_PROMPT; }`，由宿主派发器将字符串送回客户端。原后端 #87 不再注入一个不存在的 reply，使用四个可序列化字段核对返回值与完整引导。新增 **`mood-host-dispatch-client-receives-prompt`** 真实回归，运行：

```sh
node tools/verify-backend.mjs
node tools/verify-mood-host.mjs
```

新脚本自动定位本机最新宿主产物，也可用 `HANA_APP_TOOLS_ROOT` 指定。以该产物自带 node 启动临时 HANA_HOME，零受保护能力的测试 App 原样复制生产 `lib/mood-command.js`，经真正 AppHost 子进程注册、真实 slash registry/dispatcher、真实 WS 客户端派发 `/mood`。不调用模型，不操作生产数据；运行结束清理自己启动的进程，临时 fixture/boot.log 保留以便诊断。此脚本是开发回归，不加入 App 运行时工具白名单。

修改前测试 **0/1**、exit 1，实收 `[命令错误] reply is not a function`。修改后测试 **1/1**、exit 0，实收 `type:slash_result`、`level:success` 且 text **逐字等于 MOOD_PROMPT**，会话文件保持空白。使用宿主 `1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133`，源码 hash 与收包内容均在原始输出中。backend **102/102**。

最终构建 **1003131674**。本轮只改 handler、后端断言与新增真实宿主回归，前端行为未改，UI **376/376** 明确仍是首轮输出；两 HTML 仅同步构建号。Hana 重新整包同步 reload 后复验生产 `/mood` 提示，真实有模型「照引导说一句 → agent 调 create_list」仍待验；隔离 WS 收包成功不能代替该项。

## 常驻协作入口

用户要求将本轮方式固定下来，已落地 [Hana 与 Codex 协作约定](../../COLLABORATION-HANA-CODEX.md) 并从 AGENTS.md §7 链出：Hana 发任务、Codex 执行，直接通过 Computer Use 探查、交接和回复验收反馈；后续在本项目授权范围沿用，不重复询问。文档变更曾 bump 到 1003131672，后续注册返修 bump 到 1003131673。

## 引导语调整：明确单独发送普通消息

按 [MOOD-PROMPT-COPY.md](MOOD-PROMPT-COPY.md) 执行，运行时代码仅修改 `MOOD_PROMPT` 常量，值为：

> 想听什么状态？单独发一条普通消息告诉我（别写在 /mood 后面），例如「今天很累，帮我建个安静的心情歌单」，我就去选歌建单。

保留问状态、明确单独普通消息、可照抄的建单例子。`handler()` 仍直接返回常量，带不带 args 都返回同一句；不改注册、降级或权限，不改前端行为。CHANGELOG 同步一句。现有断言引用常量且例子短语保留，两个脚本均无需修改。

复跑 backend **102/102**、真实宿主派发 **1/1**；WS 客户端收到新引导语逐字正确，会话历史未写入。原始输出为 `mood-1.1.0/verify-backend-prompt-copy.json` 和 `mood-1.1.0/verify-mood-host-prompt-copy.json`。UI **376/376** 仍为首轮输出，本轮未重跑。最终构建 **1003131675**，两 HTML 与 _build 已同步。

Hana 的第三轮验收 F4 已确认上一构建 1003131674 的生产 `/mood` 入口修复通过；本轮需整包同步 reload 后分别派发 `/mood`、`/mood 新建日系流行歌单，今天心情不错`，确认都回新文案且不写历史。真实有模型「普通消息 → agent 调 create_list」仍待验，新会话首条 slash 的宿主 internal_contract 不在本轮范围。

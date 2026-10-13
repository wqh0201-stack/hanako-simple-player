# AUDIO-OWNER-DONE · 出声唯一化 1.1.1

日期：2026-10-13。实现与自验：Codex；独立复跑、部署及真机验收：Hana / 哦鲸鲸。

**实现完成，自验通过；真实 Hana 验收待补。** manifest/package 版本 **1.1.1**，三处构建号 **1003131679**。源码未提交；没有由 Codex 部署、reload 或操作生产 app-data。唯一需求来源为 [TASK-audio-owner-1.1.1.md](../../TASK-audio-owner-1.1.1.md)，最新用户决策优先。

## 1. 已拍板的协议及行为

用户在实现前选择：**显式交接，交接丢失时保守待命**。没有引入跨 reload 稳定实例标识、心跳或 owner 静默过期。每份文档生成新的 ownerId；正常 reload 是旧文档先暂停、保存续播意图并释放，新文档随后获得唯一授权再续播。

授权由 App 后端的一条串行 Promise 请求链发出，属于 App 状态仲裁，不做进程级锁。独立 global 键 `player-audio-owner` 保存 ownerId、claimId、revision、generation、pending 和 resume；`at` 只是记录时间，**不用于死亡判定**。播放快照字段和曲目 id/url 格式保持原状。

接管流程：新实例 claim → 后端发布 pending → 旧实例取消待起播/解析/seek 回调并调用 pause → 用本次 claimId 与旧 generation 确认 yield → 后端先保存 `playing:false`，再授予新 generation → 新实例核对权威授权后 play。BroadcastChannel 与 storage.onChanged 都常驻；BC 优先催让位，storage 覆盖 BC 缺失或分区不通。两通道传通知，**不能自己授予出声权**。

统一 `requestPlay()` 后，生产 app.js 只剩一处 `audio.play()`。选曲、主播放键、恢复 chip、系统媒体键、启动续播、单曲循环和自动下一首均通过它。主动暂停会请求全停。被接管者保留音频、曲目和进度，显示「接管播放」；浏览器拒绝 autoplay 后释放授权，仍显示原有「继续播放」。文案只更新 span，原 SVG 保留。

申请等待 1500ms 后只做一次权威回读；没有授权就待命。该值是操作等待窗口，**不是死亡阈值，也不代表宿主时延上限**。迟到授权不会让已结束的起播请求自行复活；已获权但尚未起播的实例关闭时也完成释放。隐藏只保存快照，不释放；真正卸载先暂停后交接，BFCache 返回重新初始化。

**接受的限制：**如果宿主直接移除 iframe、卸载通知或交接请求丢失，旧 owner 记录可能成为孤儿。新实例保持暂停，点击接管仍需要旧 owner 的暂停确认；没有静默超时强播。不能把 headless 普通 reload 的成功扩大为所有宿主 reload 路径均可靠。此取舍来自用户选择，真实 reload/拖进拖出是否提交交接必须由 Hana 检查。

## 2. 文件改动与需求对应

| 文件 | 原因与任务对应 |
| --- | --- |
| `lib/audio-owner.js`（新增） | §4.1/4.2：串行 claim/yield/stop/handoff/release、唯一 generation、旧快照写入保护；存储失败不返回授权。 |
| `lib/register-routes.js` | 新增 GET/POST `/api/audio-owner`；playback POST 按 ownerId/generation 校验，原子写快照。旧 `/widget/api/...` 路由未改。 |
| `ui/app.js` | §4.1–4.5：ES5 身份与双通道、内容比较/精确自写标记、统一起播、被动暂停、全停、chip 与显式交接。没有新建 UI JS。 |
| `tools/verify-backend.mjs` | 新增 12 条真实仲裁状态机断言，原有 102 条保留。 |
| `tools/verify-ui.mjs` | 接入真实仲裁模块；原媒体夹具通过统一入口起播；列表存储夹具由单 listener 改为 Set，匹配 SDK 多订阅契约；默认段落结束前终止夹具授权，真实 teardown 段仍测真实交接。原有 376 条断言未放松。 |
| `tools/verify-audio-owner.mjs`（新增） | 实际生产 UI + 真实仲裁 + Chrome HTMLAudioElement，多文档功能及失败路径 20 条断言。宿主 transport 是夹具，不能冒充 Hana 真机。 |
| `manifest.json`、`package.json`、`docs/CHANGELOG.md` | 版本 1.1.1 与面向用户的变更说明；manifest 只改版本，没有扩权。 |
| `ui/_build.json`、两个 HTML | 运行 bump-build 同步至 1003131679；两个 HTML 仅 data-shell 不同。 |

CSS、SDK、许可证 AGPL-3.0、受保护 URL/trackKey/storage key 和 captureStream 涟漪链路未改。最终源码 SHA256 见 [final-source-after-pointer.json](audio-owner-1.1.1/implementation-20261013/final-source-after-pointer.json)。该文件同时确认运行时源码与 build79 完整 UI 回归时一致；回归后仅专项测试加了真实指针点击和欢迎提示关闭流程。

## 3. 开工与最终验证原始证据

有效开工基线为 backend **102/102**、UI **376/376**，失败集合 `[]`，不是任务书历史 366/367。原始证据与源码未变核对见 [AUDIO-OWNER-PREFLIGHT.md](AUDIO-OWNER-PREFLIGHT.md) 及 [baseline run.json](audio-owner-1.1.1/baseline-20261013T054623966657Z/run.json)。

最终证据根目录：`docs/player-ui/handoffs/audio-owner-1.1.1/implementation-20261013/`。所有日志和 JSON 保留原始输出；[verification-summary.json](audio-owner-1.1.1/implementation-20261013/verification-summary.json) 只做索引，不替代原始证据。

| 命令 / 检查 | 最终结果 | 原始输出 |
| --- | --- | --- |
| `node tools/verify-backend.mjs` | **114/114，exit 0** | [stdout](audio-owner-1.1.1/implementation-20261013/backend-build79.stdout.log)、[stderr](audio-owner-1.1.1/implementation-20261013/backend-build79.stderr.log) |
| `node tools/verify-ui.mjs` | **376/376，exit 0**；selfCheck 12/12，narrow 4/4；runtimeErrors `[]` | [stdout](audio-owner-1.1.1/implementation-20261013/ui-build79.stdout.log)、[stderr](audio-owner-1.1.1/implementation-20261013/ui-build79.stderr.log)、[完整 JSON](audio-owner-1.1.1/implementation-20261013/ui-build79/verify.json)，同目录截图 |
| `node tools/verify-audio-owner.mjs` | **20/20，exit 0**；page errors `[]` | [stdout](audio-owner-1.1.1/implementation-20261013/owner-pointer-r2-build79.stdout.log)、[stderr](audio-owner-1.1.1/implementation-20261013/owner-pointer-r2-build79.stderr.log)、[完整 JSON](audio-owner-1.1.1/implementation-20261013/owner-pointer-r2-build79/verify-audio-owner.json) |
| 官方 `validate_app.mjs --json` | exit 0，errors 0；1 条静态校验警告 `DYNAMIC_DEPENDENCIES_NOT_PROVEN` | [stdout](audio-owner-1.1.1/implementation-20261013/validate-build79.stdout.log)、[运行记录](audio-owner-1.1.1/implementation-20261013/validate-build79.run.json) |
| `git diff --check`；修改的 JS 语法检查；build/twins/version/SHA 核对 | 通过 | final-source 与 verification-summary |

官方校验要求目录名与 manifest.id 相同；原仓库目录名不相同，故在临时目录 `hanako-simple-player` 使用运行时镜像静态校验。没有称为宿主 smoke 或真实卡片验收。UI 既有 flaky `ripple-max-midhigh-keeps-steady-and-silence-quiet` 最终通过，原断言未改；376 个既有断言名称和顺序与基线一致。失败集合由 `[]` 到 `[]`，满足子集要求，见 [failure-set-final.json](audio-owner-1.1.1/implementation-20261013/failure-set-final.json)。

中途失败与修正证据也保留：`owner*.stdout.log`、`owner-r*/verify-audio-owner.json`、`ui-r1.stderr.log` 等。早期修正包含初始空 owner 不能取消 boot autoplay、过时/迟到授权释放、同曲重点击状态和 SVG 保留。UI 首次完整运行卡在旧列表夹具单 listener 覆盖，而非降低断言，已按 SDK 订阅模型修复。最后补做真实指针点击时，`owner-pointer-build79/verify-audio-owner.json` 记录首次欢迎遮罩命中导致超时；最终测试先用真实鼠标关闭「知道了」，再断言 elementFromPoint 命中 chip 并真实点击，20/20 通过，未改生产遮罩行为。

## 4. 新增断言编号

专项 JSON 的 results 顺序即 AO 编号；后缀 false 表示 BC 在线，true 表示禁用 BC、只走 storage 夹具通知。

| 编号 | 名称（两组时省略后缀） | 需求 / 证据 |
| --- | --- | --- |
| AO-01 / AO-08 | `simultaneous-boot-one-voice` | 两实例并发 boot、盘上 playing:true，实际 unpaused 数量恰为 1。 |
| AO-02 / AO-09 | `takeover-pauses-preserves-progress` | A→B，A paused、playing:false，进度保留。 |
| AO-03 / AO-10 | `passive-snapshot-false-owner-snapshot-protected` | 被接管 A 强制 persistNow，A snapshot:false，不能覆盖当前 B 合法 true。 |
| AO-04 / AO-11 | `takeover-chip-visible` | 文案接管播放、按钮可见，SVG 仍在。 |
| AO-05 / AO-12 | `takeover-chip-pointer-reachable` | 关闭首次提示后，真实指针中心命中按钮。 |
| AO-06 / AO-13 | `chip-reclaims-one-voice` | Puppeteer 真实鼠标点击 chip，A 夺回且 B 暂停。 |
| AO-07 / AO-14 | `manual-pause-stops-all` | 主动全停，A/B 均 paused，快照 false。 |
| AO-15 | `single-reload-explicit-handoff-resumes` | 真实 document reload，ownerId 更新、进度保留、正常交接续播。 |
| AO-16 | `single-reclick-current-keeps-playing-state` | 现有当前曲目 DOM 点击处理保持播放态。 |
| AO-17 | `single-auto-next-unchanged` | 驱动实际 ended 处理进入下一首并实际播放。 |
| AO-18 | `late-grant-does-not-play-after-wait-ended` | yield 延迟 2100ms 超过等待窗口，迟到 grant 后仍 paused。 |
| AO-19 | `paused-grantee-close-releases-permit` | 上述尚未起播的获权实例关闭也释放。 |
| AO-20 | `lost-handoff-remains-standby-no-timeout-play` | 丢弃 beacon/keepalive，下一实例超过等待窗口仍待命。 |

后端新增 12 条（完整名称与 detail 在 backend stdout）：`audio-concurrent-boot-single-grant`、`audio-claim-waits-for-pause`、`audio-stale-yield-cannot-grant`、`audio-later-claim-wins-without-old-ack`、`audio-yield-saves-false-before-grant`、`audio-old-true-and-false-cannot-overwrite-current`、`audio-other-instance-stop-requires-yield`、`audio-stop-clears-owner-and-resume`、`audio-explicit-handoff-keeps-resume-intent`、`audio-handoff-reboot-single-grant`、`audio-storage-failure-never-grants`、`audio-failed-command-does-not-poison-chain`。

关于任务 §7 第二条，遵循双方已确认的时点解释：**A 暂停之后不得产生 true；当前 owner B 可以保存 true**。后端断言证明 A false 在新授权前落盘，过时 true/false 请求拒写；专项断言再验证 A 强制 persist 不覆写正在播放的 B。不能要求 B 正常播放后全局快照一直 false，否则 B reload 无法续播。

## 5. §5 五个开放问题的最终结论

| 问题 | 已确认 / 选择 | 仍未确认 |
| --- | --- | --- |
| Q1 · BC | 系统 Chrome 同源页面 30/30，p50/p95 1ms、max 3ms（Hana）。Codex 双 iframe 反例：allow-scripts 不透明源能构造却 received=0；同源/allow-same-origin 互通。因此 BC 优先、storage 同时订阅；AO 两组验证 BC 有/无两路径。 | **真实 Hana 卡片↔独立窗口互通与分区未测**，普通 Chrome 不冒充真宿主。 |
| Q2 · onChanged | 契约保证同 appId 全局 store 和 key 广播；已有隔离宿主证据证明同值会广播。夹具兜底接管通过，不拿它推真实时延。 | **本次真实时延逐样本未测**；隔离探针 missing_credential。Hana 验收补 ≥30 样本 p50/p95/max、同值、自写、连续/并发、重复/乱序。 |
| Q3 · 存活 | 用户选择显式交接；没有过期/心跳。旧页 pause 后本次 yield 或卸载 handoff 才释放；未确认则偏向不出声。1500ms 只结束申请等待。AO-15/18/19/20 覆盖正常与丢失路径。 | 真宿主 reload/移除 iframe/拖入拖出交接可靠性待验；lifecycle 不是对端存活证据。 |
| Q4 · 落点 | 已实现独立 global 新键 + App 后端串行权威，避免 playback 整份快照覆盖 owner，且保留播放快照形状；BC/storage 仅通知。并发与旧请求拒写由真实模块断言覆盖。 | 真宿主 transport 行为和部署后路由装载待 Hana。 |
| Q5 · build | 原仓库已运行 bump-build；_build.json、index/standalone 均 1003131679，twins 只差 data-shell，最终 SHA 已记录。 | 无。 |

完整宿主报告与复核：[AUDIO-OWNER-HOST-PROBE.md](AUDIO-OWNER-HOST-PROBE.md)、[AUDIO-OWNER-PROBE-REVIEW.md](AUDIO-OWNER-PROBE-REVIEW.md)。Hana 已修正原稿的 BC 构造即互通、lifecycle 判对端、pause 事件同步和短超时强播推断。本实现采用后端 yield 确认而非直接 BC yielded 授权，避免无 owner 并发 boot 自封授权。

## 6. 给 Hana 的独立验收与部署入口

在仓库独立执行并保存自己的 stdout/stderr，避免与 Codex 日志混用：

```sh
node tools/verify-backend.mjs
node tools/verify-ui.mjs
node tools/verify-audio-owner.mjs
```

UI 与专项可用 OUT_DIR 指定独占证据目录；两项 Chrome 验证顺序执行。依赖与系统 Chrome 同开工基线，专项使用本机 loopback 测试服务；测试不访问生产音乐数据。

**本次有后端改动，不能只同步 UI。** 请使用本仓库 local source reload，或完整同步运行时，包括新 `lib/audio-owner.js`、`lib/register-routes.js`、manifest/package 与 **整个 ui/**（CSS、SDK、_build.json 和两个 HTML 均包含），然后执行 `extension_manager reload app:hanako-simple-player`。不要覆盖 app-data；manifest 没有扩权。宿主加载 UI 快照后才可验，先核对实际 build79 和新 owner 路由。

真机必须覆盖：卡片+独立窗口、多实例 reload 只有一个出声；B 点击播放让 A 静音且保留进度；A chip 真实点击夺回；主动暂停全停；单实例续播/连播/切歌/实际 reload/拖进拖出；补 Q1 分区与 Q2 样本。额外复核后台/隐藏不释放、迟到通知不复活、被动暂停实例卸载不写 true。交接丢失的保守待命按用户决策单独记录，若正常宿主 reload 无法送达 handoff，报告实际证据再讨论，不凭时间清 owner。

独立报告建议写 `docs/player-ui/handoffs/AUDIO-OWNER-ACCEPT-1.1.1.md`；原始输出用新目录。当前状态为待独立验收，不把“开始处理”写成通过。协作消息提交状态见同证据目录的 `hana-handoff-message.md`。

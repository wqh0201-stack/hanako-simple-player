# AUDIO-OWNER-PREFLIGHT · 1.1.1 开工基线与开放问题

日期：2026-10-13（Asia/Shanghai）。执行：Codex App；真实宿主探查：Hana / 哦鲸鲸。

本轮范围是用户要求的「先不要改代码」：拆步骤、跑两项开工基线并留原始输出、探查任务书 §5。唯一需求来源为 `docs/TASK-audio-owner-1.1.1.md`。本稿是开工报告，不是实现完成或验收通过声明。

补充状态：已读回 Hana 的 `AUDIO-OWNER-HOST-PROBE.md` 和原始证据，并完成独立 Chrome 反例实验；详细复核见 `AUDIO-OWNER-PROBE-REVIEW.md`。普通 Chrome 同源页面通信已测；真实 Hana App iframe/独立窗口、storage 时延仍未测。BC 能创建但不互通的反例已确认；lifecycle 不能判对端死亡；pause 事件异步；短超时不能授权强制起播。

已读 `AGENTS.md`、`docs/COLLABORATION-HANA-CODEX.md`、`~/.hanako/skills/hana-app-creator/SKILL.md` 与相关 Builder 工作流。按目录列表确认最新宿主契约为：

`/Users/can/.hanako/artifacts/server/1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133/APPS.md`。

没有修改源码、测试断言、manifest、CHANGELOG 或原仓库构建号，没有部署或 reload，没有直接访问宿主运行时。只新增开工证据和报告。已有 `audio-owner-1.1.1/baseline-20261013T053917Z/` 保留原样。

## 1. 开工基线

- HEAD：`c0daa737a7a2b41de0f3bf70e32d7e1adc32482a`。
- 版本：`manifest.json` 为 `1.1.0`；构建号三处均为 `1003131675`。AGENTS 摘要的 1.0.7 不用作本轮实际版本。
- Node：`v22.22.2`；UI headless Chrome：`155.0.8059.40`；puppeteer-core：`23.11.1`。
- 本轮独占证据目录：`audio-owner-1.1.1/baseline-20261013T054623966657Z/`。

| 原样执行的命令 | 结果 | 失败集合 |
| --- | --- | --- |
| `node tools/verify-backend.mjs` | 102/102，exit 0 | `[]` |
| `node tools/verify-ui.mjs` | assertions 376/376；selfCheck 12/12；narrowSelfCheck 4/4，exit 0 | `[]` |

UI 第一次执行在断言开始前因 sandbox 禁止监听 `127.0.0.1` 报 `listen EPERM`，保留为 `verify-ui.sandbox.*`，不当成业务断言失败。自动审核允许后重跑相同命令。设置独占 `OUT_DIR` 仅改变截图/报告输出目录，不改变测试条件、不复用旧 `/tmp/hap-verify`。

完整原始 stdout/stderr 分别为 `verify-backend.stdout.log` / `verify-backend.stderr.log` 和 `verify-ui.stdout.log` / `verify-ui.stderr.log`；命令、环境和退出码见 run.json / environment.json；完整 UI JSON 为 `ui-artifacts/verify.json`，同目录有 108 张截图。`failure-set.json` 记录本轮失败集合；`source-unchanged.json` 核对脚本/源码/manifest/build SHA256 前后一致。

本次实际 UI 数量为 **376/376**，与任务书的历史 **366/367** 不同；保留实际计数，不改任何断言。既有 `ripple-max-midhigh-keeps-steady-and-silence-quiet` 本次通过（原始 detail 为 steady=0 / silence=0）。wiring/migration/lifecycle 均为 true，runtimeErrors 为空。后续失败集合必须如实与本次有效基线的空集合比较；不修改或放松既有 flaky 断言，若后续再飘红要明确报告。

## 2. 可独立验证的实施步骤（本轮未实施）

| 步骤 | 工作范围 | 本步验证与出口 |
| --- | --- | --- |
| 0 | 完成基线、Q1/Q2 实测与 Q3/Q4 方案；明确安全性和恢复时序 | 保存原始输出，区分契约/静态/假宿主/真实宿主；未证实的通道和死亡判定不能写死 |
| 1 · §4.1 | ownerId、权威记录和串行仲裁；BC + global.onChanged 双通道，精确自写标记 + 内容比较去重 | 同时 boot 的仲裁、重复/乱序/自写通知、BC 缺失退化、过时续租；广播回调不再次 claim |
| 2 · §4.2 | 统一异步 claim/requestPlay，覆盖直接/间接起播、boot 恢复与系统媒体键 | 所有 play 都须在本次申请成功之后；先准备音频/seek 再实际起播，竞态与失败不得提前置 playing=true |
| 3 · §4.3 和 §2 | 被动暂停保留曲目/进度，关闭卸载复活分支；取消过时起播回调；主动暂停广播全停 | 被接管后的 snapshot/beacon/排队旧请求无 true；迟到解析/seek/play Promise 不复活；旧实例先静音再新实例出声 |
| 4 · §4.4 | 复用 resumeBtn，「接管播放」与「继续播放」分原因呈现 | 被接管按钮可见，点击夺回；接管成功后仍被浏览器拦截则显示继续播放，不互相覆盖原因 |
| 5 · §7、§4.5 | 增加四组功能断言与必要竞态断言；完整复跑两项验证 | 同时 boot 唯一出声、A→B、chip 夺回、单实例续播/下一首/reload；失败集合与基线比较，不改旧断言 |
| 6 · §3、§7、§9 | 后续实现完成再升版本 1.1.1、CHANGELOG、正式 bump；检查孪生 HTML | 核对三处 build 相同、HTML 只差 data-shell，整包 UI 交接；本轮不做这些修改 |
| 7 · 协作约定 | 写 AUDIO-OWNER-DONE.md，给 Hana 发送证据和复跑入口 | Hana 独立复跑、整包同步 UI、reload、真实多实例/单实例验收；开始处理不能写成通过 |

只按本任务扩展合适的 `ui/app.js` 模块段和必要 `lib/` 模块；不新建 UI JS，不改受保护 key、旧路由、播放列表曲目形状、音频 captureStream 链路或许可证。

## 3. §5 五个开放问题的探查结论

### Q1 · BroadcastChannel 真宿主与跨独立窗口

**普通 Chrome 同源页面通信已测，真实 Hana iframe/跨独立窗口仍待验。** Hana 保存了系统 Chrome 同源 tab↔tab 30/30 RTT，p50/p95=1ms、max=3ms。其三组 sandbox 原测试只构造后立即关闭 BC，没有测互通。本轮独立 Chrome 对 srcdoc 与 HTTP 两种来源补双 iframe 收发：无 sandbox/allow-same-origin 通路正常，allow-scripts 两端均构造成功但 received=0。因此不能从构造成功推断实际可用，也不能把 location.origin 的 null 字符串当作相同安全源。

维持任务原定的 BC 优先和 global.onChanged 兜底，两通道都要保留订阅与去重；兜底不能只判断构造抛错，还要覆盖分区不互通。Hana 报告明确真实卡片↔独立窗待其真机验收补，不能称已通过。独立复核的全部消息/origin 原始证据见 `audio-owner-1.1.1/host-probe-review-20261013-codex/`。

### Q2 · global.onChanged 的真实延迟与抖动

**共享与广播契约已确认；抢麦时延尚无合格实测证据。** APPS.md 535–539：global 同 appId 共用单一宿主 store，宿主唯一写者、原子落盘，经已有 app_event 向订阅者广播 keys，接收者须重拉值。SDK 不提供初始值推送、去重、debounce、Promise 排队或跨窗口暂停完成确认；默认请求超时不是时延上限。

`MOOD-HOST-PROBE.md` 的已有证据只证明隔离后端同值两次写入有两次广播，明确真实卡片待验，没有 p50/p95/max。所以不能据此说“能满足抢麦”。Hana 请求涵盖至少 30 样本的发送→事件→get 时间轴、同值、自写、连续/并发写、乱序/重复和后端→前端，使用独占临时键，不改正式 playback/owner 键。

已读回本次 Hana 报告：隔离探针装载成功，但请求因 missing_credential 未打通，没有 Q2 样本；Hana 未绕过鉴权，留至真实验收补。没有 storage 数据，不能量化声称 BC 比 storage 快一个数量级。

**原子落盘不等于原子抢占。** global get/set 没有 CAS/expectedRevision 契约。A/B 都读空、分别写入并读回自己后都 play，再异步暂停 A，会有重叠出声窗口。双通道和固定等待数毫秒不能证明“任一时刻一个出声”；候选需要 App 后端串行仲裁与旧 owner 暂停确认，不能只用前端 set→get。

### Q3 · owner 存活判定、阈值与误判方向

**已排除单次 at + 固定 5–15 秒过期。** 它必然把持续播放超过阈值的活 owner 判死。周期刷新能减少这一问题，但隐藏/后台/挂起的文档调度没有实时保证，过期不能直接证明静音或死亡。

优先探索事件驱动的 **claim → 被动暂停处理 → 本次 yielded → 获得唯一授权 → play**，正常交接不必靠心跳。此前每 2 秒续租/15 秒疑似失联只是候选，没有实施，也没有建议每次接管等待 15 秒。本次 Hana 的 150–300ms 建议同样不能用作“未回复则已死亡并强制 play”的授权阈值；短等待只能触发另一通道/重试或待命。

安全方向：未知仍按活 owner 处理；未确认旧 owner 静音时不凭超时直接让新实例起播。显式接管同样要完成暂停交接。只有超时没有确认的方案，不能同时证明严格唯一出声和立即接管。

SDK 的 lifecycle.active 由本实例 visible 和 maxFrameRate 计算，是绘制状态，不是旧 owner 存活查询；active=false 不代表静音/死亡，不能跳过确认。独立 Chrome 实测 pause() 返回时 paused=true，但 pause 事件异步派发，已经 paused 时再调用不发新 pause 事件；yielded 必须处理幂等暂停并绑定 claim/generation，不能盲等某个事件。

现有 `visibilitychange:hidden` 会调用 flushOnTeardown（`ui/app.js:4096`），但隐藏不是死亡；代码 4091–4093 已记录宿主直接拆 iframe 时可能不派卸载通知。ownerId 每份文档新生成，reload 后一般不会等于旧 ownerId，不能用“owner 就是自己”保证普通 reload 续播。单实例 reload 若机械等 15 秒会违反 §4.5，所以还必须确定可靠释放/交接或恢复协议；最终方案当前不写死。

### Q4 · owner 放 playback.json 还是 global 新键

**当前推荐 `player-audio-owner` 独立 global 键，由 App 后端统一仲裁写入。** 这是设计建议，不是已实现/已通过结论。它直接获得存储广播，避免让多个文档的旧播放快照覆盖 owner，也不改变已有 playback 快照形状。

依据：`snapshot()`（app.js:281–301）只产生现有播放字段；`persistNow()`（317–324）在每份文档独立链排队前捕获快照；后端 playback POST（`lib/register-routes.js:1466–1473`）整对象盲写，没有条件校验或通知。简单添加 owner 字段会被旧 snapshot/beacon 抹掉或覆盖。`storeSet()`（app.js:395–401）吞写入失败，其 Promise resolve 也不能作为 claim 成功。

任务倾向的 playback.json.owner 也能做，但需要后端专属状态转换与普通快照 owner 保护，并另外通过 global 键广播镜像，责任更多。无论选哪种，决定稳定性的核心是权威仲裁、交接确认和旧请求失效，不能只换落盘位置。后端只串行 App 状态转换，不引入任务禁止的进程级互斥。

### Q5 · bump-build 三处自动同步

**已在 /tmp 最小目录镜像实跑通过。** 复制未经修改的脚本与三目标，在 `/private/tmp/audio-owner-build-hraqbnft` 执行 `node tools/bump-build.mjs`，exit 0，原始 stdout：

```text
[bump-build] 1003131675 -> 1003131676  (同步: _build.json, index.html, standalone.html)
```

镜像 `_build.json`、两个 HTML marker 均为 `1003131676`，孪生 HTML 只差 data-shell。原仓库三处保持 `1003131675`；脚本和三目标 SHA256 前后完全一致。这满足“不改代码”的本轮范围；不是正式版本 bump。正式实现后仍须在原仓库运行并核对，因为脚本遇到缺失 HTML marker 会 warning 后继续写 _build.json。

Q1/Q2/Q5 的行号摘录、SDK 来源、镜像原始 stdout/stderr 与 hashes：`audio-owner-1.1.1/channel-contract-20261013-134828-hraqbnft/SUMMARY.md` 及同目录 raw 文件。

## 4. 起播调用地图与需解决的验收语义

运行时 `ui/app.js` 直接 `audio.play()` 共六处：4072（loadAudio 同 src）、4136（metadata/seek 后续播）、4312（mediaSession play）、4399（单曲循环）、4502（主播放键）、4511（resumeBtn）。playTrack 4482/4490 与 restorePlayback 7147/7161 间接 loadAudio(true)，都含异步解析分支。

被接管时必须使 pendingAutoplay、seek 起播重试和过时 ensurePlayable 回调失效；否则先 pause 后仍可异步复活。playTrack 4471 在实际 play 前先置 playing=true，4493 即落盘，也必须纳入统一入口。docs 的历史 ripple-lab 原型不在 App 运行范围，不扩大本轮需求。

Hana 已确认 §7 第二条的语义：“被接管 A 的暂停、卸载和延迟快照绝不写 true；当前 owner B 仍可写 true”。测试需控制 B 的起播/持久化时点：交接空档强制 A persist/pagehide 验 false，再放行 B 验 true，最后注入 A 的旧请求确保不能覆盖 B。若后端拒绝非 owner 写入，要检查 A 快照与拒写证据，不能要求当前 B 的盘状态变 false。不自行改任务书或既有断言。

## 5. Hana 协作状态

Computer Use 核对了 HanaAgent 的播放器任务会话（后续标题为「多窗口同时播放bug」，最近消息含本任务书完整路径），于 **13:48** 发送主探查请求，于 **13:53** 通过实际“插话”按钮发送竞态/验收语义补充。两次均观察到输入区清空、会话出现新消息/进入处理；13:48 请求已看到完整会话消息和 Hana “请求我接下了”的回复。

Hana 只分配 `AUDIO-OWNER-HOST-PROBE.md` 与新建 host-probe-* 证据目录；明确要求不改源码/断言/manifest、不启动另一 Codex、不 reload、不改生产音乐数据。探查报告现已读回，真实跨窗口验收与 Q2 留待补，不能当作真实验收通过。

**14:02** 已通过“插话”回传本开工报告、102/102 与 376/376 的实际计数、全部原始证据路径和未改代码/构建号状态，观察到输入区清空、新消息时间和处理状态。明确告知如官方入口不足则报告真实限制，不改生产安装/权限、不绕过审批或扩大到宿主修复。后续已读回其报告并复核；Q3 孤儿 owner 自动恢复和暂停交接协议仍未定，未确认项不转换成实现参数。

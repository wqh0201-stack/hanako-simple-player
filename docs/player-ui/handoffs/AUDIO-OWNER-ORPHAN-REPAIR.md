# AUDIO-OWNER-ORPHAN-REPAIR · 1.1.1 真机死锁返修

2026-10-13，Codex。需求：任务书 `docs/TASK-audio-owner-1.1.1.md`，以及用户本轮补充的「确实消失的 owner 必须自愈、活 owner 不能误抢」。

**当前状态：死锁已复现，尚未修复；宿主接口与当前宿主源码缺失阻塞实施。** 版本/build 仍为 1.1.1 / 1003131679；本轮没有修改生产源码、既有断言、manifest、构建号或生产 app-data。前次 AUDIO-OWNER-DONE 的 headless 自验通过不代表真机验收通过，用户转述的重启死锁是阻塞项。

后续核对：Hana 已落 [独立宿主报告](AUDIO-OWNER-ORPHAN-HOST.md)，确认当前公开面缺接口；[独立验收](AUDIO-OWNER-ACCEPT-1.1.1.md) 明确为未通过。用户**已授权扩到宿主正式接口**，但随后说明当前宿主源码尚未开源、无法提供源码目录。本机只找到打包运行产物，`/Users/can/OH-WorkSpace/hanako` 为空、不是 Git 仓库。授权继续有效；实施还需要维护方提供当前源码或交付符合 §5 契约的宿主版本。没有直接补丁生产 bundle，不能用历史版本源码声称修好了当前 beta。

## 1. 根因与前次覆盖的局限

`lib/audio-owner.js` 从 global 持久化恢复 owner；restore 遇到其它 owner 拒绝，用户 claim 只能成为 pending，之后只有旧 owner 的精确 yield/handoff 才能释放。直接销毁旧文档不产生这些请求，所以旧身份在新文档中不能被恢复，也没有安全清理出口。单实例、多实例、反复 reload 均不会改变这一点。

前次专项 AO-20 的确覆盖「丢弃卸载交接后保持待命」，所以“夹具 handoff 总能送达”并不准确；它的问题是把永久待命当作所选安全策略的预期结果，**没有同时要求确认死亡后的恢复**。用户本轮明确补充自愈目标，不能再用原决策合理化永久死锁。

本轮用 CDP **Page.crash** 崩溃自己创建的 Chrome 测试页面，得到 `Error: Page crashed!`，保留原 store，重新创建真实 `createAudioOwner` 服务，再打开生产 UI。没有模拟正常 pagehide、没有删除 owner：

1. crash 前 owner 已获 generation=1，HTMLAudioElement.paused=false。
2. crash 后 ownerId/revision/generation 原样保留，无 handoff。
3. 新文档 boot paused=true、takeover=true；用户 requestPlay 返回 false，旧 owner 仍在，pending 指向新文档。

这证明“已死亡但无交接”的路径确实锁死。它是实际 Chrome 文档崩溃 + 生产 UI + 真实仲裁模块；宿主 transport 仍是夹具，不称为 Hana 重启测试。Hana 对真实宿主 pagehide/beacon 是否执行的结论以它的真机报告为准；SIGKILL/crash 无需也不能依赖页面执行 JS。

## 2. 排除两个会误抢的捷径

另做两个反例，均使用真实 Chrome 媒体：

- **仅重建 App 后端服务**：同一 store、同一旧文档，重建 createAudioOwner 后，旧 audio 仍 paused=false。App 后端启动代改变本身不能证明旧文档结束。
- **用户手势 + 无响应**：禁用 BC、停止向旧页交付 storage 通知，旧媒体继续播放。新页用真实鼠标点恢复 chip，经过 1800ms 后，新页 paused=true，旧页仍 paused=false，进度 **3.034531 → 5.12849**。若此时强制 grant，就会有两个媒体同时播放。用户手势解决 autoplay 授权，不提供死亡证明；把窗口从 1.5s 改为 15s 也不改变这个反例。

不能用“请求超时”“SDK 不在线”“从视图列表消失”“PID 变化”代替媒体文档已终止。后台/挂起/消息隔离/仅后端重启都会让活 owner 缺少回应。

## 3. 原始证据

目录：`docs/player-ui/handoffs/audio-owner-1.1.1/orphan-repair-20261013-codex/`。

- `start-source.json`：本轮开始源码 SHA 与 HEAD。
- `orphan-repro.mjs`：独立复现脚本，从现有专项的 transport 夹具构造，不改变原脚本与断言。
- `orphan-repro.stdout.log` / `.stderr.log` / `orphan-repro.json`：首次原始输出，含死文档阻塞和活文档后端重建反例。
- `orphan-repro-r2.stdout.log` / `.stderr.log` / `repro-r2/orphan-repro.json`：补上真实用户点击+失联反例的最终输出。

复现命令（须系统 Chrome、同原专项 puppeteer 依赖、仅本机端口）：

```sh
OUT_DIR=/tmp/audio-owner-orphan-repro node docs/player-ui/handoffs/audio-owner-1.1.1/orphan-repair-20261013-codex/orphan-repro.mjs
```

结果 `reproduced:true`、exit 0 表示 **4 个故障/反例观察成立**，不表示功能已修复或恢复断言通过。最终 JSON 中 `purpose` 也作此区分。原 114/376/20 结果属于上一轮，当前没有修复可以报告为新版本通过。

## 4. 公开接口核对

最新可用宿主契约：`~/.hanako/artifacts/server/1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133/APPS.md`；并核对 Creator 分发的 AppEntryContext、HanaPluginContextV2、AppSurfaces 与 plugin-protocol 类型。

| 信号 | 公开契约与限制 | 能否独立授权孤儿恢复 |
| --- | --- | --- |
| host boot/epoch | 当前 APPS 与 AppEntryContext 成员、PluginSurfaceContext 未发现公开启动代或 previous-generation-ended 标记。 | 暂无可接入接口，已请 Hana 交叉查证。 |
| `hana.surface.getContext()` | APPS 986；协议类型给 appId/slot/cardInstanceId、可选业务键/会话/视图命名空间。卡 ID 可跨 reload 保持，既不是启动代，也不是旧文档是否存在。 | 否。 |
| `hana.lifecycle` | 本文档 visible/active/maxFrameRate/motion；不提供对端成员表。 | 否。 |
| `ctx.surfaces.listCardChromeViews()` | APPS 2266–2299；列本 App 受支持的活视图，不保证所有旧/非 verified 卡片覆盖。App 重载、socket 断开、凭据撤销也令句柄失效；超时/断线结果 unknown。 | “不在列表”不等于已静音；不能以此清 owner。 |
| instances/runtime ID | APPS 2940–2950；instances 管隔离实例，runtime 管 App 托管进程；没有默认生产 UI 文档死亡证明。 | 否。 |
| App 自造 epoch / Node 父进程 PID | 标记的是后端或进程；没有涵盖所有媒体 renderer 的终止契约，且 PID 可复用。 | 否，后端重建反例已实测。 |
| surface ticket / server discovery 文件 | 前者是凭据，后者是发现状态；没有把它们当公开媒体生命周期接口的契约。 | 不解析凭据或读宿主私有文件绕过 SDK。 |

不能宣称宿主绝无此能力；当前结论是**已核对的公开接口没有足够信号**，Hana 正补查实际销毁过程与遗漏接口。探查请求已于 **17:37** 在「多窗口同时播放bug」会话提交，输入清空且进入处理；指定报告 `AUDIO-OWNER-ORPHAN-HOST.md`，仅只读探查、不改生产。

## 5. 可审阅的安全恢复协议

需要宿主给出**媒体文档**的权威身份/终止结果，而不只是 Server 或 App 后端的重启 ID。建议最小契约（以下是提案，不是现有 API）：

1. 当前 UI 的宿主确认上下文带不含凭据的 `documentId` 和其生命周期代；App 后端能验证它属于当前请求、本 App。
2. 后端能查询旧 document 的状态，明确区分 `active`、`ended`、`unknown`。只有宿主已销毁 iframe/媒体 renderer 后才能报告 ended；socket 断开、超时、隐藏和桥接重绑只能 unknown。
3. 如提供 host 代，必须保证“代已结束”意味着该代所有媒体文档都已终止。仅 Server 重启不得满足该条件。App reload 要完成旧文档销毁栅栏后才允许新代获权。
4. 对 1.1.1 无 documentId 的存量 owner，需一次**宿主确认本 App 旧文档全终止**的迁移边界；缺字段不能直接当孤儿清空。

App 随后在同一仲裁链中执行：

- active/unknown：继续现有显式 claim→pause→yield；超时待命。
- ended/previous-generation-ended：撤销旧 owner 和 pending，递增 revision/generation，保留有效播放快照的续播意图，正常 restore 竞争只授一个新 owner。
- 所有旧 generation 快照、handoff、claim 回包失效；客户端不能自报新代绕过检查。
- 旧文档死亡在本代发生时也走 ended 恢复，覆盖直接移除单个 iframe；单凭启动 ID 不足以覆盖这一项。

这补充原「显式交接、丢失时待命」决策：**没有停止证明仍待命，有权威终止证明就自愈**，不放宽唯一出声。若现有宿主公开 API 确实缺失，需扩展 Hana 正式 SDK/生命周期接口后才能完成；不能只在 App 里伪造 hostGeneration 达成表面通过。

## 6. 修复后必须新增的测试与真机步骤

测试计划（保留原有断言）：已知旧页 crash 且无 handoff + 权威 ended → 新页自动/点击恢复；两个新页并发恢复仅一个出声；App 后端重启但旧页 alive → 不越权；通道失联/主线程忙/隐藏且 unknown → 不越权；同一 host 代直接移除单个 iframe后 ended → 恢复；旧 generation 延迟请求不能覆盖新 owner；1.1.1 存量迁移在终止证明前不清、证明后自动恢复。

Hana 复验步骤与期望（协议接入后执行，现在不是已通过清单）：

1. 整包同步运行时和 ui/，reload，核对实际 build；保存原始日志与 owner/doc 状态，不手工清正式键。
2. 单实例播放到非零进度，Cmd+Q 再启动：旧代必须被宿主确认为 ended，新文档恢复播放，进度保留；owner 指向新文档。
3. 卡片+独立窗正在播放时强制终止 Hana，再启动：无 handoff 也能恢复，实际只有一个 audio.paused=false。
4. 再点另一实例播放，旧实例停止、曲目/进度保留、chip 可夺回；主动暂停全停。
5. 只停止/重建 App 后端或仅断开其通知，保留旧 renderer：宿主必须给 active/unknown；新实例不能因代号变化/用户手势/超时出声。
6. 直接销毁当前 owner 的 iframe、不执行卸载 JS，保留宿主与另一实例：确认该 document ended 后后者可恢复，不要求重启全宿主。
7. 隐藏旧实例、制造延迟通知或主线程忙：恢复请求不能误抢；旧页恢复响应后正常交接。
8. 不清 owner 连续重复第2/3步三次，验证没有“退出写回导致再死锁”；保留每次身份/代/状态/paused/playing 的时间轴。

当前不能把上述恢复项记为通过。宿主修改范围已获用户授权，但当前源码不可得；§5 是可交给维护方的最小接口要求，仍是提案而非已实现的 SDK。拿到匹配的源码或新接口后，继续在同一工作链接入播放器并执行上述验证。不发布 Release/市场 PR，不启动第二个 Codex。

仓库并发状态：发现 `docs/TASK-mood-onestep-1.1.2.md` / `docs/ACCEPT-mood-onestep-1.1.2.md` 的在途改动，本轮未触碰；检查结束时本轮记录的生产源码与原测试 SHA 均未改变。Hana 报告另有并发 boot 接管首次 flaky，复跑四次通过；该问题保留待处理，没有把重复通过当作竞态已修复。

# AUDIO-OWNER-ORPHAN-REPAIR2 · Web Locks 孤儿恢复返修

2026-10-13，Codex。任务：`AUDIO-OWNER-CODEX-PROMPT-2.md`；需求基线：`docs/TASK-audio-owner-1.1.1.md`。
版本保留 **1.1.1**，构建 **1003131680**（原 1003131679）。1.1.1 仍在返修验收中，不占在途 mood 1.1.2 的版本。

## 状态

实现已完成；后端自验 **119/119**，音频专项最终两轮均 **34/34**。
完整 UI 自验 **376/376**（selfCheck 12/12、narrow 4/4，runtimeErrors=[]）。真实锁能力已由 Hana 确认；播放器部署及真实验收尚待 Hana。
未发布 Release/市场 PR，未启动子 agent，未修改宿主或生产 app-data，保留开工时所有在途修改。

## 修改及原因

| 文件 | 本轮修改 |
| --- | --- |
| `ui/app.js` | Web Locks 初次 ifAvailable 探测、文档级持锁、显式 steal、AbortError 暂停并主动回读 yield、普通排队恢复、死亡清点证明；保留全部原出声入口和涟漪链路 |
| `lib/audio-owner.js` | claim 在 restore 守卫前清点；stop 增加有证明的孤儿出口；清点绑定旧 owner/generation，拒绝延迟 reap；复用 cleared 递增 revision/generation |
| `tools/verify-audio-owner.mjs` | 保留原 20 条断言，加 14 条真实 Chrome 检查；原“交接丢失”夹具改为旧文档仍活着；增加 iframe、opener、双通知断路、锁缺失/SecurityError 与独立夹具票 |
| `tools/verify-backend.mjs` | 追加 5 条孤儿清点和旧代拒写检查，既有断言不改 |
| `docs/CHANGELOG.md` | 补用户可见的重启/文档销毁恢复行为和保守退化 |
| `ui/_build.json`、两个 HTML | 仅通过 bump-build 同步本轮构建号 |
| `AUDIO-OWNER-HOST-INTERFACE-SPEC.md` | 轨道二规格，只读 A+B，明确媒体终止栅栏；未修改宿主 |

`owns()`、yield/handoff/release、captureStream 以及许可证均保持原语义。`tools/verify-ui.mjs` 的开工在途修改保留，本轮未修改它。

## 实际协议和必要保护

1. 每个文档启动时持有自己的 `hana-simple-player-audio-doc-alive-<ownerId>` 身份锁，永不 steal、永不主动释放。
2. 竞争全局 `hana-simple-player-audio-doc`：启动用 ifAvailable，拿不到则待命；有恢复意图的文档可普通排队，旧文档销毁后自动拿锁，不用超时/轮询判死亡。
3. 全局锁持有者还须用 ifAvailable 探测旧 owner 身份锁：**对端身份锁也空闲**，才可发送 reap。只拿全局锁不足以证明旧文档死亡，steal 尤其不能当死亡证明。
4. reap 只来自 boot/restore、显式 user/resume/media/track 或用户 stop，携带所读的 `reapOwnerId/reapGeneration`。后端只在目标仍匹配时清点；同一请求先清点，再正常 grant。
5. 显式接管先提交 pending，再 steal。旧页在 AbortError 中同步 pause，主动回读并通过原 yield 写 `playing:false`、确认授权。新页仍等后端 grant，**不会因偷锁成功就直接播放**。双通知丢失不影响这条浏览器撤锁 → 回读确认路径。
6. 只重建后端、保留 renderer：锁仍被旧文档持有，后来的 boot 不发送 claim/reap、不会出声。停止/hand-off/pageshow 不提前释放锁。

额外身份锁是对任务书最小建议的必要加固：若 stealer 比旧页处理 AbortError 更早销毁，全局锁会空闲，但旧页仍可能活着。
专项 #27 实测这条反例，确认新的全局锁持有者保持待命、未发送 reap。

本轮还修复两个时序点：用户起播取消还在等待 seek 的旧 boot 意图，避免后到的 metadata 发 restore 作废 user token；
媒体尚无 metadata 时被接管，保留恢复 seek，避免异步 pause/timeupdate 把位置覆盖成 0。
所有既有等待上限保持不变；没有授权重试或“超时强播”。

## 信任边界与退化

浏览器强制同 bucket 的锁互斥和销毁释放，但后端**只能采信前端的 reap 声明，无法自行证明锁**。
这是本机单用户 App 的取舍，不是密码学保证。generation 目标校验防止正常客户端延迟回包跨代清点，不能防恶意客户端伪造声明。

锁缺失、访问抛异常/SecurityError 时，前端保留原后端 pending→yield 机制，不报启动错误、不发送 reap、不借超时放宽授权。
拿不到锁时继续待命；普通排队只等待浏览器释放，没有时间过期策略。
同一 host 下所有媒体文档需要采用本轮协议；混用旧 UI 或不同 storage bucket 无法提供同等证明。
因此部署必须整包同步并 reload 全部呈现面；宿主拓扑变化/远程/移动环境需要重新核验。

Hana 的 [真实能力报告](AUDIO-OWNER-LOCK-CAPABILITY-REPAIR2-HANA.md) 已确认：
卡片和独立窗同 origin、secure、query 无 SecurityError，独立窗持锁时三张卡可见且拿不到；
关闭独立窗后，全局锁及该文档身份锁同时从幸存卡片 query 消失（§3.2）。
这证明本轮方案的宿主前提成立，**并不等于播放器行为已真机验收通过**。

## 原始验证输出与复跑

原始目录：`audio-owner-1.1.1/repair2/`。输出和 Chrome 报告独立保存，没有覆盖旧轮验收证据。

| 检查 | 基线 | 本轮 |
| --- | --- | --- |
| 后端 | 114/114，`baseline-backend.txt` | 119/119，`final-backend.txt`，failed=[] |
| 全 UI | 376/376，`baseline-ui.txt` 和 `baseline-ui/verify.json` | 376/376，exit 0：`ui-first.txt`、`ui-first/verify.json`；failedCases/failedAssertions/runtimeErrors=[] |
| 所有权 Chrome | 20/20，`baseline-owner.txt` | 34/34，`owner-final2.txt`、`owner-repeat.txt` 及对应 `verify-audio-owner.json`，failed=[] |
| 官方静态检查 | — | `final-static-validation.txt`：ok=true，errors=0，动态依赖未证明警告 1 条 |
| 官方隔离 UI 冒烟 | — | `smoke-validation.txt`：未成功执行，缺独立 Electron 开发运行时（需设置 HANA_APP_ELECTRON）；不计通过 |
| 构建/孪生/许可证/新增 ES5 | — | `build.txt`、`source-checks.txt`，构建三处一致、孪生一致、AGPL 保持、无新增非 ES5 语法 |

简短原始输出摘录：

```json
{"passed":119,"total":119,"failed":[]}
{"passed":34,"total":34,"failed":[]}
{"selfCheckPassed":12,"selfCheckTotal":12,"narrowSelfCheck":"4/4","assertions":"376/376","failedAssertions":[],"runtimeErrors":[]}
```

官方校验在 `/tmp/…/hanako-simple-player` 的整包临时副本执行：仓库目录名为 hanako-audio-player-simple，
直接 `--dir .` 会报 manifest id 与目录名不一致；没有因此更改正式 manifest id。
`source-checks.txt` 中旧非 ES5 列表是开工前已存在的封面面板 async/await；本轮新增锁代码使用 var/function/Promise。

开发阶段失败日志 `owner-first`～`owner-seventh`、`owner-trace` 保留。它们发现了恢复位置覆盖、boot/user 意图互相作废和夹具跨轮写回；
没有把这些中途失败当通过。夹具现在用每轮独立票和 service epoch 拒绝上一轮迟到的 keepalive，业务死亡测试同一轮仍保留原孤儿记录。
新增并发死亡检查等待正常起播完成再断言，未改放宽原断言或延长原等待上限。

复跑（每条为独立命令）：

```sh
node tools/verify-backend.mjs
OUT_DIR=/tmp/hap-repair2-ui node tools/verify-ui.mjs
OUT_DIR=/tmp/hap-repair2-owner node tools/verify-audio-owner.mjs
```

## 断言对应

以 `owner-repeat/verify-audio-owner.json` 的 results 一基序号为准：

| 编号 | 要求/证据 |
| --- | --- |
| #1/#8 | 同时 boot 一个出声，BC 正常与禁 BC 两档 |
| #2–#7/#9–#14 | 接管停旧页、保留进度、被动快照 false、chip 可点且夺回、主动全停 |
| #15–#17 | 单实例 reload 续播、重选当前曲保持状态、自动下一首 |
| #18–#19 | 等待结束后晚到 grant 不起播、暂停授权者关页释放 |
| #20 | 交接丢失且旧文档仍活 → 一直待命；断言原样保留 |
| #21 | 没拿到锁的 boot 不 claim/reap，被动快照和本地 playing 为 false |
| #22–#23 | 丢交接旧页销毁：幸存待命页/新 boot 自愈续播 |
| #24 | 两个文档同时从孤儿 boot，仅持锁者清点、仅一个出声 |
| #25 | 真实 iframe.remove，无 handoff；浏览器释放后新页起播 |
| #26 | 后端重建但旧文档保留，不自动起播 |
| #27 | 全局锁被撤但旧文档身份锁仍活，不清点、不自动起播 |
| #28 | 无 pending 的孤儿 stop 能清理且写 false |
| #29–#30 | BC 与 storage 通知双断：boot 待命，显式 steal 停旧页；两个同源 window 在媒体事件和 1ms 采样中同步读取全部 audio，未见 voices>1 |
| #31–#34 | 无锁及 SecurityError 两种环境保守退化，显式接管仍走原 yield，绝无 reap |

盘上 playing 的口径：活 owner 在播时，**全局播放快照仍可为 true**；待命实例自己的快照必须 false，且不能覆盖当前 owner。
这对应原 #3/#10，不能把“待命不写 true”误解成“有活 owner 时全局盘必须 false”。

后端新增末 5 条：恢复守卫前清点（revision+2）、旧 save/yield/handoff 拒绝、延迟 reap 不清新 owner、缺目标证明待命、孤儿 stop 写 false。
这些测试使用生产 `createAudioOwner` 与生产 app.js、真实 Chrome Web Locks/媒体，宿主 transport 是受控夹具；不冒充真实 Hana 行为。

## Hana 部署与真实复验（仍需执行）

1. 整包同步 `ui/` **含 CSS/SDK/build/孪生 HTML** + `lib/`；运行时其它在途依赖按协作约定完整保留；reload app，核对实际 **1.1.1 / 1003131680**。保存 owner 与所有 paused 状态时间轴。
2. 单实例非零进度播放 → Cmd+Q 完全退出 → 启动，确认孤儿清点、续播和进度保留。
3. 卡片 + 独立窗 → 强制结束 Hana → 启动，无 handoff 也恢复；实际 audio.paused===false 数量 ≤1。
4. 另一实例播放 → 旧停新响，chip 夺回；主动暂停全停。
5. 只重建 App 后端、旧渲染文档保留，新文档不得自动出声。
6. 直接销毁 owner iframe，不执行卸载 JS，另一个实例恢复。
7. 不清 owner，连续重复步骤 2/3 三次，确认退出写回不再死锁。
8. 能力探测已通过；留存上述 Hana 报告，实际播放器文档还可用 `__playerDebug.audioOwner()` 的 docLockHeld/docLockSupported 核对。
9. 单实例连播、切歌、reload/反复拖进拖出回归；bfcache/freeze、远程/移动仍未覆盖。

临时救援仍是任务书 §6 的用户终端步骤：完全退出 Hana → 备份 global.json → 只清 player-audio-owner → 重启。
本轮未执行这条生产数据操作。它是等部署时的临时绕过，不能算返修完成证据。

## 协作交接

已通过 Computer Use 在「多窗口bug修复」项目会话提交真实能力探测请求，并确认消息发送成功。
2026-10-13 19:14（Asia/Shanghai），已通过 Computer Use 在同一项目会话发送最终交接，
确认输入区清空、出现本条消息的轮次导航且 Hana 进入处理状态。消息要求独立复跑、整包同步/reload、
执行上述真实复验并写 `AUDIO-OWNER-ACCEPT-REPAIR2-HANA.md`。**消息已提交，不等于真实验收已通过。**

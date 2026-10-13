# MOOD-ONESTEP-DONE · /mood 一步直达 1.1.2

2026-10-13 · Codex 实现与自验；Hana / 哦鲸鲸独立验收。版本 **1.1.2**，最终构建 **1003131681**。

依据 [TASK-mood-onestep-1.1.2.md](../../TASK-mood-onestep-1.1.2.md) 和 [独立验收清单](../../ACCEPT-mood-onestep-1.1.2.md)。实现、自验已完成；生产部署、扩权审批和真实有模型建单 **待 Hana 验收**。本轮没有部署或修改生产会话、歌单数据，也没有提交源码。

## 基线与 audio-owner 保留

任务发出时记录为未提交 audio-owner、build 1003131679、backend 114/UI 376/专项 20。实际开工读取时，audio-owner 已提交为 `40e2a16`，版本 1.1.1、build **1003131680**，包含 Web Locks 孤儿自愈及新增回归。以实际工作树为准，本轮独立复跑 **backend 119/119、UI 376/376、音频专项 34/34**，失败集合均为空，不采用历史 102/366 或较早的 114/20。

开工指纹见 [baseline-source.json](mood-onestep-1.1.2/baseline-source.json)。[source-preservation.json](mood-onestep-1.1.2/source-preservation.json) 确认 `lib/audio-owner.js`、`lib/register-routes.js`、`ui/app.js`、style/SDK、音频专项和 UI 验证脚本、inputBanner 注册与 create/search 工具均逐字未变。两个 HTML 仅从 1680 同步至 1681，孪生壳仍只差 data-shell。CHANGELOG 保留完整 1.1.1 段，在其上新增 1.1.2；manifest 保留旧能力与全部其他字段，仅增加指定两权限并升版本。

## 行为与修改文件

| 文件 | 修改及原因 |
| --- | --- |
| `lib/mood-command.js` | slash 无 callToken：通过 `session:list` all/active 换 stable id；先 realpath 匹配，再精确原串回落；按任务原文组消息，args 不清洗；仅用 `session:send` all 投递。accepted:true 时返回 undefined；其他情况返回原 MOOD_PROMPT，warn 分类原因，不打印异常原文、路径、args 或凭据。日志失败也不会抛给命令客户端。 |
| `manifest.json` / `package.json` | 1.1.1→1.1.2；只新增 `app/session.start-turn`、`app/sessions.manage`，保留 `app/sessions.read` 及全部既有声明。 |
| `docs/CHANGELOG.md` | 新增 1.1.2：一步唤起当前 agent、带参需求与授权/失败降级；保留音频唯一化说明。 |
| `tools/verify-backend.mjs` | 原 119 条名称、顺序、结果保留；增加 13 条生产 handler 断言，见下表。 |
| `tools/verify-mood-host.mjs` | 真宿主与真 AppHost 子进程/WS 派发；四个独立 HOME 测全部允许、逐项拒绝 read/manage/start-turn；无模型只证明发送到模型入口，另测缺路径与未匹配降级。 |
| `_build.json` / 两 HTML | bump-build 1003131680→1003131681，三处一致。 |

中文别名注册与明确拒绝后的无别名降级逻辑保留。未加输入钩子、定时器、其他会话写入动作或前端行为。投递消息来源由宿主盖章，App 不自报用户/Agent 来源。

## 原始输出与验证边界

原始证据目录 [mood-onestep-1.1.2/](mood-onestep-1.1.2/)，[verification-summary.json](mood-onestep-1.1.2/verification-summary.json) 仅作索引。

| 检查 | 结果 | 原始输出 |
| --- | --- | --- |
| 开工 backend | 119/119，exit 0 | [baseline-backend.json](mood-onestep-1.1.2/baseline-backend.json) |
| 开工 UI | 376/376，runtimeErrors=[]，exit 0 | [stdout](mood-onestep-1.1.2/baseline-ui.stdout.log)、[完整浏览器报告](mood-onestep-1.1.2/baseline-ui/verify.json) |
| 开工音频专项 | 34/34，exit 0 | [baseline-audio-owner.json](mood-onestep-1.1.2/baseline-audio-owner.json) |
| 最终 backend | **132/132**，失败 []，exit 0 | [verify-backend.json](mood-onestep-1.1.2/verify-backend.json) |
| 最终真实宿主派发 | **17/17**，失败 []，exit 0 | [verify-mood-host.json](mood-onestep-1.1.2/verify-mood-host.json) |
| 官方静态校验 | errors 0，warnings 1，exit 0 | [validate-static.json](mood-onestep-1.1.2/validate-static.json) |
| 版本/能力/原断言/源码核对 | 全通过 | verification-summary.audit 与 source-preservation |

UI 与音频专项为本轮开工的独立输出；后端命令改动后不重复跑，代码 SHA 确认上述行为及测试脚本未变。**不能将它们称为生产真机验收**。既有涟漪断言未修改。最初受沙箱 loopback listen EPERM 限制的专项启动没有算成功；随后通过工具审批在临时本地服务中复跑成功。

官方静态校验使用正确 App 目录名 `/tmp/mood-onestep-validation/hanako-simple-player` 的运行时镜像，仅剩既有 `DYNAMIC_DEPENDENCIES_NOT_PROVEN` 警告；校验的 mood 模块 hash 与宿主测试、当前源码一致。这不是官方 UI smoke，亦非生产安装。

## 真实宿主回归方法与开放问题结论

运行 `node tools/verify-mood-host.mjs`，可用 `HANA_APP_TOOLS_ROOT` 指定产物。当前验证同版本 `1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133`，使用其自带 node；所有 App、账本、会话、日志都在独立 `/tmp/hap-mood-host-*`。测试进程结束后只清理自己启动的进程组，fixture 保留以便诊断。

测试 App 原样复制生产 mood 模块；ctx 的观测包装只记录真实 bus 请求与回包，不编造 session:list/send 成功。测试安装记录和三权限账本只预置在独立 HOME，不代表生产审批。有效 legacy 会话在启动前放入，由宿主迁移生成 stable manifest id，**不自行伪造 sessionId**。空文件不列入 session:list；启动后才写的文件虽列入目录但 id 为 null，不能作为 B1 的有效夹具。前期失败原始输出也保留（fixture-failed、empty-session-failed、unregistered-session-failed、late-session-failed），最终未放松断言。

- **带路径、三权限允许**：session:list all/active 实际回非空 stable id；无参消息与带参消息逐字符合任务文本，session:send 的 payload 仅含 text/sessionId/scope。实际错误来自模型恢复层 `No models available`，不是权限或 manifest 定位错误。无模型导致 handler 按设计回提示牌，WS 客户端逐字收到 MOOD_PROMPT。
- **路径归一**：同一测试会话分别用 `/tmp/...` 与 `/private/tmp/...` 派发，实际发送使用同一 stable id。生产 helper 的 symlink realpath 匹配与不可 realpath 时原串回落另有单元断言；不通过字符串替换猜路径。
- **权限拒绝**：独立拒绝 read、manage、start-turn，真宿主分别报对应权限；客户端都收到降级提示，命令不抛错。不是只测“无模型时返回 prompt”。
- **缺路径/未匹配**：通过辅助测试 slash 命令在真正 App 子进程调用同一生产 handler，分别确认缺路径不查询，未匹配只查询不发送，且有 warn。辅助命令只存在测试 App；未把它称为真 bridge 客户端验收。
- **成功语义**：accepted:true 后返回 undefined 由单测覆盖；此处隔离无模型不能验证真实成功接纳后 agent 回复，更不能验证 create_list。因此有模型 C 组仍需 Hana。

## 新增后端断言编号

| 编号 | 名称 |
| --- | --- |
| 120 | mood-onestep-lists-all-active-and-sends-stable-id-only |
| 121 | mood-onestep-accepted-does-not-return-floating-prompt |
| 122 | mood-onestep-args-verbatim-and-prescribed-message |
| 123 | mood-onestep-realpath-matches-symlink-to-session |
| 124 | mood-onestep-exact-path-fallback-if-realpath-unavailable |
| 125 | mood-onestep-no-path-falls-back-without-session-query |
| 126 | mood-onestep-unmatched-path-does-not-send-to-another-session |
| 127 | mood-onestep-missing-stable-id-does-not-send-path |
| 128 | mood-onestep-read-denial-falls-back-and-redacts-error |
| 129 | mood-onestep-send-denial-falls-back-and-redacts-error |
| 130 | mood-onestep-unaccepted-send-is-not-success |
| 131 | mood-onestep-no-models-falls-back-with-safe-reason |
| 132 | mood-onestep-logger-failure-does-not-break-fallback |

宿主输出 results 顺序即 MH-01–17：grant 无参提示、stable id、无参文本、模型入口、带参提示、带参文本/模型入口、tmp/private 同 id、无路径提示/无查询、未匹配提示/无发送、read 拒绝提示/权限证据、manage 拒绝提示/权限证据、start-turn 拒绝提示/权限证据。详细稳定名称在原始 JSON 中。

## 给 Hana 的复验与部署交接

1. 独立复跑 backend、verify-mood-host 和官方静态校验，核对原始输出与保留 audio-owner 的 SHA；验收清单 A6 写的 1.1.1 应按任务书检查新增 **1.1.2** 段，原 1.1.1 段仍完整保留。
2. 整包同步最终运行时，`ui/` 必须整包，随后 reload；**这次 manifest 扩权须走宿主现有审批**。用户已授权实现扩权，Codex 未替用户操作生产权限弹窗；拒绝更新时旧版本保留不能误判为新 handler 的降级。
3. 在真正有模型的当前会话中测试 `/mood`：进入会话的 App 来源消息与 agent 引导；再测试 `/mood 今天很累，来点安静的`：读库、选歌、create_list 落「今日心情」。来源以宿主实际展示为准，App 未伪造。
4. 生产端拒绝/撤销权限的降级、反复命令正常起轮，以及 audio-owner 独立真机验收仍需分别记录。测试用独立名字，不覆盖用户已有歌单。
5. 真机结论由 Hana 写验收报告；tag、Release、市场更新不在本任务范围。

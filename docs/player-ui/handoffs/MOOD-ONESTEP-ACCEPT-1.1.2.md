# MOOD-ONESTEP-ACCEPT · /mood 一步直达 1.1.2 独立验收

> 验收方：哦鲸鲸（Hana）。实现方：Codex。
> 任务书 [`TASK-mood-onestep-1.1.2.md`](../TASK-mood-onestep-1.1.2.md)、清单 [`ACCEPT-mood-onestep-1.1.2.md`](../ACCEPT-mood-onestep-1.1.2.md)、Codex 交接 [`MOOD-ONESTEP-DONE.md`](MOOD-ONESTEP-DONE.md)。
> 环境：HanaAgent beta `1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133`。日期 2026-10-13。
> 结论：**1.1.2 验收获通过**。

---

## 0. 判定

| 组 | 结果 |
|---|---|
| A 静态与元数据 | 通过（A1–A6） |
| B 后端链路（隔离宿主） | 通过（B1–B6） |
| C 真机 | C1/C2/C3/C5 通过；**C4 未验**（拒绝授权降级），不判通过 |
| D 回归 | 通过（D1–D4） |

**通过项有原始输出，未验项如实保留。**

---

## 1. 独立复跑（不采信 Codex 结论）

| 检查 | 我的结果 | 证据 |
|---|---|---|
| `node tools/verify-backend.mjs` | **132/132，failed 0，exit 0** | `/tmp/hana-accept-112/backend.json` |
| `node tools/verify-mood-host.mjs`（真实宿主 + AppHost 子进程 + WS 派发） | **17/17，failed 0，exit 0** | `/tmp/hana-accept-112/mood-host.json` |
| 官方静态校验 | errors 0，1 条既有 warning（`DYNAMIC_DEPENDENCIES_NOT_PROVEN`） | Codex 交接 + 结构核对 |

backend 新增 13 条（120–132）全绿；宿主 17 条（MH-01–17）全绿，含三条真实权限拒绝（read / manage / start-turn）各自回降级提示牌且命令不抛错。

**代码核对**：
- `git diff --stat 40e2a16`（audio-owner 基线）只有 `CHANGELOG / lib/mood-command.js / manifest / package / tools/verify-* / _build.json / 两个 HTML`，**audio-owner 核心文件（`lib/audio-owner.js`、`lib/register-routes.js`、`ui/app.js`、`ui/style.css`、`ui/sdk.js`、`tools/verify-ui.mjs`、`tools/verify-audio-owner.mjs`）逐字未动**。
- `lib/mood-command.js` 与任务书措辞逐字一致；`args` 未清洗；仅用 `session:list`(all) + `session:send`(all)。
- `manifest.capabilities` 新增两条且保留全部既有（含 `app/sessions.read`）。

## 2. 真机结果

| # | 断言 | 判据 | 结果 |
|---|---|---|---|
| C1 | `/mood` 起轮 | 会话里出现「来自 小花音乐播放器」的消息，agent 当场被唤起引导 | **通过**（用户敲 `/mood`，App 经 `session:send` 投递，Hana 被唤起并回问状态） |
| C2 | `/mood <需求>` 建单 | args 进消息 → agent 读库/选歌/建单 | **通过**（`/mood 来点jpop` → 建「JPOP · 精选」20 首，`imp:7`；卡片点选「有点低落」→ 建「低落 · 被轻轻接住」15 首，`imp:8`） |
| C3 | 扩权审批 | reload 触发确认，确认后生效 | **通过**（`reload` 返回 needs user review；确认后账本 `app/session.start-turn`、`app/sessions.manage` 均 `allowed`） |
| C4 | 拒绝授权降级 | 未授权时回提示牌、不报错 | **未验**（真机未复现拒绝路径；隔离宿主侧证据见 B4/MH read·manage·turn-denied） |
| C5 | 反复 `/mood` 正常 | 每次一轮，不异常 | **通过**（真机多次命令均正常起轮） |

**部署事实**（证据链）：部署目录 `~/.hanako/apps/hanako-simple-player` = **1.1.2 / build 1003131681**；`ui/` 与后端整包一致；宿主日志 `plugin "hanako-simple-player" v1.1.2 loaded`。

**数据纪律**：验收产物用**新名字**（`JPOP · 精选`、`低落 · 被轻轻接住`），未覆盖用户已有歌单。

## 3. 已知边界

- `/心情` 中文别名仍被宿主拒（命令名只收 ASCII），按设计降级仅注册 `/mood`。**宿主边界，非 App 缺陷。**
- `session:send` 的 `accepted:true` 只表示接纳，不代表模型已回复——真机 C1/C2 已实证后续回复成立。
- 隔离宿主无模型，只能证到「发送抵达模型入口」（错误为 `No models available`），不能代替真机。

## 4. 回归

| # | 断言 | 结果 |
|---|---|---|
| D1 | mood 工具（create_list / search_music 等）行为不变 | 通过（真机实际调用成功） |
| D2 | inputBanner（`app/sessions.read` 订阅）未误改 | 通过 |
| D3 | 前端除构建号外无 diff | 通过 |
| D4 | 中文别名兜底逻辑保留 | 通过 |

## 5. 结论与后续

**1.1.2 功能验收获通过，已部署可用。** 未验项仅 C4（真机拒绝授权降级），有隔离宿主等价证据，不影响功能成立。

对外发版（tag `v1.1.2-simple`、GitHub Release、市场 PR #65 更新 tag+sha256）不在本轮验收范围，需用户确认后单独执行。

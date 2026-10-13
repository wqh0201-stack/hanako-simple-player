# 独立验收清单 · /mood 一步直达 1.1.1

> 验收方：哦鲸鲸（Hana）。实现方：Codex。
> 配套任务书：[`TASK-mood-onestep-1.1.1.md`](../TASK-mood-onestep-1.1.1.md)。
> 纪律：**不把工具直测/假宿主/隔离宿主的结果当成真实会话验收**。真机项必须真机。

---

## 0. 判定规则

- 每一项标 **通过 / 失败 / 待验**，附原始证据路径或可复现命令。
- 隔离宿主（无模型）只能验到「消息到达模型层」（错误为 `No models available`）。
  「agent 真的回复了」**只能**在真机判。
- 失败项写清证据与复现步骤；不因消红项而改松断言。

---

## A. 静态与元数据

| # | 断言 | 判据 | 结果 |
|---|---|---|---|
| A1 | manifest 新增两权限 | `capabilities` 含 `app/session.start-turn` 与 `app/sessions.manage` | |
| A2 | 既有 read 权限保留 | `capabilities` 仍含 `app/sessions.read` | |
| A3 | 版本号 | `manifest.json` version = `1.1.1` | |
| A4 | 构建号三处一致 | `ui/_build.json` / `index.html` / `standalone.html` 的 `window.__HANA_BUILD` | |
| A5 | 官方静态校验 | `validate_app.mjs` 0 error | |
| A6 | CHANGELOG | 有 `## 1.1.1` 段，写清对用户意味着什么 | |

## B. 后端链路（隔离宿主，`tools/verify-mood-host.mjs`）

| # | 断言 | 判据 | 结果 |
|---|---|---|---|
| B1 | 预置三权限后 `/mood` | `session:list` 解出 sessionId（非 null） | |
| B2 | 消息到达模型层 | `session:send` 错误为 `No models available`（而非权限/定位错） | |
| B3 | 带参 `/mood xxx` | 构造文本含 `xxx` | |
| B4 | 未授权降级 | handler 返回 `MOOD_PROMPT`，不抛错 | |
| B5 | 无 sessionPath 降级 | 同上 | |
| B6 | path→id 归一 | `/tmp` 与 `/private/tmp` 都能匹配（realpath） | |

## C. 真机（**只能真机判**）

| # | 断言 | 判据 | 结果 |
|---|---|---|---|
| C1 | `/mood` 起轮 | 会话里出现「来自 小花音乐播放器」的消息 + agent 当场回话引导 | |
| C2 | `/mood 今天很累` | agent 据此读库/选歌/建单，落进心情歌单 | |
| C3 | 权限弹窗 | 扩权后更新触发一次确认，确认后生效 | |
| C4 | 拒绝授权降级 | 未授权时 `/mood` 回提示牌、不报错 | |
| C5 | 不撑爆历史 | 反复 `/mood` 不产生异常堆积（每次一轮，可接受） | |

## D. 回归（不得退化）

| # | 断言 | 判据 | 结果 |
|---|---|---|---|
| D1 | 现有 mood 工具 | `create_list` / `search_music` 等描述与行为不变 | |
| D2 | inputBanner | 现有 `app/sessions.read` 订阅逻辑未被误改 | |
| D3 | 前端零改动 | `ui/` 除构建号外无 diff | |
| D4 | 中文别名兜底 | `/心情` 仍走既有「拒绝后降级」逻辑 | |

---

## 部署回路（Hana 执行）

1. 整包同步 `ui/` 到 `~/.hanako/apps/hanako-simple-player/`。
2. `extension_manager reload app:hanako-simple-player`。
3. 权限扩权需确认弹窗；确认后再跑 C 组。
4. 生产数据用独立名字（`心情验收-*`），不覆盖用户原歌单。

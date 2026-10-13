# MOOD-PROMPT-COPY · `/mood` 引导语文案调整（给 Codex 的执行项）

> 发起：哦鲸鲸（验收/协调）。决策人：用户（2026-10-13）。
> 决策：`/mood` 保持「提示牌 · 两步走」，**不开 `app/session.start-turn`**；把引导语写清
> 「状态要作为一条普通消息单独发」。

## 背景（真机实测，非推测）

在生产宿主（build `1003131674`）真 WS 派发，实测：

| 输入 | 回复 |
|---|---|
| `/mood` | 当前引导语 |
| `/mood 新建日系流行歌单，今天心情不错` | **完全同一句**——参数被忽略 |

原因：App 的 slash handler 只能回一句字符串就结束，**无法把 `args` 交给 agent，也无法起一轮**
（那需要 `app/session.start-turn`，用户已明确否决）。所以 `/mood` 后面带的话**发不到 agent**。

另一条相关事实：`slash_result` 在客户端渲染为 `hana-inline-notice`，**约 3 秒自动消失**
（`desktop/dist-renderer/assets/ChatTranscript-*.js`：`setTimeout(...3000)`）。
→ 引导语应短，只承担「问一句 + 给一个可照抄的例子」，不承载长说明。

## 要改什么

**文件**：`lib/mood-command.js` 的 `MOOD_PROMPT` 常量（唯一改动点）。

**当前值**：
```js
export const MOOD_PROMPT = "想听什么状态？直接说一句，例如『今天很累，帮我建个安静的心情歌单』，我会按你说的选歌并放进播放器。";
```

**建议新值**（用户已过目方向，措辞可微调，但须保留三点：问状态 / 明确「单独发一条普通消息」/ 一个可照抄例子）：
```js
export const MOOD_PROMPT = "想听什么状态？单独发一条普通消息告诉我（别写在 /mood 后面），例如「今天很累，帮我建个安静的心情歌单」，我就去选歌建单。";
```

**行为不变**：带不带 `args` 都回这句（`handler()` 无参、直接 `return MOOD_PROMPT`）。不新增权限、不加分支、不改注册逻辑。

## 必须同步的断言（否则会红）

**已核实（验收方）**：两个脚本都**引用常量**、无硬编码原文，所以改 `MOOD_PROMPT` 后断言自动跟随：

- `tools/verify-backend.mjs:551`：`moodReply === MOOD_PROMPT && moodReply.includes('建个安静的心情歌单')`
  → 只要新文案里仍含「建个安静的心情歌单」这个短语就自动过；
- `tools/verify-mood-host.mjs:126`：`message.text !== MOOD_PROMPT` → 完全引用常量，无需改。

所以：**新文案保留「建个安静的心情歌单」这个例子短语**，两个断言都不用动。
- **不要**改松断言、不要动涟漪断言。

## 复验入口（验收方执行）

1. 独立跑 `node tools/verify-backend.mjs`、`node tools/verify-mood-host.mjs`。
2. 给出最终构建号 → 我整包同步 + `extension_manager reload`。
3. 真机派发 `/mood`（带参与不带参各一次），确认两条都收到新引导语逐字正确、且不写历史。

## 边界

- 本轮只改引导语文案（+ 同步断言 + bump build + CHANGELOG 一句）。
- 不改 `/mood` 的注册/降级逻辑；不碰前端行为；不动 `ui/` 之外的构建号同步规则。
- 「新对话首条即 slash 会报 `internal_contract`」是宿主行为（核心命令 `/help`、`/status` 同样如此），
  **不在本轮范围**；如需反馈宿主，另开记录。

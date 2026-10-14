# 歌词跟随自愈 + 跳句动画 · 修复记录

2026-10-14。构建 **1003131698**（1.1.5）。触发：罐头报「有时候歌词不会滚动，切歌也没法，
可能因为我点击过歌词跳转」，并补一句「波浪动画都没有，就一句句再跳，视图不跟着走」。

## 症状 → 根因

症状三件套：**没有波浪、高亮一句句跳、视图冻在原地（滚轮也不弹回）**。

三条是同一个因：`state.follow` 被永久卡成 `false`。

- 波浪（逐帧波峰）由 `startLyricFrames()` 的 rAF 循环驱动，而 `canFlowLyrics()`
  第一层就要求 `state.follow`。follow 一死，循环停 → 只剩 `timeupdate`（~4Hz）
  在 `updateLyricIndex` 里刷高亮 → 看着就是「一句句跳、没波浪」。
- 视图不动：`paintLyricFlow()` 的滚动块整段挂在 `if (state.follow)` 里。
- 滚轮救不回来：`scheduleResume()` 开头 `if (state.follow || lyricAlign || lyricPress) return;`
  —— 残留的 `lyricPress` 把定时器一路挡住。

而 `state.follow` 为什么会永久 false：

1. `lyricWrap` 的 `pointerdown` 先 `pauseFollow()`（立 3s 回位定时器），
   **紧接着 `clearFollowTimer()` 把它清掉**；
2. 之后唯一能重新立定时器的路径是松手事件（`pointerup` / `pointercancel` /
   `pointerleave` / `lostpointercapture` / `blur` → `clearLyricPress` → `scheduleResume`）；
3. 卡片是 iframe。**在卡片/窗口外松手、宿主自己接管拖拽、或任何一次 pointerup 没送到**，
   `lyricPress` 就永远留着；`pointermove` 超过 6px 又会取消长按校准的 450ms 定时器，
   于是它既不是拖拽态、也永远清不掉。

复现（修复前，`tools/verify-ui.mjs --lyrics-only` 的探针）：合成 `pointerdown` +
`pointermove`(>6px)、不给 `pointerup`，7 秒后 `follow=false / raf=false / position` 冻结；
滚轮后依旧冻结。**只有点歌词或切歌才恢复**——和罐头描述一致。

## 改了什么（`ui/app.js`，5 处）

| 位置 | 改动 |
|---|---|
| `scheduleResume()` | 不再因 `lyricPress` 放弃定时器；到点后：拖拽中 → 续等 3s；非拖拽的残留按压 → `clearLyricPress(true)` 清掉再 `resumeFollow()` |
| `pointerdown` | 去掉 `clearFollowTimer()`（`pauseFollow()` 已经立好自愈定时器，不该清） |
| `canFlowLyrics()` | 拆出 `base`（follow / 可见 / 布局等）；`lyricReturn` 在跑时直接放行，不再被 `!audio.seeking` 和时钟 `moving` 掐断 |
| `seekLyricLine()` | `updateLyricIndex(true)` → `updateLyricIndex(false)`：先立回位动画再刷高亮，不再瞬移 |
| `seeked` 处理 | `updateLyricIndex(true)` → `updateLyricIndex(!lyricReturn)`：落点后若回位动画在跑就让它跑完 |

语义澄清：**回位 = 0.5s 缓动滑回去**（原有设计），这次是让它「必然发生」+「不被 seeking 打断」；
点歌词跳句此前是瞬移，现在复用同一条回位通道滑过去。浏览时不改高亮归属（高亮始终跟播放时钟）。

## 验证

- 新增 3 条常驻断言（`tools/verify-ui.mjs` 的 `verifyLyricFlow`）：
  - `lyrics-bounce-back-is-animated` —— 滚轮浏览后回位中途要有 ≥4 个中间位置，且 +150ms
    时仍在途中（不是「啪」一下到位）。
  - `lyrics-click-line-jumps-with-animation` —— 从 15s 跳到第 0 句，位置 270 → 19 要有 ≥4 个
    中间位置、落点正确、follow 恢复。
  - `lyrics-lost-pointerup-self-heals` —— 丢松手事件后 3s 内 follow/raf 恢复且重新居中。
- **反向验证**：把 `ui/app.js` 回退到修复前，这 3 条中 2 条红
  （`lyrics-click-line-jumps-with-animation` 报 ramp 全程 14.5；`lyrics-lost-pointerup-self-heals`
  报 `follow:false, position:73` 对目标 174.6），并且连带把后面的
  `lyrics-returning-from-overlay-resumes-frames` 也拖红 —— 卡死是**粘的**，
  正是罐头遇到的「反正没法了」。
- `node tools/verify-ui.mjs --lyrics-only`：**75/75**，零运行时错误（基线 72 条 + 新增 3 条）。
- 全量 `node tools/verify-ui.mjs`：**384/384**，`failed` 0 条、`runtimeErrors` 0 条
  （日志 `/tmp/verify-ui-full.log`，截图与报告 `/tmp/hap-verify/`）。
  旧基线见 1.1.0 记录的 367 条；差额含本轮新增 3 条与上一轮涟漪专项新增的断言，未逐条归因。
- 部署：`ui/` 整包同步进 `~/.hanako/apps/hanako-simple-player/`（逐文件 `diff -rq` 一致），
  `reload app:hanako-simple-player` 已执行。
- 顺带清掉仓库 `ui/` 里一个 gitignore 的临时备份 `sdk.js.bak-oldplugin-20261014-000637`
  （官方 SDK 迁移已提交，备份无回退价值）。

## 没做 / 待确认

- 宿主真机验收（Mac 上的 Hana 宿主目视 + 手感）留给罐头：**旧卡片要重开一次**才会吃到新快照。
- 长按 450ms 进校准（`is-aligning`）是既有设计，本轮没动；罐头若觉得容易误触，
  下一轮可以把阈值提到 600ms 或改成「长按后必须移动才进校准」。

# 歌单展开与慢歌长句性能 · Codex 交接

2026-10-14。版本仍为 1.1.5，本地候选构建 **1003131699**；本轮不发版。基线为 HEAD 的 build 1003131698，开工工作树干净。

## 用户反馈与结论

用户最初反馈展开歌单时歌词卡顿，随后补充长句本身不丝滑，并指定《決意の唄》—大原ゆい子（网易云 3406947013），截图约 23 秒，日中合并歌词换成两行，节奏较慢。

确认两处不同根因：

1. `canFlowLyrics()` 用 `!state.drawer` 关闭歌词 rAF，但宽窗抽屉只是局部覆盖，仍可看见歌词。剩下的 `timeupdate` 约 4Hz 更新制造低帧率观感。浏览器 rAF 本身没有同步掉到 4Hz。
2. 当前曲的三条 SVG 播放指示在 path 上做 `transform-box:fill-box` / `scaleY` 动画，Chromium 持续执行布局。长卡歌单常驻时也发生。

长句的逐帧样式读写还可减少：旧实现先写波峰颜色/透明度/缩放，再读滚动几何；微小色阶和未改变值也不断写回。实现已优化，但真实宿主 GPU 呈现与用户手感仍需独立验收，不能由无头 rAF 数据推定。

## 改动

- `ui/app.js`：去掉宽窗抽屉暂停条件；保留窄卡队列、搜索、离屏、暂停、减少动态偏好的停止条件。滚动上限在 `sizeLyricPad()` 缓存，每帧先完成 `scrollTop` 读回，再写波峰样式。色阶合并到 1%，透明度保留三位、缩放五位小数，只写改变的值。合成提示只给波峰附近最多十行，停止帧循环时释放。
- `ui/style.css` / `renderQueue()`：保留三根 SVG 原始描边，把缩放动画移到三个 HTML 外层，缩放轴仍在 viewBox 的 y=18.5。没有给长歌整首常驻 GPU 层。
- `tools/verify-ui.mjs`：新增 `--lyric-perf-only`，对照关闭/展开/重新关闭抽屉、长卡长句、窄卡队列。CDP 记录布局与样式计算，采样只读行内值，避免探针自己强迫布局；可用 `LYRIC_PERF_TRACE=1` 保存 timeline。
- 慢歌检查支持外部 `LYRIC_PERF_LRC`，仅测试时读取本地文件，歌词没有复制到 `ui/`、夹具源码或发布包。默认夹具使用原创文本与同样的 12.55→24.81 秒间距。
- `ui/_build.json`、孪生 HTML 由 `node tools/bump-build.mjs` 统一到 1003131699，两个 HTML 仍只差 body 的 `data-shell`。
- 文档：CHANGELOG 的「未发布」、PITFALLS、TODO、player-ui 索引。

## 原始证据与实际通过项

全部输出在 [playlist-perf-20261014/](playlist-perf-20261014/)。

| 检查 | 结果 | 原始文件 |
|---|---|---|
| 原代码歌词专项 | 75/75 | `baseline/verify-lyrics.log` |
| 原代码 + 新性能断言 | 4/5，展开抽屉连续更新失败 | `baseline/verify-perf.log` |
| 独立关闭播放指示的隔离实验 | 展开时 LayoutCount 从 115 降到 8 | `eq-isolation/verify-perf.log` |
| 原代码含长句 timeline | 5/6，展开连续更新失败；长卡 LayoutCount=115 | `long-baseline/verify-perf.log`、`trace-*.json` |
| 最终实现 timeline | 6/6，展开/长卡 LayoutCount 均为 8 | `final/verify-perf.log`、`trace-*.json` |
| 最终歌词、布局与表面动效专项 | **85/85**，runtimeErrors=0 | `lyrics/verify-lyrics.json` |
| 全量 UI（慢歌专项加入之前启动） | **394/394**，runtimeErrors=0 | `full/verify.json`、`full/verify-ui.log` |
| 指定歌曲本地 LRC + 实际媒体时钟专项 | **12/12**，runtimeErrors=0 | `slow-song/verify-lyric-perf.json`、`slow-lyric-curve.json` |
| 后端既有回归 | **132/132** | `verify-backend.log` |
| 语法、diff whitespace、HTML 孪生与构建号 | 通过 | `source-checks.json` |
| 官方打包与归档静态校验 | errors=0、warnings=1（既有动态依赖未证明提示） | `pack-local.log` |
| 官方 isolated UI smoke | **未通过环境前置**：没有独立 Electron runtime | `validate-smoke.json` |

首次直接校验仓库根失败，因为仓库目录名 `hanako-audio-player-simple` 与 manifest.id `hanako-simple-player` 不同。随后通过既有 `pack-release.mjs` 在正确命名的暂存目录校验归档，静态 errors=0。没有为绕开校验改 manifest。

无头采样为同一段 1.8 秒：旧版展开时 109 个浏览器帧只有 6 次歌词 scale 更新；新实现同段 109 个帧约 100–104 次更新。关闭时样式重算约 218–220 次降到约 129–132 次；展开与长卡的布局约 115 次降到约 8 次。Paint 耗时和 TaskDuration 随运行波动，**没有宣称总体 CPU 时间已按固定比例下降**。无头环境约 60Hz；这不是实际 Hana 合成器 FPS 证明。

指定慢歌 LRC 自验：21.50→23.76s，145 个采样点，138 次实际行中心移动；每步最大 **0.267 CSS px**，累计 26.34px，全部同向且包含亚像素步长。长句高 51px、行高 25.575px，确认是两行。该几何探针本身读取 DOM，只用于验证连续位置，不用于性能比较。截图 `slow-song/slow-bilingual-1040x780.png`。

## 回归断言

- P01 `lyrics-visible-behind-drawer-keeps-frames`：替换原来的 `lyrics-covered-by-drawer-stops-frames`。这是纠正「部分可见的歌词应该暂停」的错误要求，不是放宽失败门槛。
- P02–P04 `lyrics-perf-{closed,opened,reclosed}-updates-each-frame`：同段媒体、三个开关阶段持续更新；新断言在原代码上确实红。
- P05 `lyrics-drawer-preserves-reading-geometry`：歌词列没有为抽屉缩窄。
- P06 `lyrics-drawer-has-no-per-frame-layout`；P07 `lyrics-long-card-has-no-per-frame-layout`：布局次数少于浏览器采样帧的四分之一。
- P08 `lyrics-long-wrapped-line-updates-each-frame`：长卡多行长句持续更新。
- P09 `lyrics-compositor-hints-are-bounded-and-release-on-pause`：临时提示最多十行、暂停全释放。
- P10 `queue-equalizer-retains-three-svg-strokes-without-path-animation`：三根线仍存在、path 不承载缩放。
- P11 `lyrics-compact-queue-replaces-scene-and-stops-frames`：整面替换仍暂停。
- P12–P13 `lyrics-slow-bilingual-long-line-is-wrapped` / `lyrics-slow-bilingual-line-moves-at-subpixel-steps`：慢歌两行与实际中心连续性。

## 独立复跑与部署验收

```sh
OUT_DIR=/tmp/hana-playlist-perf-accept node tools/verify-ui.mjs --lyric-perf-only
OUT_DIR=/tmp/hana-playlist-lyrics-accept node tools/verify-ui.mjs --lyrics-only
OUT_DIR=/tmp/hana-playlist-full-accept node tools/verify-ui.mjs
node tools/verify-backend.mjs
LYRIC_PERF_LRC=/Users/can/.hanako/app-data/hanako-simple-player/lyrics/決意の唄.lrc OUT_DIR=/tmp/hana-playlist-song-accept node tools/verify-ui.mjs --lyric-perf-only
```

Hana 已在新会话「歌词滚动卡顿优化」收到进度；用户让停止初始宿主探查，因此没有 `PLAYLIST-PERF-HOST-PROBE.md`。请最终交接后接手：

1. 独立复跑，**整包同步 `ui/`（包括 style.css）** 到既有本地安装；随后 `extension_manager reload app:hanako-simple-player`。构建号必须为 1003131699，同时按 `source-checks.json` 比较文件 SHA-256。此前仓库在途源码与安装不同，比较旧构建号没有意义。
2. 独立窗 1040×780：播放《決意の唄》，看 21–25 秒长句及其他长句；开/关歌单保持连续波浪、跟随、高亮归属；涟漪仍响应。
3. 长卡常驻队列：长句连续移动、播放指示保留外观；窄卡队列与搜索整面遮盖时停止不可见歌词动画。
4. 复验点歌词跳句动画、滚轮 3 秒回位、暂停恢复、减少动态偏好。观察慢歌是否仍有低帧率观感；如有，记录宿主/尺寸/时间段、证据及可测边界，再交 Codex 返修。
5. 报告写到 `PLAYLIST-PERF-ACCEPT-1003131699.md`。本轮不发布 Release、不更新市场 PR、不改生产歌单和权限。

本地校验包仅保存在 `/tmp/hana-player-perf-package/`，不是待发布版本；官方 smoke 的补救是配置开发用独立 Electron runtime，不能拿 Hana 桌面主程序冒充脚本运行器。

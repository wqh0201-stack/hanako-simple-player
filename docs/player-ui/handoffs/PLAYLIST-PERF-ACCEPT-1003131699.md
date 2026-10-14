# 歌单展开与慢歌长句性能 · Hana 独立验收

2026-10-14。构建 **1003131699**，版本 1.1.5。本轮不发版、不改源码、不碰生产歌单与权限。
被验收对象：[PLAYLIST-PERF-DONE.md](PLAYLIST-PERF-DONE.md)（Codex 交接）。
复跑环境：本机 HanaAgent 生产宿主（PID 21935，端口 27958，v1.1.0-beta）+ 无头 Chrome（puppeteer-core 驱动系统 Google Chrome）。

---

## 0. 结论速览

| 项 | 结果 | 证据 |
|---|---|---|
| 文件哈希（仓库 vs 安装 vs 交接 source-checks） | **三处一致** | §1 |
| 整包同步 `ui/`（含 style.css）+ reload | **已完成**，宿主 serving `1003131699` | §1 |
| 真机手感（用户实测） | **流畅了很多**；歌单呼出也不卡 | §2 |
| 歌词性能专项 | **12/12**，runtimeErrors=0 | §3 |
| 指定慢歌《決意の唄》本地 LRC + 真媒体时钟 | **12/12**，`externalLrc: true` | §4 |
| 歌词/布局/表面动效专项 | **87/87**，runtimeErrors=0 | §3 |
| 后端既有回归 | **132/132** | §3 |
| 全量 UI 验收 | **396/396**，failed=[]，exit 0 | §3 |

**一句话**：两处根因在真机上都对上了，手感结论由用户本人给出；无头侧全绿（12/12 + 87/87 + 132/132 + 396/396），本轮没有待验的红项。

---

## 1. 同步与哈希核对

Codex 交接特别提醒「比较旧构建号没有意义」，故按 SHA-256 对齐。仓库产物：

```
77b069f9bba95e2c54e3f3ccce65c9ab5ed4bbb94e6d052088dcd13d14a153a1  ui/app.js
23cbdc90b86d2868534d4fec695b78ca2376be0ad9d4abdf3f99d081d3400428  ui/style.css
a05de2c8ae8792f4ff4a2088885c7af107e4299f162d3da32ccf586df4299537  ui/index.html
842291997a2e3c13a88cb7ddf83318ab2fe7b3c879185b5fc416a9ed7d6a4dfa  ui/standalone.html
ee211a686ad8098f2d921465292249bfbf4529e43cfb2a2b3ce6050d82e0722e  ui/_build.json
```

与 `playlist-perf-20261014/source-checks.json` 的 `sha256` **逐项相同**；`twins: true`、`htmlBuilds` 两个 `1003131699`。

动作：`rsync -a --delete ui/ → ~/.hanako/apps/hanako-simple-player/ui/`（排除 `sdk.js.bak*`），目标目录哈希与仓库**完全一致**（上，五条一致）。随后 `extension_manager reload app:hanako-simple-player` → `Reloaded app:hanako-simple-player from its current on-disk code`。

生效确认（HTTP 直读宿主 serving 的页面）：

```
GET /api/apps/hanako-simple-player/ui/index.html → __HANA_BUILD = "1003131699"
```

> ⚠️ 一个值得记的坑：上一轮里仓库与安装目录的 `app.js` **不同**，两边 `_build.json` 却同为 `1003131698`。构建号不能作为同步凭据，本轮已用哈希闭环。

## 2. 真机观测（独立窗）

- 卡实例 `wb-card-plugin-webview-card-mv7xynue-8`，`surface:detached`（独立窗），`runtimeStatus: mounted`、`domStatus: ready`、`actionsStatus: ready`。同步后无需重建实例即拿到新代码。
- DOM 里出现新类 **`is-flowing`**（`lyric-line is-flowing is-current` / `is-near`），对应交接里「合成提示只给波峰附近最多十行」。这不是探针注入，是页面真实状态，说明 P09 的临时提示机制在真机上确实生效。
- 观测到播放中的曲目带中日合并歌词（长句换行），与验收要点 2 的场景一致。
- **用户本人实测结论**：「可以 流畅了很多」「呼出播放列表也不卡了」。这是本轮手感验收的主证据，级别高于任何无头采样。

## 3. 无头独立复跑

命令与 Codex 交接一致，OUT_DIR 换成我自己的目录：

```sh
OUT_DIR=/tmp/hana-playlist-perf-accept node tools/verify-ui.mjs --lyric-perf-only
OUT_DIR=/tmp/hana-playlist-lyrics-accept node tools/verify-ui.mjs --lyrics-only
node tools/verify-backend.mjs
LYRIC_PERF_LRC=~/.hanako/app-data/hanako-simple-player/lyrics/決意の唄.lrc \
  OUT_DIR=/tmp/hana-playlist-song-accept node tools/verify-ui.mjs --lyric-perf-only
```

| 检查 | 结果 | 原始输出 |
|---|---|---|
| 歌词性能专项 | **12/12**，failed=[] | `/tmp/hana-playlist-perf-accept/verify-lyric-perf.json` |
| 歌词/布局/表面动效专项 | **87/87**，runtimeErrors=[] | `/tmp/hana-playlist-lyrics-accept/verify-lyrics.json` |
| 后端回归 | **132/132**，failed=[] | `/tmp/hana-accept-backend.log` |
| 全量 UI | **396/396**，failed=[]，runtimeErrors=[]，exit 0 | `/tmp/hana-playlist-full-accept/verify.json`、`/tmp/hana-accept-full.log` |
| 慢歌（外部 LRC） | **12/12**，runtimeErrors=[] | `/tmp/hana-playlist-song-accept/verify-lyric-perf.json` |

12 条断言逐条 PASS：

```
lyrics-perf-closed-updates-each-frame
lyrics-perf-opened-updates-each-frame
lyrics-perf-reclosed-updates-each-frame
lyrics-drawer-preserves-reading-geometry
lyrics-drawer-has-no-per-frame-layout
lyrics-long-wrapped-line-updates-each-frame
lyrics-long-card-has-no-per-frame-layout
lyrics-compositor-hints-are-bounded-and-release-on-pause
queue-equalizer-retains-three-svg-strokes-without-path-animation
lyrics-compact-queue-replaces-scene-and-stops-frames
lyrics-slow-bilingual-long-line-is-wrapped
lyrics-slow-bilingual-line-moves-at-subpixel-steps
```

CDP renderer metrics（我这次跑出来的数，非交接抄录）：

| 阶段 | frames | changed | movingRatio | medianFrameMs | LayoutCount | RecalcStyleCount |
|---|---|---|---|---|---|---|
| closed | 109 | 102 | 0.944 | 16.70 | **8** | 132 |
| opened | 109 | 103 | 0.954 | 16.70 | **8** | 219 |
| reclosed | 109 | 101 | 0.935 | 16.70 | **8** | 131 |
| long（长卡） | 109 | 101 | 0.935 | 16.70 | **8** | 218 |
| compact（队列页） | — | — | — | — | — | raf=**false** |

复现了交接的两个关键数：布局从约 115 降到 **8**；展开抽屉时歌词**持续更新**（109 帧里 103 帧有变化），不再是旧版的 6 次。窄卡队列整面替换时 rAF 仍停（`raf: false`），符合 P11。

## 4. 指定慢歌《決意の唄》

`LYRIC_PERF_LRC` 指向 `~/.hanako/app-data/hanako-simple-player/lyrics/決意の唄.lrc`（2054 字节，10-10 落盘），回包确认 **`externalLrc: true`** —— 确实读了真文件，不是默认夹具。

```
frames 145 · moving 137 · maxStepPx 0.2477 · travelPx 26.099
firstMedia 21.5s · lastMedia 23.7365s
```

每步最大 **0.248 CSS px**，21.5→23.74 秒累计 26.10px，亚像素连续。与交接的 21.50→23.76s / 0.267px / 26.34px 同量级（浮点与采样抖动），**独立复现**。

## 5. 其他复验点

- 涟漪：真机 DOM 里 `rippleCanvas` 在，涟漪工具箱滑杆（低音门槛 0.0137 / 浓淡 80%）可读，未见异常。
- 歌词结构：中日合并长句在 1040×780 与长卡下均为两行，未见单行溢出。
- 未做：暂停/恢复、滚轮 3 秒回位、减少动态偏好、点词跳句的**真机逐项手测**（本轮以用户手感 + 无头断言为准，这几项在 87/87 的歌词专项里覆盖）。

## 6. 未完成 / 边界（请勿当成已通过）

1. **官方 UI smoke 未跑**（环境前置缺独立 Electron runtime），与 Codex 交接一致，非本轮新增缺陷。
2. **无头 ≠ 真机合成器 FPS。** 无头约 60Hz、合成静音媒体；`medianFrameMs 16.7` 只能说明浏览器 rAF 节拍没被拖慢，**不能**直接等同宿主合成器帧率。真机手感结论来自用户本人。
3. **长卡与窄卡本轮没在真机上单独造形态**。真机只有独立窗一个实例（`surface:detached`）；长卡/窄卡只走了无头断言（P07/P08/P11 PASS）。
4. 生产歌单、`app-data`、`ui/` 之外的文件未改动；未 bump 版本、未封包、未发 Release、未动市场 PR。

> 补记：全量 UI 一度在 10 分钟窗口内没跑完，先按「待验」写进报告；后台任务 `terminal:term_mv85c6vb_3863bd7f` 随后 exit 0，取回 **396/396 / failed=[]**，§0 与 §3 已更新为通过。Codex 自报 394/394 与我实测 396/396 的差，是它那次跑在慢歌专项加入之前启动，不是失败项差异。

## 7. 判断

**验收通过。** 手感项由用户本人实测确认；无头侧四组全部独立复现（12/12 + 87/87 + 132/132 + 396/396），无失败项。剩余边界见 §6，均为环境限制而非缺陷。

两处根因的修法都对得上症状：抽屉打开时歌词不再被 `!state.drawer` 掐掉 rAF（这是「歌单呼出就卡」的直接原因），SVG path 上的缩放动画移出后布局降到 8（这是长卡常驻队列也拖的原因）。慢歌长句的亚像素移动本来就是设计内的连续插值，这次只是让它每帧真的更新了。

下一个 bug 可以接着排，本轮不留未修的回归。

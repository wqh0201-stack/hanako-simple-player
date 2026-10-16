# 歌词真实背景对比度阻塞 / 跨组断言返修 · 1003131756

> 后续已裁决：罐头指定统一深色描边，不再要求单fill配所有底；竖卡深底保留3.0取舍。见[1758实现与新验收](LYRIC-UNIFORM-STROKE-1003131758.md)。以下保留当时调查与旧判据失败证据。

2026-10-16，DeepMind 原任务链路的调查交接。**高亮运行时修复尚未完成，不能部署或宣称验收通过。** 本轮只改测试与文档，生产代码仍为 build `1003131756`，没有 bump、部署或 reload。

## 结论与需要裁决的边界

原 `refreshLyricAccent()` 用封面代表色叠一层 veil 解算，不等于横条真正合成的 quiet / played / 前沿背景，也不覆盖竖卡封面空间分布。真实截图已证伪旧的「4.5:1 达标」推论。

同时，**现有背景不变 + 横条/竖卡完全同一 RGB + 所有背景 ≥4.5:1，无解**；即使取消色相与饱和度约束也无解。需要统筹放开一个边界：

- 建议：保留同一撞色色相来源，按表面分别解明度；仍需逐个验证各表面自身有解，不能预先承诺任意封面都能靠拆明度通过。
- 若必须保持同一 RGB：需要允许调整歌词所在区域的底纱，使背景亮度范围可解。此举会改变视觉，未擅自实施。

不降低 4.5 门槛，不改星光配方、动线、字号、控件强调色，不以旧单背景单测代替新验收。

## 独立实测方式

新增 `tools/measure-lyric-surfaces.mjs`，由 `verify-strip-lyrics.mjs` 调用：

1. 先读取真实元素 computed 字色，再暂时隐藏文字及文字阴影，保留所有真实背景层。
2. 等待布局运动结束且常驻 `layoutBackdropGhost.hidden`，不是等待这个容器从 DOM 消失。
3. 暂停后设置真实 CSS 进度为 0 / 50 / 100%，分别截图；这些是渲染端点夹具，不冒充自然播放。
4. Chromium 原生 Image / Canvas 解码 PNG，在歌词槽逐 CSS x 像素扫描 5 个 y；横条720×128每场1580点，竖卡465×930为1295点。
5. 用独立 WCAG 亮度计算比值，未复用生产背景推导。新增四条 `SL-measured-contrast-*` 断言，均要求 ≥4.5。

`cases[].background` 是纯函数单测的独立输入；它们不同本身不是缺陷证据。真正的证据是下面实际渲染像素与旧假设不符。

**尺寸口径修正**：最初1040×780宽窗取样曾命名为vertical，不足以替代竖卡；已改为465×930并重新顺序运行三次。本文主数据只使用这后三次。旧宽窗结果仅留作额外证据。

## 第一轮竖卡专项实测值

来源：`/tmp/hap-contrast-portrait-evidence-1/strip-lyrics/measured-surfaces.json`。四场实际字色均为 `[132,192,235]`；PNG尺寸另经文件头独立核对。

| 表面 | 最低对比度 | 该处背景 RGB | 坐标 |
|---|---:|---|---|
| 横条 0%，全未播 | 1.4726:1 | `[231,222,211]` | 256,64 |
| 横条 50%，含已播/未播/交界 | 1.1180:1 | `[219,191,162]` | 335,85 |
| 横条 100%，全已播 | 1.0004:1 | `[214,179,145]` | 450,85 |
| 竖卡465×930 | 3.8150:1 | `[104,80,64]` | 187,318 |

交界扫描也抓到 `[242,241,241]` 的亮前沿；不能只采六个基础色或一张平均底色。

### 同一 RGB 无解的证明

取同次截图中的两个槽内点即可，不需要穷举颜色：

- 未播区 `(414,64)`：`[235,222,209]`，相对亮度 `0.7450816914`。4.5:1 要求前景亮度 **≤0.1266848203**；另一侧的解大于 1，不可用。
- 竖卡 `(187,318)`：`[104,80,64]`，相对亮度 `0.0905054317`。4.5:1 要求前景亮度 **≥0.5822744428**；另一侧的解小于 0，不可用。

依据 `CR=(max(Lfg,Lbg)+0.05)/(min(Lfg,Lbg)+0.05)`，两个可行区间没有交集。全部采样点的亮度可行区间求交同样为空，见 `/tmp/hap-contrast-portrait-feasibility.json`；这不是「还没找到足够撞色的 RGB」。

## 跨组断言返修

`SL-timeupdate-skipping-groups-does-not-queue` 旧断言把事件历史中的合法自然显示 `跳跃起点` 当成补播。现改为检查被跨过组的真实事件对象：旧层、星尘、旧层动画、当前句淡入都应为空。

为避免 8× 下 20ms 媒体夹具与 rAF 相位竞态，先暂停并 seek 到 23.85，等 `seeked` / `窄幅歌词` 后，在真实 `playing` 回调内有界阻塞 JS 80ms。真实媒体继续播放，下一次真实 rAF/timeupdate 的索引从 18 跳到 21；恢复 1× 后再等 50ms，排除迟到补播。没有手动调用歌词转场。

注意 `audio.currentTime` 在同一 JS task 内可能不变，不能据此判定媒体没走；阻塞时长用 `performance.now()`，跨组媒体时间取下一次真实事件。

## 实际验证结果

最终相同代码三次顺序运行：

```sh
OUT_DIR=/tmp/hap-contrast-portrait-evidence-1 node tools/verify-ui.mjs --strip-lyrics-only
OUT_DIR=/tmp/hap-contrast-portrait-evidence-2 node tools/verify-ui.mjs --strip-lyrics-only
OUT_DIR=/tmp/hap-contrast-portrait-evidence-3 node tools/verify-ui.mjs --strip-lyrics-only
OUT_DIR=/tmp/hap-contrast-interaction node tools/verify-ui.mjs --interaction-only
```

- 歌词每次都是 **35/39，退出码 1**。旧35项三次均通过，包括返修跨组检查；仅新增四条真实像素对比检查失败。**不是39项全绿，也不能称高亮已修复。**
- 三次跨组目标媒体时间分别为23.978008 / 23.935680 / 23.987664；索引均18→21，覆盖层 / 星尘 / 当前句淡入为空。
- 三次 `runtimeErrors: []`；交互 **27/27**，`runtimeErrors: []`。
- 两个测试文件 `node --check` 通过，`git diff --check` 通过。
- 构建号三处一致、孪生HTML一致；对照 `/tmp/hap-skip-predicate-baseline.json` 的SHA256，运行时代码与保护文件未变，保留工作树其他在途修改。
- 尚未新增专用亮封面fixture、未实现运行时真实复合背景解算、未bump；这些在方案裁决后继续。当前普通夹具已经稳定反证旧算法。

## 文件与证据

本轮：`tools/verify-strip-lyrics.mjs`、`tools/measure-lyric-surfaces.mjs`、本交接、前端索引、历史配色结论路标及知识库笔记。

主证据：`/tmp/hap-contrast-portrait-evidence-{1,2,3}/verify-strip-lyrics.json`；各自 `strip-lyrics/measured-surfaces.json` 含逐像素记录。第一轮 `strip-{0,50,100}-background.png` / `vertical-background.png` 对应上表。

汇总：`/tmp/hap-contrast-portrait-stability-summary.json`、`/tmp/hap-contrast-portrait-feasibility.json`；交互：`/tmp/hap-contrast-interaction/verify-player-interaction.json`。

交付证据包：`/Volumes/SSD/hanadesk/OH-媒体库/播放器验收/歌词真实背景阻塞-1003131756-20261016-portrait.zip`，含三次主报告、逐像素记录、截图、日志、当前测试源码与SHA256清单。旧1040×780宽窗数据在包内明确另列，不用其结果代替竖卡。

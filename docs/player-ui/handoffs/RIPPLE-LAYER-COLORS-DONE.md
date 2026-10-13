# 涟漪三层配色 · 生产落地交接

日期：2026-10-12。构建号 **1003131658**，版本 **1.0.2**。
文件：`ui/app.js`、`ui/style.css`、`tools/verify-ui.mjs`。**形态与检测层未动。**

## 一、动机（罐头）

「不要跟歌词的颜色混起来，要弱一档，偏一下色相吧。」+「不会被背景吃掉。」

生产的涟漪三层（bass 光波 / 鼓点 / 镲片）此前**全吃同一个色** `--hl-accent`（歌词当前句高亮色），
所以三层只有形态差别、没有颜色差别；且 `--hl-accent` 是「背景主色的撞色」，
在**中调封面**上自身对比就可能低到 1.0（实测 MID-slate `#55606a` → 1.01），三层跟着一起隐形。

## 二、方案（已算过，非凭感觉）

以歌词色（`accentFrom` 的输出）为**同一派生源**，逐层：

1. **偏色相**（不与歌词混）：bass −30°、kick +16°、mid +34°、hat +60°。
2. **弱一档**：饱和度 × 0.78 / 0.84 / 0.86 / 0.90。
3. **不被背景吃掉**：明度从设计基线出发（深底 0.60/0.62、浅底 0.42/0.44），
   `solveByContrast()` 向两端扩散取第一个达到 **对比 ≥ 2.2** 的明度。

**为什么不能只固定明度**：背景是封面主色，可为任意明度；中调背景上固定明度必撞车。
实测（Python 模型 + JS 实现双向对齐）：固定明度方案在 5000 随机封面上最弱对比只有 ~1.0，
本方案 **全场景最弱 2.2**（真实封面集 + 5000 随机压测）。

派生常数（`ui/app.js` 顶部）：

```js
RIPPLE_HUE_OFF  = { bass:-30, kick:16, mid:34, hat:60 }
RIPPLE_SAT_MUL  = { bass:0.78, kick:0.84, mid:0.86, hat:0.90 }
RIPPLE_LIGHT_BASE / RIPPLE_DARK_BASE = 深/浅底明度基线
RIPPLE_MIN_CONTRAST = 2.2
```

## 三、接线

- `applyAmbient()`：取到封面主色时，除写 `--ambient-color/--ambient-accent` 外，
  再写 `--rl-bass/--rl-kick/--rl-mid/--rl-hat`（`ripplePalette()` 产出），
  并调 `rippleHandle.refreshPalette()` 让 canvas 重读；取色失败时移除这四个变量。
- `ui/style.css`：`:root` 给四个 `--rl-*` 兜底值（无封面时用 `--hk-accent` 混 `--hk-surface`，只做明度/饱和差，不强行变相）。
- `draw()`：`readRippleRGB()` 把四色读进缓存；`strokeOf(kind)` 各环吃各色；
  `paintField` 的 bass 光波吃 `rippleRGB.bass`；指针波/尾流仍用 `--hl-accent`。
- **性能**：`readRippleRGB()` **只在 `sync()` 调一次**（主题/封面变化才变），
  不放进 `draw()` 每帧——否则每帧 4 次 `getComputedStyle` 会拖慢 rAF。

## 四、验收

- `node tools/verify-ui.mjs`：**276/276**（原 272 + 新增 4），零运行时错误。
- `node tools/verify-backend.mjs`：**30/30**。
- 新增断言：
  1. `ripple-layer-colors-distinct` —— 四层色两两不同（同色 = 没分层）
  2. `ripple-layer-color-vars-wired` —— CSS 变量与运行时取色一致（接线没错位）
  3. `ripple-layer-hue-offset-from-lyric` —— 四层色相都从歌词色错开（纯函数验派生数学）
  4. `ripple-layer-colors-survive-background` —— 任何封面主色下四层对比 ≥ 2.0
- 新增只读钩子：`rippleState().colors`、`__playerDebug.ripplePalette / rippleAccentFrom / contrastOf / rippleColorConfig`。

## 五、踩过的坑

1. **别用每帧 `getComputedStyle` 取色** —— 颜色只在主题/封面变化时变，放 `sync()` 一次即可。
2. **`applyAmbient` 改的是 `player.style`，涟漪的 sync 不观察 style** —— 必须显式 `refreshPalette()`。
3. 曾有一条 `ripple-continuous-bass-field-bounded` 假挂（比值 1.81 > 1.6），
   是文档记载的已知 flaky（受负载影响的周期性松弛振荡），复跑即过；与本轮改动无关
   （注入链 `driveBass`/`inject`/`stepField` 未动）。

## 六、第二轮修复（2026-10-12，罐头真机反馈「基本看不到 bass、鼓点也很不明显」）

### 根因：三个叠加，其中一个是我上一版引入的真 bug

1. **bass 光波亮度公式在小场能量下几乎为零（真 bug）。**
   实测：持续低频时 canvas 上 `maxAlpha` 只有 **9/255（3.5%）**，肉眼等于透明。
   原因：`driveBass` 把场能量封顶在 0.0009（防无限堆积），单格梯度极小；
   `paintField` 的乘子 `edge*0.22 + slope*0.06` 算出来就是零点几。
   **修**：加 `BASS_GLOW` 亮度补偿。
2. **光波亮度与网格宽度成反比。** 实测峰值：窄卡(cols≈97)=103、长卡(117)=89、
   宽窗(217)=**19**（几乎看不见）。因为梯度按 1/cols 分摊。
   **修**：`BASS_GLOW` 乘以 `cols/110` 归一化，宽窗自动补足。
3. **三层色彩对比太低。** 上一版把下限设 2.2，对细线远远不够；
   在罐头的青蓝封面上旧版（三层共色）对比是 3.19，派生后反而只剩 2.2。
   **修**：下限提到 **4.0**，饱和度降幅收窄（0.78→0.86，不再糊成灰）。
4. **无封面时四层混成一坨灰。** CSS 兑底用 `color-mix(--hk-accent, --hk-surface)`，
   四层只差明度 → 实测都是低饱和灰蓝。
   **修**：无封面也走 `ripplePalette`（背景取 `--hk-bg`），四层色相分开。

### 修后实测（时间峰值，单帧不可信）

| 形态 | bass 光波 peakAlpha |
|---|---|
| 窄卡·有词 | 155 |
| 长卡·有词 | 111 |
| 宽窗·有词 | 55 |
| 窄卡·无词 | 183 |

### 断言（新增 1 条，改 1 条）

- 新增 `ripple-bass-glow-actually-visible`：喂持续低频后 canvas 要有足够亮的像素。
  ⚠ 必须**采多帧取峰值** —— 高度场是周期性松弛振荡，单帧会撞谷底（实测同配置差 30 倍）。
- 改 `ripple-layer-colors-survive-background` 阈值 2.0 → 3.8。

### 玩具箱

接线完好（6 滑杆 + 重置 + 存储），未动。罐头存盘参数（visualGain 2.75 / midHighSens 2.9 /
maxAudioWaves 6 / onsetCooldown 200）实测能生效。「鼓点/镲片不明显」主要是**环数量少**
（默认 3 组 / 380ms），靠玩具箱的「同屏波数上限」「落波间隔」调。

## 七、第三轮：bass 光波只出现在歌词遮罩区（2026-10-12，罐头一句点破）

罐头：「你这明显就是 bass 的波纹只在歌词遮罩区域限制了。」

**根因（HEAD 里就有的老 bug，不是这两轮引入的）**：`computeAttMask()` 里

```js
attMask = new Float32Array(cols * rows);   // ← 默认全 0
...
if (wx <= 0) continue;                       // ← 歌词区外的格子：跳过，保持 0
attMask[j*cols+i] = 1 - wx*wy*(1-MIN_W);
```

它**只给歌词遮罩区（及羽化带）的格子赋值**，区外格子留在初始 **0**；
而 `paintField` 里 `var att = attMask ? attMask[i] : 1` → **封面区 att=0 → 光波被整片抹掉**。
所以 bass 光波只在歌词遮罩范围内出现。

以前没暴露，是因为光波本来就淡到看不见；上一轮把光波调亮后，被抹掉的部分反而刺眼。

**修**：`attMask.fill(1)` —— 默认全强度，只在歌词区降到三成。

**验证的弯路（记下以免重蹈）**：找这个 bug 时先怀疑层序（实测 canvas 画纯色块能盖住封面 → 层序没错）、
再怀疑网格宽度（改半径、改亮度补偿，来回好几轮），都不是。
真正的判据是**量封面带（x<0.28）的 alpha**：去掉 `fill(1)` 后有词时封面带恒为 0。
断言写成源码级守卫 `ripple-attmask-defaults-to-full-strength`（无可词夹具时功能上难复现）。

顺带清理：`driveBass` 半径恢复原值（早先改大是为了治「铺不开」，其实是掩膜 bug 的假象）；
`paintField` 去掉按网格宽度的亮度补偿（格距恒为 4.8px，尺度不变）。

## 八、未做

- **未接实验台那套检测层修复**（瞬态比 + 绝对能量 + 后屏蔽）。生产形态分层本来就在
  （bass 走 `driveBass` 推光波、low/mid/high 落环），本轮只解决颜色。若罐头真机听感
  仍觉 bass/kick 区分不足，再考虑把 `docs/player-ui/RIPPLE-LAYER-SEPARATION-FIX.md` 的检测层移植过来。
- 真机观感待罐头确认（三层颜色在真实封面下的冷暖、与歌词高亮的区分度）。

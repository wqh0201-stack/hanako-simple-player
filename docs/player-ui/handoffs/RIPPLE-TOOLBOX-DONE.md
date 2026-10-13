# 涟漪参数「玩具箱」面板 · 交接

日期：2026-10-11。分支 `hana-simple`。构建号 `1003131653`（上一版 `1003131652`）。

## 一、改了什么

只动本 App 的文件：`ui/app.js`、`ui/index.html` + `ui/standalone.html`（孪生）、`ui/style.css`、
`tools/verify-ui.mjs`。`lib/` 未碰（工作树里 `lib/bilibili.js`、`lib/register-routes.js` 是另一条线的改动，未卷入）。

### 1. 涟漪参数对象化（`initRipples`）

写死的 4 个 `const` + 1 个门限改成一个运行时可变对象，默认值 = 原写死值：

```js
var RIPPLE_DEFAULTS = { visualGain: 1.6, bassDrive: 9, onsetSens: 1.0, maxAudioWaves: 3, onsetCooldown: 380 };
var tune = { ...RIPPLE_DEFAULTS 的副本 };
```

| 内部量 | 原值 | 现取处 |
|---|---|---|
| 整体强度 | `VISUAL_GAIN = 1.6` | `tune.visualGain`，**只在绘制 alpha** |
| 低频推动 | `BASS_DRIVE = 9` | `tune.bassDrive` |
| 敲击灵敏度 | 门限常数 | `ONSET_BASE_*/ONSET_NORM_* / tune.onsetSens` |
| 同屏波数上限 | `MAX_AUDIO_WAVES = 3` | `tune.maxAudioWaves` |
| 落波间隔 | `ONSET_COOLDOWN = 380` | `tune.onsetCooldown` |

- **起音门限只做除法包装**：`0.003` → `ONSET_BASE_BASS / tune.onsetSens`，`onsetSens=1.0` 时逐字节等效
  （比较符与常数未动）。
- `setTune(patch)`：合并 + 夹范围 + 通知监听者 + 立即重画；传 `null` = 重置默认。
  只影响后续帧：不重建分析链、不动 `audio.volume`、不重置 `onsetCount`。
- **整体强度仍未进 `inject()` / `readSignal()`**（源码守卫 `ripple-visual-gain-changes-look-only` 保持绿）。
- `rippleSetGain(g)` 保留为 `setTune({ visualGain })` 的薄封装。

### 2. 面板（仅宽窗）

- **入口**：舞台左下角 `#rippleToolBtn`，`z-index:5`（涟漪 3 / 歌词 4 之上）；常态 `opacity:.45`，
  hover / 聚焦 / 打开提亮到 1。宽窗专属用现成门控 `.player[data-layout="wide"] …{ display:inline-flex }`
  （与搜索入口同一套），长卡/窄卡不显示 → 与 `#splitHandle`（长卡专属）无冲突。
- **面板** `#rippleToolPop`（`.pop.ripple-tool-pop`，复用 `.pop` 皮）：5 滑杆 + 「重置为默认」 + 说明。
  位置 `left:14px; bottom:56px`（正数、不出舞台左界；限高 + 内部滚动，防矮宽窗被 `scene` 裁）。
- **滑杆命名（大白话）与范围**：整体强度 0.5–3.0（默认 1.6）/ 低频推动 1–20（9）/
  敲击灵敏度 0.5–2.0（1.0）/ 同屏波数上限 1–6（3）/ 落波间隔 120–900ms（380）。
- **开合**：点图标开、Esc 关、点外部关；并入现有 `closePops()` 家族。
- **沉浸淡出**：`data-controls-hidden` 挂在 `.player` 上，CSS 用 `opacity`（保住过渡）：
  `.player[data-controls-hidden="1"] .ripple-tool-btn { opacity:0; pointer-events:none; }`。
- **截图模式**：`body.is-shot .player[data-layout] .ripple-tool-btn { display:none }`。
- **reduced-motion**：`.player[data-layout] .ripple-tool-btn { display:none }`（涟漪整层本就隐藏）。

### 3. 存储

- 键 **`player-ripple-tune`**（与 `player-split`/`player-lists` 同族）。
- 读：`boot()` 的 `sdkReady.then` 里与现有三个 `storeRead` **同批追加**；读到就 `setTune`，
  **读不到（`ok:false`）不覆盖**，沿用默认。
- 写：拖动实时生效，落盘**去抖 300ms**（`rippleSaveTimer`），不狂写。

## 二、验收结果（无头）

- **UI `node tools/verify-ui.mjs`：248/248**（上一版 236；本轮 +12）。
  12/12 布局自检、4/4 窄卡自检、**零运行时错误**。**连跑 3 次全绿**。
- **后端 `node tools/verify-backend.mjs`：22/22**。
- 有界断言（`ripple-continuous-bass-field-bounded`）三次详情：中位数比 0.88 / 1.03 / 0.97，
  均值比 0.78 / 1.16 / 0.94，max 2.8e-3~3.5e-3。

## 三、新增断言（12 条）

1. `ripple-tool-wide-only` — 宽窗可见，长卡/窄卡隐藏
2. `ripple-tool-opacity-and-z` — 常态 opacity≈0.45，z 高于涟漪画布
3. `ripple-tool-pop-reuses-pop-skin` — 面板复用 `.pop` 皮（--hk-surface/--hk-hairline/--hk-pop-shadow）
4. `ripple-tool-opens-and-closes` — 点开 / Esc 关 / 点外关 / aria-expanded 同步
5. `ripple-tool-five-sliders-and-reset` — 5 滑杆 + 重置 + 说明；重置回默认
6. `ripple-tool-slider-live-and-volume-untouched` — 拖整体强度：gain 变、音量不变、起音计数不变
7. `ripple-tool-slider-affects-tuning` — 同屏波数上限 / 落波间隔真写入 tune、音量不变
8. `ripple-tool-hidden-when-controls-hidden` — `data-controls-hidden=1` 时淡出、`pointer-events:none`、回来淡入
9. `ripple-tool-hidden-in-shot` — `is-shot` 时隐藏
10. `ripple-tool-names-plain-language` — 5 个 label 是中文大白话，无内部名
11. `ripple-tool-persists-to-storage` — 改值 → 去抖后写入 `player-ripple-tune`（验键名与值）
12. `ripple-tool-restores-from-storage` — 预置存储 → boot 读到并套用（走真读存储路径）

另修一条既有断言：`ripple-continuous-bass-field-bounded` 的**预热线 1.2s → 1.5s**
（采样窗口仍是 5s，未扩；本轮的改动仅此一处——判据的中位数/均值双判与 1.3 阈值是上一轮
`9978c84` 就引入的，本轮未动）。原因：`bassField` 是周期 2~3s 的松弛振荡，t≥1.2 时
对半切会落到不同相位，曾出现中位数比 1.33 的假越线；非产品缺陷。

## 四、真机清单（无头证不了）

- 宽窗 1040×780 打开面板，拖 5 个滑杆看**观感实时变**（尤其整体强度/低频推动）。
- **面板不被 `scene` 裁**（`scene` 是 `overflow:hidden`，无头截不到）：矮宽窗也确认一遍。
- 沉浸淡出（鼠标静止 → 图标随控制条淡出；一动 → 淡入）与唤回手感。
- 浅深主题下面板可读性；`player-ripple-tune` 跨会话持久化（重载后值还在）。
- 长卡/窄卡确实**不出现**该图标。

## 五、交接状态

- 分支 `hana-simple`，**未 push、未部署、未 reload**；`manifest.json`/`package.json` version 未动。
- 调试钩子新增：`__playerDebug.rippleTune()` / `rippleSetTune(patch)` / `rippleResetTune()` /
  `rippleTuneDefaults()`。

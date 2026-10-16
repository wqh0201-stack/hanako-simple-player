# 横条歌词「字形溶解」退场 + 三处返修 · build 1003131766

2026-10-16。DeepMind 派发的实施任务与随后的三处返修。**本地完成、自验通过；未部署、未 reload。**
基线：`1003131758`（工作树多轮未提交改动全部保留，只改横条歌词退场与星尘那一段）。

## 一、这一版做了什么

把横条旧句退场从「整句横向擦除 + 少量 DOM 星点」换成 **沿真实字形从左到右溶解、星尘跟着溶解前沿逐段散开**；
新句仍在原位克制淡入。歌词时钟、提前量预约与全部中断路径沿用播放器原有实现。

### 逐版构建号

| 构建 | 内容 |
|---|---|
| `1003131759` | 初版：真实字形取样 + 条内画布星尘，替换 DOM 星点 |
| `1003131760` | 星尘强度对标参考稿滑杆 **30%（柔和档）** |
| `1003131761` | 返修：星尘强度改 **50%**、起散提前（`lead` 系数 0.62→0.72）、柔影减轻（当时误改全局，见下） |
| `1003131762` | 星尘寿命从恒定 60ms 改为随节奏 169–780ms；每字配额均分封顶 |
| `1003131763` | 柔影改为**只作用于横条**（竖卡保持原值） |
| `1003131764` | 修「整句渐隐」：关键帧改用无前缀 `maskImage`；粒子层提到歌词之上 |
| `1003131765` | 粒子从字面向外散开；溶解前沿前沿起散 |
| `1003131766` | 修「头顶冒泡」：读像素步长用错（见根因） |

## 二、两个真 bug 的根因（用户报告的现象）

用户反馈「字体直接消失渐隐，然后字体头上冒星光，跟冒泡一样，和 HTML 区别很大」。逐帧抓真实转场后确认是**两个独立 bug**：

1. **整句渐隐**：离场关键帧之前写的是 `webkitMaskImage`。实测 Chromium **不认带前缀属性做 WAAPI 关键帧**（`getComputedStyle` 回落 `none`），
   于是整段 mask 动画失效，只剩 `opacity` 1→0，看起来就是「字体直接消失」。
   改用无前缀 `maskImage` 后掩膜真实生效（帧内 `linear-gradient(90deg, rgba(0,0,0,0) 61.7%…)`），溶解边从左往右推进。
2. **头顶冒泡**：取字形像素时，用的是复用离屏画布的 `off.width` 算步长，但实际读的是 `gw×gh` 的小图。
   两者不等时只有**顶部几行**被采到，粒子全部堆在字上方 → 视觉上就是「字头上冒星光」。
   改用这张小图的真实宽 `gw` 后，粒子落回文字带内（实测 dust y 37–57 vs 文字 35–61，`badIfStuckAbove = 0`）。

## 三、字形取样如何尊重两行与省略

`stripLyricVisibleGlyphs()` 用 `Range` 逐字取**真实换行后的矩形**，只采可见两行：

- 被 `-webkit-line-clamp: 2` 截断、或落在省略号覆盖区（`rect.right > 右缘 - 一个字号`）的字 **不进取样、不发射粒子**；
- 矩形超出文字盒（±1px 容差）的也丢弃；`rect.top > textRect.bottom` 立即停止扫描。
- 每个可见字形的矩形单独画到离屏画布中心，按 `step = max(2, round(fontSize/7))` 采样 alpha > 96 的像素点作为粒子起点。

**每字配额均分并封顶**（`perGlyph = clamp(budget / 可见字数, 3, 14)`）——这是返修项：
旧版按「字宽占比」分配，实测 2 字短句每字挤 **42 颗**、两行长句总配额 **162 颗被截断到 84 颗（后半句一颗都没有）**。
现在短句 2 字 = 28 颗，长句 13 字 = 156 颗，两行 14 个可见字 = 154 颗，不再截断。

## 四、粒子参数（当前值）

- 强度常量 `STRIP_DUST_STRENGTH = 0.5`，对标参考稿滑杆 **50%（适中档）**：数量、亮度、尺寸、位移同组缩放。
  预算 `round((stripSmall ? 200 : 320) × 0.5)` → 普通 **160 粒**、312px 窄档 **100 粒**。
- 尺寸：普通 1.05–2.35px，星云 2.6–5.0px，束状 5–8.4px（乘 `0.52 + 0.49×0.5`）。
- 亮度：`alpha × (0.25 + 0.68×0.5)`；星云再乘 0.4、普通乘 0.62；束状加十字射线（`0.42 + 0.58×0.5`）。
- 运动：`vx = (ox×15 + (rx−0.5)×18) × 0.5`、`vy = (oy×11 + (ry−0.5)×14) × 0.5`，`ox/oy` 是粒子相对字形盒中心的偏移方向 → **从字面向外小幅散开**，不再整片朝上。
- 出生时间跟着溶解前沿：`birth = 24 + sweep × (dissolveMs × 0.95) + 抖动`。
- 颜色：沿用横条进度星光 `--strip-star-0..5`（用探针读实际 computed 值）+ 歌词当前色，**不搬参考稿的固定蓝紫渐变**。

## 五、时长模型（返修项 2）

旧版 `tail = particles − dissolve` **恒等于 60ms**，肉眼抓不到 —— 这是「动画太短」的实数根因。现改为：

```
dissolve = 200 + pace×80          pace = clamp(interval, 0.35, 3.2)
tail     = 300 + pace×150         星尘自己在旧句散尽后继续飞的余辉
appear   = 150 + pace×40
particles = dissolve + tail        再按 nextInterval 封顶（≥220ms）
lead     = round(dissolve × 0.72)  起散提前量（原 0.62，往前侵占更多时间）
```

实测（真实 `__playerDebug.stripLyricTiming`）：

| 切句间隔 | dissolve | lead | tail | appear |
|---|---:|---:|---:|---:|
| 0.45s 快 | 236 | 170 | 169 | 168 |
| 1.2s 常 | 296 | 213 | 480 | 198 |
| 3.2s 慢 | 456 | 328 | 780 | 278 |

快 < 常 < 慢 单调性保持。

## 六、柔影（返修项 1）

原始全局 `--lyric-separation-shadow` 是 `0 1px 2px 95% + 0 0 6px 85%`。
实测：**只压透明度会掉出 4.5**（试 62/42 → 横条已播区 3.34）。最终改为 **只作用于横条**、收窄模糊半径：

```css
.strip-layout { --lyric-separation-shadow:
    0 1px 1px color-mix(… 88%, transparent),
    0 0 4px  color-mix(… 52%, transparent); }
```

竖卡继续用 `:root` 原值，未被本次改动影响。

四方真实背景实测（`tools/measure-lyric-surfaces.mjs` 口径，逐 CSS x 扫描 5 个 y）：

| 表面 | 柔影 RGB | 柔影/字 | 最低有效对比 | 判定 |
|---|---|---:|---:|---|
| 横条 0% 未播 | [62,64,70] | 4.95 | **7.78** | 过 |
| 横条 50% 交界 | [62,64,70] | 4.95 | **5.35** | 过 |
| 横条 100% 已播 | [61,61,64] | 5.17 | **5.36** | 过 |
| 竖卡 465×930 | [36,45,55] | 6.59 | 2.58 | 保持原值（用户已知取舍，未修） |

## 七、中断路径清单与自查结果

星尘只在**横条形态、歌词自然切句**时出现；canvas 逐帧只在转场期间运行，`clearStripLyricMotion()` 会 `cancelAnimationFrame` 并移除覆盖层/画布。
统一入口 `clearStripLyricAnimation()`，已接入：暂停/结束、seek（`markStripLyricDiscontinuity`）、切歌（`resetStripLyricSample`）、
悬停与控件出现、`pointerdown`、窗口失焦、离屏/页面隐藏、reduced-motion、退出 strip、布局切换、几何变化。

本地实测残留（`prev` 旧句副本数 / `dust` 画布数）：

| 状态 | 结果 |
|---|---|
| 暂停 | 0 / 0 |
| seek | 0 / 0 |
| 悬停出控件 | 0 / 0 |
| reduced-motion | 0 / 0 |
| 切歌后暂停 | 0 / 0 |
| 转场自然结束 | 画布自行移除，0 / 0 |
| 转场进行中 | canvas 存在且画出像素（峰值 485px） |

## 八、改动文件

- `ui/app.js`：`stripLyricTransitionDuration`（时长/提前量）、`stripLyricVisibleGlyphs`（新增，可见字形边界）、
  `createStripLyricDust`（改写为条内 canvas）、`paintStripLyricDust` / `runStripLyricDust`（新增，转场期 rAF）、
  `stripLyricExitFrames`（改用 `maskImage`）、`startStripLyricDissolve` / `clearStripLyricMotion`（画布与 rAF 清理）。
- `ui/style.css`：`.strip-layout` 横条专用柔影一行；`.strip-lyric-previous` 掩膜规则简化；`.strip-lyric-dust` 改为 canvas 层（`z-index:3`）。
- `ui/index.html` / `ui/standalone.html`、`ui/_build.json`：`bump-build` 到 `1003131766` 及孪生同步。

**未碰**：`lib/register-routes.js`、`ui/index.html` 的 `#unavailablePop`、`ui/app.js` 播放失败处理段、`tools/`（归另一会话）、进度条星光、竖卡的柔影与字号规则。

## 九、未验项

- **未部署、未 reload**；真机观感（快/常/慢、两行、312px、深浅主题、seek、减少动效）由统筹安排。
- `node tools/verify-ui.mjs --strip-lyrics-only` 跑过一次，仍在 `verify-strip-lyrics.mjs:385` 超时：
  该断言还在等 `.strip-lyric-dust > .strip-spark`（旧 DOM 星点），现在粒子是 canvas 元素 —— **测试待适配，不是效果缺失**。
  视觉证据与清理自查改由本轮临时脚本完成（见 §二/§七）；正式录屏待测试适配后由统筹复跑。
- 未跑 3 次以上重复验证（按统筹要求）。
- 亮封面 / 深封面 / 多主题组合下的星尘配色只在本机 Chrome 夹具上抽样，未穷举。

# 任务：修稳一条 flaky 断言（`ripple-continuous-bass-field-bounded`）

## 仓库与文件

- 仓库：`/Volumes/SSD/hanadesk/hanako-audio-player-simple`（分支 `hana-simple`）
- 目标文件：`tools/verify-ui.mjs`
- 被测实现：`ui/app.js` 的涟漪模块（`initRipples()` 内的 `stepField` / `driveBass`）
- 跑测：`node tools/verify-ui.mjs`（约 7-9 分钟，输出 JSON 到 stdout）

⚠️ 这是 **Hana v2 App** 的源码仓（`ui/index.html` + `ui/app.js` + `ui/style.css`，
无构建步骤）。跑测前**不要**动 `ui/` 下的实现文件——本任务只改测试脚本。
（另注：`ui/index.html` 与 `ui/standalone.html` 是孪生文件，内容只差 `data-shell` 与一行调试块；
但本任务不涉及它们。）

## 现象

`ripple-continuous-bass-field-bounded` 会**间歇性**失败。历史观测到的挂掉值：
- 一次 `halfMaxFirst=0.00183, halfMaxLast=0.00332` → 比值 **1.81**
- 一次比值 **1.34**（注释里也记着「受负载影响会假越线」）
- 同一代码复跑经常就过。

## 断言原文（`tools/verify-ui.mjs` 约 1811-1819 行）

```js
// ⑦ 连续低频长播：场能量有界，不随播放时间无限增长
//    ① 绝对上限：正常 max 0.002~0.0033；拆封顶 0.0076；拆阻尼 0.0058~0.0095；两者都拆 3.8。
//    ② 峰值增长：后半段峰值不高于前半段峰值的 1.6 倍（实测正常 ≈0.9~1.2）。
assert('ripple-continuous-bass-field-bounded',
  steady.settledN >= 8 &&
  steady.maxField < 0.005 &&
  steady.halfMaxLast <= Math.max(steady.halfMaxFirst, 1e-4) * 1.6,
  JSON.stringify({ max: steady.maxField, halfMaxFirst: steady.halfMaxFirst,
    halfMaxLast: steady.halfMaxLast, settledN: steady.settledN }));
```

## 夹具与采样方式

- 夹具 `steady-bass`：6 秒持续 80Hz 正弦（`amp 0.5`，无包络），见 `tools/verify-ui.mjs` 的 `synthSamples()`。
- 播放 9 秒（`playSynth('steady-bass', 9)`），**每 100ms 采一次**，
  采集字段含 `field: D.rippleAudio().bassField`（= 高度场能量）。
- `agg()` 里：跳过前 1.5s（`settled = S.filter(x => x.t >= 1.5)`），
  再把剩余**对半切**，取两半的 **max** 作 `halfMaxFirst` / `halfMaxLast`。
- 断言用 `halfMaxLast <= max(halfMaxFirst, 1e-4) * 1.6`。

## 我实测到的数据（帮你省事，可直接复现）

用同参数夹具（80Hz、0.5 振幅）在 465×930 页面跑 26 秒，每 40ms 采样后重采样到 100ms：

- 场能量 `bassField` 范围：**min 0 / 中位 0.0011 / max 0.0033**。
- 振荡周期约 **0.17–0.5s**（不是长周期；能量在 0.0009~0.0033 间快速起落）。
- **跳过 1.5s 后**，对任意起点滑窗做「后半峰/前半峰」，得到：
  - `n=161, min=0.56, p50=0.97, p95=1.03, max=1.39`，**没有一次 >1.6**。
  - 只出现两次 >1.3（1.39），且都在很靠后的起点。

**结论（这决定了修法方向）**：稳态下这条判据很稳（最坏 1.39），
历史 flaky 的 1.81 只可能来自**预热刚结束、波还在爬升的头一两秒**——
那时前半窗口的峰值偶发取到低值，比值虚高。也就是说这是**采样起点/窗口相位敏感**
造成的假挂，不是实现真的有界性问题。

## 已排除（别重复走）

- **不是数值发散**：稳态 max=0.0033，绝对水平受封顶保护（`driveBass` 里
  `if (bassField > 0.0009) return;`），实测长播 18s 中位数前后半 0.0437 → 0.0403（不增长）。
  注：封顶阈值 0.0009 与 `fieldEnergy` 同源，但 `inject()` 里会把 `fieldEnergy` 先置 1 当「有活动」标记，
  真正的能量由 `stepField()` 重算——**读 `bassField` 才是真实值**，别被 `rippleState().field` 的 1 误导。
- **不是采样率问题**：100ms 采样对 0.17s 周期的振荡足够（每周期 1-2 点，取 max 够用）。

## 需要你做的

1. **先复现**：连续跑 `node tools/verify-ui.mjs` 若干次（3-5 次），确认它是否挂、挂时 `detail` 里的
   `halfMaxFirst/halfMaxLast` 是多少。把结果记下来。
2. **改稳**它，方向自定，但要满足：
   - 仍能守住「场能量有界」这个**真实意图**（防无限堆积）。**别把它删成恒真**。
   - 消除「采样起点相位」带来的假越线。
   - 参考方向（任选或自创，说清理由）：
     - 把「对半切取 max」换成**相位无关**的判据，如：后半段**中位数** ≤ 前半段中位数 × k，
       或对多段滑窗取比值分布、用分位数断言；
     - 或跳过更长的预热（但当前 1.5s 已够，加长收益要拿实测数据说话）；
     - 或把「单次 9s 采样」改成「多次采样取中位」，降低单次相位敏感。
   - ⚠️ 若改成中位数等统计量，**必须自己造一个「坏版本」验证仍有区分力**：
     比如临时把 `driveBass` 的封顶 `if (bassField > 0.0009) return;` 去掉（或把阻尼 0.976 调高），
     确认新判据在坏版本上**真的会挂**、正常版本**稳定过**。没有区分力的判据等于没测。
     （历史上就踩过：早先的「均值/中位数前后半比」对坏版本无区分力，坏版本 2s 内饱和、比值仍≈1.0。）
3. 改完在提交信息或回复里写清：复现次数/结果、新判据、以及**坏版本对照实测**。

## 约束

- **只改 `tools/verify-ui.mjs`**（必要时可加临时调试脚本，但别提交）。不要动 `ui/app.js` 的实现。
- 保留 `assert()` 的命名即调用约定；新增/改写断言要有可读的 `detail`。
- 跑完确认整体仍全绿（当前基线 **278/278**、`runtimeErrors: []`）。
- 提交风格：本仓用 Conventional Commits（中文描述），示例
  `test(ui): 修 flaky —— 涟漪场能量有界改相位无关判据`。

## 交付

- 改好的 `tools/verify-ui.mjs`（工作树保持干净，或按上面风格提交）。
- 一段说明：复现证据 + 新判据 + 坏版本对照数据。

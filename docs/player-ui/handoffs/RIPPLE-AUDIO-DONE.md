# 涟漪音频分层落地 · 交接

日期：2026-10-11。分支 `hana-simple`。构建号 `1003131652`（上一版 `1003131651`）。
规格书：`docs/player-ui/RIPPLE-AUDIO-PLAN.md`（保留）。

## 一、改了什么

只动两个文件：`ui/app.js`（涟漪模块）、`tools/verify-ui.mjs`。`ui/style.css` 未动
（局部读词减弱在 Canvas 内用实际歌词区矩形做，不需要 CSS）。孪生 HTML 只跑 `bump-build`，
PV 块未碰。

### 1. 音频分析拆两路（`initRipples` 音频段重写）

- `attachAudio()`：保留 `captureStream()` 副本 + 零增益（**绝不改 `createMediaElementSource`**）。
  `smoothingTimeConstant` 0.65 → 0.2（原值把起音抹平；平滑改由我方包络负责）。
  新增**代次守卫** `audioGen`：`detachAudio()` 递增使在途 `resume/attach` 全部失效，
  过期结果不挂回新歌。建链后预分配 `freqData/prevBins` 与三频段 bin 区间 `BANDS`。
- `readSignal()`：单 FFT 4096。三路频段能量（40–180 / 180–2000 / 2000–8000Hz，功率和开方）
  + **正向谱通量**（spectral flux，相邻帧只累计增长）+ 各频段快/慢包络 + 谱通量自适应背景。
  输出两样：**低频包络 `envBass`**（attack ~120ms / release ~500ms）与**合并后的最强起音**。
- 起音判据：快包络显著高于慢背景 + 谱通量超自适应背景 + 绝对/归一化门限。
  低音与中频各一条，同一瞬态只产一次敲击波。含非有限值处理、静音门限、分母下限。
- 新增 `driveBass(env, dt)`：按实际 dt 推进并限注入量，场能量封顶 `bassField > 9e-4` 即不再注入。
  位置集中在封面区（由 `--cover-w` 算锚点）小范围缓慢游移，**不调 `drop()`**。
- 新增 `dropAudio()`：音频短波，一主环 + 一淡回声，寿命 1.0–1.4s，`origin:'audio'`；
  同屏音频短波上限 `MAX_AUDIO_WAVES = 3`。`triggerOnset()` 统一冷却（`ONSET_COOLDOWN = 380ms`）。
- 换源/重建/恢复后 `resetAnalysis()`：清过期频谱与统计、清起音历史、预热 `WARMUP_MS = 320ms`。
- 真实音频可读时 `breathe()` 停掉随机呼吸波（不再以随机波伪装音乐驱动）；捕获不可用保留原降级。

### 2. 生命周期与可见性同步（方案 §6）

- 旧 `audioLoop()` **即使 `blocked()` 也在尾部继续排 rAF**；现改为 `blocked() || !playing`
  即 `analysisOn = false` 且不排帧。
- 新增 `startAnalysis()/stopAnalysis()`；`startAnalysis` 内部 `resetAnalysis()`（清过期起音）。
- `sync()`：blocked 分支停分析；恢复分支重建时间基准并清过期起音（避免补发积压鼓点）。
- `resume()` 重新预热；`pause()` 停分析。截图冻结 / hidden / 离屏 / reduced-motion 全部真停。

### 3. 1.6 倍接线（方案 §5）

- `strength()` → `baseStrength()`（值不变：有词 0.32 / 无词 0.50），管输入力与场能量。
- 新增 `VISUAL_GAIN = 1.6`，**只在绘制阶段**的流光 alpha、主环、回声、中心小圈、尾流 alpha 上
  乘一次再限幅。**不进 `inject()`、不改 `baseStrength()`** —— 避免 1.6×1.6≈2.56。
- 源码级守卫 `ripple-visual-gain-changes-look-only` 断言 `inject()` 与 `readSignal()` 体内无 `VISUAL_GAIN`。

### 4. 绘制分层与读词减弱

- `draw()` 按 `origin` 区分：音频短波 2 环（一主一淡回声），指针波仍 4 环；中心小圈只给指针波。
- `computeAttMask()`：用实际 `lyricWrap` 矩形算逐格衰减掩膜（带羽化、key 记忆，`sync()` 重算），
  歌词区内保留至少三成强度，边缘连续过渡。改歌词透明度为 0 影响，不让整屏随鼓点闪亮。

## 二、验收结果（无头）

- **UI 断言 `node tools/verify-ui.mjs`：236/236**（上一版 226；本轮新增 10 条）。
  12/12 布局自检、4/4 窄卡自检、**零运行时错误**。
- **后端 `node tools/verify-backend.mjs`：22/22**。
- **静态校验**：`validate_app.mjs` 唯一 error 是
  `id "hanako-simple-player" does not match its directory name "hanako-audio-player-simple"` ——
  **仓库固有事实**（仓库目录名与 App id 本就不同），不在本轮改动文件内，非本轮引入。
- 无头实测信号（真实同源合成音频经 captureStream/FFT，`/tmp/ripple-probe/` 探针）：
  - 持续 80Hz：`envBass ≈ 1.0`、场能量在线、**零短波**；
  - 底鼓（60Hz 短包）：7 次起音 / 3 组波（限流生效）；
  - 中频敲击（1.2kHz）：低频包络仅 0.43，靠中频起音路径识别 7 次；
  - 静音：全零，不伪造鼓点；
  - 密集（每秒 8 个）：被冷却合并到 6 次 / ≤3 组波。

## 三、新增断言（10 条）

1. `ripple-steady-bass-keeps-wide-field-without-waves` — 持续低音维持宽缓场、预热后不生成短波
2. `ripple-kicks-produce-finite-short-waves` — 重复短脉冲产生有限细波（1..3 组）
3. `ripple-mid-burst-onset-detected-outside-bass-gate` — 中频敲击走低频门限之外的起音路径
4. `ripple-steady-and-transient-shape-differ` — 同总音量下持续 vs 短脉冲形态不同
5. `ripple-silence-fakes-no-beats` — 静音不伪造周期鼓点
6. `ripple-dense-pulses-merge-within-budget` — 密集脉冲经合并满足波包预算
7. `ripple-continuous-bass-field-bounded` — 连续低频长播场能量不无限增长
   （跳预热期后，后半段中位数 ≤ 前半段中位数 ×1.3；实测 0.95–0.99；另加硬上限 maxField<0.02）
8. `ripple-visual-gain-changes-look-only` — 倍率只改观感：不动音量、不参与起音（源码级守卫）
9. `ripple-shot-freeze-stops-analysis` — 截图冻结真停分析
10. `ripple-crosssource-degrades-without-silencing` — 跨源 `captureStream` 抛错退回纯指针、仍出声

改写 1 条：`motion-ripple-reactive-to-audio` 从「喂标量必须落一个波」改为
「喂低频包络驱动宽缓场」（与新设计一致：持续低频不再落波）。
保留 `reactive-uses-captureStream-not-mediaElementSource` 源码守卫。

测试基建：假后端新增 `/_fixture/tone.wav?p=<kind>` 合成音频端点（steady-bass / kicks /
mid-bursts / mixed / silence / dense），测试直接驱动同一个 `<audio>`（同源）走真实
`play → resume → buildAudio → captureStream → FFT`。新增 `rippleClear()` 钩子做夹具隔离。

## 四、必须真机试听（无头证不了）

罐头已指定首选曲目：**《花一匆》（ずっと真夜中でいいのに。）** —— 低音贝斯线连续 + 鼓点明确 +
中高频密集，正好同时压两条路径。另需覆盖：

- 曲目类型：持续 Bass 曲、明显底鼓曲、敲击/踩镲密集曲、钢琴/人声主导曲、纯音乐。
- 画幅：465×930 长卡 / 312 窄卡 / 1040×780 窗口 / 矮窗；浅深主题、有词/无词。
- 目视重点：能否看出「水面托住低音、短波回应敲击」；歌词阅读不被抢走；主波源不满场跳；
  高潮仍有层次、安静段确实收敛。
- 边界：暂停/恢复、换曲/seek、隐藏/离屏、跨文档拆窗恢复均无积压突发。

阈值/半径/寿命/数量限制均为**工程校准起点**（`BASS_DRIVE`、`ONSET_COOLDOWN`、
`MAX_AUDIO_WAVES`、各门限），真机观感若偏强/偏弱，优先调这几个常量。

## 五、交接状态

- 分支 `hana-simple`，**未 push、未部署、未 reload**（交统筹线统一部署与总验收）。
- `manifest.json` / `package.json` 的 `version` 未动。
- 调试钩子（`__playerDebug`）：新增 `ripplePokeOnset` / `rippleSetGain` / `rippleResetAnalysis`
  / `rippleClear`；`rippleAudio()` 现含 `analysing/envBass/onsets/bassField/audioWaves/gain`
  与起音内部量（`eFast/eSlow/mFast/mSlow/bf`，供后续校准）。

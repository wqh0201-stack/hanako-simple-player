# 删除无头音频反应测试族 / 柔影现状收口 · 2026-10-16

按DeepMind转达的罐头裁决：删除指定音频反应族，不把它改为hook测试、skip或注释保留；保留指针、状态/生命周期、工具面板和配色资产。

本轮项目改动仅`tools/verify-ui.mjs`及本交接。**不改运行时、不bump、不部署、不reload**。开始时已把UI、构建号、保护文件和独立专项/采样器做SHA256基线，保留此前工作树在途修改。

## 删除清单（21个展开名称，19处源码调用）

1. `motion-ripple-reactive-to-audio`
2. `reactive-uses-captureStream-not-mediaElementSource`
3. `ripple-steady-bass-pulses-light-without-false-beats`
4. `ripple-kicks-produce-finite-short-waves`
5. `ripple-mid-burst-onset-detected-outside-bass-gate`
6. `ripple-steady-and-transient-shape-differ`
7. `ripple-default-tune-is-restrained`
8. `ripple-silence-fakes-no-beats`
9. `ripple-dense-pulses-merge-within-budget`
10. `ripple-hihats-trigger-high-waves`
11. `ripple-beat-threshold-lower-produces-more-events`
12. `ripple-lowest-thresholds-keep-steady-and-silence-quiet`
13. `ripple-audio-ring-layers-match-approved-demo`
14. `ripple-bass-glow-actually-visible`
15. `ripple-continuous-bass-field-bounded`
16. `ripple-real-song-restrained-by-default`
17. `ripple-real-song-all-three-groups-trigger`
18. `ripple-real-song-bass-threshold-direction`
19. `ripple-real-song-beat-threshold-direction`
20. `ripple-real-song-hat-threshold-direction`
21. `ripple-real-song-pause-clears-residue`

后三种threshold-direction原由同一循环展开，所以21个名字对应19个assert调用点。任务书列出的全部删除项均去掉；无清单外断言被删除。

## 删除的专用辅助与夹具

- `synthSamples`、`wavFromSamples`、`SYNTH_KINDS`、`SYNTH_WAV`、未使用的`synthUrl`；steady-bass/kicks/mid-bursts/hihats/weak-mid/mixed/silence/dense八种信号生成。
- `/_fixture/tone.wav`、可选`real-song.m4a`和仅真歌使用的封面路由；没有删除仓库媒体文件。
- `playSynth`、`agg`、频谱ready轮询、周期采样/峰值/前后半场能量统计、canvas多帧亮度采样。
- `RIPPLE_SONG`分支、真歌12秒预热/三组8秒门槛往返、真歌专用截图与报告对象。
- `motion.audio`及其只服务被删断言的包络喂入。
- 原`rippleAudio`测试汇总改为仅含保留契约的`rippleContracts`，不保留伪装的FFT报告。
- `--song-only`专用入口退役，显式报错；不会变成skip或空跑0/0全绿。`--ripple-only`保留状态/工具/配色检查。

**通用30秒静音WAV与Range服务保留**：它还被播放/seek、歌单、迁移、本地扫描等大量测试使用。冻结/异常降级也改用此通用静音媒体，不再依赖合成音色。

## 三条待判项

| 断言 | 裁决 | 依据 |
|---|---|---|
| `ripple-default-tune-is-restrained` | 删除 | `playSynth('kicks',5)`后断言真实起音数为0，依赖解码/FFT及采样时间 |
| `ripple-visual-gain-changes-look-only` | 保留 | 同步读写gain、volume及源码关系；不等待频谱、波形或动画峰值 |
| `ripple-crosssource-degrades-without-silencing` | 保留 | 强制captureStream抛异常，断言抛错已发生、媒体未暂停、ready=false；不等待FFT成功或音频能量。仍有原生play/metadata生命周期，但不做实际发声/音质验收 |

## 保留资产及初始化解耦

所有保留的assert语句（名称、条件、门槛、detail）逐字保持；源码审计输出`/tmp/hap-audio-removal-source-audit.json`。只更换因被删音源而需要解耦的初始化，不把被删族换皮恢复。

- 指针/空词：`motion-ripple-poke-adds-wave`、`motion-ripple-when-no-lyrics`、`ripple-layer-when-no-lyrics`。
- 工具当前实际有**13条**而非任务书的11条，全部保留。以下均为`ripple-tool-`前缀：
  - `legacy-settings-use-new-defaults-without-writing`：存储桩/schema默认值及写入次数。
  - `wide-only`：改变视口后读DOM显示状态。
  - `opacity-and-z`：computed opacity/z-index关系。
  - `pop-reuses-pop-skin`：DOM类名与主题样式变量。
  - `opens-and-closes`：点击/Escape后查开合状态。
  - `six-sliders-and-reset`：滑杆数量、重置按钮、说明文案与配置重置。
  - `slider-live-and-volume-untouched`：派发input后读配置/volume，未要求音频事件增长。
  - `slider-affects-tuning`：输入值写入tune且不改音量。
  - `hidden-when-controls-hidden`：控件状态切换后的样式/命中状态。
  - `hidden-in-shot`：截图class切换后的DOM显隐。
  - `names-and-slider-directions`：标签、方向说明和DOM数量。
  - `persists-to-storage`：存储桩写入键值。
  - `restores-from-storage`：新文档读存储并恢复配置。
  这些即便有原有UI过渡等待，也不等待解码/FFT或波形能量；按明确保留清单原样保留。
- 配色：`ripple-layer-colors-distinct`、`ripple-layer-color-vars-wired`、`ripple-layer-hue-offset-from-lyric`、`ripple-layer-colors-survive-background`。
- `ripple-all-opacity-controls-change-alpha-only`：从可选真歌分支移到默认路径；用已有`ripplePoke`喂一次**指针波**初始化高度场，同一JS帧验证alpha变化而field/kinds/waves/volume/time不变。保留原`rippleRingLayers`绘制探针，不引入音频包络hook或FFT断言。
- `ripple-attmask-defaults-to-full-strength`、`ripple-shot-freeze-stops-analysis`。
- `ripple-tip-notice-shows-once-when-tool-visible`、`ripple-tip-skipped-when-tool-hidden`。
- 清单外的`ripple-tune-version-and-finite-bounds`等也保留，不顺手重构/修复。

## 未动的运行时钩子

- `__playerDebug.rippleAudioPoke`→内部`audioPoke`、`__playerDebug.ripplePokeOnset`→内部`pokeOnset`：删除后当前`tools/*.mjs`无引用，列为疑似手工调试/历史测试遗留；**未删除**，不能据此保证其他入口没有使用。
- `rippleAudio()`本身仍被配置、冻结、降级及工具测试读取，不能整函数删除。
- `rippleRingLayers`仍用于受保护的alpha-only测试；`rippleSetGain`、`rippleResetAnalysis`、`rippleClear`、`ripplePoke`仍有保留调用，不能误删。

## 删除前后计数与唯一一次验证

- 普通单引号`assert('...')`调用点：**407→388**，与统筹核对口径一致。
- 包含模板字面量的全部assert调用点：**421→402**。删除19处调用，按循环展开为21个名字；保留的assert语句逐字一致。
- 此次环境未设置RIPPLE_SONG。默认执行删15条、新增默认执行原受保护alpha-only 1条，净减14；因此同配置删除前执行数可回推为**606→592**。**606是依据原执行结构回推，不是另跑一次的实测**；遵守只跑一次，未测删前耗时。

| 命令 | 实际结果 | 耗时 | 退出码 |
|---|---|---:|---:|
| `node tools/verify-ui.mjs`（无参数） | **592/592** | **306.920秒** | 0 |
| `node tools/verify-ui.mjs --strip-lyrics-only` | **37/45** | 30.555秒 | 1 |
| `node tools/verify-ui.mjs --interaction-only` | **27/27** | 11.979秒 | 0 |

三个均只跑一次、顺序执行，均`runtimeErrors: []`。全量全部保留的涟漪资产通过，包括13条工具、指针、配色、alpha-only、冻结与异常降级。全量最终出口同时确认selfCheck、接线、迁移、生命周期通过。

静态语法、`git diff --check`通过。SHA256核对：任务开始后UI/构建号/保护文件、独立歌词与交互测试、歌词像素采样器**均未再改**。构建仍1003131758，本次FFT清理不bump，需统筹合包时统一处理前序视觉构建。

### 歌词专项的8条红项，不冒充全绿

全部仍是旧硬描边契约，与已选择的D柔影不兼容；独立歌词脚本本轮未修改，也不为过关放宽断言：

- `SL-measured-contrast-strip-0`
- `SL-measured-contrast-strip-50`
- `SL-measured-contrast-strip-100`
- `SL-measured-contrast-vertical`
- `SL-stroke-regression-old-fill-fails-rendered-outline-passes`
- `SL-outline-one-rule-all-surfaces-and-glow-retained`
- `SL-outgoing-inherits-identical-outline-16`
- `SL-outgoing-inherits-identical-outline-22`

前四条及反例仍只读stroke像素，D下stroke如实为null；其余要求stroke-width>0/paint-order。它们不是柔影实际分离度不够，也不是FFT清理造成的断言变化。需要统筹协调迁移验收对象到柔影，不能报告45/45。

## 前序柔影保持现状的收口证据

前序已落`ui/style.css`与`tools/measure-lyric-surfaces.mjs`；本次冻结，未再调参数。硬描边变量/属性已去掉；统一暗影源`var(--veil-ink)`，不随表面切换：

```css
0 1px 2px color-mix(in srgb, var(--lyric-separation-color) 95%, transparent),
0 0 6px color-mix(in srgb, var(--lyric-separation-color) 85%, transparent)
```

暗影在前，横条原`--strip-lyric-glow`、竖卡原`--lyric-shadow`+`--lyric-glow`在后。字号、字色与Range几何未改。

参考D的.62/.40在已渲染背景小样上最弱2.5102；.85/.60最弱3.7955；1/1可达5.3608；最终用较轻的.95/.85，小样4.7944。小样是旧实际背景PNG上的真实DOM绘制，不冒充当前整页验收；没有为调参反复跑整套专项。

本轮唯一一次歌词专项另存**柔影专属真实像素报告**，正常PNG取fill/暗影像素，白色柔影mask只定位、排除fill覆盖区。未把shadow塞入stroke字段骗过旧断言。

| 实际表面 | fill RGB | 暗影实际RGB | 有效最低 | 暗影/fill | 新口径 |
|---|---|---|---:|---:|---|
| 横条0%，未播 | `[132,192,235]` | `[64,69,73]` | **7.3011** | 4.9507 | 通过4.5/3 |
| 横条50%，含交界 | `[132,192,235]` | `[64,69,73]` | **5.5173** | 4.9507 | 通过4.5/3 |
| 横条100%，已播 | `[132,192,235]` | `[64,66,66]` | **4.7874** | 5.1642 | 通过4.5/3 |
| 竖卡465×930 | `[131,191,234]` | `[34,42,52]` | **3.7740** | 7.3202 | 保留用户已知3.0取舍，未修到4.5 |

同色底反例：无暗影有效1.0000，恢复暗影后6.0495。整组星光色距仍171.1053°。以上是柔影专属像素结果，**不等于旧45项已全绿**。

### clip余量与跨会话边界

保留原2px横向clip余量与原纵向两行clip，理由是纯绘制余量不挤掉内容宽度、不改变换行与Range，也不露第三行。16/22px两行字形均零丢失；横向与8px参考比较，柔影无>16灰阶的显著丢失，最窄34px槽最大尾部差8/255。

但纵向边界仍量到约12.9%–19.2%的暗影mask覆盖，说明远影尾部仍可能被原两行盒截断，**不宣称完全无裁切/硬边**，真机观感待统筹看。此前提过的边缘羽化**没有实现，也不再自行实现**。

`strip-lyric-previous`/`strip-lyric-dust`专属规则、`createStripLyricDust`、`stripLyricDustOrigins`及退场关键帧均未修改；旧句只自然继承通用柔影。字形溶解/星尘退场已归`sess_0mvaqysfu`，本线不回退或覆盖其工作。

未验：真实宿主/Windows字体、持续播放性能、所有封面/相位、柔影截断边缘的用户观感。未部署、未reload。

## 证据

- 全量：`/tmp/hap-remove-audio-full/verify.json`、`/tmp/hap-remove-audio-full.log`、`/tmp/hap-remove-audio-full-timing.json`。
- 专项：`/tmp/hap-remove-audio-strip/verify-strip-lyrics.json`、`/tmp/hap-remove-audio-interaction/verify-player-interaction.json`及同名.log；计时`/tmp/hap-remove-audio-special-timing.json`。
- 柔影：`/tmp/hap-remove-audio-strip/strip-lyrics/soft-shadow-surfaces.json`、同目录rendered/background/影mask PNG；完整录像`strip-lyric-rhythm.mp4`。
- 源审计：`/tmp/hap-audio-removal-source-audit.json`、`/tmp/hap-audio-removal-final-summary.json`；冻结基线`/tmp/hap-remove-audio-tests-baseline.json`。

项目文件归属：FFT清理`tools/verify-ui.mjs`；本交接。前序柔影`ui/style.css`、`tools/measure-lyric-surfaces.mjs`保持原状。另按知识库规则补入音频起音笔记，不改项目运行时。

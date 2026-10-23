# B站音频涟漪 · 触发判定分析 · 2026-10-22

> 只读分析 + 只读字段补充。**没有**改代理、重试、捕获时序、门槛默认值、增益、呼吸或静音检测；
> 没有自动调用户参数、没有重置玩具箱、没有播放/切歌。
> 现场数据：`bili-audio-ripple-20261022/production-bili-1823-20261022.json`（构建 1003131823，独立窗，B站 曲目，播放 36.23s / 242s）。

---

## 0. 结论

**这次不是采集失败；现有读数支持「绝对门槛偏高」，但单帧不足以证明任何一道闸门必然关闭。** bass/kick 两道与当前电平的差距最大、数值支持最强；mid/high 的原始值本轮没有，不能判。

| 闸门 | 门槛（用户实际） | 采样瞬间的上界 | 读法 |
|---|---:|---:|---|
| bass `eb.fast >` | **0.0137**（−37.3 dBFS RMS） | ≤ 0.00750（−42.5 dBFS） | 门槛比这一瞬的上界高 5.2 dB；要开就得最近几百毫秒里有比这更高的电平。同刻 `eFast` 未取，**不能定论** |
| kick `eb.fast >` | **0.0178**（−35.0 dBFS RMS） | ≤ 0.00750 | 门槛比这一瞬的上界高 7.5 dB，同上 |
| mid `em.fast >` | 0.004272（−47.4 dBFS） | ≤ 0.00750 | 上界允许，**缺原始值不能定论** |
| hat `eh.fast >` | 0.0018（−54.9 dBFS） | ≤ 0.00750 | 上界允许，**缺原始值不能定论** |

这个上界的适用范围要说清：`bandEnergy()` 是**频段内各 bin 功率的均方根**，`peakDb` 是**采样那一瞬间**的最大 bin（幅度 0.00750），所以它约束的是**当刻瞬时 band RMS**。判定用的 `eb.fast` 是包络（升 0.04s / 落 0.09s），**可能高于当刻瞬时值**；`envBass` 反解同理只是平滑后的量级。所以这些数字支持「门槛相对当前电平偏高」，**不是**「这道门在整首歌里从未打开过」的证明；要拿到那种结论，需要同刻的 `analysis.raw.eFast`（1824 已加，未部署）。

**代码缺陷：未发现**。这几道门都是既有设计（绝对门槛 + 瞬态条件）；目前能说的是**参数与这一段素材的电平不匹配**，不是代码算错。

---

## 1. 现场读数

| 段 | 值 | 读法 |
|---|---|---|
| `track` | `sourceKind: bilibili`, `hasUrl: true` | 有曲目 |
| `media` | playing 36.23s / 242s, `readyState 4`, `volume 1`, **`muted true`** | 在播；静音开着 |
| `capture` | `ready/analysing/lastAttachOk` 全 true，`lastError null` | 采集链在位 |
| `audioContext` | `running` | 上下文正常 |
| `streamTrack` | `live` / `muted false` / `enabled true` | 轨道正常 |
| `spectrum` | 2048 finite / 999 non-silent / **peakDb −42.5** | 有真实信号，且能读到值 |
| `analysis` | `envBass 0.874`，`onsets 0`，`kinds` 全 0 | 有能量显示，但一次都没触发 |
| `signal` | `lowRatio 1.196`，`highFlux 1.646`，`bassFlux/fluxBgLow 显示 0` | 显示 0 是 `round3` 舍入，**不能当谱通量恒零** |
| `scheduler` | `playing true`, `blocked false`, `hidden false`, `inView true`, `reducedMotion false`, `waves 0` | 调度没被拦 |

---

## 2. 数值核算（可复算）

```python
peak_db   = -42.5                      # spectrum.peakDb
peak_amp  = 10 ** (peak_db / 20)       # 0.00750  → 当刻 band RMS 的上界（不含包络历史）
env_bass  = 0.874
be_est    = 10 ** ((env_bass * 38 - 58) / 10)   # normEnergy 反解 → 0.00332
bass_thr, beat_thr, hat_thr = 0.0137, 0.0178, 0.0018   # 用户实际 tune（见 §2.2）
```

1. **上界（限当刻）**：`bandEnergy = sqrt(mean(10^(dB_i/10)))`，最大项就是峰值 bin ⇒ **采样瞬间**任何频段 RMS ≤ 0.00750。它不能约束“带历史的 `eb.fast`”在过去是否更高。
2. **反解（仅量级）**：`normEnergy(e) = (10·log10 e + 58) / 38`；`envBass = 0.874` ⇒ `be ≈ 0.00332`（−49.6 dBFS）。
   - 只能说这**一段**的 bass 能量大致在门槛的 1/4 量级。
   - `envBass` 是**包络**（升 0.12s / 落 0.5s），不是瞬时值；用它是为了量级，不是精确值。
3. **门槛换算成 dB**：bass −37.3、kick −35.0、mid(−47.4)、hat(−54.9) dBFS。
4. **面板左端离现场电平不远，但不能断言够用**：涟漪面板 bass 量程下限 **0.004（−48.0 dBFS）**、kick 下限 0.005（−46.0 dBFS）。bass 下限比**反解值**（−49.6 dBFS）还高约 1.6 dB，但低于**上界**（−42.5 dBFS）。也就是说：拉到底**可能**能开、也可能还差一点，取决于真实 bass RMS 落在 .0033 还是更接近 .0075 —— 这正是 1824 新补的 `spectrum.bands.bass` 要回答的，**本轮不下结论**。

### 2.2 用户实际参数（不是默认值假设）

`~/.hanako/app-data/hanako-simple-player/storage/global.json → player-ripple-tune`（**落盘值**：快照 15:56，该文件 mtime 16:01，晚于快照；与 1822 时期的记录一致、值未变。它是参数的**间接证据**，不是同刻内存快照。下文用它算，并标明这一点）：

```
bassThreshold 0.0137 | beatThreshold 0.0178 | hatThreshold 0.0018
bassOpacity 0.6 | beatOpacity 0.1 | hatOpacity 0.45
```

（默认值是 0.0137 / 0.0178 / 0.0018 —— 三档门槛恰好等于默认，浓淡是用户调过的。所以下文按这组数算。）

---

## 3. 量纲：`envBass` 不是判定用的 `eb.fast`

- `envBass` 是 `normEnergy(be)` 的一阶包络，喂的是**绘制浓度**（`paintField` 里 `0.35 + 0.65*envBass`）。
- 判定用的是原始 RMS `eb.fast`（以及 `em.fast / eh.fast`）。
- 两者差着一个 dB 映射：`.874` 看着"很响"，对应的原始 RMS 只有 `.0033`。**这是本次最容易读错的地方**——别拿 `envBass` 当"已经接近门槛"。

---

## 4. 逐条 gate 复核（`ui/app.js::readSignal`）

```
bassOn = eb.fast > bassThreshold && pk > 0.60 && pkFloor > 0.54 && lowRatio < 2.6
kickOn = eb.fast > beatThreshold && bf > be*be*0.015 &&
         (lowRatio > 1.6 || (lowRatio > 1.15 && fluxRatio(bf, fluxBg.bass) > 2.4))
midOn  = em.fast > beatThreshold*0.24 && em.fast > em.slow*1.45 && fluxRatio(mf, fluxBg.mid) > 1.6
highOn = eh.fast > hatThreshold && highFlux > 1.2 && (eh.fast > eh.slow*1.15 || highFlux > 1.9)
```

| 条件 | 现场 | 判定 |
|---|---|---|
| `bass: eb.fast > .0137` | 当刻上界 .0075 / 反解量级 .0033 | **门槛偏高（有数值支持）**；同刻 `eFast` 未取，不能定论 |
| `bass: pk > .60` | — | 常规有声段几乎总满足（`peak ≥ mean` ⇒ `pk ≥ 0.63`），但**不是恒等式**：分母被钳在 `max(1e-9, mean)` —— 极弱但峰值非零时比值被抬到 1，真静音时 `pk` 掉到 0，两种都不是 .63 那条线 |
| `bass: pkFloor > .54` | — | **带历史**：初值 1，遇低值跟随，之后按 tau≈0.45s 恢复；刚经过弱段时可能还在 .54 以下 |
| `bass: lowRatio < 2.6` | 1.196 | 通过 |
| `kick: eb.fast > .0178` | 当刻上界 .0075 | **门槛偏高（有数值支持）**；同刻 `eFast` 未取，不能定论 |
| `kick: bf > be²·0.015` | `be²·0.015 ≈ 1.6e-7`（be=.0033） | 数值上很容易满足，但 `bf` 被 round3 显示为 0，**不能据此判真** |
| `kick: lowRatio > 1.6 或 (>1.15 且 fluxRatio>2.4)` | lowRatio 1.196 | 只能走 fluxRatio 分支，缺原始值 |
| `mid: em.fast > .004272` | 缺 em.fast | 不能判 |
| `mid: em.fast > em.slow*1.45` | 缺 | 不能判 |
| `mid: fluxRatio(mf, bgMid) > 1.6` | 缺原始值 | 不能判 |
| `high: eh.fast > .0018` | 缺 eh.fast | 不能判 |
| `high: highFlux > 1.2` | 1.646 | 通过 |
| `high: eh.fast > eh.slow*1.15 或 highFlux > 1.9` | highFlux 1.646 < 1.9 | 只能走比值分支，缺原始值 |

**关于 `pk/pkFloor`（上一版写错了，这里更正）**：它们**不是**恒真条件。`pk` 的分母被钳在 `max(1e-9, mean)`：极弱但峰值非零时比值被抬到 1，真静音时 `pk` 掉到 0。`pkFloor` 则是一个会继承历史低值、再按 tau≈0.45s 恢复的跟踪量。本轮现场没有 `pk/pkFloor` 原始值，所以「它们是否在拦」本轮不得而知，**不应当成可直接删除的冗余**。

**抑制路径**：`if (kickOn) lastKickAt = now; if (kickOn || (now - lastKickAt < 280 && pkFloor < 0.75)) bassOn = false;` —— kick 从没触发过（`lastKickAt = -1e9`），这条没生效。

---

## 5. 逐条排除

| 怀疑 | 证据 | 结论 |
|---|---|---|
| **预热反复重置** | `envBass .874` —— `resetAnalysis()` 会把 `envBass` 清零，若刚重置过不会是这个值；`capture.lastAttachAt` 比快照早 32.9s，播放 36.2s，只挂过一次链 | 当前**不支持**"反复重置"；但本版才加 `resets.count/lastReason`，下一份现场可直接看 |
| **seek 重置** | `media.seeking=false`；但 36s 内若 seek 过会清零 counts/waves（`resetSignal`） | 单帧**不能排除**，已补字段 |
| **冷却** | `lastOnsets[kind]` 初值 −1e9，首帧即可触发 | 不是拦路条件 |
| **`audio.muted`** | muted=true，但 999 个非静音 bin、peak −42.5 → 采集侧仍有信号；判定链只读 `freqData`，代码里**没有任何 `muted`/`volume` 分支** | 对采集无清零作用；**未发现**对判定的间接通路 |
| **fftSize / 采样率 / bin 划分** | 4096 @ 44.1k → binHz 10.77，40–180Hz 落在 bin 4–17 | 正常 |
| **所有权 / 调度** | `isOwner true`、`blocked false`、`analysing true`、`hidden/inView/reducedMotion` 都正常 | 正常 |
| **采集跨源** | 上一轮已由现场读数否掉（ready/analysing/lastAttachOk 全 true + 有频谱） | 不是本因 |

---

## 6. 判定与分级

- **有数值支持（限当刻单帧，非严格证明）**：bass、kick 的门槛分别比**采样瞬间**的 band RMS 上界高 5.2 / 7.5 dB；按 `envBass` 反解的量级差 12–15 dB。也就是说「这段素材比门槛假设的电平低」有数字支持；要坐实还需同刻 `analysis.raw.eFast`（1824 已加、未部署）。
- **未证实**：mid / high 是否同样被电平挡住（缺 `em/eh` 原始值）；整首歌是否都这么低（只有 36s 一处样本）；36s 内是否发生过 seek 重置；`pk/pkFloor` 是否在拦。
- **代码缺陷**：未发现。`pk/pkFloor` 的门槛含义与弱段行为是既有设计，本轮**没有证据**说它是缺陷，也不建议当成冗余删掉。
- **参数问题 vs 代码缺陷**：目前看是**参数（门槛）与素材电平不匹配**。同一套门槛在网易云曲目上能触发（用户口径），说明门槛不是"坏的"；这段 B站 素材按反解量级约低 12–15 dB（**估计值**，不是同刻测量）。

---

## 7. 最小处理方案（本轮不实施）

**A. 用户可控（首选，零代码改动）**
在「涟漪调节」里把低音、鼓点门槛往左拉。**但要说清前提**：bass 滑杆下限 .004 仍比反解值（.0033）高约 1.6 dB，拉到底**可能只差一点点**——所以这一步要配合 1824 的 `spectrum.bands.bass/mid/high` 一起看；如果拉到底仍无波，就先换一段更响的副歌或换一首曲目验证，而不是继续硬压（压过头会把底噪也当鼓点）。

**B. 若后续多首样本支持「B站 源整体比网易云低若干 dB」**
那是**选流/响度**层面的问题（B站 DASH 音轨的响度与网易云母带不同），不是门槛能完全解决的；目前只有一首，**证据不够立项**，先攒样本再谈（例如按源做响度归一——是候选方向，不是结论）。

**C. 本轮不建议动的东西**
自适应门槛 / 自动降门槛 / 静音时补呼吸波：在没搞清楚真实电平分布前，这几条会增加不确定性，且可能让“没波”变成“有假波”，与本轮“不造假反应”的口径冲突。不是说它们原理上一定错，而是**现阶段证据不够、先不立项**。

---

## 8. 已一次性补齐的字段（构建 1003131824，**未部署**；App 实际仍 1823）

上一版现场只能用 `envBass + peakDb` 反推，本轮把「判定链路的原始量」一次补齐，避免再按字段迭代：

| 新字段 | 用途 |
|---|---|
| `ripple.analysis.tune` | 现场实际门槛/浓淡（不再靠默认值猜） |
| `ripple.analysis.raw.eFast/eSlow/mFast/mSlow/hFast/hSlow` | 直接和门槛比的三频段原始 RMS |
| `ripple.analysis.raw.bf/mf/hf` + `bgBass/bgMid/bgHigh` | 瞬时谱通量与背景（不再被四舍五入吃掉） |
| `ripple.analysis.raw.pk` / `pkFloor` | 核对这两条在弱段 / 历史恢复时的真实行为 |
| `ripple.analysis.raw.lastKickAgoMs` | bass 抑制窗口是否在生效 |
| `ripple.analysis.resets.count/lastAt/lastReason` | 预热/seek/重建链是否反复重置（attach/start/seek/clear/manual） |
| `ripple.analysis.warmupLeftMs` | 是否处于预热期 |
| `ripple.spectrum.bands.bass/mid/high` | 按需读一次的三频段 RMS（与门槛同量纲） |
| `ripple.analyser.fftSize/sampleRate/binHz/minDecibels/maxDecibels/smoothing` | 分析器参数（换宿主/换采样率时能复核） |

**下一份现场只需要在播放中再复制一次诊断**，就能直接回答 §6 的三个"未证实"，不需要再改代码。

（字段仍不含 Cookie / token / 完整签名 URL / 歌单；按钮与独立窗入口不变。）

---

## 9. 复算方法（可自行复核，不需仓库工具）

```sh
python3 - <<'PY'
import math
peak_db, env_bass = -42.5, 0.874
peak = 10**(peak_db/20)          # 当刻 band RMS 上界
be   = 10**((env_bass*38-58)/10) # 仅用于 bass 的量级反解
print('当刻 band RMS 上界 %.5f | 反解 be %.5f' % (peak, be))
for name, thr, has_be in [('bass',.0137,True),('kick',.0178,True),('mid',.0178*.24,False),('hat',.0018,False)]:
    gap = '%6.1f dB' % (20*math.log10(thr/be)) if has_be else '    n/a'
    print('%5s 门槛 %.5f (%6.1f dBFS)  上界能否超过门槛: %-5s  与 bass 反解 be 的差: %s'
          % (name, thr, 20*math.log10(thr), peak > thr, gap))
PY
```

输出（本轮实测；“上界能否超过门槛”仅针对**采样那一瞬**，不代表整首歌）：

```
当刻 band RMS 上界 0.00750 | 反解 be 0.00332
bass  门槛 0.01370 ( -37.3 dBFS)  上界能否超过门槛: False  与 bass 反解 be 的差:   12.3 dB
kick  门槛 0.01780 ( -35.0 dBFS)  上界能否超过门槛: False  与 bass 反解 be 的差:   14.6 dB
mid   门槛 0.00427 ( -47.4 dBFS)  上界能否超过门槛: True   与 bass 反解 be 的差:     n/a
hat   门槛 0.00180 ( -54.9 dBFS)  上界能否超过门槛: True   与 bass 反解 be 的差:     n/a
```

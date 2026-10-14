# 涟漪本体迁移与玩具箱替换

2026-10-14 · Codex · 基线 `9b07a7d` / `1003131689` → 构建 `1003131690`，manifest 仍为 1.1.3。
用户已确认演示视觉并授权迁入本体。本轮范围是本地实现、部署和独立验收。

## 改动与需求

- `ui/app.js`：迁入演示的 bass 光波、鼓点等高线、镲片细波。删除固定 y=.44 的连续注水；bass 每次击发游移，只有 bass 脉冲进高度场。阻尼 .972，保留歌词阅读掩膜、指针、暂停 400ms 收敛、截图/离屏/reduced-motion 停调度。
- 低音、低频鼓、中频鼓、镲片分别冷却 420 / 320 / 288 / 150ms，同一帧可同时触发鼓与镲。正常音频预算十四组，超预算软退场，最终波包上限四十六。
- 密集鼓校准：FFT4096 会平滑短脉冲；kick 能量门槛之外保留 1.6 快慢包络比，并用 `ratio>1.15 && fluxRatio>2.4` 补抓密集瞬态。两条路径都需正向通量占当帧低频能量平方至少 1.5%，避免开场/鼓尾包络滞后误鼓点。该修正同步到演示，供 Hana 复跑曾出现 kick=2 的稳态反例。
- `ui/index.html` / `ui/standalone.html`：玩具箱替换为低音、鼓点、镲片三组，每组“触发门槛＋颜色浓淡”。左低门槛更多、右高门槛更少；浓淡左浅右深。旧六个控件全部移除。
- `ui/style.css`：沿用 `.pop` 和宿主色变量；面板 306px、三组 fieldset、方向提示，矮宽窗内部滚动。宽窗入口、沉浸淡出、截图隐藏不变。
- 镲片线宽 1.05px，小环最大占短边 11%，色彩目标对比 5.5，淡衬底；其余圈数、扩散、淡出和光照对齐已认可演示。生产仍用当前曲目封面/宿主主题取色，不固定为花一匁资源。
- 持久化仍为 `player-ripple-tune`，新 schemaVersion=2。旧 visualGain/bassDrive/onsetSens/midHighSens/maxAudioWaves/onsetCooldown 不迁成新的能量门槛；旧存储只回落默认，不在读取时改写。手动调节去抖保存，重置写入新默认。
- 无 manifest 扩权、无 SDK/后端/歌词/播放归属改动；官方 SDK 和 GitHub `resource.open` 修复保留。

## 玩具箱参数

| 组 | 默认门槛 | 范围 / 步长 | 默认浓淡 |
|---|---:|---|---:|
| 低音 | .004 | .0005–.014 / .0001 | 100% |
| 鼓点 | .005 | .0005–.018 / .0001 | 100% |
| 镲片 | .0003 | .00005–.0018 / .00001 | 100% |

浓淡三组均 20–180% / 5%。鼓点门槛同时管中频鼓，中频绝对能量按 .24 比例换算。浓淡只乘绘制 alpha，不改 FFT、注入、队列、音量或媒体时钟。

## 自验与证据

原始输出目录：`docs/player-ui/handoffs/ripple-production-20261014/`。

- 生产真实歌曲独立检查 6/6，运行页面是 `ui/standalone.html`，不是演示。12s 样本 bass=8、低频鼓=12、中频鼓=13、镲片=36。
- 同一八秒段比较门槛最低/最高：bass 13/0，鼓点 18/0，镲片 24/0。三组同帧浓淡对照 alpha 增长、波场/计数/队列/音量/时钟完全相同。暂停 650ms 后零波、零场、无 rAF/分析调度。见 `verify-song.json` / `verify-song.log` / `real-song-production.png`。
- 完整生产 UI 回归 384/384，零运行时错误；合成音频、玩具箱、版本/边界、旧数据兼容、真实歌及播放器其余行为均通过。见 `verify-ui.json` / `verify-ui.log`。
- 后端回归 132/132，见 `verify-backend.log`。
- 官方静态校验 0 error / 1 warning（动态运行时依赖无法由静态检查证明的常规提示），见 `validate-app.log`。仓库目录名与 manifest id 不同，校验使用临时 `hanako-simple-player` 的完整运行时副本，没有更改 manifest id。
- `node --check` 两个 JS、孪生 HTML 与 `git diff --check` 通过。

测试契约随明确的视觉变更更新：bass 现在是离散光波对象，不能再要求音频波包数=0；音频圈数改为鼓 3–9 / 镲 3–6 / bass 0；软预算为十四组活跃波；旧灵敏度控件用实际门槛行为替代。未放宽稳态低音零假鼓、静音零波、密集脉冲可识别、镲片可识别、声音和生命周期断言。

高度场 .005 的旧能量限值针对旧持续微注入，不能用于已认可的强脉冲方案。新固定 465px 夹具实测约 .28，上限 .4；保留全样本有限性及绝对能量上限。`field-damping-probe.cjs` 给同脉冲/网格的正常与去阻尼反例：.972 峰 .2002，1.0 峰 6.9183（九秒），原始日志同目录。它是数值校准对照，不替代浏览器验收。

## 独立复跑

```sh
RIPPLE_SONG='/Users/can/Downloads/B站音频/【ずっと真夜中でいいのに。】花一匁【MV／中文字幕】.m4a' \
RIPPLE_LYRICS='/Users/can/.hanako/app-data/hanako-simple-player/lyrics/花一匁.lrc' \
OUT_DIR=/tmp/hana-ripple-independent node tools/verify-ui.mjs --ripple-only
node tools/verify-lab-layers.mjs
node tools/verify-backend.mjs
```

全套去掉 `--ripple-only`；只复跑真实歌可用 `--song-only`。未设 RIPPLE_SONG 时不读取该本地音频；音频文件和本地路径不进入生产 ui/。

## Hana 部署与真实验收

请先看原始输出、独立复跑，随后完整同步 `ui/` 到安装目录并 `extension_manager reload app:hanako-simple-player`。不要省 CSS 或 sdk.js。重开旧独立窗以加载新快照。核对构建号与 `production-hashes.json`；部署后旧参数应回落上述默认。

请用真实卡片和独立窗播放花一匁（用户已提供本地音频），核对：不卡固定底纹、镲片可见、三组门槛/浓淡、自动保存后重开保持、重置、暂停/换歌清场、窄卡/矮宽窗溢出、Hana 深浅主题。源码归 Codex；Hana 写 `RIPPLE-PRODUCTION-ACCEPT.md` 及独立原始证据，失败给具体断言和画面。真实宿主与假宿主的证据分别记，开始处理不等于验收通过。

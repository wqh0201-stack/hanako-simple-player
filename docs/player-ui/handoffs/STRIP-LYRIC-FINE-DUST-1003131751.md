# 横条歌词「细光尘化开」候选 · build 1003131751

> **历史候选已被用户否定**：本篇无辉光细点不是当前方向。后续改为进度条同款星光，完整交接见 [1003131755](STRIP-LYRIC-STAR-FAMILY-1003131755.md)，新专项已 30/30，不再受旧 `.is-star` 等待阻塞。

日期：2026-10-16。仅本地实现，**未部署、未 reload，尚未获用户视觉验收**。

## 方向与依据

罐头对上版反馈「太强烈、不像消散、很刻意」，本会话进一步明确：**像已有星星进度条那样星光化开，很细**。

先检查旧静帧与录屏抽帧。旧版 4.4px 星点 × 2.1 倍缩放、十字延伸及 24px 光晕，实际视觉面积远大于标称粒径；反复高低交替的 16 段 mask 也形成条纹切割感。本轮去掉这些形状，不以降低整组透明度代替换方向。

## 本轮修改范围

- `ui/app.js`：仅 strip 段中的时长模型、细光尘生成、旧句离场关键帧和两处新句淡入 duration。
  - 普通 6 粒，312px 档 3 粒；粒径 1–1.7px，不放大；峰值 alpha 0.62–0.78，经父层透明度后更低。
  - 沿用进度条 `--strip-star-*` 派生色；无 `.is-star` / `.is-glowing`、无十字和 box-shadow。
  - 字形 Range 定位沿用；小幅错开出生时间，水平漂移 ±2.5px、上浮 3–7px，不再爆开。
  - 旧字仅 opacity / maskPosition / filter 变化，微量 blur 0 → 1.2px；当前句仍只淡入，未加 transform。
  - 时长保留 lead、快常慢单调性及下一句窗口封顶，但明显收短；保证 `particles >= lead + appear + 16ms`，防止收尾清理提前取消新句淡入。
- `ui/style.css`：仅歌词消散/光尘段。16 段锯齿改成单宽羽化渐变；删除十字伪元素和大光晕。
- `ui/_build.json`、`ui/index.html`、`ui/standalone.html`：运行 `node tools/bump-build.mjs`，三处最终为 `1003131751`；HTML 只改构建号。

**未改** `tools/`、`lib/register-routes.js`、HTML 的 `#unavailablePop`、播放失败处理段、进度条星光或任何部署文件。通过本轮开始前文件副本逐段比较，歌词段外的 app.js/CSS 完全不变；测试文件亦与本轮开始时一致。工作树原有其他会话的改动全部保留。

### 时长例子（ms）

| 节奏 interval / nextInterval | dissolve | lead | appear | particles |
|---|---:|---:|---:|---:|
| 快 0.45 / 0.45s | 209 | 79 | 146 | 269 |
| 常 1.2 / 1.2s | 258 | 98 | 173 | 318 |
| 慢 3.2 / 4s | 388 | 147 | 245 | 448 |

## 实际验证

1. `node --check ui/app.js`：通过。
2. `git diff --check`：通过。
3. 构建号三处一致、孪生 HTML（归一化 `data-shell` 后）完全一致：通过。
4. 直接提取生产时长函数，7 种当前句间隔 × 7 种下一句间隔共 **49 组**：时长为正、粒子覆盖旧句、`lead + appear + 16 <= particles` 均通过。
5. `OUT_DIR=/tmp/hap-strip-fine-interaction node tools/verify-ui.mjs --interaction-only`：**27/27**，`runtimeErrors: []`。
   - 原始报告：`/tmp/hap-strip-fine-interaction/verify-player-interaction.json`。
6. `node tools/verify-ui.mjs --strip-lyrics-only`：**未完成，不能算 18/20 或 20/20**。
   - 现有 `tools/verify-strip-lyrics.mjs:179` 在第一个视觉断言前等待 `.strip-lyric-dust .is-star` 的 opacity > 0.45；新方案不生成十字星，该等待 500ms 超时，退出码 1。
   - 最终 build 1751 用独立目录重跑，同一原因中断；未生成新 transitions.json / 专项报告。`/tmp/hap-verify/` 的旧 JSON、旧完整录屏不得当作本版证据。
7. Impeccable detector：仅报 style.css:421 原有 bounce-easing advisory，位于本轮范围外，未改。

### 本版视觉产物（仅首个转场预览）

`/tmp/hap-strip-fine-1003131751/strip-lyrics/`：

- `fine-dust-preview.mp4`：由本版失败运行留下的真实 Chrome screencast PNG 帧编码，720×128，名义 60fps，103 帧 / 1.717s，**不是完整歌词专项录屏**。
- `fine-dust-contact.png`：首个转场局部放大分镜。
- `fine-dust-frame.png`：预览的一个静帧。
- `motion-frames/`：原始 PNG 帧。

已查看修改前后的转场抽帧。候选视觉从大星芒变为轻柔化开，细点不再抢过文字；是否达到罐头要的细星光，仍需真实宿主实听验收。资料库 mount 的 materialize 被能力闸门拒绝，故本轮媒体保留在上述 /tmp 证据目录并通过 stage_files 交付，未绕行写入资料库。

## 测试所有者需适配的视觉检查

只需要改视觉方案耦合处，不应放松生命周期契约：

- `dustLive()` 与首段 `waitForFunction`：采样 `.strip-lyric-dust > span`，不再等待 `.is-star`。
- `SL-star-points-are-visibly-lit`：改为细光点存在、低密度/小粒径、有可见峰值且无十字伪元素/强光晕；不要继续要求 14 粒、≥4 十字星或大 box-shadow。
- `SL-natural-transition-has-local-mask-and-particles`：保留旧句、mask、关键帧和粒子存在；去掉星芒 class / `starCore` 要求。
- `SL-narrow-dust-is-limited-and-contained`：窄档粒子非零且少于普通档、留在 stripBar 边界内，不再要求固定 7 粒及 ≥2 十字星。
- 既有相对时长、当前句 transform=none、同刻分组、跨组不补播、seek、暂停、hover、隐藏、切歌、退出 strip、reduce-motion 等断言应全部保留并完整跑通。

我遵守 tools 只读隔离，没有自行改断言。给测试归属会话的协作消息仍经过平台确认卡，不能把草稿视为已交付；发给 DeepMind 的中途协作回执曾被中止。交接后请统筹确认接收并安排测试适配，再跑完整专项及真机验收。

## 待验与风险

- 本轮交互专项全绿不等于歌词专项已通过；后半段自然播放中断场景、312px 动态边界与 reduced-motion 等尚未在新视觉下完整复跑。
- 本次没有重写媒体时钟/lead 预约/清理路径；它们的既有逻辑保留，但缩短时长后仍需完整专项检查时序。
- 不部署、不 reload；生产仍是哪一版由统筹核对，不由本地构建号推定。

可复用经验已补入知识库：`20-资料/动效配色-在任意背景色上都不被吃掉.md` §六，并刷新知识图谱。

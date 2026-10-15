# Touch Bar · 前沿柔光与星光流动

2026-10-15。版本 **1.1.7**，最终构建 **1003131723**。

本轮在用户认可的浓星光版上实现已确认交互，并纳入中途修正：**前沿渐变拉长，光芯是封面亮色略微泛白，保留色相并自然融合。** 未联系 Hana，本轮部署/重载由用户转达。

## 最终行为

| 状态 | 前沿光效 | 星光 |
| --- | --- | --- |
| 正常播放 | 常驻柔和亮带，跟随真实进度 | 从当前进度前沿向左持续流动，1× |
| 点击/按下未拖动 | 封面色泛光 | 轻微加速至 1.25× |
| 实际拖动 | 泛光增强、范围扩大 | 达到 3.8×；按下后位移不足 4 CSS px 不进入高速 |
| 松手 | 光晕渐收，恢复常态亮带 | 1.4 秒内以 cubic ease-out 平滑降回 1× |

快速点击（down/up 很接近）也有独立释放泛光，避免 CSS 将同帧 0→0 的透明度变化合并，导致只有按住才看得到光。

保留之前的旧版满进度常驻底色、封面亮色选取、100% 样片浓度，以及 36/24/12 颗星光的响应式密度。其他 UI、按钮、歌词、音量、时间显示与真实 seek 路径保持现状。

## 前沿的长度与颜色

- 上层进度羽化由 10px 延长至 **20–44px**（随条宽适配）。只在真实进度前沿向内羽化，不改变进度值。
- 常态亮带宽 **36–72px**（620px 条宽时约 56px），全高贯通并柔和衰减；拖动时横向略扩。
- 交互光晕宽 **140–220px**（620px 条宽时约 161px），拖动时再扩展。
- 两个封面亮色混合成前沿色；光芯为 **76% 封面亮色 + 24% 主题近白色**，外晕仍是封面色向透明衰减。没有以纯白作为渐变终点，也没有覆盖整片白纱。
- 全部装饰无指针事件，位于现有 seek 与内容之下；前沿自带圆角裁切，不因音量浮层放开 overflow 而溢出。

## 实现位置

| 文件 | 改动 |
| --- | --- |
| `ui/index.html` / `ui/standalone.html` | 36 个星点各增加一个非交互 `.strip-flight` 轨道；新增 `#stripFront`、`.strip-front-band`、`.strip-front-glow`。未移动已有控件；孪生文件仍只差 body `data-shell`。 |
| `ui/style.css` | 轨道 CSS Keyframes 持续向左位移；星点原有呼吸/星芒保留。新增前沿亮带、三档交互、释放泛光和 reduced-motion 规则。 |
| `ui/app.js` | 新增 seek 手势状态、动画速率缓存和有限减速控制；接入已有交互退出、布局、页面/SDK 可见性及播放事件。新增只读测试钩子 `stripFlowState()`。 |
| `ui/_build.json` | 已运行 `tools/bump-build.mjs`，三处构建号为 1003131723。 |
| `tools/verify-strip-flow.mjs` | 新增 19 条真实手势、方向位移、速度、可见性与录像验证。 |
| `tools/verify-album-ambient.mjs` / `tools/verify-ui.mjs` | 原背景套件保留，增加专项入口与新专项组合执行；星点计数看真实布局盒，适应新增轨道父节点。 |
| `tools/inspect-album-ambient.py` | 保留原色场羽化检查；新常驻亮带单独验收，色场边界采用只临时隐藏亮带的额外截图，未放宽像素阈值。 |

层次：

```text
#stripBar
├─ .strip-field-quiet                旧满进度底色，未变
├─ #stripPlayed                     原真实进度裁切 + 羽化
│  ├─ ::before / ::after             原有封面彩光
│  └─ .strip-sparkles
│     └─ .strip-flight × 36         从前沿到左端的 CSS 飞行轨道
│        └─ .strip-spark             原有彩色星点与呼吸
├─ #stripFront
│  ├─ .strip-front-glow              点击/拖动泛光
│  └─ .strip-front-band              常态亮带
└─ 原有 range、身份、歌词、控制按钮和时间
```

轨道的百分比宽度只定义**星点飞行路程**，渐变色场仍保持全宽，没有被压缩。CSS 完成持续位移；`Animation.updatePlaybackRate()` 只改变现有飞行动画的速率，保留当前时间/相位，不重建动画或重置位置。

**唯一新增 rAF 是松手后 1.4 秒的有界速率回落。** 不绘制粒子、不逐帧读取 DOM 几何、不改复杂渐变；结束就取消调度。常态和持续拖动期间没有新增 JS 帧循环。

## 生命周期

- 正常暂停冻结星光；在暂停中主动 seek 时给一次有界交互反馈，回落结束后再次冻结。
- 页面隐藏、SDK hidden、离开 strip/视口、pagehide、reduced-motion：清除手势/减速调度，恢复 1×，停止非必要动画。
- resize 按现有断点更新轨道缓存，不重采样封面；显示新轨道时采用当前速率。
- 音量按下/拖动不触发 seek 加速；原生 range、音频所有权与播放控制仍用既有实现。

## 自验与原始输出

证据目录：`docs/player-ui/handoffs/album-ambient-flow/`。

| 检查 | 最终结果 | 原始证据 |
| --- | --- | --- |
| 原背景 101 项 + 新交互 19 项 | **120/120**，0 runtime errors | `ambient-output.txt`、`final/verify-album-ambient.json` |
| 原有 Touch Bar 回归 | **131/131**，0 runtime errors | `touchbar-output.txt`、`regression/verify-touchbar.json` |
| 渲染像素（含旧底色对照） | **18/18** | `pixel-output.txt`、`final/ambient/pixel-inspection.json` |
| 相比 1720 的控件几何对照 | **80/80** 一致 | `geometry-comparison.json` |
| 官方静态校验 | **0 errors / 1 warning**（静态工具不证明动态依赖的常规提示） | `validate-app.json` |
| 孪生 HTML、JS 语法、diff whitespace、整包哈希 | 通过 | 最终检查；`source-sha256.json` |

19 条新专项包含：真实星点持续向后位移、常态亮带/无外晕、点击 1.25×、前沿跟随真实 seek、微小抖动不算拖动、实际拖动 3.8×、切速不重置动画时间、松手逐渐降速/收光、快速点击有可见泛光、音量不加速、真实 Page Hidden 清理、高速时切 reduced-motion 清理、恢复常速、0%/100% 边界、窄幅 12 轨道、暂停 seek 收尾冻结及录屏三档速度。

`direction-first-report.json` 保留一次新增方向断言的假红：当时筛掉所有已经走过 80% 路程的正常星点，样本恰剩 27，低于要求 28。最终只筛掉**实际发生循环回前沿**的点；仍要求至少 28 颗、且每一颗的相位和相对前沿的距离都实际增加，没有放宽数量/位移阈值。最终 120/120。

本轮未重跑其他全量 606 条；不将旧构建的全量结果算作本构建结果。

复跑：

```sh
OUT_DIR=docs/player-ui/handoffs/album-ambient-flow/final node tools/verify-ui.mjs --album-ambient-only
OUT_DIR=docs/player-ui/handoffs/album-ambient-flow/regression node tools/verify-ui.mjs --touchbar-only
python3 tools/inspect-album-ambient.py docs/player-ui/handoffs/album-ambient-flow/final/ambient
# 仅复跑新交互：node tools/verify-ui.mjs --strip-flow-only
```

## 动画与截图

- **`final/flow/strip-flow-interaction.gif`**：10 秒动态预览，顶部英文状态/速率是录屏注释，不属于产品 UI。
- **`final/flow/strip-flow-interaction.mp4`**：原始无注释录像。
- `final/flow/motion-frames/timestamps.json`：逐帧真实媒体时间、手势、CSS 播放速率、光晕透明度与星点位移。
- `final/flow/recording-pixel-check.json`：暂停后 **8540–9916ms** 的原始画面逐像素完全一致。
- `final/flow/01-normal.png`、`02-click.png`、`02b-quick-click.png`、`03-drag.png`、`04-settled.png`：交互静态对照。
- `final/ambient/overview-{light,dark}-{720,312}.png`：四类封面 × 两态 × 三进度总览；原始矩阵覆盖五进度，共 160 张主截图，另保留 16 张只隐藏前沿的色场截图。

## 宿主交接

本轮没有改后端、manifest、权限、用户数据、版本或许可证，没有提交/发布，没有联系 Hana。

**本轮未执行生产同步或 reload。** 以上为本地 Puppeteer 假宿主中的真实原生媒体/手势证据，不能替代真实 Hana 卡片目视验收。

可转发：

> Codex 已完成前沿柔光和星光流动，最终 build **1003131723**。请读 `docs/player-ui/handoffs/ALBUM-AMBIENT-FLOW-DONE.md`，按 `album-ambient-flow/source-sha256.json` **整包同步 ui/ → extension_manager reload app:hanako-simple-player → 核对新快照 build 1003131723**。用户已确认：常态亮带与缓流、点击略加速并泛光、实际拖动明显加速、松手渐降；前沿需更长，颜色是封面亮色略微泛白，保留色相。请用户在真实横条里目视确认；不替用户决定视觉强度，不顺手改其他 UI。如有具体失败，把动作、截图及构建号交用户转回 Codex。

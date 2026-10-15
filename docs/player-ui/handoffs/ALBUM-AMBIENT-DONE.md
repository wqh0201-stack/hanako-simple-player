# Album Ambient Progress Bar · Codex 交接

日期：2026-10-15。版本保持 **1.1.7**，构建 **1003131719**（本轮起点 1003131718）。

用户最新要求优先：移除鼠标操作进度条后的整条圈，以及底部进度点；用参考图的封面氛围进度背景替换。附件旧文中的「不影响原有进度圆点」已被这条明确修正覆盖。

本轮不联系 Hana，由用户转达。已有全部在途 Touch Bar 修改保留，未提交 Git，未改版本、manifest、后端、用户播放数据或许可证。

## A. 文件与调用点

| 文件 | 本轮变更 |
| --- | --- |
| `ui/app.js` | `stripColorField()` 从原有六区取色派生 Base / Active / Glow；`applyAmbient()` 写入三组深浅变量；`applyAmbientPending()` 清除旧横条色场；`renderStripInner()` 写真实进度端点状态；新增 `syncStripAmbient()` 只控制 CSS 动画启停；接既有 SDK 生命周期、真实 audio 事件、页面事件与横条可见性；删鼠标 seek 焦点圈的两条监听。 |
| `ui/style.css` | `.strip-field-quiet`、`.strip-field-played`、进度 mask、`.strip-sparkles` / `.strip-spark`、两组 keyframes、主题变量桥与 reduced-motion；删除 `.strip-seek-dot`；保留键盘进入 bar 的 `:focus-visible` 提示。 |
| `ui/index.html` / `ui/standalone.html` | 只在 `#stripPlayed` 内增非交互装饰节点，删除进度点；其余现有控件 DOM 未移动。两文件只差 body 的 `data-shell`。 |
| `ui/_build.json` | 已运行 `node tools/bump-build.mjs`，三个构建标记一致。 |
| `tools/verify-ui.mjs` | 保留起点已有修改；增加四组封面夹具、背景专项入口 `--album-ambient-only`。原有断言没有删改。 |
| `tools/verify-album-ambient.mjs` | 新专项：160 张截图、主题/媒体/seek/生命周期/独立动画/切歌/缓存验收与录像。 |
| `tools/inspect-album-ambient.py` | 用环境已有 Pillow 检查渲染像素，生成四张总览；没有安装依赖。 |

## B. 最终图层

```text
#stripBar                         原尺寸、原内容与交互布局
├─ .strip-field-quiet             全条 Base 封面色场
├─ #stripPlayed                   全尺寸 Active 色场，裁切 + 进度 mask
│  ├─ ::before                    局部 Glow（同样受进度 mask 限制）
│  └─ .strip-sparkles
│     └─ .strip-spark × 7          稳定位置，按宽度隐藏多余点
├─ #stripSeek                     原生 range，原 seek 逻辑，z-index:1
├─ .strip-identity / .strip-context 原文案、歌词和所有控件，z-index:2
└─ .strip-time                    原时间显示
```

装饰层全部 `pointer-events:none`。未新增可见按钮或移动控件。

## C–E. 取色、渐变与羽化

- 继续由 `probeAmbient()` 将封面画到 **40×40 Canvas**；`stripColorField()` 仍只采 **2×3 六区**。新派生只消费这六个 HSL 代表色，保存在原有 `ambientCache` 中。
- Base 和 Active 的六个 radial-gradient 坐标完全一致；容器都始终为条的完整尺寸。Base 保留较低饱和度，Active 保留更多封面饱和度；两者分别生成浅/深主题配色。没有按粉/绿写生产配色，没有全块 brightness 滤镜，没有叠高透明白层。
- 进度继续来自原有 `liveProgress()` / `trackDuration()`，写 `--strip-fill`；没有第二个时钟。
- 保留 `clip-path` 兜底；支持 mask 时在真实进度位置向内羽化 **8px**。0% 隐藏 Active；100% 撤掉尾部 mask，避免满进度残留淡边。未扩大可见进度范围。
- 换封面时只先清除旧横条变量，随后由原有 token 检查与缓存结果换色。等待中用主题兜底，不保留上一首色场。

## F–H. 星光与生命周期

- 七个固定装饰 span；位置为整条的 8%、63%、31%、77%、45%、91%、19%，沿顶部/底部留白分布。没有每帧测字、随机重建、粒子 Canvas 或新 rAF。
- 620px 条宽显示 **7 颗**；中等宽度 **4 颗**；212px 条宽 **2 颗**。随真实进度逐渐揭示，0% 不显示。
- 大部分 **1–2px**；只有一颗允许最多 5px 的低透明四角微芒，窄幅不显示它。
- 七个独立周期 **4.8–8.9 秒**，不同负延迟；透明度 **0.16–0.52**，位移每轴最多 2px。光晕 **12 秒**一周期，透明度 **0.10–0.22**，局部渐变来自同一封面。
- 正在播放且当前横条可见时运行；暂停保留当前静态色场和微光，动画时间冻结；恢复播放续接相位。seek 立即更新原进度裁切。
- SDK hidden、真实浏览器 Page Hidden、pagehide、离开 strip 布局和离开视口均暂停；恢复时按真实 audio 状态重判。`prefers-reduced-motion:reduce` 关闭 keyframes，保留静态背景和进度。
- 封面、标题/歌手、歌词字体/高光、按钮、SVG、音量、控件间距和响应式掉队规则沿用起点实现。所有实际播放控制仍转给既有控制器。

## I. 自动化与原始输出

命令均从仓库根执行：

```sh
OUT_DIR=docs/player-ui/handoffs/album-ambient/baseline node tools/verify-ui.mjs --touchbar-only
OUT_DIR=docs/player-ui/handoffs/album-ambient/regression node tools/verify-ui.mjs --touchbar-only
OUT_DIR=docs/player-ui/handoffs/album-ambient/final node tools/verify-ui.mjs --album-ambient-only
python3 tools/inspect-album-ambient.py docs/player-ui/handoffs/album-ambient/final/ambient
OUT_DIR=docs/player-ui/handoffs/album-ambient/full node tools/verify-ui.mjs
```

| 检查 | 结果 / 原始输出 |
| --- | --- |
| 修改前 Touch Bar 基线 | **131/131**；`album-ambient/baseline/verify-touchbar.json` |
| 修改后既有 Touch Bar 回归 | **131/131**；`album-ambient/regression/verify-touchbar.json` |
| 背景专项 | **97/97**，0 runtime errors；`album-ambient/ambient-output.txt`、`album-ambient/final/verify-album-ambient.json` |
| 渲染像素 | **16/16**；`album-ambient/final/ambient/pixel-inspection.json`，未播放区保持底色、左侧变化、满进度染色、边界逐像素平滑、无整体过曝 |
| 起点/改后几何对照 | **80/80** 一致；`album-ambient/geometry-comparison.json`（8 宽度 × 两态 × 封面/条/身份/两档字号） |
| 孪生 HTML、JS 语法、diff whitespace | 通过 |
| 官方静态校验 | **0 errors / 1 warning**；`album-ambient/validate-app-staged.json`。warning 为静态工具不证明动态依赖的常规提示。 |
| 全量 UI 回归 | **606/606** 断言、**12/12** 自检、**4/4** 窄卡，0 runtime errors，exit 0；`album-ambient/full-output.txt`、`album-ambient/full/verify.json`。其中包含最终构建的既有 Touch Bar 回归。 |

静态校验需复制到 `/tmp/album-ambient-validation/hanako-simple-player`（目录名与 manifest id 一致）。直接对源码目录名 `hanako-audio-player-simple` 校验会触发既有目录名约束；保留初次输出 `album-ambient/validate-app.json`，未改 manifest 规避检查。

`album-ambient/source-sha256.json` 保存最终整包 `ui/` 的 8 个文件哈希，供部署后逐一核对。全量输出末尾的 lrc/load 404 和主动终止媒体 ERR_ABORTED 为原有夹具的预期探测记录，`runtimeErrors` 与失败断言均为空。

背景专项真实通过 SDK 的 `hana.theme.changed` 事件切主题；初跑的测试夹具仅改 CSS 变量，没有发主题事件，等待 `data-tone` 超时。已修正新增测试入口后完整复跑通过，未改变生产主题逻辑，也未放宽旧断言。

## J. 截图

目录：`docs/player-ui/handoffs/album-ambient/final/ambient/`

- 160 张原始截图：4 组真实像素封面夹具 × 浅/深主题 × 720/312px 视口（条宽 620/212px）× 0/25/50/75/100% × 歌词/控件态。
- `overview-light-720.png` / `overview-dark-720.png`：宽幅 0/50/100% 总览。
- `overview-light-312.png` / `overview-dark-312.png`：最窄幅总览。
- `evidence.json`：每组的样式、真实媒体时间、采样次数、动画时间与状态。

## K. 动画

- `album-ambient/final/ambient/album-ambient-play-pause.mp4`：约 **9 秒**，前 **6 秒真实播放**、后 **3 秒暂停**。66 张原始帧，以时间戳编码成 24fps MP4，未安装新库。
- `album-ambient/final/ambient/motion-frames/`：原始 PNG、`timestamps.json`、ffconcat 清单；可核对媒体时钟推进与暂停动画冻结。
- `verify-album-ambient.json` 中 `ambientRecording.ok = true`。
- `recording-pixel-check.json`：暂停后的 **6591–8915ms** 原始帧逐像素完全一致；播放媒体时钟从 7.5 秒推进至约 12.447 秒（录像约第 5 秒）。

## L. 已知边界与宿主交接

当前本地专项无已知失败。上述媒体、SDK 和界面自动化运行在工程已有的 Puppeteer 假宿主设施中，不能替代真实 Hana 卡片与拆窗验收。

**本轮尚未同步生产 ui/，未 reload，未进行真实宿主验收。** 当前工具目录没有 Hana 的 `extension_manager` / Builder 入口；遵照用户「本次不用联系 Hana，完成后由用户转达」的安排，交接到此等待宿主侧。不能把本地截图标成已部署效果。

可直接转发给 Hana：

> Codex 已完成 Album Ambient Progress Bar（移除整条鼠标 seek 圈和底部点），仓库 `/Volumes/SSD/hanadesk/hanako-audio-player-simple`，build `1003131719`，版本仍为 `1.1.7`。请读 `docs/player-ui/handoffs/ALBUM-AMBIENT-DONE.md` 与其中原始输出，独立复跑验证，再 **整包同步 ui/ → extension_manager reload app:hanako-simple-player → 核对新快照 build 1003131719**。请验真实聊天卡片与独立窗：粉/绿/多色/暗封面、深浅主题、0/25/50/75/100%、歌词/控件态、最窄幅、真实 seek、暂停/切歌/隐藏/reduced-motion，确认已无底部点和鼠标 seek 整条圈。不要只同步 HTML 或遗漏 style.css，不要顺手改其他 UI；仅将独立验收证据写到 `docs/player-ui/handoffs/ALBUM-AMBIENT-ACCEPT.md`，有失败给出动作序列、构建号和截图，交回用户转给 Codex 返修。

本轮严格限于 **Touch Bar 的进度背景及用户点名移除的圈/底部点**；实现完成后停止，不继续规划其他播放器 UI。

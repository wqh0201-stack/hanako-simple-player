# Album Ambient · 浓星光样片

2026-10-15。版本保持 **1.1.7**，build **1003131720**。

本稿接替 build 1003131719 的视觉方案。用户指出上一轮把 Base 做浅了，明确要求：**旧版满进度效果常驻，上面覆盖浓一些的动态星光和彩光；色彩用封面中较亮的颜色，先做浓版，再由用户指定强度百分比。** 因此不再采用上一轮的浅 Base + 浓 Active 换色方案，也不沿用旧任务书 4–7 颗弱星光的密度。

## 实现

- `ui/app.js`：`stripColorField()` 的底色色场恢复到 build 1003131718 的原始算法（六区坐标、原饱和度，浅色 .79/.83、深色 .24/.22 的明度）。仍用原有 `probeAmbient()` / 缓存 / 40×40 Canvas。
- 亮色来自**同一批六区像素**：每区排除低饱和灰白高光，选得分较高的前 30% 样本，再交给已有 `dominantColor()`；不增加封面解码或 Canvas 采样。上层色相由这些亮色决定，低亮度封面的上层单独提亮，底层保持旧效果。
- `ui/style.css`：`.strip-field-quiet::before/::after` 常驻复现旧版满进度的两次合成（每层封面渐变 + 38% 宿主面色，分别 opacity .10 / .88）。它不受播放进度或特效浓度影响。
- `#stripPlayed` 现在是**透明特效容器**。内部两层彩光和星光受真实 `--strip-fill` 控制，边界向内羽化 10px；不再铺一张新的不透明 Active 底色。
- 两层彩光分别用 **7.6 秒 / 10.3 秒**周期做局部呼吸和交织，opacity .36–.76 / .24–.48，水平位移约 20px；没有实时 JS 粒子循环。
- `.strip-spark`：620px 条宽 **36 颗**，中档 **24 颗**，212px 条宽 **12 颗**。核心 1.1–2.8px，带封面彩色光晕；每六颗一颗有小型四角星芒。周期约 **2.4–5.9 秒**、独立负延迟，opacity .18–1，位移最多约 6px。稳定位置已写在装饰节点中，进度更新不重新生成。
- 星光中心文字带用轻量 alpha mask 衰减，装饰全为 `pointer-events:none`，仍位于原有 range 和文案/控件下方。
- `ui/index.html` / `ui/standalone.html`：只把原有 7 个装饰 span 换成 36 个带固定参数的装饰 span，未移动现有控件。孪生文件依然只差 body `data-shell`。
- 生命周期沿用上一轮：真实播放时运行；暂停冻结当前相位；SDK 隐藏、Page Hidden、pagehide、离开横条/视口时停；reduced-motion 关动画。鼠标 seek 整条圈、底部进度点继续保持移除。

## 后续百分比

默认样片为 **100% 特效强度**：

```css
.strip-bar { --strip-intensity: 1; }
```

用户要 40% 时只改为 `.4`。这一个值统一控制**整个上层彩光与星光**的透明度，不改常驻底色，不改真实播放进度，不新增按钮或设置界面。

最终层次：

```text
#stripBar
├─ .strip-field-quiet
│  ├─ ::before    旧版 quiet 合成，全宽
│  └─ ::after     旧版 100% played 合成，全宽
├─ #stripPlayed   上层强度 × 真实进度 mask
│  ├─ ::before    亮封面彩光 A
│  ├─ ::after     亮封面彩光 B
│  └─ .strip-sparkles → 36 个稳定星点
└─ 原有 seek、标题/歌手、歌词、控制按钮、时间
```

## 自验

原始输出目录：`docs/player-ui/handoffs/album-ambient-strong/`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 背景专项 | **101/101**，0 runtime errors | `ambient-output.txt`、`final/verify-album-ambient.json` |
| 既有 Touch Bar 回归 | **131/131**，0 runtime errors | `touchbar-output.txt`、`regression/verify-touchbar.json` |
| 封面相关回归（含原有前置歌单验证） | **75/75**，0 runtime errors | `covers-output.txt`、`covers/verify-covers.json` |
| 渲染像素检查 | **18/18** | `pixel-output.txt`、`final/ambient/pixel-inspection.json` |
| 与上一轮控件几何对照 | **80/80** 完全一致 | `geometry-comparison.json` |
| 官方静态校验 | **0 errors / 1 warning**（工具不证明动态依赖的常规提示） | `validate-app.json` |
| 孪生 HTML、语法、diff whitespace | 通过 | 本轮最终检查 |

本轮像素验收新增旧版满进度参考：关掉特效后，直接用旧版原始 CSS 画出 100% 参考，与新常驻底色在整条内部逐像素对照（排除外围圆角抗锯齿）。浅色最大通道差 **1/255**，深色 **2/255**，为合成舍入误差；不再是上一轮明显偏浅的另一张底。

`pixel-first-output.txt` 保留首次对照夹具失败：参考层的普通 class 规则被生产 `data-progress="empty"` 隐藏规则覆盖。已把**测试参考样式**改用 `#stripPlayed`，使 0% 时也能绘制旧 100% 参考，完整复跑后 18/18；生产实现和像素阈值未因此修改。

上一轮 Hana 独立报告记录的媒体计时断言抖动已修正测试等待：仍断言媒体和 CSS 动画都推进，但使用有界的真实媒体条件等待，避免 seek 后固定 280ms 缓冲窗口导致假红。未删除原有断言。

本轮针对背景、交互、跨布局和封面链路复跑；**未重跑全量 606 条**（606/606 是 1719 基线，不能算作本构建结果）。

复跑命令：

```sh
OUT_DIR=docs/player-ui/handoffs/album-ambient-strong/final node tools/verify-ui.mjs --album-ambient-only
OUT_DIR=docs/player-ui/handoffs/album-ambient-strong/regression node tools/verify-ui.mjs --touchbar-only
OUT_DIR=docs/player-ui/handoffs/album-ambient-strong/covers node tools/verify-ui.mjs --covers-only
python3 tools/inspect-album-ambient.py docs/player-ui/handoffs/album-ambient-strong/final/ambient
```

## 视觉产物

均位于 `album-ambient-strong/final/ambient/`：

- **`album-ambient-strong.gif`**：约 9 秒，前 6 秒真实播放，后 3 秒暂停，浓度 100%。
- **`album-ambient-play-pause.mp4`**：原始 24fps 编码录像，65 张实际采集帧，含时间戳；GIF 从该录像转换。
- `motion-frames/timestamps.json`、`recording-pixel-check.json`：暂停后 **6624–8951ms** 的画面逐像素完全一致。
- **`strength-comparison.png`**：同一旧底色上的 0 / 35 / 70 / 100% 特效强度静态参考；0% 特效强度与 0% 播放进度是两个独立量。
- `overview-{light,dark}-{720,312}.png`：四类封面 × 两态 × 0/50/100% 总览。
- 160 张原始截图覆盖 4 类封面 × 两主题 × 两宽度 × 五进度 × 歌词/控件态。
- `base-restored-{light,dark}.png` / `base-legacy-full-{light,dark}.png`：新常驻底色与旧满进度参考。
- `source-sha256.json` 位于上一级证据目录，保存最终整包 ui/ 八个文件哈希。

## 部署与范围

保留所有已有工作树修改，未改后端、manifest、音频/进度控制、用户数据、版本或许可证，未提交/发布。

**build 1003131720 尚未部署或 reload，也未联系 Hana。** 1719 的已部署状态见上一轮独立验收报告，不等于本样片已加载。按用户安排由用户转达：请 Hana 整包同步 `ui/`，再 `extension_manager reload app:hanako-simple-player`，核对新快照 build **1003131720** 及本目录哈希后，由用户目视设定下一轮强度百分比。只需部署与重载，不必代替用户决定视觉浓度，也不要修改其他 UI。

本轮只做用户指定的浓度样片，完成后停止，等待用户反馈。

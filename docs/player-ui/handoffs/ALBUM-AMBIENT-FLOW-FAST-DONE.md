# Touch Bar · 加快星光与提高前沿泛白

2026-10-15，版本 1.1.7，构建 **1003131724**。承接 `ALBUM-AMBIENT-FLOW-DONE.md` 的 1723 版；用户要求「动太慢了，以及最前沿的泛白不够白」。本轮未联系 Hana，交由用户转达。

## 改动

- `ui/index.html` / `ui/standalone.html`：36 条星光轨道的周期及负延时均除以 **2.5**，保留原相位分布，整体向左流速提高至原来的 2.5 倍。周期由 13.000–20.847 秒缩至 5.200–8.339 秒。
- `ui/style.css`：前沿光芯由 76% 封面亮色 + 24% 主题近白色，改成 **45% 封面亮色 + 55% 主题近白色**；常态亮带透明度从 .65 提高至 **.85**。外晕仍使用封面色向透明衰减，亮带宽度沿用上轮。
- `ui/_build.json` 与两个 HTML：运行构建号脚本，三处一致为 1003131724。

点击 1.25×、实际拖动 3.8×、松手 1.4 秒平滑降速的相对倍率与状态逻辑沿用上轮。因此点击与拖动也随新的基准速度一起变快。未改 `ui/app.js`、底色、歌词、布局、按钮、音量、真实 seek 路径或主题来源。

## 验证

原始输出在 `docs/player-ui/handoffs/album-ambient-flow-fast/`，未覆盖上轮证据。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 背景与真实交互专项 | **120/120**，0 runtime errors | `ambient-output.txt`、`final/verify-album-ambient.json` |
| 既有 Touch Bar 回归 | **131/131**，0 runtime errors | `touchbar-output.txt`、`regression/verify-touchbar.json` |
| 真实位移与 1723 比较 | 30 条未跨循环的同一轨道平均 **2.494×**（目标 2.5×，采样时钟误差） | `speed-and-base-comparison.json` |
| 暂停画面 | 8552–9920ms 的 14 帧逐像素一致 | `final/flow/recording-pixel-check.json` |
| 官方静态校验 | 0 errors / 1 常规动态依赖提示 | `validate-app.json` |
| 孪生 HTML、JS 语法、diff whitespace | 通过 | 最终本地检查 |
| 渲染像素抽查 | **17/18**；保留 1 项微差失败，见下文 | `pixel-output.txt`、`final/ambient/pixel-inspection.json` |

像素抽查中，16 组背景羽化/未播放区检查全部通过；深色旧底色对照通过。浅色旧底色对照的单通道最大差为 **4/255**，超出原断言 **2/255**，各通道平均差均小于 **1/255**。与 1723 的浅色底色截图比较也有最大 4/255 的差异，深色则完全一致。本轮没有修改底色源码，也没有放宽断言；保留此项渲染微差，真实宿主中需目视复核。

本轮没有重跑全量 606 项，也没有将其他构建的结果算入本构建。

复跑：

```sh
OUT_DIR=docs/player-ui/handoffs/album-ambient-flow-fast/final node tools/verify-ui.mjs --album-ambient-only
OUT_DIR=docs/player-ui/handoffs/album-ambient-flow-fast/regression node tools/verify-ui.mjs --touchbar-only
python3 tools/inspect-album-ambient.py docs/player-ui/handoffs/album-ambient-flow-fast/final/ambient
```

## 预览与部署边界

- `final/flow/strip-flow-interaction.gif`：10 秒新版交互预览；顶部英文状态/相对倍率为录像注释，不属于产品 UI。
- `final/flow/strip-flow-interaction.mp4`：无注释原录像；`motion-frames/timestamps.json` 保存真实状态与动画时钟。
- `parameter-changes.json`：本轮所有轨道周期/延时及前沿参数的前后值。
- `source-sha256.json`：最终整包 UI 哈希与构建号。

**本轮未同步生产安装目录，未 reload，未完成真实 Hana 宿主验收。** 本地浏览器证据不能替代真实卡片视觉确认。

可转发：

> Codex 已完成 build **1003131724**：星光整体流速为 1723 的 2.5 倍，前沿光芯泛白比例从 24% 提到 55%，常态亮带透明度从 .65 提到 .85，外晕保留封面色。点击略加速、拖动明显加速、松手平滑回落保留。请读 `docs/player-ui/handoffs/ALBUM-AMBIENT-FLOW-FAST-DONE.md`，按 `album-ambient-flow-fast/source-sha256.json` **整包同步 ui/ → extension_manager reload app:hanako-simple-player → 核对新快照 build 1003131724**，再由用户确认速度与泛白强度。专项 120/120、回归 131/131；浅色旧底色像素对照有最大 4/255 的微差，详见报告。不要顺手调整其他 UI；具体问题由用户转回 Codex。

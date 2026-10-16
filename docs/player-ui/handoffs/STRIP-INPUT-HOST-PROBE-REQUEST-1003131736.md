# 横条随机输入卡滞 · 请求 Hana 真实宿主探查

2026-10-16，Codex。当前仓库及已部署构建 **1003131736**，版本 **1.1.7**。用户要求需要传话时停下来，由用户转交；本单未直接发给 Hana。

## 用户最新实测与本轮状态

触发横条控件后，按钮、进度点击和拖动随机出现卡滞，体验与其他卡片明显不同。刚移入时可能短暂出现按钮悬停提示，随后输入无效；最初描述为停留后恢复，后续多次尝试确认恢复条件和时长都不固定。星光/进度动画仍正常运行。

**本轮没有修改 UI、没有 bump、没有部署或 reload。** 请先在当前异常版本保留现场，抓到有效证据后再决定修复。上一份 `STRIP-SIZE-ACCEPT-1003131736.md` 证明整包同步与卡重建成立，但未验收实际输入链，不能据此排除本次问题。

## Codex 已查到的事实

1. **明确的进度交互退化**：`ui/style.css` 的 `.strip-seek` 被此前修复限制成底部 **16px**。中间空白处不属于 range 命中区域，这能解释部分空白点按/拖动无效；后续需恢复空白区域的点击与拖动，并保留按钮优先命中。此问题与随机输入卡滞分开处理。
2. **本地无法复现进入后停顿**：复用既有假后端页面，822×94，离开冷却后进入模式键，分别在 **0/30/100/500ms** 后按下/松开，各 3 次。**12/12** 当次 `hot=1`、`inert=false`、命中 `stripMode`，原生按钮 click 与代理 `modeBtn` click 均各到达 1 次，`runtimeErrors=[]`。这只证明该本地页面路径正常，不代表真实宿主正常。
3. **宿主适配疑点，尚非已确认根因**：当前分发的 `ChatTranscript-DpoxT8u5.css` 中，`._tileTop_19ca0` 是默认高 `var(--titlebar-h,44px)` 的透明标题带，`pointer-events:none`，但有 `-webkit-app-region:drag`；中央把手另有独立命中框。播放器目前没有调用官方 `hana.surface.setInteractiveRegions()`。需确认真实挂载与原生窗口的拖动区域是否覆盖了控件，不能仅凭普通浏览器 `elementFromPoint()` 排除原生拖动命中。
4. **动画正常不能排除 JS 堵塞**：CSS 合成动画可能继续运行，必须同时观察主线程心跳或长任务，不能仅凭星光动画继续就认定是宿主截获。

本地原始输出及入口（沿用 touchbar 证据目录 gitignore）：

```
docs/player-ui/handoffs/touchbar/entry-1003131736/entry-click.json
docs/player-ui/handoffs/touchbar/entry-1003131736/entry-trace.mjs
```

入口仅使用本机假后端和 Chrome，不连接生产 Hana：`OUT_DIR=docs/player-ui/handoffs/touchbar/entry-1003131736 node docs/player-ui/handoffs/touchbar/entry-1003131736/entry-trace.mjs`。

## 需要 Hana 返回的最小证据

这次是**输入故障探查，不是再次做同步/ready 基础检查**。优先使用已有宿主检查能力或 DevTools 的只读观察；不要修改播放器源码、app-data、权限或宿主文件。若需要临时监听器，限定短时间、有限条数并在结束后清理，避免持续逐帧打印或测量本身造成卡顿。

尽量抓一次异常路径和一次正常路径：从横条外进入 → 控件出现 → 相邻按钮间移动并点击 → 在无按钮的进度空白处尝试拖动。记录承载、iframe 实际 CSS 尺寸、缩放、主题、是否由大卡切入及当前构建。先用事件投递/状态变化确认，不要求 Hana 主观代替用户评价手感。

在同一时间窗采样以下三组信息，能获取多少如实返回多少：

- **输入到哪一层**：宿主与 webview/iframe 是否收到 pointer/mouse 的 move、down、up、click；事件时间、坐标、target。按钮出现后首次按下是否进入子页面；到达子页面后，原生横条按钮 click 和代理按钮 click 是否都到达。进度拖动是否有 input、pointercancel 或 lostpointercapture。
- **页面是否在工作**：子页面主线程短时心跳最大间隔、长任务；异常时 `window.__playerDebug.stripState()`、控件祖先的 inert、hidden、disabled、pointer-events、visibility，以及点位的 `elementFromPoint()`。不能仅看画面动画或 mounted/ready。
- **宿主是否拦截**：实际标题带、中央拖动把手、悬浮宿主按钮/Tab、webview 的相对矩形；异常时宿主命中的元素或原生拖动区域。确认当前挂载是否支持 `setInteractiveRegions`，以及它处理的是普通标题拖动还是也能避开中央把手。以宿主现有能力/源码证据为准，不通过 App 访问父 DOM。

若工具目前无法读取或监听该 webview 的事件、主线程和命中状态，**先明确报告具体能力缺口及可行的最小采样方式**。不要再以哈希一致、无报错、卡 ready 或普通浏览器命中通过替代故障定位，也不要先盲调延时、动画或按钮尺寸。

## 结果交回

请写入 `docs/player-ui/handoffs/STRIP-INPUT-HOST-PROBE-1003131736.md`，保留原始输出路径，区分观察事实、推断和未取到的数据。由用户转回 Codex；有了证据后由 Codex 统一修复空白进度区域与实际输入根因，再给部署提示词。

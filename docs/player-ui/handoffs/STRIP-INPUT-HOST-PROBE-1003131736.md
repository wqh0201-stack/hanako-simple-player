# 横条随机输入卡滞 · HOST-PROBE 报告

日期：2026-10-16（Asia/Shanghai）  
结论：**本轮无法取得真实鼠标输入链、页面主线程和宿主拖动区的决定性证据；根因未定位。** 已确认当前 Hana UI 中存在一张已挂载的播放器 WebView 卡，且其 DOM 包含横条及控件。由于可用探针只能读 DOM 摘要、不能监听真实鼠标或观察运行时主线程，我没有用合成点击/拖动冒充真实输入测试。

## 现场与边界

- 目标：`hanako-simple-player` 的当前真实挂载卡，`cardInstanceId=wb-card-plugin-webview-card-mva80ikf-5`，`cardEntityId=plugin-card:hanako-simple-player:player`，路由 `/index.html`。
- `ui_inspect` 实时读取：`rendererKind=plugin-webview-card`、`implementation=iframe-driver`、`runtimeStatus=mounted`、`domStatus=ready`、`visible=true`、`surfaceKind=home`、`focused=false`。两次快照分别查询于 `2026-10-16T00:36:17.629Z` 与 `00:38:19.263Z`。
- 当前仓库元数据为 `ui/_build.json: 1003131736`、`manifest.json: version 1.1.7`；这是仓库构建元数据，不是从正在运行的 iframe 读取到的运行时 build 值。任务书称目标部署构建为 1003131736，本轮未独立验证该运行时值。
- `describe_dom` 读到 `#player.ambient-ok`、`#stripLayout`、`#stripBar`、`#stripSeek[type=range]`、`#stripTitle`、`#stripArtist` 等节点；当时显示曲目 `Tell me — milet`、进度 `3:12 / 3:43`。DOM 摘要标注 556 个可见节点 / 600 个总节点并已截断。
- 为保留现场，本轮没有触发播放控件、进度条、拖动、改源码、bump、部署或 reload。没有对播放状态作任何主动修改。

## 观察事实

1. **页面确实已挂载，不能据此判输入正常。** DOM 摘要只能证明节点存在；它不证明鼠标事件投递到了 iframe，也不提供实时命中结果。
2. `ui_action.read_state` 返回空对象 `{}`，没有暴露 `window.__playerDebug.stripState()` 或页面交互状态。`ui_action.describe_elements` 在此实例上返回 `Unknown UI action`；`ui_inspect.capabilitiesNow.appViewTools` 为空。
3. 当前工具没有针对这张 App WebView 的 JavaScript evaluate、临时事件监听、Console/Performance 读取或鼠标移动/原生鼠标按下接口。故**没有采到** pointer/mouse move/down/up/click、`pointercancel`、`lostpointercapture`、range `input`、事件坐标/target，也没有页面心跳间隔、Long Task、`elementFromPoint()`、祖先 computed style / inert / disabled 状态。
4. 不使用 `ui_action.click_element` 或 `drag_element` 作替代测试：项目随附的 `ui/sdk.js` 显示，前者调用目标 DOM 的 `element.click()`；后者在 iframe DOM 中直接派发合成 `pointer*` / `mouse*` 事件。这些不经过真实 OS 鼠标投递与宿主原生拖动命中，无法回答本任务问题；执行它们还可能改变正在播放的曲目/进度。
5. 本机 Hana renderer 资源 `~/.hanako/artifacts/server/1.1.7-beta-darwin-arm64-198f61dadf951412-ga7c30c843f9fc7ca/desktop/dist-renderer/assets/ChatTranscript-DpoxT8u5.css` 中存在以下标题带样式：

   ```css
   ._tileTop_19ca0 {
     position:absolute; top:0; left:0; right:0; z-index:5;
     height:var(--titlebar-h, 44px); background:transparent;
     pointer-events:none; -webkit-app-region:drag
   }
   ```

   这表明该 renderer 资源定义了约 44 CSS px 的原生拖动区域；`pointer-events:none` 不足以排除 Chromium/Electron 原生 `app-region: drag` 对拖动的处理。但本轮没有拿到当前 WebView 矩形、标题带与横条的相对坐标、中央把手的命中矩形或 native drag 回调，因此它**只是候选机制，不是当前卡截获输入的实测证据**。该 CSS 文件属于本机 renderer 资源；本轮未证明正在运行的宿主进程实际加载的资源版本与之完全一致。
6. 当前播放器 `manifest.json` 为 v2，`minAppVersion=0.1017.0`；`ui/app.js` 未调用 `hana.surface.setInteractiveRegions()`。本机随附的官方 `APPS.md` 说明此 API 从 Hana 0.950.0 起用于黑板主卡与拆窗主卡的标题栏交互区域，逐矩形上报并保留其余拖动区。当前实例在 UI 元数据中标为 `surfaceKind=home`，仅凭现有数据不能确定它是否适用该 API，也不能确认宿主是否支持/应用了该区域。因此不能据此直接建议加 API 或认定它是根因。

## 三项重点的结论

| 问题 | 本轮结论 | 证据边界 |
|---|---|---|
| 鼠标事件是否进入页面 | **未知，未采样** | 有 DOM 摘要但没有真实鼠标事件监听；合成事件不等价。 |
| 页面主线程是否堵塞 | **未知，未采样** | 没有 heartbeat / PerformanceObserver / Long Task 工具；动画或 mounted 状态不构成证据。 |
| 宿主标题拖动区是否截获 | **未证实；存在候选拖动区** | renderer CSS 有 44px `-webkit-app-region:drag` 标题带；缺实际重叠坐标及原生事件/拖动日志。 |

另：本轮未尝试横条无按钮空白处的拖动，因此没有把已知的 `.strip-seek` 命中区域问题与随机卡滞混为一谈。

## 最小补测方式

需要能附着到**当前真实 iframe 与其宿主窗口**的只读 DevTools/诊断能力（或由 Hana 宿主侧提供等价探针）：

1. 异常出现后，在 iframe 文档 capture 阶段临时记录有限条数的 `pointermove/down/up/cancel`、`mousedown/move/up/click` 和 `#stripSeek` 的 `input`；保存时间、坐标、target、pointerId、`defaultPrevented`。同时读一次 `stripState()`、控件祖先 `inert/hidden/disabled/pointer-events/visibility` 和目标坐标的 `elementFromPoint()`。
2. 同一短时间窗记录主线程定时心跳最大间隔及 `PerformanceObserver({type:'longtask'})`；完成后清掉监听与 observer。至少覆盖一次异常和一次正常路径。
3. 宿主侧同时记录 iframe 的实际 CSS 矩形/缩放、标题带和中央把手的矩形、宿主接收的 pointer/mouse 或 native drag 状态。这样才能区分「事件没到 iframe」「进入 iframe 但页面没处理」「宿主原生拖动区抢走」三种路径。

当前会话没有上述附着/读取能力；如补齐，只需对当前卡做短时、有条数上限的监听，不必改源码或 reload。

## 原始输出与相关路径

- **本轮真实宿主原始事件/性能输出：无文件。** 当前 `ui_inspect` / `ui_action` 结果只在本会话工具响应中，没有可导出的原始采样文件；本报告不伪造为 raw trace。
- 上轮本地假后端测试（不是本轮真实宿主证据，勿用于输入验收）：
  - `docs/player-ui/handoffs/touchbar/entry-1003131736/entry-click.json`
  - `docs/player-ui/handoffs/touchbar/entry-1003131736/entry-trace.mjs`
- 本轮读取的源/契约：`ui/_build.json`、`manifest.json`、`ui/app.js`、`ui/sdk.js`、`~/.hanako/artifacts/server/1.1.7-beta-darwin-arm64-198f61dadf951412-ga7c30c843f9fc7ca/APPS.md` 及上述 renderer CSS。

**结语：** 目前只能确认“真实挂载与控件 DOM 存在”；鼠标输入、主线程阻塞和标题拖动区抢占三者均无实测结论。请先补齐能观察 iframe 与宿主两侧的只读探针，再据异常/正常对照定位；不要因加载正常或 CSS 候选规则直接判通过/修复。

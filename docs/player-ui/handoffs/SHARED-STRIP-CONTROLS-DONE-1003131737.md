# 横条共用真实控件与原生显隐 · Codex 交接

2026-10-16。版本 **1.1.7**，候选构建 **1003131737**，尚未部署或 reload。按用户要求由用户转交 Hana，本轮没有直接联系 Hana。

## 问题与取舍

用户实测 1736：横条控件出现后输入随机卡滞，按钮、进度点击和拖动受影响；恢复条件不稳定，动画仍在运行。Hana 的 `STRIP-INPUT-HOST-PROBE-1003131736.md` 明确未取得输入、主线程及宿主拖动区域的决定性证据，不能将宿主拦截认作已确认根因。

用户随后提出换掉复杂的横条控件显隐，并沿用其他形态的按钮。本轮落实这一方向，同时修复已确认的进度命中区退化。**实现和本地自验完成，随机卡滞是否消失仍待真实宿主实际体验。**

## 最终实现

- **四态共用同一批 DOM 节点和事件监听**：进入横条时，将原来的 `modeBtn`、transport（`prevBtn/playBtn/nextBtn`）、`favBtn`、`volGroup` 和原生进度 `seek` 移到横条布局；退出时按原位标记放回。只在形态切换时迁移，不在悬停、点击或媒体播报中搬节点。
- **移除代理按钮与输入转发**：删除 `stripPlay/stripPrev/stripNext/stripMode/stripFav/stripVolumeBtn/stripVol/stripSeek` 等第二套交互节点及其 `.click()` / 合成 input 转发。音量也直接复用原来的 `muteBtn`、`volPop`、`vol`，横条只改变横向浮层样式。
- **显隐交给 CSS**：在封面或条内悬停、键盘 `:focus-visible`、原生 `:active` 期间显示控件。删除横条自己的悬停计时、鼠标/键盘/按键热态门闩与显隐时的 `inert` 切换。封面明确点按仍可固定展开，Escape 或外部点按关闭；音量保留其他形态既有的浮层交互。
- **整块空白进度可点击/拖动**：同一根原生 `seek` 铺满条内背景，位于按钮层下方；标题、歌词与时间文字不截获命中。按钮所在位置仍优先命中按钮。取消此前只允许底部 16px 操作的限制。
- **拖动期间不覆盖原生输入值**：两根共用 range 只维护有限的按住记录，用于阻止媒体时钟回写；pointerup/cancel、lostpointercapture、失焦和形态切换清理。它不控制按钮显隐。
- **保留已对齐的外观和退让**：播放圆及命中框 28px、内部图标 16px；其余按钮 32px，三键间距 6–10px；封面 62.08px（缩小 3%）、进度条 64px；音量浮层放不下时提前整组隐藏。切回其他形态时恢复原类名、位置与可见项。

主要文件：`ui/app.js`、`ui/style.css`、两份孪生 HTML、`ui/_build.json`。相关验收入口更新为真实节点 ID：`tools/verify-player-interaction.mjs`、`tools/verify-touchbar.mjs`、`tools/verify-strip-flow.mjs`；没有改松行为要求。未改 manifest、权限、后端音源或 app-data。

## 本地证据

### 已有交互专项：27/27，失败集合为空

运行：

```
OUT_DIR=docs/player-ui/handoffs/touchbar/shared-1003131737/interaction node tools/verify-ui.mjs --interaction-only
```

关键检查：

- 四种形态在请求延迟条件下：双击取消、三击起播、按压命中框稳定。
- 旧 stop 回执不覆盖后续播放意图；跨文档播放所有权仍成立。
- 切换动画中首击只触发一次播放按钮，不误触进度；312/416/640 宽度播放键可命中。
- 背景交接、快速反向清理、歌词短交叉动画、reduced-motion 正常。
- `interaction-blank-seek-area-works`：下沿空白点按成功。
- `interaction-middle-blank-drag-works`：中间身份区下方的空白可拖动进度。
- `interaction-controls-keep-node-identity`：跨四态仍是同一批原生节点。
- `runtimeErrors=[]`。

这是本地 Chrome + 可控后端结果，不经过生产 Hana 的原生鼠标与标题拖动命中。

### 页面操作与布局观察

复用现有夹具观察，结果见 `smoke/page-smoke.json`：

- 刚移入后立即点击模式键：真实节点 click 1 次、无 inert 祖先、代理节点数 **0**。
- 下一曲→播放→上一曲→播放→下一曲→模式快速点击：对应真实按钮计数 **2/2/1/1**，与六次操作一致。
- 喜欢能切换；原生静音能切换；横向音量浮层 **120×32px**，滑杆 **70×28px**。
- 620px 宽时音量可展开；600px 时整组隐藏且关闭；400px 保留模式及三键；312px 只留 28px 播放键。
- 切回 465×930 长卡：同一批节点均回到底栏，无遗留 hidden 或 strip 按钮/进度类。
- 页面无运行时报错；横条、音量展开与恢复长卡截图已检查。

### 基础检查与证据目录

构建号三处均 **1003131737**，两份 HTML 仅 `data-shell` 不同；`node --check`（app.js 和本轮修改的三个专项入口）及 `git diff --check` 通过。未跑全量 UI、后端或其他无关专项。

```
docs/player-ui/handoffs/touchbar/shared-1003131737/basic-checks.json
docs/player-ui/handoffs/touchbar/shared-1003131737/interaction/verify-player-interaction.json
docs/player-ui/handoffs/touchbar/shared-1003131737/smoke/page-smoke.json
docs/player-ui/handoffs/touchbar/shared-1003131737/smoke/volume-822.png
docs/player-ui/handoffs/touchbar/shared-1003131737/smoke/shared-822.png
docs/player-ui/handoffs/touchbar/shared-1003131737/smoke/restored-465.png
docs/player-ui/handoffs/touchbar/shared-1003131737/page-smoke.mjs
```

沿用 touchbar 本地证据目录 gitignore。五文件 SHA-256 在 `basic-checks.json`。页面观察复跑：`OUT_DIR=docs/player-ui/handoffs/touchbar/shared-1003131737/smoke node docs/player-ui/handoffs/touchbar/shared-1003131737/page-smoke.mjs`。

## Hana 部署与实际体验

1. 从 `/Volumes/SSD/hanadesk/hanako-audio-player-simple` 整包同步 **ui/**，再 `extension_manager reload app:hanako-simple-player`。本轮无扩权；不要只同步 JS 或漏 CSS。
2. 以 `basic-checks.json` 核对安装目录/快照五文件，确认实际加载 **1003131737**。
3. 基础检查后交用户按原路径体验：右下移入→下一曲→播放/暂停→上一曲快速往返；在无按钮的进度空白区点击和拖动；缩窄、再切回大卡。
4. 现在真实按钮 ID 是 `playBtn/prevBtn/nextBtn/modeBtn/favBtn/muteBtn`，进度是 `seek`，音量是 `vol`；不要沿用旧代理 ID 操作。
5. 在 `SHARED-STRIP-CONTROLS-ACCEPT-1003131737.md` 分别记录部署到位和用户实测结论。mounted/ready、哈希一致或合成 click 不代表随机输入故障已消除。如果用户仍遇到卡滞，保留原有宿主探查未定位结论，继续处理真实输入观察能力；不把本轮架构简化当作宿主问题的证明。

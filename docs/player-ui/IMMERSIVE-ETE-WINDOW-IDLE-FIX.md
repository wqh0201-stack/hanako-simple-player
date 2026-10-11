# 独立窗口用「无指针活动」判隐藏

2026-10-11。用户真机给出关键分治：**同一份 UI，并入 Hana 小卡时出窗三秒能隐藏，拆成独立窗口时不能。**
本轮据此把沉浸底栏的触发源按承载形态分开。

开工基线：`hana-simple` / `8cce9f5`，工作树干净。本轮不改 manifest、version、音源、歌词、队列与搜索。

## 根因

两个 HTML 壳只差一行 `data-shell`：

- `ui/index.html` → `body data-shell="card"`（并入 Hana 的小卡、黑板卡；宿主主窗口内的 iframe）
- `ui/standalone.html` → `body data-shell="window"`（拆出的独立窗口；`app-host-view` 壳里的 iframe）

`ui/app.js` 原有逻辑只用 `document.documentElement` 的 `pointerleave` + 坐标判定。问题在两种承载里这个事件的可达性不同：

- **卡片**：iframe 外还有宿主的聊天流、卡壳、标题栏等 DOM。指针从 App 内容移到这些区域时，父文档仍在接收并派发事件，iframe 内能正常收到 `pointerleave`。判据成立，三秒隐藏生效。
- **独立窗口**：App 页面几乎铺满整个原生窗口。指针移出窗口边界时，顶层 renderer 不再向该 web contents 派发鼠标事件，**iframe 内补不到那次 `pointerleave`**。`immersivePointerInside` 永远停在 `true`，计时器永远起不来。

也就是：**公开 SDK 没有原生窗口指针进出信号，独立窗口这一档本来就无法用 leave 判据**。此前两轮修复（`6d51a2d` / `8cce9f5`）都在调整 leave 的坐标过滤，触及不到这条根本差异。

## 本次做法

判据分形态，同一份业务逻辑：

- **卡片分支**（`data-shell !== "window"`）：**一行未动**，仍用 `pointerleave` 判「指针是否离开本可见面」，窗内静止不隐藏。原有 40px 顶部宿主 chrome 交接保护保留。
- **独立窗口分支**（`data-shell === "window"`）：改用「无指针活动」计时。一次 `pointermove` / `pointerdown` / `keydown` 刷新时间戳并重启 3000ms 倒计时；到点且无保护就隐藏。指针移出窗口后 iframe 收不到事件，这段静默本身即为静止证据，因此不再需要 `pointerleave`。

**取舍**：独立窗口里，鼠标停在窗内不动也会隐藏。这是「窗内静止不隐藏」与「移出能隐藏」在单一判据下无法同时成立时的必然选择；与涟漪「不动则静」的语义一致（涟漪本由 `scene` 的 `pointermove` 驱动）。卡片分支不受此影响。

## 实现要点

- 新增 `immersiveShellWindow`（读 `body[data-shell]`）与 `immersiveIdleTimer`；把沉浸候选条件抽成 `immersiveCandidate()` 供两分支共用。
- `wakeImmersiveControls()` 同时清掉出窗计时与空闲计时，并重新武装空闲计时。
- 指针监听按 `immersiveShellWindow` 分派：窗口分支只挂 `pointermove` / `pointerdown`（都立即 `wake`），不再挂 `pointerenter` / `pointerleave`。
- `immersiveIsBlocked()` 原样保留：暂停、搜索、队列抽屉、菜单、歌词匹配/对齐、音量浮层、键盘焦点保护都不变；`immersivePointers.size > 0` 仍保证按住不放（如拖进度）不隐藏。
- `pagehide` 同时清两个计时器。

## 自动化与截图

- UI：**226/226**（保留原有 219 条，本轮新增 7 条 window 分支定向断言）；12/12 布局自检、4/4 窄卡自检、0 运行时错误。
- 新增断言覆盖：window 壳识别；一次指针活动即排空闲倒计时；空闲到点后在**没有任何 pointerleave** 的情况下隐藏；一次 `pointermove` 立刻唤回；窗内静止继续隐藏（与卡片分支相反的行为）；按住不放守住；松开后重新计时。
- 卡片分支的全部既有 ETE 断言继续通过，确认本形态改动零回归。

## 仍为浏览器夹具、待真机

夹具用合成 `PointerEvent` 驱动，能证明逻辑正确，但不能代替真实原生窗口的鼠标事件。仍需在**独立窗口实机**确认：窗内移动底栏回；移出窗口 3 秒底栏没；移回后涟漪与底栏同时起；进度条按住 3 秒不被藏；卡片形态行为与改动前一致。

## 部署提示词

请在串行部署时段，确认本轮提交与构建号，整包同步 `ui/` 到 `~/.hanako/apps/hanako-simple-player/`，按正式流程 reload `app:hanako-simple-player`。本轮无 manifest 变更，不需要重复改 ETE 声明；不要改 version 或 push。真机验证时重点区分「独立窗口」与「并入小卡」两种形态各自的行为。

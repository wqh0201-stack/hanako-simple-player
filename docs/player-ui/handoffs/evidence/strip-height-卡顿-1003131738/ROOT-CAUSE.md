# 横条「越矮越卡」根因报告 · 1003131738

日期：2026-10-16。执行：码农（codex 链路）。范围：**只排查，未改生产代码**。
结论：**已定位到宿主侧机制 + 本 App 一处与之直接冲突的几何规则**，并可给出可复算数字。
用户的猜测（"和宿主那个控制条有关"）得到源码支持 —— 那不是猜错的方向。

---

## ① 现象与线索

- 用户新线索：横条**竖向高度**拉高时操作丝滑，缩到最矮时明显卡顿。
- 用户追加指向：**"前几轮做的避让控制条那个宿主控制条，在那附近的时候会变卡"**。
- 此前 `STRIP-INPUT-HOST-PROBE-1003131736` 未定位，`TOUCHBAR-HOST-PROBE` §7 把
  "最小态下宿主按钮是否压到条顶边" 明确列为**待真机复核**项。本轮把它补上了。

---

## ② 根因假设与证据

### 假设（最终成立）

宿主在**每张聊天流卡的 iframe 之上**铺了一条贯通全宽的顶部原生拖动带；
本 App 的横条在矮高度下垂直居中后**整条钻进这条带里**，该区域被 Electron
判为 `-webkit-app-region: drag`，指针事件先被宿主当"拖窗口"吃掉，
于是 iframe 内的点击/拖拽要么迟到、要么丢。**条越矮 → 落在带里的比例越大 → 越卡。**

### 证据链（四条，均可核验）

**E1 · 宿主确实有这条带，且是全宽 44px 的原生拖动区**

宿主渲染器 `desktop/dist-renderer/assets/ChatTranscript-DpoxT8u5.css`：

```css
._tileTop_19ca0{
  position:absolute; top:0; left:0; right:0; z-index:5;
  display:flex; align-items:flex-start; justify-content:center;
  height:var(--titlebar-h, 44px);
  background:transparent;
  pointer-events:none;
  -webkit-app-region:drag
}
```

关键点：`left:0; right:0` = **贯通整卡宽度**，不是只占右上角；
`pointer-events:none` **不足以解除** `-webkit-app-region:drag`（这是 Chromium/Electron
原生层的命中，`pointer-events` 只管 DOM 层）。同值 `--titlebar-h: 44px` 由
`assets/mobile-BT7ks5Ep.css` 定义（全仓仅此一处定义）。
该类只被 `ChatTranscript-HTqDLXaz.js` 引用 —— 即**聊天流卡容器**，与本卡同挂载位。

**E2 · 本 App 的条几何从不避让这条带（这是最硬的证据）**

`ui/style.css:2993`：

```css
--strip-y: max(0px, calc((100% - var(--strip-height)) / 2));
```

是**纯垂直居中**，`max()` 的下限是 `0px`，**没有任何 40/44px 的顶部让位**。
（`TOUCHBAR-HOST-PROBE` §3 描述的 `max(40px, ...)` 顶避让，在本仓库 git 历史里
从未存在过 —— 全仓 `ui/` 搜不到 `max(40px`；那份口径是当时的**建议**，未落地。）

配合 `ui/app.js:8113`：
```js
player.style.setProperty('--strip-height', Math.max(56, Math.min(96, h - 24)) + 'px');
```

于是：宿主给的高度越小，条越往上贴，越深地插进 44px 带。

**E3 · 重叠量可精确复算，且与用户体感同向**

`node docs/player-ui/handoffs/evidence/strip-height-卡顿-1003131738/overlap-recompute.mjs`

| 宿主高 | 条高 | 条顶 | 条底 | 与 44px 带重叠 | 条被覆盖 |
|---|---|---|---|---|---|
| 56 | 56.0 | 0.0 | 56.0 | **44.0px** | 79% |
| 80 | 56.0 | 12.0 | 68.0 | **32.0px** | 57% |
| 103 | 79.0 | 12.0 | 91.0 | 32.0px | 41% |
| 120 | 96.0 | 12.0 | 108.0 | 32.0px | 33% |
| 160 | 96.0 | 32.0 | 128.0 | 12.0px | 13% |
| 180 | 96.0 | 42.0 | 138.0 | 2.0px | 2% |
| **192** | 96.0 | 48.0 | 144.0 | **0** | 0% |
| 220 | 96.0 | 62.0 | 158.0 | 0 | 0% |

**完全脱离该带需要宿主高 ≥ 192px** —— 而 `STRIP_OUT = 224`（app.js:7915）才退出横条，
也就是说：192~224 这一段之外，**整个横条形态的可用高度区间几乎全程泡在拖动带里**，
且高度越小侵入越深。这条曲线与"越矮越卡、越高越丝滑"完全同向。

补一个反证：宿主 --strip-y 下限是 0，所以高 56px 时条**整个**（79%）在带内，
此时条中部几乎全被判定为拖窗口区；而 180px 时只剩 2px 边缘。这就是"缩到最窄竖向高度时很卡顿"。

**E4 · 本 App 自己的安全区断言只守右上 100×40，管不到这条全宽带**

`ui/app.js:8785` 的自检：
```js
var safe = { left: fr.right - 100, top: fr.top, right: fr.right, bottom: fr.top + 40 };
```
只查**右上角 100px 宽**那块，且只查"有没有 button/input 落进去"。
而 `.strip-bar` 从 `left: calc(24px + var(--strip-height))` 到 `right: 12px`，
以及覆盖全条的 `#seek`（`inset: 0`，`app.js` 用它承接整个条的拖动/点击）都
**横向远越过那 100px 边界**，所以断言查不出问题 —— 这是上次没定位到的原因之一：
**断言口径与宿主实际行为不匹配**（宿主是全宽带，断言是右上角小方块）。

### 否证过程（排掉的方向）

- **App 自身 JS/渲染随高度恶化**：`arrangeStrip()` 只在 `applyLayout` 里由
  ResizeObserver 触发，不进逐帧路径；rect 读取集中在 `stripControlsWidth()`
  且明确注释"只在布局/尺寸变化时量"。封面取色 `probeAmbient` 有
  `ambientCache` + `ambientPending`，同一张封面不重采样；`stripColorField`
  固定在 40×40 上采样，与条高无关。**逐帧路径上没有任何随 h 变化的工作量。**
- **封面/重绘面积**：条变矮 → 面积反而变小，方向相反，无法解释"矮了更卡"。
- **也否掉了"点不到按钮"单一解释**：卡的是**整条**（含 seek 拖动），不只是右上角的键。

---

## ③ 建议修复方向（未实施，待拍板）

按代价从小到大：

1. **几何避让（最省、最稳）**：把 `--strip-y` 的下限从 `0px` 抬到 `44px`
   （宿主 `--titlebar-h` 的值），并相应重定 `--strip-height` 的上限，
   使条永远落在拖动带之下。代价：可显示高度上限被吃掉约 44px，
   极矮宿主预算下条会更扁甚至需要保底策略。
2. **`setInteractiveRegions` 打洞（官方 API，治本但不保一定可用）**：
   APPS.md 明确 ~1300 行处给了 `hana.surface.setInteractiveRegions(regions)`，
   用于"为内容中与宿主标题栏重叠的按钮保留点击区域"，坐标是 iframe 视口 CSS px，
   最多 64 个矩形，无额外权限，需 `minAppVersion >= 0.950.0`（本项目已是 v2）。
   把 `#seek` 的矩形和共享控件逐个上报，宿主会在拖动带上给这些矩形保留点击事件。
   **风险/不确定**：契约写"黑板主卡和**拆窗主卡**"可用，
   而本卡是 `surfaceKind=home` 的**聊天流卡**（`ui_inspect` 实测），
   是否属于"有所属标题栏的挂载位"**未经证实**，调不通时需回退到方案 1。
3. 两者叠加：先做 1 保底，再探测 2。

我倾向 **1 先做**（确定性 100%，一行级改动），把 2 作为后续增强去真机验。

---

## ④ 未验证 / 不确定项

- **本轮没有运行时 harder evidence（无 long task / 无 pointer 事件 trace）**：
  现有工具对这张 App WebView 没有 JS evaluate、事件监听或 Performance 读取能力
  （同 1736 轮结论）；`ui_action.describe_elements` 返回 `Unknown UI action`。
  结论建立在**宿主源码 + App 源码 + 几何复算 + 用户体感同向**之上，
  属于强证据推理，**不是真机 tracetrace**。要说的话：`-webkit-app-region:drag`
  抢占本机 dom 事件是 Electron 已知行为，但本卡上没收过指针 adsorb 的直接采样。
- `_tileTop_19ca0` 是否**实际渲染在本卡实例上**：类名被 ChatTranscript 引用印证，
  但我未能从 minified js 里读出它的 JSX 挂载点（bundle 极长且混淆），
  这里是从"同一个卡片容器模块引用了它"推出来的，**未直接在 DOM 里见到该节点**。
- 宿主 `--titlebar-h` 实际生效值：44px 来自 `mobile-BT7ks5Ep.css` 的定义，
  本卡桌面端是否有别处覆盖未穷尽见到；且不排除宿主运行时改这个值。
- `setInteractiveRegions` 对聊天流卡是否生效：**待真机单次调用验证**。
- 本地浏览器夹具（puppeteer-core + Chrome 本机可用）**先天无法复现**本现象：
  宿主那条覆盖层不存在于裸浏览器里。所以不要把这个 bug 的回归放进本地夹具断言；
  它的验收只能是真机。

---

## 证据位置

- 宿主 CSS：`~/.hanako/artifacts/server/1.1.7-beta-darwin-arm64-198f61dadf951412-ga7c30c843f9fc7ca/desktop/dist-renderer/assets/ChatTranscript-DpoxT8u5.css`
- `--titlebar-h` 定义：同目录 `assets/mobile-BT7ks5Ep.css`
- App 几何：`ui/style.css:2993`、`ui/app.js:8113`、`ui/app.js:8785`、`ui/app.js:7915`
- 复算脚本：`docs/player-ui/handoffs/evidence/strip-height-卡顿-1003131738/overlap-recompute.mjs`

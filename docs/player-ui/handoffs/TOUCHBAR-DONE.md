# TOUCHBAR-DONE · 横条（第四种呈现）实现与自验交接

日期：2026-10-15。实现者：码农（接手 Codex 未提交的工作树）。
状态：**运行时代码完成，本地无头自验通过；真实宿主卡片的视觉/交互验收待 Hana 侧。**
构建号：`1003131714`。版本：manifest 仍为 `1.1.7`（本轮未改 manifest、未发版）。

> 本文件只写「已发生的事实 + 证据」。所有数字来自本机命令输出，未通过的项目单独列在 §7。

---

## 0. 一句话

在既有 App 里补齐了**低高度、横向长条的第四态**（`data-layout="strip"`），与 wide / long / compact 并列：
独立封面 + 小圆角彩色进度条 + 条内固定身份区 + 歌词/控件双态 + 条内下角时间 + 点击向右展开音量。
跨断点**立即提交目标布局再按时间播短过渡**；条内继续响应宽度。
本地横条回归套件 **126/126**；全量 `verify-ui.mjs` **601/601 断言、12/12 自检、4/4 窄卡、0 失败**。

---

## 1. 本轮改动（文件与原因）

| 文件 | 改动 | 原因 |
|---|---|---|
| `ui/index.html` / `ui/standalone.html` | 各 +42 行：新增 `<section class="strip-layout" id="stripLayout">`（stripCover / stripBar / strip-field-quiet / strip-field-played / stripSeek / stripIdentity / stripContext（stripLyric + stripControls）/ stripNow·stripTotal / strip-seek-dot）、`stripMorePanel`、`layout-cover-ghost` | 横条 DOM 骨架。**孪生文件内容逐字一致，只差 body 的 `data-shell`** |
| `ui/style.css` | +99 行（文件末尾 `.strip-layout` 全套） | 第四态的静态布局、双态切换、音量向右展开、条内下角时间、多色场裁切、按压反馈、reduced-motion |
| `ui/app.js` | +274 行：`choosePlayerLayout()` 滞回、`isStrip()`、`renderStrip()`、hot/volume/more 状态机、`data-morph` 过渡、`stripColorField()` 多色取样、`__playerDebug.stripState()` | 状态、渲染与过渡；**全部复用既有播放器控制器，没有第二套 audio** |
| `tools/verify-touchbar.mjs`（新增） | 126 条断言的横条回归套件 | 行为回归 |
| `tools/verify-ui.mjs` | +18 行：接上 `--touchbar-only` 分支 + 一个多色调色板 fixture | 让横条套件可单跑，也可随全量跑 |
| `ui/_build.json` | `1003131710` → `1003131714` | `node tools/bump-build.mjs` |

### 1.1 本轮（接力后）我改的三处

1. **`TB-06-seek-1` 是真 bug，已修**（详见 §4）。`renderStrip()` 在用户按住进度条期间仍回写 `stripSeek.value`，与播报时钟抢同一个值。
2. **高速最小高度溢出**：原 `--strip-y: max(40px, …)` + 条高 64 = 最少需要 104px，而用户实测宿主最小高度 ≈103 CSS px，会溢出/出滚动条。现改为**整体垂直居中**（用户明确否决「为避让宿主控件把内容压低」），并收 `overflow: hidden`。
3. **条内内容不再贴顶**：`.strip-context` 由 `top:6px;height:36px`（中心 24，条中心 32）改为 `top:0;height:100%` + flex 居中；身份区在歌手为空时歌名吊在盒顶，也改为 flex 居中（实测墨迹中线 56 → 64，与条中线一致）。

### 1.2 用户评审后的第二轮修正（已实现）

- **统一「轴线」**：歌词与控件共用**自由区中线**（身份区右缘+12 → 条右缘−10 的中点）。该轴比条中线天然偏右 63px（左侧常数被封面+身份区占掉一半），用户拍板选此轴（B）。
- **歌词去硬左对齐**：短句居中在轴上；长句靠 `max-width:100%` 撑满，**省略只发生在尾部**（用 Range 量首字位置证明首字未被裁）。宽度不足（`<480`）时与控件一起退回「紧接身份区」靠左。
- **控件疏松分档**：`≥600` 用 10px、`480–600` 用 8px、`<480` 回落 4px（按钮尺寸不变）。
- **按压反馈**：`.strip-btn` 补 `:active { transform: scale(.94) }`（播放键 `.92`）+ 深底 + `0.1s ease-out`；`hover` 加描边环；沿用仓库 `.icon-btn` / `.play-btn` 既有那套；reduced-motion 下按既有约定退成无缩放。

---

## 2. 与任务书 / 用户否定的做法的对照

| 任务要求 / 用户否决项 | 本实现 |
|---|---|
| 独立封面、不缩 | 封面 `64×64` 固定，`left:12`；条 `left:88; right:12`；各宽度实测恒为 64×64 |
| 小圆角长矩形（非药丸） | 条 `border-radius: 6px`；根 `.player` 四角仍为 0 |
| 时间在条内下角、仅交互态 | `.strip-time` `bottom:2px`，`data-hot=1` 才 `opacity:.85`；断言逐宽度校验落在条内且不压歌手 |
| 音量点击向右展开 | `data-volume=1` 时 `width:0 → 120px`，`transition: width 260ms`；**未沿用**旧的悬停竖向弹层 |
| 点一下不静音 | `#stripVolumeBtn` 只切展开态；断言另开音量、值不变 |
| 歌词静听、控件交互态 | `data-hot` 双态；不是"看起来隐藏"，隐藏层 `inert` + `aria-hidden` |
| 左封面 + 身份区固定，长标题省略 | 身份区恒 112px，`text-overflow: ellipsis`，无字号缩小、无跑马灯 |
| **封面不得缩小** | 未缩（三档宽度断言） |
| **时间不得外置** | 未外置（条内下角，断言钉住） |
| **不得用滑块驱动大卡→横条连续变形** | 未实现。跨断点是「立即提交目标布局 + 独立时间轴短过渡」 |
| 不得 `position:fixed` / 直接 localStorage / window.open / emoji | 均未使用；图标全为 SVG 线描 |
| 不新建第二套 audio | 复用同一个 `<audio>`（断言比对实例与 generation） |

---

## 3. 最终断点、最小包络与固定尺寸

- **进入**：`h <= STRIP_IN = 192` 且 `w >= h * 1.5`
- **退出**：`h >= STRIP_OUT = 224`（滞回 32px，避免临界闪切）
- **过渡**：`STRIP_MOTION_MS = 300ms`，`1-(1-t)^3` 曲线；`SHOT` / reduced-motion / 隐藏页 / 零预算时直接落定
- **最窄覆盖**：套件覆盖 `1040 / 640 / 593 / 480 / 420 / 416 / 360 / 312`（用户实测最小态 ≈416 CSS px，672 更保守）
- **高度覆盖**：`112 / 108 / 104 / 100 / 96` 均不裁切、不出滚动条
- **固定尺寸**：封面 64×64；身份区 112×34（盒），字号 13/11px；条高 64；条内上下居中的是**墨迹盒**（`Range.getBoundingClientRect` 实测居中线 = 条中线）
- **右上安全区**：`stripControls` 中除 seek 外的控件，断言 `!(right > width-100 && y < 40)`

---

## 4. `TB-06-seek-1` 首跑唯一失败：定位、根因、修复与证明

**现象**（Codex 首跑，68 条断言里唯一红）：`detail: {"time":15.014379,"paused":false,…}`，用例 `check('06-seek-'+fraction)` 在 `fraction=1` 期望 ≈30。

**定位过程**：我本地重跑 80+ 次无法复现，于是加可复现探针（`TB_TRACE=1`，收尾已清理成精简形式）记录每次点击的命中元素、slider 值、点击瞬间/50ms 后的 `currentTime`、`readyState/duration/seekable`、以及被包装的 `audio.play()` 调用栈。

**结论**：**是真 bug，不是断言写错**。
- `renderStrip()` 里 `if (slider.value !== String(p)) slider.value = String(p)` 会被 `timeupdate`（≈250ms 一次 → `renderProgress()` → `renderStrip()`）反复触发。
- 用户/测试正按住进度条时，这个回写与原生 `<input type=range>` 的点击提交**抢同一个值**；正在播放时就会把"点到末端"覆盖回旧位置，于是读到 `time≈15.01, paused:false`（50% 那档的残留值 + 播放）。
- 它也解释了为什么只在"正在播"时出现。

**修复**：`stripPinned()`（有指针在拖动）为真时，`renderStrip()` **不回写** `stripSeek.value`；音量滑杆同理。

**证明**（同一套件、同一断言，只切 app.js 的这两行）：
```
WITHOUT fix → assertions "74/75"，failed: TB-06-seek-not-clobbered-while-playing
WITH    fix → assertions "75/75"
```
即新增的 `TB-06-seek-not-clobbered-while-playing` 是**真守门**（改回旧代码必红），不是"改断言让红项变绿"。

---

## 5. 原始自验输出

### 5.1 横条套件

```console
$ node tools/verify-ui.mjs --touchbar-only
{
  "assertions": "126/126",
  "failed": [],
  "runtimeErrors": [],
  "outDir": "docs/player-ui/handoffs/touchbar/final"
}
```

按需求组的断言数：TB-01 14、TB-02 18、TB-03 23、TB-04 5、TB-05 8、TB-06 15、TB-07 5、
TB-08 2、TB-09 3、TB-10 3、TB-11 2、TB-12 4、TB-13 3、TB-14 3、TB-15 18。

### 5.2 全量回归（横条改动不得放松既有断言）

```console
$ node tools/verify-ui.mjs            # exit=0
{
  "selfCheckPassed": 12, "selfCheckTotal": 12, "failedCases": [],
  "narrowSelfCheck": "4/4", "narrowFailed": [],
  "assertions": "601/601",
  "failedAssertions": []
}
```

> 注：全量运行末尾出现的 `http 404 …/lrc/load`、`reqfail … net::ERR_ABORTED` 是**假后端对不存在曲目的既定噪声**（`serveAudio` / fixture 路由），不是断言失败；`failedAssertions` 为空、进程 exit 0。

### 5.3 稳定性

- 横条套件在本机连跑 **80+ 次**（含 8 / 10 / 20 / 24 并发批次与加压批次）全绿，修复前也未复现首跑那条 flake；修复后新增守门断言单跑即能区分修复/未修复。
- 逼真复现方式：`TB_SEEK_PLAYING=1`（测试入口已在收尾时移除，保留说明供后续排查参考）。

### 5.4 产物位置

- 截图与几何：`docs/player-ui/handoffs/touchbar/final/touchbar/`（42 个文件，含 8 档宽度 × 浅深 × 两态、`morph-0*` 过渡帧、`strip-312-more-open.png`、`empty-360x104.png`、`geometry.json`）
- 断言明细：`docs/player-ui/handoffs/touchbar/final/verify-touchbar.json`
- 首跑基线（Codex）：`docs/player-ui/handoffs/touchbar/{baseline,first}/`
- 宿主探查：`docs/player-ui/handoffs/TOUCHBAR-HOST-PROBE.md`

---

## 6. 验收清单 TB01–TB14 逐条对应（**均为无头证据；真机待 Hana**）

| ID | 实现要点 | 无头证据（断言名 · 结果） | 真机待验 |
|---|---|---|---|
| TB01 视觉骨架 | 封面独立、条小圆角、上下留白、条与封面同轴且整体居中 | `01-shape-{1040…312}`、`01-axis-centered-*`、`01-axis-right-of-bar-center-*` · 通过 | 实际观感 |
| TB02 宽度不变量 | 封面 64、身份区 112、字号 13/11，长中英歌名省略 | `02-fixed-*`、`02-long-copy-ellipsis`、`02-identity-centered-*`、`02-identity-ink-centered` · 通过 | — |
| TB03 双态 | 静听仅歌词；交互隐藏歌词、显示控件与下角时间；退出恢复 | `03-controls-hit-*`、`03-leave-restores-lyrics`、`03-real-current-line`、`03-gap-*`、`03-press-feedback-*` · 通过 | 真实鼠标路径 |
| TB04 控件功能 | 模式/上一首/暂停/下一首/喜欢/音量接真实控制器；横条无歌单队列 | `04-mode-real-state`、`04-favorite-real-state`、`04-small-more-discoverable`、`04-small-secondary-hit`、`04-more-panel-clear-of-controls` · 通过 | — |
| TB05 音量 | 点击向右展开、再点收起；拖动/键盘；跨尺寸拖动收尾；Esc/外点 | `05-*`（8 条）· 通过 | 触屏 |
| TB06 进度/时间 | 色场随真实时间；可拖 seek；按钮不误 seek；0/半程/末尾/未知时长 | `06-seek-*`、`06-times-inside-*`、`06-buttons-do-not-seek`、`06-seek-not-clobbered-while-playing`、`06-empty-stable` · 通过 | — |
| TB07 多色取样 | 六区取样、深浅两套、resize 不重采样、裁切不重排 | `07-field-stable-*`、`07-no-resample-on-resize` · 通过 | 多种真实封面 |
| TB08 任意停止 | 跨断点后立即停手也落定完整横条 | `08-discrete-target-committed`、`08-stopped-resize-finishes` · 通过 | 真机拖拽 |
| TB09 边界/反转 | 滞回区稳定；动画中反向；持续缩放 | `09-hysteresis-retains-strip`、`09-exit-complete-target`、`09-interrupted-latest-target-settles` · 通过 | — |
| TB10 条内适配 | 入条后改宽只动弹性区/控件组合；长竖卡不误判；矮 wide 正确进入 | `10-resize-within-strip-no-replay`、`10-no-clock-restart-in-strip`、`10-tall-card-not-strip` · 通过 | — |
| TB11 音频连续 | 同文档缩放往返不重建 audio、不重播 | `11-same-audio-no-new-play`、`11-clock-owner-continuous` · 通过 | 真机迁窗 |
| TB12 生命周期 | 0 尺寸不提交、恢复重判、reduced motion、隐藏不跑循环 | `12-zero-does-not-commit`、`12-restored-strip`、`12-reduced-motion-settles`、`12-hidden-full-lyrics-no-loop` · 通过 | — |
| TB13 主题与可访问 | 浅深主题；封面色上文字可读；Min 字号与安全区；键盘可进入；布局落在静止鼠标下不误触发 | `13-no-stationary-hover`、`13-keyboard-entry`、`13-keyboard-range` · 通过 | 读屏/触屏 |
| TB14 回归与宿主 | 旧布局无回归；整包同步/reload 后真机验收 | `14-old-layout-controls-visible`、`14-controls-interactive-after-strip`、`14-strip-hidden-after-exit` + 全量 601/601 · 通过（无头） | **整包同步 + reload 后的真机聊天卡与独立窗** |

---

## 7. 已确认 / 待真机验证（不要把无头当真实会话）

### 已确认（本机可复现证据）
- 横条四态布局、双态交互、音量向右展开、条内下角时间、多色场裁切、按压反馈、reduced-motion 降级。
- 断点滞回、立即提交 + 短过渡、同布局不重播、0 尺寸不提交、恢复重判。
- 音量为点击展开而非悬停弹层；按钮不误 seek；seek 拖动不被时钟回写。
- 旧布局（wide/long/compact）全量 601/601 无回归。
- 生产 UI 已整包同步进 `~/.hanako/apps/hanako-simple-player/ui/` 并 `reload`（构建号一致）。

### 待真机验证（未做，不做结论）
1. **真实聊天卡片与独立窗的观感**：条在真实卡里的视觉比例、宿主裁角、深色卡片上的读数。
2. **实际最小尺寸**：宿主拖拽可达的最小宽高（宿主不承诺最小尺寸）；`416 CSS px` 是用户截图反推值。
3. **真卡右上控件岛与横条的命中关系**：本实现按项目保守约定避开右上 `100×40`；宿主控件岛实测约 32–36px 高，条顶边在最小高度下会接近该带，**需真机 `elementFromPoint` 复核**。
4. **真实 resize 事件时序**：真实拖拽过程中 `hana.envelope` 的推送节奏（本机是 `ResizeObserver` + 固定尺寸重设）。
5. **触屏/读屏**：`aria-*` 与键盘已按契约实现，但未在真实触屏与读屏上走过一遍。

### 已知限制
- `--strip-axis` 用「自由区中线」（比条中线偏右 63px）；`<480` 时退回靠左紧接身份区。若真机上某宽度观感仍偏，只需调该常量或 bias，不影响其它布局。
- 颜色只从封面采样（六区 + 深浅两套），AI 参考图里的星点/水光纹理**不生成**（任务书允许，未增加高负载特效）。

---

## 8. 未做的事（明确边界）

- 未改后端 / 音源 / 用户数据 / 许可证；未新建域名或重型库；未建第二套 audio。
- 未 `position:fixed`、未直接 `localStorage`、未 `window.open`、无 emoji、字号 ≥ 11px。
- 未改 manifest → 无扩权 → **不需要重新审批**。
- 未发版、未提交市场、未创建 Release。

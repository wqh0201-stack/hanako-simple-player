# ALBUM-AMBIENT-ACCEPT · Album Ambient Progress Bar 独立验收

> 验收方：DeepMind（Hana 侧技术统筹）。执行方：Codex（实现与自验）。
> 日期：2026-10-15。仓库 `/Volumes/SSD/hanadesk/hanako-audio-player-simple`。
> 版本 **1.1.7**，构建 **1003131719**。
> 边界：本轮只复跑验证 + 部署 reload + 真卡取证；**未改任何源码**（仓库工作树保持 Codex 交付态），
> 只新增本文件。用户已明确「reload 后自己验收」，故真机目视/交互的最终判定由用户完成，
> 本文把「我已独立验证」与「留待用户」严格分开。

---

## 0. 结论

| 项 | 结果 | 依据 |
|---|---|---|
| 源码与交接记录一致 | ✅ | `ui/` 8 文件 sha256 与 `album-ambient/source-sha256.json` **逐一相同** |
| 孪生 HTML | ✅ | index/standalone 逐字一致，仅 body `data-shell` 不同 |
| 背景专项（独立复跑） | ✅ 97/97（一次时序抖动，见 §3.1） | 本机重跑 2 次 |
| 渲染像素检查 | ✅ 16/16 | `inspect-album-ambient.py` |
| 全量 UI 回归 | ✅ 606/606 断言、12/12 自检、4/4 窄卡、0 runtime errors | 本机重跑 |
| 整包同步 `ui/` | ✅ | 5 个差异文件已同步，仓库 vs 已装 **逐文件一致** |
| reload + 新快照 | ✅ build **1003131719** | 快照 `snap-eSfZSZ`，与仓库 **逐文件一致** |
| 真卡结构（聊天卡 + 独立窗） | ✅ strip 层齐全、**无 `strip-seek-dot`** | `ui_action describe_dom` |
| 真机目视/交互（多封面/主题/0-100%/真实 seek/暂停/切歌/隐藏/reduced-motion、最窄幅） | ⏳ **留给用户** | 用户要求自验；且当前两张卡都不在 strip 形态（需用户拖成宽而矮） |

**无失败项，无需返修。** 唯一一次失败是本机复跑的时序抖动，非产品问题（§3.1）。

---

## 1. 源码核对（未改动）

```
shasum -a 256 ui/{LUCIDE-LICENSE.txt,_build.json,app.js,face-portrait.png,index.html,sdk.js,standalone.html,style.css}
```

8 条哈希与 `docs/player-ui/handoffs/album-ambient/source-sha256.json` 完全一致，其中：
- `ui/_build.json` = `{"build":"1003131719"}`
- `ui/style.css` = `06209d6dd8b7ce3863bda18e85c2dd3255f44fb8e0a9ee635b4440fc1b14a6dd`
- `ui/app.js` = `29d437ea805737337dc2fde39b1d843e3ea92c6368b2a4b1b1da3cb11e8cb1b0`

孪生检查：`diff <(index.html 归一 data-shell) <(standalone.html 归一 data-shell)` → 无差异。

「已无底部点」的静态依据：全仓 `grep strip-seek-dot` 仅命中测试脚本的断言（`noDot`），
源码/CSS 中**已无该元素与规则**；`.strip-bar` 只剩 `:focus-visible`（键盘）描边，
鼠标点击/拖动不会给整条加外圈。

---

## 2. 部署回路（整包同步 → reload → 核对快照）

```
rsync -a --delete /Volumes/SSD/hanadesk/hanako-audio-player-simple/ui/ ~/.hanako/apps/hanako-simple-player/ui/
extension_manager reload app:hanako-simple-player
```

- 已装目录 `_build.json`：`1003131718` → **`1003131719`**。
- `diff -rq 仓库/ui 已装/ui` → **UI_IDENTICAL**（含 `style.css`，未漏）。
- reload 后宿主生成新快照：
  `~/.hanako/.cache/app-ui-snapshots/run-89879-.../snap-eSfZSZ/_build.json = {"build":"1003131719"}`
  （旧快照 `snap-9Amqzx` 仍为 1003131718）。
- `diff -rq 仓库/ui snap-eSfZSZ` → **SNAPSHOT_IDENTICAL**；快照 `style.css` 哈希与 §1 相同。

> 即：宿主实际加载的，就是本仓库 `ui/` 整包，构建号 1003131719。

---

## 3. 独立复跑验证（我本机重跑，非引用 Codex 输出）

命令均从仓库根执行，输出落 `/tmp/hap-accept/`（不写仓库）。

### 3.1 背景专项 `--album-ambient-only`

| 轮次 | 结果 | 说明 |
|---|---|---|
| 第 1 次 | **96/97** | 唯一失败 `AA-playing-css-clocks-advance`：CSS 动画时钟正常推进（0→266.61ms），但 **媒体时钟两帧间未跳**（`12.006241` 停住）。这是「seek 到 40% 后立即 requestPlay，280ms 窗口内音频尚在重新缓冲」的时序抖动 |
| 第 2 次 | **97/97**，0 runtime errors | 同命令重跑，该断言通过 |

两次的其余 96 条断言均一致通过；录像断言 `recording-real-progress-and-pause` 两次都过
（证明媒体时钟在真实播放期间确实推进 >4s）。故该失败**判定为测试抖动，非产品回归**。

### 3.2 渲染像素检查

```
python3 tools/inspect-album-ambient.py /tmp/hap-accept/ambient2/ambient
→ { "passed": 16, "total": 16, "failed": [] }
```

未播放区保持底色、左侧随进度变化、满进度染色、边界逐像素平滑、无整体过曝。

### 3.3 全量 UI 回归 `verify-ui.mjs`

```
→ assertions 606，failed 0；selfCheck 0/12 失败；narrowSelfCheck 0/4 失败；runtimeErrors 0
```

输出末尾的 `lrc/load 404` 与主动终止媒体 `ERR_ABORTED` 为夹具既有探测（`expectedProbes`，325 条），
`runtimeErrors` 为空、失败断言为 0。

---

## 4. 真卡取证（宿主实时）

宿主当前开着两张真实卡（`ui_inspect freshness=live`）：

| 卡 | cardInstanceId | placement | 状态 |
|---|---|---|---|
| 聊天卡 | `wb-card-plugin-webview-card-mv9g8e8y-2` | `surface:home` / `page-chat` | mounted / dom ready / actions ready |
| 独立窗 | `wb-card-plugin-webview-card-mv9fc4ua-1` | `surface:detached:...` | mounted / dom ready / actions ready |

`ui_action describe_dom` 结果（两张卡一致）：

- 存在完整横条层：`#stripLayout`、`#stripCover`、`#stripBar`、
  `.strip-field-quiet`、`#stripPlayed`、`.strip-sparkles`（内含 **7 个 `.strip-spark`**）、
  `#stripSeek`、`#stripIdentity`/`#stripTitle`/`#stripArtist`、`#stripLyric`、`#stripNow`/`#stripTotal`。
- `#player` 带 `ambient-ok` 类（氛围取色链路已挂）。
- **两张卡的 DOM 中都没有 `.strip-seek-dot`**（对照 §1 静态检查）。

> 说明：两张卡当前分别处于 wide / long 形态（独立窗默认 1040×780），**不在 strip 形态**，
> 故横条此刻是隐藏的。要看横条氛围背景，需把卡/窗拖成「宽而矮」——这属于用户本轮自验的动作。

**关键旁证**：`.strip-sparkles`（7 个 `.strip-spark`）是**本轮 1003131719 新增**的装饰节点，
而 `strip-seek-dot` 是本轮删除的。reload 后两张**已在屏卡片的实时 DOM 里同时出现「有 sparkles、无 dot」**，
说明宿主卡片已加载到 1003131719（不是旧快照），reload 已对已挂载卡片生效。

---

## 5. 留给用户自验的项（本轮未在真机确认，不标通过）

按用户「reload 后我自己验收」的要求，以下**不由我代判**，请用户在真卡/独立窗拖成横条形态后目视：

1. 粉/绿/多色/暗封面 × 深浅主题下的氛围色场与进度揭示。
2. 0 / 25 / 50 / 75 / 100% 的进度裁切与羽化边界。
3. 歌词态 / 控件态切换、最窄幅（≈312 CSS px）排布。
4. 真实鼠标 seek（拖动进度条）—— 确认**无整条外圈、无底部点**，且媒体时钟随之跳转。
5. 暂停冻结 / 切歌换色 / 宿主隐藏暂停 / `prefers-reduced-motion:reduce` 关动画。

（自动化侧对 1–5 的等价断言已在 §3 通过；真机目视用于补上「假宿主不等于真宿主」的那一层。）

---

## 6. 原始证据位置

- 源码哈希：`docs/player-ui/handoffs/album-ambient/source-sha256.json`（本轮比对通过）
- 我本机重跑：`/tmp/hap-accept/ambient/`（96/97）、`/tmp/hap-accept/ambient2/`（97/97 + 160 张截图 + 像素检查）、`/tmp/hap-accept/full/verify.json`（606/606）
- 已装应用：`~/.hanako/apps/hanako-simple-player/ui/`（build 1003131719）
- 宿主快照：`~/.hanako/.cache/app-ui-snapshots/run-89879-55cc91d3-b98c-4359-953b-19906d1bfca0/snap-eSfZSZ/`
- 真卡 DOM：`ui_action describe_dom` @ `wb-card-plugin-webview-card-mv9g8e8y-2`、`wb-card-plugin-webview-card-mv9fc4ua-1`

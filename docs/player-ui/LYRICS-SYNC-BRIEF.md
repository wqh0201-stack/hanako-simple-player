# 歌词节奏手动对齐 · 实现交接简报

> 2026-10-11 ｜ 交给前端实现者（建议 `artist` / 画师）。
> 本文自包含：调研结论、需求、推荐的交互与解法、代码锚点、硬约束、验收标准。
> **交互与视觉部分是我的建议方案（罐头把这块设计权交给了我），实现者可以再优化；但标了「硬约束」「必须」的地方是仓库纪律，不能破。**

---

## 0. 一句话任务

在 Hana 音频播放器里，让用户在**听歌时手动把歌词整体拖动对齐到节奏**（视觉层交互），结果按曲持久化，下次听同一首自动生效。

---

## 1. 背景：这题为什么这么解（先看结论再看方案）

罐头场景很具体：**B 站翻唱普遍没有歌词**，加载第三方（网易云/酷狗等）歌词后，发现**整体偏了一个固定量**——因为翻唱沿用了原作的和声与曲式，节奏骨架一致，只是前奏长度不同（原曲 8 秒前奏，翻唱 2 秒直接进唱），落到数学上就是：

```
t_显示 = t_原始 + Δ     （Δ 是全曲通用的常量）
```

调研过主流实现（完整版见知识库 `20-资料/歌词与音频不同步的调整方案.md`），核心结论：

1. **LRC 规范自带 `[offset:±ms]` 标签**（Wikipedia「LRC (file format)」），天生就是为这种整体偏移设计的。foobar2000（OpenLyrics）、MusicBee、Stage Traxx 都认它，MusicBee 作者明确「没有全局设置」，也就是写在逐曲元数据里。
2. **这个场景要的是「总体偏移」，不是逐句。** 逐句只有在「歌词时间轴本身就敲错了」时才有意义；词源是原作正规词库时时间轴是准的，不齐只因起点不同。让用户逐句调是伪需求，没人有耐心。
3. **唯一例外**：翻唱若改了速度（慢版、demo、变速 remix），偏差会**随播放时间线性累积**，常量偏移治不了，需要两点标定（`t_显示 = a·t_原始 + b`，解出速率 a 和偏移 b）。这种情况少，v2 再做，但要留好接口（见 §6）。
4. **不要碰的情况**：歌词页「自动跟随/滚动浏览」逻辑已经存在（`pauseFollow` / `is-browsing` / 3s 自动回归），拖动对齐**必须与它共存**，不能打架。

---

## 2. 需求（罐头原话转述）

- 听歌时发现歌词对不上节奏 → **手动拖动歌词对齐**。
- 只要**总体偏移**，不要逐句调整。
- 交互要**优雅、符合直觉**（视觉/交互设计由本文负责给出方案）。
- 结果要**记住**，下次听这首自动生效。

---

## 3. 推荐交互方案（★ 核心，实现者可再打磨）

### 3.1 手势：长按拾起 → 拖动 → 松手落定

约束决定了手势形态：**歌词区上裸拖已经是「浏览」了**（`lyricWrap` 的 `pointerdown` → `pauseFollow`）。所以对齐不能是裸拖。用**长按拾起**区分：

| 步骤 | 行为 |
|---|---|
| **长按歌词区 ~450ms**（位移未超阈值） | 进入**对齐态**：整片歌词「拾起」（轻微上浮 + 影子，一行事的仪式感） |
| **拖动** | 整片歌词像一条胶片 1:1 跟手 |
| **松手** | 落定、写盘、退出对齐态、恢复自动跟随 |
| **位移 < 80ms 就松手** | 视为没动，直接丢弃，退回普通浏览（防误触写坏 offset） |

**方向语义**（跟物理一致，无需教学）：**往上推 = 歌词提前，往下拉 = 歌词延后**。把歌词想成竖向铺开的时间带，向上推，后面的句子更早到达中心（「现在」）。

### 3.2 这个手势最优雅的性质（设计依据，别丢掉）

**拖动的换算完全不经过「播放到第几秒」这个变量**，Δ 只由手指位移决定。所以用户想拖多久拖多久，松手早晚不影响结果，对齐后停手也不会漂。这比「点某一句来锚定」稳得多——点击要求恰好卡在句子开口那一瞬，慢了半秒就错，得试几次才收敛，手感是紧的。**拖动本质无时间压力**，这是它容错的根源。

### 3.3 换算尺度

**用局部行距当尺子**：拖过相邻两行的视觉距离 = 它们之间的时间差（「挪一行 = 挪一句」，与歌词排版同构）。取中心附近几行的**中位行距**做基准，避免遇到超长间奏时尺度突然放大。
v1 可先用固定常数（一指幅覆盖 10~15 秒）；精度落进人耳感知阈 **±100ms** 内即可。

### 3.4 视觉四件套（只在对齐态出现，平时零干扰）

1. **现在线**：中心一条极细横线当锚。歌词本来就把当前句居中（`centerCurrentLine`），所以这条线只是把已有中心**显影**，不新增布局元素。
2. **实时读数**：贴现在线浮出一枚读数，写 **「歌词提前 1.2s」/「歌词延后 0.8s」**。
   ⚠️ **绝不写裸的 `+1.2s`**——LRC 的 ± 语义各家解释不一（Poweramp 与 MusicBee 就打过架），写「提前/延后」才无歧义。数字用等宽（`font-variant-numeric: tabular-nums`）防跳动。
3. **候选行高亮**：落在现在线上的那行用现有 `--hl-accent` 高亮。用户看着它「咔」地对上。
4. **微调与复位**：读数两侧出现 `−` / `+`，步进 **50ms**（人耳同步容忍窗约 ±100ms，步进太粗调不准）；长按读数归零。

### 3.5 手势分工（不要抢）

| 手势 | 含义 |
|---|---|
| **单击歌词行** | 跳转到这句（更普世的期待，别拿来对齐） |
| **长按 + 拖动** | 整体对齐 |
| **点读数旁的 ± / 长按读数** | 精修 / 归零 |

### 3.6 发现性

用户手动滚了一下歌词停住（已进入浏览态）时，在中心淡入一行极轻提示 **「长按拖动可对齐节奏」**，几秒后淡出，只出现前几次。它恰好出现在「用户正跟歌词较劲」的时刻，比常驻提示自然。

---

## 4. 技术路线

**全在 `ui/app.js`（+ `ui/style.css` + 两个 html 壳）里改，不碰后端、不碰 `lib/`。**

### 4.1 数据模型

- 存在曲目 `raw.lyricOffset`（**整数毫秒**，正 = 提前）。缺省 0。
- **跟着 `playlist.json` 走**：复用现成的 `raw` 透传（`toStoredTrack` 会原样带回 raw，见 `ui/app.js:192`），拆窗贴回、重开都在。零新增存储通道。
- 与已有的 `raw.lyricMatch`（手动搜词绑定）**同族**，都挂在曲目 raw 上。

> ⚠️ **必须处理**：用户**重新绑定歌词源时要把 `lyricOffset` 清掉**（在 `bindLyricMatch`，`ui/app.js:2547`）。换了词源，行划分和基准时间都变了，旧 Δ 无意义。不写清楚，将来一定有人报「重新搜词后反而更不齐」。

### 4.2 解析层

- `parseLrc`（`ui/app.js:2067`）顺手读 `[offset:±ms]` ID 标签，存进 `state.lyricBaseOffset`。
- 曲目首次拿到词且 `raw.lyricOffset` 缺省时，用它初始化。这样别人 LRC 自带的 offset **白捡**。

### 4.3 渲染层（就改一处）

`updateLyricIndex`（`ui/app.js:2008`）现在比的是：

```js
if (state.lyricLines[i].t <= state.progress + 0.01) idx = i; else break;
```

改成带上 offset（符号按 §3.1 的方向语义定，unit 换算成秒）：

```js
var off = offsetSec();   // raw.lyricOffset/1000，正=提前
if (state.lyricLines[i].t <= state.progress + off + 0.01) idx = i; else break;
```

**就这一处**。拖动预览、精修、落定，全都复用这条路径——高亮自然跟着走，不用另写预览逻辑。

### 4.4 手势状态机

挂在 `lyricWrap` 现有的 `pointerdown/move/up/cancel`（`ui/app.js:2046` 起）上，**不要新建监听器与现有浏览手势抢**：

- `pointerdown`：起 450ms 定时器。
- 定时器到 **且位移未超阈值** → `state.lyricAlign = true`（进入对齐态）。
- `pointermove`：累积位移 → 换算 Δ → 实时应用（走 §4.3 路径）。
- `pointerup / pointercancel`：位移 < 80ms 丢弃；否则提交 + 落盘。
- ⚠️ **对齐态里必须屏蔽那条 3s 自动回归**（`scheduleResume`），松手才回，否则拖到一半它自己弹回去。

### 4.5 落盘

提交时写 `raw.lyricOffset` + `savePlaylist()`（`ui/app.js:708`）。toast 用自然语言：**「歌词已提前 1.2s」**，不用数字代号。

### 4.6 边界

- 无歌词 / 歌词加载中：手势不生效。
- 对齐态里屏蔽歌词页其他按钮（如 `lyric-ask`），避免误触。
- 跨源音频（部分 B 站歌）：对齐只动渲染时间，与音频源无关，不受影响。

---

## 5. 硬约束（踩了必炸，来自仓库 `AGENTS.md`）

1. **孪生文件**：改 `ui/index.html` 必须同步 `ui/standalone.html`，两者只允许差那 5 行 AudioContext 调试块。
2. **构建号**：改完跑 `node tools/bump-build.mjs`（同步 `ui/_build.json` + 两个 html 的 `window.__HANA_BUILD`）。
3. **单文件、无构建、无框架、无 CDN**。前端是 `ui/index.html` 单文件 + `ui/app.js` + `ui/style.css`，无打包器。
4. **保留现有 `id` / `data-*` 钩子**（`lyrics lyricWrap lyricScrim lyricAsk lyricAskBtn ...`）。要加元素可以，别删/改名现有钩子。
5. **宿主/沙箱**：不用 `position:fixed`；聊天卡片右上角 **100×40 CSS px** 是宿主控件安全区，别放东西；最外层保持直角、无外描边/外阴影；**禁 emoji**（用 SVG 线描）；字号 **≥ 11px**；颜色走 CSS 变量（`--hk-*` / `--hl-accent` / `--lyric-*`），不硬编码。
6. **不碰** `lib/`、`manifest.json`、`app-data/`。
7. **不要部署 / 不要 reload 安装目录**——那是主代理的活。本仓是源码，安装目录在 `~/.hanako/apps/hanako-simple-player/`。
8. **仓库有未提交改动**（`git status` 里 `ui/app.js` / `ui/index.html` / `ui/standalone.html` / `ui/style.css` / `ui/_build.json` / `tools/verify-ui.mjs` 都是 M）。**开工前先读当前文件和 `git diff`，不得重置或覆盖。**

---

## 6. 未来接口（v1 先不做，但别堵死）

- **两点标定**：数据结构预留 `raw.lyricOffsetMs`（单点，v1）→ 未来加 `raw.lyricRate`（速率）。渲染层 `t_显示 = t·a + b`，a 缺省 1。
- **逐输出设备 offset**：蓝牙延迟是**设备属性**（跨歌共享），与逐曲 offset 不是一回事，别混进 `raw.lyricOffset`。将来若要，另存一份全局 per-output 值。
- **写回 LRC 文件**：v1 不写回（零副作用，存 app state）。若将来要跨播放器通用，再考虑写回/导出。

---

## 7. 验收

### 7.1 自动化（必须真跑）

```sh
node tools/verify-ui.mjs        # 假后端 + 无头 Chrome；当前基线 133 断言 + 12 布局 + 接线冒烟
```

- 必须**不破现有断言**，并按新功能**新增**断言（建议名）：
  - `lyric-align-long-press-enters`（长按进入对齐态）
  - `lyric-align-drag-changes-offset`（拖动改变 offset，且 `updateLyricIndex` 生效）
  - `lyric-align-tap-under-threshold-discards`（位移 < 80ms 丢弃）
  - `lyric-align-persists-to-playlist`（写进 `playlist.json` 的 raw）
  - `lyric-align-parse-lrc-offset-tag`（`[offset:±ms]` 被解析）
  - `lyric-align-cleared-on-rebind`（重新 `bindLyricMatch` 后 offset 归零）
- 截图落 `/tmp/hap-verify/`，挑「对齐态」一张。

### 7.2 人工（罐头真机）

- 长按歌词 → 拾起 → 上下拖 → 松开，数字/高亮跟得上，退出后不漂。
- 切歌再切回，offset 还在。
- 重新搜词绑定后 offset 归零。

### 7.3 交回

1. 改了哪些文件、哪些纯 CSS / 哪些动 DOM（附 `id` 钩子核对）。
2. `tools/verify-ui.mjs` 结果（断言数 + 冒烟 + 运行时报错）。
3. 对齐态截图（浅深各一）。
4. 没把握、需要罐头拍板的地方，明确列出，别硬定。

---

## 8. 相关文档 / 出处

- 调研全文（含 mpv / VLC / Lyricify / Poweramp / MusicBee / foobar2000 OpenLyrics / Stage Traxx / Roon 的做法与坑）：知识库 `20-资料/歌词与音频不同步的调整方案.md`
- LRC 格式规范：Wikipedia「LRC (file format)」（`[offset:±ms]`，`+` = 歌词提前）
- 仓库既有交接范式：`docs/player-ui/QUIET-CONTROLS-HANDOFF.md`、`docs/player-ui/ALIGN-BRIEF.md`
- 歌词链路相关既有工作：`docs/player-ui/REFINE-DONE-RESUME.md`（媒体时钟取时）、`ui/app.js` 的 `loadLyrics` / `parseLrc` / `bindLyricMatch`

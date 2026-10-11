# 歌词「挑 / 换」—— 匹配错了能自己选

2026-10-11，构建号 1003131647。罐头需求：歌词匹配错了要能**挑**和**改**。

## 缘起

手动匹配面板原来是「搜到第一条命中的就直接绑」。算法再准也会有偏差（同名歌、
Live/翻唱版本、B站标题被清洗后指错），用户看得见的是「绑错了」，却没有任何
纠正手段 —— 只能改关键词撞运气。两件事一起做：**给个入口**、**把选择权交回用户**。

## ① 长按工具条加「换歌词」

`#lyricAlignTools` 第一行原本只有 `<output id="lyricAlignValue">原始节奏</output>`。
改成一行 flex：

```
［原始节奏（flex:1）］ ［换歌词］        ← 第一行（.lyric-align-top）
［提前］［延后］［还原］［完成］        ← 第二行（.lyric-align-actions，未动）
```

点「换歌词」→ `closeLyricAlign()`（先收工具条，避免两浮层叠）+ `openLyricMatch()`。

**入口放宽**：`openLyricMatch` 本身没有被 `renderAsk`（那个只管 `#lyricAsk` 的显隐）
限制，从工具条直接调用即可。工具条本就是长按出的，所以「有词也能换」。

样式沿用工具条语言：11px、`--hk-muted`、hover 用 `--hv-surface` + `--hv-ring-icon`，
`min-height: 22px`（比第二行 28px 的按钮矮一档）—— 次级动作，不抢戏。

> ⚠️ 连带修：既有断言 `lyric-align-controls-fit-and-hit-in-narrow-card` 原本用
> `el.querySelectorAll('button')[0..3]` 判「四个动作在一行」，加了「换歌词」后会数到 5 个、
> 把跨行的按钮误判成不同行。已把「单行判定」收敛到 `.lyric-align-actions button`
> （点不点得到仍扫全部按钮，那才是它真正的意思）。

## ② 手动匹配改为「列出候选让人挑」（根治）

`submitLyricMatch` 重写：搜各源 → **攒候选** → 列表呈现，点哪条绑哪条。

- **搜**：沿用原有顺序（当前平台 → netease → tencent → kugou），每个平台取回后
  对每条结果算相关度（关键词命中词数），**一条关键词都不沾的不列**（宁缺毋滥）；
  按 `server:mid` 去重；攒够 `LM_MAX*3` 就提前收手（省请求）。
- **排**：相关度高者在前，同分保持源顺序。最多列 `LM_MAX = 5` 条。
- **显**：每行 = 歌名 + 歌手 + 来源平台（`.lm-cand-src` 用小胶囊，平台名走 `serverLabel`）。
  列表 `max-height: 168px` 滚动。
- **点 = 直接绑定**（罐头拍板：简单）。
- 取词/失败状态照旧走 `lmNote`；改关键词重搜会清空旧候选。

### 确定性取词（这次的真根）

只存 `{song, artist, keyword}` 是不够的：`runBoundFirst`（重载时先认绑定）原来
**按关键词重搜**并 `pickByQuery` 取第一条 —— 用户在手选列表里选了 tencent 那条，
重载后很可能又被解析回 netease 的另一条。所以绑定数据**加上选中的源与 id**：

```js
raw.lyricMatch = { song, artist, keyword, at, server, mid, title }
```

`runBoundFirst` 改为：**有 `mid` 就直接用 `server + mid` 取词**；没有才回退按关键词搜
（兼容老数据）。`lyricMatchOf` 相应透出 `server` / `mid`。`bindLyricMatch` 新增第 5 个
参数 `pick`，并保留原有**清除旧 `lyricOffset`** 的逻辑（换词源后旧校准不再成立）。

## 改动文件

- `ui/index.html` + `ui/standalone.html`（孪生同步）：
  - 工具条加 `.lyric-align-top` 行 + `#lyricAlignSwap`；
  - 面板加 `<ol class="lm-candidates" id="lmCandidates" hidden>`；
  - 「搜索并绑定」按钮文案改「搜索歌词」（不再一步绑定）。
- `ui/style.css`：`.lyric-align-top` / `.lyric-align-swap`；`.lm-candidates` / `.lm-cand*`。
- `ui/app.js`：`submitLyricMatch` 重写为列候选、新增 `renderLmCandidates` /
  `bindLmCandidate` / `lmCandidateList`；`bindLyricMatch(…, pick)`；`lyricMatchOf` 透出
  `server`/`mid`；`runBoundFirst` 走确定性取词；`#lyricAlignSwap` 与 `#lmCandidates` 事件；
  `openLyricMatch`/`resetLyricMatch` 清候选；`__playerDebug` 加探针。
- `tools/verify-ui.mjs`：新增候选夹具（关键词含「候选」）+ 4 条断言；收敛 1 条既有断言。
- **未动 `lib/` 与后端**（纯前端交互）。

## 验收

- `verify-backend` **22/22**（未动）
- `verify-ui` **171/171**（12/12 布局、4/4 窄卡、零运行时错误）

新增断言：
- `lyric-align-tools-has-swap-button`（工具条有「换歌词」，且与读数同一行）
- `lyric-align-swap-opens-match-panel`（点它开面板）
- `lyric-match-lists-candidates`（列出 ≥2 条、跨平台、**选之前没绑上**）
- `lyric-match-binds-picked-candidate`（点腾讯那条 → 绑定的就是 `server:tencent mid:9003`）

## 待真机

候选列表在三种布局下的高度（168px 限高）、「换歌词」在长按工具条里的观感、
候选条目里平台胶囊的读感。

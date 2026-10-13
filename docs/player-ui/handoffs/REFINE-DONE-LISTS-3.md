# 歌单管理体验改造（第三轮 · 落点 / 队列菜单 / 最近播放）

日期：2026-10-11 · 分支 `hana-simple` · 基线 HEAD `d05d466`（build `1003131654`）
交付：`ui/app.js`、`ui/index.html`、`ui/standalone.html`、`ui/style.css`、`tools/verify-ui.mjs`
（未 bump-build、未部署、未 reload；部署归统筹线）

三件事：修一个导入落点缺口、扩队列行菜单、修「最近播放」排序。

---

## 1. 导入落点：链接导入直落「我的喜欢」

**缺口**：`resolveImportTarget(nameIfLocal)` 注释写「归到当前激活列表」，实现却只认 `imp:` 开头的
列表；在 `fav` / `recent` / `local` 页粘链接时会跳过它，去新建/复用一个名为「单曲」的导入列表 ——
用户莫名多出一个歌单。

**改法**：`resolveImportTarget` 原样保留（本地文件那条路 `resolveImportTarget('本地文件')` 语义不同，
不动）。另立链接专用落点：

- `resolveLinkTarget()` → `ensureList('fav','我的喜欢')`，返回 `'fav'`。
- `afterImportToFav(added)` → 落盘 + 重渲染 + toast（新增「已加入《我的喜欢》」/ 已存在
  「《我的喜欢》里已有这首」两种文案）。**不切激活列表**（与搜索页加红心同一心智）。
- `importBiliLink`（B站链接）与 `importLink` 的单曲分支都改走 `resolveLinkTarget()`；
  歌单分支仍走 `newImportList('歌单')`（语义不同，不动）。

两条链接路都落到 `fav`：B站（`importBiliLink`）与网易云数字 id 老路（`importLink` 单曲分支）。
「本地文件夹导入」（`resolveImportTarget('本地文件')`）**未动**。

## 2. 队列行「⋯」菜单：三项

`#morePop` 从一项扩为三项：`#removeBtn`（从队列移除，保留）、`#moveBtn`（移动到…）、
`#copyNameBtn`（复制歌名）。新增两个 Lucide 形状 symbol `i-move` / `i-copy`（两孪生同步加），
许可见 `ui/LUCIDE-LICENSE.txt`（`move` / `copy`）。

### 移动到…
- 二级浮层 `#movePop`（`#moveTitle` + `#moveList` + `#moveNote`），`closePops()` 与 Esc 分层都接上。
- `moveTargetsFor(srcList)`：目标 = `fav` + 所有 `imp:`，**排除 `local` / `recent`**，
  也排除当前所在列表（移到自己 = 无操作）。空则 `#moveNote` 给明确提示。
- 入口是否显示：`moveTargetAllowed(t)` —— 只有 `fav` / `imp:` 来源行显示「移动到…」；
  `recent` / `local` 来源**不显示该入口**（本地移动会破坏「本地严格=文件夹」不变式；
  最近播放想收藏直接点红心），但仍保留**移除 + 复制歌名**（旧行为一行不碰）。
- 移动语义：同一首歌在两个歌单是**两条独立记录**（`uid = list|id`），移动 = 从原歌单摘 +
  往目标歌单树一份（目标已有同 id 则去重），**移动 ≠ 复制**（源侧不留副本）。
- **正在播的那首被移走** → 转播放指针到目标副本（`state.currentUid = dstCopy.uid`）。音频源是
  同一个 `url`，`<audio>` 不重载，播放不中断。移动必然在目标留副本，所以不出 `detached`
  （那条只留给 `removeFav` / `deleteList` 的「全库无副本」情形）。
  `shuffleTrail` 栈顶若指向被移走的旧 uid，同步改为新 uid，维持「栈顶永远是当前曲目」；
  即便不同步，`shuffleBackUid()` 也会自然弹出过期 uid 并退回顺序上一首（已有防御，实测确认）。
- 移动后不自动切歌单：`toast('已移到《XX》')`，人留在原地。

### 复制歌名
`hana.clipboard.writeText(t.title)` —— **只歌名**，不带歌手。成功 toast「已复制歌名」、
失败/能力缺失都 toast，不让 Promise 裸奔。

## 3. 「最近播放」：最近在前（倒序）

**自相矛盾**：`recordRecent()` 重播把歌 `push` 到末尾并注释「末尾 = 最新」，但 `visibleTracks()`
按 `state.tracks` 顺序直接显示 → 最新的显示在**最下面**；而空列表引导语却写「最近的在最前」。

**改法**：改 `recordRecent` 的插入位置（**采纳统筹线判断，不动 `visibleTracks`**）——
`visibleTracks` 被 `currentIndex` / 上一首 / 下一首共用，往里塞只对一个列表有效的 reverse 分支是埋雷。
现在「存储顺序 = 显示顺序 = 最近在前」，`visibleTracks` / `currentIndex` / `stepIndex` 零改动，
落盘顺序与界面一致。

- 插入：新播/重播一律插到 recent 段**最前一条之前**（`recentBounds().first`），
  没有 recent 项时追加末尾。
- 丢弃：超 `RECENT_MAX`（100）时从 recent 段**末尾（最旧）**往前找第一条非当前项删掉，
  保护正在播的那条；整段只剩当前项则本轮不再丢。
- 引导语「最近的在最前」是与新行为一致的既有文案，未改。

已知副作用：在「最近播放」里点上一首/下一首是「更新 → 更旧」，这是「最近在前」的必然语义。

---

## 4. 验收

`node tools/verify-ui.mjs` → **266/266**（自检 12/12、窄卡 4/4、零运行时错误，
`wiringOk` / `migrationOk` / `lifecycleOk` 全 true）
`node tools/verify-backend.mjs` → **30/30**

### 新增断言（12 条）

| 断言 | 锁什么 |
|---|---|
| `import-link-lands-in-fav` | 网易云单曲链接 → fav +1、不新增列表、激活列表不变、无「单曲」歌单 |
| `import-bili-lands-in-fav` | B站链接同一口径 |
| `queue-menu-three-actions` | ⋯ 菜单三项齐全且可读（移除 / 移动到… / 复制歌名） |
| `move-targets-exclude-local-recent` | 移动目标只含 `fav,imp:2`（排除 local/recent/源列表） |
| `move-between-lists` | A→B：A 少一、B 多一、B 里能找到、源 uid 消失 |
| `move-dedupes-target` | 目标已有同 id：不新增 B、A 少一、无重复行 |
| `move-playing-keeps-playback` | 移动正在播的那首：`playing=1`、未暂停、指针= `fav|id`、行 is-current 对上 |
| `copy-song-name-writes-clipboard` | `clipboard.writeText` 被调一次、入参 === 歌名、出 toast |
| `recent-order-newest-first` | 连播 A→B→C → 顺序 C,B,A |
| `recent-replay-moves-to-front` | 重播 A → A 回到最前（A,C,B） |
| `recent-overflow-drops-oldest` | 灌 120 条 → 封顶 100、首条 O119、最旧 O0 被丢、O20 仍在 |
| `recent-row-hides-move-keeps-remove-copy` | recent 行不显示移动、移除 + 复制仍在 |

### ⚠️ 修正的现有断言（随产品行为**有意**修正，非放宽）

以下几处编码的是**旧落点行为**（链接单曲「归入当前激活列表」）。产品改为「直落 fav」后，
观察位置必须跟着改：

1. `wiring.importSingle` —— 旧断言 `after === before + 1`（当前列表 +1）；新断言改为
   `fav +1`、激活列表不变、不新增列表、无「单曲」歌单。（`tools/verify-ui.mjs` 第 2 段）
2. `wiringOk` —— 对 `importSingle` 的复合判据同步换成新字段。
3. `import-link-bili-paste-adds-track` —— 观察位置从「当前列表行数」改到 `fav`
   （`listTracks('fav')` 对比），并加 `imp:1` 不变。
4. `import-link-bili-multi-note` / `import-link-netease-still-works` —— 落点后**切到 fav 页**
   再核（B站/网易云链接导入后当前页不再是落点页）。

**理由**：产品行为变了，断言必须跟着变；不改就等于把测试留在一个不再成立的行为上。
git blame 到这几行应能看出「产品落点变了」，而非「测试被调松」。（代码注释里已就地标注
「⚠️ 产品行为变更 2026-10-11」。）

## 5. 真机清单（无头证不了，交统筹线）

- 移动**正在播**的那首：声音不断、进度不跳；三种布局各试一次。
- 「复制歌名」粘到系统剪贴板，确认只歌名（无歌手、无歌单前缀）。
- 「最近播放」顺序：连播几首看是否最近在最上；重播看是否上浮。
- 三种布局（窄卡 / 长卡 / 独立窗）下二级移动浮层的定位与溢出滚动。
- recent / local 行确认只剩「移除 + 复制歌名」。

## 6. 踩过的坑 / 约定

- 链接导入不再新建「单曲」歌单：`resolveImportTarget` 保留给**本地文件**那条路，
  别再把链接分支接回去。
- 孪生 HTML 一致（只差 `data-shell`），`i-move` / `i-copy` 两个 symbol 两处同加。
- PV 块未碰。

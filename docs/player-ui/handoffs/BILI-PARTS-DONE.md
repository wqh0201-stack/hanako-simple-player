# B站分P（多 P 视频）展开与导入 —— 完成

2026-10-11。罐头需求：B站搜索结果里「一个地址塞很多分P」的合集，现在只能播第一 P、
也拿不到分P标题。要能优雅展开，并支持把整条超长合集导入成歌单、或部分/全部收进「我的喜欢」。

## 一、根因（先厘清，再动手）

**搜索结果里根本没有分P信息。** `x/web-interface/wbi/search/type` 的回包只有
`bvid / title / duration / author / pic` 等，**没有任何字段说明这条是不是多 P**：

- `episode_count_text` 只对课程 / 番剧这类 **PGC** 有值（「共 78 课时」），
  UGC 分P视频一律空串（实测：`BV1CAxaeHEeH` 149 P、`episode_count_text` 为空）。
- 逐字段 diff 单P与多P两条搜索结果，除时长/UP主/播放量这些本就不同的项，无任何分P线索。
- `duration` 是**整支视频的总时长**（149 P 那条回 `6489:18` = 108 小时），不是单曲时长。

分P数和每 P 标题只在 `x/player/pagelist` 里：
`data: [{cid, page, part, duration}, …]`（轻量 ~200ms，36 次连打并发 8 全 `code:0`、无风控）。

而取流走 `resolveBiliAudio(ctx, bvid)` 时只读 `view.data.cid` —— 那个字段**恒等于 P1 的 cid**，
所以「播 B站视频」永远只到第一 P、也拿不到任何一 P 的 `part`。两件事同一个根。

其它实测事实：
- `playurl` 必须 `bvid + cid` **同给**；只给 `cid` 回 `-400`。指定 P 的 cid 能正常拿 dash 音频。
- `part` 就是干净歌名（陶喆合集 `P2 = "02 爱，很简单【陶喆同名专辑】"`），比视频标题好洗得多。
- 合集（`ugc_season`）是另一层：那几集是**各自独立的 bvid**，不是分P。本轮不碰。

## 二、设计

### id 必须带 cid
go 路由 path 只有 id 一个字段。同一支视频的所有 P 若共用裸 bvid，落库会被当同一首去重成一条
（134 P 塌成 1 条）。所以分P的稳定 id 是合成形 **`bilibili:<bvid>_<cid>`**：

- 分隔符 `_`：go 路由校验 `[A-Za-z0-9_-]+` 放行；bvid 里没有 `_`，不歧义。
- 单P视频行为**完全不变**：搜索映射仍是 `bilibili:<bvid>`（不带 cid），
  `parseBiliTrackId` 对裸 bvid 回 `cid:0` → 回落 `view` 取 P1。

### 分P入口是二段式的（探测 → 展开）
因为搜索结果没有分P数，「分集 N」这个 N 只能查出来。方案：

1. **探测**：只对**时长 ≥ 10 分钟**的 B站行查一次 pagelist（正常单曲 3-5 min 摸不到阈值），
   一轮搜索最多探 `BILI_PROBE_MAX = 10` 条。探到 >1 才在该行标题后挂「分集 N」，
   顺手把结果缓存，点开不再请求。
2. **展开**：点标记 -> 有缓存就直接铺开，没有则现拉（`.bili-tree` 里显「正在拉取分集…」）。

> ⚠️ 这是对统筹「分P懒查询，不预取整页 30 条」的一处**有意收紧**：完全不在加载时探测，
> 就永远拿不到 N（搜索结果无分P字段），也就无法只给多P行挂入口。收紧的边界是
> 「只探长视频 + 有额度上限 + 缓存」，单曲行永远不会冒出「分集」。

### 展开形态（罐头定稿）
- **分集标记跟在标题后**（`分集 134` + 箭头），`flex:none` 永远完整；标题 `flex:1 1 auto; min-width:0`
  先让位缩成省略号。第一行 `height:18px`，标题 `line-height:18px`，标记 `height:18px` + 居中
  —— **同一根水平中线**（歪的根因是两行基线对不齐：标题 12.5px、标记 10.5px，flex 基线对齐会错位）。
- **红心钉在行尾**固定列，标题多长都不动。
- **树形展开**：`grid-template-rows: 0fr → 1fr`，高度真从零长出来（不是 display 切换、不是
  max-height），收放 340ms 同一缓动，下面那条结果被平滑顶回。子行左侧一条竖向导引线。
- **子面板限高滚动**（`max-height:232px`）：134 P 会有 4000+ px。

### 落点（罐头拍板）
- **子行红心 = 收藏**（加入「我的喜欢」），与主行 / 搜索红心**同一套 `isFav()` 现算口径**。
  不做选择框、不做「已选 N」计数。
- **头部「全部加入我的喜欢」** = 批量收藏（逐集落 fav，已在则跳）。
- **「导入成歌单」** = 整条合集导成一个新 `imp:N` 歌单（名字 = 视频标题），
  走 `mergeTracks` 同一条路；**不塞「我的喜欢」**（134 首混进收藏夹很难收拾）。

## 三、改动文件

### 后端
- **`lib/bilibili.js`**
  - 新增 `listBiliParts(ctx, bvid)` -> `{parts:[{cid,page,part,dur}], videos}`（包 pagelist）。
  - `resolveBiliAudio(ctx, bvid, cid)`：`cid` 给了就直接用它，不给才 `view` 取 P1。
  - 新增 `biliTrackId(bvid, cid)` / `parseBiliTrackId(rawId)`（合成 id 的编解码）。
- **`lib/register-routes.js`**
  - 新增 `GET /widget/api/music/bili-parts?bvid=`，回 `[{id,title,author,pic,dur,page,cid,url}]`，
    形状与搜索结果的曲目一致（前端可当普通曲目播放/收藏/入列表）。
  - `resolveAudioUrl` 对 `server=bilibili` 先 `parseBiliTrackId` 拆 bvid/cid 再透传。
  - 非翻页端点，无需改 allowedHosts（`api.bilibili.com` 已在）。

### 前端
- **`ui/app.js`**
  - `ENDPOINT.biliParts`；状态 `biliProbe / biliOpen / biliPartsCache / biliProbesLeft`。
  - `isBiliTrack` / `biliBvid` / `showPartsFor` / `probeBiliParts` / `toggleBiliParts` /
    `renderPartsTree` / `togglePartFav` / `favAllBiliParts` / `importBiliParts`。
  - `renderSearchResults`：标题后挂分集标记、展开时嵌 `.bili-tree`。
  - `doSearch` / `clearSearch`：重置分P探测状态；`doSearch` / `loadMoreSearch` 成功后 `probeBiliParts`。
  - `searchList` 点击处理：分集标记 / 子行播放 / 子行红心 / 全部喜欢 / 导入成歌单，均先于通用分支。
  - `__playerDebug` 新增 `biliPartsState / biliPartsProbe / biliPartsFeed / biliPartsToggle /
    biliPartsImport / biliPartsFavAll / setServer`（测试探针）。
- **`ui/style.css`**：`.bili-mark`（定高居中）/ `.bili-tree`（展开动画）/ `.bili-plist`（限高 + 导引线）/
  `.bili-prow` 等；`.search-row { flex-wrap: wrap }` + `.q-line1`。
- **`ui/index.html` + `ui/standalone.html`**（孪生同步）：手动匹配歌词弹窗里补一句静态提示
  `<p class="lm-hint" id="lmAlignHint">歌词绑定后若与节奏不齐，长按歌词拖动即可对齐</p>`
  （放在 `#lmNote` 与 `.lm-actions` 之间；**不复用 `#lmNote`**——那行会被动态改写）。

### 验收
- `tools/verify-backend.mjs`：+`bili-parts-shape` / `bili-parts-endpoint` / `bili-parts-reject-invalid`
  → **22/22**。
- `tools/verify-ui.mjs`：+`bili-parts-mark-only-on-multi` / `bili-parts-expand-in-place` /
  `bili-parts-list-scrolls` / `bili-part-fav-goes-to-fav` / `bili-parts-import-to-new-list` /
  `lyric-match-align-hint-present`。夹具：`server=bilibili & keyword 含「多P」` 回两条
  （一条长时长多P、一条短片单P）；`/music/bili-parts` 对 `BV1Multi` 回 12 集。

## 四、边界 / 待真机

- **探测阈值 10 分钟**：歌单型合集若视频本身不到 10 分钟（少见）会漏探测，点标题直接播第一 P。
  真机若常见可下调阈值，但要注意别把普通 MV 探成多P（探到 1 集不挂了，也不亏）。
- **`part` 不总是歌名**：课程类是 `1.1 映射`，照当歌名用，歌词匹配走现有 `cleanLyricQuery`。
- **超长合集导入**：现在无上限，134/195 集会一次进新歌单。若真机上嫌重，可加「前 N 集」或确认框。
- **`baseUrl` 有效期 120 分钟**：分P取流同样走 `audioUrlCache`（5 分钟）与 go 代理，无差异。
- **待真机看一眼**：树形展开的收放手感（尤其长列表下 0fr→1fr 的观感）、
  子面板 232px 限高在三种布局下的合适度、分集标记在窄卡里的挤压情况。

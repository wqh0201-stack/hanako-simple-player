# REFINE-DONE-SEARCH-PAGINATION

搜索结果**无限滚动翻页**。罐头反馈「网易云只出 20 条 / B站只出 30 条，没法翻页」，
根因是整条搜索链（后端接口 + 前端）**从来没有分页概念**，不是 UI 的 bug。

## 一、根因（改前实测）

| 平台 | 症状 | 真因 |
|---|---|---|
| 网易云 | 恒 30 条 | 走公共 Meting 节点 `?server=netease&type=search`，**节点不接受翻页参数**——给 `page`/`limit`/`n` 都回同一批 30 条（实测）。`lib/meting.js` 里也只是本地 `slice(0, limit)`。 |
| B站 | 恒 20 条 | `lib/bilibili.js` 里搜索地址写死 `&page=1`；接口本身支持翻页（实测 `numPages=50`、`page_size` 有效），只是页码没透出来。 |
| QQ / 酷狗 | 只 3 条 | 走 Meting 节点本就只回 3 条，内容本身少，翻页意义不大（未处理）。 |
| 前端 | 无入口 | `doSearch()` 没有 offset 概念，每次都从第 1 页拿；后端回的 `total` 从未被前端读取。 |

## 二、改法

### 后端

**`lib/meting.js` 新增 `searchNeteaseOfficial(ctx, { keyword, offset, limit })`**
网易云改走**官方** `music.163.com/api/cloudsearch/pc`（该主机已在 manifest 白名单，**不扩权、不触发审批**），
`offset` / `limit` 直接透传，真分页。它是这套改动里最重要的一块：**字段翻译**——
官方曲目形状是 `name` / `ar[].name` / `al.picUrl` / `dt`，与 Meting 的 `title`/`author`/`pic` **完全不同**，
`normalizeNeteaseSong` 负责映射，并合成一条与 Meting 同形的 `url`（`?server=netease&type=url&id=…`），
让路由层既有的 `toGoUrl` / `metingStableId` **一字不改**地继续工作。

**`lib/bilibili.js` 的 `searchBili`** 加 `page` 参数（`page_size` = limit），页码由上层的 offset 换算而来。

**`lib/register-routes.js` 的 `/widget/api/music/search`**：
- 新增可选请求参数 `offset`（缺省 0 = 第一页）、`limit`（缺省 30）。
- netease → `searchNeteaseOfficial`（官方接口失败时降级回 Meting 节点，退首屏、`degraded:true`）。
- bilibili → `page = floor(offset/limit) + 1`、`page_size = limit`。
- tencent / kugou → 仍走 `searchMusic` 节点（节点不吃 offset，只给首屏）。

### 契约（硬约定，对下游不变）

`/widget/api/music/search` 的**对外返回形状与不分页时完全一致**：
`{ ok, results[], host, total }`，`results[]` 每项仍是 `{ id, title, author, pic, url, lrc }`。
`offset`/`limit` 是**请求参数**，不进响应体。下游三条调用点（`app.js:2233` 歌词跨源兜底、
`app.js:2640` resolveTrackUrl 回退、`app.js:3884` doSearch）取的都是 `results[]` 老字段，全部不受影响。

`total` 语义统一为「**结果总数**」：
- 网易云 = 接口真实 `songCount`（**精确**）；
- B站 = `numResults`，⚠️ **平台截顶在 1000**，代码注释已注明是「近似/上限值」；
- Meting 节点（QQ/酷狗）= 节点本页条数。

### 前端（`ui/app.js`）

- 新增状态：`SEARCH_PAGE`(=30) / `searchKeyword` / `searchTotal` / `searchLoadingMore` / `searchPaginated`。
- `doSearch()` 抽出 `fetchSearchPage(gen, kw, server, offset, …)` 作为「首屏 / 翻页」共用入口，
  沿用既有 `searchSeq` 代次守卫（翻页在途时改了关键词，旧响应自动丢弃）。
- `loadMoreSearch()`：三重护栏（**仅搜索层** `searchPaginated`、非在途 `searchLoadingMore`、
  未到 `searchTotal`），追加时**按稳定 id 去重**（防源在翻页边界重复回上一页末尾）；
  源回空或全重复（如 B站 1000 截顶）→ 把 `total` 收敛为已载入数，尾巴消失。
- 无限滚动监听 `.search-list`（它自己 `overflow-y:auto`，页身不滚），触底判定
  `scrollTop + clientHeight >= scrollHeight - 120`。
- **边界：翻页只属「搜索」层**。`openChart` / `openRadio` 的详情层显式置 `searchPaginated = false`，
  不会长出翻页尾巴。
- `「共 N 条」` 文案改读 `total`（原来报的是本页条数，会谎报），缺失/为 0 时退化为已载入条数。
- `ui/style.css`：新增 `.search-more` 尾巴（固定 44px 高，避免加载态切换时列表抽搐）。
- **孪生文件**：`ui/index.html` / `ui/standalone.html` 本次未动（改动全在 `app.js` / `style.css`，
  两份 html 都引用同一份）。

## 三、验收

- `node tools/verify-backend.mjs`：**19/19**（新增 8 条：网易云归一形状、官方端点命中、
  total 精确、offset 透传、B站形状/首页/总数近似/第二页换算、非网易云走节点不变）。
- `node tools/verify-ui.mjs`：新增翻页断言 5 条——
  `search-pagination-first-page` / `search-pagination-appends` / `search-pagination-exhausts` /
  `search-pagination-stops-at-total` / `search-pagination-not-on-detail-layer`。
  假后端对关键词含「分页」回 75 条数据集（每页 30）以便真跑滚动加载。

## 四、未做 / 边界

- QQ / 酷狗仍无翻页（节点不给 offset，要救得走 cookie / 官方接口，不在本次范围）。
- 「搜歌手」范围仍只换标签、不换接口（官方 `type=100` 是新增功能，罐头拍板保留原样）。
- B站无 LRC 歌词源（退回无词），与本轮无关。

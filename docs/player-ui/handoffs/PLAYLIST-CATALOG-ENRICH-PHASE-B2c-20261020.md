# 统一整理 Phase B2c：缓存增量、索引优先、入口（2026-10-20）

状态：**部分实现，尚未达到 B2c 三个边界的完整验收。** 构建 `1003131796`，版本 `1.2.2`。未部署、未改生产 playlist/cache/cookies，未提交/推送，未碰 `OH-Works/`。

## A. 缓存增量（已改，未独立小测）

`lib/catalog-index.js::listAlbums`：

- `at` 只作为“完整扫描完成”时间，不再每页刷新为刚完整；
- 30 天过期后从 `nextOffset=0` 有界重扫，保留旧 `albums`，合并新专辑；
- 未完成扫描不刷新 `at`，下轮沿游标继续；
- 每页最多 `maxPages`，固定轮次不会伪造 `complete`；
- 页内专辑按 id 去重，已成功关系不因页失败清空；
- `build` 仍只抓缺失/过期详情，复用新鲜详情。

未完成：隔离计数小用例（过期发现新专辑、旧详情复用、重建继续）尚未写/跑。

## B. 索引优先匹配闭环（未完成）

现有 `startEnrich` 仍只按 artist 建库 + 本地 `pickCoverMatch`，没有新增“少数未解项复用 coverResolve 有界兜底”，也没有本轮要求的单曲索引优先/上限提示闭环。此边界未交付，不能宣称可用。

## C. 入口（部分改）

- `ui/index.html` / `ui/standalone.html` 的歌单菜单 `listCoverBtn` 文案改为“整理歌单…”；
- `listCoverBtn` 已接 `openEnrichPanel`；
- 行内更多菜单新增“整理此曲…”`enrichTrackBtn`，接 `openEnrichPanel(t.list,t.uid)`；
- 统一整理段新增 `enrichSingleUid`，`startEnrich` 仅在单曲入口时筛当前 uid；同 id 副本仍按既有事务同步；
- `catalogRestoreInfo(listId, uid)` 支持单曲目标恢复，单曲面板恢复不调用整歌单恢复；
- `getCoverBtn` 原“获取此曲封面”路径未改。

未完成：单曲入口的面板歌名输入/重试体验、312×494 / 1040×780 实际可操作性、完整文案与面板状态验收。

## 基础自检

- `node --check ui/app.js`、`node --check lib/catalog-index.js` 通过；
- 构建 `1003131796` 三处一致；
- 孪生 HTML 仅 `data-shell` 差异；
- `git diff --check` 通过；
- 既有事务 10/10、调度 10/10 通过；未跑旧全量。

日志：`docs/player-ui/handoffs/playlist-catalog-enrich-20261020/phase-b2c-basic.log`

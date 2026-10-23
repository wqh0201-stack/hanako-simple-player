# 统一整理 Phase B2a：原始信息备份/事务回滚/恢复（2026-10-20）

状态：**B2a 已完成，独立控制器脚本 10/10 通过。** 构建 `1003131793`，版本 `1.2.2`；未部署、未改生产 playlist/cache/cookies，未提交/推送，未碰 `OH-Works/`。

## 已改

统一整理区域新增稳定段：

`/* ---------- 统一整理事务 ---------- */`

- `enrichSnapshot(t)`：按副本记录 title/author/artist/pic 及 raw 字段存在性与原值；
- `enrichTxSnap`：按 uid 只快照一次，且在任何改动前执行；
- `enrichTxWrite` / `enrichTxRaw`：记录字段写入及“原来是否存在”；
- `enrichTxRollback`：按写入逆序恢复；只有当前值仍等于本作业写入值才回滚，用户并发改动不被全 raw 覆盖；目标已移出/ detached 则跳过；删除字段（`undefined`）按“当前已不存在”识别为本作业结果，正确恢复原值；
- `enrichTxCanCommit`：保存前复核原目标仍在原列表、未 detached，并逐项核对作业触及字段仍是本作业写入值；冲突则回滚且不保存；
- `catalogRestoreInfo`：改为 Promise、busy 时拒绝重入；恢复 title/author/artist/原 album/albumId/songId；新 v2 备份用 `hadAlbum/hadAlbumId/hadSongId` 恢复“原本不存在”；旧 v1 备份只恢复确实有记录的字段；不删除原封面/共享 `catalogMatch`/`catalogLyric`/手动绑定/偏移；保存失败完整回滚；
- `startEnrich`：
  - 先 `enrichTxSnap` 再新建 `catalogBackup`，不再先写备份后快照；
  - 同 id 的现有各列表副本都同步标准信息/自动绑定，各自备份原值；仅初始目标与存活检查限原列表；
  - title/author/artist/album/albumId/songId/catalogMatch/catalogLyric 全部走事务写入；
  - 实际封面写入也走事务（不再依赖盲 `rollbackCovers` 兜底）；补图时跳过已有 coverMatch 或自选封面的副本；
  - 保存前 `enrichTxCanCommit` 真实复核；匹配/取词等待期间用户改名或删除目标则安全终止、不保存、不复活删除；
  - 取消/保存失败统一 `enrichTxRollback`。

## 验证

`tools/verify-catalog-transaction-hana.mjs`：**10/10 PASS**，覆盖：

1. 标准元数据同步所有现有副本、各自首备份、稳定 ID/音轨/顺序；
2. 二次整理不替换首备份；
3. 保存失败完整恢复显示与 raw（含原本不存在的封面字段）；
4. 手停后不保存、完整撤销；
5. 恢复值与字段存在性，保留共享 ID/歌词/封面/偏移；
6. 恢复保存失败撤销字段删除；
7. 取词等待期间改名不提交、不覆盖用户新标题/raw.name；
8. 删除目标不提交、不复活；
9. busy 拒绝重入，删除字段 ledger 回滚正确；
10. 旧 v1 备份只恢复已知字段。

日志：`docs/player-ui/handoffs/playlist-catalog-enrich-20261020/phase-b2a-transaction.log`

## 基础自检

- `node --check ui/app.js` 通过；
- 构建 `1003131793` 三处一致；
- 孪生 HTML 仅 `data-shell` 差异；
- `git diff --check` 通过。

日志：`docs/player-ui/handoffs/playlist-catalog-enrich-20261020/phase-b2a-basic.log`

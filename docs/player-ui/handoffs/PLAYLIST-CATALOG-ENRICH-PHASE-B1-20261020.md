# 统一整理 Phase B1：官方身份进入播放歌词链（2026-10-20）

状态：**B1 完成并通过独立验收脚本 14/14；不是最终完整包，未部署。**
生产仍 `1003131785`；源码构建 `1003131791`，版本 `1.2.2`。未改生产 playlist/cache/cookies，未提交/推送，未碰 `OH-Works/`。

## 生产链改动

- `ui/app.js::loadLyrics` 新增官方自动歌词分支：
  - 优先级：当前名用户 LRC → `raw.catalogBackup.name` 原名 LRC → 手动 `raw.lyricMatch` 原降级链 → 官方 `raw.catalogLyric`/`raw.catalogMatch` 的 `provider=netease,songId` → 无自动身份时保持旧链。
  - 官方分支只请求 `/api/catalog/lyric?songId=...`，不按标准名重新搜索，不调用 `lrcSave`。
  - 官方分支取词失败/无词时直接结束，不回退名称模糊搜索；手动修正入口仍在。
  - `autoCatalog` 改用 `doneLrc(r.text, null)`，保留 `[offset:250]` 的 `advanceMs`，不改变 `raw.lyricOffset`。
- `inheritedLyricSettings` 在新增同 id 副本时：
  - 复制已有的 `catalogLyric`；
  - 若源只有有效 `catalogMatch`，归一成 `catalogLyric`，让副本仍能按同一 songId 取词；
  - 不复制 `catalogBackup`，不覆盖目标已有手工 `lyricMatch`/偏移。
- `lyricGen` 代次保护保留；迟到响应不会覆盖新曲。自动歌词不触碰 `audio.src`/`currentTime`。

## 验证

独立脚本 `tools/verify-catalog-lyrics-hana.mjs`：**14/14 PASS**，覆盖真实 `loadLyrics`：

1. 自动 ID 进入 `state.lyricLines`，0 关键词搜索、0 按名称 `lrcSave`。
2. `[offset:250]` 保留，`lyricBaseOffset=250`。
3. 当前名/原名用户 LRC 优先。
4. 手动绑定与偏移逐字保留。
5. 同名不同官方 ID 不共用缓存键。
6. 同一官方 ID 不同音轨偏移各自独立。
7. 重载/normalize 后自动身份仍可用。
8. 新增同 id 副本继承自动身份，不复制备份、不覆盖手工字段。
9. 仅 `catalogMatch` 的共享身份也能传给新副本。
10. A 迟到不覆盖 B。
11. 官方无词/错误不伪造成功、不模糊搜索、不按名称落盘。
12. provider/songId 严格校验。
13. 无自动身份的旧曲目保持原降级链。

日志：

- `docs/player-ui/handoffs/playlist-catalog-enrich-20261020/phase-b1-lyrics.log`
- `docs/player-ui/handoffs/playlist-catalog-enrich-20261020/phase-b1-basic.log`

基础：语法通过；构建 `1003131791` 三处一致；孪生 HTML 仅 `data-shell` 差异；`git diff --check` 通过。

## 边界

- 本轮只做 B1；B2（整理控制器、事务/停止/冷却/恢复/UI）未做。
- 未做真实宿主/播放器端到端；专项是隔离生产函数调用，不冒充真机验收。
- 未跑旧全量/旧 29/87；未安装依赖。
- 未部署、未改生产数据、未提交推送。

## Hana 复跑

```bash
cd /Volumes/SSD/hanadesk/hanako-audio-player-simple
export ELECTRON_RUN_AS_NODE=1
NODE=/Applications/HanaAgent.app/Contents/MacOS/HanaAgent
$NODE tools/verify-catalog-lyrics-hana.mjs
```

预期末尾：`HANA_CATALOG_LYRICS 14/14`。

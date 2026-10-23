# 指定歌手优先 + 统一「编辑歌曲」· 1821 最终交付

日期：2026-10-21。源码构建 **1003131822**。继续原码农会话，沿用 1817 安装后的源码；未部署、未提交、未改真实 playlist/cache/cookies/LRC、音轨 URL/ID/顺序、手工词/偏移或 OH-Works。

## 1820 主体

- 批量手填歌手进入 `startEnrich`，旧绑定按本次指定歌手校验；指定 A 时不再被时长更近的 B 抢走。
- “更换匹配 / 编辑显示信息 / 重新识别 / 更换封面”收进单一 `编辑歌曲…` 面板。
- 面板内含显示信息、参考查找/候选、封面缩略图、歌词状态、恢复入口、取消/保存；草稿选择不写，保存走事务，失败回滚。
- 新增复制当前显示歌手，完整合作歌手文本原样复制。

## 1821 集中返修

### 1. 待确认要求在后续空歌手批量中保留

`ui/app.js:8967`：存在 `catalogPending.artist` 的曲目，在下一轮空歌手批量中直接按待确认保留，不再复用旧绑定 B，也不会因 `enrichApplyReference` 清除 pending。只有用户新填明确歌手或明确手选参考，才按新意图重查/解除。

统一编辑面板新增独立“查找用歌手”输入（`ui/index.html:370`）。打开待确认曲目时：

- 显示歌手仍保留当前显示 B；
- 查找用歌手默认取 pending 的 A，不把旧显示 B 当新查询意图；
- 保存失败查找不会把 A 写进显示信息。

### 2. 查询意图与显示编辑分离

`ui/app.js:8624` 的查找只读 `songEditSearchArtist`，显示字段仍只由用户手工编辑：

- 查找 A 失败且未选参考时，保存只写 `catalogPending`，不会把显示 B 改成查询词 A；
- 真正手工修改显示信息仍能保存，显示编辑只作用当前 uid，不暗换参考/封面/歌词；
- 查找失败提示改为“保留原样/待确认”，不再暗示会写入查询词。

### 3. 专辑补读后的艺人复核

`ui/app.js:7400` 新增 `referenceArtistAllowed`；`referenceResolve` 在专辑补读合并艺人后重新校验全部指定 ID，不只看搜索阶段：

- 搜索 A、同 songId 专辑补读为 B 时，候选被移除且不自动匹配；
- 与 1817 的最终时长复核同一层，不再让补读元数据越过指定歌手约束；
- 指定歌手的候选列表也不再显示补读后变成 B 的项。

### 4. 恢复改为草稿、临界阶段与歌词跳转守卫

- `songEditRestoreInfo/RestoreCover` 不再关闭编辑器调用即时保存：设置草稿标记、预览字段/提示，保存时才通过 `ui/app.js:8866`/`8884` 的事务 helper 提交；取消不写。
- 恢复仍保留原范围、原始备份、手工词/偏移，不新建历史系统。
- 候选/封面按钮 click 增加 `songEditSaving` 守卫；保存开始时使迟到封面读取失效并中止读取；迟到结果不重新创建可点候选。
- 保存临界阶段禁用显示/查找/取消/恢复/歌词/复制/封面刷新等入口。
- `songEditLyricBtn` 在有未保存草稿时只提示“先保存或取消”，留在编辑器，不直接跳到旧参考的歌词流程；无修改时沿原入口。

## 实际通过

- **`ARTIST_FINAL_GAPS 7/7`**（`tools/verify-artist-final-gaps-hana.mjs`，生产函数/事务 helper）：
  - pending A + 旧 B，空歌手批量保持原字段、原参考、pending A，且无查询；
  - 查找 A 失败后保存，显示 B 不被 A 覆盖，pending A 写入；
  - 搜索 A、专辑补读 B 时不自动匹配且候选不含 B；
  - 恢复信息/原图 helper 不重写备份，手工词/偏移不变。
- **`UNIFIED_EDITOR_UI 6/6`**（仅跑新增节点分支，312×494 与 1040×780，真实生产 DOM/保存 payload）：
  - 待确认曲目显示 B、查找默认 A、无写入保存后显示不变且 pending A；
  - 恢复信息/原图草稿点击不写，取消后字段/图片/pending 保持；
  - 有未保存草稿点歌词入口留在编辑器并提示。
- 前序记录未重跑：`ARTIST_PRIORITY 9/9`、`UNIFIED_EDITOR_UI 8/8`。
- 基础检查：`node --check ui/app.js`、`ui/_build.json = 1003131822`、孪生 HTML 仅 `data-shell` 不同、`git diff --check` 通过。

日志：
- `docs/player-ui/handoffs/playlist-catalog-enrich-20261020/artist-priority-final.log`
- `.../unified-editor-ui-final.log`
- `.../artist-final-gaps.log`
- `.../unified-editor-pending-ui.log`
- `.../unified-editor-pending-ui-hana.json`
- `.../artist-priority-final-basic.log`

## 未验证 / 边界

- 未联网跑真实网易/B站完整歌单；候选、封面和歌词来自临时 mock，不代表线上所有野生版本。
- UI 新节点分支 6/6 覆盖 312/1040 的待确认、恢复草稿、歌词脏草稿；原 8/8 布局流程未重跑。
- 保存临界下的迟到封面读取、动态按钮并发只做了源码守卫，未单独制造网络竞态。
- 恢复信息/原图的 helper 与取消路径已测；真正保存恢复结果的完整 UI 事务未单独跑。
- 复制歌手的宿主 clipboard 失败回退未单独制造失败；同步路径已由前序 8/8 覆盖。
- 未部署、未提交推送、未打包安装；真实业务数据与 `OH-Works/` 未触碰。

下一步由主会话负责打包、官方静态校验和正式安装审批，再由用户实际试用。

# 混合歌单参照匹配 · 1817 收尾交接

日期：2026-10-21。源码构建 **1003131817**。本轮在原 1816 基础上集中返修，不重做主体；UI 6/6、19/19、5/5、旧 9/9 沿用前序记录，未按指令重跑。未部署、未提交、未改真实 playlist/cache/cookies/LRC、音轨 URL/ID/顺序或 OH-Works。

## 本轮修复

### 1. 旧搜索缓存缺 duration 时按候选补读

`ui/app.js:7383` 起 `referenceResolve` 增加 `READ_MAX = 3` 的有界 `ensureDuration`：

- 搜索候选缺时长时，按候选 `albumId` 读取一次专辑/缓存，补 `duration` 后重算 `_delta/_tolerance/_allowed`。
- 不按歌手全库扫描、不清缓存、不全量刷新；同一 albumId 在一次解析内复用读取 Promise。
- `ui/app.js:7371` 的 `referenceDecorateDuration` 负责统一重算。

新增断言：旧搜索候选无 duration + 专辑 240 秒 -> 自动匹配成功且 `albumCalls=1`；搜索 240 秒但专辑 1200 秒 -> `match=null`、`reason=duration`、候选 `_allowed=false`；人工选择仍可走“更换匹配”。

### 2. 专辑补读后重算最终时长

最终候选合并专辑元数据后统一走 `referenceDecorateDuration`，搜索阶段“通过”不再代表自动采用：

- 搜索 240 秒、专辑 1200 秒的超差项不自动匹配。
- 若前面的候选超差，继续尝试后续有界候选；全部超差则返回 `duration`，交给人工。
- 不再出现“搜索通过 -> 专辑冲突 -> 仍 match=true”。

### 3. 搜索原始字段单位

`lib/cover-catalog.js:106` 的 `search()` 现在按现有 `meting.js:170` 的契约处理：`dt` / `duration` 原始值均按毫秒，统一 `/1000` 输出秒；`album()` 保持同样毫秒契约。

`tools/verify-mixed-gaps-hana.mjs` 使用生产 `createCoverCatalog.search()` 和原始 API 形状，不依赖前端已标准化 mock：

- 原始 `dt: 240000` -> 240 秒
- 原始 `duration: 240000` -> 240 秒

### 4. 手动更换匹配的保护错误与部分失败

`ui/app.js:8359` `applyMatchChoice`：

- 专辑补读 catch 现在对 `AbortError`、`requiresVerification`、`cooldown` 一并重抛，停止后续图片/歌词请求并回滚；不再吞掉账号验证/冷却保护后继续。
- 封面/歌词部分失败会保留原图/手工词，并在 toast 明确“默认封面未更新，保留原图”“自动歌词未取到”或“手动歌词保留”，不再只报全成功。
- 封面预检、探针和歌词错误仍走原保护/记录路径。

### 5. 编辑显示信息首次备份与互斥

`ui/app.js:8545` 抽出 `enrichEnsureBackup`，自动整理与编辑显示信息共用“只首次建立 catalogBackup”的路径：

- 未整理曲目第一次手动编辑会建立最初备份；已有备份不重写。
- `saveEditPanel` 只改当前 uid 的显示信息，仍不改 `catalogMatch`/封面/歌词/偏移。
- `openEditPanel` 增加 `coverPickBusy` 与选图面板可见性互斥，避免选图保存与编辑并发。

### 6. 按需专辑缓存表头

`lib/catalog-index.js:179` 不再只写 `{id,...d,pic,tracks,at}`：

- 保留已有 `data.albums[id]` 的 `name/type/subType/size/published/pic`。
- 缺表头时从官方 tracks 的 `album/albumType/subType/albumSize/published` 补齐，再写入缓存。
- 保持按 albumId 持久图片缓存入口，不重建整库，不影响 `catalogArtistDict` 的专辑关系视图。

## 实际通过

- **`MIXED_GAPS 10/10`**（本轮新增，日志 `docs/player-ui/handoffs/playlist-catalog-enrich-20261020/mixed-reference-gaps-final.log`）：
  - 旧缓存缺时长补专辑并成功
  - 搜索/专辑时长冲突不自动采用
  - 原始 `dt` 毫秒 -> 秒
  - 原始 `duration` 毫秒 -> 秒
  - 编辑首次建立备份
  - 二次编辑不重写备份
  - 手动更换匹配遇到验证保护时停在图片前、无保存
  - 按需专辑缓存补齐 name/type/size/published
  - 其余配套断言
- 前序记录沿用：
  - `MIXED_REFERENCE 19/19`
  - `MIXED_START 5/5`
  - `MIXED_REFERENCE_UI 6/6`（312/1040，真实生产保存 payload；本轮 UI 布局未改，未重跑）
  - `TITLE_NORMALIZATION 9/9`
- 基础检查（日志 `mixed-reference-final-basic.log`）：
  - `node --check ui/app.js`
  - `ui/_build.json = 1003131817`
  - `ui/index.html` 与 `ui/standalone.html` 仅 `data-shell` 不同
  - `git diff --check` 通过

## 剩余问题 / 未验证

- 未联网跑真实网易/B站完整歌单；新断言使用原始形状 mock 和临时目录，不代表线上所有旧缓存都已覆盖。
- UI 6/6 是在 1816 前序同进程跑的；本轮未重跑浏览器，因为未改布局。新增互斥/提示逻辑由源码路径和 `MIXED_GAPS` 保护/备份断言覆盖，未做真实宿主点击。
- `catalog-index.cover` 的按需表头补齐已用临时缓存验证，但未接入真实 `catalogArtistDict` 全流程。
- 未做部署、提交、推送、正式安装审批；真实业务数据与 `OH-Works/` 均未触碰。
- 若主会话需要，下一步是整包打包、官方静态校验与正式安装审批，再由用户实际试用。

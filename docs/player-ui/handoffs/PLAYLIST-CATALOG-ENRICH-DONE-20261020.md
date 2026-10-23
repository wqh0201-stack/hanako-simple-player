# 统一歌单整理：专辑索引、标准信息、封面与歌词复用（2026-10-20）

状态：**未完成，不能作为最终完整包部署**。源码构建 `1003131786`，版本 `1.2.2`；未部署、未重载、未提交/推送。
基线：生产已安装 `1003131785`；HEAD `744523f`；`OH-Works/` 未触碰。

## 本轮已落地（源码存在，未完成验收）

### 后端

- `lib/netease-gate.js`：进程内共享闸门，真实请求起始间隔目标 2s；405/429 设 60s 冷却；并发/重试共用。**尚未用注入时钟验证并发/重试/冷却/取消，未接前端剩余冷却提示。**
- `lib/catalog-index.js`：`catalog-index.json` 持久索引（artist/albumLists/albums，30 天 TTL）；专辑表两页 + `more` 保留；`build` 分批拉取正式专辑详情；封面按 albumId + 源图 hash 存 `catalog-covers/`；歌词按 songId 存 `catalog-lyrics/`。
- `lib/cover-catalog.js`：请求改为经共享闸门；405/429 冷却且不即时重试三次；search/albums 保留专辑公开元数据。
- `lib/register-routes.js`：新增 `/api/catalog/artist|build|index|cover|lyric`。**路由/图片 Content-Type/错误路径未做集成测试。**

### 前端

- `ui/index.html` / `ui/standalone.html`：新增「整理歌单…」入口、`catalogRestoreBtn`（恢复原始曲目信息）；孪生同步。
- `ui/app.js`：
  - `openEnrichPanel` / `startEnrich` / `catalogRestoreInfo` 骨架：按歌单 B站曲目建立索引、本地 `pickCoverMatch`、标准名/歌手/专辑、封面、歌词元数据；每副本写 `raw.catalogBackup`，重复整理不覆盖最初备份；恢复信息不动封面/歌词。
  - Taylor 相关解析：`[2012]` 当年份装饰剥离；`Long Live` 不再被裸 `live` 后缀拆掉；`Taylor's Version` 作为重录版本；缺省歌手允许官方合作曲目多出歌手。
  - 单曲「获取此曲封面」语义未改。
- **未完成**：自动歌词尚未接入 `loadLyrics` 播放链；手工歌词/偏移保护只有元数据层判断，未做播放链专项；整理面板没有端到端 UI 用例；标准信息恢复/封面恢复的交叉场景未验。

## 实际运行

| 检查 | 结果 |
|---|---|
| `node tools/verify-cover-match.mjs` | 29/29 PASS（上一轮 1785 回归，新增倒序/分页用例） |
| `node tools/verify-cover-catalog.mjs` | 13/13 PASS（节流测试注入 0 间隔闸门，**未验 2s 生产闸门**） |
| `node tools/verify-ui.mjs --covers-only` | 87/87 PASS，runtimeErrors `[]`（新增菜单/面板未触发） |
| 构建 | `1003131786` 三处一致；孪生 HTML 已同步 |

## 明确未完成 / 不建议部署

1. **没有 Taylor `imp:11` 100 首真实回放**；没有新增 Taylor 公开元数据夹具。Anti-Hero/Long Live/[2012]/exile/Taylor's Version 只有代码级规则，未用真实样本证明。
2. **没有统一整理的端到端 UI 测试**；没有验证备份恢复、重复整理、手动封面/歌词保护、保存失败回滚。
3. **没有自动歌词播放链验证**；`catalogLyric` 目前只是元数据，`loadLyrics` 尚未消费。
4. **没有 2s 闸门/405 冷却的注入时钟测试**，也没有冷却等待可中断、批量一次恢复试探、自动保护停止语义。
5. **没有索引/封面/歌词路由的错误路径和真实小请求验证**；没有请求复用/跨歌单复用证据。
6. 因此本轮不能报告“完整包”，也不应安装给用户。

## 文件

- 新增：`lib/netease-gate.js`、`lib/catalog-index.js`
- 修改：`lib/cover-catalog.js`、`lib/register-routes.js`、`ui/app.js`、`ui/index.html`、`ui/standalone.html`、`ui/_build.json`
- 测试：`tools/verify-cover-match.mjs`、`tools/verify-cover-catalog.mjs`
- 原始专项日志：`docs/player-ui/handoffs/cover-fill-safe-20261020/`

## 边界

未部署、未重载、未改生产 `playlist.json`/cache/cookies/歌词，未对真实歌单执行整理，未提交/推送，未碰 `OH-Works/`。

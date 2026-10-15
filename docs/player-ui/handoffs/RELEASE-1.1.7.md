# 1.1.7 发版记录（横条形态 + 歌名/来源可点 + 单曲封面获取）

2026-10-15。本地四 commit → tag → Release → 市场 PR #91 登记更新，全部完成。

## 一、本地提交（tag `v1.1.7-simple` → `bdef3c5`）

| commit | 内容 |
|---|---|
| `cdc2f5f` | feat(player)：横条形态（第四种呈现）——氛围取色进度 + 玻璃光片；`ui/app.js` / `ui/style.css` / 两个 html；tools 新增 `verify-album-ambient.mjs` / `verify-strip-flow.mjs` / `verify-touchbar.mjs` / `inspect-album-ambient.py`；PITFALLS 记「同源分片代理吃宿主 32 格 HTTP 流配额」；`.gitignore` 排除交接大截图 |
| `63b9743` | docs(changelog)：1.1.7 段补横条形态 |
| `b13a574` | docs(readme)：补横条（第四形态）说明，抹平引言旧口径 |
| `bdef3c5` | docs(readme)：补横条真机截图（深/浅主题） |

构建号 **1003131726**（`ui/_build.json` + 两个 html 三处一致，孪生文件校验通过）。
（`manifest.json` / `package.json` 的 1.1.7 在更早的 `c4b4812` 已写入。）

> 说明：本轮横条由仓库协作实现方（Codex / 码农）完成并自验；发版前由发布方独立复跑全量套件并打包核对。

## 二、发布物

- tag `v1.1.7-simple` → commit `bdef3c5`
- Release：https://github.com/wqh0201-stack/hanako-simple-player/releases/tag/v1.1.7-simple
  （非草稿、非预发布）
- 附件：`app-hanako-simple-player-1.1.7.zip`（0.69 MB）+ `.entry.json`
- 官方静态校验：errors=0 warnings=1（`DYNAMIC_DEPENDENCIES_NOT_PROVEN`，只覆盖声明的 HTML/CSS 资源，属预期）
- **SHA-256**：`9866eb19aee1560f9177800eb56716f7390dbea1e5720667064aefcb69f1cab9`
  —— 本地重算 / entry.json 的 `archive.sha256` / 从 Release 下载回来重算，**三方一致**

## 三、市场 PR

- 仓库 `liliMozi/hana-marketplace`，PR **#91**（沿用 #65 合并后的更新分支
  `update-simple-player-1.1.3`，head 为 `wqh0201-stack:update-simple-player-1.1.3`）
- 改动：只动 `approvals.json` 里本 App 一条的 `tag` + `sha256` + `readme`（用 GitHub
  Contents API 直改，免克隆）。条目数 97 → 97，被改动条目仅 `hanako-simple-player` 一个；
  `registry.json` 未动。
  - `tag`: `v1.1.6-simple` → `v1.1.7-simple`
  - `sha256`: → `9866eb19…f1cab9`
  - `readme`: 追平仓库 README（旧快照还写着「三种承载形态」，补横条与新功能；即 TODO 里
    「README 引言与市场 `readme` 快照未追平」那一项）
- 提交：`4acd723 chore: 小花音乐播放器（hanako-simple-player）登记更新到 v1.1.7`
- PR 标题与正文已同步改为 v1.1.7（Stable Release 链接 / 变更说明 / 自测报告里的
  Release、构建号 1003131726、sha256；正文内嵌横条深/浅两张真机截图 raw 链接）。
- `mergeable: MERGEABLE`、`mergeStateStatus: UNSTABLE`（UNSTABLE 只是还没有 check 报告，非阻断）。

## 四、验证

- `tools/verify-ui.mjs` 全量：**606/606** 断言，布局自检 **12/12**、窄卡 **4/4**，runtime errors **0**
- `tools/verify-backend.mjs`：**132/132**
- 官方只读校验 `scripts/extension-market-sync.mjs --check`（带 token + 代理）：
  `extension-market-sync: index would change (97 item(s))`，exit 0 —— 已把 Release 附件下载回来核对

## 五、如实记的未完成项

- 官方隔离启动 smoke 因本机无独立 Electron runtime 未完成，未当作通过。
- 横条专项的自动化矩阵由实现方交付；本机复跑的是全量套件与打包/登记核对。

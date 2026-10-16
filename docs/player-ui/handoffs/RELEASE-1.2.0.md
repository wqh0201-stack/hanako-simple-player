# 1.2.0 发版记录（横条卡顿修复 + 交互 / 高度打磨）

2026-10-16。本地 commit → tag → Release → 市场 PR #91 登记更新，全部完成。

## 一、本地提交（tag `v1.2.0-simple` → `1ef6649`）

| commit | 内容 |
|---|---|
| `f5c60c4` | fix(player)：横条交互/尺寸/高度自适应 + `setInteractiveRegions` 打洞（1733→1739 一串返修，含各轮 DONE/ACCEPT 文档与根因证据）；构建号 **1003131739** |
| `9ab0a7b` | chore(release)：1.1.7 → 1.2.0（`manifest.json` / `package.json` 版本号、CHANGELOG 1.2.0 段、TODO 清已发布的横条待验收项） |
| `1ef6649` | test(touchbar)：两条断言跟随 1734/1738 契约更新（`motion-press-feedback`、`TB-03-hover-follows-pointer`）；PITFALLS 记「改了交互契约先查断言口径」 |

构建号 **1003131739**（`ui/_build.json` + 两个 html 三处一致，孪生文件校验通过）。

> 说明：横条这一串修复由仓库协作实现方（Codex / 码农）完成并自验；发版前由发布方**独立复跑**全量套件并做打包 / 登记核对。

## 二、发布物

- tag `v1.2.0-simple` → commit `1ef6649`
- Release：https://github.com/wqh0201-stack/hanako-simple-player/releases/tag/v1.2.0-simple
  （非草稿、非预发布）
- 附件：`app-hanako-simple-player-1.2.0.zip`（709,113 B ≈ 0.68 MB）+ `.entry.json`
- 官方静态校验：errors=0 warnings=1（`DYNAMIC_DEPENDENCIES_NOT_PROVEN`，只覆盖声明的 HTML/CSS 资源，属预期）
- **SHA-256**：`30409287e006264045477aa1ca1efe81a80c2d001cc71b31bc2e4b3cc1d98f61`
  —— 本地重算 / entry.json 的 `archive.sha256` / 从 Release 下载回来重算，**三方一致**

## 三、市场 PR

- 仓库 `liliMozi/hana-marketplace`，PR **#91**（沿用 #65 合并后的更新分支
  `update-simple-player-1.1.3`，head 为 `wqh0201-stack:update-simple-player-1.1.3`）
- 改动：只动 `approvals.json` 里本 App 一条的 `tag` + `sha256`（用 GitHub Contents API 直改，免克隆）。
  条目数 97 → 97，被改动条目仅 `hanako-simple-player` 一个；`registry.json` 未动；`readme` 未动。
  - `tag`: `v1.1.7-simple` → `v1.2.0-simple`
  - `sha256`: `9866eb19…f1cab9` → `30409287…d98f61`
  - 提交：`818ea54 chore: hanako-simple-player 登记更新到 v1.2.0`
- PR 标题与正文已同步改为 v1.2.0（Stable Release 链接 / 变更说明 / 自测报告里的
  Release、构建号 1003131739、sha256；正文内嵌横条深/浅两张真机截图 raw 链接）。

## 四、验证

- `tools/verify-ui.mjs` 全量：**606/606** 断言，布局自检 **12/12**、窄档 **4/4**，runtime errors **0**
- `tools/verify-backend.mjs`：**132/132**
- 从 Release 下载回来重算 zip sha256 = 登记值（见 §二）

## 五、如实记的未完成项

- **官方只读校验 `scripts/extension-market-sync.mjs --check` 未跑**：本机没有 `hana-marketplace`
  仓库克隆，脚本不在这边。已按发版清单做**等效人工核对**：① 从 Release 下载两附件 ② 重算 zip 的
  sha256 = 登记值 ③ `entry.json` 的 `kind/id/publisher/version` 与登记一致 ④ `archive.sha256` = 登记值。
  人工核对不能替代自动校验的结论。
- 官方隔离启动 smoke 因本机无独立 Electron runtime 未完成，未当作通过。
- 横条专项自动化矩阵由实现方交付；本机复跑的是全量套件与打包 / 登记核对。

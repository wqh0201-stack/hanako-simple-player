# 市场登记完成（1.0.0）

2026-10-11。把「小花音乐播放器」1.0.0 推向 Hana Global 市场，全流程在本机完成，
最后一步（登记 PR）已提交，等维护者审核合并。

## 一、本地收口

- 出窗隐藏修复（独立窗口按「无指针活动」隐藏）落 commit `2af6f52`，含 `ui/app.js` +
  `tools/verify-ui.mjs` + 交接文档 + build bump（1003131651）。
- 与本地收口线 HEAD 一致，工作树干净。

## 二、发布物

- tag `v1.0.0-simple`（指向 `2af6f52`）。
- 打包 `tools/pack-release.mjs`（先把运行时文件复制到临时目录、目录名 = manifest.id，
  再交给官方 extension-pack；排除 docs/tools 非运行时）：
  - `app-hanako-simple-player-1.0.0.zip`（0.57 MB）
  - `app-hanako-simple-player-1.0.0.entry.json`
  - 校验：errors=0 warnings=1（官方静态检查只覆盖声明的 HTML/CSS 资源，属预期）
- **SHA-256**：`fc9d7bea377518db37ffa188fc621fb8a347670d32d8d710c6ba6e524c205ece`
  （zip 本地重算 / entry.json 的 archive.sha256 / 从 Release 下载回来重算，**三方一致**）

## 三、Release

- https://github.com/wqh0201-stack/hanako-simple-player/releases/tag/v1.0.0-simple
- 非草稿、非预发布，两个附件（zip + entry.json）已上传，从远端下载回来核对 sha256 一致。

## 四、市场登记 PR

- 仓库：`liliMozi/hana-marketplace`（Hana Global 市场目录，不接收源码/安装包）
- PR：**#65** https://github.com/liliMozi/hana-marketplace/pull/65
- 分支：`wqh0201-stack:enroll-hanako-simple-player`
- 改动：**只动两个登记文件、纯追加**（12 additions / 0 deletions）
  - `registry.json`：追加 `{kind:app, id:hanako-simple-player, repository:wqh0201-stack/hanako-simple-player, publisher:wqh0201-stack}`
  - `approvals.json`：追加 `{kind:app, id:hanako-simple-player, tag:v1.0.0-simple, sha256:fc9d7bea…c205ece}`
- PR 素材（图标 + 3 张截图）放在**自己仓库**的 `market-assets` 分支 `market/` 下，
  用 raw 链接内嵌 PR 正文（模板要求不要把图片提交到市场仓库）。
- `mergeable: MERGEABLE`、`mergeStateStatus: UNSTABLE`——UNSTABLE 只是还没有 check 报告，
  非阻断。

## 五、校验情况（如实记）

- 官方只读校验 `scripts/extension-market-sync.mjs --check`：**本机跑不通**，
  报 `fetch failed` / `timeout` 于 `github.com/.../releases/download/...`。
  **根因是本机到 `github.com/releases/download` 这条路的网络问题**（`gh` CLI 走另一条
  通道能正常下载），**不是登记数据的问题**——同一脚本第一次尝试时 entry.json 已校验通过，
  只卡在 zip 下载超时。
- **等效人工核对已做**：从 Release 用 `gh release download` 取回两个附件，
  重算 zip 的 sha256 = 记录值；entry.json 的 `kind/id/publisher/version` 与登记一致，
  `archive.sha256` = 记录值。这四项正是同步器要校验的内容。
- PR 合并后由市场侧 Action 跑 `sync-market.yml` 生成 `index.v2.json`；维护者审核合并即上架。

## 六、尚未做的

- 未推任何无关分支；`dist-release/` 已在 `.gitignore`。
- 中国大陆市场独立审核发布，本次只登记 Global。
- 后续版本更新需再提 PR 改 `approvals.json` 的 tag + sha256（市场不自动发现新版本）。

# 1.2.1 发版记录（横条歌词星尘 + 网易云无音源恢复）

2026-10-16。本地提交、Tag、Stable Release、市场 PR #91 登记更新均已完成。

## 一、本地提交与构建

| commit / tag | 内容 |
|---|---|
| `1aa9555` | 横条歌词与星尘动效收尾、网易云无音源处理；对应交接、验证工具及测试口径调整 |
| `d9aeae0` | 版本号、变更日志、常驻项目说明更新到 1.2.1 |
| `v1.2.1-simple` | 指向 `d9aeae09ca79d6b6c4a0b8d4fc7a921d8759ee52` |

UI 构建号 **1003131768**，`ui/_build.json` 与两份孪生 HTML 一致。Release 前安装包校验 errors=0、warnings=1（静态分析不证明动态依赖与网络响应）。

## 二、发布物

- Stable Release：https://github.com/wqh0201-stack/hanako-simple-player/releases/tag/v1.2.1-simple（非草稿、非预发布）
- 附件：`app-hanako-simple-player-1.2.1.zip`（722,105 字节）与 `.entry.json`
- ZIP SHA-256：`389c78a3e2b732b9a3d75f312a05e93941de0c6401284040ae91d5ef23d159a8`
- `.entry.json` asset SHA-256：`c87f08a20471269b2e4d6930984ebb63e02d12c6465a620ff306572691e3cc7f`
- 本地封包、entry 的 `archive.sha256`、GitHub Release asset digest、经 hana-downloader 下载后的重算值一致；两个下载文件均与本地附件逐字节相同。

## 三、市场 PR #91

- 仓库：`liliMozi/hana-marketplace`；沿用分支 `wqh0201-stack:update-simple-player-1.1.3`
- PR：https://github.com/liliMozi/hana-marketplace/pull/91
- `approvals.json` 原有 97 条；只更新 `hanako-simple-player` 的 `tag` 与 `sha256`，未改 `registry.json` 或 readme 快照。
- 登记提交：`d41e0b38dc15c41c1e5278432e22ceaa2817d161`；更新后 `approvals.json` blob：`4a76e5d1471f51af8286c311bbe05cbd9ba0a02f`
- 新登记：`v1.2.1-simple` / `389c78a3e2b732b9a3d75f312a05e93941de0c6401284040ae91d5ef23d159a8`

## 四、验证

- `node tools/verify-ui.mjs`：**592/592**；布局自检 **12/12**；窄档 **4/4**；runtimeErrors **0**。
- `node tools/verify-backend.mjs`：**132/132**。
- 官方打包静态校验：errors **0**、warnings **1**（动态依赖/网络响应的静态检查边界）。
- Release zip 经下载复核：SHA-256 与本地 zip、entry `archive.sha256`、GitHub asset digest 一致。

## 五、如实记的未完成项

- 独立横条歌词专项既有结果 **37/45**；8 条红项仍要求旧硬描边，与当前柔影视觉契约不一致。本次没有重跑该专项，也未计入全量通过数；旧断言迁移仍待处理。
- `scripts/extension-market-sync.mjs --check` 未跑：本机没有市场仓库克隆；已人工核对 Release 附件、entry 元数据与 PR 登记。
- 未做独立 Electron/Hana 隔离 smoke；当前歌词效果由用户在候选预览中确认。

## PR 正文

本 PR 将小花音乐播放器的市场登记更新到 1.2.1，沿用现有开放 PR #91。

### Stable Release
- Release：https://github.com/wqh0201-stack/hanako-simple-player/releases/tag/v1.2.1-simple（非草稿、非预发布）
- Tag：`v1.2.1-simple`；构建号：`1003131768`
- 附件：`app-hanako-simple-player-1.2.1.zip`（722,105 字节）与 `.entry.json`
- ZIP SHA-256：`389c78a3e2b732b9a3d75f312a05e93941de0c6401284040ae91d5ef23d159a8`

### 更新内容
- 横条歌词整句同时消散，星尘从可见笔画同步散出；余辉更慢、整体强度收敛，新句仍随曲目时间淡入。
- 横条字号按整曲最长行统一适配并保持两行；高亮色避开进度星光，柔影帮助歌词适应动态底色。
- 网易云只有在官方接口明确确认无音源时才提示，可转到 B 站搜索或从当前歌单删除；网络、登录态、接口异常不误报为版权问题。

### 自测
- `node tools/verify-ui.mjs`：592/592；布局自检 12/12；窄档 4/4；runtimeErrors 0。
- `node tools/verify-backend.mjs`：132/132。
- 官方打包校验：errors 0，warnings 1（静态检查不证明动态依赖与网络响应，属已知范围限制）。
- 用 hana-downloader 下载 Release 附件复核：ZIP 与本地包、`.entry.json` 中的 archive.sha256 一致，均为上述 SHA；ZIP 大小一致。
- 市场分支 `approvals.json` 共 97 条；本次只改本 App 的 `tag` 与 `sha256`，未动 `registry.json` 和 readme 快照。登记提交：`d41e0b38dc15c41c1e5278432e22ceaa2817d161`。

### 已知测试范围
- 独立横条歌词专项已有记录为 37/45；8 条失败仍要求旧硬描边，与本版采用的柔影视觉契约不一致。本轮未重跑该专项，也未把它计入通过数字；旧断言迁移见项目交接记录。
- `scripts/extension-market-sync.mjs --check` 未运行（本机没有市场仓库克隆）；已人工核对 Release 附件、entry 元数据及 PR 登记。
- 没有独立 Electron/Hana 隔离 smoke；当前横条歌词效果已由用户在候选预览中确认。

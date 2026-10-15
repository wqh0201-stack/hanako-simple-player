# 1.1.6 发版记录（圆角全交宿主，修四角白牙）

2026-10-15。本地三 commit → tag → Release → 市场 PR #91 登记更新，全部完成。

## 一、本地提交

| commit | 内容 |
|---|---|
| `f7ce130` | fix(corner)：删 `.player` 自画 14px 顶角与 window 壳覆盖规则；`ui/app.js` 自检改四角 0；`verify-ui.mjs` 的 `top-corners-rounded` 改两壳 tl/bl 全 0；删 `tools/probe-audio-handoff.mjs` 及其在 verify-ui 里的 import；AGENTS.md §6 / PITFALLS.md 口径纠正 |
| `b191445` | chore(release)：1.1.5 → 1.1.6（manifest.json + package.json） |
| `44b2b66` | docs(changelog)：1.1.6 版本段 |

构建号 **1003131705**（`ui/_build.json` + 两个 html 三处一致，孪生文件校验通过）。

## 二、发布物

- tag `v1.1.6-simple` → commit `44b2b66`
- Release：https://github.com/wqh0201-stack/hanako-simple-player/releases/tag/v1.1.6-simple
  （非草稿、非预发布）
- 附件：`app-hanako-simple-player-1.1.6.zip`（0.65 MB）+ `.entry.json`
- 官方静态校验：errors=0 warnings=1（`DYNAMIC_DEPENDENCIES_NOT_PROVEN`，只覆盖声明的 HTML/CSS 资源，属预期）
- **SHA-256**：`3592ab65e10bfcbda69cc2de33aca2c4dc80c7099c6678fee40ee60440d4894b`
  —— 本地重算 / entry.json 的 `archive.sha256` / 从 Release 下载回来重算，**三方一致**

## 三、市场 PR

- 仓库 `liliMozi/hana-marketplace`，PR **#91**（沿用首次登记 PR #65 合并后的更新分支
  `update-simple-player-1.1.3`）
- 改动：**只动 `approvals.json` 里本 App 一条的 `tag` + `sha256`**，用 GitHub Contents API
  直改（免克隆）。条目数 97 → 97，被改动条目仅 `hanako-simple-player` 一个；
  `registry.json` 未动。
- PR 标题与正文已同步改为 v1.1.6（Stable Release 链接 / 变更说明 / 自测报告里的
  Release、构建号 1003131705、sha256）。
- `mergeable: MERGEABLE`。

## 四、验证

- `verify-ui.mjs`：**427/427**，自检 12/12、窄卡 4/4、运行错误 0
- `verify-backend.mjs`：**132/132**
- 删探针后 `node --check tools/verify-ui.mjs` 通过，全仓无残留引用

## 五、如实记的未完成项

- **真机目视未做**：本轮改动只涉及界面外观（四角直角）与开发脚本，播放链路无变更；
  重开卡片后的真机目视留待下一轮确认。
- 官方隔离启动 smoke 因本机无独立 Electron runtime 未完成。

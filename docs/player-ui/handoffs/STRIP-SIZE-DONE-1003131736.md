# 横条播放键与封面微调 · Codex 交接

2026-10-16。版本 **1.1.7**，构建 **1003131736**。基于已部署的 1003131734，保留工作树已有修改。本轮只改横条样式与构建标记，尚未部署；按用户要求由用户转交 Hana，不直接联系 Hana。

## 用户确认的改动

- 播放圆与实际按钮命中框一起由 **32×32px → 28×28px**，内部播放/暂停图标由 **18px → 16px**。左右各留 2px 外边距，保留原 32px 横向占位，按钮中心、相邻键位置及原有间距不变。按钮上沿增加 2px 空间，不整体下移控制组。
- 横条封面从 **64×64px → 62.08×62.08px**，等比缩小 **3%**；左、上各内收 .96px，保持原中心。进度条仍高 64px。
- 其他模式、其余横条按钮及宿主交互契约保持原有行为。本轮未接入 `setInteractiveRegions`，也未修改宿主。

改动位置：`ui/style.css`；`tools/bump-build.mjs` 已同步 `_build.json` 和两个 HTML 的构建标记。`docs/TODO.md` 记录待验状态。

## 基础检查与页面观察

- 构建号三处均 **1003131736**；两个 HTML 仅 body 的 `data-shell` 不同。
- `node --check ui/app.js`、`git diff --check` 通过。
- 复用已有 UI 夹具做本地无头页面加载与尺寸观察，没有运行全量回归或播放时序专项。
- **822×94**：播放键中心保持 **(425,47)**；相邻按钮位置与旧尺寸对照一致。播放键 y=33、高 28px，对照 y=31、高 32px。
- **400×94**：播放键中心保持 **(321,47)**；相邻按钮位置及隐藏项与旧尺寸对照一致。
- 两档封面实际量得约 **62.078×62.078px**（浏览器亚像素取整），进度条高 **64px**，中心误差不足 .01px。截图已查看。
- 页面 `runtimeErrors=[]`。夹具歌词本地未命中的预期 404、主动停止媒体产生的 ERR_ABORTED 单独记在 `expectedProbes`。

本地原始输出（沿用 touchbar 证据目录的 gitignore）：

```
docs/player-ui/handoffs/touchbar/size-1003131736/basic-checks.json
docs/player-ui/handoffs/touchbar/size-1003131736/page-smoke.json
docs/player-ui/handoffs/touchbar/size-1003131736/page-smoke.mjs
docs/player-ui/handoffs/touchbar/size-1003131736/strip-822.png
docs/player-ui/handoffs/touchbar/size-1003131736/strip-400.png
```

`basic-checks.json` 保存五个 UI 文件 SHA-256。`page-smoke.mjs` 仅使用本地假后端、系统 Chrome，不连接生产 Hana；复跑用 `OUT_DIR=docs/player-ui/handoffs/touchbar/size-1003131736 node docs/player-ui/handoffs/touchbar/size-1003131736/page-smoke.mjs`。

## Hana 部署与用户反馈

1. 从 `/Volumes/SSD/hanadesk/hanako-audio-player-simple` 整包同步 **ui/** 到实际安装来源，再执行 `extension_manager reload app:hanako-simple-player`。
2. 核对加载构建 **1003131736**，以 `basic-checks.json` 对照安装目录及宿主快照的五文件哈希。本轮无 manifest 扩权。
3. 只做基础检查后交用户实际体验：横条视觉重心是否保持；封面是否更平衡；从播放键上沿进入是否还触发中央拖动把手。
4. 将部署与待验结论写到 `STRIP-SIZE-ACCEPT-1003131736.md`，由用户转回 Codex。

**仍待真机确认**：本轮增加的是播放键上沿 2px 空间，本地页面夹具没有宿主拖动把手，不能据此判定宿主截获问题已彻底消除。若仍重叠，应记录卡片尺寸及实际重叠范围，再与用户对齐下一步。

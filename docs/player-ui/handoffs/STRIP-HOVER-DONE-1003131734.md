# 横条悬停、间距与音量越界返修

2026-10-16，Codex。版本仍为 **1.1.7**，候选构建 **1003131734**。

基线 1003131733 已由 Hana 整包同步并 reload（见 `INTERACTION-MOTION-ACCEPT-1003131733.md`）。用户实用后指出：右下移入先碰下一曲，再移到暂停键时高亮滞留；三键太密；缩窄时音量浮层会越出右侧。

本轮未联系 Hana、未部署、未 reload；由用户转交部署与实际体验验收。

## 改动

1. **悬停即时跟随命中**：横条按钮不再插值 background/color/box-shadow。离开旧键立即撤掉高亮，进入新键立即显示；播放键补清晰的内描边和提亮。按压仍保留内部 SVG 45ms / 140ms 的反馈，按钮命中盒不缩放。按钮内部图形设为 pointer-events:none，事件统一落到稳定的 button 上。
2. **三键更疏松**：transport 间距由恒定 2px 改为随宽度连续收敛的 **10→6px**；外部组间距由 10/8/4px 改为 **16→8px**。所有横条按钮保持 **32×32px**，不再缩到 30px。transport 本身不允许 flex 收缩，避免测得的分组宽度小于内部按钮占宽。
3. **音量提前整组隐藏**：排好按钮后计算完整浮层右界（含滑杆实际宽度和条内 8px 余量），放不下就先移除音量组，再重新排其余按钮。打开/拖动/聚焦音量时发生缩窄也会关闭浮层、释放对应指针记录，并把键盘焦点移至播放键；不会留下展开态或 inert 错位。仍沿用音量→喜欢→模式→上一首/下一首的退让顺序。

主要改动：`ui/app.js`、`ui/style.css`。构建号同步 `ui/_build.json` 和两份 HTML。`tools/verify-touchbar.mjs` 只将旧的固定间距断言更新为本次明确调整后的间距；未跑全量套件。

本轮没有修改播放意图队列、音频所有权、音源、宿主权限、manifest 或 app-data。

## 验证证据

本机 Chrome 临时夹具探针，非真实宿主结论：

- 修复前从下一曲移到播放键：命中及 :hover 已是 stripPlay，但下一曲背景仍保持高亮，播放键 filter 仍为 brightness(1)，要等过渡后才变为 1.04。
- 修复后同一路径：下一曲背景立即透明，播放键当次采样即为 brightness(1.08) 且有高亮描边，立即状态与 140ms 后状态一致。
- 三键快速往返 **15/15**：实际命中与唯一 :hover 按钮一致。
- 三键中心及两侧边缘反复往返 **27/27**：目标命中与 :hover 一致，失败集合为空。
- 15 档宽度（822→312）测量：音量可见时，完整浮层均留在条内并保留 8px 余量。实际样本：620px 时浮层右界 594.97，条右界 608；600px 时音量整组已隐藏。
- 展开音量后从 620 缩到 600：volume.hidden=true、open=false、reveal.inert=true，其余五个按钮正常保留。
- 移出后 hot=false、无残留 :hover；runtimeErrors=[]，探针 exit 0。
- 已查看 822px 悬停、620px 音量展开及 600px 音量隐藏截图。

原始输出与基础检查（共享仓库本地，沿用 touchbar 证据目录的 gitignore）：

```
docs/player-ui/handoffs/touchbar/hover-1003131734/probe.txt
docs/player-ui/handoffs/touchbar/hover-1003131734/basic-checks.json
docs/player-ui/handoffs/touchbar/hover-1003131734/hover-822.png
docs/player-ui/handoffs/touchbar/hover-1003131734/volume-620.png
docs/player-ui/handoffs/touchbar/hover-1003131734/volume-dropped-600.png
```

基础检查：构建号三处均 **1003131734**、孪生 HTML 仅 data-shell 不同、JS 语法与 git diff --check 通过、页面加载无运行时报错。五个 UI 文件 SHA-256 在 basic-checks.json。本轮按 AGENTS.md §8 不跑全量回归，也未重新跑上一轮播放时序专项。

## Hana 部署与用户体验

- 从 `/Volumes/SSD/hanadesk/hanako-audio-player-simple` 整包同步 **ui/** 到实际安装来源，再 `extension_manager reload app:hanako-simple-player`；不能只同步 app.js 或漏 style.css。
- 核对实际加载的 **1003131734**，以五文件哈希确认安装/快照与仓库一致。本轮没有 manifest 扩权。
- 基础检查后交用户按原路径实际体验：右下角移入→下一曲→暂停→上一曲，快速往返；缩窄时先收间距再隐藏按钮；音量已展开时继续缩窄，不应出现右侧截断或越界。
- 不从本机命中结果推断真实宿主手感已经通过。若还有滞留，请记录尺寸、承载、主题、实际路径和截图/录像，写入 `STRIP-HOVER-ACCEPT-1003131734.md`，交用户转回 Codex。

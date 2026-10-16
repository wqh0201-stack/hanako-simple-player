# 横条高度自适应 · Codex 交接

2026-10-16。版本 **1.1.7**，构建 **1003131738**。基线 1737 已由 Hana 整包同步并 reload（见 `SHARED-STRIP-CONTROLS-ACCEPT-1003131737.md`）。本轮未部署、未 reload、未直接联系 Hana，由用户转交。

## 用户反馈与本轮范围

用户反馈：横条左右拉宽后，输入不再卡滞，倾向于 Hana 尺寸相关的宿主行为。这是新的实用线索，仍未取得宿主输入链证据，不能将其写成已确认根因。本轮只处理用户提出的封面/进度条高度自适应。

用户已明确选择：**随容器高度变化，左右拉长不带动增高**。按钮和字号维持现有尺寸。

## 改动

- 进度条高度为 `clamp(56px, 容器高度 - 24px, 96px)`。正常伸缩段上下各留 12px；低于/高于伸缩段后尺寸保持上下限，并继续垂直居中。
- 封面保持正方形，高度始终是进度条的 **97%**；在对应方形占位中水平、垂直居中。保留此前缩小 3% 的视觉比例。
- 进度条左缘跟随封面占位变化；控件退让按实际条宽计算，替换原固定 `w - 100` 的预算，封面增大也不会推控件到条外。
- 旧背景快照保留原高度变量，避免形态切换期间套用新尺寸；封面获取状态图标随封面定位。
- 保留 1737 共用真实控件与 CSS 原生显隐。播放键 28px、其他按钮 32px，不随封面变大；媒体、权限及宿主协议未改。

主要修改：`ui/style.css`、`ui/app.js`；构建脚本已同步两个 HTML 和 `_build.json`。`tools/verify-touchbar.mjs` 更新既有尺寸规格及留足空间的音量样本，未运行全量套件。

## 基础检查与页面观察

构建号三处均 **1003131738**；孪生 HTML 仅 `data-shell` 不同；`node --check ui/app.js`、`node --check tools/verify-touchbar.mjs` 和 `git diff --check` 通过。

复用既有本地假后端夹具，观察 11 组尺寸与页面加载，无运行时报错。关键尺寸如下（封面为理想 CSS 尺寸，浏览器实际有亚像素取整）：

| 容器高 | 进度条高 | 封面高 |
|---|---|---|
| 68 / 80 | 56 | 54.32 |
| 94 | 70 | 67.90 |
| 103 | 79 | 76.63 |
| 112 | 88 | 85.36 |
| 120 / 160 / 220 | 96 | 93.12 |

- 11 组中，封面与进度条中心误差小于 .02px；播放键中心与条同轴，尺寸始终 28×28px，点位命中真实 `playBtn`。
- 312×160：条宽 180px，仍能容纳播放键，无横向溢出；音量按预算隐藏。
- 同为 103px 高，640px 和 1200px 宽均保持条高 79px，左右拉长不会增高。
- 822×160 音量展开：浮层右界 719px，小于条右界 810px。
- 已检查 80 / 103px 高的静态横条与 160px 高的控件/音量截图。

原始输出（沿用 touchbar 证据目录 gitignore）：

```
docs/player-ui/handoffs/touchbar/height-1003131738/basic-checks.json
docs/player-ui/handoffs/touchbar/height-1003131738/page-smoke.json
docs/player-ui/handoffs/touchbar/height-1003131738/page-smoke.mjs
docs/player-ui/handoffs/touchbar/height-1003131738/strip-80.png
docs/player-ui/handoffs/touchbar/height-1003131738/strip-103.png
docs/player-ui/handoffs/touchbar/height-1003131738/strip-160-controls.png
```

五文件 SHA-256 在 `basic-checks.json`。观察入口：`OUT_DIR=docs/player-ui/handoffs/touchbar/height-1003131738 node docs/player-ui/handoffs/touchbar/height-1003131738/page-smoke.mjs`。本轮按普通布局更新只做基础检查和页面观察，未重复运行播放链路专项、全量 UI 或后端回归。本地命中记录不等价于宿主输入验收。

## Hana 部署与用户体验

从 `/Volumes/SSD/hanadesk/hanako-audio-player-simple` 整包同步 **ui/**，执行 `extension_manager reload app:hanako-simple-player`，核对构建 **1003131738** 及安装/快照五文件哈希。

基础检查后交用户上下拉高/压低横条，确认中间段平滑变化、两端停止缩放、封面始终略小且居中；左右拉长时高度应保持不变。缩窄时控件和音量仍应提前退让。将部署及用户反馈分别写入 `STRIP-HEIGHT-ACCEPT-1003131738.md`。本轮没有修改宿主输入命中，不以高度自适应的结果宣称随机卡滞已根治。

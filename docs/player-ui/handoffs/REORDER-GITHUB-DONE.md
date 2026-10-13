# 长按排序与 GitHub 入口 · Codex 实现交接

日期：2026-10-13。基线：用户确认的 **1.1.2 / 1003131681 / d96b597**，开工时工作树干净。
候选：**1.1.3 / 1003131685**。本轮仅本地实现与候选包，不发布 Release、tag 或市场 PR。

## 最终需求与范围

- 顶部歌单标签长按约 450ms 后左右排序；歌曲主体长按后上下排序，红心与更多按钮独立。
- 用户中途明确：右键与原长按功能相同，**长按只用于排序**。原歌单管理保留右键，长按未移动便松手不弹菜单、不切歌单。
- 标签全部可调整位置，包括 fav / recent / local；固定名称与归属不变。歌曲允许 fav / local / imp 内排序，recent 保留时间顺序；歌单内搜索有文本时不排序，清空后可用。
- 拖动项跟手，邻项按接近距离产生立方曲线压力、轻微轴向压缩，并以有阻尼的弹簧让位和回弹。首尾可放入，边缘滚动速度按距离平方增加；松手落位，Esc / 失焦 / 页面隐藏 / 手势取消恢复；减少动态效果时不压缩、不回弹。
- 歌曲排序只调整本歌单的条目，其他列表副本、当前播放 UID / 地址 / 进度不变。Alt+Shift+方向键可移动焦点项，异步保存、重绘后焦点保留。
- fav 沿用 `playlist.json` 中既有 fav 副本的条目顺序，不另建收藏排序键。加入喜欢的新副本仍按既有 `prependTracks` 规则置顶，取消喜欢仅过滤该副本，其余已排序项的相对顺序保留。
- 同一 list 内有重复稳定 id，或无 id 且完整 URL 也重复时，排序返回 409，避免模糊定位造成条目丢失；不同 list 的同曲副本不会冲突。未对生产歌单作去重或清理。
- 搜索页 flex 列尾新增线描 SVG GitHub 图标与「抢先体验新版 · 反馈问题」，推荐页、结果页均可见，使用 `hana.external.open({url})` 打开 `https://github.com/wqh0201-stack/hanako-simple-player`。既有 open-external 声明不变。

## 实现文件

| 文件 | 原因 |
|---|---|
| `ui/app.js` | 共享长按/鼠标/触摸排序状态、局部动画、自动滚动、取消、键盘替代、持久化与外链。拖动中延后结构重绘/外部刷新，释放后同步；抑制释放时的点击，不吞掉下一次真实操作或宿主程序化点击。 |
| `ui/style.css` | 队列内绝对定位幽灵层、透明占位、宿主变量背景与阴影；搜索页底栏。紧凑头部收紧间距，保留原结果区最低高度。 |
| `ui/index.html` / `ui/standalone.html` | 同步底栏与 SVG symbol，除 body data-shell 外一致。 |
| `lib/reorder.js` | 移动单项到某项前面的意图，校验目标/锚点与重复身份；完整 URL 兼容无 id 老曲目，原元数据不丢。 |
| `lib/lists.js` / `lib/register-routes.js` | 同一个串行写者处理 POST `/api/lists/reorder` 与 `/api/playlist/reorder`，在最新数据上执行，缺失/删除的目标或锚点返回 409，无恢复已删除对象。列表仍落原 `player-lists`；曲目仍落原 `playlist.json`；通过既有变更键通知。 |
| `lib/library.js` | 普通全量快照只在相对其已读基线实际改顺序时调整那个列表；陈旧元数据保存不撤销另一窗口刚完成的排序，新增曲目仍置顶。 |
| `tools/verify-reorder.mjs` | 真实生产路由、隔离 app-data、真实 Chrome 鼠标/触摸/媒体的专项；宿主存储与外链桥是夹具。 |
| `tools/verify-ui.mjs` | 唯一需求断言调整：原“长按弹菜单”改为真实鼠标长按浮起、菜单保持关闭、未移动不改变顺序；右键删除断言保留。其余断言阈值未降低。 |
| manifest / package / CHANGELOG / build 三处 | 同步 1.1.3 与构建号、记录用户可见变化。权限、网络域、SDK 和音频仲裁不扩改。 |

## 自验与证据

原始输出目录：`docs/player-ui/handoffs/reorder-github-1.1.3/`。最终结果落定后更新本表。

| 检查 | 状态 | 原始输出 |
|---|---|---|
| 后端既有回归 | 132/132 通过 | `verify-backend.json` |
| 排序/GitHub 专项 | 42/42 通过 | `verify-reorder-summary.json`、`reorder/verify-reorder.json` |
| 音频唯一化专项 | 34/34 通过 | `verify-audio-owner.json` |
| 全 UI 回归 | 376/376 通过，12/12 布局与 4/4 窄卡自检通过，运行错误 0 | `verify-ui-summary.json`、`ui/verify.json` |
| 官方候选包静态校验 | errors 0，1 条既有 DYNAMIC_DEPENDENCIES_NOT_PROVEN warning | `validate-app.json`、`pack-final.log` |
| 官方隔离启动 smoke | **未完成**：缺独立 Electron runtime；没有把静态/Chrome 夹具当成启动通过 | `validate-smoke.json` |
| 语法、diff 空白、孪生页面 | 通过 | 本地 node --check / git diff --check，孪生比较 |

专项编号 BE-01–10 覆盖顺序保存、其他列表与未知字段、缺项/锚点拒绝、完整 URL 老数据、并发新列表/改名、陈旧快照不撤销排序与连续串行写。UI-01–22 覆盖浮起、压力呈现、移动中零写、松手一次提交、重启恢复、当前音频连续、失败恢复、取消、变宽标签、右键保留、边缘滚动、真实触摸与正常滑动、底栏位置、宿主外链调用、三态尺寸、减少动态效果、键盘焦点与深色截图。

候选包：`/tmp/hap-reorder-package/app-hanako-simple-player-1.1.3.zip`，相同目录含 entry.json。由既有 pack-release 白名单构造完整运行时并检查相对 import；新 `lib/reorder.js` 已包含。包内无验证脚本、报告与用户 app-data。

## Hana 独立复跑与部署验收

1. 读取原始输出，独立执行 `node tools/verify-backend.mjs`、`OUT_DIR=/tmp/hana-reorder node tools/verify-reorder.mjs`；如需全矩阵执行 `OUT_DIR=/tmp/hana-reorder-ui node tools/verify-ui.mjs`。
2. 同步完整 `ui/`，同时同步 `lib/library.js`、`lib/lists.js`、`lib/register-routes.js`、**新 `lib/reorder.js`** 及 manifest/package（或完整运行时候选包）。随后 **extension_manager reload app:hanako-simple-player**，核对运行时 1.1.3 / 1003131685。不要只同步 HTML/JS 漏 CSS 或新后端依赖。
3. 真机核对长卡/窄卡/宽窗：长按浮起、邻项挤压与回弹、首尾换位、两轴边缘滚动、长按静止松手不弹菜单、右键管理仍可用，释放不误播/误切歌单；深浅主题与减少动态效果。
4. 播放一首真实歌曲时排序，确认出声和进度连续；当前 UID 不因排序改变。对一个非当前测试歌单拖动、reload 后顺序保留；本地重扫已有文件顺序保留，recent 始终时间排序。
5. 搜索推荐页与结果页点击 GitHub，**实际外部浏览器**打开正确仓库；无权限时明确提示打开失败。夹具 spy 只证明调用参数，不代表宿主真实跳转。
6. 独立结论写 `docs/player-ui/handoffs/REORDER-GITHUB-ACCEPT.md`，通过、未验与失败分列，附构建号和原始证据。UI 动效手感与宿主外链、实际 reload 均由真机证据判定。

运行时未动 `lib/audio-owner.js`、`lib/mood-command.js`、`ui/sdk.js`、requestPlay 与 captureStream 分析链。官方 smoke 的缺 Electron 限制保留；若已有开发 Electron，可按技能设置 HANA_APP_ELECTRON 后重跑候选包 smoke，不能拿 Hana 桌面可执行文件充当脚本运行器。

## 交接状态

2026-10-13 21:38（Asia/Shanghai）：已通过 Computer Use 提交到 HanaAgent 对应项目会话，消息出现在会话、输入区清空、对方进入处理状态。独立复跑、部署 reload 与真机结论以 `REORDER-GITHUB-ACCEPT.md` 的证据为准，开始处理不代表已通过。

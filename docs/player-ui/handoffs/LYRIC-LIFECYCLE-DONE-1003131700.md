# 歌词波浪与自动滚动生命周期修复 · 技术交接（1700 中间稿）

> 已由 [1003131701 最终交接](LYRIC-LIFECYCLE-DONE-1003131701.md) 接替：补了外层零尺寸不误判 compact 的保护，最终证据以 `final-1701/` 为准。本稿保留中间实现背景，不作为最终验收凭据。

2026-10-14。基于**已验收的 1003131699 工作树**，本地候选 **1003131700**，manifest 版本仍为 **1.1.5**。**仅实现与自验；未部署、未 reload、未封包、未发版、未提交、未改生产数据。**

## 0. 当前结论

实现已完成，最终专项正在执行，结果见后续补记。真机触发时序尚待在获准部署后独立验收，不能用无头测试宣称已经通过真机拖窗。

用户原始复现：长卡正常；拖出独立窗概率失效；媒体与语义高亮继续，波浪和自动滚动停止；切歌无效，重开插件恢复；wide 改 compact/long 立即恢复。

## 1. 基线保全与范围

- 工作树：`hana-simple`，HEAD `e8a97aca54dabcea33005cfe5bb4bf5cb4f1fedd`。开工已有未提交的 1699 性能基线，**没有 reset/clean/checkout 覆盖，也没有 commit/stash**。
- 开工状态、文件 SHA 与原有性能补丁已保存为 [baseline-worktree.json](lyric-lifecycle-20261014/baseline-worktree.json) 和 [baseline-worktree.patch](lyric-lifecycle-20261014/baseline-worktree.patch)。反向验证只读临时 UI 快照，未回退工作树。
- 保留宽窗歌单背后的连续歌词、SVG 外层播放指示动画、缓存滚动上限、亚像素残差、只写改变的色阶、最多十行临时合成提示。`ui/style.css` SHA 与 1699 **完全一致**。
- 本轮新增修改：`ui/app.js`、`tools/verify-ui.mjs`、三处本地构建号，以及文档。manifest、SDK、后端、权限与音源路由均未改动。
- [source-checks.json](lyric-lifecycle-20261014/source-checks.json) 冻结源码 SHA、HTML 孪生与构建号；安装目录五个 UI 文件仍等于已验收 1699 的 SHA，证明这轮没有将候选写进生产安装。
- [candidate-app.diff](lyric-lifecycle-20261014/candidate-app.diff) 是 **1699→1700 的 app.js 增量**。[candidate-working-tree.diff](lyric-lifecycle-20261014/candidate-working-tree.diff) 是相对 HEAD 的源码/测试工作树补丁，**包含原有性能基线**，勿混淆两种用途。

## 2. 根因证据与边界

已通过原代码反向验证确认三类恢复缺口：

1. **失效的非零 rAF 句柄**。浏览器撤销待执行回调后，`lyricFlowRaf` 仍非零，`startLyricFrames()` 直接早退。媒体事件继续调用语义高亮和低频绘制，逐帧循环无法重启。布局变化的同步入口会清掉句柄，解释“改比例立即恢复”这一救援路径。
2. **零预算后的测量缺口**。歌词加载/恢复时尺寸为零，`sizeLyricPad()` 直接返回；如果正尺寸到来时没收到 RO，`g.height/centers` 没有重建，`canFlowLyrics()` 始终无法启动。切歌仍在相同无效预算下加载，也无法解决。
3. **迟到的离屏状态**。`lyricInView=false` 是持久启动闸门。原实现依靠 IO 更新它；缺通知时，播放/换曲不会主动重验可见区域。

上述为**源码与可控故障注入确认的机制**。生产 Hana 到底触发了哪一种或哪种组合，目前没有故障瞬间的内部读数，不作唯一根因断言。特别是：宿主若真实持续提供零尺寸或只提供 `hana.lifecycle.visible=false`，App 无权自行编造可用尺寸/可见性；需采宿主证据继续定位。

## 3. 实现说明

### 帧循环与启动条件

- 记录帧申请/执行时间；非零句柄超过 **250ms** 未推进时取消并重启。兜底由已有 `timeupdate`/`playing` 提供，不增加常驻 timer。250ms 是失帧判断窗口，实际自愈延迟还取决于下一个媒体事件；测试允许 600ms 恢复等待。
- 每帧先清当前句柄再更新，下一帧只登记一次。`epoch + handle` 校验拒绝迟到的旧回调，防止双循环。
- `cancelLyricFrame()` 与 `stopLyricFrames()` 分离：重测只取消帧，不摘合成提示；真正暂停/离屏/浏览/零预算时才摘层。`sizeLyricPad()` 正常重测不反复 stop/start。
- `canFlowLyrics()` 增加完整几何条件：测量已完成、宽高为正、中心数量等于节点数量。仍保留播放状态、句间移动、跟随、校准、搜索/窄卡队列、减少动态、截图与可见性闸门；宽窗抽屉仍不阻止歌词。

### 恢复与几何

- `pageshow`、可见性变化、window resize、公开 `hana.lifecycle` 与 `hana.envelope` 信号触发重测与启动；恢复信号早于布局提交时，下一帧再测一次。
- 先重测歌词上缘，再判断实际阅读区，避免零阅读区把上缘修正也挡住。
- 零尺寸使旧几何失效并留下 `needsMeasure`；恢复正尺寸时重建中心、斜率、滚动上限与亚像素残差。
- 媒体脉冲只在可见性/几何无效时读几何，稳定播放不增加逐帧布局读取。真实离屏只读边界，不重测整首歌词；暂停状态可补几何，但不会启动播放或动画。
- `pagehide` 清帧、重测帧与 SDK 订阅；`pageshow` 幂等重绑。宿主 `visible=false` 按公开绘制权威处理，不能被 iframe 内矩形或比例变化越权打开。
- 调试读数新增 `measuredWidth/maxScroll/needsMeasure/inView/surfaceVisible/canFlow/frameAge/frameRecoveries`，用于下一轮真机定分支。

## 4. 回归覆盖与复跑

`tools/verify-ui.mjs --lyric-lifecycle-only` 新增 **31 条**，完整 UI 与 `--lyrics-only` 也包含它。旧断言没有放松。

- L01–L12：两轮 `index.html(long) → standalone.html(wide) → index.html(long)`，每轮验证初始恢复、丢帧自愈、媒体和高亮继续、wide→compact/long 的比例恢复、返回 wide 和 reattach 后继续流动。
- L13–L17：迟到 IO false、连续 resize 不重加合成提示、pageshow 无新 play 事件恢复、旧回调不创建双循环、切歌不继承死句柄。
- L18–L21：真实打包 SDK 接收 `visible:false→true` 与 envelope；隐藏且本地矩形正常时仍停，隐藏期间 resize 不越权恢复，envelope 即时清死句柄。
- L22–L26：首次零测量、正预算无 RO 的自愈、真实 frame `display:none` 后无 RO/IO 通知恢复、暂停中归零后恢复播放。
- L27–L31：真离屏/回屏、暂停不被恢复信号自动播放、pagehide cleanup、重复 pageshow。

测试跑在本机系统 Chrome、真实文档导航与媒体时钟、假后端。失帧/漏 observer/零测量是测试文档故障注入。**没有操作生产 Hana 窗口，也没有做 Electron 原生拖窗。**每帧采样只读行内缩放、scrollTop 和内容层残差，连续性判据同时检查波浪与滚动变化比例。

```sh
OUT_DIR=/tmp/hana-lyric-lifecycle node tools/verify-ui.mjs --lyric-lifecycle-only
OUT_DIR=/tmp/hana-lyric-lyrics node tools/verify-ui.mjs --lyrics-only
OUT_DIR=/tmp/hana-lyric-perf node tools/verify-ui.mjs --lyric-perf-only
node tools/verify-backend.mjs
# 可选：完整 UI
OUT_DIR=/tmp/hana-lyric-full node tools/verify-ui.mjs
```

## 5. 最终验证结果

最终执行中，待填实际结果。原始产物集中在 [lyric-lifecycle-20261014/](lyric-lifecycle-20261014/)。早期 `baseline/`、`candidate/`、`*-v2` 是历史轮次，最终应以 `baseline-final/`、`lyrics/`、`perf/` 为准。早期短采样包含新文档媒体输出启动停留，最终在 seek 后等待 300ms 排除该干扰，没有降低连续性门槛。

## 6. 后续独立验收，不在本轮执行

部署需另获授权。生产仍是 1003131699；候选 1003131700 不应在未获准时同步或 reload。

获准后真实宿主至少两轮：长卡播放→拖出宽窗，不碰比例等 10–15s；采样波浪、滚动、媒体和高亮；wide→compact→long→wide，再拖回长卡并重复。补暂停→改比例→恢复、切会话再切回、换曲和慢歌长句。

故障时采 `__playerDebug.lyricFlowState()` 以及 `#lyricWrap.clientHeight`：

- `raf=true`、`frameAge` 持续增长而位置只在媒体事件时变化：死句柄/受限帧调度；`frameRecoveries` 增长说明媒体兜底触发。
- `height=0` 或 `needsMeasure=true`：预算/几何路径；若真实预算持续零，查宿主挂载与布局。
- `surfaceVisible=false`、文档前台后仍 false：核对公开 lifecycle 是否有 false→true 闭环，不在 App 内伪造 true。
- `follow=false`：沿原有 3s 浏览回位/指针自愈路径；校准、减少动态、间奏/末句停帧均是正常行为。

独立审核见 [LYRIC-LIFECYCLE-REVIEW.md](LYRIC-LIFECYCLE-REVIEW.md)。官方 Electron isolated smoke 仍受既有独立 runtime 缺失限制，本轮不安装依赖或冒用生产宿主来绕过。

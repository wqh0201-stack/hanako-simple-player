# 搜索返回封面与统一抽屉动效

2026-10-12，构建号 **1003131666**。

用户确认：只给新封面加生长动画；搜索页保持左侧滑入，播放列表保持右侧滑入。
三者的呼出、收回统一 320ms，缓动 `cubic-bezier(0.22, 0.61, 0.36, 1)`。

## 最终行为

- 宽窗底栏依次为搜索图标、当前歌曲封面、歌名/歌手、红心。
- 搜索打开时出现 32×32px、6px 圆角的封面；横图/竖图使用 `object-fit: cover` 与居中裁切。
- 封面按钮的命中盒为 44×44px，点击直接关闭搜索页，详情层也直接返回播放。
- 无封面或图片解码失败时显示唱片线描占位；搜索里切歌同步更新。
- 外层占位宽度与留白展开，内层缩放/淡入；歌名平滑让位，中央播放键不移动。
- 收回时封面、占位、搜索页共享时间零点与时长，完成后一起收尾。封面立即禁用并从键盘导航移除。
- 窄卡/长卡不增加底栏封面入口。减少动态偏好下只淡入淡出，截图模式即时完成状态切换。

## 实现

`ui/index.html`、`ui/standalone.html` 添加 `searchCoverSlot` / `searchCoverBtn` / `searchCoverImg`。
现有孪生差异 `body[data-shell]` 保持。

`ui/style.css` 的 `.player` 定义 `--surface-motion-ms`、`--surface-motion-ease`；
封面外层管理占位，内层管理图像与缩放。移除旧搜索/队列关键帧，状态类只负责退场期间保留挂载。

`ui/app.js` 的 `surfaceFrame()` 先读取当前可见值，`animateSurfaces()` 再取消旧动画、从当前帧续接。
同组 WAAPI 动画共享 `document.timeline.currentTime`，用 `Animation.finished` 收尾，没有独立卸载计时器。
旧组取消后不得卸载重新打开的面板；跨布局切换时释放旧组中未被复用的场景动画，防止舞台留下透明层。
队列遮罩与矮卡的播放/队列交叉也使用同一套时钟。

封面同步挂在 `setCtlTrack()`，复用 `coverSrc()` 与 `withSession()`，无需新增后端或权限。

## 验证

全量：`node tools/verify-ui.mjs`，**326/326**，布局 **12/12**、窄卡 **4/4**，零运行时错误。
新增的跨布局取消检查在后续专项运行中验证。

专项：`node tools/verify-ui.mjs --surface-motion-only`，**17/17**，零运行时错误。
包括中间帧、共享时钟、反向连续点击、同步结束、换歌与横图裁切、缺图/坏图、720px 宽窗、
减少动态、卡片隐藏、跨布局释放旧动画，以及真实退场期间保持主题底栏。

官方静态校验通过（仓库目录名与 manifest.id 不同，因此复制到正确命名的临时包目录再校验）。
深浅控制条截图：`/tmp/hap-verify/search-cover-light.png`、`/tmp/hap-verify/search-cover-dark.png`。

## 部署

整包 `ui/` 已同步到安装目录，逐文件哈希一致，构建号 **1003131666**。
按用户要求，Codex 不操作 Hana；由用户或 Hana Agent 执行：

```text
extension_manager reload app:hanako-simple-player
```

重载后核对 UI 快照构建号 **1003131666**，在独立窗口测试搜索封面进退、点击返回与队列侧滑。
源码与安装目录同步不代表宿主快照已经刷新；本次重载需要交接完成。

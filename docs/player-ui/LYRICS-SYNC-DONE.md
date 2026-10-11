# 歌词节奏手动对齐 · 实现交接

2026-10-11。基于 `hana-simple` 的 `1d5f1d0`，构建号 **1003131640**。
本轮源码与验收已完成；**安装目录未同步、App 未重载**，部署由 Hana 接手。
发版目标为 1.0.0，版本号、Release 与市场登记仍由统筹线收口；本轮未改版本号、未 push。

## 使用方式

桌面鼠标在歌词区停住并按下约 450ms，进入对齐。上推让歌词提前，下拉让歌词延后。
音乐在拖动期间继续播放，歌词按当前媒体时钟连续移动；一次拖动冻结换算尺度，停手或松手不会把偏移重新绑定到松手时间。

**松手保留对齐态**，可以试听后面的句子，再点「提前／延后」以 50ms 精修。
「还原」将手动偏移设为零；点「完成」才写入歌单，保存成功后退出。
Esc 丢弃本轮草稿。指针取消、失去捕获或窗口失焦撤回当前这次拖动；换曲、歌词重载、切页或打开队列／搜索时退出草稿。
单击歌词行跳到该句；滚轮仍是原来的歌词浏览，前 3 次浏览会短暂提示长按入口。

候选高亮表示最靠近「现在」刻度的歌词行，帮助用户定位。要确认开口时刻仍需试听后续句子，并用 50ms 按钮微调。
本轮只处理全曲常量偏移，不处理变速、删段或逐句时间轴错误，也没有新增触屏对齐手势。

## 与 BRIEF 推荐方案的调整

- 松手从「立即写盘」改为「留在预览中」，用户可以先听再完成；草稿不提前改 `raw`。
- 误触由长按 450ms 和按下后位移 6px 门槛控制，不用 80ms 提交死区，否则会吞掉合法的 50ms 精修。
- 行中心与时间戳插值提供连续预览；拖动采用附近有效行距／时距的中位换算，单次拖动冻结尺度。时间间距不均匀时不保证严格像素 1:1。
- 「现在」采用歌词左侧短刻度，工具落在底部，不画穿文字的横线。「还原」用明确按钮代替长按读数。
- LRC 自带 offset 与用户偏移分别保存、相加；解析不改变当前词源状态，也不把源 offset 复制进用户设置，防止重复相加。

上述均为交互／实现建议的优化，保留原有存储与宿主纪律。

## 数据与接线

`raw.lyricOffset` 为整数毫秒，正值代表提前，缺省零，限制在 ±600000ms。
复用 `savePlaylist()` 与 `toStoredTrack()` 的 raw 透传，不新增持久化通道，不改歌词文件。
同一音频稳定 id 在喜欢、最近播放、导入歌单里的副本同步更新；新导入副本继承已有歌词设置。
`bindLyricMatch()` 重绑时同步歌词匹配并清除所有同音频副本的手动偏移。

统一歌词时钟为 `mediaTime + (lyricBaseOffset + manualOffset) / 1000`。
`parseLrcDocument()` 纯解析 LRC offset；词源代次校验通过后才应用，候选解析不会污染正在显示的词源。
点句跳转使用上述时钟的逆变换。保存失败会回滚 raw 并保留编辑草稿供重试。
对齐期间阻止 3s 浏览自动回归；播放时用 rAF 连续预览，暂停停止调度，隐藏页面退出草稿。

## 文件与 DOM

- `ui/app.js`：歌词时钟、桌面手势、草稿／保存、源 offset、跨歌单副本同步，以及调试验收入口。
- `ui/style.css`：仅新增临时刻度、读数、操作条、候选态和 reduced-motion 样式；既有 `.lyric-ask-btn` 未修改。
- `ui/index.html`、`ui/standalone.html`：同步增加临时工具 DOM 和构建号，保留所有既有 id／data 钩子。
- `ui/_build.json`：已通过 `node tools/bump-build.mjs` 更新。
- `tools/verify-ui.mjs`：歌词校准夹具与 18 条新断言。
- 原始 `LYRICS-SYNC-BRIEF.md` 一并入库。

新增 id：`lyricAlignGuide`、`lyricAlignTools`、`lyricAlignValue`、`lyricAlignEarlier`、`lyricAlignLater`、`lyricAlignReset`、`lyricAlignDone`、`lyricAlignHint`。
当前两个 HTML 壳原本仅有 `body data-shell="card"／"window"` 差异；本轮保持这一差异，归一化后逐字一致。
未改 `lib/`、PV 生成块、manifest、package 或 app-data。

## 验收结果

- `node tools/verify-ui.mjs`：**152/152**，原有 134 条保留；布局 **12/12**，窄卡 **4/4**，运行时错误 **0**。
- `node tools/verify-backend.mjs`：**19/19**。
- `node --check ui/app.js`、`node --check tools/verify-ui.mjs`、`git diff --check`：通过。
- 实际鼠标长按／拖动、真实媒体时钟跨句超过 3s、松手偏移不漂、50ms 草稿保存、跨文档恢复、源 offset 只叠加一次、点句逆变换、取消／还原／重绑清偏移均已自动验收。
- 对齐截图已目视检查，深浅工具条可读，312px 窄卡四个操作保持一行且可命中。

截图：

- `/tmp/hap-verify/lyric-align-light-1040x780.png`
- `/tmp/hap-verify/lyric-align-dark-1040x780.png`
- `/tmp/hap-verify/lyric-align-dark-312x494.png`

## Hana 部署接力

先按串行工作树约定核对分支、提交和状态，读本交接。
将源码 `ui/` **整包**同步到 `~/.hanako/apps/hanako-simple-player/ui/`，本轮没有 lib 改动。
本轮已经 bump，不要为同一次部署再次 bump。不要改 app-data、版本号或 push。
随后执行 `extension_manager reload app:hanako-simple-player`，确认重载成功且实际加载构建 **1003131640**。

真机在会话卡片和独立窗口试听：拖动时跨句、停手和松手均应保持偏移，松手后可以试听／微调再完成；切歌回来、拆窗贴回保留已保存调整；Esc 不保存；重绑歌词清旧偏移。
自动验收使用真实媒体时钟与静音 WAV 夹具，真实歌曲的听感仍由这一步确认。

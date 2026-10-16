# 待办与待验收

当前尚未完成、或需真机确认的事项。做完就删；不确定的写明卡在哪。

## 待真机验收

- **歌词迁窗恢复**（本地候选 1003131701，未部署）：新增生命周期 31/31、歌词专项 118/118、性能专项 12/12；保留已验收 1699 的在途性能基线。待获准部署后原生 Hana 至少两轮 detach/reattach、wide→compact/long→wide、暂停恢复与可见性闭环，不能把本机无头结果当作真机验收。见 [最终交接](player-ui/handoffs/LYRIC-LIFECYCLE-DONE-1003131701.md)。
  下列历史条目保留；1699 的当前验收状态以 `PLAYLIST-PERF-ACCEPT-1003131699.md` 为准。

- **歌单展开与慢歌长句流畅度**（build 1003131699）：全量 UI 394/394、歌词专项 85/85、
  指定歌曲本地 LRC 亚像素检查 12/12；待 Hana 整包同步、reload 后复验独立窗与长卡，
  尤其《決意の唄》21–25s 的两行长句。官方 UI smoke 缺独立 Electron runtime，不能算通过。
  见 [性能交接](player-ui/handoffs/PLAYLIST-PERF-DONE.md)。
- **歌词跟随自愈 + 跳句动画**（1.1.5，build 1003131698）：合成指针复现与无头回归已过（含反向验证），
  但「在卡片外松手」在真宿主的真实手感需重开卡片确认。见 [交接](player-ui/handoffs/LYRIC-FOLLOW-FIX.md)。
- **本地文件夹选择**：需真机点一次确认（`<input type=file webkitdirectory>` 在宿主 webview 的行为）。
- **环境色纱**：厚度 / 深底字色 / 封面右缘淡出宽度需真机看一眼（见
  `docs/player-ui/handoffs/REFINE-DONE-AMBIENT.md` §五）。
- **涟漪本体迁移**：build 1003131690 已接入获认可的演示与三组门槛/浓淡；花一匁生产页面实测通过，待 Hana 独立重载验收。见 [交接](player-ui/handoffs/RIPPLE-PRODUCTION-DONE.md)。
- **验证稳定性**：全量 `verify-ui` 仅本机复跑过一次 367/367；
  另一环境曾报 337/367（30 项音频·沉浸动效失败）未复现，**未做稳定性确认**。
  2026-10-14 歌词跟随修复时本机再跑一次 **384/384**（含新增 3 条），仍只算一次样本。

## 已知边界（不改行为，只记录）

- **QQ / 酷狗「搜得到播不了」**：公共节点无直链，要救需用户配自己的 cookie。
- **B站曲目无 LRC 歌词源**：退回无歌词态（画面走封面 + 涟漪）。
- **宿主自己出声时的「正在播放」面板归属**：音频焦点之争，无法从 App 侧解决。
- **独立窗 / 小卡切换时「一小段静默」**：换文档重连媒体的固有代价，原理上除不掉。

## 前端评审遗留（`docs/player-ui/FRONTEND-TODO-2026-10-12.md`）

（每轮技术交接稿在 `docs/player-ui/handoffs/`，索引见 [`docs/player-ui/README.md`](player-ui/README.md)。）

来源 `/impeccable critique`（2026-10-12），用户已取舍。**实施前先读原文件**（含证据与文案方向）。

- [ ] **文字对比度**：时长、歌单标签等关键文字在浅深主题 / 有封面背景下可读；
      **不覆盖宿主变量**。复评证据见原文件。
- [x] **涟漪调节文案**：三组“触发门槛＋颜色浓淡”已明确左更多/右更少、左浅/右深。
      2026-10-14 用户明确要求替换功能，覆盖原“六根滑杆参数都不动”的旧范围；真实宿主验收仍见上方待验项。
- [x] ~~首次使用欢迎歌~~ —— 已在 1.0.5 落地，见 `docs/player-ui/handoffs/WELCOME-SONG.md`。
- [ ] **动态提示读屏播报**：让 VoiceOver 获知「已加入我的喜欢」「播放失败」等；
      用常驻播报节点 + 礼貌播报，属性存在不能替代真实读屏验收。排在前两项之后。

**本轮不排期**（原评审，用户认为不必要或暂不做）：首次提示焦点、点击区扩张、
红心配色语义重做、两处字号调整、删无封面斜纹、页面快捷键。

## 文档待办

- [x] ~~**README 引言与市场详情页介绍尚未追平**（2026-10-13）~~ —— 已在 1.1.7 发版顺带抹平：
  仓库 README 补横条（第四形态）与真机截图、包内 `README.md` 随包更新、
  `approvals.json` 的 `readme` 快照一并追平。见 [RELEASE-1.1.7.md](player-ui/handoffs/RELEASE-1.1.7.md)。
- `docs/BASELINE.md` 停在 build 1003131534。**保留在原位**：`docs/player-ui/REFACTOR-BRIEF.md`
  仍引它作为「开工前先读」。构建号已远旧，读时知道它只是重构起点基线即可。
- `.backups/` 已清空移除（原 20+ 个本地回退 tgz，已 gitignore）；`.gitignore` 仍保留该规则以备再用。
- 早期产物已归档：开工前简报 → `docs/player-ui/archive/`；淘汰原型 → `docs/player-ui/archive/prototype/`；
  重构前设计稿/提示词 → `docs/archive/design-proposals/`。
- 死目录 `themes/` 已删（原 default/spectrum/waveform 主题，重构后零引用）。

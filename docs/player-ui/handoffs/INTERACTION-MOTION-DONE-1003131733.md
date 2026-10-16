# 横条交互与四态动效修复 · Codex 交接

日期：2026-10-16。版本仍为 **1.1.7**，最终构建 **1003131733**。

用户要求修复代码审查指出的交互问题，并澄清「横条切回大卡片时闪烁的是背景」。本轮由 Codex 修改、自验，用户转交 Hana 部署；**没有联系 Hana、没有同步生产安装目录、没有 reload、没有对外发版**。真实宿主观感仍待部署后验收。

## 改动与行为

| 范围 | 实现 |
|---|---|
| 横条移入与首击 | 移除过渡期间忽略 pointermove 的分支；补 pointerenter；交互即刻生效。进度命中区收在条内下沿 **16px**，中间按钮/歌词区域不再命中透明 range。 |
| 连续操作 | 移出延迟 **160ms** 收起；普通按钮和滑杆按住期间都保持交互态，释放/取消/失焦正常清账；只有被拖动的那个 range 暂停媒体时钟回写。音量按钮与浮层之间补连续悬停区域。 |
| 四态播放意图 | 按钮根据用户意图立即显示播放/暂停；异步起播未完成时，第二次点击可取消。所有权操作串行，已有 stop 请求的回执不会取消下一次起播；媒体键、继续播放、换曲自动起播也接入。实际 state.playing、所有权 generation 和音频实例仍由既有链路管理，不提前伪造播放成功。 |
| 按压反馈 | 四态均保持按钮命中盒尺寸，内部 SVG **45ms** 按下、**140ms** 回弹，按下有亮度反馈；与外层布局 FLIP 的 transform 分开。横条播放/暂停改为固定的双字形层，不再反复替换 innerHTML。 |
| 歌词 | 歌词/控件用 **100ms** 淡化切换，位置不再上下跳；换句用 **120ms** 短交叉淡化，旧句节点结束即移除且不进入辅助技术语义。 |
| 背景闪烁 | 取消放大的封面副本和整块舞台从 .35 起的独立动画。现在立即提交目标布局，**真实背景（封面、底色、遮罩）完整显示在下方，仅旧背景快照在 220ms 内淡出**。没有两层同时降低 alpha 后露出裸底的阶段，也没有末尾突然恢复真实封面的跳变。 |
| 反向与生命周期 | 快照冻结切换前的尺寸，避免 RO 已改视口后把旧横条挪到大卡中间；快速反向保留当前图层合成顺序，快照最多四层，结束清空。同一形态 resize 不重启时钟，逐帧不读布局；隐藏/卸载/reduced-motion 会收尾。快照 inert、aria-hidden，所有 ID 去重。 |

主要文件：`ui/app.js`、`ui/style.css`、孪生 `ui/index.html` / `ui/standalone.html`、`ui/_build.json`。

验证入口：新增 `tools/verify-player-interaction.mjs`，通过既有 `tools/verify-ui.mjs --interaction-only` 显式运行；不会自动增加普通回归负担。`tools/verify-touchbar.mjs` 的旧按压断言同步为「图标变形、按钮尺寸不变」，并按新的收起宽限等待；没有降低可见反馈或功能要求。

## 自验与原始证据

只运行受影响的交互/播放专项，**未跑全量 UI 或后端回归**。本轮涉及播放起停时序，因此按 AGENTS.md §8 的例外补这一组专项。

```sh
OUT_DIR=docs/player-ui/handoffs/touchbar/interaction-2026-10-16 \
  node tools/verify-ui.mjs --interaction-only
```

最终结果：**25/25，failed=[]，runtimeErrors=[]，exit 0**。包含：

- wide / long / compact / strip 四态：延迟所有权请求下，连续两次取消、连续三次播放；图标按压可见且命中盒不缩，共 12 项。
- stop 已发出后的再次起播、过渡中移入与首击不误 seek、312/416/640 三档按钮命中。
- 背景真实封面及底层全程保持 opacity=1、快速反向收尾且音频实例不变。
- 歌词短交叉淡化、下沿 seek、reduced-motion、加载无运行时报错。
- 双文档：恢复不抢活跃 owner，显式接管先暂停旧文档。

原始结果都在共享仓库本地目录（该目录沿用 touchbar 证据的 gitignore 规则）：

- `docs/player-ui/handoffs/touchbar/interaction-2026-10-16/interaction.txt`
- 同目录 `verify-player-interaction.json`：逐项断言与播放状态/背景采样。
- 同目录 `basic-checks.json`：构建号、孪生一致性及五个 UI 文件 SHA-256。
- 同目录 `pressed-{wide,long,compact,strip}.png`、`background-{0,5,10}.png`：已人工查看的按压与过渡样本。

基础检查：三处构建号一致（1003131733）、孪生 HTML 仅 data-shell 不同；三个 JS 文件 `node --check` 通过，`git diff --check` 通过。

首轮专项曾有一项尺寸切换测试读到 RO 重排前的旧按钮位置；测试改为等待两次 rAF 后测最终命中盒，未改动命中断言。中间帧检查发现放大封面副本依然有矩形贴片感，最终实现已移除该方案，以上最终构建以整层交接为准。

## Hana 部署与真实验收

1. 先读仓库 AGENTS.md 与本交接；确认仓库 build 为 **1003131733**。本轮无 manifest 扩权、无需重新审批。
2. 将仓库 **整个 ui/** 同步到已安装的 `~/.hanako/apps/hanako-simple-player/ui/`，包含 style.css、app.js、两份 HTML、_build.json 及其余资源；若宿主安装来源已直接指向本仓库，则沿用该来源。
3. `extension_manager reload app:hanako-simple-player`，刷新宿主 UI 快照；核对实际加载构建与安装字节。光拷文件不会生效。
4. 做基础检查和实际操作体验，不跑发版前全量套件、不发布 Release/市场 PR、不修改 app-data。
5. 在真实聊天卡和独立窗体验：应用激活后的快速移入与连续点击、四态播放/暂停及快速上一首/下一首、喜欢/模式/音量；横条底部进度拖动；歌词换句与控件淡化；大小卡双向变换和快速反向时的背景观感。
6. 真机问题请写 `docs/player-ui/handoffs/INTERACTION-MOTION-ACCEPT-1003131733.md`，带构建、承载/形态、尺寸、主题、操作步骤与截图/录像，交用户转回 Codex。真实宿主事件/合成帧未在本轮直接测量，不能把本地夹具视为真机通过。

「从未激活的原生应用外移入但宿主未派发指针事件」的宿主边界本轮未改；重点验收用户明确指出的**应用激活后的**操作。

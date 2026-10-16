# 歌词同款星光 / 固定两行 / 整组撞色 · 1003131755

> **后续修正**：固定 13px 已作废，现为整曲统一 16–22px，见 [字号返修](STRIP-LYRIC-FONT-16-22-1003131756.md)。本篇星光/动线/整组色相策略仍有效；但「4.5:1」仅验证了旧单背景模型，真实横条截图已证伪可读性结论，见 [真实背景阻塞交接](LYRIC-CONTRAST-SURFACES-BLOCKER-1003131756.md)。后续已按罐头裁决实现[统一深色描边1758](LYRIC-UNIFORM-STROKE-1003131758.md)，竖卡保留用户授权3.0取舍；未部署。

2026-10-16，执行 DeepMind 正式任务及后续字号裁决。**本地完成、自验通过；没有部署或 reload，真实宿主视觉仍待统筹验收。** 1751 的「无辉光细圆点」已被用户否定，本轮以进度条同款为准。

## 结论

- `--strip-lyrics-only` **30/30**，`runtimeErrors: []`。
- `--interaction-only` **27/27**，`runtimeErrors: []`。
- 新录制快 / 常 / 慢三场，均为真实 `<audio>` → `updateLyricIndex()` 路径；每段 720×128、60fps、66 帧 / 1.1s。完整录制采样 805 帧，中位采样帧率 60fps。
- 字号按最终裁决固定 **13px**，两行居中，极端文本第二行省略；没有实现已作废的最长行字号解算、缩放或滚动。

## 本轮文件与范围

- `ui/app.js`
  - 新增 `lyricAccentFromStars` / `refreshLyricAccent`，接入封面取色、主题变化、取色失败和 pending 路径。
  - 星尘改用 `.strip-spark`，六档粒径直接从真实进度轨道读取；字形起点改成相对条的坐标，向已播放星区漂移。
  - Range 只采可见两行，跳过省略号覆盖区；到隐藏行立即停止扫描。
  - 修正收尾误取消下一句 lead 预约；保留原时长模型和各中断入口。
  - 增加只读配色/时长测试探针。
- `ui/style.css`
  - 歌词固定两行槽与同宽绝对定位旧句；移除旧句 `width:max-content`。
  - 细十字选择器与进度星共用；粒子直接复用现有核心 / 双层辉光 / 颜色 / 尺寸样式，停掉其无限运动，改用一次性 WAAPI。
  - 横条字色与竖卡 `--lyric-current` 共用实际 RGB；红心、焦点圈、控件强调色改回 `--hk-accent`。原控件辉光本来已是主题色，未改配方。
- `tools/verify-strip-lyrics.mjs`
  - 接手原会话已删除后无人维护的专项；适配旧 `.is-star` 等待和强度假设，保留原 20 项行为覆盖，新增 10 项检查。
  - 按真实帧时间生成 ffconcat，再重采样为 60fps，避免掉帧被编码成动作加速；从本轮完整录制裁出三个真实切句场景。
- `tools/verify-ui.mjs`：只新增 `strip-wrap` 多行夹具。
- `ui/_build.json`、`ui/index.html`、`ui/standalone.html`：`bump-build` 同步最终构建号 `1003131755`；HTML 除构建号外与本轮起点完全一致。
- 本交接、前端文档索引，以及知识库经验更新。

**未动** `lib/register-routes.js`、`#unavailablePop`、播放失败处理段、`manifest.json`、`tools/verify-player-interaction.mjs`、歌名/歌手字号、非 strip 歌词字号。工作树原有这些文件的在途 diff 保留，没有回退。下架处理段与本轮开始前快照逐字对照一致；孪生 HTML 归一化 `data-shell` 后一致。

## 星光配方与动线

不是另一套「相近的圆点」，而是直接复用 `.strip-spark`：

- 六档尺寸从原轨道读取：1.4 / 2.3 / 1.1 / 1.8 / 2.8 / 1.5px。
- 色源：`--spark-color: var(--strip-star-0..5)`。
- 核心：`color-mix(in srgb, var(--on-veil-paper) 72%, currentColor)`。
- 双层辉光：`0 0 4px 1px currentColor` + `0 0 10px 2px` 的 58% 同色。
- 峰值 alpha .65，每六颗一颗 1px 渐变细十字；无额外放大、烟花式 blur 或另配颜色。
- 普通 12 粒，窄档 6 粒；起点为可见字形 Range 中心。
- 目标方向指向已播放区域较靠左的星区，上下目标分布在条高 22% / 78%；单次实际行程普通 42–58px，窄档 26–42px，最多只走到目标，不越过它。**是朝星区渐淡，不强求从字迹高速飞完整根条到达进度前沿。**
- 首尾中心保留 13px 安全边，层本身按整根条裁切，覆盖同款最大 12px 辉光。轨迹不缩放，越远越淡；下一句只在原位淡入，`currentTransform === 'none'`。

时长公式本轮沿用上一版，不再次调参或写死测试毫秒：快 < 常 < 慢，按下一句窗口封顶，粒子时钟覆盖 lead + appear。另修一处实证时序问题：旧轮粒子结束原来调用 `clearStripLyricAnimation()`，会把已排好的下一句 lead 一并取消；现在仅正常完成时 `clearStripLyricMotion()`，seek / 暂停 / hover / 隐藏等真正中断仍清两者。新增检查验证后续快句 / 慢句在切句时旧字动画已运行一段；冷启动首句允许切句兜底，不强求每次都有 lead。

## 撞色算法与保底

1. 六区面积相同。以色相距离 <24° 的区数表示占位，按亮度加权破平局，得到主力代表。
2. 主力互补方向只是偏好；在全部有彩星光的色相圆空隙中做 maximin，最大化「离最近星光的色距」。至多六个色相，最大空隙至少 60°，中点理论最小色距 30°；测试留 RGB 舍入余量，要求 **≥25°**。
3. 用既有 `--veil-paper/ink` 及 alpha 混出保守薄纱背景，再复用 `solveByContrast`，目标 **4.5:1**；基础饱和度 .72。
4. 彩差或饱和度不足时，按主题强调色的互补偏好在安全空隙重选，以 .9 饱和度重解。无彩星光没有有效色相；无封面 / 失败 / pending 明确走主题互补档，不保留上一曲高亮。
5. 横条和竖卡共用 `--ambient-accent` / `--lyric-current` 的同一 RGB，不再用混白/混墨把实际字色洗灰。`--strip-lyric-glow` 仍从同一高亮源派生；所有常驻红心、焦点圈、控件强调与光保留主题 `--hk-accent`。

浏览器 96 组（六色 / 单色 / 灰色 / 无封面 × 深浅）最小色距 **29.71°**、最小对比 **4.636:1**、最小饱和度 **0.714**。实际夹具当前字色 `rgb(132,192,235)`，距最近星光 **171.11°**，薄纱对比 **6.114:1**。另独立扫描 104 组六等分色相得到 29.64° / 4.577:1 / 0.714。有限夹具不是对任意图片的穷举保证，真机多封面仍需复核。

## 固定字号与多行证据

- 全曲、全档固定 13px、line-height 1.2；两行槽 31.2px 垂直居中；不改字距、不滚动、不加高条。
- 主句与旧句都宽 100%、同一换行规则；副本 top:50% + translateY(-50%)，不再 max-content。当前句无 transform。
- 416px 夹具：短句高 15.594px、长句高 31.188px，均宽 138px / 字号 13px；旧句的 x/y/width/height 与退场前长句一致，粒子起点落在真实两行字形中心。
- 312px 极端夹具：实际 context 仅 34px，文字盒仍宽 34px / 高 31.188px；`line-clamp:2`、overflow hidden，第二行出现省略号，没有横向或纵向滚动。

## 断言变化与排错记录

原 20 项行为覆盖全部保留：自然转场、原位淡入、快慢相对时长、同刻分组、无重复层、seek 立即更新且不补播、暂停/hover/页面隐藏/切歌/退出 strip/reduce-motion 清理，以及窄档边界。

原视觉断言不再等待已删的 `.is-star` / `.is-glowing`，改为实际 `.strip-spark` 的可见峰值、真实伪元素、全粒双层辉光、窄档少于普通档。粒径与真实进度星逐粒严格比较；范围检查给 1/64 CSS px 舍入容差（Chromium 的 1.1px 实测是 1.09375px），不是放宽配方。

新增 10 项：

- `SL-dust-uses-progress-star-recipe`
- `SL-dust-travels-from-text-toward-star-field`
- `SL-cleanup-preserves-next-lines-pre-scheduled-lead`
- `SL-same-track-font-is-fixed-13px`
- `SL-highlight-separates-from-star-group`
- `SL-highlight-colored-readable-and-deterministic-fallback`
- `SL-hearts-retain-theme-accent`
- `SL-two-line-lyric-is-complete-fixed-size-and-contained`
- `SL-multiline-outgoing-and-range-origins-stay-aligned`
- `SL-extreme-line-clamps-at-two-without-scroll-or-font-change`

首轮 1753 为 27/29：粒径数值舍入导致一条假失败；另一条真实发现 `.strip-btn` 后置规则把横条红心覆盖成 muted，补专用 theme 色。1754 为 29/30：新预约断言过度要求冷启动首句必有 lead，调整成检查后续已预约句，不删除覆盖。1755 **30/30**。无头截图/录屏看了首轮三节奏与两行，再批量核对最终版本，不继续无边界视觉调参。

## 复跑命令与原始产物

```sh
OUT_DIR=/tmp/hap-star-family-1755 node tools/verify-ui.mjs --strip-lyrics-only
OUT_DIR=/tmp/hap-star-family-interaction-1755 node tools/verify-ui.mjs --interaction-only
```

- 歌词原始报告：`/tmp/hap-star-family-1755/verify-strip-lyrics.json`。
- 交互原始报告：`/tmp/hap-star-family-interaction-1755/verify-player-interaction.json`。
- 录制与关键帧：`/tmp/hap-star-family-1755/strip-lyrics/transitions.json`、`motion-frames/`。
- 完整录像：`/tmp/hap-star-family-1755/strip-lyrics/strip-lyric-rhythm.mp4`。
- 常速：`/tmp/hap-star-family-1755/strip-lyrics/normal-transition-60fps.mp4`。
- 快速：`/tmp/hap-star-family-1755/strip-lyrics/fast-transition-60fps.mp4`。
- 慢速：`/tmp/hap-star-family-1755/strip-lyrics/slow-transition-60fps.mp4`。
- 三节奏分镜：`three-rhythms-contact.png`（每两行一组，常 / 快 / 慢）。
- 多行截图：`two-line-outgoing.png`、`two-line-extreme-312.png`。

语法检查、`git diff --check`、构建号三处、孪生 HTML、下架处理段不变均通过。Impeccable detector 仅报 style.css:422 本来已有的 bounce-easing advisory，非本轮范围，未动。

## 未验证 / 风险与交接边界

- 未同步到安装目录、未 reload；真实 Hana 卡片 / 独立窗、Windows 字体与宿主主题切换的视觉手感由 DeepMind 独立复跑和部署验收。
- 测试是真实媒体时钟驱动，但音频是静音夹具；不把无头录屏当真实歌曲听感或真实会话验收。
- 未跑全量 UI / 后端回归（本轮按任务只跑两套专项）；播放失败提示和网络权限不在改动范围。
- 本轮不再使用 `session send` 建确认卡。结果在原任务链路回复给统筹；是否已被对方消费，以平台回执为准，不把准备好文档等同于对方已验收。

可复用原则已更新知识库 `20-资料/动效配色-在任意背景色上都不被吃掉.md` 第六节历史路标与第七节同款星光/整组撞色，并刷新图谱。

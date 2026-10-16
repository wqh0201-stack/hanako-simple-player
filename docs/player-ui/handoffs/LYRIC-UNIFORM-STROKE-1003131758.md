# 统一深色歌词描边 · 1003131758

2026-10-16，按DeepMind转达的罐头裁决实现。**本地自验完成，未部署、未reload；真实宿主视觉待统筹验收。** 原「单fill同时配全部背景4.5」的无解证明仍成立，本轮按新口径用实体描边提供分离度，未换字色。

## 实现与范围

`ui/style.css`：

- `--lyric-stroke: var(--veil-ink)`，本机解析为 `rgb(20,23,28)`；`--lyric-stroke-width:2px`。无主题/背景/进度条件分支。
- 横条当前句及`.strip-lyric-previous`、竖卡当前句/现有对齐候选，共用同一条`-webkit-text-stroke`规则；`paint-order:stroke fill`，fill盖回居中描边的内半边，外缘约1px。没有加粗字重或压缩填色字形。
- 原`--strip-lyric-glow`、`--lyric-glow`与反差阴影均原样保留。实体字形描边位于阴影/辉光之上，填色再位于描边之上；不用条件切边色，进度前沿经过同一句时不会换边色。
- `overflow:clip; overflow-clip-margin:2px; clip-path:inset(0 -2px)`：只扩横向绘制边界，纵向仍严格止于原两行盒。无padding、无宽度/行高/字号/字距变化。CSS用变量表达2px，未硬编码组件描边色。
- 为什么配合clip-path：clip-margin会四向扩展；初始8px参考图露出第三行，产生182个差异像素，**不是182个真实描边被裁掉**。现生产与参考都仅横向扩展，另查纵向边界与隐藏行，避免误判或泄漏。

`ui/app.js`完全未改（SHA256对照本轮基线），所以整曲16–22px/1px步进、两行省略、Range取位、星尘配方/动线、时长模型与播放失败处理均未改。控件强调色仍为`--hk-accent`。

另外改`tools/measure-lyric-surfaces.mjs`、`tools/verify-strip-lyrics.mjs`、本交接/索引及知识库。`bump-build`最终同步`ui/_build.json`与孪生HTML为**1003131758**；没有新增依赖、host或manifest权限。保护文件与其他执行者在途修改保留。

## 真实像素验收，不用声明色自证

同一真实DOM依次留四张PNG：正常rendered、去掉文字/描边/阴影的background、fill覆盖掩膜、stroke覆盖掩膜。

黑白掩膜只定位实际DOM绘制核心，**RGB来自未改色的rendered截图**。在最高覆盖组中取众数，并保留坐标、覆盖率、样本数；不是把computed声明色或Canvas重画字体当作像素。声明色仅用于验证各表面规则一致，绝不参与对比度计算。这里采核心像素，不声称所有抗锯齿过渡像素都达到门槛。

背景仍逐CSS x扫描5个y：横条720×128，进度0/50/100%；竖卡465×930。切尺寸后等待目标layout、ghost收尾及字号缓存宽度与实际宽度一致，拒绝零尺寸样本。

- 横条：`max(fill/bg,stroke/bg)>=4.5`且`stroke/fill>=3`。
- **竖卡深底：按罐头2026-10-16明确授权，保留fill/bg>=3.0，不是4.5修复。** 测试名`SL-measured-contrast-vertical`的detail明确写用户取舍。源码注释也说明不因此宣称当前字号满足WCAG“大字”定义。
- 若竖卡出现较亮点（L>=.175，即黑字本可达4.5的分界），仍走4.5有效分离度，不一律放宽到3。

## 每个表面实测

下表为最终三轮最弱值；实际RGB三轮一致。描边源始终为`[20,23,28]`，屏幕核心像素受字形抗锯齿、现有辉光及缩放合成影响，不应伪装成声明值。

| 表面 | 实际fill RGB | 实际stroke RGB | fill/bg最低 | 有效对比最低 | stroke/fill |
|---|---|---|---:|---:|---:|
| 横条0%，未播 | `[132,192,235]` | `[38,51,62]` | 1.4748 | **9.7264** | 6.5952 |
| 横条50%，含交界 | `[132,192,235]` | `[38,51,62]` | 1.1180 | **7.3737** | 6.5952 |
| 横条100%，已播 | `[132,192,235]` | `[38,51,62]` | 1.0001 | **6.1106** | 6.5952 |
| 竖卡465×930 | `[131,192,235]` | `[45,61,74]` | **3.8093** | **3.8093** | 5.7001 |

第一轮已播有效值6.1500，第二轮6.1106，第三轮6.1500；表取三轮最弱。竖卡声明fill仍为`[132,192,235]`，实际核心模式的红通道差1，非换色。与星光组的最小色相距三轮均**171.1053°**，原>=25°断言保留。

**竖卡3.8093是用户已知取舍，未修到4.5。** 本次没有通过整体降门槛或改字色让它伪装达标。

反向用例：在同一真实组件中，以实际fill像素构造同色背景，先关闭描边再恢复同一生产规则。前后fill均`[132,192,235]`、fill/bg均1.0000；无描边时掩膜没有stroke，恢复后实测stroke`[49,67,83]`，有效分离度及stroke/fill均**5.2083**。断言只比较关系，不写死颜色，旧的单背景自证不能通过此例。

## 两行、旧句与取位

- 16px两行：138×38.375；22px两行：195.203125×52.78125；极端312px视口槽：34×38.375。与描边前规则/本轮几何基线一致，不减少可用宽度或改变换行。
- 与横向扩至8px的参考掩膜比较，三场`lost=0`；纵向边界触墨与两行外碎片均0。极端句仍两行+省略，无滚动、字号不变。
- 16/22px旧句与当前句computed描边颜色/宽度/paint-order相同；旧句x/y/宽/高对齐，Range粒子仍逐颗落在原字形中心，均为两行来源。
- 现有自然切句/遮罩/模糊/清理检查通过，ui/app.js无修改。留真实60fps旧句录屏供统筹看手感，不把静态通过等同最终视觉验收。

## 最终运行结果

```sh
OUT_DIR=/tmp/hap-stroke-1758-1 node tools/verify-ui.mjs --strip-lyrics-only
OUT_DIR=/tmp/hap-stroke-1758-2 node tools/verify-ui.mjs --strip-lyrics-only
OUT_DIR=/tmp/hap-stroke-1758-3 node tools/verify-ui.mjs --strip-lyrics-only
OUT_DIR=/tmp/hap-stroke-interaction node tools/verify-ui.mjs --interaction-only
```

三次**46/46、退出码0、runtimeErrors=[]**；交互**27/27、runtimeErrors=[]**。相同代码顺序连跑；没有把开发过程的失败算进正式三轮。

新增/重写重点：四表面真实像素、反向删除描边用例、统一描边及辉光保留、16/22px旧句同款、两档两行与极端省略的像素裁切。原跨组检查三次继续通过。

基础检查：测试脚本语法、git diff --check、构建号三处一致、孪生HTML一致通过。对照`/tmp/hap-stroke-baseline.json`，`ui/app.js`、`lib/register-routes.js`、manifest、交互测试未变。

## 原始输出与录屏

每轮：`/tmp/hap-stroke-1758-{1,2,3}/verify-strip-lyrics.json`与`strip-lyrics/measured-surfaces.json`；同名`.log`保存stdout。汇总`/tmp/hap-stroke-1758-three-runs.json`及`/tmp/hap-stroke-1758-summary.json`。

第一轮新录屏均在`/tmp/hap-stroke-1758-1/strip-lyrics/`：

- `strip-lyric-rhythm.mp4`：完整809帧，中位采样60fps；后二轮811/812帧，均60fps。
- `normal-transition-60fps.mp4`、`fast-transition-60fps.mp4`、`slow-transition-60fps.mp4`：三节奏裁片。
- `font-16-two-line-60fps.mp4`、`font-22-two-line-60fps.mp4`：各156帧，60fps，真实旧句淡出与同款星尘。

掩膜取样发生在对应录像停止后，录像不包含诊断黑白探针。六段首轮录像持久副本在`/Volumes/SSD/hanadesk/OH-媒体库/播放器验收/统一深描边-1003131758/`。

证据包`/Volumes/SSD/hanadesk/OH-媒体库/播放器验收/歌词统一深描边-1003131758-20261016.zip`包含三轮顶层PNG/录像、报告/原始像素、日志与本轮源码SHA256，不含批量原始帧目录。

## 未验项

- 未部署/未reload，未做Hana真实卡片或独立窗验收。
- Windows字体、其他字体的描边与clip边缘未测；当前仅本机Chrome/字体。
- 持续播放性能、多主题/多封面/多个动效相位未穷举；不能由这些核心像素推广为任意背景必定达标。
- 竖卡4.5未修：明确保留用户授权的3.0取舍。

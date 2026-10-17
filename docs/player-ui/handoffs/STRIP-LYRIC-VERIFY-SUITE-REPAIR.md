# 横条歌词验证套件迁移到 Canvas · 2026-10-17

本轮只修订验证与夹具，不改 `ui/app.js` / `ui/style.css` 的生产语义。基线：`hana-simple`，HEAD `cde7120`（横条双行拆分）。

## 修订前证据与过期断言

直接复跑旧版 `node tools/verify-ui.mjs --strip-lyrics-only`，在 `tools/verify-strip-lyrics.mjs:385` 等待 `.strip-lyric-dust > .strip-spark` 500ms 后抛 `TimeoutError`，验证器没有打印通过数/总数，后续检查没有执行。因此 `30/45` 不是这条命令的可信正式结果。上一轮报告的「临时副本中 15 条失败且改动前后失败集一致」可说明失败与双行拆分无关，但没有留下对应的 assertion JSON，不能把它伪装成逐条复现的失败报告。

源码中已确认的过期/失真口径（均改为当前行为的检查，而非删掉相关覆盖）：

- DOM 粒子：`star-points-are-visibly-lit`、`dust-uses-progress-star-recipe`、`dust-travels-from-text-toward-star-field`、`narrow-dust-is-limited-and-contained` 依赖 canvas 中不存在的 `.strip-spark` 子节点、CSS 动画及 `data-origin` 等属性。首次等待就是 `.strip-lyric-dust > .strip-spark`；它是异常阻塞点，不是一次普通断言失败。
- 旧句擦除：`natural-transition-has-local-mask-and-particles` 依赖已经删除的 mask / `is-dissolving` / 粒子 DOM；`incoming-is-immediate-in-place-fade`、`cleanup-preserves-next-lines-pre-scheduled-lead`、`fast-transition-is-shorter-than-normal`、`slow-transition-has-longer-bounded-dust-tail` 与 `same-timestamp-lines-use-one-group` 读取当前不再存在的旧句 WAAPI / canvas WAAPI 时长。
- 两行与清理：`multiline-outgoing-and-range-origins-stay-aligned`（16px、22px）从 `dust.children` 取粒子原点；canvas 没有这些子节点。`no-queued-transitions-or-duplicate-layers`、`seeked-path-does-not-create-particles` 及暂停/隐藏/hover/切歌状态的旧 `particles` 字段也使用 `canvas > span` 口径，可能因恒为0而假通过，不能证明真实画布的创建、发射或清空。
- 描边测量：`outgoing-inherits-identical-outline-*`、旧 stroke/contrast 检查假设实体 `-webkit-text-stroke`。当前在役实现是软阴影；保留真实像素门槛，改用现成的 `scoreSoftShadow()`，没有降低横条 `effective >= 4.5`、`shadow/fill >= 3` 门槛，也保留竖卡已确认的深底 fill>=3 口径。

## 本轮改动

- `tools/verify-strip-lyrics.mjs`：安装仅用于测试页的 canvas 像素统计和 `drawImage` 观察器。检查画布真实亮像素、白芯/颜色、x/y 分布、条内边界及从 Range 字形附近发射；按 `STRIP_DUST_STRENGTH=0.45` 的预算口径核对宽条 `round(320×0.45)=144`、窄条 `round(200×0.45)=90`，不再把空 DOM 当粒子数。
- 用 MutationObserver + rAF 记录覆盖层 opacity/filter：验证从不透明到 0 的单调淡化、实际 blur、按节奏时长到零；通过覆盖层/画布真实存续时间验证粒子尾迹清理。新句仍检查 opacity 入场动画及 `transform:none`，快/慢节奏与 `stripLyricTiming()` 的 dissolve / particle 时长和相邻歌词窗口绑定。
- 轮廓/对比检查迁移至 `scoreSoftShadow()` 读取的真实渲染像素，继续测三档横条、竖卡、同色背景反例及每种表面一致的阴影规则。
- `tools/verify-ui.mjs` 新增独立 `strip-bilingual` fixture，不改已有夹具歌词文本；新增横条真实渲染检查：日文原文 / 中文译文拆为 main/sub、括号不显示，且画布亮像素与早期 sprite 绘制在两行各有证据。
- `docs/PITFALLS.md` 更新当前验证口径；`docs/player-ui/README.md` 增加本交接索引。

## 验证结果

| 命令 | 结果 |
|---|---|
| `node --check tools/verify-strip-lyrics.mjs` | 通过 |
| `node --check tools/verify-ui.mjs` | 通过 |
| `git diff --check` | 通过 |
| `OUT_DIR=/tmp/hap-verify-strip-final2 node tools/verify-ui.mjs --strip-lyrics-only` | **47/47，failed=[]，runtimeErrors=0，退出码0** |
| `node tools/verify-strip-bilingual.mjs` | **16/16，runtimeErrors=0，退出码0** |

47 条专项录制 742 帧，中位采样 60fps；ffmpeg 输出正常节奏、快节奏、慢节奏三段剪辑均成功。关键观测：常规宽条亮芯组件17、预算144；312px窄条亮芯组件7、预算90且像素框在条内。opacity 实测：常速 dissolve 358ms、约352ms 到零；快速 317ms、约308ms 到零；慢速 536ms、约515ms 到零。canvas 尾迹存续约585ms（常速，particleMs=495）/1531ms（慢速，particleMs=1443），均落在实现的 `particleMs + 80ms` 清理窗口内。双语转场 main/sub 实际绘制点分别14 / 12，像素行带分别152 / 141。

没有最终失败断言；没有发现需要改生产代码的缺陷。按 `AGENTS.md §8`，此测试套件修订不跑全量 606 条。

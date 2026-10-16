# 横条歌词星尘 · 连续前沿返修 · build 1003131767

2026-10-16。接续 `1003131766`，按 DeepMind 复核报告
[LYRIC-STARDUST-AUDIT-1003131766](LYRIC-STARDUST-AUDIT-1003131766.md) 的四条目标返修。
**本地完成、基础检查与一次联合抽查通过；未部署、未 reload、未 commit。**

## 一、复核结论的采信与纠正

**采信**：审计第 1 条成立且是本轮主因。原 `stripLyricExitFrames()` 用 WAAPI 关键帧给 `maskImage`
三档渐变，Chrome **不连续插值渐变图像**（实测 101 个进度点只有 3 种状态），
于是遮罩在 ~28% / ~78% 处跳变，而粒子却按 sweep 连续出生 —— 两者不同步。
第 3 条的材质差距同样成立：旧实现是纯色实心圆 + 简单十字，没有白亮芯和径向柔光。

**纠正**（按证据）：
- 十字样本「后五字漏采」确非事实 —— 用生产函数复算 10 字每字 14 颗、共 140 颗。
  本轮仍保留了「整句均摊 + 超预算按步长抽样」，因为 `particles.length = budget` 顺序裁尾
  在极长可见文本下确实会砍掉后几个字。
- 上一轮「改成 `maskImage` 就修好了」的结论只对了一半：属性生效了，但动画仍是离散跳变。
  本轮不再让 WAAPI 承担遮罩推进。

## 二、关键实现

### 1. 遮罩与粒子共用同一条连续前沿（目标 1）

- 删除 `stripLyricExitFrames()`（WAAPI 关键帧方案整体移除），改由**转场 rAF** 逐帧写
  `outgoing.style.maskImage`。rAF 只在转场期间存在，结束/中断即 `cancelAnimationFrame`，**不新增常驻循环**。
- 前沿 `front = ease(elapsed / (dissolveMs × 0.78))`，遮罩 x 与粒子出生用的是同一个 `front`
  （`birth = 26 + easeInv(sweep) × dissolveMs × 0.78`），一一对应，不再各走各的。
- 掩膜几何按**真实可见字形边界**：`frontLeft01 / frontWidth01` 由 `stripLyricVisibleGlyphs()`
  的 `minX / width / textRect` 算出，多行与省略号覆盖区沿用同一套 Range 判定。

### 2. 星尘材质分层（目标 2）

- 新增 `stripLyricDustSprite(color)`：64px 精灵图，白亮芯（rgba(255,255,255,.98)）→ 彩色径向柔光渐出。
  **每色每强度只生成一次**，逐帧 `drawImage`，不每帧重画渐变。
- 三类粒子：`flare`（约 7%，短十字星芒 + 白芯）、`nebula`（约 13%，更大更柔的光团）、
  其余为细点；**全部叠一层白亮芯**，解决「没有白亮芯/径向柔光」的差距。
- 少量细尾迹：约 22% 粒子在 age>60ms 后沿速度反方向画一条 0.6px 短线。
- 运动量级回到参考的「几十 px/s」：`vx = (ox×34 + (rx−.5)×42) × (0.55 + 0.5×0.6)`（原为 ×0.5 的极小值）。
- 颜色：`--strip-star-0..5` 实际 computed 值 + 歌词当前色；**未照搬参考固定色，未用 fixed 全屏画布**。
- 位置仍夹在条内（四周各留 2px），不裁得贴边聚堆。

### 3. 结束态与预算（目标 3）

- `front >= 1` 时：`outgoing.style.opacity = '0'` 并清空 mask，**旧句明确隐藏**，星尘独立留尾至 `tail`。
- 新句仍由原歌词时钟 `finishStripLyricLead()` / `renderStripLyric()` 原位淡入，未改。
- 预算：`perGlyph = floor(budget / 可见字数)`，余数逐个补到前几个字；
  若极长句仍超预算，按 `stride` 均匀抽样，不再从数组尾部删。

### 4. 保留项（目标 4）

字号 16–22 整曲统一、两行省略规则、柔影、取色、暂停 / seek / 悬停控件 / 切歌 / 离屏 / 减动效清理，
以及播放链路、后端路由、下架弹窗、其他形态，**均未改动**。

## 三、基础检查

```
node --check ui/app.js                        通过
构建号三处一致                                  1003131767（index / standalone / _build.json）
孪生 HTML（归一化 data-shell）一致                通过
未碰 tools/  lib/register-routes.js  #unavailablePop  播放失败段
```

## 四、一次有界联合抽查

同一夹具（`__fixture/reset?mode=strip-rhythm`，真实 `<audio>` → `updateLyricIndex()` 路径）：

| 检查 | 结果 |
|---|---|
| 连续遮罩状态数（原来是 3） | **29 种**，前沿 35.5% → 64.66% 连续推进 |
| 首/中/末字释放 | 5 字句逐字命中 10159 / 12139 / 13307 / 10872 / 7164（末字也大量覆盖） |
| 结束后旧句隐藏 | `opacity==0` 18 帧；其中 13 帧星尘仍在飘 |
| 星尘独立于旧句 | 旧句节点移除后画布归零（0 帧残留） |
| 两行（416px `strip-wrap`） | 57121 采样，覆盖 x 125–270，正常 |
| 窄条（312×120） | 37553 采样，正常 |
| 中断清理（旧句副本 / 画布） | 暂停 0/0 · seek 0/0 · 悬停 0/0 · 减动效 0/0 |

## 五、预览

- MP4（170 帧 → 720p）：`/Volumes/SSD/hanadesk/OH-媒体库/播放器验收/歌词字形溶解-1003131767/lyric-stardust-1003131767.mp4`
- GIF：同目录 `lyric-stardust-1003131767.gif`
- 关键帧：同目录 `frame-dissolve.png`（左段化开、右段仍在）、`frame-dust-tail.png`（星尘留尾）

## 六、改动文件

- `ui/app.js`：歌词动效段 —— 移除 `stripLyricExitFrames`；新增 `stripLyricDustSprite`、
  `stripLyricEase` / `stripLyricEaseInv`、`STRIP_DUST_SWEEP_SPAN`；改写 `createStripLyricDust`、
  `paintStripLyricDust`、`startStripLyricDissolve`；`clearStripLyricMotion` 不再依赖 WAAPI 收尾。
- `ui/style.css`：`.strip-lyric-previous.is-dissolving` 注释更新（遮罩几何固定、由 rAF 写值）。
- `ui/index.html` / `ui/standalone.html` / `ui/_build.json`：`bump-build` → `1003131767`。

## 七、未验项

- **未部署、未 reload**；真实宿主观感（快/常/慢、两行、312px、深浅主题、seek、减少动效）待罐头实看。
- 未跑全量回归，也未跑仍卡在旧 DOM 星点上的旧歌词专项（`verify-strip-lyrics.mjs:385` 等 `.strip-lyric-dust > .strip-spark`，
  现在是 canvas 元素）——按本轮要求；该专项适配后由统筹决定是否复跑。
- 抽查在本机 Chrome 夹具完成，未穷举多封面/多主题组合；性能（每帧 sprite drawImage + 遮罩写字符串）
  未做长时压测，只确认 rAF 生命周期与中断清理正确。

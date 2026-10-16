# 横条歌词星尘 · 整句同时消散 · build 1003131768

2026-10-16。接 `1003131767`，按罐头新反馈改方向：
**去掉左→右擦除，整句同时消散；放慢约 30%；强度弱 10%（相对）**。
本地完成、基础检查与有界抽查通过；**未部署、未 reload、未 commit**。

## 关键实现

### 1. 取消空间前沿，全部可见字同时化成星尘
- **删除** `stripLyricMaskSupported()` 与 `.strip-lyric-previous.is-dissolving`（CSS 一并移除），
  `startStripLyricDissolve` 不再建 mask、不再算 `frontLeft01/frontWidth01/frontFeather01`。
- 旧句改由转场 rAF 逐帧写 `opacity = 1 − ease(elapsed/dissolveMs)` + 轻微 `filter: blur(0→0.8px)`，
  **整句一起淡化，不分区、不擦除**。
- 粒子出生 `birth = rand(i) × dissolveMs × STRIP_DUST_BIRTH_SPAN`，**不再依赖 x / sweep / 字符顺序**；
  删除 `stripLyricEaseInv`、`STRIP_DUST_SWEEP_SPAN`、粒子的 `sweep` 字段。
- 全句真实字迹同窗释放，白亮芯 / 彩色径向柔光 sprite / 少量尾迹 / 多行与省略号可见边界全部保留。

### 2. 放慢约 30%
- `stripLyricTransitionDuration` 基准整体乘 1.3：`dissolve=(200+pace·80)·1.3`、
  `appear=(150+pace·40)·1.3`、`tail=(300+pace·150)·1.3`。
- 实测：快速 pace0.4 → dissolve 302ms；常速 pace1.0 → **364ms**（旧 280）、particles **949ms**（旧 730）；
  慢速 pace3.0 → dissolve 572ms。**真实歌词时钟未动**，新句仍按原时钟出现；
  快歌仍用相邻句间隔封顶（`nextInterval×650/520/900`），不积压、不延误新句。

### 3. 强度弱 10%（相对）
- `STRIP_DUST_STRENGTH` 0.5 → **0.45**，单一旋钮同组缩放数量/位移/出生窗。
- 未在 glow / core / sprite 渐变 alpha 这些硬常数上再乘 0.9（避免连乘成 20%+ 的骤弱）。
- 风格、位移量级、取色未变。

## 有界抽查（同一 `strip-rhythm` 夹具、真实 `<audio>` → `updateLyricIndex`）

| 检查 | 结果 |
|---|---|
| 无空间扫描 | 旧句 `maskImage` 全程 `none`；遮罩变体 **1 种**（原 29 种渐变） |
| 各字同时起散 | 取旧句 4 个真实字形，首个粒子出现时间 **`[722,722,722,722] ms`，spread 0ms** |
| 整体淡化 | 旧句 `opacity` 连续 1→0，`filter` 0→blur(0.6px)，无分区 |
| 放慢落地 | 常速 dissolve 364 / particles 949（旧 280 / 730，×1.3） |
| 强度 0.45 | 源码单旋钮校验通过；预算 `round(320×0.45)=144`、`round(200×0.45)=90` |
| 两行 416px / 窄条 312px | 正常，遮罩无残留 |
| 中断清理 | 暂停 / seek / 悬停 / 减动效：旧句副本与画布全 **0/0** |

## 基础检查
`node --check ui/app.js` 通过；构建号三处 `1003131768` 一致；孪生 HTML 一致；
无悬空引用（`stripLyricEaseInv`/`SWEEP_SPAN`/`GAIN`/`is-dissolving` 已清）；
**未触碰** 字号 / 取色 / 柔影 / 播放链路 / 歌词同步 / 清理路径 / `tools/` / 后端 / 下架弹窗 / 其他形态。

## 预览
`/Volumes/SSD/hanadesk/OH-媒体库/播放器验收/歌词同时消散-1003131768/`
（`lyric-simultaneous-1003131768.mp4` / `.gif`）

## 改动文件
- `ui/app.js`：`stripLyricTransitionDuration`（×1.3）、`STRIP_DUST_STRENGTH=0.45`、
  `createStripLyricDust`（去 sweep）、`paintStripLyricDust`（去 mask 前沿 → 整句 opacity/blur + 同窗起散）、
  `startStripLyricDissolve`（去 mask 建层）；删 `stripLyricMaskSupported`、`stripLyricEaseInv`、`STRIP_DUST_SWEEP_SPAN`。
- `ui/style.css`：删 `.strip-lyric-previous.is-dissolving`。
- `ui/index.html` / `ui/standalone.html` / `ui/_build.json`：bump → `1003131768`。

## 未验
- 未部署 / reload；真实宿主观感待罐头实看。
- 未跑全量回归，也未跑仍卡旧 DOM 星点的旧歌词专项；性能只确认 rAF 生命周期与清理，未长时压测。

# 撤除诊断按钮 + 撤回 1824 追加字段 · 2026-10-22

> 小收尾，不部署、不提交。构建号 **1003131825**；正式安装仍以 1823 为基线。
> 用户结论：B站 那首歌本身相关乐器强度低，不再排查/修音频算法；撤回诊断按钮，参数保持用户自己调的样子。

## 改了什么

| 文件 | 改动 |
|---|---|
| `ui/index.html` / `ui/standalone.html` | 移除队列头部的 `#diagBtn`（3 行 × 2，孪生同步） |
| `ui/app.js` | 移除 `#diagBtn` 的专用点击处理与注释（14 行） |
| `ui/app.js` | 诊断注释块改为「内部/隐藏，不向用户暴露按钮」；入口改成独立窗 `onInspect` + 页面内既有 `__playerDebug.rippleAudio()` |
| `ui/app.js` | **定向撤回 1824 追加的诊断字段**：`resetCount/lastResetAt/lastResetReason/lastPk`、`resetAnalysis(now, reason)` 及其 5 处 reason 参数、`lastPk = pk`、`signalStats` 的 `mf/hf/bgMid/bgHigh`、`sampleSpectrum` 的 `bands`、`diagnostics()` 里的 `analyser/tune/raw/resets/warmupLeftMs` |
| `ui/_build.json` + 两个 html | 1824 → **1003131825** |

**保留**（23 既有、内部/隐藏、不向用户暴露）：`audioDiagnostics()`、`registerWindowInspection()`（独立窗 `onInspect`）、`initRipples().diagnostics()` 的 1823 字段（capture/streamTrack/spectrum/analysis/scheduler）、`__playerDebug.rippleAudio()` 等既有只读钩子。

## 与 1823 运行时基线的差异（逐文件核过）

基线：`/Volumes/SSD/hanadesk/OH-媒体库/小花音乐播放器/B站涟漪只读诊断-1003131823/hanako-simple-player`

```
index.html        5 行变化（按钮 3 行 + 构建号）
standalone.html   5 行变化（同上）
app.js           18 行变化（handler 14 行 + 注释 2 行 + 构建号无关）
style.css        identical
_build.json      构建号一行
```

除上述之外**没有别的差异**：1824 的追加字段已全部撤回，`git diff --check` 干净。

## 基础检查（只做了这些）

- `node --check ui/app.js`（用 Electron-as-node 跑）：通过。
- 构建号三处一致：`_build.json` / `index.html` / `standalone.html` = **1003131825**。
- 孪生 HTML：除 `data-shell` 外逐字一致。
- `diagBtn` / 「复制音频诊断」/「诊断生成失败」在 `ui/` 里零残留；`audioDiagnostics()` 只剩 `onInspect` 一处调用。
- 本地静态服务 + Chrome headless 加载一次：`#diagBtn` 不在 DOM，构建号 1825，console 无报错。
- 未跑旧专项、媒体矩阵、全量套件；未截图、未用 CDP。

## 没动的东西

真实 `playlist.json` / cache / cookies / LRC / `OH-Works` 一律没碰；用户这次的调参**没有**写进默认值，**没有**另存/导出/备份，也**没有**改 `player-ripple-tune` 的自动持久化逻辑。backend / SDK / CSS / manifest / 权限 / 依赖 / 媒体链路 / 触发算法 / 默认门槛与浓淡 / 播放音量均未改。未提交、未部署。

## 主会话复核 / 安装交付

- 独立逐字断言：相对不可变1823，app.js仅删按钮handler并更新两处入口注释；两份HTML仅删3行按钮及改构建。1824扩展无夹带，既有业务/参数/自动保存逻辑未变。
- 34文件整包（1,687,847字节）只有4个UI文件不同，其余运行时逐字节一致；新包语法/孪生/三处构建通过。官方静态校验0 error/1动态依赖未证明warning；不另装依赖或跑smoke/旧套。
- 原生安装已提交：`stg_dc7cf08b16aa7cc6`，最新`awaiting_confirmation`；包hash `5db9f2c0aceae7dca30751524eb450d521c1b665de1d206f7c47da74a445dfe2`。未代批准，确认前不宣称运行界面已生效。
- 不固化用户本次调参为默认、不另存参数备份；只撤按钮，其余不动。


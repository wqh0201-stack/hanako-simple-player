# B站音频涟漪 · 只读诊断接入 · 2026-10-22

> 本轮只加「可观测性」：**不改音频/动画行为**（媒体地址、代理、重试、捕获时序、门槛、增益、呼吸、静音检测一律未动），
> 不持久化、不推卡片 state、不新增权限/依赖/域名，不碰真实 playlist/cache/cookies/LRC/OH-Works。
> 构建号 **1003131824**（`ui/_build.json` + 两个 html 三处一致）；**未部署、未提交**。
> ⚠️ **2026-10-22 收尾：队列头部的「复制音频诊断」按钮与 1824 追加字段已撤除，构建推进到 1003131825。** 本文描述的按钮入口不再存在，字段集回到 1823；见 [`BILI-AUDIO-RIPPLE-DIAGNOSTIC-BUTTON-REMOVED-20261022.md`](BILI-AUDIO-RIPPLE-DIAGNOSTIC-BUTTON-REMOVED-20261022.md)。
> 2026-10-22 第二轮：按现场反馈把「判定链路的原始量」一次性补齐（`tune` / `analyser` / `raw` / `resets` / `bands`），见 §三。
> **部署状态**：正式安装仍是 **1003131823**；1824 追加的诊断字段**经裁定暂不部署**，等用户用现有工具箱验证完低音门槛再定。下文描述的是仓库里的 1824 代码。

---

## 一、结论：正式入口有一半

| 承载 | 正式 `read_state` / inspect 入口 | 现状 |
|---|---|---|
| **卡片（iframe）** | **没有作者侧钩子** | `ui/sdk.js:295` 对 `read_state` 硬编码 `return { ok: true, result: { state: {} } }`；APPS.md「宿主驱动应用卡」一节也只列动作、不给作者注入点。所以这张卡 `read_state` 恒为 `{}` 是 **SDK 行为**，不是本 App 漏接 |
| **独立窗（App-owned 原生窗口）** | **有**：`hana.window.onInspect(handler)` | 契约是 `HanaAppWindowInspection { description?, state?, tools? }`（官方 SDK 的 `ui.d.ts` 类型声明，见另一安装包的 SDK 副本）。本轮已接入，返回同一份诊断 JSON |
| 卡片侧的替代 | 用户主动「复制音频诊断」 | 播放队列抽屉头部一个图标按钮，复用既有 clipboard 授权（同步 `execCommand` 优先 + `hana.clipboard.writeText` 兜底，与「复制歌名/歌手」同一套） |

**没有编 API**：`onInspect` 的返回形状取自 SDK 自带的类型定义（`HanaAppWindowInspection`），不是猜的；卡片侧没有任何作者钩子可接，所以走复制。

---

## 二、怎么用

### A. 卡片（日常路径）

1. 播一首曲目（B站 或任意源）。
2. 打开**播放队列**（抽屉）。
3. 点队列头部最右一组的「复制音频诊断」图标（复制字形）。
4. 粘贴给主会话即可。

按钮位置：`.queue-head-actions` 里，搜索 / 重命名 / 添加 之后、关闭（该按钮在抽屉形态下本就隐藏）之前。所有布局（宽窗 / 长卡 / 窄卡）都可达，因为它挂在抽屉里而不是主控制条上；**没有新增主菜单**。

### B. 独立窗（正式读取）

对已挂载的独立窗用 `ui_inspect` 定位后 `ui_action read_state`（或 `ui_inspect` 直接给的 state），拿到 `{ description, state }`，`state` 就是下面那份 JSON。

> ⚠️ 未验证：宿主是否真的把 `onInspect` 的返回挂到 `ui_inspect` / `read_state` 上。本机没有可用的原生窗口读取入口，只能确认注册本身不报错（见 §五）。

### C. 页面内旧钩子（保持不变，供既有测试/调试）

`window.__playerDebug.rippleAudio()` / `rippleState()` 原样保留；本轮新增的诊断**没有**塞进 `__playerDebug`，只走上面两条正式/用户入口。

---

## 三、字段与判读

```jsonc
{
  "schema": 1,
  "at": "ISO 时间",
  "build": "1003131824",
  "shell": "card | window",
  "layout": "wide | long | compact",
  "page": "play | queue | search …",
  "track": {
    "sourceKind": "netease | bilibili | local | search | other | none",
    "mode": "在线 | 本地",
    "hasUrl": true,
    "assignedUrlIsAppRoute": true
  },
  "media": { "paused": false, "ended": false, "seeking": false,
             "currentTime": 12.34, "duration": 266.88,
             "readyState": 4, "networkState": 2,
             "volume": 1, "muted": false, "errorCode": null },
  "ownership": { "isOwner": true, "takeover": false, "docLockSupported": true, "statePlaying": true },
  "ripple": {
    "audioContext": { "exists": true, "state": "running | suspended | closed" },
    "analyser": { "fftSize": 4096, "sampleRate": 44100, "binHz": 10.767,
                  "minDecibels": -90, "maxDecibels": -15, "smoothing": 0.2 },
    "capture": { "supported": true, "ready": true, "analysing": true, "building": false,
                 "lastAttachOk": true, "lastAttachAt": 1792647062955,
                 "lastError": { "name": "SecurityError", "message": "…", "at": 1792647062955 } },
    "streamTrack": { "readyState": "live", "muted": false, "enabled": true },
    "spectrum": { "available": true, "at": 1792647065355, "finiteBins": 1800, "nonSilentBins": 1790,
                  "peakDb": -41.5, "bands": { "bass": 0.00332, "mid": 0.0041, "high": 0.0007 } },
    "analysis": { "envBass": 0.31, "onsets": 12, "kinds": {"bass":3,"low":4,"mid":3,"high":2},
                  "lastReadAt": 3013.7, "warmupLeftMs": 0,
                  "tune": { "bassThreshold": 0.0137, "beatThreshold": 0.0178, "hatThreshold": 0.0018, "…": "…" },
                  "raw": { "eFast": 0.0033, "eSlow": 0.0031, "mFast": 0.004, "mSlow": 0.0039,
                           "hFast": 0.0007, "hSlow": 0.0006,
                           "bf": 0.00002, "mf": 0.00003, "hf": 0.00001,
                           "bgBass": 0.00001, "bgMid": 0.00001, "bgHigh": 0.00001,
                           "pk": 0.82, "pkFloor": 0.79, "lastKickAgoMs": 1400 },
                  "resets": { "count": 2, "lastAt": 1792647062955, "lastReason": "start" },
                  "signal": { "lowRatio": 1.8, "bassFlux": 0.0021, "fluxBgLow": 0.0009, "highFlux": 1.4 } },
    "scheduler": { "playing": true, "hidden": false, "inView": true, "reducedMotion": false,
                   "shot": false, "blocked": false, "width": 465, "height": 930,
                   "waves": 6, "audioWaves": 3 }
  }
}
```

### 语义边界（别读错）

- `track.assignedUrlIsAppRoute` 说的是**赋给 `<audio>` 的 URL** 是不是本 App 路由，**不代表最终响应来源**：302 之后 `currentSrc` 仍显示原 URL（本地实验已证实）。
- `capture.ready === false` **不是错误分类**，只是「当前没有可用的分析链」。原因看 `capture.lastError` 与 `ripple.audioContext.state`。
- `spectrum` 是**按需读一次**（读到独立缓冲，不碰 `freqData` / `prevBins`），不是持续采样；`at` 是读取时刻。
- `lastAttachOk / lastAttachAt` 只记录**真正走到 `captureStream` 的那次尝试**；`audioContext` 还没建（或没 running）时不会写。
- 不含 Cookie / token / 完整签名 URL / 歌单内容。

### 判读表

| 现场长相 | 读法 |
|---|---|
| `capture.ready=false` + `lastError.name="SecurityError"` | 采集被拒（跨源是最常见来源，但**不要只凭这一条就断定 302**，要配 `media`/Network 证据） |
| `capture.ready=false` + `lastError.message="no audio track"` | 拿不到轨道（元素没进入可采状态） |
| `capture.ready=false` + `lastError=null` + `audioContext.exists=false` | 还没建链（没播过 / 被所有权拦） |
| `capture.ready=true` + `spectrum.finiteBins=0` | 链在、此刻全静音（未播放或真静音） |
| `capture.ready=true` + `finiteBins>0` + `analysis.onsets=0` | 有信号但没触发 → 直接比 `analysis.raw.eFast/mFast/hFast` 与 `analysis.tune.*Threshold`；也可看 `spectrum.bands` |
| `analysis.raw.eFast` 低于 `tune.bassThreshold` | 绝对门槛在挡（参数/电平不匹配），不是代码缺陷 |
| `analysis.resets.count` 持续增长 / `lastReason` 频繁为 `seek`、`start` | 分析被反复重置（预热白跑），需要看谁在触发 |
| `scheduler.blocked=true` / `hidden=true` / `inView=false` / `reducedMotion=true` | 调度被拦，不是采集问题 |
| `scheduler.playing=true` + `capture.analysing=false` | 链在但分析没跑（调度/恢复路径） |

---

## 四、实现位置（便于复核）

| 文件 | 改动 |
|---|---|
| `ui/app.js` | `initRipples` 内：新增 `lastAttachOk/lastAttachAt/lastCaptureError/capturedTrack`、`resetCount/lastResetAt/lastResetReason/lastPk` 四个只读状态；`attachAudio` 记录结果与错误（**catch 不分类**，只存原始 `name`+`message` 前 160 字）；`detachAudio` 清 `capturedTrack`；`resetAnalysis(now, reason)` 记重置来源；新增 `sampleSpectrum()`（独立缓冲，含三频段 RMS）与 `round3()`；返回对象新增 `diagnostics()` |
| `ui/app.js` | App 级：`audioDiagnostics()` 组装曲目/媒体/所有权/涟漪四段；`registerWindowInspection()` 只在 `data-shell="window"` 且 `hana.window.onInspect` 存在时注册，全程 try/catch；`sdkReady.then` 里调用 |
| `ui/app.js` | 队列抽屉按钮 `#diagBtn` 的点击处理：同步 `copyTextSync` 优先，失败退 `hana.clipboard.writeText` |
| `ui/index.html` / `ui/standalone.html` | `.queue-head-actions` 里加一个 `icon-btn`（复用 `#i-copy` 字形），孪生文件同步 |
| `ui/_build.json` + 两个 html | 构建号 1003131822 → 1003131823（首版） → **1003131824**（补 `tune/analyser/raw/resets/bands`） |

**行为影响**：新增代码只在「用户点按钮」或「宿主调 onInspect」时执行；唯一的可见变化是抽屉头部多一个图标。没有改任何既有分支的判定与调度。

---

## 五、实际测过的范围（本地夹具，非真机）

夹具：本地静态服务把仓库 `ui/` 挂在 `/api/apps/hanako-simple-player/ui/...` 下（SDK 要求这个路径形状），后端路由全部 stub；Chrome 155 headless。**没有**重跑旧套件，也没有重做媒体矩阵。

| 检查 | 结果 |
|---|---|
| 页面加载（card / window 两壳） | 通过；`#diagBtn` 在 DOM；standalone 壳无 console 报错 |
| 点「复制音频诊断」→ 生成 JSON → 复制 | 通过（拦 `document.execCommand('copy')` 取到完整 JSON，字段与真实状态一致） |
| 失败态 A：`captureStream()` 无轨道 | `capture.lastAttachOk=false`、`lastError{name:"Error",message:"no audio track"}`、`streamTrack=null`、`spectrum{available:false,reason:"no-analyser"}` |
| 失败态 B：链挂上但元素没出声 | `capture.ready=true`、`streamTrack{readyState:"live",muted:false,enabled:true}`、`spectrum{available:true,finiteBins:0,peakDb:null}` |
| 无新增运行时错误 | 与安装包 1003131822 用同一夹具 A/B 对比，console 输出一致（仅一条 stub 造成的 playlist 读取失败） |
| 1824 新字段（`analyser` / `tune` / `raw` / `resets` / `bands`） | 实测有值：`analyser{fftSize 4096, sampleRate 44100, binHz 10.767, min/maxDecibels, smoothing}`；`tune` 与存储一致；`resets{count:2,lastReason:"start"}`；静音时 `bands` 全 null |
| 语法 / 孪生 / 构建号 | `node --check` 通过；两壳除 `data-shell` 外逐字一致；三处构建号一致 |

**没测到的**：

1. 真机上宿主是否真的调用 `onInspect` 并把返回挂进 `ui_inspect` / `read_state`（本机没有可用的原生窗口读取入口）。
2. 真机剪贴板写入（沿用既有「复制歌名」同一条路径，该路径此前已真机用过，但本轮没有重新验）。
3. **真实 B站 播放现场**——这正是下一步要取的东西；本地夹具不产生真实音源，也刻意没去碰真实播放。

---

## 六、下一步（给主会话）

1. （待定）若用户现有门槛试用后仍需定位，再部署 **1003131824** → 卡片播一首 B站 曲目 → 打开队列 → 复制诊断。
2. 独立窗同样播一首 → `ui_inspect` / `read_state` 读同一份 state（若宿主支持）。
3. 按 §三判读表分档；本轮已用 1823 现场将判定推进到「绝对门槛 vs 电平（单帧数值支持，非严格证明）」，余下待读项见 `BILI-AUDIO-RIPPLE-TRIGGER-ANALYSIS-20261022.md` §6。

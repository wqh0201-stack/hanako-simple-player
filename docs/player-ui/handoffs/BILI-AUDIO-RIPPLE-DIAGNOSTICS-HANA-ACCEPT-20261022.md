# 1823只读音频诊断 · 主审与交付

## 状态

构建 **1003131823 / 1.2.2 / AGPL-3.0** 已由用户原生确认安装，正式status=installed及安装_build1823已核。用户已主动复制真实B站诊断，证明本例采集成功、有信号、调度运行，但没有成功生成音频波；转查触发判定，**尚不是涟漪修复包，不声称已恢复**。

- stagedId：`stg_cb3bb476f39c4149`
- 安装源包hash：`53d996f37f1a0faecc13d2cec67849a3107939cfff0c85cacc711a575a45f90f`
- 用户决定后只读正式status与安装_build核对；未代批准、未改托管目录。

## 范围与差异

与不可变1822运行时包逐文件比较，只变`ui/app.js`、`ui/index.html`、`ui/standalone.html`、`ui/_build.json`。manifest、SDK、CSS、所有后端/取源/代理和运行时工具均逐字节不变。

主会话对1822→1823的app.js差异逐段检查：新增attach结果/轨道记录、按需独立缓冲频谱读取、诊断对象、独立窗onInspect注册及队列复制按钮；未改任何媒体URL、出声连接、重试、采集调度判定、门槛/增益/呼吸。无持久化或每帧状态推送。真实playlist/cache/cookies/LRC、玩具箱偏好与OH-Works未动，未提交推送。

## 读取方式

- **卡片**：SDK的read_state固定返回空state，不编作者钩子。打开播放队列，点击顶部“＋”右侧复制图标（title/aria-label为“复制音频诊断”），用户主动粘回会话。
- **独立窗**：当前项目sdk.js确有正式`hana.window.onInspect`实现，1823只在window壳注册诊断。宿主真实呈现还待安装后验证；未用CDP/browser.evaluate/token绕路。
- 具体字段/按钮步骤见执行者`BILI-AUDIO-RIPPLE-DIAGNOSTICS-20261022.md`。

## 验证归属

执行者：本地隔离页面两壳加载、按钮拷贝、无轨道失败与有轨道静音两态、1822/1823错误输出对照、基础检查。接口模拟不是真实Hana/真实B站。

主会话：**DIAGNOSTIC_READONLY_CONFIRM 3/3**（生产函数提取，临时VM）
1. 独立频谱缓冲的计数/峰值正确，原freqData标记不变。
2. 无analyser时明确不可用，不构建/恢复音频图。
3. window正式DTO生成/回调注册、卡片guard及隐私检查：只输出类别/状态，不含测试中的曲目ID或签名URL/token。

没有重跑此前媒体矩阵、旧套、全量或浏览器。包内app.js语法、构建三处、孪生HTML一致；官方validate_app **0 errors / 1 warning**（只提示动态依赖无法静态证明，未安装/执行Electron smoke）。

## 包

`/Volumes/SSD/hanadesk/OH-媒体库/小花音乐播放器/B站涟漪只读诊断-1003131823/hanako-simple-player`

34文件，1,689,196字节；同级package-sha256.json记录文件hash与相对1822的4个差异。显式打包运行时，无测试/文档/OH-Works或符号链接。

## 现场判读注意

- currentSrc/assignedUrlIsAppRoute仍不是最终响应同源证据；ready=false也不是错误分类。
- lastError可能来自较早失败，需与lastAttachOk/lastAttachAt及错误at合看；不要把旧错误当本次失败。
- 单次finiteBins>0/onsets=0不足以归罪门槛：结合nonSilentBins/峰值、预热/采样时间、音量与播放状态。
- 打开队列/切换界面可能影响可见性调度；blocked等字段首先说明采集瞬间，不能直接推断原播放画面。
- 若点击诊断按钮后现象突然恢复，记录这一点，避免忽略原有用户手势/恢复链路。

已收到真实现场：`bili-audio-ripple-20261022/production-bili-1823-20261022.json`，采样时播放36.23s、ready/analysing/lastAttachOk为true、无捕获错误、2048有限bin/999非静音bin、peakDb=-42.5、envBass=.874，onsets/kinds全0且调度不blocked。当前例不能再归因取样跨源失败；已续原排查会话查readSignal门控/原始RMS与归一化量纲等，不改用户参数。media.muted=true但代码readSignal无该字段守卫且采集已有信号，不能直接归罪静音。独立窗正式工具列表仍为空，本次通路验证来自用户主动复制，不冒充onInspect真机已通。

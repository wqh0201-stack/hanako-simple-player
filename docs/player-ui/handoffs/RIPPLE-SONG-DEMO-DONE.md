# 花一匁 · 涟漪演示与玩具箱交接

日期：2026-10-14。基线提交 `9b07a7d`，正式 App 版本 1.1.3、构建 1003131689。

## 范围与状态

本轮按用户确认的计划，先完成独立演示页。真实封面、用户指定的本地音频和本机 LRC 已接入。当前提供用户试看和 Hana 独立验收，**尚未迁入生产 ui/**。正式 App 文件、构建号和生产数据均未改动，也未部署、reload、打包或发布。此前另一条线的 SDK 与 GitHub 按钮修复保持原样。

预览地址：<http://127.0.0.1:8146/>（本机服务）。当前测试浏览器已正常播放并展开玩具箱，已读到真实电平 -19.4 dBFS。此处不是 Hana 卡片验收。

## 文件与行为

- `docs/player-ui/ripple-lab-layers.html`：保留已有高度场流光与细环，完成真实封面、歌词与播放接线；光场由离散低音事件激发并自然消散，去掉常驻装饰底纹。镲片独立冷却，保留小环，提高线宽、对比并加轻量衬色。
- 同一文件内的玩具箱：低音光波、鼓点细环、镲片小环三组，每组实际触发门槛与颜色浓淡。门槛是频段 RMS 地板，向左更容易触发、向右更少；颜色浓淡向左更淡、向右更浓，仅在绘制 alpha 变化。鼓点组同比例控制底鼓与中频细环的门槛及浓淡。重置按钮恢复本轮默认效果。
- `docs/player-ui/assets/hanaichimonme-cover.jpg`：播放器当前曲目元数据提供的真实封面，800×800。来源 `https://p2.music.126.net/bmjKC1odG-1spq20rjjebg==/109951168657437538.jpg`，用于用户指定的本地演示。
- `tools/serve-ripple-demo.mjs`：只监听 127.0.0.1，精确白名单静态路由和音频 Range，读取 CLI 指定的原音频/LRC；不复制歌曲进仓库，不连接已安装 App。
- `tools/verify-ripple-song-demo.mjs`：真实 M4A 经 captureStream / FFT 的门槛、三组 alpha 独立性、重置、暂停清场、窄屏与路径边界检查。

默认门槛：低音 0.0040，鼓点 0.0050（中频同步为 0.0012），镲片 0.00030。浓淡均 100%。冷却沿用低音 420ms、鼓点 320ms、镲片 150ms。

## 校准与验证

既有分层验收 `tools/verify-lab-layers.mjs`：**12/12**，未放松原断言。

启动处修复了零历史导致的假鼓点：用 320ms 预热中位数初始化背景。实测稳态低音快慢比约 1.0，弹鼓混合峰值约 1.83，原 1.9 门限只能靠背景未成熟偶然通过，校准为 1.6。非音高尾音保留鼓余韵屏蔽；持续有音高的低音背景可在两次鼓点之间恢复。最终既有混合夹具 bass=9、kick=5；纯低音 kick=0；纯底鼓 bass=0；静音全部为零。

真实歌曲与玩具箱验收：**14/14**。约 12 秒观察段 bass=10、kick=14、mid=14、hat=37。数量是程序触发数，不是实际乐器标注。

同一首歌 42 秒附近、每次预热后 8 秒计数：镲片门槛低端 5e-05 时触发 29 次，高端 0.0018 时触发 0 次。三组颜色均以同一帧分别测试 20% 与 180%，像素 alpha 显著增加，触发累计、帧数、场能量和音量均保持一致。

暂停 650ms 后：画布透明、waves=0、fieldEnergy=0、raf=false。1040 / 465 / 360px 无横向溢出，玩具箱可见字号均不小于 11px。浏览器运行时错误 0；`git diff --check` 与 Node 语法检查通过。

- D01 `real-cover-and-local-song-loaded`：通过。
- D02 `six-sliders-with-direction-and-accessible-names`：通过。
- D03 `real-song-has-bass-beats-and-cymbals`：通过。
- D04 `Bass-opacity-changes-rendering-only`：通过。
- D05 `Kick-opacity-changes-rendering-only`：通过。
- D06 `Hat-opacity-changes-rendering-only`：通过。
- D07 `reset-restores-approved-defaults`：通过。
- D08 `lower-threshold-produces-more-real-song-cymbals`：通过。
- D09 `pause-clears-the-field-and-stops-animation`：通过。
- D10 `toybox-fits-1040`：通过。
- D11 `toybox-fits-465`：通过。
- D12 `toybox-fits-360`：通过。
- D13 `local-audio-range-and-path-boundaries`：通过。
- D14 `no-browser-runtime-errors`：通过。

## 原始证据与复跑

本目录包含 `verify-song.json`、`verify-song.log`、`verify-layers.log` 和桌面/窄屏截图；`production-baseline.json` 保存正式 UI 的逐文件 SHA-256 与基线构建号。

```sh
node tools/serve-ripple-demo.mjs --audio '/Users/can/Downloads/B站音频/【ずっと真夜中でいいのに。】花一匁【MV／中文字幕】.m4a' --lyrics '/Users/can/.hanako/app-data/hanako-simple-player/lyrics/花一匁.lrc' --port 8146
node tools/verify-lab-layers.mjs
node tools/verify-ripple-song-demo.mjs --audio '/Users/can/Downloads/B站音频/【ずっと真夜中でいいのに。】花一匁【MV／中文字幕】.m4a' --lyrics '/Users/can/.hanako/app-data/hanako-simple-player/lyrics/花一匁.lrc'
```

## Hana 待独立验收

请在本机预览页复跑并检查真实封面上的可见度、光波消散、镲片辨识度与六根滑杆方向；报告写入 `RIPPLE-SONG-DEMO-ACCEPT.md`。本轮尚待用户确认观感，**不要据此部署、打包或发布 1.1.4**。确认演示后再单独实施正式 ui/ 的迁移、存储与孪生 HTML / bump-build / 整包同步 / reload 回路。

## 交接提交状态

2026-10-14 07:22，已通过 Computer Use 在 Hana 的对应项目会话提交上述独立验收请求；已确认消息出现在会话、输入区清空并进入处理状态。独立验收报告尚待返回，开始处理不等于验收通过。

# 歌词星尘连续消散 · 独立复核与部署记录 · 1003131767

2026-10-16，DeepMind。承接罐头“直接改，然后部署给我试试”。

## 实现与独立复核

实现交接见 [STRIP-LYRIC-STARDUST-CONTINUOUS-1003131767](STRIP-LYRIC-STARDUST-CONTINUOUS-1003131767.md)，问题证据见 [LYRIC-STARDUST-AUDIT-1003131766](LYRIC-STARDUST-AUDIT-1003131766.md)。

已独立检查：
- 与安装中1766的app.js对比，改动集中在横条歌词取样、材质与连续消散段；未变播放链路、新句同步及中断入口。
- `node --check ui/app.js`通过。
- 构建号三处一致：1003131767。
- 孪生HTML归一化data-shell后完全一致。
- 相关UI文件`git diff --check`无输出。后续`git diff --no-index`退出1只表示存在预期文件差异，不是基础检查失败。
- 看过实现者的两张关键帧。关键帧只能帮助看材质，不作为连续性证明。

有界离线诊断：提取当前生产动画函数、装载生产CSS，用22px十字单行，101个时间点直接调用实际paint函数。结果：

```json
{
  "build": "1003131767",
  "glyphs": 10,
  "particles": 160,
  "perGlyph": [16,16,16,16,16,16,16,16,16,16],
  "uniqueMaskStates": 79,
  "oldOpacityAfterDissolve": "0",
  "tailPixelsAtDissolve": 6984,
  "animationAliveAfter900ms": false
}
```

证实：原三档跳变已被连续写遮罩替代；首中末字都有取样；旧句隐藏时粒子画布仍有像素；时段结束返回停止。此诊断不冒充真实宿主连续播放或长期性能验收。实现者的真实媒体夹具联合抽查和中断清理见其交接，本轮未重复全套。

## 部署（尚待平台确认）

通过`extension_manager install`，source local 为本仓库路径，提交本地安装：
- App：hanako-simple-player，小花音乐播放器。
- manifest版本1.2.0，UI构建1003131767；原安装manifest为1.1.7，仅版本字段不同，能力声明未扩展。
- stagedId：`stg_0c31c41c759a98cf`。
- 候选hash：`9934178d8ceaaf3389c8ce30725c594159e6aa18e18063d6250d5c3f8d27870c`。
- 工具明确返回等待用户在平台确认。本记录此刻**不能宣称已安装或运行时生效**。

用户决定后用原stagedId读取status；获批安装后，正式reload并核对安装UI及新快照构建、真实卡片可加载。未确认时不手改安装目录或快照绕过审批。

## 试用材料与待验

短预览：`/Volumes/SSD/hanadesk/OH-媒体库/播放器验收/歌词字形溶解-1003131767/lyric-stardust-1003131767.mp4`。

最终观感仍由罐头实际用后反馈，重点看：整句连续化开而非半句跳掉、光尘是否像参考、尾迹是否过强、快歌是否拥挤。普通功能更新未跑全量回归；旧DOM星点专项尚未适配Canvas，未冒称通过。没有commit、市场更新或对外发布。

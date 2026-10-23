# 混合歌单参照匹配 · 中途交接与独立复核

> 更新：下列为1816中途历史。1817已完成集中修复、改后确认并提交正式安装审批；当前状态以 [1817主审及试用交付](MIXED-REFERENCE-HANA-ACCEPT-20261021.md) 为准，不把本页当作仍待修清单。

## 状态

本轮主体源码已经修改，但**尚未完成交付，不可直接安装**。初查工作树仍标1815，随后用户转交1816交接；主会话已读到`ui/_build.json=1003131816`及`mixed-reference-basic.log`的SYNTAX_OK/TWIN_OK/DIFF_OK。已安装的1815不包含本轮工作树新功能。

原执行会话：`sess_0mvgqq8fb_c8b696f4bf01b4797b73`。主任务`session-reply-a775ea49-3b9e-442d-bde2-69474dfd5bf4`完成回调没有正文；续接`session-reply-38646614-2439-45c8-9df8-d7524e45fe16`同样无正文。正式session transcript的最新第38轮仅有派发消息，没有assistant工具或正文，未能恢复执行。**根因未确诊，不把它归因于上下文或模型服务故障。**

随后用户转交了1816正式说明，继续原会话做集中返修，**不新建会话**。返修任务`session-reply-e1dff6f0-7412-4a97-977f-97906e7afc42`。规则/授权以`docs/TASK-mixed-playlist-reference-matching-2026-10-21.md`为准；接现有改动收尾，不重做、不回退1815后的内容。

## 已有成果与证据

- `ui/app.js`增加`referenceResolve`逐曲候选、时长容差、重新识别/换匹配、仅当前uid的显示信息编辑；`lib/cover-catalog.js`补搜索时长；`lib/catalog-index.js`补选中专辑的按需图缓存；孪生HTML及style已加入口。
- 原执行者已运行`tools/verify-mixed-reference-hana.mjs`，输出 **MIXED_REFERENCE 19/19**。这些主要是生产前端函数与标准化模拟候选，不代表原始上游数据映射已验证。
- 用户转交的执行者说明另报 **MIXED_START 5/5**：实际startEnrich处理8首，信息/图/词各8，未请求artist/index，默认图使用缓存入口。主会话未重复运行；也执行过旧TITLE_NORMALIZATION 9/9，不要继续重复它。
- 主会话直接读取`docs/player-ui/handoffs/playlist-catalog-enrich-20261020/mixed-reference-ui-hana.json`：**6/6**通过，312与1040各覆盖搜索/选参考/生产保存payload、编辑显示不改参考ID、搜索取消不写；runtimeErrors与missingAuth为空。
- UI脚本实际拦截业务API请求、记录生产POST payload，没有替换应用保存控制器。它不是生产Hana/真实歌单验收，也未证明所有异常路径。
- 主会话检查没有`verify-mixed-reference-ui-hana.mjs`残留进程，不要并行重跑已过UI或旧套。

## 独立复现的两个时长缺口（必须修）

用实际`referenceResolve`和标题/时长生产helper在临时VM注入lookup，无网络、无真实数据写入：

```json
{"case":"legacy-search-cache-missing-duration","matched":false,"reason":"duration","albumCalls":0}
{"case":"album-duration-conflicts-with-search","matched":true,"appliedDuration":1200,"actualAllowed":false}
```

1816已静态核对仍保留上述两段问题逻辑，构建号变化不代表已修。

1. **旧搜索缓存缺时长未补查**：搜索候选duration缺失、纯歌名无艺人提示，B站分P240秒；即使对应专辑元数据可提供240秒，也在选pick之前返回duration不符，album一次都没查。现有旧search缓存本来就没有duration字段，需按候选有界补读缓存/专辑元数据，不全量清缓存或重建库。
2. **专辑补读后未重算容差**：搜索报240秒因此通过，读取对应专辑后真实候选为1200秒，仍返回可自动匹配。合并后的最终时长必须重算delta/tolerance/allowed并重新选可用候选；超差不能继续自动采用，但手选仍允许。

## 其他明确源码审查点（核实后最小修正）

- **搜索单位不一致风险**：`cover-catalog.search()`新增`duration: s.dt ? Number(s.dt)/1000 : Number(s.duration)`，而现有album及`meting.js`官方归一化均将dt/duration当毫秒转秒。需以原始官方响应契约/小型原始包夹具确认并统一，不能只用前端已标准化的240秒模拟值证明。尚未联网证实本轮实际返回单位。
- **保护错误被吞**：`applyMatchChoice()`的album补读catch仅重抛Abort，可能吞掉`enrichCall`抛出的requiresVerification/cooldown保护后继续请求图/词。此类保护应保持外传/停止，不假成功。
- **手工编辑第一次备份**：`saveEditPanel()`直接写title/author/album；未整理曲目首次手改时没有建立catalogBackup，之后原B站信息可能失去恢复点。与自动整理共用最小“仅首次备份”路径，不重写已有备份。
- **按需缓存专辑头信息**：`catalog-index.cover()`新建`data.albums[id]={id,...d,pic,tracks,at}`；`d`主要是tracks，没有name/type/size/published表头。现有`catalogArtistDict`会读取这些表头字段，宜保留已有meta并从官方tracks补完整，避免按需缓存把后续关系视图变成无名专辑。
- `openEditPanel()`未像`openMatchPanel()`检查coverPickBusy，可补同样互斥，避免选图保存与编辑显示并发。

## 收尾边界

只针对以上缺口补少量真实生产路径断言；沿用19/19和UI6/6记录，不再跑旧29/旧套/全量/旧浏览器或折腾像素截图。正常新增小例不等于再次大回归。若必须修改UI布局才做相应节点确认。

不动真实playlist/cache/cookies/LRC、手工词/偏移、音轨URL/ID/顺序/收藏/播放位置或OH-Works。不提交、推送、部署，不新增权限/依赖/域名。源码edit/write；完成基础检查、bump后正文和文件交接均要有明确结果，再由主会话打包、官方静态校验和正式安装审批。

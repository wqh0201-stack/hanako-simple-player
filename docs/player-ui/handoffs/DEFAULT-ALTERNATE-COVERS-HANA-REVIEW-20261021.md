# 默认与备选专辑封面 · 1003131815交付核对

日期：2026-10-21。基线：已安装1003131809。执行：原码农会话；统筹与独立差异复核：DeepMind。

## 结论与当前状态

最终试用包为 **1003131815 / App版本1.2.2 / AGPL-3.0**。已完成必要离线检查、关键源码复核及整包官方静态校验。后续正式`status`已确认 **installed**，安装目录`ui/_build.json`亦为1003131815；该只读查询没有执行安装或代用户确认。安装成功不等于真实歌单验收通过。

- stagedId：`stg_a49bdf9f29d07601`
- 安装工具返回源包hash：`15879d9b162f10ef8a9020ceb71524253240b5b6275cbac23bb4ad540fcc37fc`
- 仅用`extension_manager action:status, stagedId`读取到installed，未代确认、未用confirm查询。

## 用户可见行为

1. **整理**复用可靠官方身份及默认albumId，规范信息、默认封面与自动词共用身份；用户明确改查询才重新确认。已选其他专辑图时，显式整理会恢复默认图；默认图失败保留当前图。
2. 整理面板有独立常驻说明，进度更新不会覆盖；说明不暗示会覆盖手动歌词。
3. **更换封面**展示最多8个按同曲、完整艺人ID集合及录音版本规则筛出的专辑候选。默认与当前分别标记；当前B站图或不明旧图不冒充默认，旧错误coverMatch不绕过校验塞回列表。
4. 确认选择只更新图片及图选择元数据；不改变歌曲规范专辑、catalogMatch、标题/歌手、歌词、偏移、音轨或顺序。最初原图备份保留，取消不保存，保存失败回滚。
5. 网易CDN预览使用120×120参数；最终图不降为缩略图。绑定整理继续走已有按albumId的持久图片缓存/预检。
6. 读取阶段可以取消并使异步序号失效；保存临界阶段禁取消；与整理入口互斥。

## 复核过程与证据归属

### 执行者回报（不是主会话重复运行）

- 1812首轮：COVER_CHOOSER 7/7、ENRICH_RESET_COVER 1/1；主审发现候选削成最佳层、默认/当前误标、常驻文案被覆盖、整理未复用ID等，未部署。
- 1813：补共享绑定曲目读取、候选层级、当前标记、独立说明、小图、取消与互斥；COVER_CHOOSER 11/11、EXTRA 1/1。真实DOM夹具点击证明2候选可选、aria-pressed切换、应用事件接到所选专辑2，B站图无“当前封面”误标。不是生产歌单或宿主安装生命周期验收。
- 1814收尾：COVER_CHOOSER 15/15、BOUND_IDENTITY 1/1、BOUND_INCOMPLETE_KEPT 1/1、ENRICH_RESET_COVER 1/1。覆盖真实预填歌手的全部绑定目标不搜artist/index、旧合作绑定缺曲目不降格单人、完整艺人集合、默认图缓存路径。
- 尺寸证据沿用首轮：312×494下选择器296×425.9、底部437.9、列表视口300/内容338可滚动；1040×780下320×425.9；字号最低11px，无fixed。未再次跑两尺寸。

### 主会话独立检查与集成

- 逐段阅读共享身份、候选筛选、应用/回滚、默认重置和模式/忙碌分支；1814确认全部绑定时缺省context不再触发建库，绑定读取失败不猜标题改绑，旧合作身份不会被首位艺人覆盖。
- 最后发现未整理曲目的身份返回仍优先使用输入提示艺人，而非已匹配官方曲目的完整artists。作一行集成修正，优先`resolved.match.artists`，并运行实际生产`coverChooserIdentity`的单例：提示仅Taylor Swift，已确认曲目为Taylor Swift + Bon Iver，返回保留两位官方ID。**PARENT_UNORGANIZED_FULL_ARTISTS 1/1**。未重跑上述套件。
- bump同步至1815；整包app.js语法、孪生HTML仅data-shell不同、构建号三处一致。
- 完整运行时包官方`validate_app.mjs --dir ... --json`：**0 errors / 1 warning**。warning为静态检查不能证明动态依赖，不是运行时通过声明。

## 运行时包与边界

位置：`/Volumes/SSD/hanadesk/OH-媒体库/小花音乐播放器/专辑封面选择试用-1003131815/hanako-simple-player`

- 34个文件，共1,613,146字节；同级`package-sha256.json`记录逐文件SHA-256。
- 显式包含manifest、index、package、LICENSE、README、assets/lib/ui整包，以及5个运行时工具play/list-music/bind-banner/create-list/search-music。
- manifest与1809逐字节一致：不扩权限、域名、音源或依赖。目录名等于appId，无符号链接。
- 不含测试、文档或OH-Works；未读取、复制、删除或提交OH-Works。
- 未改真实playlist/cache/cookies/LRC；未提交推送、发Release或市场PR。

## 尚未证明的事

- 未代用户批量处理真实歌单，未联网复查所有候选；不声称150首成功、全网发行完整或音频指纹级同录音证明。
- 像素截图因首轮CDP捕获超时未取得；仅有DOM尺寸与交互证据，未继续折腾截图。
- 官方smoke此前缺开发版Electron，在启动测试环境前失败，本轮未重试或安装依赖；静态通过不替代隔离启动/真实使用。
- 未跑旧29、旧专项、全量或旧浏览器大套件。1815安装已确认，实际用后效果仍据反馈处理；混合歌单、时长代餐和人工纠错的新迭代另见`docs/TASK-mixed-playlist-reference-matching-2026-10-21.md`，不属于1815已实现范围。

任务书：../../TASK-default-and-alternate-album-covers-2026-10-21.md
可复用经验：知识库《网易云官方元数据-歌手专辑接口与封面匹配》§14。

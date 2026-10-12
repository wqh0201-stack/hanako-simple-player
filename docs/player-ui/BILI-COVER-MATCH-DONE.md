# B站合集封面补全（网易云单源）

2026-10-12 · build `1003131668` · 已实现，未同步安装目录、未 reload、未批量修改真实歌单。

## 行为

- 当前歌单：队列头部「＋」→「补全封面…」；导入歌单也可右键/长按歌单标签进入。
- 歌手预填来自曲目显式前缀或已验证的周杰伦/陶喆/Aimer 合集标题，支持手改。UP 主不作为歌手。
- 网易正式歌手名优先于别名，避免搜索中的其他上传者冒用「周杰伦」别名。
- 按歌手分页取专辑、逐张读取 `/api/v1/album/{id}`，七天缓存存于 App 数据目录的 `cover-catalog-cache.json`。
- 全后端实例的请求串行、350ms 间隔；每次网络请求最多三次尝试。元数据失败不缓存空结果；任一专辑失败时本轮不提交封面，已成功读取的专辑下次复用。
- 封面清洗独立于歌词，支持单字歌名、日期、译名及「纯音乐」区段标题。标题归一后精确匹配；明确 LIVE、串烧、合唱或歌手不一致的条目保留原图。
- 排除现场/Remix/伴奏候选；优先非精选集，再按最早发行日期。图片加载成功后才替换。
- 替换 `pic`，备份写 `raw.coverMatch`，落盘后是曲目对象的 `coverMatch` 字段；保留 originalPic/source/artistId/songId/albumId/album/pic/at。
- 同稳定 B站 id 的其他列表副本同步，各自保存自己的原图。已匹配和已有非 B站自选封面的条目跳过。
- 「恢复原封面」同样同步所有副本，并删除匹配绑定。重载后仍可恢复。
- 停止会中断前端请求，不再发起后续专辑读取，也不提交本轮替换；在途单张后端请求仍可能完成并缓存。保存失败回退内存封面和备份。
- UI 继续用现有封面/环境色/MediaSession 链路。manifest/权限/QQ/音频地址未改。

## 文件

- `lib/cover-catalog.js`：官方元数据、缓存、请求排队与重试。
- `lib/register-routes.js`：`/widget/api/music/cover-catalog`，kind=artist/albums/album/context。
- `ui/app.js`、两个 HTML、`ui/style.css`：匹配、菜单、进度、取消、同步与恢复。
- `tools/verify-cover-catalog.mjs`：缓存、重试、排队和参数边界检查。
- `tools/verify-ui.mjs --covers-only`：浏览器操作、版本选择、副本同步、重载恢复及失败回退。

## 验收记录

- 封面专项浏览器断言 18/18，无运行时错误；312/465/1040 三种宽度的真实可见面板已截图检查。
- 封面元数据检查 8/8；既有后端检查 32/32。
- 真实官方接口确认歌手 ID：周杰伦 6452、陶喆 5196、Aimer 16152；魔杰座与 11月的萧邦返回原版曲目和封面。
- 正式发布包静态检查零错误；唯一提示为静态校验不能证明动态 URL/网络响应，这是校验器的能力说明。
- 全量 UI 回归 337/367，布局 12/12、窄卡 4/4，无运行时错误；30 项音频/沉浸动效断言未过。完整原始 HEAD 基线为 317/349、32 项失败，本次的 30 项失败全部在基线失败集合内，新增失败为零；基线另有两项歌词校准/媒体时间断言失败。不能把这轮报告称作全量通过，需在可正常播放的环境由 Hana 和用户真机复核。

## 交给 Hana 的部署 prompt

请部署源码仓库 `/Volumes/SSD/hanadesk/hanako-audio-player-simple` 中的 B站合集封面补全功能。
先读仓库 AGENTS.md、`~/.hanako/skills/hana-app-creator/SKILL.md` 和这份交接。

1. 先查看上述验收记录，在可正常播放音频的环境串行运行 `node tools/verify-cover-catalog.mjs`、`node tools/verify-backend.mjs`、`node tools/verify-ui.mjs`。若仍有音频/沉浸动效失败，对照原始基线和真机情况，区分旧问题与新增回归；若出现本次新增回归，先修复再部署。检查 `app:hanako-simple-player` 的安装来源。构建号应为 `1003131668`，这轮已经 bump，不要再 bump。
2. 若宿主已直接使用本源码作为本地来源，直接 reload；否则把仓库 `ui/` **整包**同步到 `~/.hanako/apps/hanako-simple-player/ui/`，并同步 `lib/cover-catalog.js`、`lib/register-routes.js` 到安装目录对应路径。本次新增后端模块，不能只同步 HTML。保留安装目录其他文件，不碰 app-data 的歌单、cookies 和歌词。
3. 用已发现的 extension_manager 正式工具执行 reload `app:hanako-simple-player`。普通本地编辑且 manifest 未扩权，不需要重装或新增授权。确认 reload 成功及新构建生效；仅同步文件不算部署完成。
4. 把操作交给我：打开周杰伦歌单 → 队列头部「＋」→「补全封面…」，确认歌手为周杰伦，点「开始」。不要代我批量操作真实歌单。
5. 和我核对《稻香》是魔杰座、《枫》《夜曲》是 11月的萧邦；LIVE/合唱保留 B站封面。查看喜欢/最近播放副本和系统正在播放封面。
6. 让我试一次「恢复原封面」和重载后恢复，再按需试陶喆、Aimer。报告真实结果，不把测试夹具当真机验收。

# 构建1803用后故障：歌手重复手填与Taylor封面415

日期：2026-10-21。范围：只排查原因，不修改运行源码、不部署、不改真实歌单/缓存/cookies/LRC。

## 结论

两处独立程序兼容缺口。歌手实际已保存，但旧封面入口忽略已整理的B站官方身份；封面URL/响应头与真实文件类型不一致，后端仅按Content-Type白名单误拒合法图片。不是用户漏填、歌曲匹配失败、当前接口账号验证或封面版权问题。

## 当前版本和用户证据

正式暂存stg_83706b9852388775状态为installed；安装目录ui/_build.json为1003131803。安装版ui/app.js及lib/catalog-index.js均与当前工作树逐字节一致。

截图1：Love Story整理结果标准信息1、封面0、歌词1、cover/415。截图2：旧“获取此曲封面”面板歌手为空，提示缺少歌手线索。只读真实playlist确认相关条目author=Taylor Swift，catalogMatch的songId=19292984、artistId=44266、albumId=1770438，已存在备份与自动歌词。

## 1 歌手为空的确定原因

ui/app.js约7375行singleCoverName(t)对任何bilibili:曲目直接返回空，仍沿用“B站author是UP主”的整理前保护逻辑；不检查已保存的可靠catalogMatch。7378–7384行getTrackCover仅看标题是否带歌手与该helper的返回值。规范化后的Love Story标题不带歌手，helper又返回空，于是进入手填面板。coverGuess只解析标题，openSingleCoverPanel也不会自行从官方身份取歌手。

对生产helper直接复现：title=Love Story、author/artist=Taylor Swift、raw.catalogMatch包含官方身份，返回的歌手及面板歌手仍为空，必然进入缺线索分支。没有进行网络请求或保存。

建议方向：优先解析可靠官方身份及已保存的歌手/索引；没有可靠身份时再保留UP主过滤。不能简单信任所有B站author，尤其需考虑恢复原信息后author可能重新是UP主。

## 2 封面415的确定链路

实际索引封面：

- Fearless/1770438：HEAD HTTP200、Content-Type=image/jpg、Content-Length=3472773。
- 1989/74870322：HEAD HTTP200、Content-Type=image/jpg、Content-Length=38403。

通过正式hana-downloader下载Fearless原图到资料库诊断目录。实际文件3472773字节，小于manifest的5MiB；魔术头89504e470d0a1a0a，file与sips均识别为PNG，1495×1495，可正常解析。即URL虽以.jpg结尾、响应声明image/jpg，**内容却是PNG**。

lib/catalog-index.js约187–188行只允许image/jpeg、image/png、image/webp，image/jpg不在列表。它在arrayBuffer读取前就抛本地415，所以没有机会识别合法PNG。截图里的cover/415是这项本地校验码，不是上游HTTP415。

使用生产createCatalogIndex.cover、相同真实PNG字节、标准Response、独立临时dataDir复现：

| 仅变更模拟响应头 | 现行结果 |
|---|---|
| image/jpg，实际CDN声明 | 415，正文读取0次 |
| image/jpeg，模拟只改别名 | 接受，但错误存为.jpg/报告JPEG，内容仍PNG |
| image/png，与实际内容一致 | 接受，存为.png/报告PNG |

因此不能只放行jpg别名或按URL后缀猜类型；应读取有界字节并校验真实图片签名，再确定规范类型与缓存后缀，继续保留大小/来源/格式限制，拒绝HTML、JSON、坏图等非图片。

原始复现：playlist-catalog-enrich-20261020/postuse-1803-cover-mime-repro.log。下载产物位于资料库“小花音乐播放器/故障排查-1003131803/Fearless-1770438.jpg”；文件扩展名保留服务器命名，不代表内容类型。

## 排除项和验收漏项

核对当前宿主app-host-entry.js的deserializeResponse：返回标准Response，headers.get和arrayBuffer有效。SDK返回普通对象的疑点已排除，不应按该假设修复。

前轮隔离测试覆盖标准image/png/jpeg及未整理曲目的旧入口，但漏掉“已整理B站曲目重新进旧入口”和“网易image/jpg头、实际PNG字节”的真实组合。8/8点击测试不等于这两种真实数据场景已验证。这是本轮用后反馈暴露的验收漏项。

本次仅确认原因和建议。未修改App源码、构建号、安装状态或真实业务数据；临时复现缓存与App真实缓存完全分离。

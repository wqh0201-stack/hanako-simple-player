# 1820独立复核 · 一次集中收尾

> 更新：下列为1820历史缺口。1822已集中修复，主会话改后确认5/5并提交正式安装审批；当前状态与证据见`ARTIST-PRIORITY-UNIFIED-EDITOR-HANA-ACCEPT-20261021.md`，本页不再是待修清单。

1820主体功能及新增9/9、两尺寸8/8记录已读取：UI runtimeErrors/missingAuth均空；未重跑这些套件。当前**先不打包安装**，把下列实际缺口一次修完。

## 三个实际生产路径复现

主会话仅加载`verify-artist-priority-hana.mjs`的夹具/生产函数初始化前缀，不执行原9条；临时VM、模拟API、无真实写入。

```json
{"case":"pending-then-blank-batch","pendingRetained":false,"currentArtist":"Artist B"}
{"case":"failed-artist-search-then-save","savedArtist":"Artist A","pending":true}
{"case":"artist-changes-after-album-read","matchedArtist":"Artist B"}
```

### 1. 待确认要求在下一次空歌手整理时丢失

曲目原有B绑定、`catalogPending.artist=A`；打开新一轮批量框默认空，startEnrich又直接复用B，enrichApplyReference清pending并重新套B的图词。仅当前一次“不跨人”不够，后续无新明确意图也必须保持保留；新填写/明确手选才可按意图解除。编辑待确认曲目时，查找按钮也不要默认以旧显示B覆盖待确认A的要求。

### 2. 查找失败宣称“原样”，保存却改了歌手

编辑器中A同时充当查找条件与显示字段，查找失败且无选参考后，saveSongEditor的displayChanged仍把原B写成A，同时写pending。界面却说“保存时保留原样”，容易让用户误写。

请明确区分查找条件和手工显示修改的意图：默认的“未找到→保留/待确认”不能顺带把查询词写入曲目信息；真正只手工编辑显示信息仍须能保存，不能一概禁用人工修改。可以用最小草稿/意图状态或明确预览，不用再拆回多个技术菜单。

### 3. 专辑补读后艺人变化仍越过指定歌手

搜索返回songId11、艺人A、250秒；同id专辑补读返回艺人B、250秒。requireArtist=true最终仍返回B。搜索阶段过滤不代表合并后的最终候选仍合格；需像1817修时长那样重验最终艺人约束，不能靠搜索缓存里的旧通过标志。

## 同批修正的保存/跳转边界（源码已定位）

- `songEditRestoreInfo/RestoreCover`直接closeSongEditor后调用旧即时保存函数；应进入统一草稿，保存才提交，取消不写。保留原恢复范围、原始备份及手工词/偏移，不新建历史系统。
- 候选/封面动态按钮的click未检查songEditSaving；晚到的封面加载还能在保存期创建可点按钮。给临界阶段操作加统一守卫，迟到读取不应影响进行中的保存或新编辑目标。
- `songEditLyricBtn`直接关闭编辑器丢未保存草稿。若已有修改，先提示保存/取消并留在编辑器；不要在旧参考状态上直接跳到歌词流程。无修改时沿原入口。

## 验证预算与交接

只补上述新缺口的小型生产路径断言，不重跑原9/8、旧套/全量/大浏览器，不拍图。布局不变就沿用已有两尺寸记录；若需改新控件可只点新增节点。改后bump/基础检查，更新原DONE报告和新日志，正文回报实际通过/未验范围。沿原会话、原数据保护/不部署/不提交边界，集中一次返修后交主会话打包。

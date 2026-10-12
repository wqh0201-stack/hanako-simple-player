# 当前歌单搜索与新增置顶

用户已确认：只搜索当前选中歌单里的歌曲，按歌名/歌手筛选；新增曲目放到第一首，批量保留批内顺序，已有曲目不重排。

本轮构建号：`1003131667`。Git 分支：`codex/playlist-search-prepend`，基于 `hana-simple` 的 `9a81983`，在独立 worktree 开发。宿主部署/reload 交由 Hana 真机验收完成，Codex 没有修改安装目录或 app-data。

## 行为

- 队列头部的搜索按钮位于铅笔、＋之前，三种布局都提供入口。
- 点开后出现输入框，实时按歌名/歌手筛选当前歌单。忽略大小写，兼容全角字符；空格分隔的关键词均须命中。
- 搜索时显示「命中数 / 总数」，底部队列计数保持总数。无命中显示提示；清空恢复原顺序；再点搜索收起。
- 输入框内 Esc 先清空、再收起；输入法组合状态下不抢 Esc。切换歌单清空并收起。搜索是临时 UI 状态，不落盘。
- 筛选仅改变队列显示。点行、红心、更多均按 uid 定位；上一首/下一首/自动下一曲仍使用完整歌单。
- 新增置顶覆盖：链接/文件/歌单导入、搜索与推荐收藏、队列/控制条红心、移动到另一歌单、B站全部分集收藏、恢复孤立快照曲目，以及 `hana_simple_play` 工具写盘。
- 批量新增先去重，再整批放到顶部，保持传入顺序；已有同 uid 项补齐信息，保留原位置。
- 本地固定文件夹重扫仍严格等于扫描结果：已删除文件摘掉，已有文件保持次序，新文件整批置顶。最近播放沿用既有最近在前的规则。

## 文件与验证

主要实现：`ui/app.js`、`ui/style.css`、孪生 HTML；工具新增入口：`tools/play.js`。

孪生 HTML 保留基线仅有的 `body[data-shell]` 差异（card/window）。本轮没有修改 manifest、权限、PV 生成块或音频链。

验证结果：完整 UI 回归 **349/349**，布局 **12/12**，窄卡 **4/4**；接线、迁移、跨文档生命周期均通过，零运行时错误。后端 **32/32**；新增功能专项 **22/22**。截图与完整报告在 `/tmp/hap-playlist-search-prepend/`。

自动验证命令：

```sh
node tools/verify-backend.mjs
OUT_DIR=/tmp/hap-playlist-search-prepend node tools/verify-ui.mjs
```

新增用例覆盖：本歌单筛选/计数/无结果/清空/Esc/切列表重置、筛选后播放顺序、收藏置顶、文件批量顺序与去重/重复导入、移动置顶、B站批量收藏顺序/重复收藏、本地重扫、三种布局的深浅主题、重载后顺序持久化。

官方静态校验在临时副本 `hanako-simple-player/` 上运行（仓库目录名与 manifest id 不同，不能直接把源码仓目录名作为安装目录名）：校验通过；仅有静态检查不能证明动态资源的通用警告。真宿主审批、拆窗贴回和 reload 仍需下述验收。

## 给 Hana 的交接 prompt

```text
请接手验收「小花音乐播放器」的当前歌单内搜索和新增置顶，并完成部署、reload。

源码主仓：/Volumes/SSD/hanadesk/hanako-audio-player-simple
开发 worktree：/Users/can/.codex/worktrees/playlist-search-prepend/hanako-audio-player-simple
分支：codex/playlist-search-prepend（从 hana-simple 的 9a81983 开始）
目标构建号：1003131667
交接文档：开发 worktree 的 docs/player-ui/PLAYLIST-SEARCH-PREPEND.md

先读主仓 AGENTS.md、~/.hanako/skills/hana-app-creator/SKILL.md 和 references/builder.md，按 Git worktree 规范接手。改动已提交在上述分支，先查看 diff；如需修复，在此 worktree 修改并提交，不把安装目录当源码仓。不推远端。

1. 在 worktree 跑 node tools/verify-backend.mjs 和 node tools/verify-ui.mjs；按 Hana Builder 当前工具 schema 做真实卡片/独立窗口验收。runTool 直测不能代替真实 UI。
2. 查验顶部图标顺序为搜索、铅笔、＋。点搜索后按歌名或歌手只筛当前歌单，大小写/全角可匹配；无结果提示正确；清空恢复；输入框 Esc 先清空再收起；切歌单清空收起。搜索后点行、红心、更多操作要对应正确的歌；上一首/下一首仍走完整歌单。
3. 验证单曲新增、队列红心、搜索/推荐收藏、移动到其他歌单都落第一首；批量导入/B站全部喜欢保持批内顺序、整批在旧歌前面；重复添加不重排/不复制已有歌。用隔离数据验本地重扫新增置顶、旧顺序保留、已删文件移除；最近播放保持最近在前。重载和拆窗贴回后顺序仍在、播放正常。
4. 覆盖窄卡、长卡、独立窗与深浅主题。打开输入框时列表仍可滚、标题/搜索/铅笔/＋不重叠、不被裁，宿主右上安全区和底部控制条可用。尽量在 Builder 隔离环境用测试曲目，别改用户真实收藏/歌单来凑测试。
5. 测试通过后确认主仓仍在 hana-simple 且干净；用 git merge --ff-only codex/playlist-search-prepend 集成。若有主仓新提交或未提交修改，保留用户内容，在工作树中正常合并解决后再验证，禁止 reset --hard 或强推。
6. 检查 extension_manager 里的本地来源。若直接指向已更新主仓，用公开 reload 接口；若来源是 ~/.hanako/apps/hanako-simple-player/ 的部署副本，从已验证源码整包同步 ui/（包括 app.js、style.css、index.html、standalone.html、_build.json 与所有资源），并同步本轮改动 tools/play.js。保留宿主现有安装记录，绝不覆盖 ~/.hanako/app-data/hanako-simple-player/。
7. 必须执行 extension_manager reload app:hanako-simple-player；只同步文件不会更新宿主 UI 快照。重新 inspect 获取真实 UI 身份，在主卡与独立窗确认 window.__HANA_BUILD 为 1003131667、新搜索和置顶已生效。若做了修复并重新 bump，则以修复后的构建号为准。

最后报告：自动测试结果、真机测试结果、最终提交/构建号、实际安装来源、reload 结果，以及仍未验证的项。完成主仓集成、部署和验收后才清理开发 worktree；它由 Codex 管理，应使用 archive_worktree，若 Hana 没有此工具则留给 Codex 清理。保留交接文档。
```

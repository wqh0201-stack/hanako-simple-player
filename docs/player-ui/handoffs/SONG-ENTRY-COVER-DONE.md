# 歌名 / 来源入口与单曲获取封面 · Codex 交接

日期：2026-10-15。任务：`docs/TASK-song-entry-cover-1.1.7.md`。
版本：manifest / package = **1.1.7**，当前返修构建号 **1003131710**（首轮交接 **1003131707**）。

## 开工与边界

- 开工 HEAD：`6b6ad5284d15908018117b9b4028c447d3bd631e`。
- 开工工作树仅 `?? docs/TASK-song-entry-cover-1.1.7.md`，无源码在途修改；已通过 Hana 项目会话报告，保留任务书。
- 已读项目纪律、协作约定、hana-app-creator 与 Builder 工作流，以及最新 server 目录的 APPS.md（`1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133`）。
- UI 首次基线被端口监听 EPERM 拦住；自动审批后运行。为避免长流程读到在途编辑，正式基线从开工 HEAD 导出 `/tmp/song-entry-baseline-ui`，通过 VERIFY_UI_DIR 运行原版验收脚本。未把混合源码运行当成基线。
- 后端、歌词、uid / 落盘结构、歌单级补全实现未改；按 B2b 修订扩展恢复目标。AGPL-3.0 保持不变。未执行 tag / Release / 市场发布。

## 文件与需求对应

| 文件 | 改动及原因 |
| --- | --- |
| `ui/app.js` | A1：标题 role/button + tabindex + 动态 aria-label，点击 / Enter / Space 搜曲名并切 song 范围；空库移除交互语义。A2：来源切歌单，清筛选，按 long / compact / wide 打开队列后居中；已删列表优先定位同曲副本，没有副本时在 recent（在线）/ local 中临时显示当前曲，不恢复已删歌单、不写盘。B2：先捕获菜单目标再 closePops，独立单曲目录查询、探图、原图备份、落盘、失败回滚及 toast；请求中禁用菜单项。B2b：新增 coverRestoreTargets，任意平台有 originalPic 均可从原入口恢复，保留批量补全 B站过滤。 |
| `ui/index.html` / `ui/standalone.html` | B1：复制歌名之后新增获取封面按钮与 24×24 线描 symbol；孪生 HTML 除 data-shell 一致。 |
| `ui/style.css` | A3：文字入口 hover 轻微透明度反馈及键盘焦点环，原字号与排布不变。 |
| `tools/verify-ui.mjs` | 新增 song-entry-* 无头断言，复用现有 coverCatalog 假后端；旧三项菜单断言按需求改为严格核对四项及顺序，未放松条件；提取歌单管理专项以便独立复跑。 |
| `manifest.json` / `package.json` / `ui/_build.json` | 版本 1.1.7；运行 bump-build 同步两 HTML。 |
| `docs/CHANGELOG.md` | 新增面向用户的 1.1.7 变更说明。 |

## 验证与原始输出

所有可持久共享输出位于 `song-entry-cover-1.1.7/`，以 `.txt` / `.json` 保存，避免仓库忽略 *.log。

- 后端基线 / 最终：**132/132**，失败集合均 `[]`，见 `baseline-backend.txt` / `final-backend.txt`。
- 封面专项初次：**46/46**，runtimeErrors `[]`，见 `covers.txt` / `covers-report.json`。
- 官方静态校验：**0 error、1 warning**，见 `validation.txt`。仓库目录名与 app id 不同，直接校验会报目录名不匹配；按正式 app id 将完整运行文件复制到 `/tmp/song-entry-validation/hanako-simple-player` 后通过。warning 为 DYNAMIC_DEPENDENCIES_NOT_PROVEN；不把静态通过视为宿主生命周期通过。
- `node --check ui/app.js`、`git diff --check`、孪生 HTML / 构建号 / 双版本核对通过。
- 键盘补验后封面专项：**50/50**，runtimeErrors `[]`，见 `covers-keyboard.txt` / `covers-keyboard-report.json`；使用真实 page.keyboard Enter / Space。
- 完整 UI（菜单预期修正前）：**455/456 断言，12/12 自检，窄卡 4/4，runtimeErrors=[]**，见 `final-ui.txt` / `final-ui-report.json`。唯一失败为原 `queue-menu-three-actions` 仍要求三项；实际四项与需求一致，已改为 `queue-menu-four-actions` 严格核对四项及顺序，专项复跑 **43/43**、runtimeErrors `[]`，见 `menu-final.txt` / `menu-final-report.json`。此次只改测试预期与专项入口，运行时代码未再变动；未把修正前全量日志改写成 456/456。新增 **29 项 song-entry-* 均通过**，含 B2b 本地空原图 / 恢复保存失败回滚。
- 完整 UI 基线：**427/427 断言，12/12 自检，窄卡 4/4，runtimeErrors=[]**，见 `baseline-ui.txt`。
- B2b 初次专项：**53/53**，见 `covers-b2b.txt` / `covers-b2b-report.json`。追加本地空原图与恢复保存失败回滚后，最终全量新增断言已全部通过。

新增断言使用稳定的 `song-entry-*` 编号：title-search-song-scope、title-keyboard-Enter/Space、source-keyboard-Enter/Space、source-centers-long/compact/wide、cover-menu-after-copy、cover-busy-disabled、cover-any-platform-replaces-and-backs-up、cover-persisted、cover-repeat-keeps-first-backup、cover-preserves-on-no-artist/no-match/request/image/save、cover-no-artist-no-request、cover-artist-from-title、source-deleted-list-not-empty、empty-has-no-button-semantics、empty-click-inert。另含 B2b 的 restore-panel-all-platforms-copy、restore-any-platform-and-copies、restore-save-failure-rolls-back、restore-local-empty-original、restore-leaves-unmatched-untouched、batch-fill-still-bilibili-only。完整细节以原始 JSON 为准。

复跑入口（仓库根目录）：

```sh
node tools/verify-ui.mjs --queue-management-only
node tools/verify-ui.mjs --covers-only
node tools/verify-ui.mjs
node tools/verify-backend.mjs
```

官方静态校验命令（目录 basename 必须是 app id；复制包内容后运行）：

```sh
HANA_APP_TOOLS_ROOT=/Users/can/.hanako/artifacts/server/1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133 node /Users/can/.hanako/skills/hana-app-creator/scripts/validate_app.mjs --dir /tmp/song-entry-validation/hanako-simple-player
```

`structural.json` 记录补全函数 / 后端未变与版本一致性；`source-sha256.json` 记录最终验证的源文件摘要。

## 开放边界与 Hana 真机验收

1. 当前没有名为 online 的内置列表；在线失效来源以已有同曲副本或 recent 为落点。无副本时临时当前项不持久化，避免跳空或复活已删歌单。
2. 已依用户 B2b 修订完成恢复扩围：新增恢复目标集合，非 B站与原图为空字符串的本地曲均可恢复；补全侧 coverTargets / startCoverFill 保持原样。面板明确“在线补全仅处理 B站，恢复支持所有平台”。
3. 按用户最新协作回复，由 Hana 独立复跑后整包同步 `ui/` → `extension_manager reload app:hanako-simple-player` → 真机验收；Codex 未宣称已部署或真机通过。
4. 请验证聊天卡片 / 独立窗的标题、来源、获取封面；窄卡来源切页与窗口抽屉居中；浅深主题 hover；线上目录与探图的真实请求结果。验收报告预期 `SONG-ENTRY-COVER-ACCEPT-1.1.7.md`。

## 提交状态

- 实现、自验与 B2b 修订完成。源码留在共享仓库，未创建发布。
- UI 全量的唯一旧预期已严格更新并专项通过；请 Hana 使用最终脚本独立全量复跑。
- 整包同步、reload 与真机验收由 Hana 接手，尚未宣称通过。
- 2026-10-15 14:02（Asia/Shanghai）已通过 Computer Use 在 DeepMind「封面歌曲名与来源交互」项目会话提交交接；输入区清空、发送变为停止，对方开始处理。此状态不代表验收通过。

## §7 返修完成：持续显示获取封面状态（2026-10-15）

针对 `SONG-ENTRY-COVER-ACCEPT-1.1.7.md` 的唯一打回项与最新版任务书 §7 实现，保留此前功能、自验、独立验收原始记录。

- `ui/index.html` / `ui/standalone.html`：新增 `#coverFetchStatus` 状态元素，封面左上角 CSS 坐标 12×12，容器 26px、环 16px；与队列 / 搜索变换层独立，窄卡队列打开也能看到，避开右上 100×40 宿主安全区。
- `ui/style.css`：纯 CSS 线描环连续旋转，颜色与底色使用 `--hk-text` / `--hk-surface`，不拦截点击、不占布局；低动态偏好放慢旋转，仍保留可见指示。
- `ui/app.js`：`setSingleCoverBusy()` 统一菜单禁用与圆圈显隐；请求开始立即显示，在 `finally` 收起，包含目录查询、探图、保存的完整生命周期。成功 toast 仍为「已获取此曲封面」；无歌手、未找到、请求 / 图片 / 保存失败沿用明确结果 toast，且不遗留圆圈。
- `tools/verify-ui.mjs`：新增 **19 项** spinner 断言，保留先前条件。通过独立挂起目录及保存响应，验证超过 toast 的 2.6 秒后仍可见、保存阶段仍可见、三布局浅深主题位置、窄卡队列页、旋转与所有退出路径；用 50ms 采样记录可见性。
- `docs/CHANGELOG.md` 与构建号已更新；孪生 HTML 除 data-shell 外一致，三处构建号 **1003131710**；版本仍为 1.1.7。

返修原始输出统一位于 `song-entry-cover-1.1.7/spinner-repair/`：

| 检查 | 结果 / 原始证据 |
| --- | --- |
| 歌曲入口 + 菜单 / 歌单管理 | **62/62**、失败集合 `[]`、runtimeErrors `[]`；`ui-targeted-final.txt` / `ui-targeted-final-report.json` |
| 封面全专项（含批量补全与恢复） | **75/75**、失败集合 `[]`、runtimeErrors `[]`；`covers-final.txt` / `covers-final-report.json` |
| 后端 | **132/132**、失败集合 `[]`；`backend.txt` |
| 官方静态校验 | **0 error / 1 warning**（通用动态依赖提示）；`validation.txt` |
| 孪生 / 三处构建号 / JS 语法 / diff 格式 | 全部通过；`source-sha256.json` 为本次最终源文件摘要（上一轮根目录摘要保留为历史） |

最终入口专项的受控等待记录：约 **2928ms**，任务仍在保存阶段时累计 **58 次可见采样，0 次隐藏**。这证明持续状态的生命周期，不是线上性能测量；未修改可选的「命中即停」策略。现有匹配会综合专辑按原版与发行时间排序，提前停止可能改变选图结果；没有前后线上耗时和质量证据，不在本次 UX 返修中引入该变化。

已目视无头截图 `cover-spinner-long-light.png`、`cover-spinner-compact-dark.png`、`cover-spinner-wide-dark.png`；它们是受控假后端证据，不等同宿主真机验收。本轮跑受影响的专项，未重新全量运行；上次由 Hana 独立全量 **456/456** 的原始结论保留在 ACCEPT 报告。

复验入口：`node tools/verify-ui.mjs --queue-management-only`、`node tools/verify-ui.mjs --covers-only`、`node tools/verify-backend.mjs`。请 Hana 整包同步 `ui/` 后 reload，复验聊天卡片和独立窗的圆圈从点击到结果全程可见、成功 / 未找到 / 失败收尾、浅深主题与窄卡队列。Codex 未修改生产歌单或宣称真机通过。

返修交接已通过 Computer Use 发至 DeepMind「封面歌曲名与来源交互」项目会话，确认消息出现在聊天、输入区清空、对方进入处理状态；待 Hana 复验。

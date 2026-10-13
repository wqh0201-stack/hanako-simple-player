# REORDER-GITHUB-ACCEPT · 长按排序与 GitHub 入口 1.1.3 独立验收

> 验收方：哦鲸鲸（Hana）。实现方：Codex。
> 交接 [`REORDER-GITHUB-DONE.md`](REORDER-GITHUB-DONE.md)、原始证据 `docs/player-ui/handoffs/reorder-github-1.1.3/`。
> 环境：HanaAgent beta `1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133`。日期 2026-10-13。
> 结论：**代码与部署验收获通过；交互手感与宿主外链为待真机项。**

---

## 0. 判定摘要

| 组 | 结果 |
|---|---|
| A 元数据与红线 | 通过 |
| B 独立复跑（我自己的输出） | 通过（backend 132、专项 42、UI 376） |
| C 包与部署核对 | 通过（runtime 逐项 sha256、宿主快照逐文件一致） |
| D 真机交互 | **待验**（长按排序手感 / 右键管理 / 挤压回弹 / 首尾 / 边缘滚动 / 音频连续） |
| E 真机外链 | **待验**（GitHub 实际外部跳转） |
| F 公开真实数据 | 未改生产数据（本会话未做排序写入） |

---

## 1. A 元数据与红线（我核）

- 基线 1.1.2 / `d96b597`，候选 1.1.3 / build `1003131685`。
- `git diff d96b597 --stat`：只动 `CHANGELOG / lib/library.js / lib/lists.js / lib/register-routes.js / manifest / package / tools/verify-ui.mjs / ui/_build.json / ui/app.js / index.html / standalone.html / style.css` + 新增 `lib/reorder.js`、`tools/verify-reorder.mjs`。
- **红线干净**：`lib/audio-owner.js`、`lib/mood-command.js`、`ui/sdk.js` 零 diff；`captureStream` / `createMediaElementSource` / `requestPlay` / `player-audio-owner` 在 diff 中零命中。
- **manifest 无扩权**：`capabilities` 与 1.1.2 相同（仅 `version` 变更），故 reload 不触发审批。
- **孪生 html**：归一 `data-shell` 后逐字一致。

## 2. B 独立复跑（不采信 Codex 结论）

原始输出在 `/tmp/hana-reorder/`。

| 检查 | 我的结果 | 证据 |
|---|---|---|
| `node tools/verify-backend.mjs` | **132/132，failed 0，exit 0** | `/tmp/hana-reorder/backend.json` |
| `OUT_DIR=… node tools/verify-reorder.mjs` | **42/42，failed 0，exit 0** | `/tmp/hana-reorder/reorder/verify-reorder.json` |
| `OUT_DIR=… node tools/verify-ui.mjs` | **376/376，failed 0，exit 0**；selfCheck **12/12**、narrow **4/4**；runtimeErrors `[]` | `/tmp/hana-reorder/ui/verify.json` |
| 官方 `validate-app.mjs --dir …` | errors **0**，warnings 1（既有 `DYNAMIC_DEPENDENCIES_NOT_PROVEN`） | 本机实测 |

**注**：`verify-reorder` 的宿主存储与外链桥是**夹具**，它只证明调用与状态流转，**不证明宿主真实跳转**。

## 3. C 包与部署核对（我核）

- 候选包 `/tmp/hap-reorder-package/app-hanako-simple-player-1.1.3.zip`：
  - 解包后 11 个 runtime 文件（`manifest/package/lib×4/ui×5`）与当前源码**逐项 sha256 一致**；
  - zip 摘要 `8f8f16c3fd816da0139ecf83deaa84c33a9c5b16412c19bd973c08c539323625` 与 `runtime-sha256.json` 一致。
- **部署**：整包同步 `ui/` + `lib/library.js`、`lib/lists.js`、`lib/register-routes.js`、新 `lib/reorder.js` + `manifest`/`package`；逐项 diff 全 OK。
- **reload**：`Reloaded app:hanako-simple-player from its current on-disk code.`
- **宿主真加载**：日志 `plugin "hanako-simple-player" v1.1.3 loaded`；最新 UI 快照 `snap-3qyhWX` 的 `app.js / style.css / index.html / standalone.html / _build.json / sdk.js` 与源码**逐文件 sha256 一致**。

> Codex 交接里「官方隔离 startup smoke 未完成（缺独立 Electron）」的限制**成立且保留**，我未把它当通过。

## 4. D/E 真机待验（需开播放器卡片与桌面交互）

这些必须在真卡片 / 真实浏览器里判，我在无窗口状态下**不伪造通过**：

| # | 项 | 判据 |
|---|---|---|
| D1 | 顶部标签长按 ~450ms 浮起、左右排序 | 长按只进入排序，**不弹管理菜单、不切歌单** |
| D2 | 曲目主体长按上下排序；红心/更多按钮不触发排序 | 两按钮长按无排序 |
| D3 | 邻项挤压 / 让位 / 回弹；首尾可放入；两轴边缘滚动 | 手感与越界行为 |
| D4 | 松手落位一次提交；Esc / 失焦 / 页面隐藏取消并恢复 | 取消无残留 |
| D5 | 排序时当前音频连续、UID / 进度不变 | 声音不断、进度不跳 |
| D6 | 歌单内搜索有文本时不排序；清空后可用 | 双态 |
| D7 | 右键导入列表仍出管理菜单（删除 / 补封面） | 与长按互不干扰 |
| D8 | reload 后非当前测试歌单顺序保留；`recent` 始终时间序 | 持久化 |
| E1 | 搜索推荐页 + 结果页点 GitHub，**真实外部浏览器**打开 `wqh0201-stack/hanako-simple-player` | 真跳转，非夹具 |
| E2 | 无外链权限时明确提示失败 | 降级可解释 |

## 5. 已知边界（Codex 已点名，我确认成立）

- 同一 list 内重复稳定 id（或无 id 且完整 URL 也重复）→ 排序 409，属**避免歧义丢数据的守卫**，非缺陷；未对生产歌单做去重。
- `fav` 沿用 `playlist.json` 既有 fav 副本顺序，不新排序键；新增收藏仍置顶，取消只过滤副本。
- 跨 list 同曲副本互不冲突。

## 6. 结论

**代码、独立复跑、包完整性、部署与宿主加载：通过。** 交互手感与宿主外链为待真机项，需在实际播放器卡片与外部浏览器中确认。生产数据未被本轮验收写入。

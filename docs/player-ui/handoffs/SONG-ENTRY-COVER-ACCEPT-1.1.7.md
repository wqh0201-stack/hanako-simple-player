# SONG-ENTRY-COVER-ACCEPT-1.1.7 · 歌名/来源入口 + 获取此曲封面 · 独立验收

> 验收方：Hana 侧（本会话统筹 DeepMind）。实现方：Codex。日期：2026-10-15。
> 仓库 `/Volumes/SSD/hanadesk/hanako-audio-player-simple`；版本 **1.1.7**，构建号 **1003131707**。
> 交接稿：[SONG-ENTRY-COVER-DONE.md](SONG-ENTRY-COVER-DONE.md)；原始输出 `song-entry-cover-1.1.7/`。
> 任务书：[docs/TASK-song-entry-cover-1.1.7.md](../../TASK-song-entry-cover-1.1.7.md)。
> 纪律：不看结论、只对原始输出；独立复跑；真机为准；不碰用户原歌单。

---

## 0. 结论总览

| 项 | 结果 |
|---|---|
| 后端独立复跑 | ✅ **132/132**，失败集合空 |
| 前端全量独立复跑 | ✅ **456/456**，runtimeErrors=[]（基线 427/427） |
| 官方静态校验 | ✅ 0 error / 1 warning（通用 DYNAMIC_DEPENDENCIES_NOT_PROVEN） |
| 被验证源码 = 当前工作树 | ✅ 逐文件 SHA-256 一致 |
| 孪生 HTML / 构建号 / 版本 | ✅ 除 data-shell 外一致；1.1.7；三处构建号一致 |
| 断言改动是否放松 | ✅ 未放松（`queue-menu-three-actions` → 严格四项 `queue-menu-four-actions`） |
| 禁区未动 | ✅ `coverTargets` / `startCoverFill` 逐字未变（B2b 只放宽恢复侧） |
| 整包同步 + reload | ✅ 已执行 |
| 真机 A1 歌名→搜歌 | ✅ 通过 |
| 真机 A2 来源→开面板并定位 | ✅ 通过（宽窗抽屉） |
| 真机 B 获取此曲封面（功能） | ✅ 用户真机确认能成功获取；Hana 复验替换与落盘均成功 |
| 真机 B 获取中反馈（spinner） | ✅ **复验通过**（见 §8） |
| 真机 A3 hover 反馈 | ⏸ 待验（自动化无法模拟 hover） |

**判定：功能与返修项均已真机复验通过；仅 A3 hover 目视待确认（不阻断）。**

---

## 1. 独立复跑（我自己跑，不照抄 Codex 数字）

```
后端：node tools/verify-backend.mjs
  → passed 132 / total 132 / failed []          （与 final-backend 一致）

前端全量：node tools/verify-ui.mjs
  → assertions 456/456，runtimeErrors []，exit 0
  （Codex 记录的是 455/456，那条唯一失败是它修正断言前跑的旧预期；
    最终脚本下我这边 456/456。基线 427 → 456，新增 29 条全绿。）
```

新增 `song-entry-*` 断言覆盖：标题搜歌范围、键盘 Enter/Space、来源三布局居中、
封面菜单顺序、请求中禁用、任意平台替换并备份、落盘、重复获取保留首次备份、
无歌手/未命中/请求/图片/保存五条失败路径保原图、无歌手不发请求、标题取歌手、
已删列表兜底、空库无按钮语义与点击惰性；B2b 的恢复扩围与回滚。

## 2. 源码一致性

`source-sha256.json` 记录的 8 个文件，我**独立复算**全部一致（`ui/app.js`、`ui/style.css`、
`ui/index.html`、`ui/standalone.html`、`ui/_build.json`、`manifest.json`、`package.json`、
`tools/verify-ui.mjs`）。即：**被验证的就是现在的代码**，没有测后偷改。

## 3. 代码审查（抽要）

- A1：`#trackTitle` 加 `role=button`/`tabindex`/动态 `aria-label`，点击与 Enter/Space 触发
  `openSongSearch()`（预填歌名、`searchScope='song'`、`openSearch()+doSearch()`）；空库移除交互语义。
- A2：`openTrackSource()` 切 `state.activeList`，清筛选，按 long/compact/wide 打开队列后居中；
  列表已删时优先同曲副本，无副本才在 recent/local 临时显示当前项（不写盘、不复活已删歌单）。
- B：`getCoverBtn` 处理里**先捕获 `moreTargetUid` 再 `closePops()`**（我提示的坑已避）；
  独立单曲查询链路、探图、原图备份、落盘、失败回滚、请求中禁用。
- B2b：新增 `coverRestoreTargets`（任意平台有 `originalPic` 即可恢复），
  `coverTargets` / `startCoverFill` 保持 B站过滤不变 —— 与修订要求一致。
- 孪生 HTML 除 `data-shell` 外一致；`i-cover` 为线描 symbol（无 emoji）。

## 4. 真机验收（桌面 HanaAgent，独立窗形态卡片）

卡片 `wb-card-plugin-webview-card-mv92i478-9`（`surface:detached`，真实播放中）。

- **A1 ✅**：点 `#trackTitle` 后 `#searchPage` 由 `hidden` 变为可见（探针：点 `searchPage`
  由「No element matches」转为可点），并可用 `#searchCoverBtn` 正常关闭 → **点歌名打开搜索页成立**，
  同时证明**卡片跑的是新代码**。
- **A2 ✅**：点 `#trackMeta` 后 `#drawerScrim` 由不可点变为可点 → 宽窗下**点来源打开了队列抽屉**；
  点 scrim 关闭恢复正常。
- **B ✅（功能）**：罐头真机点「获取此曲封面」，最终**成功获取**；菜单项存在于部署 HTML
  （与已验证源码逐字节一致）且顺序在「复制歌名」之后。
- **B ❌（过程反馈）**：见 §5。
- **A3 ⏸**：hover 反馈无法用现有自动化模拟，留待人工目视（不阻断）。

> 探针说明：该卡片的元素匹配以**元素自身 `hidden`** 为准（祖先 `hidden` 的子元素仍可被匹配），
> 因此我统一改用自身带 `hidden` 的容器（`#searchPage` / `#drawerScrim` / `#morePop`）做状态判定。

## 5. ❌ 打回项：获取封面缺过程反馈（唯一）

**现象（罐头真机）**：点「获取此曲封面」后，等待期间**没有任何提示**，不知道它在获取中；
最终**获取成功**有提示。

**根因（我定位）**：`ui/app.js` 的 `toast()`（约 1471 行）**2600ms 自动隐藏**；
而单曲补封面是「`kind=artist` → 逐张 `kind=album` → 匹配」的多请求、数秒过程。
`toast('正在获取此曲封面…')` 2.6 秒即消失，等待期界面无进行中指示。
（`getCoverBtn.disabled` 无效：点击后菜单已被 `closePops()` 关掉，用户看不到按钮态。）

**返修要求**（已写入任务书 §7，含罐头指定形态）：
获取期间在**封面左上角**显示**小号加载圆圈（spinner）**，持续到结束即消失；
结束用结果 toast 收尾（成功 toast 保持现状）；三态（进行中/成功/失败）都要有；
禁 emoji、走 CSS 变量、ES5、不新增权限、不改后端。可选：单曲改为「命中即停」缩短等待（需先给证据）。

## 6. 数据与环境

- 部署：`ui/` 整包 + `manifest.json` + `package.json` 同步到
  `~/.hanako/apps/hanako-simple-player/`，逐文件 `diff` 一致后 `reload`，版本 1.1.7。
- 用户数据基线（验收前后核对，**未改动**）：`playlist.json` **808 首**
  （`fav:29 / recent:100 / imp:1:200 / imp:3:174 / imp:4:90 / imp:5:200 / imp:8:15`），
  含 `coverMatch` 的 402 首。
- 本轮验收**未**在真实歌单上执行「获取封面」的写操作（避免改动用户封面）；
  B 的成功路径由罐头本人真机确认。返修后的复验同样会以不破坏用户数据为前提。

## 7. 待办

1. ~~Codex 按任务书 §7 返修「获取封面过程反馈」，给最终构建号。~~ → 已交付，构建 **1003131710**（见 §8）。
2. ~~我重新整包同步 + reload + 真机复验该条。~~ → 已完成（见 §8）。
3. A3 hover 目视确认（可并入复验，未阻断）。

---

## 8. 复验 · 返修构建 1003131710（spinner）

### 8.1 独立复跑（我自己跑）

```
后端：132/132，失败集合 []
前端全量：475/475，runtimeErrors []，exit 0   （456 + 新增 19 条 spinner）
官方静态：0 error / 1 通用 warning
被验证源码 SHA-256 与工作树逐文件一致
孪生 HTML 一致；构建号 1003131710 三处一致；版本仍 1.1.7
```

新增 19 条 spinner 断言全绿（`song-entry-cover-spinner-*`），覆盖：即时出现、旋转、
三布局浅深主题位置、窄卡队列页、超出 toast 寿命、保存阶段仍可见、50ms 采样 58 次无隐藏、
以及成功 / 无歌手 / 未命中 / 请求 / 图片 / 保存六条退出路径的收尾。

### 8.2 代码审查

- 新增 `#coverFetchStatus`（`.player` 直接子元素，独立于队列/搜索变换层），
  `top/left: 12px`、26px 圆、16px 纯 CSS 环，`z-index: 31`（高于队列抽屉 30、低于控制条 35），
  避开聊天卡片右上 100×40 宿主安全区；`prefers-reduced-motion` 下放慢旋转仍可见。
- `setSingleCoverBusy()` 统一「菜单禁用 + 圆圈显隐」；`getTrackCover` 开始即显示、`finally` 统一收起。
  成功 toast 原文保持；无歌手/未命中/请求/图片/保存失败均不遗留圆圈。
- Codex 对可选的「命中即停」**给了拒绝理由**（会改变选图结果、无线上耗时/质量证据），
  符合任务书「先给证据再动」，本轮不引入。

### 8.3 真机复验（卡片 `wb-card-plugin-webview-card-mv92i478-9`）

- 打开行内 ⋯ 菜单 → 点「获取此曲封面」。
- **进行中**：`#coverFetchStatus` 探针由「No element matches」转为可点 → **圆圈可见**；
  连续两次探针仍在（间隔已超 2.6 秒）→ **超出 toast 寿命仍不消失**。
- **收尾**：请求完成后探针回到「No element matches」→ **圆圈已收起**；
  `playlist.json` 对应曲目 `pic` 已更新且写入 `coverMatch.originalPic`。
- 复验命中的曲目：**ケセラセラ（珠乃井ナナ）**、**クリームで会いにいけますか（ずっと真夜中でいいのに。）**；
  两者新封面与原图**是同一张图**（仅 http→https），**视觉无变化**，原图已备份可恢复。
- 用户本人也复测确认「OK」。

### 8.4 数据与环境

- 部署：`ui/` 整包 + 版本元数据同步后 `reload`，构建号 1003131710。
- `playlist.json` 仍 **808 首**（结构未变）；复验产生的封面替换已如实记录（§8.3），
  均为同图替换、原图有备份，未删除或新增任何曲目。
- A3 hover：仍待人工目视。

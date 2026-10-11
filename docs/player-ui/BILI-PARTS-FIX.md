# B站分P 真机验收修复（2 bug + 3 交互）—— 完成

2026-10-11，构建号 1003131643。罐头真机验收 B站分P 后回了 5 条，本轮全修。

## Bug A｜播某一 P 后，整个搜索界面封面全消失

**根因（CSS 特异性）**：
```
.q-cover                  → background-image: var(--cover-image), var(--cover-fallback)   (0,1,0)
.player.nocover .q-cover  → background-image: var(--cover-fallback)                       (0,2,1) ← 压过
```
播一首**没有 pic** 的歌（分P正是 `pic: ""`）→ `applyCovers()` 给 `.player` 挂 `nocover`
→ 这条规则把**所有** `.q-cover`（搜索/推荐行靠 CSS 变量取图）的真封面整片清掉。
队列行不受影响（走内联 `style.backgroundImage`，不受 CSS 规则约束）。

**来历**：这条规则写在 `a7fa4ad`（极简版接线），当时 `.q-cover` 还没有 `var(--cover-image)`；
后来队列/搜索行改成按 CSS 变量取图，它就成了会整片清图的元凶。

**修法**：直接删掉 `.player.nocover .q-cover` 这条 —— `.q-cover` 自己已带
`var(--cover-image), var(--cover-fallback)` 兜底，缺图自动回落到 fallback，这条纯多余且有害。

## Bug B｜分P不继承总封面

pagelist 接口本就不返回图，同一支视频共一张封面。**选前端继承**（不改后端形状）：

- 新增纯函数 `stampPartsPic(list, pic)`：把主行 pic 盖到每个分P上（只补空 pic）。
- 调用两处：`probeBiliParts`（探测缓存时）、`toggleBiliParts`（现拉时）。
- 子行新增 `.bili-pcover` 缩略图（24×24），吃这张图；点该 P 播放时 `applyCovers()` 也吃它。

> 为什么不改后端：`/music/bili-parts` 的形状与搜索结果曲目保持一致更干净；
> 主行 pic 在前端手上（`r.pic`），继承是一行纯函数的事，也不需要后端多查 view 拿图。

**顺带修的隐患**：搜索结果行 / 热门 / 榜单行的 `--cover-image` 原本**没走 `withSession`**
（生产图是跨源 CDN 所以没暴露）。子封面同源（夹具 cover.png）时会 403，已在
`applySearchCovers` / `coverVars` / 分集缩略图三处统一补上 `withSession`。

## 交互 C｜有分P的行：点行/标题 = 展开·收起（不播放）

- 新增 `isMultiPartRow(r, i)`：**已探到 >1** 才算多P行（探测在途 -1 或 1 集时不接管点击，
  避免还没探完就把播放点了）。
- 点击分流：`.search-hit` → 多P行 `toggleBiliParts`，其余 `playSearchHit`（现状不变）。
- `aria-label` 跟着变（多P：「展开/收起分集：标题」；其余：「播放 标题」）。

## 交互 D｜「分集 N」= 纯提示器

去掉全部按钮语言：`role` / `tabindex` / `data-bili-mark` / `aria-expanded` / hover 态 /
箭头图标旋转全部移除。现在是**一句柔和的静态文字** `<span class="bili-mark">分集 N</span>`，
`pointer-events: none`（点了也落到行主体上，即展开），11px `--hk-faint`。
展开由点标题触发（见 C）。

## 交互 E｜标题限长 + 红心不换行 + 主行等高

`.search-row` 的 `flex-wrap: wrap` 只允许「分集树」这一项换行（它是 `flex: 1 0 100%`），
主行主体（封面 + 标题 + 红心）恒定一行；标题自身 `ellipsis` 限长，红心 `flex: 0 0 auto`
永不被挤到下一行。断言用几何校验（红心仍在主行主体纵向范围内）。

### E 补修（2026-10-11 第二轮，罐头真机抓到「长标题把红心挤下一行」）

**E 第一版只修了一半。** 根因在 `.search-hit` 的 `flex: 1 1 auto`：

`.search-row` 是 `flex-wrap: wrap`（为分集树独占整行而加），而 flex 换行是
**先按 hypothetical size（即 flex-basis）分行、再在行内压缩**。`basis: auto` 取内容的
**max-content 宽**，一条长标题（`white-space: nowrap`）会撑出巨大原始宽 → `.search-hit`
独自占满第 1 行 → 行尾红心被挤到第 2 行（截图里那颗孤 ❤），该行因此变高、与邻行不齐。
**与标题长短无关**，只要「内容宽 > 容器」就触发（普通长标题也会中，不止 B站）。

**改法（一处）**：`.search-hit { flex: 1 1 0 }`（原 `1 1 auto`）。`basis: 0` 后主体只占
「容器 − 封面 − 红心 − 间距」的剩余宽，标题在里面 `ellipsis`，**红心恒在同一行**。
这正是罐头要的「宽度限制匹配当前界面宽度」—— 不写死 px，跟着面板走。
`q-line1 .q-title { flex: 1 1 auto; min-width: 0 }` 保持不动（标题在行内让位给分集提示）。

回归守：`search-long-title-keeps-fav-inline`（超长标题行：红心与主体 top 差 ≤ 2px、行高与邻行一致）。

## 交互 F｜删掉分集子行的竖向导引线（2026-10-11 第三轮，罐头反馈）

`.bili-plist::before` 那条 `left:60px` 的 hairline（上一轮当「树的躯干」加的）**整个删除**。

**为什么滚一下就断**（不是偶发）：它是 `position: absolute` 挂在**滚动容器** `.bili-plist` 上的，
`top: 0; bottom: 4px` 撑的只是**容器可视高度**（232px），不是内容总高 —— 所以只覆盖首屏那几行，
滚下去自然没有。**它本来就画不了全程。**

树的层次靠缩进已经够，不需要这根线。`.bili-phit` 的列结构不变。
回归守：`bili-parts-no-guide-line`（子列表 `::before` 的 `content` 必须是 none/normal）。

## 改动文件

- `ui/style.css`：删 `.player.nocover .q-cover`；`.bili-mark` 改纯提示（去按钮样）；
  `.bili-pcover` 缩略图 + `.bili-phit` 四列网格；导引线位置微调。
- `ui/app.js`：`stampPartsPic` / `isMultiPartRow` / `renderPartsTree` 加缩略图 /
  点击分流 / `applySearchCovers`·`coverVars` 走 `withSession`。
- `ui/index.html` + `ui/standalone.html`：本轮无改动（孪生仍只差 `data-shell`）。
- `tools/verify-ui.mjs`：夹具给 B站合集加 pic；新增 6 条断言。

**注意：本轮没动 `lib/`** —— Bug B 选了前端继承方案（见上）。所以部署只需同步 `ui/`。

## 验收

- `verify-backend` **22/22**（未动）
- `verify-ui` **167/167**（12/12 布局、4/4 窄卡、零运行时错误）

本次新增断言：
- `bili-mark-is-passive-hint`（纯提示：span、无 role/tabindex/data、pe:none、无箭头）
- `bili-multi-row-click-toggles`（点多P行 = 展开，不播放）/ `bili-multi-row-click-collapses`
- `bili-single-row-click-plays`（单P行点 = 播放，现状不变）
- `bili-cover-survives-nocover`（Bug A 回归守：无 pic 曲目起播后，其它行封面仍在）
- `bili-parts-inherit-cover`（Bug B：子行缩略图吃到主行 pic）
- `bili-row-keeps-one-line-with-heart`（E：红心不被挤出主行）

## 待真机

树形展开收放手感、232px 限高在三种布局、窄卡挤压 —— 与上一轮同，真机看一眼。

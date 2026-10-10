# 悬停抬升（发光）· 交接

2026-10-10，罐头拍板。参照物是罐头给的一张截图（音量按钮悬停态）：
他想要的是**那团光**，不是现在那块 `--hk-hover` 灰底。

## 一、要解决什么

旧 hover 一律是 `background: var(--hk-hover)`，即
`color-mix(in srgb, var(--hk-text) 6%, transparent)` —— 一块淡灰底。
罐头原话：「现在一个灰色选中框」。它只有「底」，没有「光」。

参考图里量出来的两件事（按像素算的）：
1. 按钮所在表面**整体提亮一档**，色相不变，亮度约 +9%；
2. 外面散一圈**柔和同色辉光**，无硬边，向内亮向外渐隐，半径约等于按钮半径。
   里面图标接近纯白。

## 二、做法：一套 token，两档强度，两种物理

新增一组 `--hv-*` token，定义在 `.player` 上（不是 `:root` —— 需要吃
`.player` 作用域的 `--hk-*`）。

**两档强度**：
- `--hv-surface` / `--hv-ring`：辅助位（搜索 / 模式 / 队列 / 音量 / 上下一曲 / 红心 / 行内图标）。
- `--hv-surface-strong` / `--hv-ring-strong`：中央三键与播放键，更强一档，
  焦点仍在播放键身上。

**两种物理**（由 `.player[data-tone]` 切换）：
- `dark`：光是真的 —— 表面提亮并染一档强调色 + 一圈同色外辉 + 一层内辉。
- `light`：浅纸上的白光晕**不存在**（比纸更亮就是白，加到极限也看不见），
  改用「影子托起」：表面提到近白并微染强调色 + 同色柔光 + 软投影。
  手感一致（被光 / 被影接住），借的力不同。

**光色 = `--hk-accent`，不跟封面。** 控制条与队列是常驻面板，不是沉浸区；
封面换歌就换色的话按钮会跟着晃。跟随封面主色的撞色只留给 `--hl-accent`
那一族语义（歌词当前句 / 红心描线），两者别混。

## 三、`data-tone` 怎么定（不猜主题名）

宿主主题 id 有十来个（warm-paper / midnight / high-contrast / delve / coral …），
而 `data-theme` 只有 `light`/`dark` 两种写法 —— **靠名字判会误判**
（`high-contrast` 是浅色主题，名字里没有 light）。

所以 `resolveTone()` 直接读 `--hk-surface`（控制条 / 队列那层面板色，也是
`.player` 的底色桥）算相对亮度（WCAG 公式）：`> 0.5` → `light`，否则 `dark`。
浅纸那一片都在 0.8+，深板岩在 0.06，中间没有歧义。

写入时机：
- `renderAll()` 开头（每次整体重渲染）；
- `applyHostTheme()`：forced theme 分支、以及主题订阅回调里（两个 `setTimeout`
  覆盖异步拉样式表的落地）；
- boot 的 `sdkReady.then` 里再判一次（主题值真正落地后）；
- `matchMedia('(prefers-color-scheme: dark)')` 的 change（**没有宿主主题时**，
  macOS 切深浅不派主题事件，得自己听）。

## 四、列表为什么只有「极轻提亮」

`.q-row:hover` 保持轻提亮（`--hv-row`，比原来的 `--hk-hover` 略厚一点点），
**整行不发光** —— 列表是整行连续排的，整行发光会变成一条条亮带，很吵。
光只给行内图标：`.q-more` / `.q-fav` 走 `--hv-ring-icon`。

`--hv-ring-icon` 与 `--hv-ring` 的差别是**以 inset 为主、外扩收一档**：
队列容器（`.queue` / `.queue-list` / `.list-tabs` / `.pop`）有 `overflow` 裁切，
外扩太大的光晕会被切掉一截。

## 五、播放键不再缩放

旧 hover 是 `transform: scale(1.025)`。改成只发光 —— 因为
`arrangeControls()` 的跨断点换位用的是 WAAPI，对这个 `transform` 下反向位移；
`.fav-btn` 的 `heartPop` 也是 transform 动画，两者会跟 hover 缩放抢同一个属性。
只留 `filter: brightness(1.04)` + 发光。

## 六、断言

页面自检新增四条（`ui/app.js` 的 `runSelfCheck`）：
- `tone-matches-surface-polarity`：读 `--hk-surface` 算亮度，与 `data-tone` 交叉验证。
- `hover-glow-replaces-gray`：扫样式表，`#queueBtn` 的 hover 规则必须声明 `var(--hv-*)` 的 box-shadow。
- `hover-glow-on-all-controls`：七个选择器（`.search-entry` / `.queue-btn` /
  `.transport > .icon-btn` / `.play-btn` / `.fav-btn-bar` / `.q-more` / `.q-fav`）
  都有 `--hv-*` 辉光。
- `hover-glow-two-tiers`：`--hv-ring` 与 `--hv-ring-strong` 都存在且不同。

⚠️ **伪类没法用 `getComputedStyle(el, ':hover')` 读**（第二个参数只认
`::before`/`::after`，对 `:hover` 静默返回元素自身样式），所以断言走
`document.styleSheets` 扫 `selectorText`。这是写断言时踩过的坑。

## 七、文件

只动两个：
- `ui/style.css`：新增 `--hv-*` token 两档 + 浅色兜底媒体查询；把 8 处
  `var(--hk-hover)` 的 hover 换成 `--hv-*`（`.icon-btn` / 控制面辅助槽位 /
  transport / play-btn / fav-btn / fav-btn-bar / identity heart / q-more / q-fav / q-row）。
- `ui/app.js`：新增 `rgbStr2arr()` + `resolveTone()` / `applyTone()`，
  在 `renderAll` / `applyHostTheme` / boot 三处接线，加系统深浅监听。

搜索页的悬停**没动**（罐头明确说不用改）。

## 八、真机复核（2026-10-10）

罐头确认「都 ok」：深底发光、浅底浮起两套物理都成立；播放键与辅助键的强度分层也成立
（主键没被抢戏）；列表行内图标的光未被容器裁边。构建号 1003131622。

## 九、验收

`node tools/verify-ui.mjs` → 12/12 布局自检、4/4 窄卡、**114/114** 断言（含 4 条新断言）、
零运行时错误。目视脚本 `node tools/shoot-hover.mjs`（真悬停＋按元素矩形裁图）。

⚠️ 两个写断言时踩的坑：
- 伪类没法用 `getComputedStyle(el, ':hover')` 读（第二个参数只认 `::before`/`::after`），得扫样式表。
- 扫样式表要用 CSS 里真实的选择器（`.queue-btn` / `.search-entry`），别用元素 id。

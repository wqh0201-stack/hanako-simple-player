# 雷区与根因（PITFALLS）

踩过的坑、错误做法的根因，以及「别改回 XX」的护栏。**开工前扫一眼相关主题**；
每条都标了原理出处（知识库 / 交接文档），需要细节去那里看。

知识库路径 `20-资料/` 指 `/Volumes/SSD/知识库/20-资料/`。

---

## 音频 / Web Audio

- **跨源媒体绝不能接 `createMediaElementSource`**。跨源会输出**全零（真·静音）**，
  且是**单程票**（不可逆）——全曲共用一个 `<audio>`，一次建链后所有跨源歌一起哑。
  正解：`audio.captureStream()` → `MediaStreamSource` → `Analyser`（副本增益 0，不叠音）；
  跨源直接抛 `SecurityError`，捕获后**元素照常出声**，退回纯指针涟漪。
  断言守卫 `reactive-uses-captureStream-not-mediaElementSource`。
  知识库 `20-资料/Web Audio 频谱反应-同源媒体与CORS陷阱.md`；构建号 1003131580。
- **`fftSize` 太小会让低频反应恒 0**。沿用旧频谱柱的 128 时每 bin 有 344Hz 宽，
  40–180Hz 全挤进 bin 0，bass 恒 0、鼓点永不触发（看着「接上了」其实没反应）。
  用 **4096**（44.1k 下 ≈10.8Hz/bin）才够分辨率。知识库同上 §五；构建号 1003131601。
- **频谱接真音频必须同源媒体** → 所以 `music/go` 改分片流式代理，不走 302 跳 CDN。

## 宿主 / 沙箱 / 主题

- **主题初始注入绝不能用系统深浅挑色**，要用「Hana 当前主题」。
  旧实现把宿主两套调色板包成 `@media (prefers-color-scheme: light/dark)`，
  触发条件：系统浅色 + midnight → 深色卡面两角露近白补丁、强调色不跟随。
  `themePolarity()` 优先读 `data-appearance`（按实际底色算）。
  知识库 `20-资料/Hana App 卡片UI-主题变量与存储接线.md`；构建号 1003131624。
- **`boot()` 早于 `sdk.js` 执行** → `window.hana` 未就绪、读存储永远 null，
  回写默认值会把已存的真数据冲掉（踩过：歌单改名不持久化）。
  读存储前先等 SDK 就绪。
- **卡片 iframe 的顶部两角要自己补圆**（`border-radius: 14px 14px 0 0`）——
  宿主只在独立窗裁圆，卡片里不裁；角上露出的颜色必须给卡面色 `--hk-surface`，
  用页面色 `--hk-bg` 会露出一块深一号的补丁。
- **沙箱禁用**：`position:fixed`、直接 `localStorage`、`window.open`、表单提交、
  重复文档外壳、字号 < 11px。细节以 `hana-app-creator` 技能为准。

## CSS / 布局

- **给浮层外层的容器绝不能加 `z-index`** —— 加了就成 stacking context，
  罩内写的 `z-index:40` 出罩只剩外层的号。音量浮层往上长进 `.stage`，
  与搜索页(22)/遮罩(28)/抽屉(30) 几何重叠，结果滑条被盖住拖不动。
  断言要用 `document.elementFromPoint` 做命中测试，不能只比 z-index 数字。
  构建号 1003131612。
- **窄容器里要跟别的东西并排的输入框，`flex-basis` 别留 `auto`**。
  basis:auto 取内容固有宽（`<input>` 很大），会让 flex 提前断行（踩过：搜索页返回键被顶到单独一行）。
  改 `flex: 1 1 0; min-width: 140px`。构建号 1003131620。
- **`flex-wrap` 换行是先按 flex-basis 分行再压缩**。`flex:1 1 auto` 取 max-content 宽，
  长标题（nowrap）会撑出巨大原始宽 → 主体独占第 1 行、行尾按钮掉第 2 行。
  改 `flex: 1 1 0` 让主体只拿剩余宽。构建号 1003131646。
- **`absolute` + `top:0;bottom:4px` 撑的是容器可视高，不是内容总高** ——
  想画贯穿全程的竖向导引线时它只盖首屏（滚动后就没线了），所以那根线直接删了。
- **浅纸上的白光晕不成立**（比纸更亮就是白，加到极限也看不见）：
  深底用「发光」，浅底必须用「浮起」（柔光 + 软投影）。
  知识库 `20-资料/深底用光浅底用影-悬停态在两种底色上.md`；构建号 1003131622。
- **图标「看起来多大」看视觉外接框 / 面积，不看最大边**。
  同一个 19px 框里，音量（喇叭+弧）天生扁，按最大边对齐仍显小；
  要按视觉面积对齐，且描边宽按框宽反比缩（`stroke-width` 渲染出来才一样细）。
  `node tools/measure-icons.mjs` 量每个 symbol 的内容外接框。构建号 1003131617/19。

## 生命周期 / 状态

- **拆窗 / 停靠 = 每个窗口文档都是全新 iframe**，只能靠旧文档 `pagehide` 落快照、
  新文档读回续播。快照要**自带当前曲目**（整条），别只带 id 靠 `playlist.json` 认领；
  换曲即 `savePlaylist()`。宿主可能不派 `pagehide`/`visibilitychange`，
  所以**周期落盘才是命脉**，另补 `unload`/`beforeunload` 保险。构建号 1003131613/14。
- **`persistThrottled` 是防抖不是节流** —— 连续 `timeupdate` 会不停重置定时器，
  播放期间**零写入**，盘上只剩「上一个显式动作」（拖动进度条就是之一）。
  要真节流（最多每 1.2s 写一次）。
- **快照进度用媒体时钟 `audio.currentTime`**，别用滞后的 `state.progress`；
  seek 落点未到位前不出声（否则先从头/错位放几百毫秒再跳）。
- **`.player.nocover .q-cover {…}` 这类高特异性老规则会一次性清掉所有列表封面** ——
  写在极简版早期（当时列表封面还没用 `var(--cover-image)`），后来列表改按变量取图就成元凶。
  已删；`.q-cover` 自带 fallback。

## 部署 / 打包

- **宿主快照 UI**：宿主加载 app 时把 `ui/` 拷进 `.cache/app-ui-snapshots/`，
  之后只认快照 —— 改了文件不会自动生效，**必须 `reload`**。
- **部署必须整包同步 `ui/`**（index / standalone / **style.css** / _build.json）。
  漏 CSS 会让 `.cell` 无样式退化成块级、元素竖堆（罐头看到的「左右各挤成一坨」）。
- **孪生文件必须同步**：`ui/index.html` 与 `ui/standalone.html` 只差 body 的
  `data-shell`（`card`/`window`）。改一个必须同步另一个。
- 打包别忘 `tools/pack-release.mjs` 的白名单 —— `tools/` 里三个运行时工具是装载依赖，
  不能整目录排除。

## 数据 / 匹配

- **跨源兜底不能拿脏标题去搜**。B站视频标题带「【4K珍藏】…MV极致修复！… 郭总说」这类噪声，
  原样去搜**搜索这一步就废了**。要先 `cleanLyricQuery()` 清洗（`《》`优先 → 去括号 →
  剥噪声词 → 分隔符截断 → 抽歌手）。构建号 1003131637。
- **手动匹配要存「选中的源 + id」，不能只存关键词** —— 否则重载会按关键词重搜，
  又解回另一条。绑定写 `raw.lyricMatch = {…, server, mid, title}`。
- **网易云电台节目接口必须带 Referer**，否则 `code:-462`。

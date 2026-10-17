# 横条歌词「日文原文（中文翻译）」自动拆两行

构建号 **1003131770**（基线 1003131768）。改动只在横条呈现层，歌词数据、竖卡、LRC 一律未动。

## 改了哪些文件

| 文件 | 改动 |
|---|---|
| `ui/app.js` | 新增纯函数 `splitLyricTranslation()`；新增横条读写两件套 `writeStripLyric()` / `stripLyricRaw()` / `stripLyricTextNodes()` / `stripLyricRowBounds()`；改写 `stripLyricVisibleGlyphs()`；`syncStripLyricFont()` 探针改走真实拆分形态；`renderStripLyric()` / `finishStripLyricLead()` / `startStripLyricDissolve()` / `beginStripLyricLead()` 的 textContent 读写全部改走「原始文本」；`__playerDebug.splitLyricTranslation` 导出 |
| `ui/style.css` | 新增 `.strip-lyric-main` / `.strip-lyric-sub` 两条规则（`display:block` + 微小行距 + 0.92 透明度） |
| `ui/_build.json`、`ui/index.html`、`ui/standalone.html` | 仅构建号（bump-build 自动同步） |
| `tools/verify-strip-bilingual.mjs` | 新增专项验收（16 条，`node tools/verify-strip-bilingual.mjs`） |

未改：`renderLyrics()`（竖卡）、`parseLrc()`、`state.lyricLines`、播放链路、其他布局。

## 拆分规则（最终口径）

全部满足才拆，任一不满足返回 `null` → 整行原样渲染（行为与改动前完全一致）：

1. 存在成对括号 `()` / `（）` / `【】`；一行多个时只取**最后一个**；括号内有同类括号（嵌套/不配对）则跳过。
2. 该括号位于句尾 —— 其后只允许空白与收尾符（`ー ~ - … ・ . 、 ， 。 ！ ？`）。该段尾部收尾符并入译文行。
3. **主行含日文假名**（`\u3040-\u309F` / `\u30A0-\u30FF`）—— 纯中文行不拆。
4. **括号内含汉字**（`\u3400-\u4DBF` / `\u4E00-\u9FFF`）—— 纯罗马音、「（CALF）」这类和声不拆。
5. 括号内**不是**版本/演出标注：`live / inst / instrumental / off vocal / tv size / remix / ver / version / feat / cover / demo / acoustic / ライブ / 伴奏 / 纯音乐 / 无歌词 / 翻唱 / 试听`。
6. 主行与译文拆完都不为空。

主行额外去掉尾部空白；**括号本身不显示**。

## `stripLyricVisibleGlyphs()` 怎么改的（本轮最易踩的坑）

原实现 `var node = outgoing.firstChild` 后按单文本节点取样 —— 拆分后旧句覆盖层是
main + sub 两个行节点，只认 `firstChild` 会**漏掉整行中文**，星尘只从半句喷出来。

改法：

- 新增 `stripLyricTextNodes(root)`：显式栈做**先序遍历**，收集覆盖层下所有文本节点（不递归调用，避免深层歌词爆栈）。
- 外层遍历文本节点，内层沿用原来的逐字 Range 逻辑（代理对步长、省略号判定、可见性判定逐字不变）。
- 新增 `stripLyricRowBounds(node, root)`：取样边界按**行**收敛 —— 没拆分时行就是覆盖层本身（与旧实现逐字等价，`clipped` 取法不变）；拆分后取 `.strip-lyric-main` / `.strip-lyric-sub` 各自的 rect 与 `clipped`，两行独立判省略号，互不干扰。
- `minX / maxX` 跨节点累计，两行的字形都进 `glyphs`，因此星尘预算在两行间均摊，两行都发射。

## 其他关键点

- **DOM 成本**：只在命中拆分时插入两个 span；无括号/非日文歌保持原来的单文本节点，一行 DOM 都不多。
- **早退比较**：`renderStripLyric()` 原先 `el.textContent === text`。拆分后 `textContent` 是两行拼接串（且括号已去），会把切句误判为同句、整体跳过转场。改为 `stripLyricRaw(el)` —— 命中拆分时取写入时记下的 `_stripRawText`，未命中时回退 `textContent`（覆盖外部直接改 textContent 的情况），**永不返回拼接串**。
- **字号探针**：`syncStripLyricFont()` 的探针改由 `writeStripLyric()` 写入，因此量的是**真实拆分后的两行形态**。已验证：同一句「拼成一整行」恰好落在 `fontSize*2.4` 内、而「真实拆分」超出 —— 拆分确实被计入选档，字号不会被选大。
- **覆盖层**：`startStripLyricDissolve()` 也走 `writeStripLyric()`，旧句与当前句视觉一致。

## 自验结果

| 检查 | 结果 |
|---|---|
| `node --check ui/app.js` | 通过 |
| 孪生 HTML 一致（除 `data-shell`） | 通过（`diff` 无输出） |
| 构建号三处一致 | 通过（`_build.json` + 两个 html = 1003131770） |
| **拆分纯函数** | 23/23（含日文全角/半角/【】、句尾破折号、纯中文、Live/ライブ/伴奏/TV size/feat./Instrumental/纯罗马音、空括号、括号在句中、多括号取最后、空串/null） |
| **`node tools/verify-strip-bilingual.mjs`（新增专项）** | **16/16，runtimeErrors=0** |
| `node tools/verify-ui.mjs --strip-lyrics-only` | **改动前后同为 30/45，失败集合逐条一致（15 条）、runtimeErrors 均为 0** |

### 专项 16 条覆盖

拆分正确性、短句仍单节点、日文句两行且无括号、日文在上中文在下、居中/容纳/两行 clamp 不变、纯中文不拆、（Live）不拆、全曲字号统一、竖卡仍是原文、转场覆盖层保留两行、字形取样覆盖两行、**星尘画布按两行 y 带各统计到亮像素**（两行都真的发射了粒子）、极端长句仍两行省略、回到短句后行节点被丢弃、字号探针量的是拆分形态、无运行时错误。

### 关于既有套件 30/45

这 15 条失败**在改动前的基线上同样失败**（同一套临时副本、同一环境对照跑过），与本次改动无关。根因是套件随「星尘由 DOM 粒子改为 canvas 绘制」那次重写后已过期：

- `--strip-lyrics-only` 会**直接抛异常终止**（`Waiting failed: 500ms exceeded`），因为还在等 `.strip-lyric-dust > .strip-spark` 这种历史 DOM 粒子节点。
- 另有 mask 擦除（`linear-gradient` / `maskPosition`）、`dustAnimation[0].duration`、outline/contrast 计量等断言针对的是被替换掉的旧实现。

对照方式：另存一份 `verify-ui.mjs` / `verify-strip-lyrics.mjs` 临时副本，**只中和这几条已死的等待/取值**（其余断言原样保留），分别在改动前后各跑一次，两次都是 30/45 且失败集合逐条一致。临时副本已删除，未修改生产断言文件 —— 按纪律「不为消除红项改松既有断言」，这批过期断言的修订建议单独开一轮。

## 部署

1. `node tools/bump-build.mjs` → 1003131770
2. `ui/` 整包同步到 `~/.hanako/apps/hanako-simple-player/`
3. `extension_manager reload app:hanako-simple-player`

## 剩余风险 / 待验

- **真机验收**：上述均为无头浏览器验证，真实卡片与真实会话链路仍待 Hana 侧验收。
- **纯假名译文**：括号内是纯假名/纯假名+汉字混合但无汉字（如「（ありがとう）」）会按规则 4 不拆 —— 属有意保守，若罐头希望这类也拆，放宽规则 4 即可。
- **括号在句中**：如「風（かぜ）が吹く」这种振假名括号不在句尾，不拆（规则 2），保持原样。
- **极窄条（312px）+ 长双语**：两行各自然折行时仍受 clamp=2 限制，第二行省略；专项已覆盖「极端长句仍两行省略」，但真实日语长句 + 窄条的组合建议真机再看一眼。
- 本轮未跑全量回归（`verify-ui.mjs` / `verify-backend.mjs`），按 AGENTS.md §8 属普通功能更新，只跑基础检查 + 歌词专项。

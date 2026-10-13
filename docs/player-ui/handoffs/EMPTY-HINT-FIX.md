# 空列表引导语指错了地方（EMPTY-HINT-FIX）

2026-10-11。罐头反馈：没有任何曲目时，界面上的提示词不对，应该是「点击下方的播放列表里面的 + 号添加」。

改动落在 `ui/app.js`（+ `tools/verify-ui.mjs` 两条断言）。构建号 1003131622 → 待 bump。

---

## 1. 根因

空列表时舞台副标题写的是 **「用右上角的 ＋ 导入」**（`ui/app.js` `renderTrack()` 的 `!t` 分支）。

「右上角」是 **2026-10-08 极简版接线时** 的位置。之后两轮重排把 `＋` 挪走了：

- 控制条重排（2026-10-10，「搜索/队列两端对称 + 歌名回控制条」）：队列入口收成纯图标进底栏最右端。
- 队列结构：`#importBtn`（那颗 `＋`）住在 **队列面板头部** `.queue-head` 里 —— 从来就不是右上角。

而队列面板在三种布局里位置完全不同，所以这句话在**任何**布局下都是错的：

| 布局 | 判据 | 队列在哪 | ＋ 实际位置 |
|---|---|---|---|
| 长卡（465×930） | `data-layout="long"` | 舞台**下方**，常驻 | 下方面板头部的 `＋`，直接可见 |
| 窄卡（312×494） | `data-layout="compact"` | **独立一页** | 先点底栏右下角队列键翻过去，面板头部才有 `＋` |
| 独立窗（1040×780） | `data-layout="wide"` | **右侧抽屉**，默认 `data-drawer="0"` 收起 | 先点底栏右下角队列键展开抽屉，头部才有 `＋` |

罐头看到的正是**独立窗**（截图顶部是「音频播放器」窗口标题栏 + 关闭键）。那种情况下照原话去「右上角」找，什么也找不到。

## 2. 做法

新增 `emptyImportHint()`（`ui/app.js`，紧邻 `renderTrack`）：

```js
function emptyImportHint() {
  if (player.getAttribute('data-layout') === 'long') return '点下方播放列表里的 ＋ 添加';
  return '点右下角队列里的 ＋ 添加';
}
```

- 长卡：队列就在下方常驻，「下方播放列表里的 ＋」一字不差 —— 即罐头给的说法。
- 窄卡 / 独立窗：队列得先召出（底栏最右那颗纯图标队列键），所以是「右下角队列里的 ＋」。
  两档就够了，不必再拆（窄卡与独立窗的差异只是「翻页」还是「抽屉」，对用户都是「点右下角队列」）。
- 仍走 `setArtistLine(text, false)`：空列表时这行只是引导语，不可点、隐去搜索字形（该口径不变，
  `artist-line-inert-without-artist` 断言照旧）。

配套 `refreshEmptyHint()`，在 `applyLayout()` 的 `formChanged` 分支里 `renderChrome()` 之后调：

```js
function refreshEmptyHint() {
  if (currentTrack()) return;          // 只在空列表时管这行
  setArtistLine(emptyImportHint(), false);
}
```

理由：宿主给的是**可变尺寸**的 iframe/窗口，`ResizeObserver` 一抖布局就可能换档（长卡 ↔ 窄卡 ↔ 独立窗），
`＋` 的方位跟着变。不重写的话，用户从独立窗拖回卡片，看到的还是那句话里的「右下角」。

## 3. 验收

新增 `fixtureMode === 'empty'`（假后端返回 0 首曲目）+ 断言：

- `empty-hint-names-the-right-place`：三种布局（长卡 / 窄卡 / 独立窗）各自的引导语必须**逐字**等于
  该布局的说法，且标题仍是「还没有曲目」、那行仍 `disabled`（不可点的引导语，不是入口）。
- `empty-hint-follows-layout-change`：同一页从宽窗（1040×780）缩到长卡（465×930）后，
  引导语必须换成长卡那版。

```bash
node tools/verify-ui.mjs     # 断言总数 114 → 116
```

截图：`/tmp/hap-verify/empty-hint-{long-465x930,compact-312x494,wide-1040x780}-light.png`。

## 4. 部署

```bash
cp ui/{index.html,standalone.html,style.css,app.js,_build.json} ~/.hanako/apps/hanako-audio-player/ui/
node tools/bump-build.mjs
# extension_manager reload app:hanako-audio-player
```

无 manifest 扩权，不触发重新审批。

# Hana 独立复核：封面补全第一轮返修

日期：2026-10-20；复核对象：码农交付构建 `1003131781`，版本 `1.2.2`。
结论：**暂不部署，需修复以下 3 类实际复现问题。**

## 已独立复跑通过

使用现有 HanaAgent 内置 Node，不下载依赖：

```sh
ELECTRON_RUN_AS_NODE=1 /Applications/HanaAgent.app/Contents/MacOS/HanaAgent tools/verify-cover-catalog.mjs
OUT_DIR=$PWD/docs/player-ui/handoffs/cover-fill-safe-20261020-hana ELECTRON_RUN_AS_NODE=1 /Applications/HanaAgent.app/Contents/MacOS/HanaAgent tools/verify-ui.mjs --covers-only
```

实际结果：元数据 **12/12**；封面 **87/87**，`failed: []`、`runtimeErrors: []`；命令 exit 0。`git diff --check` 通过。

这些通过项没有覆盖下面的混合包装与不完整候选证据，不能由 87/87 推断它们正确。

## R1：版本与音质混在同一标签中时被整段删除，错误接受原版（阻断部署）

位置：`cleanCoverQuery` 开头，先清除包含无损/高清等词的整个 `【…】`，之后才提取版本。

测试字典只有周杰伦原版《稻香》，无任何 Live/翻唱版本：

- `周杰伦-稻香【Live高清】` → `pickCoverMatch` 返回原版（错误）。
- `周杰伦-稻香【现场高清】` → 返回原版（错误）。
- `周杰伦-稻香【翻唱无损】` → 返回原版（错误）。

要求：装饰词与版本混合时必须保留版本身份，不可先抹掉整段；正确版本候选仍应可以命中，不能为修这条就一律拒绝所有带标签曲目。未知/真实标题信息继续保留。

## R2：只要一个候选专辑读取失败，就可能把剩余结果错误认成唯一（阻断部署）

位置：`coverResolve` 读取候选专辑 catch 后记录 error 但继续聚合，最后只用成功读取的 hits 调 `chooseCoverHit`。

精确复现：

1. `artist 周杰伦` 成功；歌名反向歌手查询 404。
2. `search 稻香 + 周杰伦` 返回两条歌名/歌手一致，但 songId=1/2、albumId=1/2 的候选。
3. 专辑 1 返回候选 1 原版，专辑 2 抛出 status=503 的超时错误。
4. 当前 `coverResolve('周杰伦-稻香', '', lookup)` 仍返回候选 1 成功，并丢弃这个有必要披露的候选证据缺口。

这与自身「不同 songId 正式录音不唯一则不自动选」的规则矛盾。不能用网络失败把歧义洗成唯一。

要求：如果尚未读取的候选可能改变身份/版本/唯一性判断，该曲必须保留原图，作为失败或未补项；其他可靠曲目仍继续，不回到「一首失败拖整批」。如果失败项经已取得证据可确认不影响决策，可以有证据地放行，而非全局一刀切。

## R3：普通圆括号音质标签漏清，产生不必要的漏配

同一原版字典：

- `周杰伦 - 稻香` → 命中（对照）。
- `004.周杰伦-稻香` → 命中（对照）。
- `周杰伦 - 稻香【无损音质】` → 命中（对照）。
- `周杰伦 - 稻香（无损音质）` → 未命中，内部 song 保留 `稻香(无损音质)`（错误漏配）。
- `稻香（HQ）` 配合已确认周杰伦 → 未命中（错误漏配）。
- `周杰伦 - 稻香 (Live)` 在字典仅含原版时 → 不命中（正确负例，不可改坏）。

要求：只对明确音质/画质等白名单装饰支持常见括号形态；不要重新无差别去掉所有圆括号，真正包含括号的歌名要保持精确身份，版本也不能剥丢。

## 复现方法

上述直接执行当前生产函数文本，没有重写匹配逻辑。Node 中从 `ui/app.js` 提取 `coverKey` 至 `coverTargets` 之前的纯函数；R2 另提取 `coverResolve` 至 `guessCoverArtist` 之前，通过 `new Function` 返回 `pickCoverMatch / coverResolve`。无浏览器、无联网、无真实用户数据修改。

测试用 artist：`{id:6452,name:'周杰伦'}`；基准 track：

```js
{
  songId: 1, title: '稻香', artists: [{id: 6452, name: '周杰伦'}],
  albumId: 1, album: '魔杰座', subType: '录音室版',
  pic: 'https://p1.music.126.net/fixture.jpg'
}
```

R2 lookup stub：artist(name==='周杰伦') 返回 artist，其余 404；search 返回 `[track, {...track,songId:2,albumId:2}]`；album(1) 返回 `{tracks:[track]}`；album(2) 抛出 `Error('other candidate album timed out')` 并设 `status=503`。

实际输出节选：

```json
{"title":"周杰伦-稻香【Live高清】","incorrectOriginalAccepted":true}
{"title":"周杰伦-稻香【现场高清】","incorrectOriginalAccepted":true}
{"title":"周杰伦-稻香【翻唱无损】","incorrectOriginalAccepted":true}
{"case":"unread-competing-candidate","acceptedDespiteIncompleteEvidence":true}
```

## 返修与复验边界

请在同一执行会话接续修复 3 项，加入少量对应正/负例后跑受影响封面专项和基础检查，不跑全量。不要放松版本/歌手/短歌名严格度，不新增候选管理 UI，不改无关功能。更新技术交接与原始输出，构建按 AGENTS bump；源码/运行时仍未部署。修复完成直接回本统筹，待 Hana 独立复验。

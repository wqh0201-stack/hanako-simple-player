# 音源：改回内置 + 首次 cookie 提示（SOURCES-BUILTIN）

2026-10-11。前情：一度把 Meting 节点抽成外置 `sources.json` + apply 脚本（见本文档历史版本），
理由是"灰色资源不该进公开仓库"。

**后修正（罐头拍板）**：那 4 个节点地址**在上游仓库 `openhanako-labs/openhanako-audio-player`
里本就是公开的**（其 `master` 的 `lib/meting.js` / `manifest.json` 就列着，我们的 fork `master`
与上游 SHA 完全一致）。判据由此校准为：

> **只保证自己不加新的；公开可获取的东西没问题。** 既然上游本就公开、我们只是继承，
> 写回插件合规。而且写回后**装完即用**（白名单是静态表，内置后一批准就能用，无需 apply 脚本）。

## 最终状态

| 项 | 结果 |
|---|---|
| `lib/meting.js` | 节点写回 `NODES` 数组（不再从配置读） |
| `manifest.json` | 4 个节点主机写回 `allowedHosts` |
| 外置那套 | **已删**：`lib/sources.js` / `sources.example.json` / `tools/apply-sources.mjs` / `.gitignore` 那条 / 搜索页导入入口与提示条 |
| 新增 | **首次使用 cookie 提示**（见下） |
| 保留 | `normalizeTrack` 的 `name/artist` 别名修复（那轮唯一真正有价值的改动） |

## 首次 cookie 提示

一次性的轻浮层（`#firstRun`，`.first-run` / `.fr-card`）：

- **文案**：「想听到完整音源？」＋「不填也能用，部分歌会是试听版。在 `cookies.env` 里填一次
  登录 cookie，就能解锁完整音频。」＋「怎么填：问你的 Hana，或看仓库 README 的『可选：完整音源』。」
- **怎么填不写在卡片里** —— 交给用户去问自己的 Hana（README 也补了这句）。
- **只弹一次的判据卡得紧**：只有「存储确实读过且读到空」才弹。存储不可用
  （纯浏览器 / 宿主未就绪 / 截图模式）时读不到 → 不弹。否则每次启动都弹，那是骚扰。
- 断言：`first-run-notice-shows-once`（未读过→弹 / 读过→不弹 / 读不到→不弹）。

## 验收

- `node tools/verify-backend.mjs` **10/10**
- `node tools/verify-ui.mjs`（新增 `first-run-notice-shows-once`；搜源那 3 条已随外置一并撤）

## 7.6 修 flaky：段落间夹具没隔离（2026-10-11，隔壁会话报告）

**症状**：`artist-line-inert-without-artist` 偶发失败 —— 期待夹具曲目「无歌手」，
却读到上一段落 2c 的「点播歌手」（首跑命中，重跑就没）。

**根因**（已坐实）：`page.close()` / 换页会触发页面内 `pagehide`，旧页面用
`sendBeacon` / `keepalive fetch` **异步** 投递一个 playback-state 快照；投递可能**晚于下一段落的
`__fixture/reset`** 到达，于是下一段落一进页读到的不是空列表，而是上一段落的当前曲目。
探针实测：`page.close()` 确实发出 beacon（`/beacon-pagehide` + `/fetch-keepalive`）。

**修法**（确定性，不用 sleep 调概率）：`newPage()` 默认拦掉**卸载专用通道**——
覆盖 `navigator.sendBeacon` + 拦带 `keepalive` 的 `fetch`。这两条正是卸载落盘专用的；
常规落盘走无 keepalive 的 fetch，不受影响。第 7 段（专测「卸载落盘→续播」）
传 `newPage({ teardown: true })` 关闭拦截。

**验证**：连跑 3 次 119/119 全绿（修复前同一份代码首跑会命中）。

外置的防护收益被高估了：地址在上游开源仓本就公开，我们重写只影响自己的 fork，
而代价是**每个装的人都得多跑一次脚本 + reload + 批审核卡**。回内置换回开箱即用，
更贴"后面的人下了方便使用"这个目标。

# 统一整理 Phase A：后端闸门/索引/缓存接续（2026-10-20）

状态：**Phase A 后端机制部分完成，尚有未验项；不是最终完整包，未部署。**
生产仍为 `1003131785`；源码构建 `1003131790`，版本 `1.2.2`。未改生产 cache/歌单/cookies，未提交/推送，未碰 `OH-Works/`。

## 已完成

- `lib/netease-gate.js` 重写：
  - `schedule(signal)` 串行排队；真实起始间隔 `minInterval` 默认 2000ms；信号取消会清理等待，不迟到补发。
  - `cool(code, stage)` 默认 60s；冷却期间新请求立即以 `CooldownError` 返回（含 `code/stage/retryAfterMs`），排队中的任务被立即拒绝，不会 60s 后补发。
  - 错误保留 `cooldown/code/stage/retryAfterMs`；`state()` 暴露剩余冷却。
- `lib/catalog-index.js`：
  - `listAlbums` 保存 `nextOffset`，`more=true` 时每次 `build` 继续向后取一页，不再永久停在前两页；分页进度每页原子落盘。
  - `build` 每张成功专辑立即 `saveNow()`；405/429 立即停止本批并抛出带 `stage/albumId/retryAfterMs` 的错误，不继续打后续专辑。
  - `artist` 先查持久关系（30 天），命中不依赖 400 条通用请求缓存。
  - `cover` 有同 key single-flight；源图 hash 变更新文件；只接受 `image/jpeg|png|webp`，sidecar 保存 Content-Type；自身目录有文件数/总字节上限并只清理自身缓存；缺 `meta.pic` 时回退到曲目 pic。
  - `lyric` 有同 songId single-flight；空白/占位/`lyric fetch failed` 不当成功，标 `noLyric`；网络错误标 `stage:'lyric'`。
- `lib/cover-catalog.js` 请求经共享闸门；405/429 记录冷却并携带 `retryAfterMs`。
- `lib/register-routes.js` 新增 `/api/catalog/artist|build|index|cover|lyric`；`fail()` 输出 `stage/code/retryAfterMs/cooldown/noLyric` 结构化字段。

## 已执行证据

| 检查 | 结果 |
|---|---|
| `node tools/verify-phase-a.mjs` | `PHASE_A_GATE_INDEX_OK`：默认 2000ms 起始间隔、60s 冷却、取消等待、分页 `more` 续取、每张专辑请求计数、封面并发 single-flight、重建实例后 0 次重下 |
| `node tools/verify-cover-catalog.mjs` | 13/13（查询语义测试注入 0 间隔闸门；**不是生产 2s 时序证明**） |
| `node tools/verify-cover-match.mjs` | 29/29（上一轮回归） |
| 基础 | 语法通过；构建 `1003131790` 三处一致；`git diff --check` 通过 |
| 原始日志 | `docs/player-ui/handoffs/playlist-catalog-enrich-20261020/phase-a.log`、`phase-a-basic.log` |

## F1–F4 修复结果（1003131790）

- **F1**：`schedule()` 现在把实际 `run()` 接到 `tail` 后再执行；3 个并发在注入时钟下实际开始为 `0 / 2000 / 4000`。取消第二个等待返回 AbortError，冷却排队项立即 `CooldownError`，不迟到补发。
- **F2**：`fetchText` 接受共享 gate，`getLyric` 每个 Meting 节点回退前都 `await gate.schedule()`；隔离测试首次 503、次次有效 LRC → **2 次 fetch / 2 次 schedule**。
- **F3**：`catalogIndex.lyric('abc456def')` 严格返回 400，不抽数字、0 外发、0 写缓存；`build` 的 artistId 同样校验。
- **F4**：歌词响应以 `{` 开头按 JSON 解析；`{"code":405}` 触发全局冷却并抛结构化错误，`HTML/占位/空` 均不落成功缓存；测试确认 `789.lrc` 不存在。
- 新断言：`tools/verify-phase-a-fixes.mjs` → `PHASE_A_FIXES_OK`；日志 `playlist-catalog-enrich-20261020/phase-a-fixes.log`。
- A4 错误路径：HTTP 429 首节点立即冷却、不再打第二节点（1 fetch/1 cool）；gate CooldownError 原样外传（0 fetch）；取图 HTTP 405 进冷却并保留 `stage:'cover'`/`retryAfterMs`。对应 `PHASE_A_A4_ERRORS_OK`。

## A4 路由/容量集成（1003131790）

- `tools/verify-phase-a-routes.mjs` → `PHASE_A_ROUTES_CAP_OK`：捕获 `registerRoutes` handler，验证 artist/build/index 成功、cover 首次假网络取 PNG 且二次 0 外发、字节与 `Content-Type: image/png` 一致、lyric 缓存文本、非法 artistId/albumId/songId 400 且 0 外发、坏 JSON 歌词 HTTP 405 结构化（code/stage/cooldown/retryAfter）且不落盘。
- 容量测试：256 个自身严格命名旧图 + 配套 meta，另放 `notes.txt`、匹配命名的目录、符号链接；下载 1 张新图后自身最旧图片/meta 被淘汰、总数 256，无关文件/目录/链接保留；`pruneCovers` 只 `lstat.isFile()` 的严格命名文件。
- 日志：`playlist-catalog-enrich-20261020/phase-a-routes.log`、`phase-a-routes-basic.log`。

Phase A 后端可验收；B/C 仍为后续原任务，不是最终包。



2. **歌词 single-flight/无词/网络错误没有实际测试**；`getLyric` 内部 Meting 节点回退是否逐次过闸仍未证明，目前只在 `catalog-index.lyric()` 外层调度一次。
3. **405 立即停本批只有代码路径，没有测试**；`build` 的部分落盘/剩余计数未用注入拒绝验证。
5. **分页只续到第 3 页，未测完整 `more=false` 和中断后继续的请求计数**；`build` 的 `pending/done` 在错误批次下仍需核算。
6. 未做新后端真实只读小请求；没有 405/429 实测。未跑全量/无关 UI 套件。
7. 前端 B/C（loadLyrics 接入、整理 UI 端到端、Taylor 100/双样本）仍未完成；本阶段不能作为最终包。

## Hana 复跑

```bash
cd /Volumes/SSD/hanadesk/hanako-audio-player-simple
export ELECTRON_RUN_AS_NODE=1
NODE=/Applications/HanaAgent.app/Contents/MacOS/HanaAgent
$NODE tools/verify-phase-a.mjs
$NODE tools/verify-cover-catalog.mjs
$NODE tools/verify-cover-match.mjs
```

`verify-phase-a.mjs` 使用隔离临时目录和注入时钟；不访问生产 cache/歌单，不发真实上游请求。

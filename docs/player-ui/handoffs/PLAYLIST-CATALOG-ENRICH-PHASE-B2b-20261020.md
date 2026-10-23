# 统一整理 Phase B2b（第一段）：调度、冷却、保护停止（2026-10-20）

状态：**B2b 第一段调度已完成，独立时序脚本 10/10 通过。** 构建 `1003131795`，版本 `1.2.2`。未部署、未改生产 playlist/cache/cookies，未提交/推送，未碰 `OH-Works/`。

## 已改

统一整理稳定段新增：

- `enrichWait(job, ms)`：可取消普通 timer；手动停止立即 reject，清理 timer/listener。
- `enrichJobAwait(job, promise)`：前端 abortable race；下层未取消也不会在停止后应用迟到结果。
- `enrichRequest(job, stage, request)`：所有 artist/build/index/cover/lyric 共用；识别 HTTP/business 405/429、`cooldown:true`、`retryAfterMs`，保留 `code/stage/retryAfterMs`；405 只记录为拒绝，不宣称频率根因。
- 同一作业只允许一次冷却恢复：首次按 `retryAfterMs`（缺省 60000）等待并只重试该操作一次；第二次拒绝立即 `protectedStop`，不重置每首重试计数。
- `enrichCall`：非冷却业务/HTTP 错误计入 `requestErrors`、`failedStages`、`failedCodes`，不再吞成“未匹配”；冷却保护停止单独抛出。
- 所有 API 调用传入可选 `signal`：`apiGetJson(url, signal)`、`apiPostJson(url,data,signal)`、`apiText(url,signal)`；未改官方宿主接口，未发明 `ctx.network.fetch.signal`。
- 取图先 `enrichCoverPreflight` 对本地 catalogCover 做 fetch 状态/结构化错误检查并消费响应体，再 `probeCoverImage`；405/429 走同一冷却逻辑。
- `startEnrich` 作业状态：`stage`、`cooldownUsed`、`protectedStop`、`requestErrors`、`failedStages`、`failedCodes`、`noLyric`、`unmatched`、`processed`、`unprocessed`。
- 面板进度：建库 / 匹配 / 补图 / 歌词分阶段文案；汇总标准信息、封面、歌词、无词、未匹配、未处理、实际请求异常（阶段/code）。
- 保护停止：若已有标准信息/封面/歌词成果，先 `enrichTxCanCommit` 再部分保存；无成果不保存；未完成歌词不伪造绑定；文案明确“已保护停止”，不显示全部完成。
- 手动停止/目标冲突仍完整回滚、不暗中保存；AbortError 优先于保护停止，避免用户取消被当成自动保护提交。
- `failed` 真实计数不再只保留 `lastError`。

## 验证

`tools/verify-catalog-scheduling-hana.mjs`：**10/10 PASS**（生产控制器 + 虚拟时钟，无真实网络/60 秒等待）：

1. 首次拒绝显示真实 stage/code、等待时长、仅一次恢复/可停止；59999ms 不外发，60000ms 只重试一次并清理 timer；
2. 二次拒绝保护停止、无空保存、无下一首失败；
3. 歌词重复拒绝只保存已验证标准信息/封面，不伪造歌词绑定；
4. 冷却预算跨阶段共享，不被歌词重置；
5. 冷却等待中手动停止：0 保存、清理 timer、不释放迟到请求；
6. 不合作 API 等待中手动停止即时退出，迟到结果不写状态；
7. 领域 `noLyric:true` 的 404 计无词 1、请求异常 0，且不绑定空歌词；
8. 普通 404/502 仍计请求异常并保留阶段/code，不误判无词；
9. 取图 HTTP 405 保护在 probe/apply 前；
10. 公共 API 包装可选 signal 兼容旧调用。

日志：`docs/player-ui/handoffs/playlist-catalog-enrich-20261020/phase-b2b-scheduling.log`

## 基础自检

- `node --check ui/app.js` 通过；
- 构建 `1003131795` 三处一致；
- 孪生 HTML 仅 `data-shell` 差异；
- `git diff --check` 通过；
- 既有事务控制器 `tools/verify-catalog-transaction-hana.mjs` 复跑 **10/10 PASS**。

日志：`docs/player-ui/handoffs/playlist-catalog-enrich-20261020/phase-b2b-basic.log`

## 未验 / 边界

- 未做单曲新菜单、大目录匹配、TTL、B2b 后续段。
- 后端已开始的缓存/在途请求可能仍继续；前端 race 只保证不写入迟到状态，不宣称后端全部取消。
- 未跑旧全量/旧 29/87；未部署、未提交推送、未碰生产数据与 `OH-Works/`。

# AUDIO-OWNER-ACCEPT-1.1.1 · 独立验收（哦鲸鲸）

> 验收方：哦鲸鲸。实现与自验：Codex。日期：2026-10-13。
> 范围：独立复跑三项验证 → 整包同步运行时 → reload → 真机验收。
> 原始证据：`docs/player-ui/handoffs/audio-owner-1.1.1/acceptance-20261013-hana/`。
> 关联：实现交接 `AUDIO-OWNER-DONE.md`；返修复现 `AUDIO-OWNER-ORPHAN-REPAIR.md`；宿主信号探查 `AUDIO-OWNER-ORPHAN-HOST.md`。

---

## 0. 结论

**未通过（阻塞）。**

版本 **1.1.1 / build 1003131679** 的三项自动验证在独立环境**全部复跑通过**（专项有 1 次 flaky，见 §1），但**真机验收发现阻塞级缺陷**：

> **宿主重启 / 强制 reload 后，播放器永久卡死。** 所有实例（**含单实例**）停在「接管播放」，点播放、上一曲、下一曲全部无效；再 reload 无效；**没有任何 UI 入口能恢复**。

这是「显式交接、丢失时保守待命」在**宿主重启**这条路径上的死锁：旧实例被进程杀掉、来不及 `handoff`，owner 记录成孤儿，而实现里没有清理非自己 own 的 owner 记录的出口。已由 Codex 用 CDP `Page.crash` 独立复现（`AUDIO-OWNER-ORPHAN-REPAIR.md`）。**本次验收结论为「实现有致命缺陷、自验通过不代表真机可用」，不把 Codex 自验 20/20 当作真机通过。**

---

## 1. 自动验证独立复跑

原始输出另存 `acceptance-20261013-hana/`（与 Codex 日志分离）。

| 命令 | 独立结果 | 与 Codex 自验 |
|---|---|---|
| `node tools/verify-backend.mjs` | **114/114，exit 0，`failed: []`** | 一致 |
| `node tools/verify-ui.mjs` | **376/376，exit 0**；selfCheck 12/12、narrow 4/4；`failedCases: []`、`failedAssertions: []`、`runtimeErrors: []` | 一致 |
| `node tools/verify-audio-owner.mjs` | **首次：4 条里 1 条通过后卡住（exit 1）**；重跑 **4 次均 20/20，exit 0** | **不一致：首次 flaky** |

**flaky 详情（原始证据保留）**：首次运行时 `simultaneous-boot-one-voice-false` 通过后，`takeover-pauses-preserves-progress-false` 的 `playing(standby)` 8s 超时（`TimeoutError`）。诊断显示**两个实例都 `paused=true`、`takeover=true`**，owner 记录停在 `revision 3 / generation 3`。之后 4 次重跑均 20/20 全过。

- 判定：属**并发 boot + 立即接管**这个最紧时序窗口的 flaky，**不是断言写错、不是既有断言被放松**（376/376 名称与顺序未变）。
- 但它提示：**并发 boot 的接管路径存在时序脆弱性**，值得 Codex 一并加固（不改变「不能靠超时强播」的结论）。

---

## 2. 同步与部署（本次有后端变更）

- **备份**：`~/.hanako/apps/hanako-simple-player.bak-20261013-171805-pre111`（整目录）。
- **整包同步**（不覆盖 app-data）：`lib/`（含新增 `lib/audio-owner.js`、`lib/register-routes.js`）、**整个 `ui/`**（CSS/SDK/`_build.json`/两个 HTML）、`manifest.json`、`package.json`、`index.js`。`diff -rq` 核对 `ui/` 逐文件一致，`lib/audio-owner.js`、`lib/register-routes.js` 一致。
- **核对**：安装目录 `manifest.json` = 1.1.1，`ui/_build.json` = 1003131679。
- **reload**：`extension_manager reload app:hanako-simple-player` → `Reloaded app:hanako-simple-player from its current on-disk code.`
- **未碰**：`~/.hanako/app-data/hanako-simple-player/`（playback/playlist/storage 均未动）。

---

## 3. 真机验收：死锁（阻塞项）

### 3.1 现象（真机，逐步）

1. 播放器卡片 + 一个独立窗口同时开着，宿主重启后 → **两边都显示「接管播放」**。
2. 点播放、点**上一曲 / 下一曲** → 全部无效（整条起播路径被锁死）。
3. **只保留一个实例**（关掉其余、只留一个窗口）→ 仍卡，「接管播放」常驻。
4. 再 reload → 无效。
5. 手动清 `app-data` 里的 owner 记录后，**宿主退出时又把内存里的旧记录写回文件**，重启后又卡。

### 3.2 原始证据

`~/.hanako/app-data/hanako-simple-player/storage/global.json` → `player-audio-owner`：

```json
{
  "ownerId": "mv6gxf6vlbltk6",
  "claimId": "mv6gxf6vlbltk6-4",
  "at": 1791883850574,
  "revision": 33,
  "generation": 9,
  "pending": { "ownerId": "mv6hdkq5qdhr88", "claimId": "mv6hdkq5qdhr88-2", "fromGeneration": 9 },
  "resume": false
}
```

- `mv6gxf6vlbltk6` 是**重启前**的旧 owner，重启时其 document 被直接销毁、**没机会 handoff** → 记录成孤儿。
- 新实例 `mv6hdkq5qdhr88` 的 claim 变成 `pending`，永远等旧 owner yield；旧 owner 已死，永不回应 → 死锁。
- **单实例也一样**：新实例 boot 的 `restore` claim 被 `if (input.reason === 'restore' && (record.ownerId || record.pending) && record.ownerId !== input.ownerId) return result(...)` 挡住，直接进 `needsTakeover` → 所有 `requestPlay` 返回 false。

### 3.3 恢复

改文件清记录**无效**——宿主把该记录缓存在内存，且**退出时把内存写回文件**覆盖外部修改。只能「完全退出 Hana → 清文件 → 再启动」。**普通用户无法自助恢复**，这是本缺陷比原「两个一起响」严重得多的原因。

### 3.4 根因（与 Codex 一致）

「保守待命」缺少**确认死亡后的自愈出口**：实现里 `stop` / `release` / `handoff` 都要求 `owns(record, input)`，**没有任何动作能清掉一个非自己 own 的 owner 记录**。孤儿一旦产生，全链路永久锁死。

---

## 4. 未验项（照实标注，未取得通过证据）

被死锁阻断，以下**未取得通过证据**，不计入通过：

- 多实例 reload 唯一出声、卡片↔独立窗协调。
- 抢麦（B 让 A 静音）、进度保留、chip 夺回、主动全停。
- 单实例续播 / 连播 / 切歌 / 实际 reload / 拖进拖出。
- **Q1** 真实卡片↔独立窗分区互通：未单独测。
- **Q2** `onChanged` 逐样本时延 / 自写 / 同值 / 重复乱序：未测（生产宿主凭证链未打通）。

---

## 5. 建议

1. **阻塞项交 Codex 返修**，按 `AUDIO-OWNER-ORPHAN-REPAIR.md` §5 的恢复协议：**有权威「文档已结束」证明才自愈，无证明仍待命**；不放宽唯一出声。
2. **该修复的前置是宿主公开接口**：见 `AUDIO-OWNER-ORPHAN-HOST.md` —— 公开面没有宿主启动代、也没有「旧文档已结束」的证明；需要宿主给「媒体文档身份 + `active/ended/unknown`」，或「旧代所有 UI 终止的栅栏」。这需要**用户授权扩展到 Hana 宿主正式接口**。
3. 修好后，由本验收方重跑：§1 三项 + §3/§4 全部真机项，并补 Q1/Q2。
4. 顺带加固：§1 的并发 boot 接管 flaky。

**当前状态：1.1.1 待返修，不发布、不视为通过。** 源码由 Codex 处理，不启动第二个 Codex。

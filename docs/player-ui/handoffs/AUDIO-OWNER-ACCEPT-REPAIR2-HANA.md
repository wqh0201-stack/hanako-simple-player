# AUDIO-OWNER-ACCEPT-REPAIR2-HANA · 独立验收（哦鲸鲸）

> 验收方：哦鲸鲸。实现与自验：Codex（`AUDIO-OWNER-ORPHAN-REPAIR2.md`）。日期：2026-10-13。
> 范围：独立复跑三条验证 → 整包同步 + reload → 真机复验（含退出宿主步骤，由用户配合）。
> 证据目录：`docs/player-ui/handoffs/audio-owner-1.1.1/acceptance-20261013-hana-r2/`。
> 部署态：**1.1.1 / build 1003131680**。未改 app-data 的 owner 记录（只在用户授权下观测）。未发布。

---

## 0. 结论

**核心阻塞项（宿主重启后孤儿死锁）真机复验通过；两条收尾项未覆盖。**

| 项 | 结果 |
|---|---|
| 独立复跑 `verify-backend` / `verify-ui` / `verify-audio-owner` | **119/119 · 376/376 · 34/34，exit 0**（§1） |
| 整包同步 `ui/`+`lib/` 与 reload、构建号核对 | **通过**（§2） |
| 真机：单实例播放/暂停/续播 | **通过**（§3.1） |
| 真机：**宿主 Cmd+Q 重启 → 无 handoff 自动清孤儿并续播** | **通过**（§3.2，本次核心） |
| 真机：多实例接管 / 夺回 / 主动全停 | **通过**（§3.3） |
| 真机：播放中 reload（老「全员复活」） | **通过**（§3.3） |
| 真机：不清 owner 连续退出/重启 ×2 | **未覆盖**（§4） |
| 真机：单实例回归（自动下一首 / 切歌 / 拖进拖出） | **未覆盖**（§4） |

---

## 1. 独立复跑（我这边跑，不看 Codex 结论）

快照：`start-snapshot.txt`（开工时 12 个文件的 SHA256）。原始输出：`hana-backend.txt` / `hana-ui.txt` / `hana-owner.txt`。

| 命令 | 结果 |
|---|---|
| `node tools/verify-backend.mjs` | `{"passed":119,"total":119,"failed":[]}`，exit 0 |
| `OUT_DIR=/tmp/hap-r2-ui node tools/verify-ui.mjs` | `assertions 376/376`、selfCheck 12/12、narrow 4/4、`failedCases:[]`、`failedAssertions:[]`、`runtimeErrors:[]`，exit 0 |
| `OUT_DIR=/tmp/hap-r2-owner node tools/verify-audio-owner.mjs` | `{"passed":34,"total":34,"failed":[]}`，exit 0 |

与 Codex 交接一致（119/376/34）。UI 的 `reqfail` 条目是夹具里 `fake-ticket` 被拒的既有噪声，不在 `failedCases` 内。

## 2. 部署核对

- 备份安装目录：`~/.hanako/apps/hanako-simple-player.bak-20261013-191744-pre-repair2`（整目录拷贝，可回退）。
- 整包同步：`ui/`（app.js / index.html / standalone.html / _build.json / style.css / sdk.js）+ `lib/`（audio-owner.js / register-routes.js）+ 根文件（manifest/package/index）。
- 逐文件核对：`diff -rq ui <install>/ui` 与 `diff -rq lib <install>/lib` 均无差异。
- 孪生 HTML：`index.html` 与 `standalone.html` 去掉 `data-shell` 后**逐字节相同**。
- 构建号三处一致：`_build.json` / `index.html` / `standalone.html` = **1003131680**；`manifest.json` = **1.1.1**。
- reload：`Reloaded app:hanako-simple-player from its current on-disk code.`；日志 `[plugin-loader-v2] plugin "hanako-simple-player" v1.1.1 loaded`（19:21）。
- 许可证：AGPL 保持（`LICENSE` 原样）。
- 未动 `app-data`（playback/lists/owner 原样，见 §3 起点）。

## 3. 真机复验：owner 与 paused 时间轴

采样器：`sample-timeline.mjs`（本目录），400ms 一条，`appendFileSync` 同步落盘、`setsid` 脱离宿主进程组——**宿主被杀/重启期间照样记录**。
原始全量：`timeline/timeline-2026-10-13T11-22-45-079Z.jsonl`（4419 条）；变化点摘要：`timeline-changes.txt`。
起点 `t0 = 2026-10-13T11:22:45Z`（本地 19:22:45）。

### 3.1 单实例（播放 / 暂停 / 续播）

```
+    74.8s  owner=mv6lf4c4pch7 gen=7  cause=-     playing=True  prog=148.9   ← 点播放
+   100.9s  owner=(空)        gen=8  cause=stop  playing=False prog=20.2    ← 主动暂停 → owner 清空
+   113.0s  owner=mv6lf4c4pch7 gen=9  cause=-     playing=True  prog=20.4    ← 再播放，进度接着走
+   114.2s  owner=(空)        gen=10 cause=stop  playing=False prog=21.3    ← 暂停
```

`generation` 单调递增、`pending` 全程为空、**进度保留不归零**。✔

### 3.2 宿主重启 → 孤儿自愈（本次核心）

```
+  1070.0s  owner=mv6lf4c4pch7 gen=11 cause=-     playing=True  prog=21.3   ← 播放着
   （+1073 ~ +1096s：宿主退出+重开窗口，盘上无写入）
+  1096.2s  owner=mv6m121yoj8g gen=13 cause=-     playing=True  prog=23.6   ← 新文档，自动续播
```

- owner 换成**新文档** `mv6m121yoj8gjd`，`generation` **11 → 13（+2）**——先按旧 owner/generation 清点孤儿、再 grant 的路径特征。
- **没有点任何按钮**，`playing` 自动为 true，进度从退出前的 23.6 接着走。
- 这正是 1.1.1 上一轮验收的阻塞项（`AUDIO-OWNER-ACCEPT-1.1.1.md` §3 的永久死锁），**已消除**。✔

### 3.3 多实例接管 / 夺回 / 主动全停 / 播放中 reload

```
+  1448.2s  owner=(空)        gen=16 cause=handoff playing=True  prog=78.2   ← 播放中点 reload（显式交接）
+  1449.0s  owner=mv6m8mdrz8u gen=17 cause=-       playing=True  prog=78.2   ← 新文档接过，进度续上
+  1455.4s  owner=mv6m8q2eow7 gen=19 cause=-       playing=True  prog=81.7   ← 第二窗口起播 → 接管
+  1462.7s  owner=(空)        gen=20 cause=stop    playing=False prog=88.9   ← 主动暂停
+  1478.7s  owner=mv6m998koiy gen=23 cause=-       playing=True  prog=99.7
+  1481.1s  owner=mv6m998koiy gen=23 pending=mv6m9998t1hauw  playing=True   ← 后来者排队
+  1481.5s  owner=mv6m9998t1h gen=25 cause=-       playing=True  prog=99.7   ← 旧实例让位 → 授权新实例
+  1486.8s  owner=(空)        gen=26 cause=stop    playing=False prog=105    ← 主动暂停全停
```

- **`cause:handoff` 后新文档接续**：播放中 reload 走显式交接，**没有「全员复活」**（1.1.0 的老毛病）。✔
- **接管**：owner 从 `mv6m8q2eow7xds` 换到另一文档。✔
- **「后来者自动赢」完整链条**：`pending` 出现 → 旧实例让位 → grant 新实例（`+1481.1s → +1481.5s`）。✔
- **主动暂停**：`cause:stop`、owner 清空、`playing:false`（用户确认「所有实例都停」）。✔

复验末尾还捕到一段（用户现场观察，见 §6.1）：

```
+  2015.5s  owner=mv6mcsk4a5tpvn gen=43 ... playing=True  prog=71.9
+  2023.1s  owner=mv6m9998t1hauw gen=45 ... playing=True  prog=43.4   ← 另一实例抢过出声权
+  2025.9s  owner=mv6m9998t1hauw gen=45 pending=mv6mcsk4a5tpvn ... playing=True
+  2026.3s  owner=mv6mcsk4a5tpvn gen=47 ... playing=True  prog=2.3    ← 前台又夺回
```

这段里 owner 确实在文档间切换、且带有完整的 `pending → 让位 → 授权` 链；但用户同时在后台听到另一个实例在放（§6.1），说明「谁持有头衔」与「用户在看哪个窗口」并不绑定。这是下一个设计层面的问题，不影响本轮的修复结论。
- 全程未出现「两个实例同时 `playing:true`」的区间。

用户口述补充确认：接管后旧实例出现「接管播放」、点一下能夺回；两个窗口都开着时播放中点 reload 也正常。

### 3.4 与 Codex 交接清单逐条对照

| Codex 清单 | 状态 |
|---|---|
| §1 单实例非零进度 → Cmd+Q → 启动，孤儿清点、续播、进度保留 | ✔ §3.2 |
| §2 卡片+独立窗 → 强制结束 Hana → 启动，无 handoff 也恢复 | ✔ §3.2/§3.3（本机以 Cmd+Q 退出复现） |
| §3 另一实例播放 → 旧停新响、chip 夺回；主动暂停全停 | ✔ §3.3 |
| §4 只重建 App 后端、保留旧文档 → 不得自动出声 | 未在本机复现（属专项 #26 覆盖面，本轮未做） |
| §5 直接销毁 owner iframe、不执行卸载 JS → 另一实例恢复 | 未在本机复现（专项 #25 覆盖面） |
| §6 不清 owner 连续重复 ×2 三次 | **未覆盖**（见 §4） |
| §7 单实例连播、切歌、reload/反复拖进拖出回归 | **部分**：reload 已验（§3.3）；连播/切歌/拖进拖出**未覆盖** |
| §8 `__playerDebug.audioOwner()` 的 docLockHeld/docLockSupported | 未读（需在播放器文档内执行；本轮以盘上记录为准） |

## 4. 未覆盖项（照实标注，不计入通过）

> **用户已决定就此收口**（2026-10-13）：核心阻塞项已确认消除，未覆盖项不再补做。

1. **连续退出/重启 ×2**（确认「退出写回不再死锁」）。需要用户在宿主退出/启动的空档配合。
2. **单实例回归**：自动下一首、切歌、拖进拖出（拖成独立窗再拖回）。需要真实点击；工具层合成点击被浏览器 autoplay 策略拦住（本轮已实测：我用 `ui_action` 点在会话里新投的播放卡上，`playBtn` 的合成点击不构成用户手势，`playing` 未变、owner 未动）。
3. **§4 的两条反例本机复现**（只重建后端不自动出声 / 直接销毁 iframe 后恢复）——专项已覆盖，本机未复现。
4. `__playerDebug.audioOwner()` 的 `docLockHeld` / `docLockSupported` 未实读。
5. bfcache/freeze、远程/移动端（非 secure context）仍未覆盖（与 Codex 交接一致）。

## 5. 证据索引（`acceptance-20261013-hana-r2/`）

| 文件 | 内容 |
|---|---|
| `start-snapshot.txt` | 开工时源码/脚本/manifest/build 的 SHA256 |
| `hana-backend.txt` / `hana-ui.txt` / `hana-owner.txt` | 三条验证的原始输出（含 EXIT 与完整 results） |
| `sample-timeline.mjs` | 采样器源码（只读 app-data，同步落盘，脱离宿主进程组） |
| `timeline/*.jsonl` | 全量 owner + playing/progress 样本（4419 条） |
| `timeline-changes.txt` | 变化点摘要（35 条） |
| `sampler.log` | 采样器启动信息 |

## 6. 旁注 / 风险（不改变本次结论）

### 6.1 用户现场诊断：「幽灵声音」的来源（建议单独立项）

用户在本轮复验期间给出的诊断：**别的 agent 在卡片里唤起的播放器，它以为自己控制了播放，其实是在后台放的；前台这个暂停了也没用。**

采样器同期证据支持这条观察：

```
+  2015.5s  owner=mv6mcsk4a5tpvn gen=43 ... playing=True  prog=71.9
+  2023.1s  owner=mv6m9998t1hauw gen=45 ... playing=True  prog=43.4   ← 另一实例抢过出声权
+  2025.9s  owner=mv6m9998t1hauw gen=45 pending=mv6mcsk4a5tpvn ... playing=True
+  2026.3s  owner=mv6mcsk4a5tpvn gen=47 ... playing=True  prog=2.3    ← 前台又夺回
```

另有两处「`cause:stop` 之后同一文档又自己 claim 并恢复出声」的序列（`+1462.7s → +1465.9s → +1466.3s`、`+1518.1s`）；**本轮无法区分那是用户重按还是自动恢复**，不下结论。

初步归因（待查，非结论）：`hana_simple_play` / `hana_simple_create_list` 会在会话里**新投一张播放卡**，那是一份新的 UI 文档、一个新的 owner 竞争者；「当前出声者」是后取者赢的全局头衔，与用户正在看哪个窗口无关。前台按暂停只清掉全局 owner（`cause:stop`），但那张**后台卡片文档没被关掉**，随时可重新 claim。1.1.0 用共享快照 `playing:true` 时，这表现为「reload 全员复活」与「后台文档在响」。

**与 1.1.1 的关系**：本轮修的是孤儿死锁与多实例夺权一致性；「工具投卡造就额外头衔竞争者」是另一个设计层面的问题（工具投卡是否总应重新夺声？后台实例该不该出声？）。**建议单独立项**，不在本任务书范围内，本轮不改。

### 6.2 其余风险

- **信任边界**（Codex 交接已写明，我复核同意）：后端只采信前端的 `reap` 声明，不是密码学保证；generation 目标校验能挡住正常客户端的延迟回包，不挡伪造。本机单用户 App 可接受。
- **退化路径**：无锁 / 抛异常 / SecurityError 时保留原 `pending→yield`，不发送 reap、不借超时放宽。专项 #31–#34 覆盖。
- **宿主拓扑依赖**：本结论只在「卡片与独立窗同 storage bucket」的当前宿主形态下成立（已由 `AUDIO-OWNER-LOCK-CAPABILITY-REPAIR2-HANA.md` 与 `probe-expanded-20261013-hana/08` 证实）。宿主若改为第一方加载或分窗分区，需重新核验。
- **混包风险**：同 host 下所有媒体文档必须用本轮协议；混用旧 UI 会退化。部署必须整包同步 + reload（本次已做到）。

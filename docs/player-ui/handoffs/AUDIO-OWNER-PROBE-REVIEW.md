# AUDIO-OWNER-PROBE-REVIEW · 原始证据复核与方案边界

日期：2026-10-13（Asia/Shanghai）。复核：Codex。依据：`AUDIO-OWNER-HOST-PROBE.md`、Hana 的原始脚本/JSON、当前公开 SDK、独立 Chrome 实验及浏览器标准。唯一实施需求仍是 `docs/TASK-audio-owner-1.1.1.md`；本轮继续只探查，没有改 App 源码、断言、版本或构建号。

## 1. 可以接收的结论

- Hana 的 **系统 Chrome、同源 tab↔tab** 原始 RTT 数据确为 30/30，p50/p95=1ms，max=3ms；它支持 BroadcastChannel 作为任务原定的优先传输通道。
- 卡片↔独立窗口、真实 App iframe 互通、global.onChanged 逐样本时延没有实测。本轮仍记未测，不把普通 Chrome fixture 叫作真实 Hana 卡片。
- 没有 Q2 数值，不能量化声称 BC 比 storage 快一个数量级。
- 同意“旧 owner 已暂停后发确认，新 owner 收到有效确认才 play”的交接方向。
- 认可 B 对 §7 的语义澄清：被接管 A 不得再产生 playing:true；现任 owner B 可以正常持久化 true。这不改变任务书的功能目标。
- 独立 global owner 键 + App 后端串行仲裁仍是当前建议；BC 的快速通知不能替代同时 boot 的唯一授权。

## 2. 创建成功不能证明不透明源互通

Hana 脚本 `broadcast-channel-probe.cjs:78` 只 `new BroadcastChannel` 后立即 close；三个 sandbox 没有收发测试。80 行读取 `location.origin`，但 srcdoc URL 的 origin 字符串不能代表文档实际安全源：同源继承的 srcdoc 也显示 null。

本轮独立实验使用 **Chrome/155.0.8059.40**，同源父页面内两张 iframe，分别测试 srcdoc 和真实本地 HTTP URL。每张发一个 ping，对端收到后回 pong；通路完整时有四条 received。均先等两张文档 ready，再发送，观察窗口 1200ms。

| iframe source | sandbox | 两端构造 | 发出的 ping | received（含 pong） |
| --- | --- | --- | --- | --- |
| srcdoc | 无 | 成功 | 2 | 4 |
| srcdoc | allow-scripts | 成功 | 2 | **0** |
| srcdoc | allow-scripts allow-same-origin | 成功 | 2 | 4 |
| HTTP | 无 | 成功 | 2 | 4 |
| HTTP | allow-scripts | 成功 | 2 | **0** |
| HTTP | allow-scripts allow-same-origin | 成功 | 2 | 4 |

父页面记录了 `MessageEvent.origin`，另保存 iframe 的 locationOrigin/windowOrigin：无 sandbox 的 srcdoc 为 `locationOrigin:null`，但父页面收到的消息 origin 和 windowOrigin 都是 HTTP 父源；allow-scripts 两张 iframe 的文档安全源才为 null。

这提供了直接反例：**能构造、能调用 postMessage，不等于两张不透明源文档互通**。“都序列化为 null”也不能推断它们是同一个安全源。标准按 storage key 的同源关系匹配收件人，且异步投递：[HTML · BroadcastChannel](https://html.spec.whatwg.org/multipage/web-messaging.html#broadcasting-to-other-browsing-contexts)、[Storage · keys](https://storage.spec.whatwg.org/#storage-keys)。

所以维持 BC 优先，但 **storage 兜底不能只在 BC 构造失败时启动**。应保持双通道订阅与去重，覆盖 BC 构造成功但跨窗口/分区不通的情况；实际请求也要能经另一通道完成确认。该实验不证明真实 Hana 的 sandbox 取值或窗口 partition，仍需真机验收补齐。

## 3. lifecycle 是本实例的绘制状态，不是对端死亡证明

`ui/sdk.js:252–264` 明确计算 `active = visible && normalizedMaxFrameRate > 0`；1031–1040 的 getSnapshot/subscribe 只返回当前 SDK 文档的 runtimeSnapshot，没有其他 ownerId 的查询、跨实例成员表或存活证明。

SDK 在 672–712 暂停动画 pump，没有 pause 音频的动作。因此：

- active=false 可以是隐藏/停止绘制，不能推导实例已死亡或媒体已静音。
- 新 owner 不能从自己的 lifecycle.active 得到旧 owner 的状态。
- 即便旧 owner 最后一次上报 inactive，那也是历史观察，不能无确认跳过让位。
- “隐藏 boot 不参与竞争”会新增任务未要求的播放语义，可能破坏后台续播；当前不采用。

`lifecycle` 可以消费来减少动画绘制，或作为探查元信息；不能用来授权跳过音频交接。

## 4. paused 同步改变，pause 事件异步

独立实验使用本地生成的静音 WAV、muted audio，在 play Promise 成功后调用 pause：

```text
before-pause:                 paused=false
after-pause-return:           paused=true,  pauseEvents=0
after-microtask:              paused=true,  pauseEvents=0
pause-event:                  paused=true
after-event-loop:             paused=true,  pauseEvents=1
pause-again-while-paused:      paused=true,  pauseEvents=1
```

因此报告“pause 事件同步派发”需要修正。pause() 当次改变 paused，pause 事件随后排队；已经 paused 时再次 pause 不会新增 pause 事件。与 [HTML · internal pause steps](https://html.spec.whatwg.org/multipage/media.html#internal-pause-steps) 的排队事件机制一致。

交接可以在被动暂停处理完成后核对 audio.paused，再发送 yielded；若采用 pause 事件发送，要处理旧实例本来已暂停的幂等确认。确认必须绑定本次 claimId/owner generation/目标 owner，过时 yielded 不能解锁下一次 play。先取消待起播与过时异步回调，再确认让位；不能把普通用户 pause 事件无条件当成本次 claim 的回执。

## 5. 150–300ms 未回复不是死亡证明

Hana 的 30 个 RTT 样本是正常同源页面的观测，不是最坏调度上限，也没有测真实媒体 pause 事件、后台主线程阻塞、跨独立窗口或分区隔离。1200ms 的负观察窗口同样不是死亡判据。

新 owner 150–300ms 后仍未收到 yielded，可能是通道不通、消息/事件延迟或 JS 主线程忙，旧 audio 仍播放。因此 **不能超时后强制 play**，否则重新产生本任务要修的双出声。短超时可以触发另一通道/重试或进入待命，不能自动授权出声。

前次 15 秒候选是续租的“疑似失联”窗口，原报告并未建议每次正常接管静默 15 秒。本轮不会把它或 150–300ms 写成死亡阈值。事件驱动的有效暂停回执可避免正常交接依赖心跳，但旧文档真正消失后的自动恢复协议仍需解决；同时满足单实例 reload 即续播和严格唯一出声，不能靠普通静默超时证明。

同时启动且没有旧 owner 时，claim/yielded 本身也没有唯一发证者。保留 App 后端串行仲裁，BC/storage 负责传输和回执、global 键负责权威记录；避免 A/B 各自认定无回应而都起播。

## 6. B 的验收澄清如何落成确定性测试

接受“被接管 A 不得再写 true、当前 B 可写 true”的语义，但应避免非确定性地读全局盘：

1. A 在播，记录 A 与本次 claim generation。
2. 发起 B 接管，先阻塞 B 的实际起播/持久化出口，完成 A 暂停处理。
3. 强制 A persistNow/pagehide，检查 A 产生的 snapshot.playing=false；在可写入交接空档的测试里，读盘为 false。
4. 放行 B，让 B 起播并持久化，读盘 owner=B、playing=true。
5. 再注入 A 接管前排队的旧 true 快照、接管后的 false 快照与 beacon，检查它们不能覆盖当前 B 的播放快照，也不能恢复 A 出声。

若后端已直接拒绝非 owner 写入，第三步应核对 A 的 false 快照与写入被拒的证据，不能要求盘上的 B 必须变 false。报告中的“B 抢麦 → A 收到 yielded”也应理解为 **B 收到 A 发送的 yielded**。以上是把用户确认的语义落到可控制时点，未改任务书或既有断言。

## 7. 原始证据与未动范围

新证据目录：`audio-owner-1.1.1/host-probe-review-20261013-codex/`。

- `connectivity-and-pause.cjs`：独立完整实验源码，全部 fixture 由脚本生成。
- `connectivity-and-pause.raw.json`：六组 pair 的所有消息、时间和 origin，以及 pause 时序。
- `stdout.log` / `stderr.log`：完整原始输出，stderr 为空。
- `run.json`：原命令、起止时间、退出码 0 与实验边界。
- `evidence-sha256.json`：实验产物 SHA256，以及与开工基线核对的源码/验证脚本/manifest/build 未变证据。

只用系统 Chrome 的临时 headless 实例及临时本地 HTTP 服务，结束后关闭；不访问 Hana 宿主运行时、不读写生产 app-data、不安装/重载 App。Hana 原报告与证据保留原样。原代码和基线未改，版本仍 1.1.0、三处 build 仍 1003131675。

## 8. 回传状态

用户已代为提交更新后的开工报告（其中含本复核稿链接）。Computer Use 已确认播放器任务会话出现该完整文档，输入区清空；Hana 最近操作读取了本稿，并回复“先读它的复核稿”。因此复核材料已送达，无需重复发送。Hana 正在复核，不等于已认可全部勘误或已完成真实验收；当前仍不改代码。

# AUDIO-OWNER-HOST-INTERFACE-SPEC · 宿主文档存活最小只读接口

2026-10-13，Codex。供宿主维护方评审；本轮只产出规格，未修改宿主。
依据：`audio-owner-1.1.1/probe-expanded-20261013-hana/03-host-internals.md`，以及当前公开 `APPS.md`。
内部名称和行号只用于维护方定位，不是 App 可调用的接口。

## 要解决的问题

播放器保存 owner 后，宿主退出可能直接销毁媒体文档，来不及发送 handoff。
新文档需要证明旧文档不能继续出声，才可清理孤儿记录。
现有空列表、失效句柄、连接断开或后端换代只能证明桥暂时不可用。
必须区分 `ended` 与 `unknown`：活文档可能正在 App 重载、桥重绑、client 重连，或尚未注册 chrome。

## A · 同代内文档状态

建议在已有 `ctx.surfaces` / `sdk.surfaces` 卡 chrome 门增加：

```ts
getCardChromeViewLifecycle({ viewHandle, cardInstanceId }): Promise<
  { ok: true; state: "active" | "ended" | "unknown" }
  | { ok: false; code: string; error: string }
>
```

这是**提案**，当前 SDK 不提供此方法。只增加只读查询，不新增权限词，不改变现有写入、注册、撤销或重载语义。
复用现有 App 身份与视图归属检查：只允许查询自己的文档，跨 App 查询拒绝，调用者不能自报 owner/client/runtime。

| state | 宿主必须掌握的事实 | App 行为 |
| --- | --- | --- |
| active | 已确认该媒体文档仍存活 | 不清 owner；保留暂停确认交接 |
| ended | 已确认该具体文档已被销毁，且永不能恢复产生媒体 | 可以按旧 owner/generation 清点 |
| unknown | 未登记、无匹配墓碑、重连、桥失效、回收过墓碑，或查询无法证明媒体终止 | 保守待命 |

**句柄不在表必须返回 unknown，不能返回 ended。** 权限/宿主不可用是失败 Result，消费者同样不得据此清 owner。

维护方落点：在 `MIr.revoke`（证据行 56445）、`QIr.closeEntry`（57126）及 `hNr.disconnect`（75248）
记录归属和身份对应的生命周期墓碑；通过 `hNr.lifecycleForApp` → `trn`（130982）→
`APP_SURFACE_METHODS`（app-host-entry.js:532）增加只读查询。
`ui-sessions/release`（56023）也应关联到同一文档状态。

**墓碑需要区分“权限/连接撤销”与“媒体文档终止”。** 上述路径是记录候选事实的落点，
它们本身不自动证明 DOM 或 renderer 已销毁：socket disconnect 尤其可能只是断线。
只有桌面 renderer 确认文档销毁，或宿主已有等价的销毁完成栅栏后，才可发布 ended。
仅 token 撤销、reader abort、lease 删除、缓存 entry 删除或连接断开时，查询应返回 unknown。
同一文档重新绑定桥不得生成可以误导消费者的 ended。

## 身份复用和墓碑保留

优先复用宿主已经铸造、App 已可读的 `viewHandle`，同时核验 `cardInstanceId`。
不新增由 App 自报的 documentId，不使用 pid、token、私有目录名或本地路径。
墓碑内部可包含 `{ appId, viewHandle, cardInstanceId, state, endedAt }`，查询只公开 state。

未注册 chrome 的媒体 iframe 可复用 `hana.surface.getContext()` 给出的 `cardInstanceId`，
但**持久化卡片身份可跨文档重挂，不能独自充当文档代**。
宿主须映射到已铸的具体文档/视图绑定，歧义时 unknown；不新增身份铸造规则。
维护方若无法提供这个映射，A 的首版明确限定为具备实际文档绑定的 chrome 视图。

墓碑按 App 隔离并设容量上限；回收后的目标返回 unknown。不得把“已被回收”或 TTL 到期解释为死亡。
墓碑写入与文档终止确认须有序；查询在终止确认前不能先看到 ended。

## B · 跨代只读栅栏

把 `QIr.initializeStorage()` 已有的 run nonce（证据行 57180）公开为不含秘密的 opaque `uiRunId`。
建议增加 `GET /api/apps/ui-run` 或等价 `sdk.surfaces.getUiRun()`，沿用既有 App 查询授权。
也可在公开的 server-info 投影增加此字段；App 不直接读取宿主私有 server-info.json。
返回提案：

```ts
{ ok: true, uiRunId: "opaque-host-issued-run", previousStaticDocumentsEnded: true }
```

`uiRunId` 仅供相等比较。App 在 owner 记录内保存读取时的值，不能自报新代以跳过授权。
只有旧记录具有可靠的宿主签发代、当前查询成功、代不同，且终止栅栏为真时，才可判旧代 ended。
**查询失败、缺字段、旧记录无代都属于 unknown。**

`QIr.sweepOrphans`（57207）清理旧 run 目录是候选落点，但删除快照并不停止已加载的 audio。
因此宿主必须先确认上一代静态媒体文档全部终止，再发布 `previousStaticDocumentsEnded: true`。
如果只重启服务端/App 后端而保留 renderer，这个字段必须为 false 或查询返回 unknown；
不得凭 run nonce 改变就允许新文档抢播。
同代内单个 iframe 销毁仍用 A；托管 service 文档或直接目录服务文档不在 B 首版覆盖范围。

## 维护方验收条件

1. 同一文档暂时断连、重连、桥重绑、chrome 未注册：不得返回 ended。
2. 直接销毁 iframe，未跑卸载 JS：完成栅栏后返回 ended；此前 unknown。
3. 只重建 App/服务端、保留旧音频文档：A 不返回 ended，B 不发布终止栅栏。
4. 完整退出宿主再启动：上一代媒体确已终止后，B 可证明整代 ended。
5. 错误 App、错误配对、未知句柄、墓碑回收：拒绝或 unknown，不能被用来清点。
6. 文档重挂使用已有宿主绑定身份；旧文档 ended 不覆盖同卡片的新文档 active。

播放器接入时仍按后端串行状态机核验旧 owner/generation，清点同时递增 revision/generation，
拒绝旧代的 yield、handoff、savePlayback 与延迟 reap。接口可与本轮 Web Locks 路径并存，
不需要更改许可证、权限清单或现有 SDK 写入规则。

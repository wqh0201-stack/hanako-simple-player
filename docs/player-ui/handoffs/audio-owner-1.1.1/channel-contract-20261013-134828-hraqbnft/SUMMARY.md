# Audio owner 1.1.1 · Q1 / Q2 / Q5 开工只读证据

日期：2026-10-13（Asia/Shanghai）。本轮未改 App 源码、manifest、原仓库构建号，未运行或访问宿主运行时。只在 `/private/tmp` 副本执行构建号脚本，新增本证据目录。需求以 `docs/TASK-audio-owner-1.1.1.md` 为唯一来源；已读 AGENTS、协作约定、hana-app-creator 技能及 builder 工作流。

## Q1 · BroadcastChannel 在真实 Hana iframe / 独立窗口中是否可用？

**当前结论：真实可用性与卡片 ↔ 独立窗口连通性尚未实测，不能写成已通过。** 最新宿主契约来自 `~/.hanako/artifacts/server/1.1.0-beta-darwin-arm64-ddbcc90ee2fc26ef-ge9e41495f3d78133/APPS.md`（由目录列表确认最新版本）。全文无 `BroadcastChannel`、`allow-same-origin`、`storage partition` / `browsing context` 条款；公开 browser SDK 只定义 bridge 的 parentWindow 与 targetOrigin 验证，无法证明真实 iframe sandbox 属性、有效 origin 或 Electron Session partition。

可确认的设计边界：BroadcastChannel 可按任务书用 try/catch 提供快通道，但不能把构造成功当跨窗连通性成功；兜底必须独立验证。APPS.md 535–539 行明确 global 存储由单一宿主 AppStorageStore 提供，所有入口写同一份数据，变更经已有 app_event 广播到已挂载卡片，按作用域过滤。1013 行明确多 iframe / 窗口不能假设共享 JS 对象，可以用 App 存储订阅或自有后端同步。

浏览器机制证据：[WHATWG HTML · Broadcasting to other browsing contexts](https://html.spec.whatwg.org/multipage/web-messaging.html#broadcasting-to-other-browsing-contexts) 的 postMessage 算法匹配相同 storage key 和 channel name，随后排队异步任务；没有跨代理完整顺序或零时延承诺。故“不同 browsing context group 就不能通”不能当标准结论，“零延迟”不能当正确性保证。这是标准分析，**不是 Hana 真机实测**。

交给 Hana 的最小探查：真实卡片 A、同窗另一实例 B、独立窗 C 各报告 origin、是否暴露 BroadcastChannel、构造/发送错误；带唯一 probeId 双向发送并记录每对发送数/接收数和接收耗时；重复 detach/dock 后重新握手复测。只返回安全元信息，不能日志化 SDK 凭据或完整含票据 URL。需要由宿主侧确认 iframe sandbox 与 Electron partition，不由 Codex 调运行时。

## Q2 · hana.storage.global.onChanged 是否满足抢麦延迟与抖动？

**当前结论：共享广播契约成立；真实卡片/独立窗 p50/p95/max、抖动和暂停生效时间没有现成证据，不能判断满足抢麦。**

- APPS.md 516–539：global 与 agent 的六个方法；宿主唯一写者、原子落盘，所有入口共用 store；任意写入后 source=server 的 app_event 广播 keys，值需自行重拉。该存储接口没有 CAS、expectedRevision 或事务型“读取后条件写入”。**原子落盘不等于原子抢占。**
- 最新公开 SDK `hana-plugin-sdk-0.0.0.tgz`（source-manifest packedVersion `1.1.0-beta`）的 `dist/index.js` 985–995 按 scope 遍历订阅并同步调用 callback(keys.slice())；1107–1135 的 onChanged 仅加入本地 Set 并返回 disposer，没有初始值推送、初始重拉、去重、debounce、单飞或回调 Promise 排队。
- `get/set` 分别转发独立异步 bridge request（1109–1116）；request 1045–1094 按 id/type 接收 response 才 resolve。默认 10000ms（497）是超时阈值，不是实时保证。公开 SDK 不给 set 响应、各窗口变更回调、get 重拉完成与旧实例 audio.pause 的跨窗先后/最大时延保证。
- 现有仓库 SDK `ui/sdk.js` 875–890 / 954–983 的此项形状一致；不要误用扁平 `hana.storage.onChanged` 的旧通道。
- 历史 `MOOD-HOST-PROBE.md` 70–97 行证明后端隔离宿主订阅可收到后端路由写，同值写两次回调两次；91–97 行要求内容比较且指出自写广播，明确真实卡片未验。该报告未提供抢麦时延分布。这里只读历史证据，未复跑其隔离宿主方法。

实现含义：收到 keys 后按需重拉；内容比较与本次记录的自写身份/版本一起收敛，不能“忽略下一条事件”。多个事件重拉可能得到较新记录而非触发事件的那次值；不能用事件到达顺序直接决定 owner。set + get 也不能单独保证同时 boot 唯一赢家，需另行确定串行仲裁/交接方案并测试。

交给 Hana 的最小探查：真实 A/B/C 订阅 global 指定探针键，连续唯一记录及重复同值写入，记录写请求发起/返回、各回调、各 get 返回、暂停动作生效时间，提供原始时间轴及 p50/p95/max。分别测前端写、App 后端写、detach/dock、reload 重建与窗口后台；记录自写广播、丢失/重复事件和回调重入。不得通过改真实播放记录/关闭卡片/新增权限或私有 API 探查。

## Q5 · bump-build 是否同步三个位置？

**已在最小目录镜像中实跑通过。** `tools/bump-build.mjs` 20–22 行按脚本自身所在目录确定 root，因此复制脚本加三份目标后从镜像运行，写入完全留在镜像。30 行加一；37–55 行更新两个 HTML 与 _build.json。

执行目录：`/private/tmp/audio-owner-build-hraqbnft`。
执行命令：`node tools/bump-build.mjs`，exitCode=0。
原始 stdout：

```text
[bump-build] 1003131675 -> 1003131676  (同步: _build.json, index.html, standalone.html)
```

镜像三处均为 `1003131676`；原仓库三处均仍为 `1003131675`，实验前后四份文件 SHA256 完全一致。镜像两个 HTML 去掉 data-shell 差别后字节相同；脚本副本未改。原始数据见 `build-mirror.raw.json`、stdout/stderr 日志。脚本在 HTML 找不到 marker 时会 warning 并继续，所以日后正式 bump 仍须核对三处；本次现有 HTML 两处 marker 均命中。

## 原始证据索引

- `build-mirror.raw.json`：命令、目录、退出码、原仓库前后与镜像文件 hash/build、全部检查。
- `build-mirror.stdout.log` / `build-mirror.stderr.log`：脚本原始输出。
- `apps-contract.raw.txt`：最新版 APPS.md 带原始行号与 SHA256 的相关段落。
- `sdk-contract.raw.txt`：最新版公开 SDK archive 与仓库 SDK 带行号的相关段落。
- `sdk-provenance.json`：SDK archive 来源、packedVersion、SHA256 与官方 source hashes。

Q1/Q2 的宿主实时结论仍须 Hana 真实卡片证据；本报告没有用 mock / Node BroadcastChannel 代替真机验证。

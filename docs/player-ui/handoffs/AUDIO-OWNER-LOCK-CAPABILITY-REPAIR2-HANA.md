# AUDIO-OWNER-LOCK-CAPABILITY-REPAIR2-HANA · 真实能力探测（任务书 §2.5 第 8 项）

> 执行：哦鲸鲸。日期：2026-10-13。委托：Codex（`AUDIO-OWNER-CODEX-PROMPT-2.md`，任务书 §2.5 第 8 项）。
> 范围：**只读探测**。未改生产源码 / 断言 / manifest / 版本 / build、未部署、未 reload 播放器、未动 `app-data`。
> 手段：临时探针 App（`liveness-probe`，本地目录安装，用完卸载），把 JS 跑在**真实卡片 iframe 与真实独立窗**里，结果经 App 自有路由回收。
> 结论文件（本文件）是本次唯一产出；探针 App 源码在 `probe-expanded-20261013-hana/liveness-probe/`。

---

## 0. 结论（一句话）

**共享，且没有 SecurityError。** 卡片 iframe 与独立窗的 App UI 文档**处在同一个 Web Locks lock manager**：独立窗持有共享锁时，卡片文档 `query()` 能看见同一把锁、`ifAvailable` 拿不到。**跨文档共享在真机确认成立，方案不判废。**

---

## 1. 环境读数（真实宿主）

| 项 | 卡片 iframe | 独立窗 iframe |
|---|---|---|
| `location.origin` | `http://127.0.0.1:27958` | `http://127.0.0.1:27958` |
| 顶层? | `false`（在 iframe 里） | `false`（在 iframe 里） |
| `isSecureContext` | `true` | `true` |
| `navigator.locks` 存在 | `true` | `true` |
| `navigator.locks.query()` | **ok（未抛 SecurityError）** | **ok（未抛 SecurityError）** |
| `BroadcastChannel` 存在 | `true` | `true` |
| URL 形态 | `/api/apps/liveness-probe/ui/_surface/<token>/index.html?appSurfaceSession=<token>` | 同前缀 `/standalone.html` |

→ 两条「判废」条件都不成立：**不是不透明源**（否则 `request()` 会 `SecurityError`），**也没有分区隔离**。

## 2. 决定性证据：交叉持锁 / 查询 / ifAvailable

探测方法（锁名全为**临时名**，未使用任何生产音频锁名）：
- 每份文档持一把唯一「身份锁」`hana-liveness-probe-id-<docId>`（名字唯一必得，持到文档销毁），用 `query()` 反查它 → 得到**本档 clientId**。
- 所有文档竞争同一把「共享锁」`hana-liveness-probe-shared`：抢到 = 本档是持有者；抢不到但 query 里看得见持有者 = 跨文档可见。

同一时刻的四份文档（原始回包摘录，clientId 为宿主分配的帧级身份）：

| 文档 | shell | 本档 clientId | 抢到共享锁? | query 里看到的持有者 |
|---|---|---|---|---|
| `doc-mv6kdqxg-fk1yn8` | **window（独立窗）** | `C37D73CB89CC25EBFD26F88F78AD2E10` | **true（持有）** | `[C37D73CB…]` |
| `doc-mv6kdqxh-l1aesa` | card | `B4F173ABD5FFDFDD3562F193EF780EB1` | false | `[C37D73CB…]` |
| `doc-mv6kdqxh-mkra6m` | card | `3CE9D720F4CD559AEF18B9544F894CBE` | false | `[C37D73CB…]` |
| `doc-mv6kdqxi-zjtq7m` | card | `A9C107FED3492C62AE79B67271BFDC2C` | false | `[C37D73CB…]` |

原始 `heldNow` 快照（同一份报告里，四份身份锁 + 共享锁并列，clientId 一一对应）：

```json
{ "heldNow": [
  { "name": "hana-liveness-probe-id-doc-mv6kdqxg-fk1yn8", "clientId": "C37D73CB89CC25EBFD26F88F78AD2E10" },
  { "name": "hana-liveness-probe-id-doc-mv6kdqxh-l1aesa", "clientId": "B4F173ABD5FFDFDD3562F193EF780EB1" },
  { "name": "hana-liveness-probe-id-doc-mv6kdqxh-mkra6m", "clientId": "3CE9D720F4CD559AEF18B9544F894CBE" },
  { "name": "hana-liveness-probe-id-doc-mv6kdqxi-zjtq7m", "clientId": "A9C107FED3492C62AE79B67271BFDC2C" },
  { "name": "hana-liveness-probe-shared",                   "clientId": "C37D73CB89CC25EBFD26F88F78AD2E10" } ] }
```

判读：
- **独立窗**（`shell: window`）与**卡片**（`shell: card`）**共用同一个 lock manager**：卡片能看到独立窗持有的锁，且 `ifAvailable` 全部返回「拿不到」。
- 三张卡片各自也拿不到锁 —— 同一时刻只有一个持有者，符合互斥语义。
- 结论：`<iframe>` 文档之间（无论同窗还是跨窗）**共享同一把锁**；`hana-liveness-probe-shared` 的持有者是独立窗，三张卡片全部可见 → **跨窗口共享成立**。

## 3. 这条结论支持什么 / 不支持什么

**支持（真机）**
- App UI 文档是 **secure context**，`navigator.locks` 可用，`query()` 不报 `SecurityError` → 源不是不透明源（`sandbox` 带 `allow-same-origin`）。
- 卡片 iframe 与独立窗 iframe **同一 storage bucket**（同 origin + 同顶层站点）→ Web Locks / BroadcastChannel 可跨这两个表面互见。
- 「抢到锁 = 没有别的活文档持有」这一判据在真机可用 → 孤儿自愈的存活判据成立。

**不支持（本轮未测）**
- **文档销毁是否在真机自动释放锁**：本轮未做（Chrome 已验，见 §4；真机只差一次关窗观察）。
- bfcache / tab freeze、远程/移动端（非 secure context）、`steal` 在真机的时延与重叠窗口：未测。

## 3.2 补充：文档销毁 → 锁自动释放（真机已观测）

用户关闭独立窗口后回读，同一条通道拿到的原始读数：

- 独立窗文档 `doc-mv6kdqxg-fk1yn8`（clientId `C37D73CB89CC25EBFD26F88F78AD2E10`，即刚才的共享锁持有者）的报表在 `at 1791888929724` 之后停止。
- 幸存卡片最新 `query()` 中，**`hana-liveness-probe-shared` 整条消失**，该 clientId 的身份锁也消失：

```json
{ "docId": "doc-mv6kdqxi-zjtq7m",
  "sharedHeldBefore": ["C37D73CB89CC25EBFD26F88F78AD2E10"],
  "heldNow": [
    { "name": "hana-liveness-probe-id-doc-mv6kdqxh-mkra6m", "clientId": "3CE9D720F4CD559AEF18B9544F894CBE" },
    { "name": "hana-liveness-probe-id-doc-mv6kdqxi-zjtq7m", "clientId": "A9C107FED3492C62AE79B67271BFDC2C" } ],
  "sharedHeldNow": [],
  "liveProbeDocCount": 2 }
```

判读：独立窗文档被销毁后，它与共享锁**都由浏览器自动收回**（`query()` 里不再列出）→ `sharedHeldNow: []` = 共享锁空闲，新文档可直接拿到。
**这就是孤儿自愈所需的「旧 owner 确实已结束」正向证明，在真机上成立**（旧文档不执行任何卸载 JS 也一样）。

## 4. 旁证：同一机制的 Chrome 实测（`probe-expanded-20261013-hana/06`、`08`）

- `http://127.0.0.1` 是 secure context；宿主 sandbox 下可用。
- **摘掉 iframe（不执行任何卸载 JS）→ 锁由浏览器自动释放**。
- **隐藏 / 滚出视口 / 压 0 尺寸 / 切后台 tab 都不释放**（活但隐藏不会被误判为死）。
- `steal: true` 原子抢占，被抢者收 `AbortError`。
- 复刻「`file://` 顶层 + 同源 iframe」与「`window.open('about:blank')` 拖出窗」两种拓扑，均共享。

## 5. 方法与环境（可复现）

- 探针 App：`liveness-probe`（`manifestVersion 2`，capability 仅 `app/tools.expose-to-model`，无网络、无资源权限），装在 `~/.hanako/apps/liveness-probe/`，源码在 `probe-expanded-20261013-hana/liveness-probe/`。
- 结果回收：卡片/独立窗把探测结果 `fetch` POST 到探针 App 自有路由 `/api/apps/liveness-probe/routes/api/report`（凭 `appSurfaceSession` 头过鉴权），后端存进程内 Map，模型用 `liveness_probe_report` 读回。
- 用户操作：安装后批准 → 卡片自动渲染 → 把卡片拖成独立窗口。
- **探针不含任何生产锁名**：仓库内 grep `hana-simple-player-audio` / `player-audio-owner` 在探针目录零命中；只用 `hana-liveness-probe-*`。
- 宿主侧：Electron `main.bundle.cjs` 无 `--disable-features=ThirdPartyStoragePartitioning` 一类开关（现有 `disable-features` 仅 GPU 兼容 / Windows 滚动条），故 Chromium 默认第三方存储分区生效；本轮读数与该模型一致（同顶层站点 → 同 bucket）。

## 6. 未核实项（照实标注）

1. ~~真机**文档销毁自动释放**未直接观测~~ → **已在 §3.2 观测到**（关闭独立窗后，其锁与身份锁从 `query()` 中消失）。
2. bfcache / tab freeze 是否释放锁：未测。
3. 远程 / 移动端（非 secure context → `navigator.locks` 缺失）未测，需保留退化路径。
4. 顶层站点若将来从 `file://` 变为第一方 `http://127.0.0.1`，第三方分区会把两个表面分到不同 bucket —— 本轮宿主为前者，结论仅对当前形态成立。
5. 探针 App 为临时件，验证完由哦鲸鲸卸载；未改任何生产源码 / 断言 / 版本 / build / app-data。

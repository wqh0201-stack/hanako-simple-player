# Hana 独立验收：批量封面补全与单曲兜底

日期：2026-10-20；版本 `1.2.2`；最终修复候选构建 **`1003131785`**。
当前结论：**真实曲库误拒已修复，1785 源码及独立专项/旧缓存回放通过；已提交正式安装审核，等待用户确认，尚未宣称新版运行时生效或真实 50 首补全率通过。**
历史：1003131782 曾安装，虽夹具专项通过，用户真实使用却为 0/50，验收不通过。下文保留其失败证据，不以新测试通过覆盖旧事实。

## 需求与执行

- 批量安全解析脏命名并逐曲补封面，不逐曲询问；最终汇总未补数量，引导单曲菜单。
- 单曲无歌手/未命中不再被阻断，可在同一轻量面板补填歌名和歌手重试。
- 按用户本轮指定，由码农接续被停止的 Codex 半成品完成实现；Hana 独立检查、复跑与部署。
- 第一轮构建 1003131781 虽有 87/87 封面用例通过，仍经 Hana 补充直接生产函数检查复现 R1–R3；记录见 `COVER-FILL-SAFE-20261020-HANA-REVIEW.md`。修复后才准入本次安装审核。

## 独立复跑证据

真实运行时：`ELECTRON_RUN_AS_NODE=1 /Applications/HanaAgent.app/Contents/MacOS/HanaAgent`（用作 CLI Node，不控制 GUI）。

- `tools/verify-cover-match.mjs`：**16/16**，混合音质/版本标签、质量圆括号、未读不同录音阻断、相同录音证据可复用均通过。
- `tools/verify-cover-catalog.mjs`：**12/12**，官方身份/别名、重名歧义、有界搜索/缓存/重试等。
- `OUT_DIR=docs/player-ui/handoffs/cover-fill-safe-20261020-hana-r2 tools/verify-ui.mjs --covers-only`：**87/87**，`failed: []`、`runtimeErrors: []`，命令 exit 0。
- 独立 UI 原始产物：`docs/player-ui/handoffs/cover-fill-safe-20261020-hana-r2/`；执行方原始记录仍保留在 `cover-fill-safe-20261020/`。
- 未跑全量 UI/backend，符合普通更新只跑受影响专项的项目纪律。

## R1–R3 修复复核

1. `【Live高清】`、`【现场高清】`、`【翻唱无损】` 先分离装饰与版本；不能被洗成原版；正确版本仍可命中。
2. 读取失败的候选若包含已确认录音以外的新 songId，本曲保留原图，不把网络失败制造成唯一候选；其他曲目继续；同 songId 的证据可复用。
3. `（无损音质）`、`（HQ）` 等明确质量注释可清除；真实括号歌名与版本保持严格。

## 运行时构建与静态校验

源码仓库目录名 `hanako-audio-player-simple` 与 App id 不同，直接对仓库跑官方 validator 会报目录不匹配。未修改 manifest id，也未放松校验。

改为生成名称正确的纯运行时目录：

`/Volumes/SSD/hanadesk/OH-媒体库/应用构建/小花音乐播放器/1003131782/hanako-simple-player`

包含完整 `ui/`、`lib/`、入口、manifest、package、assets、许可证/README 和 5 个 runtime tools。排除 `.git`、docs、测试/构建脚本及用户 `OH-Works/` 截图。没有复制生产 app-data。

通过官方 `hana-app-creator/scripts/validate_app.mjs`：**0 errors / 1 warning**。唯一 warning 为静态检查不证明动态网络/运行时加载（`DYNAMIC_DEPENDENCIES_NOT_PROVEN`），不冒充真机验证。

## 安装与真实界面（已安装，真实使用未通过）

使用正式 `extension_manager install`，来源为上述纯运行时目录（local）；未直接修改托管安装目录或平台配置。

- stagedId：`stg_27438bf0691f8542`
- 包 hash：`362d3e8820b12f141b34a6a81893b02d13e5d13e730cc06e6da2c4b179b03ad0`
- 权限/域名未新增；版本号保持 `1.2.2`。
- 用户确认后，Hana 对同一个 stagedId 调用 `status`，返回 **installed**；未调用 confirm 代替用户审批。
- 安装前生产构建为 `1003131778`，安装后读取生产 `ui/_build.json` 已为 **1003131782**；用户截图出现新版结果汇总。
- 用户实际运行 Avril 歌单后截图显示 **已补 0 首 / 还有 50 首未补**，其中 47 首被计为请求失败，末条错误为「上游返回 405」。本轮不因此宣称真实可用性通过；Hana 未代执行真实批量替换。

## 用户真实反馈后的只读诊断

范围：只读生产 `cover-catalog-cache.json` 的公开曲库元数据，抽取当前 `ui/app.js` 的生产纯函数与 `coverResolve` 进行离线回放；没有重新批量请求、写入用户歌单或修改运行时代码。

1. **搜索成功，不是名字不规范。** 缓存中官方歌手 `Avril Lavigne` 的 ID 为 46490，多首规范英文名已有完全同名、同歌手的搜索结果及专辑详情。
2. **不同 songId 被直接等同为不同录音。** `chooseCoverHit` 要求剩余候选只有一个 songId。真实数据库里，标准/豪华/再发行等收录有不同条目 ID；代码没有进一步按正规专辑/发行身份解决这类正常重复。
3. **候选专辑超过 6 张直接记失败。** `coverResolve` 在完整筛选发行层次前遇到 `albumIds.length > 6` 就放弃，而非缩小到可靠正式专辑。热歌因此天然容易被拒。
4. **英文 best 子串误判。** `/精选|best|collection|拍档|再版/i` 将实际 `albumType=专辑` 的《The Best Damn Thing》及 Deluxe Edition 误判为精选；不是官方类型有问题，是名称启发式太宽。
5. **405 的信息不足。** `上游返回 405` 是上游 JSON code，不是已证明的 HTTP 状态。汇总只显示 `lastError`，所以不能说全部 47 首均因 405；“候选过多”等内部拒绝也被计入 failed。当前没有逐操作/请求阶段证据证明这次 405 具体来自歌手、歌曲搜索还是专辑请求，更不能断言一定由频率触发。

离线回放结果（真正执行生产函数，不重写匹配逻辑）：

| 规范曲名 | 同名同歌手候选曲目 / 专辑数 | 结果 |
|---|---:|---|
| Innocence | 4 / 4（含 Live，录音室候选 3 条） | no-match；三份录音室发行的 songId 不同 |
| Rock N Roll | 5 / 4（含伴奏） | no-match；单曲、专辑、合辑等多个条目被一并视作不同录音 |
| Head Above Water | 4 / 4（含 Live） | no-match；两份同名录音室专辑发行，songId 分别 1310906383 / 3342121531 |
| Complicated | 39 / 39 | error：候选专辑过多，无法确认唯一录音 |
| Sk8er Boi | 41 / 40 | error：候选专辑过多，无法确认唯一录音 |

尤其 Head Above Water 回放所用歌手、搜索与 4 张候选专辑均在缓存中，没有缺失读取；即使不发生任何网络错误，当前生产算法依然返回 no-match，足以证明不是只修 405 就能解决。

正确的后续方向：封面归属需要歌手/歌名/版本/正式发行的层次判断，不能要求所有发行共享一个 songId，也不能截取前六项冒充完整证据。优先使用官方 albumType，而非裸 best 子串；请求错误按阶段分类，别把多种拒绝都压成末条 405。此节为原因诊断，未把这些方向记为已实现。

## 最终返修与独立复验（1003131785）

码农接续修复，Hana 再次独立复核并执行：

- `verify-cover-match.mjs`：**29/29**，包括原 R1–R3、真实 Avril 发行分布、正式专辑名含 best、重复目录条目、正反向标题、分页不完整不能否定归属、错误歌手与真歧义负例。
- `verify-cover-catalog.mjs`：**13/13**，含业务 code 405 不进行三次无意义重试、扩充官方专辑字段。
- `verify-ui.mjs --covers-only`：**87/87**，`failed: []`、`runtimeErrors: []`，exit 0；输出目录 `cover-fill-safe-20261020-hana-final/`。
- 另独立运行 **7/7 旧生产 v2 缓存优先回放**：先用生产缓存中的公开元数据，缺项才用执行者提供的真实公开元数据快照；无网络、无生产数据写入。覆盖 5 首及 `Avril Lavigne - Complicated` / `Complicated - Avril Lavigne`。
- 孪生 HTML 仅 data-shell 不同，三处构建号一致 1003131785，`git diff --check` 通过。

7 项回放均只调用 **1 次专辑详情 lookup**；歌手探测不再向 Complicated 等歌名发请求（同一歌手可能被解析两次，但任务内 memo/后端缓存合并，不等于两次外网请求）。

| 曲名 | 选中发行 | albumId |
|---|---|---:|
| Innocence | The Best Damn Thing | 34734318 |
| Rock N Roll | Avril Lavigne (Expanded Edition) | 2662056 |
| Head Above Water | Head Above Water | 75552216 |
| Complicated | Let Go | 1515088 |
| Sk8er Boi | Let Go | 1515088 |
| 正向 / 倒序 Complicated 标题 | Let Go | 1515088 |

修复逻辑：

- 以官方 albumType、歌手专辑表、发行时间/条目数/发行名称分层；标准/豪华/重复上架按规范发行归族，不以 songId 不同直接否决。
- 不因候选专辑 >6 放弃；先排序发行族再进行有界详情读取（每曲最多 4 张），保留真歧义，不用搜索首条伪造确定性。
- 不再裸匹配 best；官方专辑类型优先。
- 已确认缺省歌手/别名参与判定双向标题，避免将同名歌手 Complicated 当成唯一拆分方向；无可靠方向且双向都命中不同发行时保留原图。
- 仅在歌手专辑表完整（more=false）时，未出现才能用于否定归属；分页未见不再误降老专辑。
- 错误按 artist/search/albums/album/图片等阶段分类；内部未匹配与请求失败区分，上游 405 不三次重试。

审核执行者真实只读网络证据 `cover-fill-safe-20261020/real-api-evidence.json`：8 次公开请求（artist 1、search 5、albums 1、album 1）均 HTTP 200 / 业务 code 200。本轮没有复现 405，不能据此保证未来不再出现，也不能回推旧版 47 项失败全是同一种错误。

## 1003131785 正式安装审核（待用户确认）

纯运行时目录：`/Volumes/SSD/hanadesk/OH-媒体库/应用构建/小花音乐播放器/1003131785/hanako-simple-player`。

- UI/后端/运行时工具整包；不含用户截图、docs、测试、.git、生产 app-data。
- 官方静态校验：**0 errors / 1 warning**（仅动态资源无法由静态证明），exit 0。
- 正式 `extension_manager install` 的 stagedId：**`stg_6d96b75e13434121`**。
- 包 hash：`34c59a85f86be227a66d7e9e5bf90917ac1bbcf9cdf0fe13cbec6263b3214df9`。
- 等待用户在安装审核框确认，未替用户调用 confirm；权限/域名/版本号没有扩展。
- 确认后须用同一 stagedId 查 status，再正式 reload 并核对生效；不能把审核提交当作已更新。

## 当前边界

- 1782 的真实验收失败保留为事实；1785 已改源码并通过上述复验，尚待安装确认与生产运行检查。
- **未代用户重跑真实 Avril 50 首，最终补全率未宣称通过**。由用户升级后实际使用确认。
- 未提交、推送、发布 Release/市场；Hana 未改用户歌单、cookies、歌词和 OH-Works/。

# 封面补全兼容脏标题 + 单曲兜底（2026-10-20）

状态：**实现与专项自验完成，尚未部署**。版本 `1.2.2`，构建 `1003131785`。
接手基线：`HEAD 744523f`，工作树含原 Codex 未验收半成品（`lib/cover-catalog.js`、`lib/register-routes.js`、`ui/app.js`，196+/61-）。本轮已逐段审查后接续修正，未 reset、未覆盖无关改动；`OH-Works/` 保持未跟踪未触碰。

## 结论

批量补全改为逐曲解析身份后再匹配：标题里的歌手、非 B 站平台 author、歌单缺省歌手按优先级使用，**B 站 author（UP 主）不参与歌手身份**。歌手、歌名、版本任一硬冲突就不自动套封面；可靠合唱、正确的 Live/Remix 等版本可以命中。单曲入口不再因缺歌手直接 return：缺线索/未命中/失败都会打开当前轻量面板，预填歌名与歌手，允许修改后重试，失败保留输入。批量结束在面板里持久显示「已补全 X 首，还有 Y 首未补全」并引导到 `⋯ → 获取此曲封面`。

## 改动文件

| 文件 | 改动 |
|---|---|
| `ui/app.js` | 重写封面身份/匹配链路；批量改逐曲解析；单曲自动尝试 + 预填面板重试；多歌手/别名元数据；模式与忙态复位；保留原图备份、同 ID 副本同步、保存失败回滚、停止语义。0.6 增加发行分层、同一规范发行归族、按官方 albumType/歌手专辑表选封面、每曲读取上限、同录音失败放行、错误阶段标记。 |
| `ui/index.html` / `ui/standalone.html` | 封面面板新增单曲歌名输入行（孪生文件同步，仅 `data-shell` 不同）。 |
| `ui/style.css` | 补 `[hidden]` 规则，避免 `.pop-link/.cover-label/.pop-item` 的 `display` 覆盖 hidden；单曲面板在窄卡内可滚动。 |
| `lib/cover-catalog.js` | 缓存升 v2（含 aliases）；artist 返回 aliases，同名歌手仅在作品量明显领先时认官方身份，否则 409；新增 `search` 歌曲搜索（有界、串行、成功才缓存）。0.6 的 search 补齐专辑名/发行日/曲目数，albums 补齐官方类型/发行日/曲目数/封面；上游 4xx 业务码不重试。 |
| `lib/register-routes.js` | 增加 `kind=search` 路由分支。 |
| `tools/verify-cover-catalog.mjs` | 新增 search、别名、重名歧义、缓存 v2 用例；保留重试/队列/失效缓存断言。 |
| `tools/verify-cover-match.mjs` | 新增纯函数专项：直接抽取 `ui/app.js` 生产文本，覆盖 Hana 复核 R1 混合标签、R2 未读候选、R3 质量括号正负例。0.6 增加 5 首 Avril 真实公开元数据夹具回放、候选过多不再报错、重复目录不误判、真同级歧义保留。 |
| `tools/fixtures/cover-avril-real-2026-10-20.json` | 从公开曲库元数据抽取的匿名化回归夹具：5 首规范曲名、46/47 条候选分布、12 张专辑详情、27 条歌手专辑表记录；不含歌单、cookie 或私人数据。 |
| `tools/verify-ui.mjs` | mock 目录增加 search/多专辑/现场专辑；新增脏命名、倒序、单字严格、Live 正确版本、单曲面板窄卡/宽窗、UP 主不作歌手、单曲手动重试、批量汇总/失败计数等断言。 |

原半成品里可复用的部分：`search` 路由、缓存 v2、面板模式骨架、`coverResolve` 思路；未完成/错误的部分已补齐或修正：HTML 缺 `coverSongRow/coverSongLabel`、批量仍走整歌手专辑扫描、单曲缺歌手仍 toast+return、`probeCoverImage` 未传 signal 会挂起、CSS `[hidden]` 被覆盖、测试未同步。

## 需求对应

- **脏命名**：编号（`004.`）、无空格横杠、全角横杠、`【无损音质】`、`[1080P]`、倒序 `歌名 - 歌手`、书名号 `《》`；数字/横杠/斜线/真实括号保留在歌名身份里。
- **严格性**：歌名用精确键；单字/短歌名不做包含或编辑距离命中；候选歌手 ID 集合必须完全一致；版本标签必须一致；多个不同 `songId` 录音无法唯一确定时保留原图。
- **歌手**：标题显式歌手优先；非 B 站平台 author 作为次选；B 站 author 不参与；歌单缺省歌手只补给没有显式歌手线索的曲目；显式别名解析到同一官方 ID 后按 ID 比较；合唱需全部歌手身份确认。
- **版本**：Live/现场/Remix/伴奏/钢琴/翻唱/重制等标签参与身份，括号和空格后缀两种写法都识别；正确现场版可命中现场专辑，不符版本保留原图。
- **查询**：批量只处理 B 站；单曲任意平台；每曲最多 50 条搜索结果、最多 6 张候选专辑；后端串行队列 + 350ms 间隔；7 天有界缓存；网络错误不缓存。
- **交互**：不逐首询问、不做候选确认；批量结束持久面板汇总 X/Y + `⋯ → 获取此曲封面`；单曲面板预填并允许补填歌名/歌手重试；无候选选择器/新管理页。
- **回退**：原图备份、同 ID 跨列表副本同步、保存失败回滚、停止不提交、迟到请求按 uid/id 核对；单项失败不拖垮其他可靠匹配。
- **边界**：未改原名/歌词/播放地址，未加音源/大模型/权限，未对真实用户歌单执行批量。

## Hana 复核返修（R1–R3）

对应复核：`COVER-FILL-SAFE-20261020-HANA-REVIEW.md`。

- **R1 混合标签**：`coverCleanTags` 先拆开 `【Live高清】`/`【现场高清】`/`【翻唱无损】` 等标签里的装饰与版本，只去质量/画质/广告词，保留版本词并转为 `(Live)` 等；未知标签原样保留。字典只有原版时不再错误接受这些标题。
- **R2 候选证据缺口**：`coverResolve` 记录读取失败专辑所覆盖的候选 `songId`；若它们不在已确认的录音集合内，返回 `error`/未补，不用成功读取的单一候选把潜在多录音洗成唯一。若失败专辑的候选与已确认录音是同一 `songId`，有证据放行。
- **R3 质量括号**：`coverSong` 只剥离白名单质量/画质括号（`（无损音质）`、`（HQ）`、`（1080P）` 等），真实括号歌名、`(Live)`/`(翻唱)` 等版本括号继续保留并参与身份。

## 0.6 用户真实使用返修（Avril 0/50）

用户安装构建 `1003131782` 后实际补全 Avril 规范歌名歌单为 0/50；Hana 用生产函数和只读缓存复现，确认不是脏命名：官方歌手 `Avril Lavigne` / `46490` 与正确歌曲已搜到，`Innocence`、`Rock N Roll`、`Head Above Water` 的专辑详情也齐全。

本轮已改：

- **不再用 songId 唯一性一票否决**。先按官方 `albumType`、发行日、曲目数、专辑名与歌手归属分层；标准版/豪华版/重复上架等同一规范发行的不同目录条目归为一族，选一个合理正式封面。`Head Above Water` 的 `1310906383` / `3342121531` 同专辑名、同发行日，视为同族而不是歧义。
- **候选多不再直接失败**。用一次歌手专辑表把 39/46/47 条候选缩到正式专辑/EP/单曲/精选等层级；每曲最多读 4 张专辑，优先正式录音室专辑，其次 EP、单曲、精选。不取搜索首条，不截断前六制造伪唯一。
- **官方类型优先**。`The Best Damn Thing` 的 `albumType=专辑`，不再被裸 `/best/` 子串误判为精选；`Let Go/Under My Skin` 这类合装、未出现在歌手专辑表里的群星合辑按低优先级处理。
- **未读候选按层级判断**。只有同级或更高优先级的候选读取失败、且包含未确认的新 `songId` 才阻断；低优先级精选/合辑未读不影响正式专辑选择；同录音失败有证据可放行。
- **错误分类**。`coverData` 标记 `artist` / `search` / `albums` / `album` 阶段；批量把请求失败与内部未匹配分开计数，末条错误带阶段，汇总按歌手/歌曲搜索/专辑列表/专辑/封面图片分阶段计数；上游业务码 405 不再重试三次。
- **减少反向歌手探测**。标题已有可解析的显式歌手后，不再把另一侧歌名当歌手逐个查。

真实验证：`tools/fixtures/cover-avril-real-2026-10-20.json` 回放 5 首均命中合理正式发行（Innocence→The Best Damn Thing、Rock N Roll→Avril Lavigne (Expanded Edition)、Head Above Water→Head Above Water、Complicated/Sk8er Boi→Let Go）；Complicated 46 条、Sk8er Boi 47 条候选不再因数量报错。真实只读接口共 8 次（artist 1、search 5、albums 1、album 1），全部 HTTP 200 / 业务 code 200；本轮**未复现 405**，因此不声称 47 首全部由 405 导致，只保留阶段化错误证据。原始请求记录见 `cover-fill-safe-20261020/real-api-evidence.json`。

## 0.7 独立复跑后的两处边界返修

Hana 独立复跑 26/26、13/13、87/87 后，用生产旧 v2 缓存优先、缺项补真实夹具复验 5 首均命中，确认主问题已修。部署前补两处边界：

- **倒序标题不再被第一侧“真歌手”截断**：先解析已确认缺省歌手/别名，把与缺省歌手匹配的一侧排在前面；只有该侧确认后才 break。`Complicated - Avril Lavigne`（缺省 Avril）现在不再先查 `Complicated` 歌手就停止，能命中 Let Go；正向仍保留。无缺省歌手时允许两侧假设继续，若两侧都命中不同发行则按真双向冲突保留原图。
- **分页 `more=true` 不再作为否定归属证据**：`albums` 返回 `more` 会传入候选元数据；只有 `albumListComplete`（`more=false`）时，未出现在第一页的专辑才降级为 other。`more=true` 时不做“未见即不归属”判断，已列项仍可作正证据，避免老专辑被错误降低优先级。

针对性用例：`real-reversed-title-uses-confirmed-default-artist`、`real-forward-title-still-matches`、`paged-album-list-does-not-demote-unseen-album`；主五首、R1–R3、真同级歧义负例均保留。

## 实际验证

| 命令 | 结果 |
|---|---|
| `node tools/verify-cover-catalog.mjs` | **13/13 PASS**；见 `cover-fill-safe-20261020/verify-cover-catalog.log` |
| `node tools/verify-cover-match.mjs` | **29/29 PASS**，覆盖 R1/R2/R3、5 首真实 Avril 元数据、倒序标题、分页 more、真同级歧义；见 `cover-fill-safe-20261020/verify-cover-match.log` |
| `node tools/verify-ui.mjs --covers-only` | **87/87 PASS，runtimeErrors `[]`**；见 `cover-fill-safe-20261020/verify-covers.log` 与 `verify-covers.json` |
| 真实只读接口 | 8 次请求全部 HTTP 200 / 业务 code 200；覆盖 artist、search、albums、album 四阶段；未见 405。见 `cover-fill-safe-20261020/real-api-evidence.json` |
| 基础检查 | 孪生 HTML 仅 `data-shell` 差异；三处构建号一致 `1003131785`；`git diff --check` 通过；页面加载无运行时错误（由 covers 专项覆盖）。见 `basic-checks.log` |

开发期间真实失败与修正（最终已全绿）：

1. `probeCoverImage(pic)` 未传 signal，`signal.removeEventListener` 抛异常导致图片探测 Promise 不结束——补默认 signal。
2. 测试 mock 对每个 `kind=album` 都设 gate，第二轮专辑请求无人放行，等待超时——改成只 gate 第一次。
3. 单曲面板关闭后 `coverMode` 未复位，随后直接调用 `startCoverFill` 误走单曲重试——关闭/成功后复位 batch。
4. CSS `[hidden]` 被 `.cover-label/.pop-link/.pop-item` 的 `display` 覆盖——补 `.cover-pop ... [hidden]` 规则。
5. 失败汇总文案「3 首请求失败」与测试旧断言「失败 3 首」不一致——按新文案校正断言。
6. Hana 复核 R1：混合标签被整段删除，原版被错误接受——改为装饰/版本分离清洗。
7. Hana 复核 R2：专辑读取失败后仍用已读候选认唯一——用未读 `songId` 证据缺口阻断，同录音失败可放行。
8. Hana 复核 R3：`（无损音质）`/`（HQ）` 等质量括号漏清——只按白名单剥质量括号，保留真实括号与版本。

## 构建号

`1003131778`（基线）→ `1003131779` → `1003131780` → `1003131781` → `1003131782` → `1003131783` → `1003131784` → **`1003131785`**（最终，`ui/_build.json`、`ui/index.html`、`ui/standalone.html` 三处一致）。
版本号保持 `1.2.2`，未发版。

## 未验证 / 风险

- **未部署、未 reload、未改生产安装目录与 app-data**；真实 Hana 卡片/独立窗口验收待 Hana。
- 真实网易云接口的返回形状、版本标签覆盖度、合集/多 P 场景未做真机抽查；每曲 1 次 search + 1 次歌手专辑表（缓存复用）+ ≤4 次 album，后端 350ms 串行间隔。
- 本轮 8 次只读请求未复现 405，无法证明用户那次 47 首的具体阶段分布；代码已按阶段标记并停止对 405 的三次重试，但不把推测写成事实。
- 同名歌手作品量接近时返回 409（严格策略），用户需填写正式歌手名或改用「歌手-歌名」；这是有意的保守，不是静默猜测。
- 按 AGENTS 普通功能更新只跑封面/单曲专项，**未跑全量 `verify-ui` / `verify-backend`**。
- 真实用户歌单未代操作；所有批量测试均用隔离夹具或离线公开元数据回放。

## Hana 独立复跑

本机 `node` 不在 PATH，已用 HanaAgent 自带 Node：

```bash
cd /Volumes/SSD/hanadesk/hanako-audio-player-simple
export ELECTRON_RUN_AS_NODE=1
NODE=/Applications/HanaAgent.app/Contents/MacOS/HanaAgent
$NODE tools/verify-cover-catalog.mjs
$NODE tools/verify-cover-match.mjs
OUT_DIR=$PWD/docs/player-ui/handoffs/cover-fill-safe-20261020 \
  $NODE tools/verify-ui.mjs --covers-only
```

`--covers-only` 依赖系统 Chrome 与
`/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core`（脚本默认值）。
原始输出、截图、环境记录都在 `docs/player-ui/handoffs/cover-fill-safe-20261020/`。

## 部署提示（未执行）

- `ui/` 必须**整包**同步：`index.html`、`standalone.html`、`app.js`、`style.css`、`_build.json`；后端同步 `lib/cover-catalog.js`、`lib/register-routes.js`。
- 无新增权限、域名或运行时依赖；无需重新审批 manifest。
- reload 后建议真机抽查：`004.周杰伦-七里香` 批量；无 author 的 B 站单曲；author 是 UP 主的单曲；Live 版本；保存失败回滚与停止。

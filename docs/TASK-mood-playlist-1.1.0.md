# 任务书 · 心情歌单与控制面（目标版本 1.1.0）

> 交付对象：codex。验收方：哦鲸鲸（本仓库常驻 agent）。
> 本文件是**唯一的需求来源**；与代码注释冲突时以本文件为准，与 `AGENTS.md` 冲突时以 `AGENTS.md` 为准。
> 动笔前必读，按序：`AGENTS.md` → `~/.hanako/skills/hana-app-creator/SKILL.md` →
> `~/.hanako/artifacts/server/<最新版本>/APPS.md`（宿主契约权威，路径用 `ls` 找最新版）。
> 仓库路径：`/Volumes/SSD/hanadesk/hanako-audio-player-simple`。许可证 AGPL-3.0，别改。

---

## 0. 一句话目标

让**用户装了这个 App 的那个 agent**能读用户的音乐库、按心情生成歌单、把歌单落进播放器，
并让正开着的播放器卡片**立刻看到**新歌单 —— 入口是用户主动敲的 `/mood`。

不做后台、不做定时、不做技能包。能力靠**工具描述**暴露，策略靠用户自己跟 agent 对话。

---

## 1. 背景：现状与断点（已核实，可直接信）

播放器里关于歌单的数据分两半，这是整个任务的起点：

| 半边 | 存放 | 现状 |
|---|---|---|
| 哪首歌属于哪个歌单 | `app-data/hanako-simple-player/playlist.json`，每条带 `list: "imp:1"` | 后端工具**能读能写** |
| 歌单叫什么名字、排第几 | `app-data/hanako-simple-player/storage/global.json` 的 `player-lists` 键 | **只有前端读写**，后端工具碰不到 |

`hana.storage.global`（前端）与 `ctx.storage.global`（后端）**是同一份数据**（宿主进程是唯一写者，
两扇门共享同一个 `AppStorageStore`，落在上面那个 `global.json`）。所以**不需要搬数据** ——
名字已经在后端读得到的位置了，缺的只是「让前端的读写改经后端」这一层。

`player-lists` 的真实形状（实测）：

```json
[
  { "id": "fav",    "name": "我的喜欢" },
  { "id": "recent", "name": "最近播放" },
  { "id": "local",  "name": "本地" },
  { "id": "imp:1",  "name": "Can网易" },
  { "id": "imp:5",  "name": "Aimer (全中日字幕) …" }
]
```

顺序即切换条顺序，`id` 里的 `imp:N` 是导入歌单编号。**这条键就是权威，别改键名、别改形状** ——
存量用户的数据就在里面，改形状等于把他们的歌单搞乱。

---

## 2. 硬约束（踩了必炸，来自 AGENTS.md）

1. **孪生文件**：`ui/index.html` 与 `ui/standalone.html` 内容必须一致，只差 body 的 `data-shell`。改一个必须同步另一个。
2. **构建号**：改完跑 `node tools/bump-build.mjs`（同步 `ui/_build.json` + 两个 html 里的 `window.__HANA_BUILD`）。
3. **部署必须整包同步 `ui/`**（index / standalone / **style.css** / _build.json）再 reload；漏 CSS 会退化。
4. **别定义 `--bg/--text/--accent`** 去盖宿主主题变量；只消费 `hana.theme`。
5. 禁 `position:fixed`、禁直接 `localStorage`、禁 emoji（用 SVG 线描）、字号 ≥ 11px。
6. **不许用 `ui_action` 点像素**控制界面。要交互走接口，不点坐标。
7. **别碰这些**（都是踩出来的、有注释护着的）：
   - `playlist.json` 每条曲目的 `id` / `url` 字段格式（红心、播放指针、去重全建在上面）
   - `normalizeAppUrl`（旧包名归一）、`withSession`（surface 票据）、`go` 跳板、`trackKey`（去重键含 `list`）
   - `localDir` / `player-split` / `player-ripple-tune` / 首次提示与欢迎歌的 storage key（**只在列表元数据上动刀**）
   - `lib/register-routes.js` 里 `/widget/api/...` 的旧路径（旧 UI 二十多处引用，404 就是白屏）

---

## 3. 要做的四件事

### 3.1 列表元数据改为「后端权威 + 前端订阅」

**后端新增两个端点**（走 `ctx.routes.register`，路径用 `/api/...` 清爽族）：

- `GET  /api/lists` → `{ ok: true, lists: [{id, name}] }`，读 `ctx.storage.global` 的 `player-lists`。
- `PUT  /api/lists` → 入参 `{ lists: [{id, name}] }`，**写回同一个键**（`ctx.storage.global.set`）。
  写入前做**形状校验**：数组、每项有非空字符串 `id`；`fav`/`recent`/`local` 三个固定项**必须存在**
  且**名字不可为空**（缺了就按默认名补：我的喜欢 / 最近播放 / 本地）。校验不过返回 400，**不半写**。

**前端改动**（`ui/app.js`）：

- `saveLists()` 从「直接 `storeSet(LISTS_KEY, ...)`」改成「POST 到 `/api/lists`」。
  保留函数签名与全部调用点（十几处），只换实现 —— 这样改动面最小。
- `boot()` 里读列表：**先读后端 `/api/lists`**（权威），后端为空/不可用时再回落到旧的 `storeRead(LISTS_KEY)`。
  回落路径必须保留，否则升级用户在极端情况下会丢名字。
- **订阅宿主自带的变更广播**：`hana.storage.global.onChanged((keys) => {...})`，
  收到 `player-lists` 变化时**重拉** `/api/lists` 并重渲染。用它替代原计划的 SSE —— 零新路由、零心跳。

**必须避开的回环**：前端自己写 `/api/lists` → 后端写 storage → 宿主广播 onChanged → 前端又收到。
用已有的 `listNamesKey()` 做**内容比较**：内容没变就不重渲染。别用「写的时候打个标记忽略下一次」这类脆弱做法。
（这一条是**关键正确性要求**，不是优化项。）

**验收锚点**：改完必须复跑「改名持久化」相关断言（`tools/verify-ui.mjs` 里 rename 那组，
以及 `player-lists` 落盘检查）。改名后刷新页面，名字仍在 —— 这是历史上踩过的坑，不许退化。

### 3.2 三个工具

命名沿用现有 `hana_simple_*` 前缀（`hana_simple_play` / `hana_simple_list_music` / `hana_simple_bind_banner`）。

**① `hana_simple_list_music` 增强（改现有工具，别新建）**
- 现在只回曲目。加回**歌单清单**：`{ lists: [{id, name, count}], tracks: [...] }`。
- `count` = 该 `list` 下的曲目数（从 `playlist.json` 数）。
- 现有 `keyword` / `group` / `limit` 参数与返回的 `source` 可播地址**不变**。

**② `hana_simple_create_list`（新建）**
- 参数：`{ name: string, tracks: [{ source, name?, author?, pic?, lrcUrl?, dur? }] }`，`source` 必填。
- 语义：**按名字查找已有列表，存在则替换其全部曲目，不存在则新建**（覆盖语义，必须写进描述）。
- 新建时分配 `imp:N`（N = 现有 `imp:` 最大值 +1）；同时把 `{id, name}` 追加进 `player-lists`。
- 曲目落 `playlist.json`，每条带 `list` 字段。
- **写前备份** `playlist.json`（照 `tools/` 已有的备份命名风格）。
- 返回：`{ listId, name, count, created|replaced }`。

**③ `hana_simple_search_music`（新建）**
- 参数：`{ keyword, server?, limit? }`。`limit` 默认 10、最大 30。
- **`server` 不传时按 cookie 自适应**：读 `lib/cookies.js` 的 `loadCookies(ctx.dataDir)`，
  有 `NETEASE_COOKIE` → 默认 `netease`；否则默认 `bilibili`。传了就听传的。
- **内部做「清洗 + 二次匹配」小内核**（不要只做薄转发）：
  1. 调现成的搜索链路（B站走 `searchBili`，其余走 `searchNeteaseOfficial` / `searchMusic`）。
  2. 清洗标题：剥离 `【】`、`MV`、`LIVE`、`Hi-res`、字幕组、`(中文翻译)`、日期前缀等噪声。
     **规则以知识库 `/Volumes/SSD/知识库/20-资料/曲目元数据清洗-存量歌单与二次匹配.md` 为准，务必读它。**
     ⚠️ 里面三条硬规则（版本标记保留、`A - B` 拆分阈值、歌手宁缺毋滥）**必须照做**。
  3. 二次匹配：用洗净的歌名去网易云搜，取回**干净歌名 / 歌手 / 封面(`al.picUrl`) / 歌词**。
     歌词用现成的 `getLyric`（Meting `type=lrc`）。
  4. 匹配判据：**歌名能对上 + 按时长排序取最近**。**时长只当软参考**，不用它排除候选
     （翻唱常多几秒口白，主体节奏一致）；只有差得离谱（>60s）才标存疑。
  5. 播放地址**仍用能播的那个源**（B站音轨保底）；匹配到的网易云只贡献元数据。
     有 `NETEASE_COOKIE` 时整条走网易云，不混搭。
- 返回每首：`{ source, name, author, pic, lrc, dur, matched: true|false }`，`source` 原样可传给 `create_list`/`play`。
- 描述里按 §4 定稿的文案写（那两段是给**别人家 agent** 读的入口，是这次交付的重点之一）。

### 3.3 轻版 `/mood` 命令

- 用 `ctx.commands.register` 注册 `mood`，挂别名 `心情`。
- **注册时机**：不能在 `apply` 顶层同步调用（那时宿主 `engine` 服务还没挂上，会报具名错）。
  从**装载完成之后**才跑的代码里注册 —— 工具 `execute`、或 `ctx.bus.subscribe` 回调。
  具体哪个更可靠，**请实测**（见 §5 开放问题）。
- **轻版语义**：handler 只 `reply` 一句引导文案（把用户交到 agent 手里），**不自己起 agent 回合**
  （所以**不加** `app/session.start-turn` 权限，manifest 别扩权）。
- 引导文案要写好，它是那一棒的交接（例：「想听什么状态？深夜、提神、安静都行，直接说」）。
- `usage` / `description` 写清「生成今日心情歌单」。

### 3.4 清理过时注释

`tools/play.js` 里「前端每 30 秒会拉取并合并一次」是**假注释**（代码里没有轮询）。
要么删掉，要么由 3.1 的 onChanged 把它变成真的（推荐后者，顺手把承诺兑现）。

---

## 4. 定稿的两段工具描述（照抄，这是给外部 agent 的入口）

**`hana_simple_search_music`**

> 在在线音源里搜歌，拿到可直接播放的曲目。当用户想听库里没有的新歌，或让你按某位歌手、某个主题推荐时用。返回结果里的 source 原样传给 hana_simple_create_list 或 hana_simple_play 即可播放。默认搜 B站：不需要会员就能拿到可播地址，对大多数用户最可靠；如果这位用户已配置网易云 cookie，则自动改用网易云（歌名和歌词更干净）。QQ 和酷狗常常只有歌曲信息、没有可播地址，非必要别用。返回的曲目已清洗标题，并尽量到网易云补齐封面与歌词；匹配不到就保留原始结果。

**`hana_simple_create_list`**

> 把一个歌单落进播放器，用户在播放器里就能看到并播放。当用户说「帮我弄个歌单」「按今天的心情来一个」「建个 XX 的歌单」时用。曲目先经 hana_simple_list_music（库里已有的）或 hana_simple_search_music（网上搜的）拿到，再把 source 原样传进来。歌单名已存在时会替换它的全部曲目（覆盖语义），不会越攒越多；传一个新名字就是新建。如果用户没说清想要什么，先问他今天什么状态再选曲。

**不做技能、不加 `app/session.start-turn`** —— 能力靠上面这两段描述暗示即可。

---

## 5. 开放问题（**没把握，别写死，动手前先探查并回报结论**）

1. **`ctx.storage.global` 在 `apply()` 里的时序**：读/写在 apply 内同步可用吗？还是要等某个就绪信号？
   倾向可用（文档说惰性按次读取），但**实测确认**后写进代码注释。
2. **onChanged 回环**：前端写 → 后端广播 → 前端收到，实际延迟与是否会连抖。
   用内容比较能否彻底消除重渲染？给出实测观察。
3. **`/mood` 命令注册的可靠位置**：文档说「从工具 execute 或 bus 回调里注册」，
   但**哪个在真实宿主里一定成功**？请实测（`.listOwn()` 能读回自己注册的即为成功），**别凭猜**。
   若两者都不稳，回报，别硬凑。
4. **轻版 `/mood` 的实际链路**：敲 `/mood` → App 回引导 → 用户再说一句 → agent 接上。
   中间「用户再说的那一句」在真实宿主里**是否真会唤起到 agent 回合**？请走一遍真机或等价验证；
   若不通，回报现象，**不要**偷偷改成需要 `start-turn` 权限的重版。
5. **时长校验阈值**：知识库说过「别设太强」。我给「>60s 才标存疑」，10s 那种偏强的阈值**不要用**。
   如果你实测发现更好的判据，回报并说明。
6. **二次匹配的接口选择**：现成有 `searchNeteaseOfficial`（返回 name/ar/al.picUrl/dt）与 `getLyric`。
   拿「干净歌名+歌手+封面+歌词」的最短链路是什么？有没有更省的现成端点？请探查后定。
7. **`imp:N` 编号在并发下**：后端分配编号时，前端也在 `nextImportId()`。改成后端权威后，
   前端那处是否要一起改？**结论写清，别留两套**。

---

## 6. 必须遵守的工程纪律

- **前端零构建**：`ui/` 是 ES5 纯 JS，无打包器，改完直接跑。别引入构建步骤、别用 ES6+ 语法。
- **注释写「为什么」不写「是什么」**：本仓库注释密度高，讲根因和踩坑史，照这个风格。
- 新增后端逻辑放进 `lib/`（如 `lib/lists.js` 或并入 `register-routes.js`），遵守现有模块划分。
- 工具实现放 `tools/`，与 `play.js` / `list-music.js` 同风格；在 `lib/register-tools.js` 里注册。
- 每步单独可验，**不要一次大改**。四件事按 §3.1 → 3.2 → 3.3 的顺序，每步做完跑一次验证。

---

## 7. 验收标准（codex 自验 + 验收方复跑）

**codex 侧（改完必跑，把输出贴回来）**

- `node tools/verify-backend.mjs` —— 现有 32 项全绿，且**新增**：列表元数据读写 / `create_list` 覆盖语义 /
  `imp:N` 编号 / 清洗规则边界（含「版本标记保留」「A - B 不误拆」）。
- `node tools/verify-ui.mjs` —— 现有 367 项，**失败集合必须是开工前基线红项的子集**（即除
  `ripple-max-midhigh-keeps-steady-and-silence-quiet` 外**不得出现新红**），**尤其 rename 那组不许红**。
  那条涟漪断言是**既有 flaky**（`docs/TODO.md` 自记，依赖真实音频分析，headless 下会飘），
  **不是你的锅，也不要去改它** —— 改基线断言等于作弊。
  （如环境起不来 Chrome，说明卡在哪，别跳过。）
- `node tools/bump-build.mjs` 已跑，`ui/_build.json` 与两个 html 的 build 号一致。
- `manifest.json` 的 `version` 从 `1.0.8` 升到 `1.1.0`（功能版，不是整理版），
  并在 `docs/CHANGELOG.md` 顶部加一节写「对用户意味着什么」（新增什么入口、能用它干什么）。

**验收方（哦鲸鲸）侧**

- 独立复跑上面两条验证，**不看 codex 的结论、只看原始输出**。
- 真机链路：**整包同步 `ui/` → `extension_manager reload app:hanako-simple-player`**（这步 codex 做不了，由验收方或用户执行）。
- 真机检查四件事：
  1. 敲 `/mood`，App 回引导语；再说一句，agent 能接上。
  2. agent 调 `search_music` 搜新歌 —— 结果**可播**、名字干净、有封面（有歌词更好）。
  3. agent 调 `create_list` 落「今日心情」——**开着的卡片立刻看到**，不用重载。
  4. 手动改歌单名 → 刷新 → 名字还在（改名持久化没退化）。
- 边界检查：`create_list` 同名覆盖后条数正确、`id`/`url` 未变；空歌单、超长名、含特殊字符的名不炸。

**交付物**

- 代码改动（本仓库）。
- 一份 `docs/player-ui/handoffs/MOOD-LIST-DONE.md`，写清：改了什么文件、断言编号、
  踩了什么坑、**§5 每个开放问题的实测结论**。

---

## 8. 分工与边界

- codex **不能**：reload App、真机点卡片、访问宿主运行时。这些归验收方。
- codex **能**：改仓库代码、跑 headless 验证脚本、读 `~/.hanako/artifacts/server/<ver>/APPS.md`。
- 一次改不完就分段交付，每段可独立验。**宁可小步、别憋大招。**
- 拿不准的地方**停下来回报**，不要猜着写死 —— 这份文档里 §5 列的每一条都是为此而设。

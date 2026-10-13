# 验收清单 · 心情歌单与控制面（1.1.0）

> 验收方：哦鲸鲸。**不读 codex 的结论，只看原始输出与真机现象。**
> 任务书：`docs/TASK-mood-playlist-1.1.0.md`。两者分开，避免「自己出题自己判卷」。

## 基线（开工前先记下，改完对比）

开工前（2026-10-13）实测留底：

- 后端：`node tools/verify-backend.mjs` → **32/32** 全绿
- 前端：`node tools/verify-ui.mjs` → **366/367**，唯一一红是
  `ripple-max-midhigh-keeps-steady-and-silence-quiet`（`{steady:1, silence:0}`）
- 构建号：`ui/_build.json` = `1003131669`

⚠️ **已知飘项**：上面那条涟漪 FFT 音频断言是既有 flaky（`docs/TODO.md` 自记
「仅本机复跑过一次 367/367；另一环境报 337/367，未做稳定性确认」），
依赖真实音频分析、headless 下会飘。**验收时它红不算 codex 的锅**；
但只要**多出任何一条新红**，就算打回。判据：失败集合必须是这条的子集。

## A. 独立复跑（不信 codex 的复述）

1. [ ] `node tools/verify-backend.mjs` 全绿，**且新增断言确实存在**（数一下总数 > 32）
2. [ ] `node tools/verify-ui.mjs`：失败集合**是本轮基线红项的子集**（即除 `ripple-max-midhigh-…` 外无新红），rename 那组没红
3. [ ] `ui/_build.json` 与 `ui/index.html`、`ui/standalone.html` 里的 build 号**三者一致**
4. [ ] `ui/index.html` 与 `ui/standalone.html` 除 `data-shell` 外**内容一致**（自己 diff，别信声明）

## B. 代码审查（重点看这几处，不是通读）

- [ ] `saveLists()` 的实现换了，但**所有调用点没动**（十几处）
- [ ] 后端 `PUT /api/lists` 有**形状校验**：缺 `fav/recent/local` 或缺名字 → 400 且不半写
- [ ] `boot()` 读列表：**后端优先 + 旧 storage 回落** 两条路都在
- [ ] onChanged 回环用**内容比较**（`listNamesKey()`），不是「打标记忽略下一次」
- [ ] `playlist.json` 的 `id` / `url` 字段格式**一个字节没改**
- [ ] `normalizeAppUrl` / `withSession` / `go` 跳板 / `trackKey` / 那几个 storage key **没被动**
- [ ] `lib/cookies.js` 的读取用于 `search_music` 的 server 自适应（不是另写一套）
- [ ] 清洗规则**照知识库三条硬规则**：版本标记保留、`A - B` 阈值 3、歌手宁缺毋滥
- [ ] 时长校验是**软参考**（>60s 才标存疑），**没有**用 10s 那种硬门槛
- [ ] `/mood` 注册不在 `apply` 顶层；manifest **没扩权**（无 `app/session.start-turn`）
- [ ] 前端仍是 ES5，无构建步骤、无 ES6+ 语法
- [ ] `tools/play.js` 那句「30 秒合并」假注释已处理（删或变真）

## C. 真机链路（codex 做不了，我或用户执行）

前置：整包同步 `ui/` → `~/.hanako/apps/hanako-simple-player/`；然后
`extension_manager reload app:hanako-simple-player`。

1. [ ] 敲 `/mood` → App 回引导语（不是沉默、不是报错）
2. [ ] 顺着说一句 → agent 能接上，出抉择
3. [ ] agent 调 `hana_simple_search_music` 搜库里没有的歌 → 结果**可播**、名字干净、有封面
4. [ ] agent 调 `hana_simple_create_list` 落「今日心情」→ **开着的卡片立刻看到**（不重载）
5. [ ] 手动在界面改歌单名 → 刷新 → 名字还在（改名持久化没退化）
6. [ ] 同一个名字再落一次 → **覆盖**（条数变、不新增歌单）
7. [ ] 播放新歌单里的歌 → 真出声、封面/歌词正常

## D. 边界与破坏性检查

- [ ] `create_list` 空 tracks / 超长名 / 含 `/:*?"<>|` 的名字 → 不炸、不写出脏数据
- [ ] 搜索匹配不到网易云时 → 保留原始结果，**不丢曲目**
- [ ] 后端 `/api/lists` 不可用时前端回落 → 不丢名字、不白屏
- [ ] 升级模拟：假装旧版 `player-lists` 只在 storage 里 → 新版能读到并沿用

## E. 判卷标准（写前面，别事后找理由）

**通过** = A 全绿 + B 无高危项 + C 六项全过 + D 无炸。
**有条件通过** = A 全绿、C 有一项挂但可解释且不影响主链路 → 记录，继续。
**打回** = A 有红 / B 动了禁区 / C 的 3、4、5 任一挂。

打回时：只指出**原始证据**（哪条断言、哪次现象），不说「感觉不对」。

# AUDIO-OWNER-HANDOFF-TO-CODEX · 交给 Codex 的收尾

> 由哦鲸鲸整理，2026-10-13。用户决定：**接下来由 Codex 接手**（Hana 无法在宿主退出/启动的空档里操作，恢复只能由用户在终端做）。
> 本轮 Hana 侧已完成：扩查（8 份证据）、汇总、验收维持「未通过」、给 Codex 的返修 prompt。**未改任何生产源码 / 断言 / manifest / 版本 / build / app-data。**

---

## 1. 复制这段给 Codex

**直接复制整份 `docs/player-ui/handoffs/AUDIO-OWNER-CODEX-PROMPT-2.md`**（含两条轨道：轨道一 App 内 Web Locks 自愈，轨道二宿主最小接口规格）。

要点预告：
- **轨道一**：`navigator.locks` 的锁由文档持有、文档销毁时浏览器自动释放 → 抢到锁 = 旧 owner 已死。已用系统 Chrome 复刻宿主拓扑实测通过（卡片 iframe 与拖出窗 iframe 共享同一把锁）。最小落点：前端 `initAudioOwner` 持锁、`claimAudio` 带 `reap`；后端 `claim` 在 restore 守卫前插清点、`stop` 补逃生口；`owns()`/`yield`/`handoff` 一字不改。
- **轨道二**：宿主内部有代次记账但不留墓碑；最小改法是给已有撤销路径补墓碑 + 在卡 chrome 门加只读 `active/ended/unknown`，`documentId` 复用 `viewHandle`。**只产出规格文档，不动宿主。**

## 2. 用户当前的播放器怎么救（终端一条命令）

Hana 做不到（Cmd+Q 会让它自己一起消失），只能用户手动：

```sh
F="$HOME/.hanako/app-data/hanako-simple-player/storage/global.json" && \
cp "$F" "$F.bak-$(date +%s)" && \
python3 -c "import json,sys;p=sys.argv[1];d=json.load(open(p));d['entries'].pop('player-audio-owner',None);json.dump(d,open(p,'w'),ensure_ascii=False);print('owner cleared')" "$F"
```

① Cmd+Q **完全退出** Hana（关窗口不算）；② 终端执行，看到 `owner cleared`；③ 重开 Hana。

已在副本上验证：只删 `player-audio-owner` 一个键，歌单 / 播放状态 / 其余键原样保留。**这是绕过不是修复**——不落地轨道一或轨道二，每次宿主重启都会再犯。

## 3. 交接给 Codex 的清单

| 项 | 位置 |
|---|---|
| 扩查汇总（先读这份） | `AUDIO-OWNER-ORPHAN-HOST-EXPANDED.md` |
| 8 份并行探查报告 | `audio-owner-1.1.1/probe-expanded-20261013-hana/01..08` |
| 给 Codex 的返修 prompt | `AUDIO-OWNER-CODEX-PROMPT-2.md` |
| 上一轮验收（未通过） | `AUDIO-OWNER-ACCEPT-1.1.1.md` |
| 上一轮返修（根因确认） | `AUDIO-OWNER-ORPHAN-REPAIR.md` |
| 任务书（唯一需求来源） | `docs/TASK-audio-owner-1.1.1.md` |

**状态**：1.1.1 / build 1003131679，**验收未通过（阻塞）**，不发布、不启动第二个 Codex。Codex 返修完成后按协作约定直接回 Hana 复验。

**仓库并发**：`docs/TASK-mood-onestep-1.1.2.md` 等在途改动保留未动；Hana 本轮未触碰任何生产文件。

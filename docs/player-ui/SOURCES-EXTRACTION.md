# 音源脱敏：节点抽成外置文件 + 导入入口（SOURCES-EXTRACTION）

2026-10-11。罐头反馈：搜索页用的那些源地址（Meting 公共节点）属灰色资源，
不能推送到仓库；仓库刚装就带着它们。要求把地址抽成一个可分享的文件，
搜索页改成「导入」这个文件。

改动落在 `manifest.json` / `lib/sources.js`（新）/ `lib/meting.js` /
`lib/register-routes.js` / `tools/apply-sources.mjs`（新）/ `sources.example.json`（新）/
`.gitignore` / `ui/{index,standalone}.html` / `ui/app.js` / `ui/style.css` /
`tools/verify-backend.mjs` / `tools/verify-ui.mjs`。

---

## 1. 平台硬约束（决定整个方案形状）

宿主给 App 的出站网络是白名单 `manifest.network.allowedHosts`，它是**清单里的静态表，
运行时加不了主机**（APPS.md「出站网络」：主机必须在 `allowedHosts` 里，名单外一律拒
`PLUGIN_NETWORK_HOST_NOT_ALLOWED`）。

推论：**「导入音源文件」本身不能让搜索连上。** 导入只把地址存到本机；主机还必须写进
本机安装目录的 `manifest.json` 并 reload 一次（首次弹审核卡批新主机，一次性）。
这是平台约束，不是实现偷懒。

所以方案 = **导入文件 + 跑一次 apply 脚本**（罐头拍板选「本地 apply 脚本」，
不养中转服务）。

## 2. 分层：什么进仓库，什么不进

| 文件 | 进仓库？ | 内容 |
|---|---|---|
| `manifest.json` | ✅ | 只留公共接口：`music.163.com` / `api.bilibili.com` / `u.y.qq.com` / `*.music.126.net` / `amll-ttml-db…` / `*.hdslb.com` / `*.bilivideo.*`。**4 个节点域名已摘掉。** |
| `sources.example.json` | ✅ | 占位模板（无真实地址），说明格式 |
| `sources.json` | ❌（gitignore） | **真实节点** —— 这就是发给别人 / 丢群里分享的文件 |
| `{dataDir}/sources.json` | ❌（不在仓库） | 应用运行时实际读的那份（导入写入） |

`lib/meting.js` 里不再有任何节点地址，运行时从 `{dataDir}/sources.json` 读。

## 3. 分享文件格式（`sources.json`）

```json
{
  "version": 1,
  "name": "公共 Meting 节点（2026-10-11）",
  "nodes": [
    "https://<节点1>/meting/api",
    "https://<节点2>/meting/"
  ]
}
```

兼容裸数组 `["https://…"]`。地址必须 `https://`，重复自动去重。

## 4. 三步走（拿到分享文件的人）

```bash
# 1) 导入（App 内点「导入音源」选文件，或手动放到 dataDir）
cp sources.json ~/.hanako/app-data/hanako-audio-player/sources.json

# 2) 把节点主机写进本机安装目录的 manifest（仓库那份不动）
node tools/apply-sources.mjs
#    · 找不到 nodes 时可显式给路径：node tools/apply-sources.mjs path/to/sources.json
#    · 只想看会写什么：--print / --check
#    · 会备份 manifest.json.bak-sources

# 3) 重载（首次会弹审核卡批新主机，一次性）
#    extension_manager reload app:hanako-audio-player
```

## 5. 兜底：没导入节点时会掉什么、留什么（实测）

| 平台 | 未导入节点 | 依据 |
|---|---|---|
| 网易云 | **仍可搜可播可出词**（走官方 `music.163.com`，已在白名单） | 实测 `search/get/web` 无 cookie 即回完整结果；`song/enhance/player/url` 免费曲 code=200 有 url、VIP 曲 404 无 url；`song/lyric` 正常 |
| B站 | **完全不受影响**（`api.bilibili.com` 独立一路） | 实测搜「周杰伦」回 20 条 |
| QQ | **搜索失效**（只有节点这一条路，无公共接口可回退） | 实测官方 `u.y.qq.com` 搜索接口返回 0 条 |
| 酷狗 | **搜索失效** | 同 QQ |

前端据此在搜索页顶部给一条**真实**提示条：未导入 → 「QQ/酷狗 搜不了，导入后可跨源」；
已导入但主机没进白名单 → 明确说「跑一次 `node tools/apply-sources.mjs` 再 reload」。
点 QQ 搜索且未配置时，后端回 `code:"NO_SOURCES_CONFIGURED"`，前端提示「要导入音源才能搜」。

> 注：网易官方搜索会把翻唱顶前面（实测「晴天」首条是翻唱）。节点搜索同样如此 ——
> 导入节点拿回的是**覆盖平台**（QQ/酷狗），不是改善网易排序。

## 6. 后端契约

- `GET /widget/api/sources` → `{ ok, exists, count, hosts[], pendingHosts[], applied, file }`
  `pendingHosts` = 节点主机里还没进本机 manifest 白名单的；`applied` = 已生效。
- `POST /widget/api/sources` `{ path }` 或 `{ nodes: [...] }` → 校验后写 `{dataDir}/sources.json`，
  回同样的状态（含 `pendingHosts`）。**不改白名单**（那是 apply 脚本的活）。
- 节点未配置时，`search` / `playlist` / `song` 对 netease 回退官方接口，
  其余 server 回 `{ ok:false, code:"NO_SOURCES_CONFIGURED" }`（HTTP 200，便于前端统一处理）。
- `lrc` 对 netease 同样回退官方歌词接口。

## 7. 验收

- `node tools/verify-backend.mjs` **10/10**（夹具补了 `sources.json`，否则 meting 路径按新行为回 NO_SOURCES）
- `node tools/verify-ui.mjs`：新增三条断言
  - `sources-bar-shown-when-not-applied`（none / pending 两态都露出，且 pending 给出 apply 指引）
  - `sources-bar-hidden-when-applied`
  - `sources-qq-search-tells-user-to-import`

## 8. ⚠️ 还没做的一步：已推送的历史

**4 个节点域名早已在公开 fork 上**（`wqh0201-stack/openhanako-audio-player` 的 `hana-simple`
分支，`lib/meting.js` 与 `manifest.json`）。本次改动只保证**新版本干净**，
旧 commit 里仍有。清理旧历史要重写公开分支（`git filter-repo` + 强推），
属破坏性操作，须先跟罐头确认再做。

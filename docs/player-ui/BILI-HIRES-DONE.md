# B站高码率音源：登录解锁 Hi-Res FLAC / 杜比

2026-10-11。基于 `bdccca5`（1.0.0）实现，实测环境：本机直连 `api.bilibili.com`（非代理间接结论）。

## 一句话

B站匿名取流封顶 **AAC 192K**（`30280`）；带上登录 cookie（至少 `SESSDATA`）后，`playurl` 会吐出 **Hi-Res 无损 FLAC**（`30251`，实测 1.6–3.2 Mbps）和 **杜比全景声 EC-3**（`30250`）。接线只在「问接口要清单」那一步补一个 `Cookie` 头，**拉流本身不校验 cookie**（UA + Referer 即可，实测 206）。

## 改动（4 文件）

| 文件 | 改动 |
|---|---|
| `lib/cookies.js` | 重写为「读 / 写 / 清 / 验活 / 掩码 / 形状校验」一体的凭据层。新增 `BILIBILI_COOKIE`，存 `app-data/<appId>/bilibili.env`（与网易云/腾讯的 `cookies.env` 分文件、读取时合并）。对外只回显掩码片段，**绝不打印明文**。 |
| `lib/bilibili.js` | `resolveBiliAudio(ctx, bvid, cid, { cookie })`：`fnval=16 → 4048`（取全部 DASH 流）、带 cookie、新增 `pickBestAudio()` 按带宽在 AAC/FLAC/杜比里挑最高。**返回对象** `{ url, id, bandwidth, kind, cid }`；保留 `resolveBiliAudioUrl()` 字符串兼容层。 |
| `lib/register-routes.js` | 修断口 + 传 cookie（仅 8 行）：`const best = await resolveBiliAudio(ctx, bvid, cid, { cookie: BILIBILI_COOKIE }); const url = best.url;` |
| `manifest.json` | `network.allowedHosts` 加 `*.mountaintoys.cn`（属扩权，随本轮 reload 重新审批）。 |

## 三个实测钉住的事实

1. **`flac.display: true` 是诱饵**：匿名时 `dash.flac = { display: true, audio: null }`。「display」只表示这支视频**有** Hi-Res 可选，不代表能取到 —— **判据一律看 `audio` 是否为对象，别信 display**。
2. **B站形状不一致**：`dash.dolby.audio` 是**数组**，`dash.flac.audio` 是**对象**。第一版 `pickBestAudio` 只认对象会整条漏掉杜比，已用 `firstOf` 归一。
3. **别被标题骗**：抽样 13 支标题挂「Hi-Res / 无损」的视频，登录后只有 4 支真带 `30251`，其余是 192K 冒充。

## 端到端实测（真实网络）

| 状态 | 选中音轨 | 码率 | 拉流 |
|---|---|---|---|
| 匿名 | `30280` AAC | 184 kbps | HTTP 206 |
| 登录（年度大会员）| `30251` FLAC | 3155 kbps / 106 MB | HTTP 206 |

登录态仅需 `SESSDATA` 一项。本机账号是年度大会员（vipType=2），因此**分不出「大会员是否必需」**；网上两种说法都有，保守表述为「登录即够」。

## 落地障碍与处置

- **白名单**：高码率 FLAC 直链多数落在既有 `*.bilivideo.com` / `*.bilivideo.cn` 内，个别落 `*.mountaintoys.cn`（名单外、会被宿主直接拒）。已补这条。改 manifest = 扩权，随本轮 reload 走审批。
- **凭据不进仓库**：cookie 存 `app-data/hanako-simple-player/bilibili.env`（600），键名 `BILIBILI_COOKIE`，格式与既有 `cookies.env` 一致。读不到就回退匿名路径，不报错。

## 验收

- 语法：3 个 lib 文件 `node --check` 全过。
- 凭据层单测 15/15（含「匿名不被 `flac.display` 骗」「登录选 30251」「杜比数组可取」「写 B站不覆盖网易云」「掩码不泄明文」）。
- `verify-backend.mjs` 22/22，无回归。
- 真实网络端到端：见上表。

## 未做 / 边界

- **UI 层未接线**：本轮只做后端取流 + 凭据层。前端的「喂 cookie」入口（README / agent 工具 / 首启提示引导用户登录解锁）是后续的事，与网易云统一成一套，见罐头「本身网易云也能喂 cookie，做一起比较优雅」的方向。
- 未在真机播放器里逐一验听感（自动取流路径已端到端实测，听感由真机验收）。

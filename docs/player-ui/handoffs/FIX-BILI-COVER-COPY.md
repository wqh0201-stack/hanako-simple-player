# B站封面防盗链 + 复制歌名同步化（真机反馈修复）

日期：2026-10-11 · 分支 `hana-simple` · 基线 HEAD `20efef4`（build `1003131655`）
交付：`ui/app.js`、`tools/verify-ui.mjs`、`docs/player-ui/FIX-BILI-COVER-COPY.md`
（未 bump-build、未部署、未 reload）

两个真机反馈：B站歌没封面、复制歌名提示「复制失败」。

---

## 1. B站封面缺图（根因：图床 Referer 防盗链）

**实测**（curl `https://i2.hdslb.com/bfs/archive/….jpg`）：空 Referer → 200；
`https://www.bilibili.com/` → 200；**App 页面地址 → 403**。网易云图 + 页面 Referer → 200。

**机制**：B站图床只认空 Referer 或自家域名；浏览器加载任何子资源（`background-image` /
`<img>` / `new Image()`）都会自动带当前页 Referer → B站封面全被 403。数据没丢
（`playlist.json` 里 `pic` 有值），只是加载被拒。

**项目已有解法**：后端 `/widget/api/music/cover`（`lib/register-routes.js:1113`）拉图时替换
`Referer: https://www.bilibili.com/`；`msArtwork()`（媒体会话封面）已在用，但队列行 / 舞台 /
搜索 / 热门 / 分P缩略图 / 取色全都没走它。

**改法**：新增 `coverSrc(pic)` 纯函数（`ui/app.js`，紧贴 `coverImage()` 上方）：

```js
function coverSrc(pic) {
  var url = String(pic || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return url;                 // 只代理 http(s) 绝对地址
  if (url.indexOf(API + '/') === 0 || url.indexOf('/api/apps/') === 0) return url;  // 别双重代理
  var host = '';
  try { host = new URL(url, location.href).hostname; } catch (e) { return url; }
  if (!/(^|\.)hdslb\.com$/i.test(host)) return url;           // 只拦 B站图床，网易云等原样
  return API + '/widget/api/music/cover?url=' + encodeURIComponent(url);
}
```

- 返回值**不带** session，由调用点既有 `withSession()` 统一贴（对照 `msArtwork`）。
- 统一接入的 **8 处**：`coverImage` / `coverStageImage` / `coverUrlOnly`（舞台、暗层）、
  `ambientUrl`（取色，param 只对 `.music.126.net` 生效、代理 URL 不含它故不误加）、
  `probeCover`（画幅探测 `new Image()`）、分P缩略图（`bili-pcover` 内联 style）、
  搜索结果封面（`renderSearchResultCovers`）、`coverVars`（热门/榜单/电台卡片）。
- `msArtwork()` **保持原样**（它本就走代理）。
- 同源后 `getImageData` 必然不 taint，取色更稳。

## 2. 复制歌名「复制失败」（根因：手势激活过期）

`hana.clipboard.writeText` 是 iframe → `postMessage` → 宿主 renderer 的**异步往返**；
等宿主真执行 `navigator.clipboard.writeText` 时，这次点击的**用户激活已过期**，
Chromium 拒绝写入。用户收到「复制失败」（而非「不支持」=请求发出去了、被宿主拒）。

**改法**：新增 `copyTextSync(text)`（返回 boolean，绝不 await；临时 textarea 用
**`position:absolute`**，不用沙箱禁的 `fixed`）。`#copyNameBtn` 处理器改为：

1. 拿到 `name` 后，**第一件事**同步 `copyTextSync(name)`；
   成功 → `closePops()` + `toast('已复制歌名')` + return。
2. 同步失败 → `closePops()`，退回 `hana.clipboard.writeText(name)`（异步兜底）：
   resolve → 成功 toast，reject → `toast('复制失败')`。
3. 无 `window.hana.clipboard` → `toast('当前环境不支持复制')`。

同步那一步钉在**手势第一行**（先于任何 DOM 操作 / await）—— 用户激活是一次性的，
中间插 `await` 会让同一个 bug 以更隐蔽的方式回来。

---

## 3. 验收

`node tools/verify-ui.mjs` → **268/268**（原 266 + 新增 2；自检 12/12、窄卡 4/4、
`wiringOk` / `migrationOk` / `lifecycleOk` 全 true、零运行时错误）
`node tools/verify-backend.mjs` → **30/30**

### 断言改动（改 1 / 加 2）

| 断言 | 性质 | 内容 |
|---|---|---|
| `copy-song-name-writes-clipboard` | **有意修正** | ⚠️ 2026-10-11 复制改同步 `execCommand` 优先。旧断言只验 `clipboard.writeText` 被调；新链路同步优先，同步成功不再走 SDK。改为验 `execCommand` 被调一次、文本=歌名（无歌手）、`writeText` **未被调**、出 toast。 |
| `copy-song-name-sync-fallback` | 新增 | 桩 `execCommand` 返 **false**、`clipboard.writeText` resolve → 验退回异步链路、入参仍是歌名、toast 成功。 |
| `cover-src-proxies-hdslb` | 新增 | `coverSrc` 四口径：hdslb → 同源代理（含 `url=`）、网易云 → 原样、本 App 路由 → 原样、相对/空 → 原样。 |

第 8 段假宿主桩从「只拦 clipboard」扩成「同时拦 `document.execCommand('copy')`」，
用 `window.__forceExecFalse` 切 true / false 两支（无头 `execCommand` 返回值不可靠，
桩死才确定性可验）。

`bili-cover-survives-nocover` / `bili-parts-inherit-cover` 用测试夹具
`${API}/_fixture/cover.png`（本 App 路由）→ `coverSrc` 原样返回，仍绿。

## 4. 真机清单（无头证不全，交统筹线）

- B站歌封面在**队列行 / 舞台 / 搜索结果 / 分P缩略图**四处出现，且环境色正常取出。
- 网易歌封面不回退、不变慢（`coverSrc` 对它原样返回，不多绕一层）。
- 「复制歌名」到系统剪贴板、歌名正确（不带歌手）。

## 5. 约定

- `coverSrc` 只拦 `*.hdslb.com`；以后遇到别的防盗链图床，在同一处扩 host 判据。
- `copyTextSync` 保持同步、返回 boolean；同步失败必须有异步兜底。

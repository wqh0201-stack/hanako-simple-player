/**
 * lib/bilibili.js — B站音源（搜视频抽音轨）。
 *
 * B站不在 Meting 支持范围，官方「音频区」接口已被降级过滤
 * （search_type=audio → code:-1200），唯一可行的是「搜视频 → 取 cid → 取 DASH 音频流」：
 *
 *   search:   x/web-interface/wbi/search/type?search_type=video&keyword=…  → bvid
 *   pagelist: x/player/pagelist?bvid=…                                     → [{cid,page,part,duration}]
 *   view:     x/web-interface/view?bvid=…                                  → cid（= P1 的 cid）
 *   playurl:  x/player/playurl?bvid=…&cid=…&fnval=16                       → dash.audio[].baseUrl
 *
 * 实测（2026-10-10 / 2026-10-11，详见知识库《音乐音源探活与层级》）：
 *   · 搜索无需签名，连打 5 次不触发风控
 *   · 音频是标准 fMP4，支持 Range 206，不防盗链（带 / 不带 Referer 都 200）
 *   · 普通音质免 cookie；baseUrl 有效期约 120 分钟
 *   · page_size 上限 50；playurl 必须 bvid + cid 同给（只给 cid 回 -400）
 *
 * ⚠️ **分P（多 P 视频）**：`search/type` 的回包里**没有任何字段**说明这条视频是不是多 P
 *    （`episode_count_text` 只对课程/番剧这类 PGC 有值，UGC 分P视频一律空串），分P数和每 P 的
 *    标题只能从 `x/player/pagelist` 拿。`view.data.cid` 恒等于 **P1 的 cid**，所以在接分P之
 *    前，「播 B站视频」永远只能播到第一 P、也拿不到任何一 P 的 `part` 标题。
 *    另：`view.data.pages[]` 与 pagelist 同形（还多带 pic/title），但 pagelist 更轻、专为分P而生，
 *    本模块两条路都留着——分P列表走 pagelist，单曲取流走 view（只取 cid）。
 *
 * 取流仍走同源分片代理（与 Meting 同路），不把 CDN 地址直接交给 <audio>。
 */

const SEARCH_API = "https://api.bilibili.com/x/web-interface/wbi/search/type";
const VIEW_API = "https://api.bilibili.com/x/web-interface/view";
const PAGELIST_API = "https://api.bilibili.com/x/player/pagelist";
const PLAYURL_API = "https://api.bilibili.com/x/player/playurl";

const BILI_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  Referer: "https://www.bilibili.com/",
};

/** 搜索结果的 title 带 <em class="keyword"> 高亮标签，去掉标签与常见实体。 */
function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** 封面可能是协议相对地址（//i2.hdslb.com/…），补上 https:。 */
function fixPic(u) {
  const s = String(u || "").trim();
  return s.startsWith("//") ? "https:" + s : s;
}

/** "4:30" / "1:02:03" → 秒；解析不了给 0。 */
function parseDuration(v) {
  const parts = String(v || "").split(":").map((x) => parseInt(x, 10));
  if (!parts.length || parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * 搜视频。返回与 Meting 同一套字段（id/title/author/pic/dur）。
 *
 * 分页：
 *   page     页码，从 1 起（路由按 offset/limit 换算后透传）。
 *   limit    每页条数，作为 page_size 透传（B站接口认，实测 page_size=30 回 30 条）。
 *   total    取 data.numResults。⚠️ **B站把它截顶在 1000**（实测超 1000 一律回 1000），
 *            所以这是「近似/上限值」，不是精确总数；页码边界以 numPages 为准（最多 50 页）。
 */
export async function searchBili(ctx, { keyword, limit = 30, page = 1 }) {
  if (!keyword || !String(keyword).trim()) {
    throw Object.assign(new Error("keyword required"), { code: 400 });
  }
  const pg = Math.max(1, Number(page) || 1);
  const per = Math.min(Math.max(Number(limit) || 30, 1), 50);
  const url = `${SEARCH_API}?search_type=video&keyword=${encodeURIComponent(keyword)}&page=${pg}&page_size=${per}`;
  const res = await ctx.network.fetch(url, { method: "GET", headers: BILI_HEADERS, timeoutMs: 10000 });
  if (!res.ok) throw new Error(`bilibili search HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  const list = data && data.data && Array.isArray(data.data.result) ? data.data.result : [];
  const results = list
    .slice(0, limit)
    .map((it) => ({
      id: String(it?.bvid || "").trim(),
      title: stripHtml(it?.title) || "未命名",
      author: String(it?.author || "").trim(),
      pic: fixPic(it?.pic),
      dur: parseDuration(it?.duration),
    }))
    .filter((x) => x.id);
  const numResults = Number(data?.data?.numResults);
  return { results, host: "api.bilibili.com", total: numResults > 0 ? numResults : list.length };
}

/**
 * 分P列表（多 P 视频）。返回 [{cid, page, part, dur}]；单 P 视频返回长度 1 的数组
 * （`part` 就是视频标题）。
 *
 * ⚠️ 这是「这条视频是不是多 P / 有几 P / 每 P 叫什么」的唯一来源——搜索结果里没有。
 * 实测轻量（~200ms），36 次连打（并发 8）全 code:0、无风控，可以放心按需查。
 */
export async function listBiliParts(ctx, bvid) {
  const id = String(bvid || "").trim();
  if (!id) throw new Error("bvid required");
  const res = await ctx.network.fetch(`${PAGELIST_API}?bvid=${encodeURIComponent(id)}`, {
    method: "GET",
    headers: BILI_HEADERS,
    timeoutMs: 10000,
  });
  if (!res.ok) throw new Error(`bilibili pagelist HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  const list = Array.isArray(data?.data) ? data.data : [];
  const parts = list
    .map((p) => ({
      cid: Number(p?.cid) || 0,
      page: Number(p?.page) || 0,
      part: String(p?.part || "").trim(),
      dur: Number(p?.duration) || 0,
    }))
    .filter((p) => p.cid > 0);
  return { parts, videos: parts.length };
}

/**
 * 取一条 B站视频（或它的某一 P）的音频直链：cid 缺省时 view 拿 P1 的 cid，再 playurl。
 * 多音轨时选带宽最高的（普通账号一般到 192K，会员才有 Hi-Res）。
 *
 * @param ctx
 * @param bvid BV 号
 * @param cid  可选：指定分P。给了就不再查 view（省一次请求，也避免拿到 P1 的 cid 覆盖它）。
 *             前端传下来的合成 id 是 `bilibili:<bvid>_<cid>`，go 路由拆好后透传到这里。
 * 任何一步拿不到就抛，由调用方（go 路由）决定降级 / 重试。
 */
export async function resolveBiliAudio(ctx, bvid, cid) {
  let useCid = Number(cid) > 0 ? Number(cid) : 0;
  if (!useCid) {
    const vres = await ctx.network.fetch(`${VIEW_API}?bvid=${encodeURIComponent(bvid)}`, {
      method: "GET",
      headers: BILI_HEADERS,
      timeoutMs: 10000,
    });
    if (!vres.ok) throw new Error(`bilibili view HTTP ${vres.status}`);
    const vdata = await vres.json().catch(() => null);
    useCid = Number(vdata?.data?.cid) || 0;
  }
  if (!useCid) throw new Error("bilibili cid not found");

  const purl = `${PLAYURL_API}?bvid=${encodeURIComponent(bvid)}&cid=${useCid}&fnval=16&fourk=1`;
  const pres = await ctx.network.fetch(purl, {
    method: "GET",
    headers: BILI_HEADERS,
    timeoutMs: 10000,
  });
  if (!pres.ok) throw new Error(`bilibili playurl HTTP ${pres.status}`);
  const pdata = await pres.json().catch(() => null);
  const audios = pdata?.data?.dash?.audio;
  if (!Array.isArray(audios) || !audios.length) throw new Error("bilibili audio not found");
  audios.sort((a, b) => (b?.bandwidth || 0) - (a?.bandwidth || 0));
  const best = audios[0];
  return String(best?.baseUrl || best?.backupUrl?.[0] || "");
}

/**
 * 分P的稳定 id：`<bvid>_<cid>`；单 P 视频保持裸 bvid。
 *
 * 为什么要带 cid：go 路由的 path 只有 id 一个字段。同一支视频的所有 P 若共用裸 bvid，
 * 落库时会被当同一首去重成一条（134 P 塔成 1 条），所以分P必须把 cid 编进 id。
 * 分隔符用 `_`：go 路由的校验是 `[A-Za-z0-9_-]+`，下划线放行；bvid 里没有 `_`，不会歧义。
 */
export function biliTrackId(bvid, cid) {
  const b = String(bvid || "").trim();
  const c = Number(cid) || 0;
  return c > 0 ? `${b}_${c}` : b;
}

/** `biliTrackId` 的逆运算：`BV1xx_12345` → { bvid, cid }；裸 bvid → cid 0（取 P1）。 */
export function parseBiliTrackId(rawId) {
  const s = String(rawId || "").trim().replace(/^bilibili:/, "");
  const m = /^([A-Za-z0-9]+)_(\d+)$/.exec(s);
  if (m) return { bvid: m[1], cid: Number(m[2]) };
  return { bvid: s, cid: 0 };
}

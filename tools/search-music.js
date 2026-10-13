import path from "node:path";
import { loadCookies } from "../lib/cookies.js";
import { readLibrary } from "../lib/library.js";
import { searchBili } from "../lib/bilibili.js";
import { searchMusic, searchNeteaseOfficial, getLyric, extractTrackId, PREFERRED_NODE } from "../lib/meting.js";
import { cleanMusicMetadata, singerPrefixes, pickMetadataMatch } from "../lib/music-metadata.js";

export function makeSearchMusicTool(ctx) {
  const appId = path.basename(ctx.dataDir);
  const goBase = `/api/apps/${appId}/routes/widget/api/music/go`;
  return {
    name: "hana_simple_search_music",
    description: "在在线音源里搜歌，拿到可直接播放的曲目。当用户想听库里没有的新歌，或让你按某位歌手、某个主题推荐时用。返回结果里的 source 原样传给 hana_simple_create_list 或 hana_simple_play 即可播放。默认搜 B站：不需要会员就能拿到可播地址，对大多数用户最可靠；如果这位用户已配置网易云 cookie，则自动改用网易云（歌名和歌词更干净）。QQ 和酷狗常常只有歌曲信息、没有可播地址，非必要别用。返回的曲目已清洗标题，并尽量到网易云补齐封面与歌词；匹配不到就保留原始结果。",
    sessionPermission: { readOnly: true },
    parameters: { type: "object", required: ["keyword"], properties: {
      keyword: { type: "string", description: "歌名、歌手或主题。" },
      server: { type: "string", enum: ["bilibili", "netease", "tencent", "kugou"], description: "可选；已配网易云 cookie 默认网易云，否则默认 B站。" },
      limit: { type: "number", default: 10, description: "默认 10，最大 30。" },
    } },
    async execute({ keyword, server, limit = 10 } = {}) {
      try {
        if (typeof keyword !== "string" || !keyword.trim()) throw new Error("keyword required");
        const cookies = loadCookies(ctx.dataDir);
        const selected = server === undefined ? (cookies.NETEASE_COOKIE ? "netease" : "bilibili") : server;
        if (!["bilibili", "netease", "tencent", "kugou"].includes(selected)) throw new Error("invalid server");
        const max = Math.min(Math.max(Math.floor(Number(limit)) || 10, 1), 30);
        let found, official = false;
        if (selected === "bilibili") found = await searchBili(ctx, { keyword, limit: max });
        else if (selected === "netease") {
          try {
            found = await searchNeteaseOfficial(ctx, { keyword, limit: max, cookie: cookies.NETEASE_COOKIE });
            official = true;
          } catch (err) {
            ctx.logger?.warn?.(`[search-music] 官方搜索失败，回落同源 Meting: ${err?.message}`);
            found = await searchMusic(ctx, { keyword, server: selected, limit: max });
          }
        } else found = await searchMusic(ctx, { keyword, server: selected, limit: max });
        found.results = found.results.slice(0, max);
        let library = [];
        try { library = readLibrary(ctx); }
        catch (err) { ctx.logger?.warn?.(`[search-music] 前缀统计不可用: ${err?.message}`); }
        const prefixes = singerPrefixes(library), searches = new Map(), lyrics = new Map();
        const once = (cache, key, fetch) => {
          if (!cache.has(key)) cache.set(key, fetch());
          return cache.get(key);
        };
        const results = new Array(found.results.length);
        let cursor = 0;
        async function worker() {
          while (cursor < found.results.length) {
            const index = cursor++, track = found.results[index];
            const clean = cleanMusicMetadata(track, { server: selected, prefixes });
            const id = track.id || extractTrackId(track.url);
            const source = id ? `${goBase}/${encodeURIComponent(id)}?server=${selected}` : track.url;
            if (!source) continue;
            const item = { source, ...clean, pic: track.pic || "", lrc: "", dur: Number(track.dur) || 0, matched: false };
            let metadata = official ? track : null;
            if (!metadata) {
              try {
                const query = clean.name;
                const candidates = await once(searches, query, () => searchNeteaseOfficial(ctx, { keyword: query, limit: 30, cookie: cookies.NETEASE_COOKIE }));
                const match = pickMetadataMatch(clean, item.dur, candidates.results);
                metadata = match?.hit || null;
                if (match?.suspect) item.matchWarning = `歌名匹配，时长相差 ${Math.round(match.difference)} 秒，元数据存疑`;
              } catch (err) { ctx.logger?.warn?.(`[search-music] 元数据补齐失败: ${err?.message}`); }
            }
            if (metadata) {
              const metaClean = cleanMusicMetadata(metadata, { server: "netease", prefixes });
              item.name = metaClean.name; item.author = metadata.author || metaClean.author;
              item.pic = metadata.pic || item.pic;
              if (!item.dur) item.dur = metadata.dur || 0;
              item.matched = true;
              try {
                const { lyric, url } = await once(lyrics, metadata.id, () => getLyric(ctx, { id: metadata.id, server: "netease" }));
                item.lrc = lyric;
                item.lrcUrl = url || `${PREFERRED_NODE}?server=netease&type=lrc&id=${encodeURIComponent(metadata.id)}`;
              } catch (err) { ctx.logger?.warn?.(`[search-music] 歌词补齐失败: ${err?.message}`); }
            }
            results[index] = item;
          }
        }
        await Promise.all(Array.from({ length: Math.min(3, results.length) }, () => worker()));
        const tracks = results.filter(Boolean);
        return { content: [{ type: "text", text: JSON.stringify({ server: selected, total: found.total, returned: tracks.length, tracks }) }] };
      } catch (err) { return { isError: true, content: [{ type: "text", text: err?.message || String(err) }] }; }
    },
  };
}

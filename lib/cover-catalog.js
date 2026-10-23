/** 网易云封面元数据。每个请求只取一页/一张专辑，便于 UI 取消和展示进度。 */
import fs from 'node:fs';
import path from 'node:path';
import { neteaseGate } from './netease-gate.js';

const BASE = 'https://music.163.com';
const TTL = 7 * 24 * 3600 * 1000;
const keyOf = s => String(s || '').normalize('NFKC').trim().toLowerCase();
const httpsPic = s => String(s || '').replace(/^http:/, 'https:');
// 同名歌手常有翻唱/冒充条目。只有作品量明显领先时才认官方身份；接近或都为 0 则要求用户写正式名。
function dominantArtist(candidates) {
  const unique = [...new Map(candidates.map(a => [String(a.id), a])).values()];
  if (!unique.length) return null;
  if (unique.length === 1) return unique[0];
  const sorted = unique.slice().sort((a, b) => (Number(b.albumSize) || 0) - (Number(a.albumSize) || 0));
  const top = Number(sorted[0].albumSize) || 0, second = Number(sorted[1].albumSize) || 0;
  return top > 0 && top >= 3 * Math.max(second, 1) ? sorted[0] : null;
}

export function createCoverCatalog(ctx, { delay = ms => new Promise(r => setTimeout(r, ms)), gate = neteaseGate } = {}) {
  const file = path.join(ctx.dataDir, 'cover-catalog-cache.json');
  let cache = {}, tail = Promise.resolve();
  const pending = new Map();
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d.version === 2) cache = d.entries || {}; } catch {}
  function persist() {
    // 有界缓存；只缓存完整且成功的元数据，不把网络错误当空专辑保存。
    const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 400);
    cache = Object.fromEntries(entries);
    try {
      fs.writeFileSync(file + '.tmp', JSON.stringify({ version: 2, entries: cache }));
      fs.renameSync(file + '.tmp', file);
    } catch (e) { ctx.logger?.warn?.('[cover-catalog] cache save failed: ' + e.message); }
  }
  async function request(url) {
    // 全实例共用队列，多窗口也不会同时扫网易接口。每次最多三次尝试。
    const work = tail.catch(() => {}).then(async () => {
      let last;
      for (let i = 0; i < 3; i++) {
        // 所有真实请求（含重试）都先过全局闸门：起始间隔 >= 2s。
        await gate.schedule();
        try {
          const res = await ctx.network.fetch(url, { method: 'GET', timeoutMs: 8000,
            headers: { 'User-Agent': 'Mozilla/5.0', Referer: BASE + '/' } });
          if (!res.ok) {
            const e = new Error('上游 HTTP ' + res.status); e.code = res.status;
            if (res.status === 405 || res.status === 429) { e.retryAfterMs = gate.cool(res.status); e.cooldown = true; }
            if (res.status >= 400 && res.status < 500) e.nonRetryable = true;
            throw e;
          }
          const d = await res.json();
          if (d.code !== 200 && !(url.includes('api.bilibili.com') && d.code === 0)) {
            const e = new Error(d.message || ('上游返回 ' + d.code));
            e.code = Number(d.code) || 0;
            // -462 是明确的账号验证拒绝，不是频率错误；保留业务码/原文并立即停止。
            if (e.code === -462) {
              e.requiresVerification = true; e.nonRetryable = true;
              e.upstreamMessage = d.message || ''; e.stage = 'verify';
            } else if (e.code === 405 || e.code === 429) {
              e.retryAfterMs = gate.cool(e.code); e.cooldown = true; e.nonRetryable = true;
            } else if (e.code >= 400 && e.code < 500) e.nonRetryable = true;
            throw e;
          }
          return d;
        } catch (e) { last = e; if (e.nonRetryable) break; }
      }
      throw last;
    });
    tail = work.catch(() => {});
    return work;
  }
  async function cached(key, load) {
    if (cache[key] && Date.now() - cache[key].at < TTL) return { ...cache[key].value, cached: true };
    if (pending.has(key)) return pending.get(key);
    const p = load().then(value => { cache[key] = { at: Date.now(), value }; persist(); return { ...value, cached: false }; });
    pending.set(key, p);
    try { return await p; } finally { pending.delete(key); }
  }
  return {
    async artist(name) {
      name = String(name || '').trim();
      if (!name || name.length > 80) throw Object.assign(new Error('请填写歌手名'), { code: 400 });
      return cached('artist:' + keyOf(name), async () => {
        const d = await request(BASE + '/api/search/get/web?' + new URLSearchParams({ s: name, type: '100', limit: '30', offset: '0' }));
        const all = d.result?.artists || [];
        const exact = all.filter(a => keyOf(a.name) === keyOf(name));
        const aliases = all.filter(a => (a.alias || []).some(n => keyOf(n) === keyOf(name)));
        // 正式名称优先于别名；搜索结果中确有别名自称「周杰伦」的其他上传者。
        const candidates = exact.length ? exact : aliases;
        if (!candidates.length) throw Object.assign(new Error('未找到同名歌手，请修改歌手名'), { code: 404 });
        const a = dominantArtist(candidates);
        if (!a) throw Object.assign(new Error('歌手身份不明确，请填写正式歌手名'), { code: 409 });
        return { artist: { id: a.id, name: a.name, aliases: a.alias || [] } };
      });
    },
    async search(title, artist) {
      title = String(title || '').trim(); artist = String(artist || '').trim();
      if (!title || title.length > 160 || artist.length > 80) throw Object.assign(new Error('歌名或歌手过长/为空'), { code: 400 });
      return cached('search:' + JSON.stringify([keyOf(title), keyOf(artist)]), async () => {
        const d = await request(BASE + '/api/search/get/web?' + new URLSearchParams({ s: title + (artist ? ' ' + artist : ''), type: '1', limit: '50', offset: '0' }));
        if (!d.result || (!Array.isArray(d.result.songs) && Number(d.result.songCount) !== 0)) throw new Error('歌曲搜索格式异常');
        return { tracks: (d.result.songs || []).map(s => ({ songId: s.id, title: s.name,
          aliases: s.alias || [], artists: (s.ar || s.artists || []).map(a => ({ id: a.id, name: a.name })),
          albumId: (s.al || s.album || {}).id, album: (s.al || s.album || {}).name || '',
          albumPublished: Number((s.al || s.album || {}).publishTime) || 0,
          albumSize: Number((s.al || s.album || {}).size) || 0,
          duration: (() => { const raw = s.dt != null ? s.dt : s.duration; return Number(raw) / 1000 || 0; })() })) };
      });
    },
    async albums(id, offset = 0) {
      if (!/^\d{1,12}$/.test(String(id)) || !Number.isInteger(offset) || offset < 0 || offset > 2000) throw Object.assign(new Error('bad artist id/offset'), { code: 400 });
      return cached('albums:' + id + ':' + offset, async () => {
        const d = await request(BASE + '/api/artist/albums/' + id + '?limit=100&offset=' + offset);
        if (!Array.isArray(d.hotAlbums)) throw new Error('专辑列表格式异常');
        return { albums: d.hotAlbums.map(a => ({ id: a.id, name: a.name, type: a.type || '',
          subType: a.subType || '', published: Number(a.publishTime) || 0,
          size: Number(a.size) || 0, pic: httpsPic(a.picUrl) })), more: !!d.more };
      });
    },
    async album(id) {
      if (!/^\d{1,12}$/.test(String(id))) throw Object.assign(new Error('bad album id'), { code: 400 });
      return cached('album:' + id, async () => {
        const d = await request(BASE + '/api/v1/album/' + id);
        const a = d.album, songs = d.songs || a?.songs;
        if (!a || !Array.isArray(songs) || (a.size > 0 && !songs.length)) throw new Error('专辑曲目格式异常');
        const pic = httpsPic(a.picUrl);
        if (!/^https:\/\/[^/]+\.music\.126\.net\//.test(pic)) throw new Error('专辑封面地址异常');
        return { tracks: songs.map(s => ({ songId: s.id, title: s.name, aliases: s.alias || [],
          artists: (s.ar || s.artists || []).map(ar => ({ id: ar.id, name: ar.name })),
          albumId: a.id, album: a.name, albumType: a.type || '', subType: a.subType || '',
          published: Number(a.publishTime) || 0, albumSize: Number(a.size) || 0,
          pic, duration: Number(s.dt || s.duration) / 1000 || 0 })) };
      });
    },
    async context(bvid) {
      if (!/^BV[A-Za-z0-9]{10}$/.test(String(bvid))) throw Object.assign(new Error('bad bvid'), { code: 400 });
      return cached('bili:' + bvid, async () => {
        const d = await request('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
        if (!d.data?.title) throw new Error('未读到合集标题');
        return { title: d.data.title };
      });
    },
  };
}

/** 持久“歌手 → 专辑 → 曲目”索引 + 封面/歌词复用。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getLyric as defaultLyricFetch } from './meting.js';
import { neteaseGate } from './netease-gate.js';

const TTL = 30 * 24 * 3600 * 1000;
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_COVER_FILES = 256;
const MAX_COVER_BYTES = 100 * 1024 * 1024;
const ALBUM_TYPE = /^(专辑|EP|Single|单曲)$/i;
const SAFE_IMAGE = /^image\/(jpeg|png|webp)$/i;
function sniffImageType(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

function atomicWrite(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function metaFile(base) { return base + '.meta.json'; }

export function createCatalogIndex(ctx, { coverCatalog, gate = neteaseGate, lyricFetch = defaultLyricFetch } = {}) {
  const file = path.join(ctx.dataDir, 'catalog-index.json');
  const coverDir = path.join(ctx.dataDir, 'catalog-covers');
  const lyricDir = path.join(ctx.dataDir, 'catalog-lyrics');
  for (const dir of [coverDir, lyricDir]) if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let data = { version: 1, artists: {}, albums: {}, albumLists: {} };
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (d.version === 1) data = { ...data, ...d };
  } catch {}
  const inflightCover = new Map(), inflightLyric = new Map();
  function saveNow() {
    try { atomicWrite(file, JSON.stringify(data)); }
    catch (e) { ctx.logger?.warn?.('[catalog-index] save failed: ' + e.message); }
  }
  function fresh(at) { return Number(at) > 0 && Date.now() - Number(at) < TTL; }

  async function artist(name) {
    name = String(name || '').trim();
    for (const a of Object.values(data.artists)) {
      if (fresh(a.at) && (a.name === name || (a.aliases || []).includes(name))) return a;
    }
    const r = await coverCatalog.artist(name);
    const a = r.artist;
    const out = { id: a.id, name: a.name, aliases: a.aliases || [], at: Date.now() };
    data.artists[String(a.id)] = out;
    saveNow();
    return out;
  }

  async function listAlbums(artistId, { refresh = false, maxPages = 1 } = {}) {
    const key = String(artistId);
    let list = data.albumLists[key];
    if (refresh || !list) list = { at: 0, albums: [], nextOffset: 0, more: true };
    // at 只在一次完整扫描结束后更新；30 天过期后从 0 重扫，但保留旧关系并只补缺失/过期详情。
    const stale = !fresh(list.at);
    if (stale && !list.more) list.nextOffset = 0;
    let pages = 0;
    while (pages < Math.max(1, maxPages) && (stale || list.more || !list.at)) {
      const page = await coverCatalog.albums(artistId, list.nextOffset || 0);
      const albums = page.albums || [];
      for (const a of albums) if (!list.albums.some(x => String(x.id) === String(a.id))) list.albums.push(a);
      list.nextOffset = (Number(list.nextOffset) || 0) + albums.length;
      list.more = !!page.more;
      // 未完成的全量/增量扫描不能把 at 刷新成“刚完整”；下轮继续游标。
      if (!list.more) list.at = Date.now();
      data.albumLists[key] = list;
      saveNow();
      pages++;
      if (!list.more) break;
    }
    if (!list.at && !list.more) { list.at = Date.now(); data.albumLists[key] = list; saveNow(); }
    return list;
  }

  function rank(a) {
    const type = String(a.type || '');
    if (/^专辑$/i.test(type)) return 0;
    if (/^EP$/i.test(type)) return 1;
    if (/^(Single|单曲)$/i.test(type)) return 2;
    if (!type && !/现场|演唱会|live|精选|合辑|greatest|best of/i.test(a.name || '')) return 0;
    return 9;
  }

  async function build(artistId, { limit = 8, refresh = false } = {}) {
    if (!/^\d{1,12}$/.test(String(artistId))) throw Object.assign(new Error('artistId 非法'), { code: 400 });
    const list = await listAlbums(artistId, { refresh, maxPages: 3 });
    const wanted = list.albums
      .filter(a => ALBUM_TYPE.test(String(a.type || '')) || (!a.type && !/现场|演唱会|live|精选|合辑/i.test(a.name || '')))
      .sort((a, b) => rank(a) - rank(b) || (Number(b.published) || 0) - (Number(a.published) || 0));
    const pending = wanted.filter(a => {
      const old = data.albums[String(a.id)];
      return refresh || !old || !fresh(old.at) || !Array.isArray(old.tracks);
    });
    const batch = pending.slice(0, Math.max(1, Math.min(20, Number(limit) || 8)));
    const errors = [];
    let done = wanted.length - pending.length;
    for (const a of batch) {
      try {
        const d = await coverCatalog.album(a.id);
        const tracks = d.tracks || [];
        const pic = (tracks.find(t => t.pic) || {}).pic || a.pic || '';
        data.albums[String(a.id)] = { ...a, ...d, pic, tracks, at: Date.now() };
        saveNow(); // 每张成功专辑立即可靠落盘
        done++;
      } catch (e) {
        if (e?.requiresVerification) {
          saveNow();
          e.stage = e.stage || 'album';
          e.albumId = a.id;
          throw e;
        }
        if (e?.cooldown || e?.code === 405 || e?.code === 429 || e?.status === 405 || e?.status === 429) {
          saveNow();
          e.stage = e.stage || 'album';
          e.albumId = a.id;
          e.retryAfterMs = e.retryAfterMs || gate.state().retryAfterMs;
          throw e;
        }
        errors.push({ albumId: a.id, error: e?.message || String(e), code: e?.code || 0 });
      }
    }
    return {
      artistId: Number(artistId), albumsListed: list.albums.length, more: list.more,
      nextOffset: list.nextOffset || 0, total: wanted.length, done,
      pending: Math.max(0, pending.length - batch.length + errors.length),
      errors, complete: pending.length === batch.length && !errors.length && !list.more,
    };
  }

  function index(artistId) {
    const key = String(artistId), list = data.albumLists[key];
    return {
      artist: data.artists[key] || null,
      albums: (list?.albums || []).map(a => data.albums[String(a.id)] || { ...a, tracks: [] }),
      coverage: { listed: list?.albums.length || 0, more: !!list?.more, nextOffset: list?.nextOffset || 0, at: list?.at || 0 },
    };
  }

  function pruneCovers() {
    try {
      const own = /^\d{1,12}-[a-f0-9]{12}\.(?:jpg|png|webp)$/;
      const files = fs.readdirSync(coverDir).filter(n => own.test(n))
        .map(n => { const p = path.join(coverDir, n); try { const st = fs.lstatSync(p); return st.isFile() ? { n, p, st } : null; } catch { return null; } })
        .filter(Boolean).sort((a, b) => a.st.mtimeMs - b.st.mtimeMs);
      let bytes = files.reduce((s, f) => s + f.st.size, 0);
      while (files.length > MAX_COVER_FILES || bytes > MAX_COVER_BYTES) {
        const old = files.shift(); if (!old) break;
        bytes -= old.st.size;
        try { fs.unlinkSync(old.p); } catch {}
        try { fs.unlinkSync(metaFile(old.p.replace(/\.[^.]+$/, ''))); } catch {}
      }
    } catch {}
  }

  async function cover(albumId) {
    const id = String(albumId || '');
    if (!/^\d{1,12}$/.test(id)) throw Object.assign(new Error('albumId 非法'), { code: 400 });
    if (inflightCover.has(id)) return inflightCover.get(id);
    const p = (async () => {
      const meta = data.albums[id] || Object.values(data.albumLists).flatMap(x => x.albums || []).find(a => String(a.id) === id);
      let pic = meta?.pic || (meta?.tracks || []).find(t => t.pic)?.pic || '';
      // 混合歌单只对选中的参考按需补这一张专辑，不重建整库；仍走同一持久图片缓存。
      if (!meta || !/^https:\/\/[^/]+\.music\.126\.net\//i.test(pic)) {
        const d = await coverCatalog.album(id);
        const tracks = d.tracks || [];
        const first = tracks[0] || {};
        const albumPic = (tracks.find(t => t.pic) || {}).pic || first.pic || '';
        // d 只有 tracks；保留已有表头，缺的从官方曲目字段补，别把 catalogArtistDict 变成无名专辑。
        data.albums[id] = {
          ...(meta || {}), id: Number(id),
          name: (meta && meta.name) || first.album || d.name || '',
          type: (meta && meta.type) || first.albumType || d.type || '',
          subType: (meta && meta.subType) || first.subType || d.subType || '',
          size: Number((meta && meta.size) || first.albumSize || d.size) || 0,
          published: Number((meta && meta.published) || first.published || d.published) || 0,
          pic: albumPic || (meta && meta.pic) || '', tracks, at: Date.now()
        };
        saveNow();
        pic = data.albums[id].pic;
      }
      if (!/^https:\/\/[^/]+\.music\.126\.net\//i.test(pic)) {
        throw Object.assign(new Error('专辑封面不存在'), { code: 404 });
      }
      const hash = crypto.createHash('sha1').update(pic).digest('hex').slice(0, 12);
      const base = path.join(coverDir, id + '-' + hash);
      for (const ext of ['.jpg', '.png', '.webp']) {
        const f = base + ext, mf = metaFile(base);
        if (fs.existsSync(f) && fs.existsSync(mf) && fs.lstatSync(f).isFile()) {
          try {
            const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
            if (SAFE_IMAGE.test(m.type)) return { file: f, type: m.type };
          } catch {}
        }
      }
      await gate.schedule();
      const res = await ctx.network.fetch(pic, { method: 'GET', timeoutMs: 12000 });
      if (!res.ok) {
        if (res.status === 405 || res.status === 429) {
          const retryAfterMs = gate.cool(res.status, 'cover');
          throw Object.assign(new Error('上游暂时拒绝请求'), { code: res.status, stage: 'cover', cooldown: true, retryAfterMs });
        }
        throw Object.assign(new Error('封面下载失败 HTTP ' + res.status), { code: res.status, stage: 'cover' });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > MAX_IMAGE) throw Object.assign(new Error('封面大小异常'), { code: 413, stage: 'cover' });
      // CDN 可能声明 image/jpg 而实际字节是 PNG；以真实签名决定缓存类型和后缀。
      const type = sniffImageType(buf);
      if (!type) throw Object.assign(new Error('封面内容不是受支持的图片'), { code: 415, stage: 'cover' });
      const ext = type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : '.jpg';
      const target = base + ext;
      const tmp = target + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, target);
      atomicWrite(metaFile(base), JSON.stringify({ type, bytes: buf.length, at: Date.now() }));
      pruneCovers();
      return { file: target, type };
    })().finally(() => inflightCover.delete(id));
    inflightCover.set(id, p);
    return p;
  }

  async function lyric(songId) {
    const rawId = String(songId ?? '');
    if (!/^\d{1,12}$/.test(rawId)) throw Object.assign(new Error('songId 非法'), { code: 400 });
    const id = rawId;
    if (inflightLyric.has(id)) return inflightLyric.get(id);
    const p = (async () => {
      const f = path.join(lyricDir, id + '.lrc');
      if (fs.existsSync(f)) {
        const text = fs.readFileSync(f, 'utf8').trim();
        if (text) return { lrc: text, cached: true };
      }
      let text;
      try { ({ lyric: text } = await lyricFetch(ctx, { id, server: 'netease', gate })); }
      catch (e) { throw Object.assign(e, { code: e.code || 502, stage: e.stage || 'lyric' }); }
      const clean = String(text || '').trim();
      if (/^\s*\{/.test(clean)) {
        let j = null; try { j = JSON.parse(clean); } catch {}
        const code = Number(j && j.code) || 502;
        if (code === -462) {
          throw Object.assign(new Error((j && (j.message || j.msg)) || '上游要求账号验证'), {
            code, requiresVerification: true, nonRetryable: true,
            upstreamMessage: (j && (j.message || j.msg)) || '', stage: 'lyric'
          });
        }
        if (code === 405 || code === 429) {
          const retryAfterMs = gate.cool(code, 'lyric');
          throw Object.assign(new Error('上游暂时拒绝请求'), { code, stage: 'lyric', cooldown: true, retryAfterMs });
        }
        throw Object.assign(new Error((j && j.message) || '上游歌词响应异常'), { code: code >= 400 ? code : 502, stage: 'lyric' });
      }
      if (/^\s*</.test(clean)) throw Object.assign(new Error('上游歌词响应异常'), { code: 502, stage: 'lyric' });
      if (!clean || /^lyric fetch failed|纯音乐|没有找到|此处无歌词/i.test(clean)) {
        throw Object.assign(new Error('无歌词'), { code: 404, noLyric: true, stage: 'lyric' });
      }
      atomicWrite(f, clean);
      return { lrc: clean, cached: false };
    })().finally(() => inflightLyric.delete(id));
    inflightLyric.set(id, p);
    return p;
  }

  return { artist, build, index, cover, lyric, listAlbums };
}

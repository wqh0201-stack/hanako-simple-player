/**
 * lib/meting.js — Meting 公共节点的搜索 / 歌词 / 歌单取用。
 *
 * v2 没有裸 fetch，只能走 ctx.network.fetch —— 每个主机必须在 manifest 的
 * network.allowedHosts 里逐个列出，没有运行时增补的口子。
 *
 * ⚠️ 节点地址**不写在这里**（属灰色资源，不进公开仓库）：
 *   · 运行时从 `{dataDir}/sources.json` 读（见 lib/sources.js）
 *   · 全部主机必须已写进本机 manifest 的白名单（tools/apply-sources.mjs 负责）
 * 仓库里只有 `sources.example.json` 占位模板。节点列表为空时，
 * 依赖节点的能力（QQ / 酷狗搜索、歌单、在线歌词）会明确报「未配置音源」，
 * 由前端兜底提示导入，而不是静默失败。
 *
 * 节点返回格式不统一（实测 2026-09-10）：有的 title/author 齐全，有的字段名不同、
 * 甚至 title 为空。所以这里只做最小归一化 + 逐个节点降级，不猜各家的字段别名。
 *
 * 三种响应形态要分清，别拿同一种解析去套：
 *   search / playlist → JSON 数组
 *   lrc               → text/plain 的 LRC 原文（不是 JSON！）
 *   url               → 302 跳转，不读 body
 */

import { loadSources, hostOfNode } from "./sources.js";

/** kuwo / baidu 已删（公共节点实测搜索均 0 条，见知识库《音乐音源探活与层级》）。 */
export const ALLOWED_SERVERS = ["netease", "tencent", "kugou"];

/** 音源未配置时抛这个码，调用方据此给出「去导入音源」的提示，而不是当网络故障。 */
export const ERR_NO_SOURCES = "NO_SOURCES_CONFIGURED";

function noSourcesError() {
  return Object.assign(new Error("未配置音源节点（请导入音源文件）"), { code: ERR_NO_SOURCES });
}

/** 当前节点列表：每次调用都实时读盘，导入后无需 reload 后端即可生效。 */
function nodesOrThrow(dataDir) {
  const { nodes } = loadSources(dataDir);
  if (!nodes.length) throw noSourcesError();
  return nodes;
}

/**
 * 从 Meting 地址里抠出歌曲 id。
 * 地址形如 <node>?server=netease&type=url&id=1431292823
 * 注意有些节点不返回独立的 id 字段，只能从 url 里拿。
 */
export function extractTrackId(url) {
  const m = /[?&]id=([^&]+)/.exec(String(url || ""));
  return m ? decodeURIComponent(m[1]) : "";
}

/** 归一化：只认这几个键，缺了就空串。
 * 字段别名（实测 2026-10-11）：部分节点回的是 name/artist 而不是 title/author，
 * QQ / 酷狗在这类节点上就只有它可用 —— 不接别名归一化的话搜出来是空白行。
 * 去重后的节点集合里两种形状都可能出现，两种都接。 */
function normalizeTrack(x) {
  return {
    id: String(x?.id ?? ""),
    title: String(x?.title ?? x?.name ?? ""),
    author: String(x?.author ?? x?.artist ?? ""),
    url: String(x?.url ?? ""),
    pic: String(x?.pic ?? ""),
    lrc: String(x?.lrc ?? ""),
  };
}

function assertQuery({ keyword, id, server }) {
  if (keyword !== undefined && (!keyword || !String(keyword).trim())) {
    throw Object.assign(new Error("keyword required"), { code: 400 });
  }
  if (id !== undefined && (!id || !String(id).trim())) {
    throw Object.assign(new Error("id required"), { code: 400 });
  }
  if (!ALLOWED_SERVERS.includes(server)) {
    throw Object.assign(new Error("invalid server"), { code: 400 });
  }
}

/**
 * 试节点拿 JSON 数组。失败原因全收集，全挂了才抛 ——
 * 报错要能看出是哪几个节点的问题，而不是笼统一句"失败了"。
 */
async function fetchJsonList(ctx, dataDir, path, timeoutMs = 8000) {
  const nodes = nodesOrThrow(dataDir);
  const errors = [];
  for (const node of nodes) {
    try {
      const res = await ctx.network.fetch(`${node}${path}`, { method: "GET", timeoutMs });
      if (!res.ok) {
        errors.push(`${hostOfNode(node)} → HTTP ${res.status}`);
        continue;
      }
      const raw = await res.json();
      if (Array.isArray(raw) && raw.length > 0) return { raw, host: hostOfNode(node) };
      errors.push(`${hostOfNode(node)} → 空结果`);
    } catch (err) {
      errors.push(`${hostOfNode(node)} → ${err?.message || err}`);
    }
  }
  throw new Error(`所有 Meting 节点均不可用: ${errors.join("; ")}`);
}

/** 试节点读纯文本（歌词走这条）。 */
async function fetchText(ctx, dataDir, path, timeoutMs = 8000) {
  const nodes = nodesOrThrow(dataDir);
  const errors = [];
  for (const node of nodes) {
    try {
      const res = await ctx.network.fetch(`${node}${path}`, { method: "GET", timeoutMs });
      if (!res.ok) {
        errors.push(`${hostOfNode(node)} → HTTP ${res.status}`);
        continue;
      }
      const text = (await res.text()).trim();
      if (text) return { text, host: hostOfNode(node) };
      errors.push(`${hostOfNode(node)} → 空`);
    } catch (err) {
      errors.push(`${hostOfNode(node)} → ${err?.message || err}`);
    }
  }
  throw new Error(`所有 Meting 节点均无结果: ${errors.join("; ")}`);
}

export async function searchMusic(ctx, dataDir, { keyword, server = "netease", limit = 30 }) {
  assertQuery({ keyword, server });

  const path = `?server=${encodeURIComponent(server)}&type=search&id=${encodeURIComponent(keyword)}`;
  const { raw, host } = await fetchJsonList(ctx, dataDir, path);
  return { results: raw.map(normalizeTrack).slice(0, limit), host, total: raw.length };
}

export async function getLyric(ctx, dataDir, { id, server = "netease" }) {
  assertQuery({ id, server });

  // type=lrc 回的是 text/plain 的 LRC 原文，不是 JSON：
  //   [00:00.00] 作词 : 黑金雨\n[00:00.25] 作曲 : ...
  const path = `?server=${encodeURIComponent(server)}&type=lrc&id=${encodeURIComponent(id)}`;
  const { text, host } = await fetchText(ctx, dataDir, path);
  return { lyric: text, host };
}

export async function fetchMetingList(ctx, dataDir, { id, server = "netease", timeoutMs = 10000 }) {
  assertQuery({ id, server });

  const path = `?server=${encodeURIComponent(server)}&type=playlist&id=${encodeURIComponent(id)}`;
  const { raw, host } = await fetchJsonList(ctx, dataDir, path, timeoutMs);
  return { tracks: raw.map(normalizeTrack), host };
}

/** 单曲详情：type=song 返回单个对象（不是数组），形状与 search 单项一致。 */
export async function fetchMetingSong(ctx, dataDir, { id, server = "netease", timeoutMs = 8000 }) {
  assertQuery({ id, server });

  const path = `?server=${encodeURIComponent(server)}&type=song&id=${encodeURIComponent(id)}`;
  const nodes = nodesOrThrow(dataDir);
  const errors = [];
  for (const node of nodes) {
    try {
      const res = await ctx.network.fetch(`${node}${path}`, { method: "GET", timeoutMs });
      if (!res.ok) {
        errors.push(`${hostOfNode(node)} → HTTP ${res.status}`);
        continue;
      }
      const raw = await res.json();
      // 有的节点回对象、有的回单元素数组——两种都接
      const obj = Array.isArray(raw) ? raw[0] : raw;
      if (obj && (obj.title || obj.url)) return { track: normalizeTrack(obj), host: hostOfNode(node) };
      errors.push(`${hostOfNode(node)} → 空结果`);
    } catch (err) {
      errors.push(`${hostOfNode(node)} → ${err?.message || err}`);
    }
  }
  throw new Error(`所有 Meting 节点均不可用: ${errors.join("; ")}`);
}

/**
 * 播放直链的 Meting 地址（`type=url`）。
 * 用第一个可用节点拼；节点为空则抛 noSourcesError（调用方据此回落官方源）。
 */
export function metingUrlFor(dataDir, { id, server = "netease" }) {
  const { nodes } = loadSources(dataDir);
  if (!nodes.length) throw noSourcesError();
  return `${nodes[0]}?server=${encodeURIComponent(server)}&type=url&id=${encodeURIComponent(id)}`;
}

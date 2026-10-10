/**
 * lib/sources.js — 音源节点配置（不进公开仓库的那一份）。
 *
 * 为什么单独拆出来：Meting 公共节点的地址属灰色资源，不该写死在公开仓库里。
 * 仓库只保留 `sources.example.json`（占位模板，无真实地址）；真实节点放本机
 * `{dataDir}/sources.json`，并列入 .gitignore。
 *
 * 两个地方要同时对上，缺一不可：
 *   1. 本文件读的是 `{dataDir}/sources.json`（应用运行时取节点）；
 *   2. 宿主网络白名单 `manifest.network.allowedHosts` 是**静态表、运行时加不了主机**，
 *      所以节点主机必须由 `tools/apply-sources.mjs` 写进本机安装目录的 manifest，
 *      再 reload 一次（首次会弹审核卡）。
 *
 * 也就是说：**导入文件 ≠ 能连上**，导入之后还要跑一次 apply。这是平台约束，不是偷懒。
 */

import fs from "node:fs";
import path from "node:path";

export const SOURCES_FILE = "sources.json";

export function sourcesPath(dataDir) {
  return path.join(dataDir, SOURCES_FILE);
}

/** 单个节点地址的合法化：必须 https、能被 URL 解析。 */
function normalizeNode(v) {
  const s = String(v || "").trim();
  if (!/^https:\/\//i.test(s)) return "";
  try {
    const u = new URL(s);
    return u.port ? s : s; // 原样保留（有的节点带非标准路径）
  } catch {
    return "";
  }
}

/**
 * 读本机音源配置。
 * 兼容两种形状：裸数组 `[...]`，或 `{ version, name, nodes: [...] }`（分享文件用后者）。
 */
export function loadSources(dataDir) {
  const file = sourcesPath(dataDir);
  try {
    if (!fs.existsSync(file)) return { nodes: [], file, exists: false };
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.nodes) ? raw.nodes : [];
    const seen = new Set();
    const nodes = [];
    for (const item of list) {
      const n = normalizeNode(item);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      nodes.push(n);
    }
    return {
      nodes,
      file,
      exists: true,
      version: raw?.version,
      name: typeof raw?.name === "string" ? raw.name : "",
    };
  } catch (e) {
    return { nodes: [], file, exists: false, error: e?.message || String(e) };
  }
}

/** 从节点地址里取主机名（写入白名单用）。 */
export function hostOfNode(node) {
  try {
    return new URL(String(node)).hostname;
  } catch {
    return "";
  }
}

/** 一组节点的去重主机名。 */
export function hostsOfNodes(nodes) {
  const out = new Set();
  for (const n of nodes || []) {
    const h = hostOfNode(n);
    if (h) out.add(h);
  }
  return [...out];
}

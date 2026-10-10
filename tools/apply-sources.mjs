#!/usr/bin/env node
/* ============================================================
   tools/apply-sources.mjs — 把音源节点写进「本机安装目录」的 manifest。

   为什么需要这一步：宿主网络白名单 `manifest.network.allowedHosts` 是**静态表**，
   运行时加不了主机（APPS.md「出站网络」）。所以「导入音源文件」只把节点存到
   `{dataDir}/sources.json`，真正能连上还需把这些主机写进本机安装目录的 manifest，
   再 reload 一次（首次会弹审核卡批新主机，一次性）。

   仓库里那份 manifest 只留公共接口（music.163.com / api.bilibili.com / …），
   节点主机全靠本脚本按本机 sources.json 注入 —— 所以仓库可以是干净的。

   用法：
     node tools/apply-sources.mjs [path/to/sources.json]
       · 不给路径：读 {dataDir}/sources.json
     node tools/apply-sources.mjs --print      # 只看会写什么，不落盘
     node tools/apply-sources.mjs --check      # 只比对，不写

   落点：$HANA_HOME/apps/<appId>/manifest.json（默认 ~/.hanako/apps/hanako-audio-player）
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const APP_ID = 'hanako-audio-player';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HANA_HOME = process.env.HANA_HOME || path.join(os.homedir(), '.hanako');
const dataDir = path.join(HANA_HOME, 'app-data', APP_ID);
const installDir = path.join(HANA_HOME, 'apps', APP_ID);
const installManifest = path.join(installDir, 'manifest.json');

const args = process.argv.slice(2);
const PRETEND = args.includes('--print');
const CHECK = args.includes('--check');
const srcArg = args.find((a) => !a.startsWith('--'));

/** 读节点：显式路径 > {dataDir}/sources.json > 仓库 sources.json */
function readNodes() {
  const candidates = [
    srcArg && path.resolve(srcArg),
    path.join(dataDir, 'sources.json'),
    path.join(repo, 'sources.json'),
  ].filter(Boolean);
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      const list = Array.isArray(raw) ? raw : Array.isArray(raw?.nodes) ? raw.nodes : [];
      const nodes = [...new Set(list.map((x) => String(x || '').trim()).filter((s) => /^https:\/\//i.test(s)))];
      if (nodes.length) return { nodes, file: f };
    } catch (e) {
      console.error(`  ✗ ${f} 解析失败：${e.message}`);
    }
  }
  return { nodes: [], file: null };
}

function hostOf(u) { try { return new URL(String(u)).hostname; } catch { return ''; } }

const { nodes, file } = readNodes();
if (!nodes.length) {
  console.error('✗ 没找到可用的音源节点。');
  console.error(`  放一份到 ${path.join(dataDir, 'sources.json')}（或传给本脚本一个路径）。`);
  console.error('  格式：{ "version": 1, "nodes": ["https://节点/metting/api", ...] }');
  process.exit(1);
}
const hosts = [...new Set(nodes.map(hostOf).filter(Boolean))];
console.log(`音源文件：${file}`);
console.log(`节点 ${nodes.length} 个，主机 ${hosts.length} 个：`);
for (const h of hosts) console.log(`  · ${h}`);

if (!fs.existsSync(installManifest)) {
  console.error(`\n✗ 找不到安装目录 manifest：${installManifest}`);
  console.error('  先把 App 装到本机（extension_manager install，source local），再跑本脚本。');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(installManifest, 'utf8'));
manifest.network = manifest.network || {};
const current = Array.isArray(manifest.network.allowedHosts) ? manifest.network.allowedHosts : [];
const lower = new Set(current.map((h) => String(h).toLowerCase()));
const missing = hosts.filter((h) => !lower.has(h.toLowerCase()));

if (!missing.length) {
  console.log('\n✓ 白名单已包含全部节点主机，无需改动。');
  process.exit(0);
}
console.log(`\n待加入白名单 ${missing.length} 个：${missing.join(', ')}`);
if (PRETEND) { console.log('\n（--print：不落盘）'); process.exit(0); }
if (CHECK) { console.log('\n（--check：只比对，不落盘）'); process.exit(2); }

const before = manifest.network.allowedHosts || [];
manifest.network.allowedHosts = [...new Set([...before, ...hosts])];
// 备份一次，便于回退
fs.copyFileSync(installManifest, installManifest + '.bak-sources');
fs.writeFileSync(installManifest, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`\n✓ 已写入 ${installManifest}（备份：manifest.json.bak-sources）`);
console.log('\n下一步（缺一不可）：');
console.log(`  extension_manager reload app:${APP_ID}`);
console.log('  · 首次加入新主机，宿主会弹审核卡，批准一次即可。');
console.log('  · 不 reload 的话 App 进程仍读旧的 manifest，节点连不上。');

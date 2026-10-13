#!/usr/bin/env node
/**
 * pack-release.mjs —— 出一份干净的 release 包（zip + entry.json）。
 *
 * 为什么需要它：官方 pack_app.mjs 会把**整个 App 目录**打进去，包括
 * docs/（54MB 设计稿与交接文档）、tools/（含 145KB 的 verify-ui.mjs）、AGENTS.md。
 * 实测产物 55MB / 233 文件，而运行时其实只要 ~0.5MB。
 *
 * 本脚本先把**运行时文件**复制到一个临时目录（目录名 = manifest.id，官方校验器硬要求），
 * 再交给官方 extension-pack 打包。这样仓库里该留的交接文档全留着，只有 release 瘦身。
 *
 * 用法：
 *   node tools/pack-release.mjs                 # 出到 dist-release/
 *   node tools/pack-release.mjs --out <dir>     # 换输出目录
 *   node tools/pack-release.mjs --keep-tmp      # 保留临时目录（排查用）
 *   node tools/pack-release.mjs --publisher <p> # 覆盖 publisher
 *
 * 前置：HANA_APP_TOOLS_ROOT 指向已安装的 Hana Server 目录
 *       （内含 APPS.md 与 scripts/extension-pack.mjs），或 HANA_ROOT 同义。
 *       本机通常已设：~/.hanako/artifacts/server/<版本>/
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 打包时一律排除：不是运行时，只是仓库资产（体积多为设计稿/验证脚本）。 */
const EXCLUDE = new Set([
  ".git",
  ".github",
  ".backups",
  ".impeccable", // 本地评审工具产物，非运行时
  "docs", // 54MB 设计稿 + 交接文档
  "node_modules",
  "dist",
  "dist-release",
  "AGENTS.md",
  "CLAUDE.md",
  ".gitignore",
  ".DS_Store",
]);

/**
 * tools/ 不能整目录排除：里面混着两种东西——
 *   运行时工具（lib/register-tools.js 直接 import），包必须带；
 *   开发脚本（verify-* / bump-build / pack-release 等 .mjs），不该进包。
 * 所以这里显式列白名单，只放行运行时工具。
 * ⚠️ 漏一个就是装载期 import 失败（2026-10-11 踩过：tools/play.js 缺失 →
 *    plugin failed to load: Cannot find module）。
 */
const TOOLS_RUNTIME = new Set([
  "play.js",
  "list-music.js",
  "bind-banner.js",
  "create-list.js",
  "search-music.js",
]);

/**
 * assets/ 里允许「没有任何静态引用」的文件（空集＝全部必须被引用）。
 * 默认不许有孤儿静态资源：上游遗留文件（如忘删的 icon.svg）会悄悄混进包，
 * 既占体积又让人误以为是当前图标。真需要动态引用的，在这里显式登记并写明理由。
 * （2026-10-11 踩过：上游 icon.svg 随初始快照带入、无任何引用，直到 1.0.1 才发现）
 */
const ALLOW_UNREFERENCED_ASSETS = new Set([
  // "example.png",  // 例：运行时按后端返回的名字动态取，静态扫不到
]);

function parseArgs(argv) {
  const out = { out: "dist-release", publisher: "wqh0201-stack", keepTmp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out.out = argv[++i];
    else if (a === "--publisher") out.publisher = argv[++i];
    else if (a === "--keep-tmp") out.keepTmp = true;
  }
  return out;
}

/** 找官方工具链：HANA_APP_TOOLS_ROOT（或 HANA_ROOT）→ 含 APPS.md 且 scripts/ 齐。 */
function resolveToolsRoot() {
  const selected = (process.env.HANA_APP_TOOLS_ROOT || process.env.HANA_ROOT || "").trim();
  if (!selected) {
    throw new Error(
      "没找到官方打包工具链。先设 HANA_APP_TOOLS_ROOT 指向已安装的 Hana Server 目录，例如：\n" +
        "  export HANA_APP_TOOLS_ROOT=\"$HANA_HOME/artifacts/server/<版本>\""
    );
  }
  const root = path.resolve(selected);
  const need = ["APPS.md", "scripts/extension-pack.mjs", "scripts/validate-app.mjs"];
  const missing = need.filter((p) => !fs.existsSync(path.join(root, p)));
  if (missing.length) {
    throw new Error(`HANA_APP_TOOLS_ROOT 不完整，缺：${missing.join(", ")}\n  当前值：${root}`);
  }
  return root;
}

/** 递归复制，按 EXCLUDE 顶层名与常见噪声过滤；tools/ 只放行运行时工具。 */
function copyRuntime(src, dst, rel = "") {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const name = entry.name;
    const relPath = rel ? `${rel}/${name}` : name;
    if (!rel && EXCLUDE.has(name)) continue; // 只按顶层名排除
    if (rel === "tools" && entry.isFile() && !TOOLS_RUNTIME.has(name)) continue; // tools/ 只留运行时
    if (name === ".DS_Store" || name.endsWith(".log")) continue;
    const from = path.join(src, name);
    const to = path.join(dst, name);
    if (entry.isDirectory()) {
      // tools/ 下若没有运行时文件就不必建目录
      if (relPath === "tools") {
        const keep = fs.readdirSync(from).filter((f) => TOOLS_RUNTIME.has(f));
        if (!keep.length) continue;
      }
      fs.mkdirSync(to, { recursive: true });
      copyRuntime(from, to, relPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

/**
 * 完整性守卫：扫描包里每个 .js 的相对 import（import "../x/y.js"），
 * 确认目标文件也在包里。白名单切错一个就会在“装载期 import 失败”，
 * 而那是装到用户机器上才炸；这里在打包时当场拦住。
 * （2026-10-11 踩过：tools/ 被整目录排除 → tools/play.js 缺失 → plugin failed to load）
 */
function checkRuntimeImports(stageDir) {
  const missing = [];
  const seen = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "ui") walk(p); continue; }
      if (!e.name.endsWith(".js")) continue;
      const text = fs.readFileSync(p, "utf8");
      const re = /(?:import|export)\s[^;]*?from\s*["'](\.{1,2}\/[^"']+)["']/g;
      let m;
      while ((m = re.exec(text))) {
        const target = path.resolve(path.dirname(p), m[1]);
        const rel = path.relative(stageDir, target);
        if (!fs.existsSync(target) && !seen.has(rel)) {
          seen.add(rel);
          missing.push(`${path.relative(stageDir, p)} → ${m[1]}`);
        }
      }
    }
  };
  walk(stageDir);
  return missing;
}

/**
 * 孤儿静态资源守卫：assets/ 下每个文件都必须在 manifest.json 或运行时文本文件里
 * 被引用；未被引用且不在 ALLOW_UNREFERENCED_ASSETS 里的，直接拦下打包。
 * 为什么：上游遗留文件（忘删的旧图标等）会随 copyRuntime 静静混进包，
 * 体积小但语义错——用户与审阅者会把它当成当前图标。宁可打包时就报错。
 * （2026-10-11 踩过：上游 icon.svg 混入 1.0.1 包）
 */
function checkOrphanAssets(stageDir) {
  const assetsDir = path.join(stageDir, "assets");
  if (!fs.existsSync(assetsDir)) return [];
  // 收集「可引用的文本」：manifest.json + 所有 .js/.html/.css 内容
  const corpus = [];
  const collect = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { collect(p); continue; }
      if (!/\.(js|json|html|css)$/.test(e.name)) continue;
      corpus.push(fs.readFileSync(p, "utf8"));
    }
  };
  collect(stageDir);
  const hay = corpus.join("\n");
  const orphans = [];
  for (const e of fs.readdirSync(assetsDir, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const name = e.name;
    if (ALLOW_UNREFERENCED_ASSETS.has(name)) continue;
    // 文件名（含其在 assets/ 下的相对路径）在文本里出现过就算被引用
    if (hay.includes(name) || hay.includes(`assets/${name}`)) continue;
    orphans.push(name);
  }
  return orphans;
}

/** 统计目录体积 / 文件数（用于回报）。 */
function measure(dir) {
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        bytes += fs.statSync(p).size;
        files++;
      }
    }
  };
  walk(dir);
  return { bytes, files };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "manifest.json"), "utf8"));
  const id = manifest.id;
  const toolsRoot = resolveToolsRoot();

  // 临时目录名必须等于 manifest.id —— 官方校验器硬要求，不匹配直接拒绝。
  const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), "hana-pack-"));
  const stageDir = path.join(tmpParent, id);
  fs.mkdirSync(stageDir, { recursive: true });
  copyRuntime(REPO, stageDir);

  const staged = measure(stageDir);
  console.log(`[pack-release] 暂存目录 ${stageDir}`);
  console.log(`[pack-release] 运行时文件：${staged.files} 个 / ${(staged.bytes / 1024).toFixed(1)} KB`);

  // 包内 assets/ 清单（目视复核用：每个都应该是当前真正在用的；防上游遗留文件混入）
  const assetsDir = path.join(stageDir, "assets");
  if (fs.existsSync(assetsDir)) {
    const names = fs.readdirSync(assetsDir).sort();
    console.log(`[pack-release] 包内 assets/（${names.length}）：${names.join(", ")}`);
  }

  // 孤儿静态资源守卫：assets/ 里未被任何静态引用指向的文件直接拦下（防死文件混入）
  const orphans = checkOrphanAssets(stageDir);
  if (orphans.length) {
    console.error("[pack-release] assets/ 里有未被引用的文件，中止打包：");
    for (const o of orphans) console.error(`  - assets/${o}`);
    console.error("  若它确实被运行时动态引用，请加入 ALLOW_UNREFERENCED_ASSETS 并写明理由；");
    console.error("  若是上游遗留、已不再使用，请从仓库删除。");
    process.exitCode = 1;
    return;
  }
  console.log("[pack-release] assets/ 引用完整性：OK");

  // 完整性守卫：包内 .js 的相对 import 必须都在包里（防白名单切错）
  const missing = checkRuntimeImports(stageDir);
  if (missing.length) {
    console.error("[pack-release] 包内缺失被 import 的运行时文件，中止打包：");
    for (const m of missing) console.error(`  - ${m}`);
    process.exitCode = 1;
    return;
  }
  console.log("[pack-release] 运行时 import 完整性：OK");

  // 先校验（便宜且能提前拦下 MISSING_UI_RESOURCE 这类 error）
  const validate = spawnSync(process.execPath, [path.join(toolsRoot, "scripts/validate-app.mjs"), "--dir", stageDir, "--json"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const vout = validate.stdout?.toString() ?? "";
  try {
    const report = JSON.parse(vout.slice(vout.indexOf("{")));
    const errs = report.summary?.errors ?? (report.ok ? 0 : 1);
    console.log(`[pack-release] 校验：errors=${errs} warnings=${report.summary?.warnings ?? 0}`);
    if (errs > 0) {
      console.error(`[pack-release] 校验未通过，中止打包：\n${JSON.stringify(report.issues, null, 2)}`);
      process.exitCode = 1;
      return;
    }
  } catch {
    console.error("[pack-release] 校验输出无法解析：\n" + vout);
    process.exitCode = 1;
    return;
  }

  const outDir = path.resolve(REPO, args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const pack = spawnSync(process.execPath, [
    path.join(toolsRoot, "scripts/extension-pack.mjs"),
    "--kind", "app",
    "--dir", stageDir,
    "--publisher", args.publisher,
    "--out", outDir,
  ], { stdio: "inherit" });

  if (pack.status !== 0) {
    console.error(`[pack-release] 打包失败（exit ${pack.status}）`);
    process.exitCode = pack.status ?? 1;
    return;
  }

  const zip = fs.readdirSync(outDir).find((f) => f.endsWith(".zip"));
  if (zip) {
    const size = fs.statSync(path.join(outDir, zip)).size;
    console.log(`[pack-release] 产物：${path.join(outDir, zip)}（${(size / 1024 / 1024).toFixed(2)} MB）`);
  }

  if (!args.keepTmp) fs.rmSync(tmpParent, { recursive: true, force: true });
  else console.log(`[pack-release] 保留暂存目录：${tmpParent}`);
}

try {
  main();
} catch (error) {
  console.error(`[pack-release] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

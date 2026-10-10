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
  "docs", // 54MB 设计稿 + 交接文档
  "tools", // 验证 / 打包脚本本身
  "node_modules",
  "dist",
  "dist-release",
  "AGENTS.md",
  "CLAUDE.md",
  ".gitignore",
  ".DS_Store",
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

/** 递归复制，按 EXCLUDE 顶层名与常见噪声过滤。 */
function copyRuntime(src, dst, rel = "") {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const name = entry.name;
    const relPath = rel ? `${rel}/${name}` : name;
    if (!rel && EXCLUDE.has(name)) continue; // 只按顶层名排除
    if (name === ".DS_Store" || name.endsWith(".log")) continue;
    const from = path.join(src, name);
    const to = path.join(dst, name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyRuntime(from, to, relPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
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

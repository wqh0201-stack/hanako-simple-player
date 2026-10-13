#!/usr/bin/env node
/* 真机复验采样器：以固定间隔把 owner 记录 + 全局播放快照连成时间轴。
 * 只读 app-data 里的两个文件，不写任何东西（自己写在同一个目录）。
 * 用法：node sample-timeline.mjs <outDir> [intervalMs] [durationMs] */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const outDir = process.argv[2] || '/tmp/audio-owner-timeline';
const interval = Number(process.argv[3] || 400);
const duration = Number(process.argv[4] || 0); // 0 = 一直跑

const HOME = os.homedir();
const GLOBAL = path.join(HOME, '.hanako/app-data/hanako-simple-player/storage/global.json');
const PLAYBACK = path.join(HOME, '.hanako/app-data/hanako-simple-player/playback.json');

fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `timeline-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);


function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

const t0 = Date.now();
let n = 0;
function tick() {
  const now = Date.now();
  const g = readJson(GLOBAL, {});
  const owner = (g.entries || {})['player-audio-owner'] || null;
  const pb = readJson(PLAYBACK, {}) || {};
  const rec = {
    t: now, dt: now - t0, n: ++n,
    owner: owner ? {
      ownerId: owner.ownerId || '', generation: owner.generation, revision: owner.revision,
      pending: owner.pending ? (owner.pending.ownerId || '(empty)') : null,
      resume: !!owner.resume, cause: owner.cause || null,
    } : null,
    pb: {
      currentId: pb.currentId || null, playing: !!pb.playing,
      progress: typeof pb.progress === 'number' ? Math.round(pb.progress * 10) / 10 : null,
      vol: pb.volume, mode: pb.mode,
    },
  };
  fs.appendFileSync(out, JSON.stringify(rec) + '\n');
  if (duration && now - t0 >= duration) return finish();
  setTimeout(tick, interval);
}
function finish() {
  process.stdout.write(`[sampler] wrote ${n} samples -> ${out}\n`);
  process.exit(0);
}
process.on('SIGTERM', finish);
process.on('SIGINT', finish);
process.stdout.write(`[sampler] watching\n global=${GLOBAL}\n playback=${PLAYBACK}\n out=${out}\n`);
tick();

#!/usr/bin/env node
/** 真实宿主回归：生产 mood 模块 → App 子进程 → slash 派发 → WS 客户端。
 * node tools/verify-mood-host.mjs
 * 可用 HANA_APP_TOOLS_ROOT 指定同版本宿主产物；独立临时 HANA_HOME，无模型、无生产数据。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { MOOD_PROMPT } from '../lib/mood-command.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'hap-mood-host-'));
const hanaTestHome = path.join(fixture, 'home');
const appId = 'mood-dispatch-regression';
const appDir = path.join(hanaTestHome, 'apps', appId);
const name = 'mood-host-dispatch-client-receives-prompt';
const evidence = { fixture, modelTurnStarted: false };
let host, ws, logFd, hostExit, spawnError;

async function waitFor(probe, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (hostExit !== undefined) throw new Error(`isolated host exited: ${hostExit}`);
    const result = await probe();
    if (result) return result;
    await delay(150);
  }
  throw new Error(`${label} timed out; inspect ${path.join(fixture, 'boot.log')}`);
}

async function verify() {
  const artifacts = path.join(os.homedir(), '.hanako', 'artifacts', 'server');
  const root = process.env.HANA_APP_TOOLS_ROOT || fs.readdirSync(artifacts)
    .map(x => path.join(artifacts, x))
    .filter(x => fs.existsSync(path.join(x, 'bootstrap.js')) && fs.existsSync(path.join(x, 'node')))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!root) throw new Error('Hana server artifact unavailable; set HANA_APP_TOOLS_ROOT');
  evidence.hostArtifact = path.basename(root);
  const require = createRequire(import.meta.url);
  const WebSocket = require(path.join(root, 'node_modules', 'ws'));
  fs.mkdirSync(appDir, { recursive: true });
  const source = fs.readFileSync(path.join(repo, 'lib', 'mood-command.js'));
  evidence.moodModuleSha256 = createHash('sha256').update(source).digest('hex');
  fs.writeFileSync(path.join(appDir, 'mood-command.js'), source);
  fs.copyFileSync(path.join(repo, 'assets', 'icon.png'), path.join(appDir, 'icon.png'));
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.writeFileSync(path.join(appDir, 'manifest.json'), JSON.stringify({
    manifestVersion: 2, id: appId, name: 'Mood dispatch regression', version: '0.1.0',
    minAppVersion: '0.1017.0', entry: 'index.js', icon: 'icon.png', capabilities: [],
  }));
  fs.writeFileSync(path.join(appDir, 'index.js'), `
import { createMoodCommand } from './mood-command.js';
export async function apply(ctx) {
  const mood = createMoodCommand(ctx);
  if (!(await mood.ensure())) throw new Error('mood registration not confirmed by listOwn');
  return () => mood.dispose();
}
`);
  // 测试 fixture 仅声明零受保护能力，沿用 Hana 真机探针的安装记录格式。
  const date = new Date().toISOString();
  fs.mkdirSync(path.join(hanaTestHome, 'extensions'), { recursive: true });
  fs.writeFileSync(path.join(hanaTestHome, 'extensions', 'installs.json'), JSON.stringify({
    schemaVersion: 1, records: [{
      ref: `app:${appId}`, kind: 'app', id: appId, version: '0.1.0', origin: 'user',
      source: { type: 'local' }, installedAt: date, updatedAt: date, installedBy: { kind: 'user' },
      integrity: { checkedAt: date, checks: ['runtime-smoke'] },
      approval: {
        decidedAt: date, decidedBy: { kind: 'user' },
        declarationHash: createHash('sha256').update('[]').digest('hex'),
        appDeclaration: { version: 1, capabilities: [], network: { allowedHosts: [], methods: ['GET'], allowLocalhost: false } },
      },
      location: `apps/${appId}`, history: [],
    }],
  }));
  logFd = fs.openSync(path.join(fixture, 'boot.log'), 'w');
  host = spawn(path.join(root, 'node'), [path.join(root, 'bootstrap.js')], {
    cwd: root, detached: true, stdio: ['ignore', logFd, logFd],
    env: { ...process.env, HANA_HOME: hanaTestHome, HANA_ROOT: root, HANA_SERVER_ENTRY: path.join(root, 'bundle', 'index.js') },
  });
  host.once('error', err => { spawnError = err; });
  host.once('exit', (code, signal) => { hostExit = signal || code; });
  const info = await waitFor(async () => {
    try { return JSON.parse(fs.readFileSync(path.join(hanaTestHome, 'server-info.json'), 'utf8')); }
    catch { return null; }
  }, 35000, 'isolated server startup');
  const base = `http://127.0.0.1:${info.port}`;
  const headers = { Authorization: `Bearer ${info.token}` };
  const command = await waitFor(async () => {
    try {
      const response = await fetch(`${base}/api/commands`, { headers, signal: AbortSignal.timeout(2000) });
      const body = await response.json();
      const commands = Array.isArray(body) ? body : body.commands;
      return commands?.find(x => x.name === 'mood' && x.source === 'app');
    } catch { return null; }
  }, 10000, 'mood command directory');
  evidence.command = { name: command.name, aliases: command.aliases, source: command.source };
  const response = await fetch(`${base}/api/ws-ticket`, { method: 'POST', headers, signal: AbortSignal.timeout(3000) });
  const { ticket } = await response.json();
  if (!ticket) throw new Error('isolated host did not issue WS ticket');
  ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws?wsTicket=${encodeURIComponent(ticket)}`);
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('slash_result not received')), 8000);
    ws.once('error', err => { clearTimeout(timeout); reject(err); });
    ws.on('message', bytes => {
      let message;
      try { message = JSON.parse(bytes.toString()); } catch { return; }
      if (message.type !== 'slash_result' && message.type !== 'error') return;
      clearTimeout(timeout);
      resolve(message);
    });
  });
  const sessionDir = path.join(hanaTestHome, 'agents', 'hanako', 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });
  const sessionPath = path.join(sessionDir, 'mood-dispatch.jsonl');
  fs.writeFileSync(sessionPath, '');
  ws.once('open', () => ws.send(JSON.stringify({ type: 'slash', text: '/mood', sessionPath, agentId: 'hanako' })));
  const message = await result;
  evidence.received = { type: message.type, text: message.text || message.message, level: message.level };
  evidence.sessionHistoryUnchanged = fs.readFileSync(sessionPath, 'utf8') === '';
  if (message.type !== 'slash_result' || message.level !== 'success' || message.text !== MOOD_PROMPT) {
    throw new Error(`client did not receive MOOD_PROMPT: ${JSON.stringify(evidence.received)}`);
  }
  if (!evidence.sessionHistoryUnchanged) throw new Error('slash dispatch wrote session history');
}

let failure;
try { await verify(); } catch (err) { failure = err.message; }
finally {
  ws?.terminate();
  if (host?.pid) {
    try { process.kill(-host.pid, 'SIGTERM'); } catch { /* already stopped */ }
    const deadline = Date.now() + 2500;
    while (hostExit === undefined && Date.now() < deadline) await delay(50);
    try { process.kill(-host.pid, 'SIGKILL'); } catch { /* no remaining children */ }
  }
  if (logFd !== undefined) fs.closeSync(logFd);
}
const result = { name, ok: !failure, detail: failure || '' };
console.log(JSON.stringify({ passed: failure ? 0 : 1, total: 1, failed: failure ? [result] : [], results: [result], evidence }, null, 2));
process.exitCode = failure ? 1 : 0;

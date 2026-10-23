#!/usr/bin/env node
/* Hana独立调度验收：实际控制器+虚拟时钟，无真实60秒等待/网络/用户数据写入。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { harness, clone, flush, ENDPOINT } from './verify-catalog-transaction-hana.mjs';
function clock() {
  let now = 0, seq = 0; const tasks = new Map();
  const add = (fn, ms, interval = 0) => { const id = ++seq; tasks.set(id, { fn, at: now + Math.max(0, Number(ms) || 0), interval }); return id; };
  class ClockDate extends Date { static now() { return now; } }
  return {
    globals: { Date: ClockDate, setTimeout: (fn, ms) => add(fn, ms), clearTimeout: id => tasks.delete(id), setInterval: (fn, ms) => add(fn, ms, Math.max(1, ms)), clearInterval: id => tasks.delete(id) },
    size: () => tasks.size,
    async advance(ms) {
      const end = now + ms; let turns = 0;
      while (true) {
        const next = [...tasks.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break; assert.ok(++turns <= 1000, 'runaway fake timer');
        const [id, task] = next; now = task.at;
        if (task.interval) tasks.set(id, { ...task, at: now + task.interval }); else tasks.delete(id);
        task.fn(); await flush();
      }
      now = end; await flush();
    }
  };
}
function rejectResponse(stage, code = 405) { return { ok: false, status: code, body: { ok: false, code, stage, cooldown: true, retryAfterMs: 60000, error: 'fixture upstream refused' } }; }
function rejectText(stage, code = 405) { const r = rejectResponse(stage, code); return { ok: false, status: code, text: JSON.stringify(r.body) }; }
function start(h) { let done = false; const work = h.startEnrich(); work.then(() => { done = true; }, () => { done = true; }); return { work, done: () => done }; }
async function finished(run) { await flush(); assert.equal(run.done(), true, 'controller must settle without another real timer'); await run.work; }
const count = (h, endpoint) => h.calls.filter(c => c.url.startsWith(endpoint)).length;
let total = 0, passed = 0;
async function test(name, fn) { total++; try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { process.exitCode = 1; console.log('FAIL ' + name + ': ' + e.message); } }
await test('first-rejection-pauses-60000-then-single-recovery', async () => {
  const c = clock(); let attempts = 0;
  const h = harness({ globals: c.globals, get: url => url.startsWith(ENDPOINT.catalogArtist) && ++attempts === 1 ? rejectResponse('artist') : undefined });
  const run = start(h); await flush(); assert.equal(attempts, 1); assert.equal(h.saves.length, 0); assert.ok(c.size() > 0);
  assert.ok(h.statuses.some(s => /冷却|暂停|等待|拒绝/.test(s)), 'reader must see why the operation is waiting');
  await c.advance(59999); assert.equal(attempts, 1); await c.advance(1); await finished(run);
  assert.equal(attempts, 2); assert.equal(h.saves.length, 1); assert.equal(h.state.tracks[0].title, 'Innocence'); assert.equal(c.size(), 0);
});
await test('second-rejection-stops-with-no-empty-save-or-next-target-failures', async () => {
  const c = clock(); let attempts = 0;
  const h = harness({ globals: c.globals, get: url => { if (url.startsWith(ENDPOINT.catalogArtist)) { attempts++; return rejectResponse('artist'); } } });
  const run = start(h); await flush(); await c.advance(60000); await finished(run);
  assert.equal(attempts, 2); assert.equal(h.saves.length, 0); assert.equal(c.size(), 0); assert.equal(h.coverJob, null); assert.equal(h.busy(), false);
  assert.match(h.statuses.at(-1), /保护停止/); assert.match(h.statuses.at(-1), /未处理\s*1|待处理\s*1|剩余\s*1/);
  assert.ok(!h.toasts.includes('歌单整理完成'));
});
await test('repeated-lyric-rejection-saves-only-verified-metadata-and-cover', async () => {
  const c = clock(); const h = harness({ globals: c.globals, cover: true, lyric: () => rejectText('lyric', 429) });
  const run = start(h); await flush(); assert.equal(h.saves.length, 0); await c.advance(60000); await finished(run);
  assert.equal(count(h, ENDPOINT.catalogLyric), 2); assert.equal(h.saves.length, 1);
  assert.equal(h.state.tracks[0].title, 'Innocence'); assert.ok(h.state.tracks[0].raw.catalogMatch); assert.ok(h.state.tracks[0].raw.coverMatch);
  assert.ok(!Object.hasOwn(h.state.tracks[0].raw, 'catalogLyric')); assert.match(h.statuses.at(-1), /保护停止/); assert.match(h.statuses.at(-1), /lyric|歌词/);
});
await test('recovery-budget-shared-across-stages-not-reset-for-lyrics', async () => {
  const c = clock(); let artist = 0;
  const h = harness({ globals: c.globals, get: url => url.startsWith(ENDPOINT.catalogArtist) && ++artist === 1 ? rejectResponse('artist') : undefined, lyric: () => rejectText('lyric') });
  const run = start(h); await flush(); await c.advance(60000); await finished(run);
  assert.equal(artist, 2); assert.equal(count(h, ENDPOINT.catalogLyric), 1); assert.equal(c.size(), 0); assert.equal(h.saves.length, 1); assert.match(h.statuses.at(-1), /保护停止/);
});
await test('manual-stop-during-cooldown-cleans-timer-and-never-releases', async () => {
  const c = clock(); const h = harness({ globals: c.globals, get: url => url.startsWith(ENDPOINT.catalogArtist) ? rejectResponse('artist') : undefined });
  const before = clone(h.state.tracks), run = start(h); await flush(); const calls = h.calls.length;
  h.coverJob.controller.abort(); await finished(run); assert.equal(h.saves.length, 0); assert.equal(c.size(), 0); assert.equal(h.busy(), false); assert.deepEqual(clone(h.state.tracks), before);
  await c.advance(120000); assert.equal(h.calls.length, calls);
});
await test('manual-stop-during-uncooperative-API-is-immediate-and-late-safe', async () => {
  let resolve; const delayed = new Promise(r => { resolve = r; }); const c = clock();
  const h = harness({ globals: c.globals, lyric: () => delayed }), before = clone(h.state.tracks), run = start(h);
  await flush(); assert.ok(count(h, ENDPOINT.catalogLyric)); h.coverJob.controller.abort(); await finished(run);
  assert.equal(h.saves.length, 0); assert.deepEqual(clone(h.state.tracks), before); const calls = h.calls.length;
  resolve({ ok: true, text: '[00:00.00]LATE' }); await flush(); assert.deepEqual(clone(h.state.tracks), before); assert.equal(h.calls.length, calls); assert.equal(h.coverJob, null);
});
await test('domain-no-lyrics-is-not-counted-as-request-error', async () => {
  const c = clock(); const h = harness({ globals: c.globals, lyric: () => ({ ok: false, status: 404, text: JSON.stringify({ ok: false, code: 404, noLyric: true, stage: 'lyric', error: '无歌词' }) }) });
  const run = start(h); await finished(run); assert.equal(h.saves.length, 1); assert.equal(c.size(), 0); assert.ok(!Object.hasOwn(h.state.tracks[0].raw, 'catalogLyric'));
  assert.match(h.statuses.at(-1), /无词\s*1|无歌词\s*1/); assert.doesNotMatch(h.statuses.at(-1), /请求异常\s*[1-9]/);
});
await test('cover-HTTP-405-uses-same-protection-before-probe-and-apply', async () => {
  const c = clock(); let requests = 0;
  const h = harness({ globals: c.globals, cover: true, fetch: () => ++requests === 1 ? new Response(JSON.stringify(rejectResponse('cover').body), { status: 405, headers: { 'Content-Type': 'application/json' } }) : undefined });
  const run = start(h); await flush(); assert.equal(requests, 1); assert.ok(!h.state.tracks[0].raw.coverMatch); await c.advance(60000); await finished(run);
  assert.equal(requests, 2); assert.equal(h.saves.length, 1); assert.ok(h.state.tracks[0].raw.coverMatch); assert.equal(c.size(), 0);
});
await test('ordinary-lyric-errors-stay-request-errors-not-domain-no-word', async () => {
  for (const code of [404, 502]) {
    const c = clock(), h = harness({ globals: c.globals, lyric: () => ({ ok: false, status: code, text: JSON.stringify({ ok: false, code, stage: 'lyric', error: 'fixture network/resource failure' }) }) });
    const run = start(h); await finished(run); assert.equal(h.saves.length, 1); assert.equal(c.size(), 0);
    assert.match(h.statuses.at(-1), /请求异常\s*1/); assert.ok(h.statuses.at(-1).includes(String(code))); assert.doesNotMatch(h.statuses.at(-1), /无词\s*1|无歌词\s*1/);
  }
});
await test('verification-refusal-stops-once-without-cooldown-or-empty-save', async () => {
  const c = clock(); const body = { ok: false, code: -462, stage: 'artist', requiresVerification: true, upstreamMessage: '请绑定手机后再试哦~', error: '请绑定手机后再试哦~' };
  const h = harness({ globals: c.globals, get: url => url.startsWith(ENDPOINT.catalogArtist) ? { ok: false, status: 500, body } : undefined }), before = clone(h.state.tracks), run = start(h);
  await finished(run); assert.equal(count(h, ENDPOINT.catalogArtist), 1); assert.equal(h.calls.length, 1); assert.equal(c.size(), 0); assert.equal(h.saves.length, 0); assert.deepEqual(clone(h.state.tracks), before);
  assert.match(h.statuses.at(-1), /验证/); assert.ok(h.statuses.at(-1).includes('-462')); assert.equal(h.busy(), false);
});
await test('verification-at-lyric-saves-only-earlier-verified-stages-once', async () => {
  const c = clock(); const body = { ok: false, code: -462, stage: 'lyric', requiresVerification: true, upstreamMessage: '请绑定手机后再试哦~', error: '请绑定手机后再试哦~' };
  const h = harness({ globals: c.globals, lyric: () => ({ ok: false, status: 500, text: JSON.stringify(body) }) }), run = start(h);
  await finished(run); assert.equal(count(h, ENDPOINT.catalogLyric), 1); assert.equal(c.size(), 0); assert.equal(h.saves.length, 1); assert.equal(h.state.tracks[0].title, 'Innocence');
  assert.ok(!Object.hasOwn(h.state.tracks[0].raw, 'catalogLyric')); assert.match(h.statuses.at(-1), /验证/); assert.ok(h.statuses.at(-1).includes('-462'));
});
await test('public-API-wrappers-forward-optional-signal-and-old-call-still-works', async () => {
  const source = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8'); const a = source.indexOf('  function apiJson(url, init)'), b = source.indexOf('  var MODES =', a); assert.ok(a >= 0 && b > a);
  const calls = [], ctx = { apiFetch: async (url, init) => { calls.push({ url, init }); return new Response('{}'); } };
  vm.createContext(ctx); vm.runInContext(source.slice(a, b), ctx); const ac = new AbortController();
  await ctx.apiGetJson('/get', ac.signal); await ctx.apiPostJson('/post', {}, ac.signal); await ctx.apiText('/text', ac.signal); await ctx.apiGetJson('/old');
  assert.ok(calls.slice(0, 3).every(c => c.init.signal === ac.signal)); assert.equal(calls[3].init.signal, undefined);
});
console.log(`HANA_CATALOG_SCHEDULING ${passed}/${total}`);

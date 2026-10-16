import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// 真实原生 range 手势 + CSS/WAAPI 时钟，验证位移而不只验证闪烁。
export async function verifyStripFlow({ newPage, BASE, API, UI_BASE, outDir, assert, sleep, clickTab, report }) {
  const dir = path.join(outDir, 'flow'); fs.mkdirSync(dir, { recursive: true });
  const check = (name, ok, detail) => assert('SF-' + name, ok, JSON.stringify(detail));
  await fetch(`${BASE}${API}/__fixture/reset?mode=lyric-flow&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 720, height: 128, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__playerDebug && document.querySelector('#listTabs .list-tab'));
  await clickTab(page, 'imp:1');
  await page.evaluate(() => document.querySelector('#queueList .q-hit').click());
  await page.waitForFunction(() => !document.querySelector('audio').paused && document.querySelectorAll('.lyric-line').length === 7);
  await page.evaluate(url => { window.__playerDebug.currentTrack().pic = url; document.getElementById('favBtn').click(); }, `${API}/_fixture/touchbar-color.svg?palette=pink`);
  await page.waitForFunction(() => document.getElementById('player').dataset.stripAmbient === '1' && document.querySelector('.toast').hidden);
  const seek = async f => {
    await page.evaluate(f => { const a = document.querySelector('audio'); a.currentTime = a.duration * f; a.dispatchEvent(new Event('timeupdate')); }, f);
    await page.waitForFunction(f => Math.abs(parseFloat(document.getElementById('stripBar').style.getPropertyValue('--strip-fill')) - f * 100) < .3, {}, f);
  };
  const sample = () => page.evaluate(() => {
    const $ = id => document.getElementById(id), bar = $('stripBar'), r = bar.getBoundingClientRect();
    const fill = parseFloat(bar.style.getPropertyValue('--strip-fill')) / 100, edge = r.x + r.width * fill;
    const front = document.querySelector('.strip-front-band'), fr = front.getBoundingClientRect();
    const flights = [...document.querySelectorAll('.strip-flight')].filter(e => e.getClientRects().length).map(e => {
      const a = e.getAnimations().find(a => a.animationName === 'strip-ambient-flow');
      const star = e.querySelector('.strip-spark').getBoundingClientRect(), er = e.getBoundingClientRect();
      const matrix = new DOMMatrixReadOnly(getComputedStyle(e).transform);
      return { rate: a?.playbackRate, time: a?.currentTime, state: a?.playState, phase: er.width ? -matrix.m41 / er.width : 0, behind: edge - star.x, x: star.x };
    });
    return { at: performance.now(), fill, edge, front: { left: fr.left, right: fr.right, width: fr.width, height: fr.height, radius: getComputedStyle(front).borderRadius, barRadius: getComputedStyle(bar).borderRadius, opacity: +getComputedStyle(front).opacity, visibility: getComputedStyle($('stripFront')).visibility },
      glow: +getComputedStyle(document.querySelector('.strip-front-glow')).opacity,
      effect: $('stripLayout').dataset.seekEffect, motion: $('stripLayout').dataset.ambientMotion,
      detail: window.__playerDebug.stripFlowState(), flights, audio: { time: document.querySelector('audio').currentTime, paused: document.querySelector('audio').paused },
      bar: { x: r.x, y: r.y, w: r.width, h: r.height }, noDot: !document.querySelector('.strip-seek-dot'),
      safe: [...document.querySelectorAll('.strip-front, .strip-front *, .strip-flight, .strip-spark')].every(e => getComputedStyle(e).pointerEvents === 'none') };
  });
  const rates = (s, value) => s.flights.length > 0 && s.flights.every(a => Math.abs(a.rate - value) < .025);
  const evidence = {};
  await seek(.5); await page.mouse.move(1, 127); await page.evaluate(() => document.activeElement?.blur());
  const normal = await sample(); await sleep(600); const flowed = await sample();
  const tracks = normal.flights.map((a, i) => ({ a, b: flowed.flights[i] })).filter(({ a, b }) => b.phase >= a.phase);
  // 只排除刚刚循环回前沿的星点；其余每一颗都必须在真实向后位移。
  check('normal-directional-travel', tracks.length >= 28 && tracks.every(({ a, b }) => b.phase > a.phase && b.behind > a.behind + 4), { count: tracks.length, tracks });
  check('normal-band-without-bloom', normal.front.height === 64 && Math.abs(normal.front.right - normal.edge) < 1 && normal.front.width >= 64 && normal.front.radius === normal.front.barRadius && normal.front.opacity > .5 && normal.glow < .01 && rates(normal, 1) && normal.safe && normal.noDot, normal);
  await page.screenshot({ path: path.join(dir, '01-normal.png') });
  let g = await sample(); const y = g.bar.y + 54, x = g.bar.x + g.bar.w * .55;
  await page.mouse.move(x, y); await page.mouse.down(); await sleep(160);
  const press = await sample();
  check('click-mild-rate-and-bloom', press.effect === 'press' && rates(press, 1.25) && press.glow > .5, press);
  check('front-follows-real-seek', Math.abs(press.front.right - press.edge) < 1 && Math.abs(press.audio.time - 16.5) < 1, press);
  await page.screenshot({ path: path.join(dir, '02-click.png') });
  await page.mouse.move(x + 2, y); await sleep(100);
  const jitter = await sample(); check('press-jitter-does-not-drag', jitter.effect === 'press' && rates(jitter, 1.25), jitter);
  await page.mouse.move(x + 55, y, { steps: 5 }); await sleep(140);
  const drag = await sample();
  check('actual-drag-fast-rate', drag.effect === 'drag' && rates(drag, 3.8) && drag.glow > .95 && Math.abs(drag.front.right - drag.edge) < 1 && drag.front.radius === drag.front.barRadius, drag);
  check('rate-change-keeps-phase', drag.flights.every((a, i) => a.time >= press.flights[i].time && a.time - press.flights[i].time < (drag.at - press.at) * 4.1 + 100), { press, drag });
  await page.screenshot({ path: path.join(dir, '03-drag.png') });
  await page.mouse.up(); await sleep(180); const early = await sample();
  await sleep(420); const middle = await sample();
  await sleep(1000); const settled = await sample();
  check('release-decelerates-gradually', early.flights[0].rate > middle.flights[0].rate && middle.flights[0].rate > 1.01 && early.flights[0].rate < 3.8 && rates(settled, 1), { early, middle, settled });
  check('release-bloom-fades-to-band', early.glow > middle.glow && middle.glow > settled.glow && settled.glow < .01 && settled.front.opacity > .5 && !settled.detail.raf, { early, middle, settled });
  await page.screenshot({ path: path.join(dir, '04-settled.png') });
  // 同帧 down/up 的快速点击也必须看得见辉光，不能只在按住时发光。
  await page.mouse.click(x, y); await sleep(180);
  const quick = await sample();
  check('quick-click-visible-mild-feedback', quick.glow > .3 && quick.effect === 'settle' && quick.flights.every(a => a.rate > 1 && a.rate <= 1.25) && !quick.detail.gesture, quick);
  await page.screenshot({ path: path.join(dir, '02b-quick-click.png') }); await sleep(1450);
  // 音量不触发进度加速。
  await page.setViewport({ width: 1040, height: 128, deviceScaleFactor: 1 }); await sleep(100);
  await page.mouse.move(700, 64); await sleep(80); await page.hover('#muteBtn'); await sleep(220);
  const vol = await page.$eval('#vol', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(vol.x, vol.y); await page.mouse.down(); await sleep(80);
  check('volume-keeps-normal-rate', rates(await sample(), 1) && (await sample()).effect === 'idle');
  await page.mouse.up(); await page.mouse.move(1, 127); await page.evaluate(() => document.activeElement?.blur()); await sleep(150);
  // 真实 hidden 打断高速，不能遗留回落调度或高速状态。
  await page.setViewport({ width: 720, height: 128, deviceScaleFactor: 1 }); await sleep(100);
  g = await sample();
  await page.mouse.move(g.bar.x + g.bar.w * .5, y); await page.mouse.down(); await page.mouse.move(g.bar.x + g.bar.w * .6, y, { steps: 3 }); await sleep(80);
  const other = await newPage(); await other.bringToFront(); await sleep(130);
  const hidden = await sample();
  check('hidden-clears-gesture-rate-and-ramp', await page.evaluate(() => document.hidden) && hidden.motion === '0' && !hidden.detail.raf && !hidden.detail.gesture && rates(hidden, 1) && hidden.flights.every(a => a.state === 'paused'), hidden);
  await page.bringToFront(); await other.close(); await page.mouse.up(); await sleep(80);
  // reduced-motion 同样清理正在拖动的效果，恢复后回到常速。
  g = await sample(); await page.mouse.move(g.bar.x + g.bar.w * .5, y); await page.mouse.down(); await page.mouse.move(g.bar.x + g.bar.w * .6, y);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); await sleep(100);
  check('reduced-motion-cancels-effects', await page.evaluate(() => !document.getElementById('stripLayout').getAnimations({ subtree: true }).some(a => /strip-ambient/.test(a.animationName || ''))) && !(await sample()).detail.raf);
  await page.mouse.up(); await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]); await sleep(130);
  check('motion-restores-normal-rate', rates(await sample(), 1) && (await sample()).effect === 'idle');
  await page.evaluate(() => window.__playerDebug.pauseAll()); await sleep(120);
  await seek(0); const zero = await sample(); check('zero-has-no-front-artifact', zero.front.visibility === 'hidden' && !zero.detail.raf, zero);
  await seek(1); const full = await sample(); check('full-edge-contained', Math.abs(full.front.right - (full.bar.x + full.bar.w)) < 1 && full.front.radius === full.front.barRadius && full.safe && full.noDot, full);
  // 最窄档的真实前沿与轻点交互。
  await page.setViewport({ width: 312, height: 128, deviceScaleFactor: 1 }); await seek(.5); await sleep(120);
  g = await sample(); await page.mouse.move(g.bar.x + g.bar.w * .6, g.bar.y + 54); await page.mouse.down(); await sleep(120);
  const narrow = await sample(); check('narrow-12-streams-and-click', narrow.flights.length === 12 && rates(narrow, 1.25) && Math.abs(narrow.front.right - narrow.edge) < 1 && narrow.front.radius === narrow.front.barRadius, narrow);
  await page.mouse.up(); await sleep(1600);
  const quiet = await sample(); check('paused-seek-feedback-settles-and-freezes', quiet.audio.paused && quiet.motion === '0' && !quiet.detail.raf && rates(quiet, 1), quiet);
  evidence.normal = normal; evidence.flowed = flowed; evidence.press = press; evidence.drag = drag; evidence.release = { early, middle, settled }; evidence.narrow = narrow;
  // 10 秒真实交互录屏：缓流 → 点击微加速 → 拖动高速 → 松手回落 → 暂停。
  await page.setViewport({ width: 720, height: 128, deviceScaleFactor: 1 }); await seek(.5); await sleep(120);
  await page.mouse.move(1, 127); await page.evaluate(() => document.activeElement?.blur());
  await page.evaluate(() => window.__playerDebug.requestPlay('user'));
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  g = await sample(); const mouseY = g.bar.y + 54, baseX = g.bar.x, barW = g.bar.w;
  const framesDir = path.join(dir, 'motion-frames'); fs.mkdirSync(framesDir, { recursive: true });
  const frames = [], start = Date.now(); let clicked = false, pressed = false, released = false, paused = false;
  while (Date.now() - start < 10000) {
    const at = Date.now() - start;
    if (!clicked && at >= 1500) { await page.mouse.click(baseX + barW * .55, mouseY); clicked = true; }
    if (!pressed && at >= 3300) { await page.mouse.move(baseX + barW * .55, mouseY); await page.mouse.down(); pressed = true; }
    if (pressed && !released && at >= 3600 && at < 5600) await page.mouse.move(baseX + barW * (.55 + .25 * (at - 3600) / 2000), mouseY);
    if (!released && at >= 5600) { await page.mouse.up(); released = true; }
    if (!paused && at >= 8000) { await page.evaluate(() => window.__playerDebug.pauseAll()); paused = true; }
    const file = `frame-${String(frames.length).padStart(3, '0')}.png`;
    const label = at < 1500 ? 'Normal flow' : at < 3000 ? 'Click: slight acceleration' : at < 3600 ? 'Press' : at < 5600 ? 'Drag: fast flow' : at < 7200 ? 'Release: easing back' : at < 8000 ? 'Normal flow' : 'Paused';
    frames.push({ file, at: Date.now() - start, label, state: await sample() });
    await page.screenshot({ path: path.join(framesDir, file) }); await sleep(75);
  }
  fs.writeFileSync(path.join(framesDir, 'timestamps.json'), JSON.stringify(frames, null, 2));
  fs.writeFileSync(path.join(framesDir, 'frames.txt'), frames.map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1]?.at || 10000) - f.at) / 1000}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`);
  const result = spawnSync(process.env.FFMPEG_BIN || '/Users/can/.local/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(framesDir, 'frames.txt'), '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'strip-flow-interaction.mp4')], { encoding: 'utf8' });
  report.flowRecording = { ok: result.status === 0, error: result.error?.message || result.stderr, frames: frames.length, durationMs: frames.at(-1).at };
  check('recording-captures-three-rates', frames.some(f => rates(f.state, 1.25)) && frames.some(f => rates(f.state, 3.8)) && frames.some(f => f.state.effect === 'settle' && f.state.flights[0].rate > 1.05 && f.state.flights[0].rate < 3) && frames.some(f => f.label === 'Click: slight acceleration' && f.state.glow > .3) && frames.slice(-4).every(f => f.state.audio.paused && !f.state.detail.raf), report.flowRecording);
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await page.close();
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
}

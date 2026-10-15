// Album Ambient 背景验收：复用 verify-ui 的真实文档、SDK、媒体时钟与后端夹具。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export async function verifyAlbumAmbient({ newPage, BASE, API, UI_BASE, outDir, assert, sleep, clickTab, report }) {
  const dir = path.join(outDir, 'ambient');
  fs.mkdirSync(dir, { recursive: true });
  const check = (name, ok, detail) => assert('AA-' + name, ok, JSON.stringify(detail));
  const theme = async tone => {
    await page.evaluate(t => {
      window.__fixtureTheme(t);
      window.postMessage({ protocol: 'hana.plugin.ui', version: 1, kind: 'event', id: 'ambient-theme', type: 'hana.theme.changed', payload: { theme: t, appearance: t } }, location.origin);
    }, tone);
    await page.waitForFunction(t => document.getElementById('player').dataset.tone === t, {}, tone);
  };
  await fetch(`${BASE}${API}/__fixture/reset?mode=lyric-flow&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 720, height: 128, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__playerDebug && document.querySelector('#listTabs .list-tab'));
  await clickTab(page, 'imp:1');
  await page.evaluate(() => document.querySelector('#queueList .q-hit').click());
  await page.waitForFunction(() => !document.querySelector('audio').paused && document.querySelectorAll('.lyric-line').length === 7);
  await page.evaluate(() => window.__playerDebug.pauseAll());
  const seek = async fraction => {
    await page.evaluate(f => {
      const a = document.querySelector('audio'); a.currentTime = a.duration * f;
      a.dispatchEvent(new Event('timeupdate'));
    }, fraction);
    await page.waitForFunction(f => Math.abs(parseFloat(document.getElementById('stripBar').style.getPropertyValue('--strip-fill')) - f * 100) < .1, {}, fraction);
  };
  const sample = () => page.evaluate(() => {
    const $ = id => document.getElementById(id), cs = el => getComputedStyle(el);
    const played = $('stripPlayed'), bar = $('stripBar'), b = bar.getBoundingClientRect();
    return { tone: $('player').dataset.tone, ready: $('player').dataset.stripAmbient,
      field: getComputedStyle(played, '::before').backgroundImage, base: getComputedStyle(document.querySelector('.strip-field-quiet'), '::before').backgroundImage,
      mask: cs(played).maskImage, clip: cs(played).clipPath, edge: bar.dataset.progress,
      motion: $('stripLayout').dataset.ambientMotion,
      animations: $('stripLayout').getAnimations({ subtree: true }).filter(a => /strip-ambient/.test(a.animationName || '')).map(a => ({ name: a.animationName, time: a.currentTime, state: a.playState })),
      stars: [...document.querySelectorAll('.strip-spark')].filter(e => e.getClientRects().length && cs(e).display !== 'none').map(e => ({ x: cs(e).left, y: cs(e).top, opacity: +cs(e).opacity, period: cs(e).animationDuration, delay: cs(e).animationDelay })),
      bar: { x: b.x, y: b.y, w: b.width, h: b.height }, samples: window.__playerDebug.stripState().samples,
      hot: $('stripLayout').dataset.hot, lyric: $('stripLyric').textContent,
      decorationsSafe: [played, document.querySelector('.strip-field-quiet'), ...document.querySelectorAll('.strip-sparkles, .strip-spark')].every(e => cs(e).pointerEvents === 'none'),
      noDot: !document.querySelector('.strip-seek-dot'), outline: cs(bar).outlineStyle,
      time: document.querySelector('audio').currentTime, paused: document.querySelector('audio').paused };
  });
  async function cover(palette, extra = '') {
    const before = (await sample()).samples;
    await page.evaluate(url => {
      window.__playerDebug.currentTrack().pic = url;
      document.getElementById('favBtn').click(); // 复用既有 renderTrack/applyCovers，非生产数据。
    }, `${API}/_fixture/touchbar-color.svg?palette=${palette}${extra}`);
    if (extra.includes('delay')) return before;
    await page.waitForFunction(() => window.__playerDebug.stripState().pending.length === 0 && document.getElementById('player').dataset.stripAmbient === '1');
    await page.waitForFunction(() => document.querySelector('.toast').hidden);
    return before;
  }
  const evidence = [];
  for (const palette of ['pink', 'green', 'blue', 'dark']) {
    await cover(palette);
    const count = (await sample()).samples;
    for (const tone of ['light', 'dark']) {
      await theme(tone);
      for (const width of [720, 312]) {
        await page.setViewport({ width, height: 128, deviceScaleFactor: 1 });
        await sleep(90);
        for (const fraction of [0, .25, .5, .75, 1]) {
          await seek(fraction);
          await page.mouse.move(1, 127); await page.evaluate(() => document.activeElement?.blur());
          await sleep(160);
          const quiet = await sample();
          const name = `${palette}-${tone}-${width}-${fraction * 100}`;
          await page.screenshot({ path: path.join(dir, name + '-lyric.png') });
          if (fraction === .5) {
            // 保留原有色场羽化检查；新亮带另由 flow 套件验证，不混成硬边误报。
            await page.$eval('#stripFront', e => { e.style.visibility = 'hidden'; });
            await page.screenshot({ path: path.join(dir, name + '-ambient-only.png') });
            await page.$eval('#stripFront', e => { e.style.visibility = ''; });
          }
          await page.mouse.move(quiet.bar.x + quiet.bar.w - 8, quiet.bar.y + 28);
          await sleep(160);
          const hot = await sample();
          await page.screenshot({ path: path.join(dir, name + '-controls.png') });
          check('matrix-' + name, quiet.ready === '1' && quiet.tone === tone && quiet.hot === '0' && hot.hot === '1'
            && quiet.bar.h === 64 && quiet.decorationsSafe && quiet.noDot && hot.noDot && quiet.samples === count
            && /radial-gradient/.test(quiet.base) && quiet.field !== quiet.base
            // 用户改为浓度样片：620px 条宽 36 颗，212px 条宽 12 颗。
            && quiet.stars.length === (width === 312 ? 12 : 36)
            && quiet.edge === (fraction === 0 ? 'empty' : fraction === 1 ? 'full' : 'partial')
            && (fraction === 1 ? quiet.mask === 'none' : quiet.mask.includes('gradient')),
          { samples: quiet.samples, stars: quiet.stars.length, edge: quiet.edge, mask: quiet.mask });
          evidence.push({ name, quiet, hot });
        }
      }
    }
    check('no-resampling-progress-resize-theme-' + palette, (await sample()).samples === count, { count, after: (await sample()).samples });
  }
  await page.setViewport({ width: 720, height: 128, deviceScaleFactor: 1 });
  await theme('light'); await cover('pink'); await seek(.5);
  // 关掉整层特效时，对照旧版 100% 的原始 CSS 合成；底色必须逐像素相同。
  const legacyCss = `
    .strip-field { background-image:var(--strip-field, var(--cover-fallback)); }
    .strip-field-quiet { opacity:.10; }
    .strip-field-quiet::before, .strip-field-played::before, .strip-sparkles { display:none; }
    #stripPlayed { opacity:.88; clip-path:inset(0 round 6px); -webkit-mask-image:none; mask-image:none; visibility:visible; }
    .strip-field::after { content:''; position:absolute; inset:0; background:color-mix(in srgb, var(--hk-surface) 38%, transparent); background-image:none; opacity:1; animation:none; transform:none; }
  `;
  for (const tone of ['light', 'dark']) {
    await theme(tone); await seek(0); await page.mouse.move(1, 127); await page.evaluate(() => document.activeElement?.blur()); await sleep(180);
    await page.$eval('#stripBar', e => e.style.setProperty('--strip-intensity', '0'));
    await page.screenshot({ path: path.join(dir, `base-restored-${tone}.png`) });
    const legacyStyle = await page.addStyleTag({ content: legacyCss });
    await page.screenshot({ path: path.join(dir, `base-legacy-full-${tone}.png`) });
    await legacyStyle.evaluate(e => e.remove());
    await page.$eval('#stripBar', e => e.style.removeProperty('--strip-intensity'));
  }
  await theme('light'); await seek(1);
  for (const strength of [0, .35, .7, 1]) {
    await page.$eval('#stripBar', (e, s) => e.style.setProperty('--strip-intensity', String(s)), strength);
    await page.screenshot({ path: path.join(dir, `strength-${strength * 100}.png`) });
    check('strength-' + strength, Math.abs(await page.$eval('#stripPlayed', e => +getComputedStyle(e).opacity) - strength) < .001);
  }
  await page.$eval('#stripBar', e => e.style.removeProperty('--strip-intensity'));
  await seek(.5);
  // 原生 seek 焦点不会再画整条外圈；点击/拖动照常驱动原有媒体时钟。
  const bar = (await sample()).bar;
  await page.mouse.move(bar.x + bar.w * .25, bar.y + 54); await page.mouse.down();
  await page.mouse.move(bar.x + bar.w * .75, bar.y + 54, { steps: 6 }); await page.mouse.up();
  await sleep(80);
  const dragged = await sample();
  check('seek-drag-no-ring-or-dot', dragged.outline === 'none' && dragged.noDot && Math.abs(dragged.time - 22.5) < 1, dragged);
  await seek(.4);
  await page.evaluate(() => window.__playerDebug.requestPlay('user'));
  await page.waitForFunction(() => document.getElementById('stripLayout').dataset.ambientMotion === '1');
  const playing = await sample();
  // 等真实媒体推进，避免 seek 后的缓冲窗口造成先前已独立复现的 280ms 假红。
  await page.waitForFunction(t => document.querySelector('audio').currentTime > t + .08 && !document.querySelector('audio').seeking, { timeout: 5000 }, playing.time);
  const advanced = await sample();
  check('playing-css-clocks-advance', advanced.time > playing.time && advanced.animations.every((a, i) => a.state === 'running' && a.time > playing.animations[i].time), { playing, advanced });
  check('independent-star-clocks', new Set(playing.stars.map(s => s.period)).size === 36 && new Set(playing.stars.map(s => s.delay)).size === 36, playing.stars);
  await page.evaluate(() => window.__playerDebug.pauseAll()); await sleep(80);
  const paused = await sample(); await sleep(280); const still = await sample();
  check('pause-freezes-all-ambient-clocks', still.paused && still.motion === '0' && still.animations.every((a, i) => a.state === 'paused' && a.time === paused.animations[i].time), { paused, still });
  await page.evaluate(() => window.__playerDebug.requestPlay('user'));
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  const host = visible => page.evaluate(v => window.postMessage({ protocol: 'hana.plugin.ui', version: 1, kind: 'event', id: 'ambient-lifecycle', type: 'hana.surface.runtime.changed', payload: { visible: v, slot: 'card', reason: 'fixture' } }, location.origin), visible);
  await host(false); await page.waitForFunction(() => document.getElementById('stripLayout').dataset.ambientMotion === '0');
  check('sdk-hidden-pauses', (await sample()).animations.every(a => a.state === 'paused'));
  await host(true); await page.waitForFunction(() => document.getElementById('stripLayout').dataset.ambientMotion === '1');
  check('sdk-visible-resumes', (await sample()).animations.every(a => a.state === 'running'));
  const background = await newPage(); await background.bringToFront(); await sleep(160);
  check('real-page-hidden-pauses', await page.evaluate(() => document.hidden) && (await sample()).animations.every(a => a.state === 'paused'));
  await page.bringToFront(); await background.close();
  await page.waitForFunction(() => document.getElementById('stripLayout').dataset.ambientMotion === '1');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await sleep(80); check('reduced-motion-no-ambient-animation', (await sample()).animations.length === 0);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 }); await sleep(350);
  check('other-layout-pauses-ambient', (await sample()).motion === '0');
  await page.setViewport({ width: 720, height: 128, deviceScaleFactor: 1 }); await sleep(350);
  const oldField = (await sample()).field;
  const count = await cover('green', '&delay=500&fresh=1');
  check('track-pending-clears-old-colors', await page.evaluate(() => document.getElementById('player').dataset.stripAmbient === '0' && !document.getElementById('player').style.getPropertyValue('--strip-field-light')));
  await page.waitForFunction(n => window.__playerDebug.stripState().samples > n && document.getElementById('player').dataset.stripAmbient === '1', {}, count);
  check('track-replaces-field', (await sample()).field !== oldField);
  await page.evaluate(() => document.getElementById('nextBtn').click());
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  check('real-track-next-no-audio-error', await page.evaluate(() => !document.querySelector('audio').error && !window.__playerDebug.audioOwner().takeover));
  await page.evaluate(() => window.__playerDebug.pauseAll());
  await cover('pink'); await seek(.65); await page.mouse.move(1, 127); await page.evaluate(() => document.activeElement?.blur());
  // 9 秒录屏：真实媒体推进 6 秒，随后暂停 3 秒；逐帧 PNG + 时间戳也保留。
  const framesDir = path.join(dir, 'motion-frames'); fs.mkdirSync(framesDir, { recursive: true });
  await page.evaluate(() => window.__playerDebug.requestPlay('user'));
  const frames = [], start = Date.now(); let stopped = false;
  while (Date.now() - start < 9000) {
    if (!stopped && Date.now() - start >= 6000) { await page.evaluate(() => window.__playerDebug.pauseAll()); stopped = true; }
    const file = `frame-${String(frames.length).padStart(3, '0')}.png`;
    frames.push({ file, at: Date.now() - start, state: await sample() });
    await page.screenshot({ path: path.join(framesDir, file) }); await sleep(90);
  }
  fs.writeFileSync(path.join(framesDir, 'timestamps.json'), JSON.stringify(frames, null, 2));
  const concat = frames.map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1]?.at || 9000) - f.at) / 1000}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`;
  fs.writeFileSync(path.join(framesDir, 'frames.txt'), concat);
  const result = spawnSync(process.env.FFMPEG_BIN || '/Users/can/.local/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(framesDir, 'frames.txt'), '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'album-ambient-play-pause.mp4')], { encoding: 'utf8' });
  report.ambientRecording = { ok: result.status === 0, error: result.error?.message || result.stderr, frames: frames.length, durationMs: frames.at(-1).at };
  check('recording-real-progress-and-pause', frames.some(f => f.state.time > frames[0].state.time + 4) && frames.slice(-5).every(f => f.state.paused && f.state.motion === '0'), report.ambientRecording);
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await page.close();
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
}

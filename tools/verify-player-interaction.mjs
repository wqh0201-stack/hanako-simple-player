// 本轮播放意图/命中时序专项；不自动加入全量，普通样式修改无需运行。
import path from 'node:path';

export async function verifyPlayerInteraction({ newPage, BASE, API, UI_BASE, outDir, assert, sleep, clickTab, report }) {
  const check = (name, ok, data) => assert('interaction-' + name, ok, JSON.stringify(data));
  await fetch(`${BASE}${API}/__fixture/reset?mode=lyric-flow&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__playerDebug && document.querySelector('#listTabs .list-tab'));
  await clickTab(page, 'imp:1');
  await page.evaluate(() => document.querySelector('#queueList .q-hit').click());
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  await page.evaluate(() => { window.__interactionAudio = document.querySelector('audio'); window.__interactionControls = ['playBtn', 'seek', 'vol'].map(id => document.getElementById(id)); });
  const rect = id => page.$eval('#' + id, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const status = () => page.evaluate(() => window.__playerDebug.audioOwner());
  const tap = async id => { const r = await rect(id); await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2); };
  let delay = 0, stopped = false;
  await page.setRequestInterception(true);
  page.on('request', async request => {
    if (request.url().includes('/audio-owner')) {
      if (request.postData()?.includes('"action":"stop"')) stopped = true;
      if (delay) await sleep(delay);
    }
    await request.continue().catch(() => {});
  });
  const samples = report.interaction = { transport: [], morph: [] };
  // 同一组延迟条件跑四种形态：连续两次取消，连续三次起播；按压不缩命中盒。
  for (const [name, width, height] of [['wide', 1040, 780], ['long', 465, 930], ['compact', 360, 494], ['strip', 640, 128]]) {
    delay = 0;
    await page.evaluate(async () => { await window.__playerDebug.pauseAll(); });
    await page.setViewport({ width, height, deviceScaleFactor: 1 }); await sleep(350);
    const id = name === 'strip' ? 'playBtn' : 'playBtn';
    if (name === 'strip') await page.mouse.move(450, 64);
    delay = 90;
    await tap(id); await sleep(15); await tap(id);
    await sleep(650);
    const twice = await status();
    check(name + '-two-presses-cancel', twice.paused && !twice.wanted && !twice.requesting, twice);
    await tap(id); await sleep(15); await tap(id); await sleep(15); await tap(id);
    await page.waitForFunction(() => { const s = window.__playerDebug.audioOwner(); return s.playing && !s.requesting && s.intent === null; });
    const thrice = await status();
    check(name + '-three-presses-play', !thrice.paused && thrice.wanted, thrice);
    const before = await rect(id);
    await page.mouse.move(before.x + before.w / 2, before.y + before.h / 2); await page.mouse.down(); await sleep(65);
    const pressed = await page.$eval('#' + id, el => {
      const r = el.getBoundingClientRect(), icon = el.querySelector('.icon');
      return { w: r.width, h: r.height, transform: getComputedStyle(icon).transform };
    });
    await page.screenshot({ path: path.join(outDir, 'pressed-' + name + '.png') });
    await page.mouse.move(1, 1); await page.mouse.up();
    check(name + '-press-keeps-hit-box', Math.abs(before.w - pressed.w) < .1 && Math.abs(before.h - pressed.h) < .1 && pressed.transform !== 'none', { before, pressed });
    samples.transport.push({ name, twice, thrice, pressed });
  }
  // stop 已经发出后再点播放，旧回执也不能把较新的意图抹掉。
  stopped = false; delay = 180;
  await page.mouse.move(450, 64); await tap('playBtn');
  for (let tries = 0; tries < 200 && !stopped; tries++) await sleep(10);
  if (!stopped) throw new Error('Expected an in-flight stop request');
  await tap('playBtn');
  await page.waitForFunction(() => { const s = window.__playerDebug.audioOwner(); return s.playing && !s.requesting && s.intent === null; });
  check('play-after-inflight-stop', !(await status()).paused, await status());
  delay = 0;
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 }); await sleep(350);
  await page.mouse.move(1, 1);
  await page.setViewport({ width: 1040, height: 128, deviceScaleFactor: 1 });
  await page.waitForFunction(() => window.__playerDebug.stripState().motion);
  const play = await rect('playBtn');
  await page.mouse.move(play.x + play.w / 2, play.y + play.h / 2);
  const during = await page.evaluate(() => window.__playerDebug.stripState());
  await page.evaluate(() => {
    window.__interactionSeek = 0; window.__interactionPlay = 0;
    document.getElementById('seek').addEventListener('input', () => window.__interactionSeek++);
    document.getElementById('playBtn').addEventListener('click', () => window.__interactionPlay++);
  });
  await tap('playBtn');
  const hits = await page.evaluate(() => ({ seek: window.__interactionSeek, play: window.__interactionPlay }));
  check('morph-hover-and-first-click', during.motion && during.hot && hits.play === 1 && hits.seek === 0, { during, hits });
  await sleep(350);
  for (const width of [312, 416, 640]) {
    await page.setViewport({ width, height: 128, deviceScaleFactor: 1 });
    // RO 在浏览器的下一次布局提交中重排按钮；先等两帧，再量最终命中盒。
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const r = await rect('playBtn'); await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2);
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.id, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
    check('strip-button-hit-' + width, hit === 'playBtn', hit);
  }
  // 背景每帧有接续，真实封面不会在末尾突然由 0 跳到 1。
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.waitForFunction(() => window.__playerDebug.stripState().motion);
  for (let i = 0; i < 11; i++) {
    const frame = await page.evaluate(() => {
      const $ = id => document.getElementById(id), cs = id => getComputedStyle($(id));
      return { motion: window.__playerDebug.stripState().motion, background: +cs('playerBackdrop').opacity,
        outgoing: $('layoutBackdropGhost').hidden ? 0 : +cs('layoutBackdropGhost').opacity,
        cover: +cs('cover').opacity, layers: $('layoutBackdropGhost').children.length };
    });
    samples.morph.push(frame);
    if ([0, 5, 10].includes(i)) await page.screenshot({ path: path.join(outDir, 'background-' + i + '.png') });
    await sleep(25);
  }
  check('background-handoff-continuous', samples.morph.every(f => f.cover === 1 && f.background === 1 && f.outgoing >= 0 && f.outgoing <= 1), samples.morph);
  for (const height of [128, 780, 128, 780]) { await page.setViewport({ width: 1040, height, deviceScaleFactor: 1 }); await sleep(50); }
  await sleep(350);
  const settled = await page.evaluate(() => ({ motion: window.__playerDebug.stripState().motion,
    ghost: document.getElementById('layoutBackdropGhost').hidden, layers: document.getElementById('layoutBackdropGhost').children.length,
    ids: document.querySelectorAll('#cover').length, audio: window.__interactionAudio === document.querySelector('audio') }));
  check('reverse-cleans-up-and-keeps-audio', !settled.motion && settled.ghost && settled.layers === 0 && settled.ids === 1 && settled.audio, settled);
  await page.setViewport({ width: 640, height: 128, deviceScaleFactor: 1 }); await sleep(350);
  await page.mouse.move(1, 127); await page.evaluate(() => document.activeElement?.blur()); await sleep(300);
  await page.evaluate(() => { document.querySelector('audio').currentTime = 3; }); await sleep(180);
  await page.evaluate(() => { document.querySelector('audio').currentTime = 7; }); await sleep(30);
  const lyric = await page.evaluate(() => ({ current: document.getElementById('stripLyric').textContent,
    previous: document.querySelector('.strip-lyric-previous')?.textContent, hot: window.__playerDebug.stripState().hot }));
  await sleep(150);
  check('lyric-change-short-crossfade', !lyric.hot && !!lyric.current && !!lyric.previous && lyric.current !== lyric.previous &&
    await page.evaluate(() => !document.querySelector('.strip-lyric-previous')), lyric);
  // 按钮优先命中；下沿及身份区中间空白都能操作同一根原生进度条。
  const seek = await rect('seek'); await page.mouse.click(seek.x + seek.w * .6, seek.y + seek.h - 4); await sleep(120);
  check('blank-seek-area-works', Math.abs((await status()).progress - 18) < 1, await status());
  await page.mouse.move(seek.x + seek.w * .06, seek.y + seek.h / 2);
  await page.mouse.down(); await page.mouse.move(seek.x + seek.w * .14, seek.y + seek.h / 2, { steps: 4 }); await page.mouse.up();
  check('middle-blank-drag-works', Math.abs((await status()).progress - 4.2) < 1, await status());
  check('controls-keep-node-identity', await page.evaluate(() => window.__interactionControls.every(el => el === document.getElementById(el.id))), null);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 }); await sleep(50);
  check('reduced-motion-settles', !(await page.evaluate(() => window.__playerDebug.stripState().motion)));
  // 播放按钮仍走原有所有权仲裁，另一文档必须先让原文档暂停才能出声。
  await page.evaluate(() => window.__playerDebug.requestPlay('user'));
  const other = await newPage();
  await other.goto(`${UI_BASE}/standalone.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await other.waitForFunction(() => window.__playerDebug && document.querySelector('audio').getAttribute('src'));
  await sleep(150);
  check('restore-does-not-steal-live-owner', !(await status()).paused && await other.evaluate(() => document.querySelector('audio').paused));
  await other.evaluate(() => window.__playerDebug.requestPlay('user'));
  await page.waitForFunction(() => document.querySelector('audio').paused);
  check('explicit-takeover-pauses-old-document', (await status()).paused && await other.evaluate(() => !document.querySelector('audio').paused));
  await other.close();
  await page.close();
  check('page-load-without-runtime-errors', report.runtimeErrors.length === 0, report.runtimeErrors);
}

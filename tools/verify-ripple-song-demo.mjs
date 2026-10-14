#!/usr/bin/env node
// AGPL-3.0. Real-song behavioral checks for the standalone preview.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createRippleDemoServer } from './serve-ripple-demo.mjs';

const args = process.argv.slice(2);
const option = key => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; };
const audio = option('--audio'), lyrics = option('--lyrics');
if (!audio) throw new Error('Use --audio <local M4A file> [--lyrics <LRC file>]');
const out = option('--out') || '/tmp/hana-ripple-song-demo-verify';
fs.mkdirSync(out, { recursive: true });
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || '/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');
const server = createRippleDemoServer({ audio, lyrics });
const checks = [], errors = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail ?? '')}`);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.getElementById('playBtn').disabled && document.getElementById('audio').duration > 240);
  const initial = await page.evaluate(() => ({ tune: rippleLab.tune(), palette: rippleLab.palette(), duration: document.getElementById('audio').duration, cover: document.getElementById('coverImage').naturalWidth, src: document.getElementById('audio').getAttribute('src') }));
  check('real-cover-and-local-song-loaded', initial.cover === 800 && !!initial.palette.bg && initial.src === '/demo/song.m4a', initial);
  const access = await page.evaluate(() => {
    const ranges = [...document.querySelectorAll('.tune-panel input[type=range]')];
    return { count: ranges.length, named: ranges.every(e => !!e.getAttribute('aria-label')), described: ranges.every(e => !!document.getElementById(e.getAttribute('aria-describedby'))), more: document.getElementById('tHatThHint').textContent, opacity: document.getElementById('tHatOpacityHint').textContent };
  });
  check('six-sliders-with-direction-and-accessible-names', access.count === 6 && access.named && access.described && /更多/.test(access.more) && /更少/.test(access.more) && /更淡/.test(access.opacity) && /更浓/.test(access.opacity), access);
  await page.click('#playBtn');
  await page.waitForFunction(() => rippleLab.stats().analysing && rippleLab.stats().rms > .001);
  await sleep(12000);
  const first = await page.evaluate(() => ({ stats: rippleLab.stats(), triggers: rippleLab.triggers(), kinds: rippleLab.waveKinds() }));
  check('real-song-has-bass-beats-and-cymbals', first.triggers.bass > 0 && first.triggers.kick + first.triggers.mid > 0 && first.triggers.hat > 0, first);
  await page.screenshot({ path: path.join(out, 'real-song-playing.png') });
  await page.click('.tune-details > summary');
  await page.screenshot({ path: path.join(out, 'toybox-desktop.png'), fullPage: true });

  await page.waitForFunction(() => rippleLab.waveKinds().high > 0);
  const opacity = await page.evaluate(() => {
    const cv = document.getElementById('waterCanvas'), ctx = cv.getContext('2d');
    const sample = () => {
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data; let sum = 0;
      for (let i = 3; i < data.length; i += 4) sum += data[i];
      return { alpha: sum, stats: rippleLab.stats(), triggers: rippleLab.triggers(), volume: document.getElementById('audio').volume };
    };
    const results={};
    for(const [name,key] of [['Bass','bass'],['Kick','beat'],['Hat','hat']]){
      for(const button of document.querySelectorAll('[data-layer]')){
        const shouldShow=button.dataset.layer===key;
        if((button.getAttribute('aria-pressed')==='true')!==shouldShow)button.click();
      }
      const input=document.getElementById('t'+name+'Opacity');
      input.value=20;input.dispatchEvent(new Event('input'));const low=sample();
      input.value=180;input.dispatchEvent(new Event('input'));const high=sample();
      results[name]={low,high};
      document.getElementById('resetTuneBtn').click();
    }
    for(const button of document.querySelectorAll('[data-layer]'))if(button.getAttribute('aria-pressed')!=='true')button.click();
    return {results,reset:rippleLab.tune()};
  });
  for(const [name,{low,high}] of Object.entries(opacity.results)){
    check(name+'-opacity-changes-rendering-only',low.alpha>0&&high.alpha>low.alpha*2&&low.volume===high.volume&&low.stats.fieldEnergy===high.stats.fieldEnergy&&low.stats.frames===high.stats.frames&&JSON.stringify(low.triggers)===JSON.stringify(high.triggers),{lowAlpha:low.alpha,highAlpha:high.alpha,frames:low.stats.frames});
  }
  check('reset-restores-approved-defaults',JSON.stringify(opacity.reset)===JSON.stringify(initial.tune));

  async function countHigh(end) {
    await page.evaluate(async end => {
      const a = document.getElementById('audio'); a.pause(); a.currentTime = 42;
      await new Promise(resolve => { a.addEventListener('seeked', resolve, { once: true }); setTimeout(resolve, 3000); });
      const input = document.getElementById('tHatTh'); input.value = end === 'min' ? input.min : input.max; input.dispatchEvent(new Event('input'));
      await a.play();
    }, end);
    await page.waitForFunction(() => rippleLab.stats().active && rippleLab.stats().rms > .001);
    await sleep(1200); await page.evaluate(() => rippleLab.resetTriggers());
    await sleep(8000);
    return page.evaluate(() => ({ triggers: rippleLab.triggers(), threshold: rippleLab.tune().hat.energy, volume: document.getElementById('audio').volume }));
  }
  const lowGate = await countHigh('min'), highGate = await countHigh('max');
  check('lower-threshold-produces-more-real-song-cymbals', lowGate.triggers.hat > highGate.triggers.hat && lowGate.triggers.hat >= 5 && lowGate.volume === highGate.volume, { lowGate, highGate });
  await page.click('#resetTuneBtn');
  await page.evaluate(() => document.getElementById('audio').pause()); await sleep(650);
  const paused = await page.evaluate(() => {
    const cv = document.getElementById('waterCanvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    return { stats: rippleLab.stats(), canvasClear: !d.some((v, i) => i % 4 === 3 && v !== 0) };
  });
  check('pause-clears-the-field-and-stops-animation', paused.canvasClear && paused.stats.fieldEnergy === 0 && paused.stats.waves === 0 && !paused.stats.raf, paused);
  for (const width of [1040, 465, 360]) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 }); await sleep(100);
    const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, smallText: [...document.querySelectorAll('.tune-details *')].filter(el => el.getClientRects().length && getComputedStyle(el).display !== 'none' && parseFloat(getComputedStyle(el).fontSize) < 11).length }));
    check(`toybox-fits-${width}`, layout.scroll <= width && layout.smallText === 0, layout);
    await page.screenshot({ path: path.join(out, `toybox-${width}.png`), fullPage: true });
  }
  const range = await fetch(base + '/demo/song.m4a', { headers: { Range: 'bytes=16-31' } });
  check('local-audio-range-and-path-boundaries', range.status === 206 && (await range.arrayBuffer()).byteLength === 16 && (await fetch(base + '/package.json')).status === 404);
  check('no-browser-runtime-errors', errors.length === 0, errors);
  fs.writeFileSync(path.join(out, 'verify.json'), JSON.stringify({ checks, errors, initial, first, opacity, lowGate, highGate, paused }, null, 2));
  console.log(`${checks.filter(c => c.ok).length}/${checks.length} passed`);
  if (checks.some(c => !c.ok)) process.exitCode = 1;
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }

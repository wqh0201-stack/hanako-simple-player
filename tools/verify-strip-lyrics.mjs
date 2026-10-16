import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { measureLyricSurfaces, measureLyricClip } from './measure-lyric-surfaces.mjs';

// Touch Bar 歌词星尘：真实 <audio> 时钟与 updateLyricIndex() 路径，另录制页面帧。
export async function verifyStripLyrics({ newPage, BASE, API, UI_BASE, outDir, assert, sleep, clickTab, report }) {
  const dir = path.join(outDir, 'strip-lyrics');
  fs.mkdirSync(dir, { recursive: true });
  const check = (name, ok, detail) => assert('SL-' + name, ok, JSON.stringify(detail));
  const page = await newPage();
  let recorder = null;
  let recording = null;

  async function waitText(text) {
    await page.waitForFunction((value) => document.getElementById('stripLyric').textContent === value,
      { timeout: 6000 }, text);
  }
  async function transition(text) {
    const events = await page.evaluate(() => window.__stripLyricEvents || []);
    return events.filter((event) => event.text === text).slice(-1)[0] || null;
  }
  async function state() {
    return page.evaluate(() => ({
      text: document.getElementById('stripLyric').textContent,
      layout: document.getElementById('player').getAttribute('data-layout'),
      hot: window.__playerDebug.stripState().hot,
      audioTime: document.querySelector('audio').currentTime,
      paused: document.querySelector('audio').paused,
      previous: document.querySelectorAll('.strip-lyric-previous').length,
      dust: document.querySelectorAll('.strip-lyric-dust').length,
      particles: document.querySelectorAll('.strip-lyric-dust > span').length,
      currentOpacity: getComputedStyle(document.getElementById('stripLyric')).opacity
    }));
  }
  async function dustLive() {
    return page.evaluate(() => {
      const dust = document.querySelector('.strip-lyric-dust');
      const points = dust ? [...dust.children] : [];
      const recipes = [...document.querySelectorAll('#stripBar .strip-flight')];
      const sample = points.map((point, i) => {
        const style = getComputedStyle(point), core = getComputedStyle(point, '::before');
        const source = getComputedStyle(recipes[i % 6].firstElementChild);
        const r = point.getBoundingClientRect();
        return { opacity:parseFloat(style.opacity), transform:style.transform, x:r.x, y:r.y,
          size:parseFloat(style.width), core:core.content, glow:style.boxShadow,
          sameRecipe:style.width === source.width && style.backgroundColor === source.backgroundColor
            && style.boxShadow === source.boxShadow && style.color === source.color,
          colorSource:point.style.getPropertyValue('--spark-color'),
          origin:point.getAttribute('data-origin').split(',').map(Number),
          destination:point.getAttribute('data-destination').split(',').map(Number),
          target:point.getAttribute('data-star-target').split(',').map(Number),
          frames:point.getAnimations()[0].effect.getKeyframes() };
      });
      return { count:points.length, starCount:sample.filter((p) => p.core !== 'none').length,
        visiblePoints:sample.filter((p) => p.opacity > 0.2).length,
        maxOpacity:sample.reduce((max, p) => Math.max(max, p.opacity), 0), sample };
    });
  }
  async function observeMotion() {
    await page.evaluate(() => {
      const el = document.getElementById('stripLyric');
      const events = window.__stripLyricEvents = [];
      let last = el.textContent;
      const animation = (node) => node && node.getAnimations().map((item) => {
        const timing = item.effect.getTiming();
        return { duration: timing.duration, elapsedMs:item.currentTime, keyframes: item.effect.getKeyframes() };
      });
      new MutationObserver(() => {
        const text = el.textContent;
        if (text === last) return;
        last = text;
        const old = document.querySelector('.strip-lyric-previous');
        const dust = document.querySelector('.strip-lyric-dust');
        const maskStyle = old ? getComputedStyle(old) : null;
        events.push({
          text,
          wallTime: Date.now() / 1000,
          oldText: old ? old.textContent : '',
          oldClass: old ? old.className : '',
          mask: maskStyle ? (maskStyle.webkitMaskImage || maskStyle.maskImage) : 'none',
          maskPosition: maskStyle ? (maskStyle.webkitMaskPosition || maskStyle.maskPosition) : 'none',
          oldRect: old ? (() => { const r = old.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height }; })() : null,
          currentTransform: getComputedStyle(el).transform,
          currentFade: animation(el),
          oldAnimations: animation(old),
          dustCount: dust ? dust.children.length : 0,
          dustStars: dust ? [...dust.children].filter((p) => getComputedStyle(p, '::before').content !== 'none').length : 0,
          dustGlows: dust ? [...dust.children].filter((p) => getComputedStyle(p).boxShadow !== 'none').length : 0,
          fontSize: getComputedStyle(el).fontSize,
          starCore: dust && dust.children[1] ? getComputedStyle(dust.children[1], '::before').content : 'none',
          dustParticles: dust ? [...dust.children].map((p) => {
            const r = p.getBoundingClientRect(), style = getComputedStyle(p), animationState = p.getAnimations()[0];
            return { x:r.x,y:r.y,w:r.width,h:r.height,opacity:style.opacity,transform:style.transform,
              background:style.backgroundImage,boxShadow:style.boxShadow,playState:animationState && animationState.playState };
          }) : [],
          dustAnimation: animation(dust),
          particleColors: dust ? [...dust.children].map((p) => getComputedStyle(p).color) : [],
          index: window.__playerDebug.lyricFlowState().index,
          time: document.querySelector('audio').currentTime,
          layout: document.getElementById('player').getAttribute('data-layout')
        });
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
  }
  async function beginRecording(target = page, name = 'motion-frames') {
    const frameDir = path.join(dir, name);
    fs.mkdirSync(frameDir, { recursive: true });
    fs.readdirSync(frameDir).filter((name) => /^frame-\d{5}\.png$/.test(name))
      .forEach((name) => fs.unlinkSync(path.join(frameDir, name)));
    const client = await target.target().createCDPSession();
    const frames = [];
    let sequence = 0;
    client.on('Page.screencastFrame', (event) => {
      const file = 'frame-' + String(sequence++).padStart(5, '0') + '.png';
      const received = Date.now() / 1000;
      const timestamp = event.metadata && Number.isFinite(event.metadata.timestamp) ? event.metadata.timestamp : received;
      fs.writeFileSync(path.join(frameDir, file), Buffer.from(event.data, 'base64'));
      frames.push({ file, timestamp, received });
      client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    });
    await client.send('Page.enable');
    await client.send('Page.startScreencast', { format: 'png', quality: 90, everyNthFrame: 1, maxWidth: 720, maxHeight: 128 });
    return {
      frames,
      frameDir,
      stop: async function () {
        await client.send('Page.stopScreencast').catch(() => {});
        await sleep(120);
        await client.detach().catch(() => {});
        return frames;
      }
    };
  }
  function encodeRecording(frames, frameDir, name = 'strip-lyric-rhythm') {
    if (frames.length < 2) return { ok: false, frames: frames.length, error: 'Chromium screencast returned fewer than two frames' };
    const deltas = [];
    for (let i = 1; i < frames.length; i++) {
      const dt = frames[i].timestamp - frames[i - 1].timestamp;
      if (dt > 0 && dt < 0.5) deltas.push(dt);
    }
    const ordered = deltas.slice().sort((a, b) => a - b);
    const median = ordered.length ? ordered[Math.floor(ordered.length / 2)] : 1 / 60;
    const video = path.join(dir, name + '.mp4');
    const ffmpeg = process.env.FFMPEG_BIN || '/Users/can/.local/bin/ffmpeg';
    // 按真实采样时间拼帧，再重采样到 60fps；不能把掉帧直接压缩成更快的动作。
    const sequence = path.join(frameDir, 'frames.ffconcat');
    fs.writeFileSync(sequence, 'ffconcat version 1.0\n' + frames.map((frame, i) =>
      "file '" + frame.file + "'\nduration " + (i + 1 < frames.length ? Math.max(1 / 240, frames[i + 1].timestamp - frame.timestamp) : 1 / 60) + '\n').join(''));
    const result = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', '-safe', '0', '-f', 'concat', '-i', sequence, '-vf', 'fps=60',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', video
    ], { encoding: 'utf8' });
    return {
      ok: result.status === 0,
      path: video,
      frames: frames.length,
      nominalFps: 60,
      medianCaptureFps: median > 0 ? Math.round(1 / median) : null,
      error: result.error ? result.error.message : (result.stderr || '')
    };
  }
  async function seekByMediaTime(time) {
    await page.evaluate((target) => {
      window.__stripSeekTarget = target;
      document.querySelector('audio').currentTime = target;
    }, time);
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return !audio.seeking && Math.abs(audio.currentTime - window.__stripSeekTarget) < 0.8;
    }, { timeout: 3000 });
  }

  async function verifyPalette() {
    const palette = await page.evaluate(() => {
      const debug = window.__playerDebug, canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const rgb = (css) => { ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const hsl = (c) => { const [r, g, b] = c.map((v) => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        const hue = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
        return [hue, d === 0 ? 0 : d / (1 - Math.abs(max + min - 1))]; };
      const gap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
      const host = document.getElementById('player'), cs = getComputedStyle(host), theme = rgb(cs.getPropertyValue('--hk-accent'));
      const stars = [...document.querySelectorAll('#stripBar .strip-flight')].slice(0, 6).map((p) => rgb(getComputedStyle(p.firstElementChild).color));
      const actual = rgb(getComputedStyle(document.getElementById('stripLyric')).color), state = debug.lyricAccentState();
      const chromatic = stars.map(hsl).filter((c) => c[1] > 0.12);
      const cases = [];
      for (const tone of ['light', 'dark']) for (let hue = 0; hue < 360; hue += 30) {
        const colors = Array.from({ length:6 }, (_, i) => rgb('hsl(' + ((hue + i * 60) % 360) + ' 70% 65%)'));
        for (const group of [colors, Array(6).fill(colors[0]), Array(6).fill([130, 130, 130]), []]) {
          const result = debug.lyricAccentFromStars(group, tone === 'dark' ? [32, 38, 46] : [235, 231, 225], tone, theme);
          cases.push({ ...result, count:group.length });
        }
      }
      const controls = [...document.querySelectorAll('.fav-btn, .fav-btn-bar, .q-fav, .search-fav, .controls .identity > .heart')]
        .map((el) => rgb(getComputedStyle(el).color));
      return { stars, actual, state, minHueDistance:chromatic.length ? Math.min(...chromatic.map((c) => gap(c[0], hsl(actual)[0]))) : 180,
        sameSource:JSON.stringify(actual) === JSON.stringify(rgb(cs.getPropertyValue('--lyric-current')))
          && JSON.stringify(actual) === JSON.stringify(rgb(cs.getPropertyValue('--hl-accent'))),
        controls, theme, controlsUseTheme:controls.length > 0 && controls.every((c) => JSON.stringify(c) === JSON.stringify(theme)), cases };
    });
    check('highlight-separates-from-star-group', palette.minHueDistance >= 25
      && palette.sameSource, palette);
    check('highlight-colored-readable-and-deterministic-fallback', palette.cases.every((c) =>
      c.minHueDistance >= 25 && c.contrast >= 4.5 && c.saturation >= 0.4)
      && palette.cases.filter((c) => c.count === 0).every((c) => c.fallback), palette.cases);
    check('hearts-retain-theme-accent', palette.controlsUseTheme, palette);
    report.stripLyricPalette = palette;
    const measured = await measureLyricSurfaces(page, dir);
    const luminance = (rgb) => rgb.map((v) => v / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (a,b) => { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
    const score = (surface) => ({ ...surface, strokeFill:surface.stroke ? contrast(surface.stroke,surface.foreground) : 0,
      samples:surface.pixels.map(p=>({ ...p,luminance:luminance(p.rgb),fillContrast:contrast(surface.foreground,p.rgb),
        strokeContrast:surface.stroke ? contrast(surface.stroke,p.rgb) : 0,
        effective:Math.max(contrast(surface.foreground,p.rgb),surface.stroke ? contrast(surface.stroke,p.rgb) : 0) })) });
    report.stripLyricMeasured = { surfaces:measured.surfaces.map(score),
      regression:{before:score(measured.regression.before),after:score(measured.regression.after)} };
    for(const surface of report.stripLyricMeasured.surfaces) {
      const vertical=surface.name==='vertical';
      // 2026-10-16罐头拍板：竖卡深底保持现状，使用指定的大字3.0数值门槛，未修成4.5。
      // 不宣称当前字号已满足WCAG“大字”定义；亮于黑字4.5分界(L>=.175)的点仍走4.5有效分离度。
      const passed=surface.samples.every(p=>vertical&&p.luminance<.175 ? p.fillContrast>=3 : p.effective>=4.5&&surface.strokeFill>=3);
      const worst=surface.samples.reduce((a,b)=>(vertical?a.fillContrast:a.effective)<(vertical?b.fillContrast:b.effective)?a:b);
      check('measured-contrast-'+surface.name, !!surface.stroke&&surface.strokeFill>=3&&passed,
        {policy:vertical?'用户已知取舍：深底fill>=3，非4.5修复；亮点仍effective>=4.5':'effective>=4.5 && stroke/fill>=3',
          foreground:surface.foreground,stroke:surface.stroke,strokeFill:surface.strokeFill,worst,pixels:surface.samples.length,
          fillSource:surface.fillInk,strokeSource:surface.strokeInk});
    }
    const r=report.stripLyricMeasured.regression,min=(s,key)=>Math.min(...s.samples.map(p=>p[key]));
    check('stroke-regression-old-fill-fails-rendered-outline-passes', !r.before.stroke && min(r.before,'fillContrast')<4.5
      && !!r.after.stroke && min(r.after,'effective')>=4.5 && r.after.strokeFill>=3
      && JSON.stringify(r.before.foreground)===JSON.stringify(r.after.foreground),
      {beforeFill:min(r.before,'fillContrast'),afterFill:min(r.after,'fillContrast'),afterEffective:min(r.after,'effective'),
        strokeFill:r.after.strokeFill,beforeFillRGB:r.before.foreground,afterFillRGB:r.after.foreground,stroke:r.after.stroke});
    const rules=report.stripLyricMeasured.surfaces.map(s=>s.strokeRule);
    check('outline-one-rule-all-surfaces-and-glow-retained',rules.every(s=>s.color===rules[0].color&&s.width===rules[0].width
      && parseFloat(s.width)>0&&s.paintOrder.split(/\s+/)[0]==='stroke'&&s.glow!=='none'),rules);
    fs.writeFileSync(path.join(dir, 'measured-surfaces.json'), JSON.stringify(report.stripLyricMeasured, null, 2));
  }
  async function verifyWrapping() {
    const profiles = [];
    for (const profile of [{ size:16, width:416, mode:'strip-wrap' }, { size:22, width:540, mode:'strip-font-roomy' }]) {
      await fetch(`${BASE}${API}/__fixture/reset?mode=${profile.mode}&appSurfaceSession=fake-ticket`);
      const wrap = await newPage();
      let fontRecorder = null;
      const suffix = profile.size === 16 ? '' : '-22px';
      try {
        await wrap.setViewport({ width:profile.width, height:128, deviceScaleFactor:1 });
        await wrap.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil:'domcontentloaded' });
        await wrap.waitForFunction(() => window.__playerDebug && document.querySelector('#listTabs .list-tab'));
        await clickTab(wrap, 'imp:1');
        await wrap.waitForFunction(() => document.querySelector('#queueList .q-hit'));
        await wrap.mouse.move(1, 127);
        fontRecorder = await beginRecording(wrap, 'font-' + profile.size + '-frames');
        await wrap.evaluate(() => document.querySelector('#queueList .q-hit').click());
        const wait = (text) => wrap.waitForFunction((value) => document.getElementById('stripLyric').textContent === value, { timeout:6000 }, text);
        const measure = () => wrap.evaluate(() => {
          const el = document.getElementById('stripLyric'), cs = getComputedStyle(el), r = el.getBoundingClientRect();
          const context = document.querySelector('.strip-context').getBoundingClientRect();
          const identity = document.getElementById('stripIdentity').getBoundingClientRect();
          return { text:el.textContent, font:cs.fontSize, height:r.height, width:r.width, x:r.x, y:r.y,
            lineHeight:parseFloat(cs.lineHeight), clamp:cs.webkitLineClamp, scrollHeight:el.scrollHeight,
            overflow:cs.overflow, scrollWidth:el.scrollWidth, contextWidth:context.width, contextHeight:context.height,
            centered:Math.abs((r.top + r.bottom - context.top - context.bottom) / 2) <= 1,
            contained:r.left >= identity.right + 11 && r.right <= context.right + 1 && r.top >= context.top && r.bottom <= context.bottom,
            transform:cs.transform, model:window.__playerDebug.stripLyricFontState() };
        });
        await wait('短句');
        const short = await measure();
        await wait('这句歌词需要换成两行读完');
        const long = await measure();
        check('two-line-lyric-is-complete-uniform-size-and-contained' + suffix,
          +parseFloat(short.font) === profile.size && long.font === short.font
          && parseFloat(long.font) >= 16 && parseFloat(long.font) <= long.model.upper
          && long.height > long.lineHeight * 1.5 && long.height <= long.lineHeight * 2 + 1
          && long.scrollHeight <= long.height + 1 && long.width <= long.contextWidth + 1
          && long.centered && short.centered && long.contained && short.contained && long.transform === 'none', { short, long });
        const fit = await wrap.evaluate(() => {
          const context = document.querySelector('.strip-context'), model = window.__playerDebug.stripLyricFontState();
          const probe = document.getElementById('stripLyric').cloneNode(false);
          probe.removeAttribute('id');
          Object.assign(probe.style, { position:'absolute', left:'0', top:'0', visibility:'hidden', webkitLineClamp:'unset',
            width:Math.floor(context.getBoundingClientRect().width) + 'px', overflow:'visible' });
          context.appendChild(probe);
          const fits = (text, size) => { probe.style.fontSize = size + 'px'; probe.textContent = text; return probe.getBoundingClientRect().height <= size * 2.4 + 0.5; };
          const nextFits = model.size < model.upper ? [...document.querySelectorAll('.lyric-text')].every((line) => fits(line.textContent, model.size + 1)) : null;
          const capacity = {};
          for (const size of [13, 16, 22, model.size]) {
            let lo = 0, hi = 512;
            while (lo + 1 < hi) { const mid = Math.floor((lo + hi) / 2); if (fits('字'.repeat(mid), size)) lo = mid; else hi = mid; }
            capacity[size] = lo;
          }
          probe.remove();
          return { nextFits, capacity, model };
        });
        await wait('短句再来');
        const outgoing = await wrap.evaluate(() => {
          const old = document.querySelector('.strip-lyric-previous'), dust = document.querySelector('.strip-lyric-dust');
          if (!old || !dust) return null;
          const r = old.getBoundingClientRect(), bar = document.getElementById('stripBar').getBoundingClientRect();
          const range = document.createRange(), centers = [], text = old.firstChild;
          for (let i = 0; i < text.length; i++) {
            range.setStart(text, i); range.setEnd(text, i + 1); const b = range.getBoundingClientRect();
            if (b.top >= r.top - 1 && b.bottom <= r.bottom + 1) centers.push([(b.left + b.right) / 2 - bar.left, (b.top + b.bottom) / 2 - bar.top]);
          }
          const origins = [...dust.children].map((p) => p.getAttribute('data-origin').split(',').map(Number));
          const ink=(el)=>{const s=getComputedStyle(el);return {width:s.webkitTextStrokeWidth,color:s.webkitTextStrokeColor,order:s.paintOrder};};
          return { text:old.textContent, x:r.x, y:r.y, width:r.width, height:r.height,
            stroke:ink(old),currentStroke:ink(document.getElementById('stripLyric')),
            origins, rows:new Set(origins.map((p) => Math.round(p[1]))).size,
            onGlyph:origins.every((p) => centers.some((c) => Math.hypot(p[0] - c[0], p[1] - c[1]) < 1)) };
        });
        check('multiline-outgoing-and-range-origins-stay-aligned' + suffix, !!outgoing
          && outgoing.text === long.text && Math.abs(outgoing.x - long.x) <= 1 && Math.abs(outgoing.y - long.y) <= 1
          && Math.abs(outgoing.width - long.width) <= 1 && Math.abs(outgoing.height - long.height) <= 1
          && outgoing.rows === 2 && outgoing.onGlyph, { long, outgoing });
        check('outgoing-inherits-identical-outline-' + profile.size,!!outgoing
          && JSON.stringify(outgoing.stroke)===JSON.stringify(outgoing.currentStroke)&&parseFloat(outgoing.stroke.width)>0,outgoing);
        await wrap.screenshot({ path:path.join(dir, 'two-line-outgoing-' + profile.size + '.png') });
        const fontFrames = await fontRecorder.stop();
        const fontRecord = encodeRecording(fontFrames, fontRecorder.frameDir, 'font-' + profile.size + '-two-line-60fps');
        fontRecorder = null;
        check('font-chooses-largest-allowed-integer-' + profile.size, fontRecord.ok
          && Number.isInteger(fit.model.size) && fit.model.size >= 16 && fit.model.size <= fit.model.upper
          && (fit.model.size === fit.model.upper || fit.nextFits === false), { fit, recording:fontRecord });
        const clip=await measureLyricClip(wrap,dir,'two-line-outline-'+profile.size,'#stripLyric',long.text);
        check('two-line-outline-not-clipped-or-reflowed-'+profile.size,clip.reference>0&&clip.lost===0&&clip.outsideRows===0&&clip.verticalEdge===0
          && Math.abs(clip.before.width-long.width)<=1&&Math.abs(clip.before.height-long.height)<=1
          && clip.before.width===clip.after.width&&clip.before.height===clip.after.height&&clip.before.clamp==='2',clip);
        let extreme = null, capped = null, extremeClip = null;
        if (profile.size === 16) {
          await wrap.waitForFunction(() => document.getElementById('stripLyric').textContent.length > 80);
          await wrap.setViewport({ width:312, height:128, deviceScaleFactor:1 });
          await sleep(240);
          extreme = await measure();
          check('extreme-line-clamps-at-two-without-scroll-or-font-change', parseFloat(extreme.font) === 16
            && extreme.font === short.font && extreme.clamp === '2' && extreme.overflow === 'clip'
            && extreme.height <= extreme.lineHeight * 2 + 1 && extreme.scrollHeight > extreme.height
            && extreme.scrollWidth <= extreme.contextWidth + 1 && extreme.width <= extreme.contextWidth + 1
            && extreme.centered && extreme.contained && extreme.transform === 'none', extreme);
          await wrap.screenshot({ path:path.join(dir, 'two-line-extreme-312.png') });
          extremeClip=await measureLyricClip(wrap,dir,'extreme-outline-312','#stripLyric',extreme.text);
          check('ellipsis-outline-not-clipped-or-reflowed',extremeClip.reference>0&&extremeClip.lost===0&&extremeClip.outsideRows===0&&extremeClip.verticalEdge===0
            && Math.abs(extremeClip.before.width-extreme.width)<=1&&Math.abs(extremeClip.before.height-extreme.height)<=1
            && extremeClip.before.clamp==='2',extremeClip);
        } else {
          await wrap.setViewport({ width:1040, height:80, deviceScaleFactor:1 });
          await sleep(240);
          capped = await measure();
          check('font-ceiling-respects-short-bar-height', capped.model.upper === 20 && parseFloat(capped.font) === 20
            && capped.model.height === 56 && capped.lineHeight * 2 <= capped.contextHeight - 8 + 1
            && capped.centered && capped.contained, capped);
        }
        profiles.push({ profile, short, long, outgoing, fit, extreme, capped, clip, extremeClip, recording:fontRecord });
      } finally {
        if (fontRecorder) await fontRecorder.stop().catch(() => {});
        await wrap.close();
      }
    }
    report.stripLyricWrapping = { profiles };
  }

  try {
    await fetch(`${BASE}${API}/__fixture/reset?mode=strip-rhythm&appSurfaceSession=fake-ticket`);
    await page.setViewport({ width: 720, height: 128, deviceScaleFactor: 1 });
    await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__playerDebug && document.querySelector('#listTabs .list-tab'));
    await clickTab(page, 'imp:1');
    await page.waitForFunction(() => document.querySelector('#queueList .q-hit'));
    await observeMotion();
    await page.mouse.move(1, 127);
    recorder = await beginRecording();
    await page.evaluate(() => document.querySelector('#queueList .q-hit').click());
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return !audio.paused && audio.duration > 20 && document.querySelectorAll('.lyric-line').length >= 15
        && document.getElementById('player').getAttribute('data-layout') === 'strip';
    }, { timeout: 10000 });

    await waitText('正常节奏一');
    const normal = await transition('正常节奏一');
    await page.waitForFunction(() => [...document.querySelectorAll('.strip-lyric-dust > .strip-spark')]
      .some((point) => parseFloat(getComputedStyle(point).opacity) > 0.2), { timeout: 500 });
    const normalLive = await dustLive();
    check('star-points-are-visibly-lit', normalLive.count > 0 && normalLive.visiblePoints > 0
      && normalLive.maxOpacity > 0.2 && normalLive.maxOpacity <= 0.66, normalLive);
    check('dust-uses-progress-star-recipe', normalLive.sample.every((p) => p.sameRecipe
      // Chromium 布局宽度量化到 1/64 CSS px；仍逐粒与真实进度条样式严格比对。
      && p.size >= 1.1 - 1 / 64 && p.size <= 2.8 + 1 / 64 && /var\(--strip-star-[0-5]\)/.test(p.colorSource)
      && p.frames.some((f) => +f.opacity === 0.65))
      && normalLive.starCount === Math.floor((normalLive.count + 4) / 6), normalLive);
    check('dust-travels-from-text-toward-star-field', normalLive.sample.every((p) => {
      const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      return p.destination[0] < p.origin[0] && distance(p.destination, p.target) < distance(p.origin, p.target)
        && +p.frames.at(-1).opacity === 0;
    }), normalLive);
    await page.screenshot({ path: path.join(dir, 'star-dissolve-live.png') });
    await waitText('快速歌词一');
    const fast = await transition('快速歌词一');
    await waitText('快速歌词二');
    await waitText('正常节奏二');
    await waitText('正常节奏三');
    await waitText('舒缓歌词一');
    const slow = await transition('舒缓歌词一');
    await waitText('同刻翻译');
    const duplicate = await transition('同刻翻译');
    await waitText('快速连切三');
    await sleep(120);

    check('natural-transition-has-local-mask-and-particles', !!normal && normal.oldText === '起始歌词'
      && /linear-gradient/i.test(normal.mask) && normal.oldClass.indexOf('is-dissolving') >= 0
      && normal.dustCount > 0 && normal.dustCount <= 14 && normal.dustStars > 0
      && normal.dustGlows === normal.dustCount && normal.starCore !== 'none'
      && normal.oldAnimations.length > 0 && normal.oldAnimations[0].keyframes.some((frame) => frame.maskPosition), normal);
    check('incoming-is-immediate-in-place-fade', !!normal && normal.text === '正常节奏一'
      && normal.currentFade && normal.currentFade[0].duration > 0
      && normal.currentFade[0].duration <= normal.oldAnimations[0].duration && normal.currentTransform === 'none', normal);
    // 首句允许启动/seek 防护下走切句兜底；检查的是后续已排好预约不被上一轮收尾取消。
    check('cleanup-preserves-next-lines-pre-scheduled-lead', [fast, slow].every((event) =>
      event.oldAnimations && event.oldAnimations[0].elapsedMs > 0),
      [fast, slow].map((event) => ({ text:event.text, elapsed:event.oldAnimations[0].elapsedMs })));
    check('fast-transition-is-shorter-than-normal', !!fast && !!normal
      && fast.oldAnimations[0].duration < normal.oldAnimations[0].duration
      && fast.dustAnimation[0].duration < normal.dustAnimation[0].duration, { fast, normal });
    // stripLyricTransitionDuration 按下一组歌词间隔封顶；由实测媒体时钟推导窗口，避免写死毫秒。
    const slowWindowMs = slow && duplicate ? Math.max(0, (duplicate.time - slow.time) * 1000) : 0;
    check('slow-transition-has-longer-bounded-dust-tail', !!slow && !!normal && slowWindowMs > 0
      && slow.oldAnimations[0].duration > normal.oldAnimations[0].duration
      && slow.dustAnimation[0].duration > normal.dustAnimation[0].duration
      && slow.oldAnimations[0].duration <= slowWindowMs && slow.dustAnimation[0].duration <= slowWindowMs,
      { slow, normal, slowWindowMs });
    check('same-timestamp-lines-use-one-group', !!duplicate && duplicate.text === '同刻翻译'
      && duplicate.dustAnimation[0].duration > 0
      && !(await page.evaluate(() => (window.__stripLyricEvents || []).some((event) => event.text === '舒缓歌词二'))), duplicate);
    check('same-track-font-is-uniform-and-bounded', await page.evaluate(() => {
      const events = (window.__stripLyricEvents || []).filter((event) => event.oldText);
      const upper = Math.min(22, Math.floor((document.querySelector('.strip-context').clientHeight - 8) / 2.4));
      return new Set(events.map((event) => event.text.length)).size > 1
        && new Set(events.map((event) => event.fontSize)).size === 1
        && events.every((event) => Number.isInteger(parseFloat(event.fontSize))
          && parseFloat(event.fontSize) >= 16 && parseFloat(event.fontSize) <= upper);
    }), { normal:normal.fontSize, fast:fast.fontSize, slow:slow.fontSize });
    check('no-queued-transitions-or-duplicate-layers', await page.evaluate(() =>
      document.querySelectorAll('.strip-lyric-previous').length <= 1 && document.querySelectorAll('.strip-lyric-dust').length <= 1
      && document.querySelectorAll('.strip-lyric-dust > span').length <= 14), await state());

    // 真实 range 点击定位：记录快切后 seek 与控件 hover； seek 应立即呈现目标句。
    const bar = await page.$eval('#stripBar', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await page.mouse.click(bar.x + bar.w * (14.6 / 30), bar.y + bar.h / 2);
    await page.waitForFunction(() => document.getElementById('stripLyric').textContent === 'Seek目标歌词', { timeout: 3000 });
    await page.waitForFunction(() => window.__playerDebug.stripState().hot);
    const hovered = await state();
    check('seek-target-shows-immediately', hovered.text === 'Seek目标歌词' && hovered.previous === 0 && hovered.dust === 0, hovered);
    await sleep(550);
    await page.mouse.move(1, 127);
    await page.waitForFunction(() => !window.__playerDebug.stripState().hot);

    recording = await recorder.stop();
    recorder = null;
    const recordingReport = encodeRecording(recording, path.join(dir, 'motion-frames'));
    const recordedEvents = await page.evaluate(() => window.__stripLyricEvents || []);
    const recordStart = recording.length ? recording[0].received : 0;
    recordingReport.markers = recordedEvents.map((event) => ({ text:event.text, audioTime:event.time,
      clipSeconds:recordStart ? +(event.wallTime - recordStart).toFixed(3) : null }));
    recordingReport.scenes = ['normal', 'fast', 'slow'].map((name, i) => {
      const event = [normal, fast, slow][i];
      const at = Math.max(0, event.wallTime - recordStart - 0.24);
      const file = path.join(dir, name + '-transition-60fps.mp4');
      const encoded = spawnSync(process.env.FFMPEG_BIN || '/Users/can/.local/bin/ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', recordingReport.path,
        '-t', '1.1', '-r', '60', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', file
      ], { encoding:'utf8' });
      return { name, at, path:file, ok:encoded.status === 0, audioTime:event.time };
    });
    report.stripLyricRecording = recordingReport;
    check('dynamic-recording-captures-real-timeline', recordingReport.ok && recordingReport.frames >= 20
      && recordingReport.scenes.every((scene) => scene.ok), recordingReport);

    // 再以媒体 seeked 事件验证：指针在安静区时也不会把 seek 当自然切句。
    await seekByMediaTime(15.1);
    await waitText('Seek目标歌词');
    const seekEvent = await transition('Seek目标歌词');
    check('seeked-path-does-not-create-particles', !!seekEvent && seekEvent.dustCount === 0 && seekEvent.oldText === '', seekEvent);

    // 暂停落在正在执行的自然转场中，清理副本/粒子并立刻恢复新句可读性。
    await seekByMediaTime(16.05);
    await page.evaluate(() => window.__playerDebug.requestPlay('user'));
    await waitText('暂停中断句');
    await page.waitForFunction(() => document.querySelector('.strip-lyric-previous'));
    await page.evaluate(() => window.__playerDebug.pauseAll());
    await sleep(40);
    const paused = await state();
    check('pause-cancels-and-restores-current-text', paused.paused && paused.previous === 0 && paused.dust === 0
      && paused.particles === 0 && paused.currentOpacity === '1', paused);

    // 页面隐藏期间中止；恢复后不补播同一转场。
    await seekByMediaTime(18.35);
    await page.evaluate(() => window.__playerDebug.requestPlay('user'));
    await waitText('隐藏中断句');
    await page.waitForFunction(() => document.querySelector('.strip-lyric-previous'));
    const other = await newPage();
    await other.bringToFront();
    await page.waitForFunction(() => document.hidden, { timeout: 3000 });
    const hidden = await state();
    check('hidden-page-cleans-animation', hidden.previous === 0 && hidden.dust === 0 && hidden.particles === 0, hidden);
    await page.bringToFront();
    await other.close();
    await page.waitForFunction(() => !document.hidden, { timeout: 3000 });
    await sleep(50);
    check('page-restore-does-not-replay-effect', await page.evaluate(() =>
      document.querySelectorAll('.strip-lyric-previous, .strip-lyric-dust').length === 0), await state());

    // Hover/focus 进入控件时主动中止；退出 hover 只露出当前文本，不补播动画。
    await seekByMediaTime(19.85);
    await page.evaluate(() => window.__playerDebug.requestPlay('user'));
    await waitText('悬停中断句');
    await page.waitForFunction(() => document.querySelector('.strip-lyric-previous'));
    await page.mouse.move(bar.x + bar.w * 0.85, bar.y + bar.h / 2);
    await sleep(40);
    const hoverCancelled = await state();
    check('hover-cancels-active-dissolve', hoverCancelled.hot && hoverCancelled.previous === 0
      && hoverCancelled.dust === 0 && hoverCancelled.particles === 0, hoverCancelled);
    await page.mouse.move(1, 127);
    await waitText('悬停中断句');
    await sleep(90);
    check('hover-exit-does-not-replay-effect', await page.evaluate(() =>
      document.querySelectorAll('.strip-lyric-previous, .strip-lyric-dust').length === 0), await state());

    // 离开 strip 与 Reduced Motion 都必须收干净，后续歌词只更新文本。
    await seekByMediaTime(20.85);
    await waitText('布局退出句');
    await page.waitForFunction(() => document.querySelector('.strip-lyric-previous'));
    await page.setViewport({ width: 720, height: 780, deviceScaleFactor: 1 });
    await page.waitForFunction(() => document.getElementById('player').getAttribute('data-layout') !== 'strip');
    check('exit-strip-cleans-animation', await page.evaluate(() =>
      document.querySelectorAll('.strip-lyric-previous, .strip-lyric-dust').length === 0), await state());
    await page.setViewport({ width: 720, height: 128, deviceScaleFactor: 1 });
    await page.waitForFunction(() => document.getElementById('player').getAttribute('data-layout') === 'strip');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await seekByMediaTime(21.8);
    await page.evaluate(() => window.__playerDebug.requestPlay('user'));
    await waitText('减少动态歌词');
    check('reduced-motion-skips-dissolve-and-dust', await page.evaluate(() =>
      document.querySelectorAll('.strip-lyric-previous, .strip-lyric-dust').length === 0), await state());

    // 312px 档使用较少粒子，全部留在 stripBar 的可视边界内。
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await page.setViewport({ width: 312, height: 128, deviceScaleFactor: 1 });
    await page.waitForFunction(() => document.getElementById('player').getAttribute('data-layout') === 'strip');
    await page.mouse.move(1, 127);
    await seekByMediaTime(22.85);
    await page.evaluate(() => window.__playerDebug.requestPlay('user'));
    await waitText('窄幅歌词');
    const narrow = await page.evaluate(() => {
      const bar = document.getElementById('stripBar').getBoundingClientRect();
      const dust = document.querySelector('.strip-lyric-dust');
      const particles = dust ? [...dust.children].map((el) => {
        const r = el.getBoundingClientRect(), spread = 12; // 同款最大辉光 10px blur + 2px spread
        return { left:r.left - spread,right:r.right + spread,top:r.top - spread,bottom:r.bottom + spread };
      }) : [];
      const stars = dust ? [...dust.children].filter((p) => getComputedStyle(p, '::before').content !== 'none').length : 0;
      return { text:document.getElementById('stripLyric').textContent, count:particles.length, stars,
        inside:particles.every((p) => p.left >= bar.left - 1 && p.right <= bar.right + 1 && p.top >= bar.top - 1 && p.bottom <= bar.bottom + 1),
        previous:document.querySelectorAll('.strip-lyric-previous').length };
    });
    check('narrow-dust-is-limited-and-contained', narrow.count > 0 && narrow.count < normal.dustCount
      && narrow.stars > 0 && narrow.inside && narrow.previous <= 1, narrow);

    // 切歌时恰逢自然转场，也必须立即移除上一曲的歌词副本与粒子。
    // 目标句放在 29s，留出足够观察窗口，不依赖几十毫秒轮询竞态。
    await seekByMediaTime(28.85);
    await page.evaluate(() => window.__playerDebug.requestPlay('user'));
    await waitText('跳跃目标');
    await page.waitForFunction(() => document.querySelector('.strip-lyric-previous'));
    const beforeTrackChange = await page.evaluate(() => document.querySelector('audio').currentSrc);
    await page.evaluate(() => document.getElementById('nextBtn').click());
    await page.waitForFunction((oldSrc) => document.querySelector('audio').currentSrc !== oldSrc,
      { timeout: 5000 }, beforeTrackChange);
    await sleep(50);
    const changedTrack = await state();
    check('track-switch-clears-previous-lyric-effects', changedTrack.previous === 0 && changedTrack.dust === 0 && changedTrack.particles === 0, changedTrack);

    await verifyPalette();
    await verifyWrapping();
    fs.writeFileSync(path.join(dir, 'transitions.json'), JSON.stringify({ normal, normalLive, fast, slow, duplicate, events: await page.evaluate(() => window.__stripLyricEvents || []), recording: recordingReport }, null, 2));
    await page.screenshot({ path: path.join(dir, 'strip-lyrics-narrow.png') });
    await page.close();
    await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  } catch (error) {
    if (recorder) await recorder.stop().catch(() => {});
    await page.close().catch(() => {});
    await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`).catch(() => {});
    throw error;
  }
}

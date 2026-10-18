import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { measureLyricSurfaces, measureLyricClip, scoreSoftShadow } from './measure-lyric-surfaces.mjs';

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
  async function fadeFor(oldText) {
    return page.evaluate((value) => {
      const rows = window.__stripLyricFadeSamples || [];
      return rows.filter((row) => row.oldText === value).slice(-1)[0] || null;
    }, oldText);
  }
  async function installDustProbe(target) {
    await target.evaluate(() => {
      window.__stripCanvasStats = function (canvas) {
        if (!canvas || canvas.tagName !== 'CANVAS' || !canvas.width || !canvas.height) return {
          activePixels:0, brightPixels:0, brightComponents:0, colorPixels:0, bounds:null,
          xBands:[], yBands:[], width:canvas ? canvas.width : 0, height:canvas ? canvas.height : 0
        };
        const width = canvas.width, height = canvas.height;
        const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
        const xBands = Array(6).fill(0), yBands = Array(4).fill(0);
        const bright = new Uint8Array(width * height);
        let activePixels = 0, brightPixels = 0, colorPixels = 0;
        let left = width, top = height, right = -1, bottom = -1;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4, a = data[i + 3];
          if (a <= 8) continue;
          activePixels++;
          if (x < left) left = x; if (x > right) right = x;
          if (y < top) top = y; if (y > bottom) bottom = y;
          xBands[Math.min(5, Math.floor(x * 6 / width))]++;
          yBands[Math.min(3, Math.floor(y * 4 / height))]++;
          const max = Math.max(data[i], data[i + 1], data[i + 2]);
          const min = Math.min(data[i], data[i + 1], data[i + 2]);
          if (max - min > 28 && a > 16) colorPixels++;
          if (data[i] > 210 && data[i + 1] > 210 && data[i + 2] > 210 && a > 18) {
            bright[ y * width + x ] = 1; brightPixels++;
          }
        }
        let brightComponents = 0;
        const seen = new Uint8Array(bright.length), stack = [];
        for (let seed = 0; seed < bright.length; seed++) {
          if (!bright[seed] || seen[seed]) continue;
          brightComponents++; seen[seed] = 1; stack.push(seed);
          while (stack.length) {
            const at = stack.pop(), x = at % width, y = Math.floor(at / width);
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
              const next = ny * width + nx;
              if (bright[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
            }
          }
        }
        return { activePixels, brightPixels, brightComponents, colorPixels,
          bounds:right < 0 ? null : { left, top, right, bottom }, xBands, yBands, width, height };
      };
      const probe = window.__stripDustProbe = { canvases:[] };
      const byCanvas = new WeakMap();
      const remember = (node) => {
        if (!node || node.nodeType !== 1) return;
        if (node.matches && node.matches('canvas.strip-lyric-dust') && !byCanvas.has(node)) {
          const record = { canvas:node, createdAt:performance.now(), calls:[] };
          byCanvas.set(node, record); probe.canvases.push(record);
        }
        if (node.querySelectorAll) node.querySelectorAll('canvas.strip-lyric-dust').forEach(remember);
      };
      const host = document.getElementById('stripBar');
      new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(remember)))
        .observe(host, { childList:true, subtree:true });
      const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (image) {
        const record = byCanvas.get(this.canvas);
        if (record) {
          const args = Array.prototype.slice.call(arguments, 1), now = performance.now();
          let x, y, w, h;
          if (args.length === 2) { x=args[0]; y=args[1]; w=image.width; h=image.height; }
          else if (args.length === 4) { x=args[0]; y=args[1]; w=args[2]; h=args[3]; }
          else if (args.length === 8) { x=args[4]; y=args[5]; w=args[6]; h=args[7]; }
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h)
            && now - record.createdAt <= 220 && record.calls.length < 12000) {
            record.calls.push({ x:x+w/2, y:y+h/2, elapsedMs:now-record.createdAt });
          }
        }
        return originalDrawImage.apply(this, arguments);
      };
      window.__stripDustEmissionStats = function (canvas, outgoing) {
        if (!canvas || !outgoing) return { calls:0, glyphHits:0, lineHits:[] };
        const record = probe.canvases.find((entry) => entry.canvas === canvas);
        const rect = canvas.getBoundingClientRect(), glyphs = [];
        const walker = document.createTreeWalker(outgoing, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const row = node.parentElement && node.parentElement.closest('.strip-lyric-main, .strip-lyric-sub');
          for (let i = 0; i < node.nodeValue.length; i++) {
            const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
            const r = range.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) glyphs.push({ left:r.left-rect.left, right:r.right-rect.left,
              top:r.top-rect.top, bottom:r.bottom-rect.top, row:row ? row.classList[0] : '' });
          }
        }
        const lineCenters = [];
        glyphs.slice().sort((a,b) => a.top-b.top).forEach((g) => {
          const center = (g.top+g.bottom)/2;
          if (!lineCenters.some((line) => Math.abs(line.center-center) <= 3)) lineCenters.push({ center, hits:0 });
        });
        const rowHits = {};
        const calls = record ? record.calls.filter((call) => call.elapsedMs <= 220) : [];
        let glyphHits = 0;
        calls.forEach((call) => {
          const glyph = glyphs.find((g) => call.x >= g.left-9 && call.x <= g.right+9
            && call.y >= g.top-9 && call.y <= g.bottom+9);
          if (!glyph) return;
          glyphHits++;
          let key = glyph.row;
          if (!key) {
            let best = 0, distance = Infinity;
            lineCenters.forEach((line, i) => { const d=Math.abs(line.center-call.y); if(d<distance){distance=d;best=i;} });
            key = 'line-' + best;
          }
          rowHits[key] = (rowHits[key] || 0) + 1;
        });
        return { calls:calls.length, glyphHits, lineHits:lineCenters.map((line,i) => rowHits['line-'+i] || 0),
          rowHits, glyphLines:lineCenters.length, record:!!record };
      };
    });
  }
  async function state() {
    return page.evaluate(() => {
      const dust = document.querySelector('.strip-lyric-dust');
      const stats = window.__stripCanvasStats ? window.__stripCanvasStats(dust) : { activePixels:0 };
      return {
        text: document.getElementById('stripLyric').textContent,
        layout: document.getElementById('player').getAttribute('data-layout'),
        hot: window.__playerDebug.stripState().hot,
        audioTime: document.querySelector('audio').currentTime,
        paused: document.querySelector('audio').paused,
        previous: document.querySelectorAll('.strip-lyric-previous').length,
        dust: document.querySelectorAll('.strip-lyric-dust').length,
        dustPixels: stats.activePixels,
        dustBrightComponents: stats.brightComponents || 0,
        currentOpacity: getComputedStyle(document.getElementById('stripLyric')).opacity
      };
    });
  }
  async function dustLive() {
    return page.evaluate(() => {
      const dust = document.querySelector('.strip-lyric-dust');
      const old = document.querySelector('.strip-lyric-previous');
      const stats = window.__stripCanvasStats(dust);
      const emission = window.__stripDustEmissionStats(dust, old);
      const bar = document.getElementById('stripBar').getBoundingClientRect();
      const rect = dust ? dust.getBoundingClientRect() : null;
      const small = window.__playerDebug.stripState().small;
      const budget = Math.round((small ? 200 : 320) * 0.45);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      return { canvas:!!dust && dust.tagName === 'CANVAS', count:stats.brightComponents,
        budget, small, stats, emission,
        contained:!!rect && rect.left >= bar.left-1 && rect.right <= bar.right+1
          && rect.top >= bar.top-1 && rect.bottom <= bar.bottom+1
          && (!stats.bounds || (stats.bounds.left >= 0 && stats.bounds.top >= 0
            && stats.bounds.right < dust.width && stats.bounds.bottom < dust.height)),
        cssSize:rect ? { width:rect.width, height:rect.height } : null, dpr };
    });
  }
  async function observeMotion() {
    await page.evaluate(() => {
      const el = document.getElementById('stripLyric'), bar = document.getElementById('stripBar');
      const events = window.__stripLyricEvents = [];
      const fades = window.__stripLyricFadeSamples = [];
      let last = el.textContent;
      const animation = (node) => node && node.getAnimations().map((item) => {
        const timing = item.effect.getTiming();
        return { duration: timing.duration, elapsedMs:item.currentTime, keyframes: item.effect.getKeyframes() };
      });
      const readOpacity = (node, started) => ({ elapsedMs:performance.now()-started,
        opacity:parseFloat(getComputedStyle(node).opacity), filter:getComputedStyle(node).filter });
      const sampleFade = (node, record) => {
        record.samples.push(readOpacity(node, record.started));
        if (node.isConnected) requestAnimationFrame(() => sampleFade(node, record));
        else record.closed = true;
      };
      new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
        const overlays = [];
        if (node.nodeType === 1 && node.matches('.strip-lyric-previous')) overlays.push(node);
        if (node.nodeType === 1 && node.querySelectorAll) overlays.push(...node.querySelectorAll('.strip-lyric-previous'));
        overlays.forEach((old) => {
          const fade = { oldText:old.textContent, started:performance.now(), samples:[], closed:false };
          fades.push(fade); sampleFade(old, fade);
        });
      }))).observe(bar, { childList:true, subtree:true });
      new MutationObserver((records) => records.forEach((record) => record.removedNodes.forEach((node) => {
        const removed = [];
        if (node.nodeType === 1 && node.matches('.strip-lyric-previous')) removed.push(node);
        if (node.nodeType === 1 && node.querySelectorAll) removed.push(...node.querySelectorAll('.strip-lyric-previous'));
        removed.forEach((old) => {
          const fade = fades.filter((item) => item.oldText === old.textContent).slice(-1)[0];
          if (fade && !fade.closed) { fade.samples.push(readOpacity(old, fade.started)); fade.closed = true; }
        });
      }))).observe(bar, { childList:true, subtree:true });
      new MutationObserver(() => {
        const text = el.textContent;
        if (text === last) return;
        last = text;
        const old = document.querySelector('.strip-lyric-previous');
        const dust = document.querySelector('.strip-lyric-dust');
        const flow = window.__playerDebug.lyricFlowState(), clock = flow.clock || [];
        const index = flow.index;
        const interval = index > 0 && clock[index] && clock[index-1] ? clock[index].t-clock[index-1].t : 0;
        const nextInterval = clock[index+1] && clock[index] ? clock[index+1].t-clock[index].t : 0;
        const timing = interval > 0 ? window.__playerDebug.stripLyricTiming(interval, nextInterval) : null;
        const fade = old ? fades.filter((item) => item.oldText === old.textContent).slice(-1)[0] : null;
        const stats = window.__stripCanvasStats(dust);
        const emission = window.__stripDustEmissionStats(dust, old);
        events.push({
          text, wallTime:Date.now()/1000, oldText:old ? old.textContent : '', oldClass:old ? old.className : '',
          oldOpacity:old ? parseFloat(getComputedStyle(old).opacity) : null,
          oldFilter:old ? getComputedStyle(old).filter : 'none',
          fadeElapsedMs:fade ? performance.now()-fade.started : 0,
          interval, nextInterval,
          oldRect:old ? (() => { const r=old.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height }; })() : null,
          currentTransform:getComputedStyle(el).transform, currentFade:animation(el),
          dustCanvas:!!dust && dust.tagName === 'CANVAS', dustStats:stats, dustEmission:emission,
          dustBudget:Math.round((window.__playerDebug.stripState().small ? 200 : 320) * 0.45),
          timing, fontSize:getComputedStyle(el).fontSize, index, time:document.querySelector('audio').currentTime,
          layout:document.getElementById('player').getAttribute('data-layout')
        });
      }).observe(el, { childList:true, characterData:true, subtree:true });
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
        /* 契约（1.2.2 起）：高亮字色 = --lyric-current，而 --lyric-current 是
         * 「强调色 × 58% + 墨/纸」的混合值 —— 为了在浅纱/深纱上都保住 4.5:1，
         * 字色不能再等于强调色原色。所以这里查两件事：
         *   ① 实际渲染色确实来自 --lyric-current（不是别处硬编码）；
         *   ② 它的色相仍由 --hl-accent 派生（混墨只压明度/饱和，不该改色相）。 */
        sameSource:JSON.stringify(actual) === JSON.stringify(rgb(cs.getPropertyValue('--lyric-current'))),
        accentHueDistance:gap(hsl(actual)[0], hsl(rgb(cs.getPropertyValue('--hl-accent')))[0]),
        controls, theme, controlsUseTheme:controls.length > 0 && controls.every((c) => JSON.stringify(c) === JSON.stringify(theme)), cases };
    });
    check('highlight-separates-from-star-group', palette.minHueDistance >= 25
      && palette.sameSource && palette.accentHueDistance <= 12, palette);
    check('highlight-colored-readable-and-deterministic-fallback', palette.cases.every((c) =>
      c.minHueDistance >= 25 && c.contrast >= 4.5 && c.saturation >= 0.4)
      && palette.cases.filter((c) => c.count === 0).every((c) => c.fallback), palette.cases);
    check('hearts-retain-theme-accent', palette.controlsUseTheme, palette);
    report.stripLyricPalette = palette;
    const measured = await measureLyricSurfaces(page, dir);
    report.stripLyricMeasured = { surfaces:measured.surfaces.map(scoreSoftShadow),
      regression:{before:scoreSoftShadow(measured.regression.before),after:scoreSoftShadow(measured.regression.after)} };
    for (const surface of report.stripLyricMeasured.surfaces) {
      // 竖卡深底遵循已确认的 fill>=3 取舍；亮底仍要求真实像素阴影提供 >=4.5 有效分离度。
      check('measured-contrast-' + surface.name, surface.pass && !!surface.shadow && surface.shadowFill >= 3,
        { policy:surface.name === 'vertical' ? '深底fill>=3用户已确认；亮点effective>=4.5，shadow/fill>=3'
          : '实际rendered像素effective>=4.5，soft-shadow/fill>=3',
          fill:surface.fill, shadow:surface.shadow, shadowFill:surface.shadowFill,
          minimumFill:surface.minimumFill, minimumEffective:surface.minimumEffective,
          samples:surface.samples.length, pass:surface.pass });
    }
    const r=report.stripLyricMeasured.regression;
    check('shadow-regression-old-fill-fails-rendered-separation-passes', !r.before.shadow
      && r.before.minimumEffective < 4.5 && !!r.after.shadow && r.after.minimumEffective >= 4.5
      && r.after.shadowFill >= 3 && JSON.stringify(r.before.fill) === JSON.stringify(r.after.fill),
      { before:r.before, after:r.after });
    const rules=measured.surfaces.map(surface => surface.strokeRule);
    check('soft-shadow-consistent-per-surface-and-glow-retained',
      rules.slice(0,3).every(rule => rule.separation === rules[0].separation)
      && rules.every(rule => !!rule.separation && rule.glow !== 'none'), rules);
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
        await installDustProbe(wrap);
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
          const r = old.getBoundingClientRect(), emission = window.__stripDustEmissionStats(dust, old);
          const ink=(el)=>{const s=getComputedStyle(el);return {color:s.color,textShadow:s.textShadow,fontSize:s.fontSize};};
          return { text:old.textContent, x:r.x, y:r.y, width:r.width, height:r.height,
            ink:ink(old),currentInk:ink(document.getElementById('stripLyric')),
            emission, canvasStats:window.__stripCanvasStats(dust) };
        });
        check('multiline-outgoing-and-canvas-emission-cover-both-lines' + suffix, !!outgoing
          && outgoing.text === long.text && Math.abs(outgoing.x - long.x) <= 1 && Math.abs(outgoing.y - long.y) <= 1
          && Math.abs(outgoing.width - long.width) <= 1 && Math.abs(outgoing.height - long.height) <= 1
          && outgoing.emission.glyphLines === 2 && outgoing.emission.lineHits.length === 2
          && outgoing.emission.lineHits.every((count) => count > 0)
          && outgoing.canvasStats.activePixels > 0, { long, outgoing });
        check('outgoing-inherits-identical-current-ink-' + profile.size,!!outgoing
          && JSON.stringify(outgoing.ink)===JSON.stringify(outgoing.currentInk)
          && outgoing.ink.textShadow !== 'none' && outgoing.ink.fontSize === long.font,outgoing);
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
  async function verifyBilingualStrip() {
    await fetch(`${BASE}${API}/__fixture/reset?mode=strip-bilingual&appSurfaceSession=fake-ticket`);
    const bilingual = await newPage();
    const mainText = '僕が歌うものは 既にあるものじゃーーーん';
    const subText = '可我所演唱的歌曲 不是已经有了吗——';
    try {
      await bilingual.setViewport({ width:720, height:128, deviceScaleFactor:1 });
      await bilingual.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil:'domcontentloaded' });
      await bilingual.waitForFunction(() => window.__playerDebug && document.querySelector('#listTabs .list-tab'));
      await clickTab(bilingual, 'imp:1');
      await bilingual.waitForFunction(() => document.querySelector('#queueList .q-hit'));
      await installDustProbe(bilingual);
      await bilingual.mouse.move(1, 127);
      await bilingual.evaluate(() => document.querySelector('#queueList .q-hit').click());
      await bilingual.waitForFunction(() => !document.querySelector('audio').paused
        && document.getElementById('player').getAttribute('data-layout') === 'strip', { timeout:10000 });
      await bilingual.waitForFunction((expected) => document.getElementById('stripLyric').textContent === expected,
        { timeout:6000 }, mainText + subText);
      const rendered = await bilingual.evaluate(() => {
        const el = document.getElementById('stripLyric'), main = el.querySelector('.strip-lyric-main'), sub = el.querySelector('.strip-lyric-sub');
        const box = (node) => { const r=node.getBoundingClientRect(); return { top:r.top,bottom:r.bottom,text:node.textContent }; };
        return { text:el.textContent, hasMain:!!main, hasSub:!!sub, main:main&&box(main), sub:sub&&box(sub),
          transform:getComputedStyle(el).transform };
      });
      check('bilingual-strip-renders-two-rows-without-parentheses', rendered.hasMain && rendered.hasSub
        && rendered.main.text === mainText && rendered.sub.text === subText
        && rendered.text.indexOf('（') < 0 && rendered.text.indexOf('）') < 0
        && rendered.main.bottom <= rendered.sub.top + 1 && rendered.transform === 'none', rendered);

      const seek = async (time) => {
        await bilingual.evaluate((target) => { window.__bilingualSeek=target; document.querySelector('audio').currentTime=target; }, time);
        await bilingual.waitForFunction(() => {
          const audio=document.querySelector('audio');
          return !audio.seeking && Math.abs(audio.currentTime-window.__bilingualSeek)<0.8;
        }, { timeout:4000 });
      };
      await seek(4.2);
      await bilingual.waitForFunction((expected) => {
        const old=document.querySelector('.strip-lyric-previous'), dust=document.querySelector('.strip-lyric-dust');
        if (!old || !dust || old.textContent !== expected) return false;
        const emission=window.__stripDustEmissionStats(dust, old);
        return emission.rowHits['strip-lyric-main'] > 0 && emission.rowHits['strip-lyric-sub'] > 0;
      }, { timeout:4000 }, mainText + subText);
      const dustEvidence = await bilingual.evaluate(() => {
        const canvas=document.querySelector('.strip-lyric-dust'), old=document.querySelector('.strip-lyric-previous');
        const main=old.querySelector('.strip-lyric-main').getBoundingClientRect();
        const sub=old.querySelector('.strip-lyric-sub').getBoundingClientRect();
        const rect=canvas.getBoundingClientRect(), dpr=canvas.width/Math.max(1,rect.width);
        const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        let mainPixels=0, subPixels=0;
        for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
          if(data[(y*canvas.width+x)*4+3]<=8) continue;
          const cssY=rect.top+y/dpr;
          if(cssY>=main.top-2&&cssY<=main.bottom+2) mainPixels++;
          if(cssY>=sub.top-2&&cssY<=sub.bottom+2) subPixels++;
        }
        return { oldText:old.textContent, rows:window.__stripDustEmissionStats(canvas,old),
          bandPixels:{ main:mainPixels, sub:subPixels }, canvas:window.__stripCanvasStats(canvas) };
      });
      check('bilingual-dust-canvas-has-pixels-in-both-row-bands', dustEvidence.oldText === mainText+subText
        && dustEvidence.rows.rowHits['strip-lyric-main'] > 0 && dustEvidence.rows.rowHits['strip-lyric-sub'] > 0
        && dustEvidence.bandPixels.main > 0 && dustEvidence.bandPixels.sub > 0
        && dustEvidence.canvas.activePixels > 0, dustEvidence);
    } finally {
      await bilingual.close().catch(() => {});
      await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`).catch(() => {});
    }
  }

  try {
    await fetch(`${BASE}${API}/__fixture/reset?mode=strip-rhythm&appSurfaceSession=fake-ticket`);
    await page.setViewport({ width: 720, height: 128, deviceScaleFactor: 1 });
    await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__playerDebug && document.querySelector('#listTabs .list-tab'));
    await clickTab(page, 'imp:1');
    await page.waitForFunction(() => document.querySelector('#queueList .q-hit'));
    await installDustProbe(page);
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
    await page.waitForFunction(() => {
      const dust = document.querySelector('.strip-lyric-dust');
      return !!dust && window.__stripCanvasStats(dust).activePixels > 0;
    }, { timeout: 1000 });
    const normalLive = await dustLive();
    check('canvas-dust-renders-visible-colored-cores-within-budget', normalLive.canvas
      && normalLive.stats.activePixels > 0 && normalLive.stats.brightPixels > 0
      && normalLive.stats.brightComponents > 0 && normalLive.stats.brightComponents <= normalLive.budget
      && normalLive.stats.colorPixels > 0 && normalLive.count <= normalLive.budget, normalLive);
    check('canvas-dust-is-contained-and-emits-from-real-glyphs', normalLive.contained
      && normalLive.stats.bounds && normalLive.stats.xBands.some((n) => n > 0)
      && normalLive.stats.yBands.some((n) => n > 0) && normalLive.emission.calls > 0
      && normalLive.emission.glyphHits > 0 && normalLive.emission.glyphLines === 1
      && normalLive.emission.lineHits[0] > 0, normalLive);
    check('canvas-particle-budget-follows-strip-strength', normalLive.budget === (normalLive.small ? 90 : 144)
      && normalLive.dpr <= 2 && normalLive.stats.activePixels <= normalLive.stats.width * normalLive.stats.height,
      { budget:normalLive.budget, small:normalLive.small, dpr:normalLive.dpr, stats:normalLive.stats });
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

    const normalFade = normal && await fadeFor(normal.oldText);
    const fastFade = fast && await fadeFor(fast.oldText);
    const slowFade = slow && await fadeFor(slow.oldText);
    const zeroAt = (fade) => fade && fade.samples.find((sample) => sample.opacity <= 0.01);
    const fadeLifetime = (fade) => fade && fade.samples.length ? fade.samples[fade.samples.length-1].elapsedMs : 0;
    const lifetimeMatches = (fade, timing) => !!fade && !!timing
      && fadeLifetime(fade) >= timing.particles + 20 && fadeLifetime(fade) <= timing.particles + 170;
    const monotonic = (fade) => !!fade && fade.samples.length > 2
      && fade.samples.every((sample, i) => i === 0 || sample.opacity <= fade.samples[i-1].opacity + 0.025);
    const normalZero = zeroAt(normalFade), fastZero = zeroAt(fastFade), slowZero = zeroAt(slowFade);
    const normalLifetime = fadeLifetime(normalFade), slowLifetime = fadeLifetime(slowFade);
    check('natural-transition-fades-old-overlay-with-opacity-and-blur', !!normal && normal.oldText === '起始歌词'
      && !!normal.timing && normal.dustCanvas && normalLive.stats.activePixels > 0 && normalFade && normalFade.closed
      && normalFade.samples[0].opacity > 0.9 && monotonic(normalFade) && !!normalZero
      && normalFade.samples.some((sample) => /^blur\(/.test(sample.filter))
      && normalZero.elapsedMs >= normal.timing.dissolve - 50
      && normalZero.elapsedMs <= normal.timing.dissolve + 100
      && lifetimeMatches(normalFade, normal.timing), { normal, normalFade, normalZero, normalLifetime });
    check('incoming-is-immediate-in-place-fade', !!normal && !!normal.timing && normal.text === '正常节奏一'
      && normal.currentFade && normal.currentFade[0].duration > 0
      && normal.currentFade[0].duration <= normal.timing.dissolve && normal.currentTransform === 'none', normal);
    // 首句允许启动/seek 防护下走切句兜底；后续句应在切换文本前已开始旧句淡化。
    check('cleanup-preserves-next-lines-pre-scheduled-lead', [fast, slow].every((event) =>
      event && event.oldText && event.fadeElapsedMs > 0),
      [fast, slow].map((event) => ({ text:event && event.text, elapsed:event && event.fadeElapsedMs })));
    check('fast-transition-is-shorter-than-normal', !!fast && !!normal && !!fast.timing && !!normal.timing
      && fast.timing.dissolve < normal.timing.dissolve && !!fastZero && !!normalZero
      && fastZero.elapsedMs < normalZero.elapsedMs, { fast, normal, fastFade, normalFade, fastZero, normalZero });
    // particleMs 按下一组歌词间隔封顶；星尘的实际粒子数另以 canvas 可见核心和强度预算验证。
    const slowWindowMs = slow && duplicate ? Math.max(0, (duplicate.time - slow.time) * 1000) : 0;
    check('slow-transition-has-longer-bounded-canvas-tail', !!slow && !!normal && !!slow.timing && !!normal.timing
      && slowWindowMs > 0 && slow.timing.dissolve > normal.timing.dissolve
      && slow.timing.particles > normal.timing.particles
      && slow.timing.particles <= slowWindowMs
      && !!normalZero && !!slowZero && slowZero.elapsedMs > normalZero.elapsedMs
      && lifetimeMatches(slowFade, slow.timing) && slowLifetime > normalLifetime,
      { slow, normal, slowWindowMs, slowFade, slowZero, normalLifetime, slowLifetime });
    check('same-timestamp-lines-use-one-group', !!duplicate && duplicate.text === '同刻翻译'
      && !(await page.evaluate(() => (window.__stripLyricEvents || []).some((event) => event.text === '舒缓歌词二'))), duplicate);
    check('same-track-font-is-uniform-and-bounded', await page.evaluate(() => {
      const events = (window.__stripLyricEvents || []).filter((event) => event.oldText);
      const upper = Math.min(22, Math.floor((document.querySelector('.strip-context').clientHeight - 8) / 2.4));
      return new Set(events.map((event) => event.text.length)).size > 1
        && new Set(events.map((event) => event.fontSize)).size === 1
        && events.every((event) => Number.isInteger(parseFloat(event.fontSize))
          && parseFloat(event.fontSize) >= 16 && parseFloat(event.fontSize) <= upper);
    }), { normal:normal.fontSize, fast:fast.fontSize, slow:slow.fontSize });
    check('no-queued-transitions-or-duplicate-layers', await page.evaluate(() => {
      const dust = document.querySelector('.strip-lyric-dust');
      const budget = Math.round((window.__playerDebug.stripState().small ? 200 : 320) * 0.45);
      const stats = window.__stripCanvasStats(dust);
      return document.querySelectorAll('.strip-lyric-previous').length <= 1
        && document.querySelectorAll('.strip-lyric-dust').length <= 1
        && stats.brightComponents <= budget;
    }), await state());

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
    check('seeked-path-does-not-create-dust-canvas', !!seekEvent && !seekEvent.dustCanvas && seekEvent.oldText === '', seekEvent);

    // 暂停落在正在执行的自然转场中，清理副本/粒子并立刻恢复新句可读性。
    await seekByMediaTime(16.05);
    await page.evaluate(() => window.__playerDebug.requestPlay('user'));
    await waitText('暂停中断句');
    await page.waitForFunction(() => document.querySelector('.strip-lyric-previous'));
    await page.evaluate(() => window.__playerDebug.pauseAll());
    await sleep(40);
    const paused = await state();
    check('pause-cancels-and-restores-current-text', paused.paused && paused.previous === 0 && paused.dust === 0
      && paused.dustPixels === 0 && paused.currentOpacity === '1', paused);

    // 页面隐藏期间中止；恢复后不补播同一转场。
    await seekByMediaTime(18.35);
    await page.evaluate(() => window.__playerDebug.requestPlay('user'));
    await waitText('隐藏中断句');
    await page.waitForFunction(() => document.querySelector('.strip-lyric-previous'));
    const other = await newPage();
    await other.bringToFront();
    await page.waitForFunction(() => document.hidden, { timeout: 3000 });
    const hidden = await state();
    check('hidden-page-cleans-animation', hidden.previous === 0 && hidden.dust === 0 && hidden.dustPixels === 0, hidden);
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
      && hoverCancelled.dust === 0 && hoverCancelled.dustPixels === 0, hoverCancelled);
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
    await page.waitForFunction(() => {
      const dust=document.querySelector('.strip-lyric-dust');
      return !!dust && window.__stripCanvasStats(dust).activePixels > 0
        && window.__stripCanvasStats(dust).brightPixels > 0;
    }, { timeout:900 });
    const narrow = await page.evaluate(() => {
      const bar = document.getElementById('stripBar').getBoundingClientRect();
      const dust = document.querySelector('.strip-lyric-dust'), stats = window.__stripCanvasStats(dust);
      const rect = dust ? dust.getBoundingClientRect() : null;
      const budget = Math.round((window.__playerDebug.stripState().small ? 200 : 320) * 0.45);
      const emission = window.__stripDustEmissionStats(dust, document.querySelector('.strip-lyric-previous'));
      return { text:document.getElementById('stripLyric').textContent, budget, stats, emission,
        inside:!!rect && rect.left >= bar.left-1 && rect.right <= bar.right+1
          && rect.top >= bar.top-1 && rect.bottom <= bar.bottom+1
          && (!stats.bounds || (stats.bounds.left >= 0 && stats.bounds.top >= 0
            && stats.bounds.right < dust.width && stats.bounds.bottom < dust.height)),
        previous:document.querySelectorAll('.strip-lyric-previous').length };
    });
    check('narrow-dust-is-limited-and-contained', narrow.budget === 90 && narrow.budget < normalLive.budget
      && narrow.stats.activePixels > 0 && narrow.stats.brightComponents > 0
      && narrow.stats.brightComponents <= narrow.budget && narrow.inside && narrow.previous <= 1, narrow);

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
    check('track-switch-clears-previous-lyric-effects', changedTrack.previous === 0 && changedTrack.dust === 0
      && changedTrack.dustPixels === 0, changedTrack);

    await verifyPalette();
    await verifyWrapping();
    await verifyBilingualStrip();
    fs.writeFileSync(path.join(dir, 'transitions.json'), JSON.stringify({ normal, normalLive, fast, slow, duplicate,
      fades:await page.evaluate(() => window.__stripLyricFadeSamples || []),
      events:await page.evaluate(() => window.__stripLyricEvents || []), recording:recordingReport }, null, 2));
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

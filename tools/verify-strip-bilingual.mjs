/* ============================================================
   tmp-verify-strip-bilingual.mjs — 横条「日文（中文）」拆两行的专项验证
   直接复刻 tools/verify-ui.mjs 的假后端与服务装配（fixtureMode 加一个
   'strip-bilingual'），用真浏览器量真实排版，不改动生产断言文件。
   验完即删（临时夹具）。
   ============================================================ */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mergeLibrarySnapshot } from '../lib/library.js';
import { createAudioOwner } from '../lib/audio-owner.js';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE || '/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = path.join(repo, 'ui');
const outDir = process.env.OUT_DIR || '/tmp/hap-bilingual';
fs.mkdirSync(outDir, { recursive: true });
const API = '/api/apps/hanako-simple-player/routes';
const COVER_FILE = path.join(repo, 'docs/player-ui/assets/demo-cover.png');
const WAV_URL = `${API}/_fixture/audio.wav`;
const COVER = `${API}/_fixture/cover.png`;
const goUrl = (id) => `${API}/widget/api/music/go/${id}?server=netease`;

/* 30 秒静音 WAV（带 Range，否则不可 seek）*/
const WAV_SECONDS = 30;
const pcm = Buffer.alloc(44100 * 2 * WAV_SECONDS);
const wav = Buffer.alloc(44 + pcm.length);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(44100 * 2, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
pcm.copy(wav, 44);
function serveAudio(req, res) {
  const total = wav.length;
  res.setHeader('content-type', 'audio/wav');
  res.setHeader('accept-ranges', 'bytes');
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : total - 1;
      res.statusCode = 206;
      res.setHeader('content-range', `bytes ${start}-${end}/${total}`);
      res.setHeader('content-length', String(end - start + 1));
      return res.end(wav.subarray(start, end + 1));
    }
  }
  res.setHeader('content-length', String(total));
  return res.end(wav);
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}
function text(res, code, body, type) {
  res.statusCode = code;
  res.setHeader('content-type', type || 'text/plain; charset=utf-8');
  res.end(body);
}

let fixtureMode = 'strip-bilingual';
let persistedPlaylist = null;
let playbackState = null;
let ownerFixtureRecord = null;
const owner = createAudioOwner({ storage: { get: async () => null, set: async (key, record) => {
  ownerFixtureRecord = JSON.parse(JSON.stringify(record));
} }, writePlayback: async (snapshot) => { playbackState = JSON.parse(JSON.stringify(snapshot)); } });

const TRACKS = [{
  id: 'netease:900000', name: '双语日文曲', url: goUrl(900000), mode: '在线', dur: 0,
  group: '在线音乐', list: 'imp:1', pic: COVER
}];

/* 一句拆得开 + 一句纯中文不拆 + 一句带（Live）不拆 + 一句极端长（测省略） */
const BILINGUAL = [
  '[00:00.00]短句',
  '[00:02.00]僕が歌うものは 既にあるものじゃーーーん（可我所演唱的歌曲 不是已经有了吗——）',
  '[00:05.00]这是一句纯中文歌词不应该被拆分（哪怕带括号）',
  '[00:08.00]風が吹く（Live）',
  '[00:11.00]風が吹く（风在吹）',
  '[00:14.00]' + '超过两行的极端文本必须在第二行省略而不滚动'.repeat(5),
  '[00:18.00]收尾'
].join('\n');

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;
  if (p === '/favicon.ico') { res.statusCode = 204; return res.end(); }
  if (p.startsWith(API + '/')) {
    const hasHeader = (req.headers['x-hana-app-surface-session'] || '').trim();
    const hasQuery = (u.searchParams.get('appSurfaceSession') || '').trim();
    if (!hasHeader && !hasQuery) return json(res, 403, { error: 'forbidden' });
  }
  if (p === API + '/api/lists/allocate') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const input = JSON.parse(body), all = [];
      const ids = [...all.map((x) => x.id), ...(persistedPlaylist || TRACKS).map((x) => x.list)];
      const max = Math.max(0, ...ids.map((x) => Number(/^imp:(\d+)$/.exec(x || '')?.[1]) || 0));
      json(res, 200, { ok: true, id: 'imp:' + (max + 1), name: input.name || '' });
    });
    return;
  }
  if (p === API + '/api/lists') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { json(res, 200, { ok: true, count: 0 }); });
      return;
    }
    return json(res, 200, { ok: true, lists: [{ id: 'imp:1', name: '导入歌单' }] });
  }
  if (p === API + '/widget/api/playlist') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const j = JSON.parse(body);
          persistedPlaylist = Array.isArray(j.tracks) ? (j.baseTracks
            ? mergeLibrarySnapshot(persistedPlaylist || TRACKS, j.baseTracks, j.tracks,
              (t) => String(t.list || '') + '|' + String(t.id || t.url || t.name || ''))
            : j.tracks) : null;
        } catch { persistedPlaylist = null; }
        json(res, 200, { ok: true, count: persistedPlaylist ? persistedPlaylist.length : 0 });
      });
      return;
    }
    const tracks = persistedPlaylist || TRACKS;
    return json(res, 200, { ok: true, tracks, count: tracks.length });
  }
  if (p === API + '/__fixture/reset') {
    fixtureMode = u.searchParams.get('mode') || 'strip-bilingual';
    persistedPlaylist = null;
    return json(res, 200, { ok: true, mode: fixtureMode });
  }
  if (p === API + '/api/playback-state') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try { json(res, 200, await owner.savePlayback(JSON.parse(body), {
          ownerId: req.headers['x-player-audio-owner'] || u.searchParams.get('audioOwnerId') || '',
          generation: Number(req.headers['x-player-audio-generation'] || u.searchParams.get('audioGeneration') || 0)
        })); } catch (err) { json(res, 500, { ok: false, error: err.message }); }
      });
      return;
    }
    return json(res, 200, { ok: true, state: playbackState });
  }
  if (p === API + '/api/audio-owner') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try { json(res, 200, await owner.command(JSON.parse(body))); }
        catch (err) { json(res, err.code || 500, { ok: false, error: err.message }); }
      });
    } else owner.read().then((record) => json(res, 200, { ok: true, record }));
    return;
  }
  if (p === API + '/widget/api/lrc/load') return json(res, 404, { ok: false, error: 'not found' });
  if (p === API + '/widget/api/lrc/save') return json(res, 200, { ok: true, filename: 'x.lrc' });
  if (p === API + '/widget/api/music/ttml') return json(res, 404, { ok: false });
  if (p === API + '/widget/api/music/cover') return json(res, 200, { ok: true, url: '', cover: '', pic: '' });
  if (p === API + '/api/now-playing') return json(res, 200, { ok: true, playing: null });
  if (p === API + '/widget/api/music/lrc') return text(res, 200, BILINGUAL, 'text/plain; charset=utf-8');
  if (p.startsWith(API + '/widget/api/music/go/')) return serveAudio(req, res);
  if (p.startsWith(API + '/widget/media/')) return serveAudio(req, res);
  if (p === API + '/_fixture/cover.png') {
    res.setHeader('content-type', 'image/png');
    return fs.createReadStream(COVER_FILE).pipe(res);
  }
  if (p.startsWith('/api/apps/hanako-simple-player/ui/')) {
    const file = path.join(uiDir, p.replace('/api/apps/hanako-simple-player/ui/', ''));
    if (!file.startsWith(uiDir) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8'
      : file.endsWith('.css') ? 'text/css; charset=utf-8'
        : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    res.setHeader('content-type', type);
    return fs.createReadStream(file).pipe(res);
  }
  console.log('404 ->', p);
  res.statusCode = 404; res.end('not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const UI_BASE = `${BASE}/api/apps/hanako-simple-player/ui`;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1']
});

const report = { assertions: [], runtimeErrors: [], expectedProbes: [] };
/* 预期噪声（与 tools/verify-ui.mjs 同口径）：降级链的探测性 404。 */
const EXPECTED_PROBE = /\/(widget\/api\/lrc\/load|widget\/api\/music\/ttml)(\?|$)/;
const check = (name, ok, detail) => {
  report.assertions.push({ name, ok: !!ok, detail: JSON.stringify(detail === undefined ? null : detail) });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail)));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await browser.newPage();
page.on('pageerror', (e) => { report.runtimeErrors.push('pageerror: ' + String(e)); console.log('PAGEERROR', String(e)); });
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const txt = m.text();
  if (txt.indexOf('Failed to load resource') >= 0) return;   // 由 response 监听器带 URL 记录
  report.runtimeErrors.push('console: ' + txt);
});
page.on('response', (r) => {
  if (r.status() < 400) return;
  const u = r.url();
  (EXPECTED_PROBE.test(u) ? report.expectedProbes : report.runtimeErrors).push(`http ${r.status()} ${u}`);
});

try {
  await page.setViewport({ width: 1040, height: 128, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__playerDebug, { timeout: 15000 });
  await page.waitForFunction(() => !!document.querySelector('#listTabs .list-tab[data-list="imp:1"]'), { timeout: 15000 }).catch(async (e) => {
    console.log('BOOT', JSON.stringify(await page.evaluate(() => ({ tabs: [...document.querySelectorAll('#listTabs .list-tab')].map((x) => x.getAttribute('data-list')), body: document.body.innerText.slice(0, 200) }))));
    throw e;
  });
  await page.evaluate(() => document.querySelector('#listTabs .list-tab[data-list="imp:1"]').click());
  await page.waitForFunction(() => {
    const a = document.querySelector('#listTabs .list-tab.is-active');
    return !!a && a.getAttribute('data-list') === 'imp:1';
  }, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#queueList .q-hit'), { timeout: 15000 });
  await page.mouse.move(1, 127);
  await page.evaluate(() => document.querySelector('#queueList .q-hit').click());
  await page.waitForFunction(() => {
    const a = document.querySelector('audio');
    return !a.paused && a.duration > 15 && document.getElementById('player').getAttribute('data-layout') === 'strip';
  }, { timeout: 15000 });

  const seek = async (t) => {
    await page.evaluate((target) => { window.__t = target; document.querySelector('audio').currentTime = target; }, t);
    await page.waitForFunction(() => {
      const a = document.querySelector('audio');
      return !a.seeking && Math.abs(a.currentTime - window.__t) < 0.9;
    }, { timeout: 5000 });
  };
  const snap = () => page.evaluate(() => {
    const el = document.getElementById('stripLyric');
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const main = el.querySelector('.strip-lyric-main'), sub = el.querySelector('.strip-lyric-sub');
    const ctx = document.querySelector('.strip-context').getBoundingClientRect();
    const idr = document.getElementById('stripIdentity').getBoundingClientRect();
    const box = (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom, top: b.top, text: n.textContent }; };
    return {
      text: el.textContent, raw: window.__playerDebug ? null : null,
      nodes: el.childNodes.length, childTypes: [...el.childNodes].map((n) => n.nodeType),
      hasMain: !!main, hasSub: !!sub,
      main: main ? box(main) : null, sub: sub ? box(sub) : null,
      fontSize: cs.fontSize, lineHeight: parseFloat(cs.lineHeight), clamp: cs.webkitLineClamp,
      overflow: cs.overflow, scrollHeight: el.scrollHeight, scrollWidth: el.scrollWidth,
      height: r.height, width: r.width, x: r.x, y: r.y,
      contextWidth: ctx.width, contextHeight: ctx.height,
      centered: Math.abs((r.top + r.bottom - ctx.top - ctx.bottom) / 2) <= 1,
      contained: r.left >= idr.right + 11 && r.right <= ctx.right + 1 && r.top >= ctx.top && r.bottom <= ctx.bottom,
      transform: cs.transform,
      model: window.__playerDebug.stripLyricFontState(),
      lines: [...document.querySelectorAll('.lyric-line .lyric-text')].map((n) => n.textContent)
    };
  });
  const waitText = (t) => page.waitForFunction((v) => document.getElementById('stripLyric').textContent.indexOf(v) >= 0, { timeout: 8000 }, t);

  /* 1) 纯函数：拆分规则 */
  const pure = await page.evaluate(() => {
    const f = window.__playerDebug.splitLyricTranslation;
    return {
      exported: typeof f === 'function',
      ja: f('僕が歌うものは 既にあるものじゃーーーん（可我所演唱的歌曲 不是已经有了吗——）'),
      cn: f('这是一句纯中文歌词不应该被拆分（哪怕带括号）'),
      live: f('風が吹く（Live）'),
      none: f('短句'),
      inst: f('風が吹く（Instrumental）'),
      mid: f('風が吹く（风在吹）啊')
    };
  });
  check('bilingual-pure-function-exported-and-correct', pure.exported
    && pure.ja && pure.ja.main === '僕が歌うものは 既にあるものじゃーーーん'
    && pure.ja.sub === '可我所演唱的歌曲 不是已经有了吗——'
    && pure.cn === null && pure.live === null && pure.none === null && pure.inst === null && pure.mid === null, pure);

  /* 2) 竖卡歌词不受影响（数据层未动） */
  await seek(0.5); await waitText('短句');
  const short = await snap();
  check('bilingual-short-line-stays-single-node', short.nodes === 1 && short.childTypes[0] === 3
    && !short.hasMain && !short.hasSub, short);

  /* 3) 日文（中文）→ 两行，括号已去，顺序日文在上 */
  await seek(2.6); await waitText('僕が歌うものは');
  const ja = await snap();
  check('bilingual-ja-line-renders-two-rows', ja.hasMain && ja.hasSub
    && ja.main.text === '僕が歌うものは 既にあるものじゃーーーん'
    && ja.sub.text === '可我所演唱的歌曲 不是已经有了吗——'
    && ja.text.indexOf('（') < 0 && ja.text.indexOf('）') < 0, ja);
  check('bilingual-ja-main-above-sub', !!ja.main && !!ja.sub && ja.main.bottom <= ja.sub.top + 1, { main: ja.main, sub: ja.sub });
  check('bilingual-ja-stays-centered-contained-and-two-line', ja.centered && ja.contained
    && ja.transform === 'none' && ja.height <= ja.lineHeight * 2 + 1
    && ja.scrollHeight <= ja.height + 1 && ja.width <= ja.contextWidth + 1
    && ja.clamp === '2' && ja.overflow === 'clip' && ja.scrollWidth <= ja.contextWidth + 1, ja);
  await page.screenshot({ path: path.join(outDir, 'bilingual-ja.png') });

  /* 4) 纯中文不拆 */
  await seek(5.6); await waitText('这是一句纯中文歌词');
  const cn = await snap();
  check('bilingual-pure-chinese-not-split', !cn.hasMain && !cn.hasSub && cn.nodes === 1
    && cn.text.indexOf('（') >= 0, cn);

  /* 5) （Live）不拆 */
  await seek(8.6); await waitText('風が吹く');
  const live = await snap();
  check('bilingual-live-annotation-not-split', !live.hasMain && !live.hasSub && live.nodes === 1
    && live.text.indexOf('（Live）') >= 0, live);

  /* 6) 全曲字号：拆与不拆同一档，且不因拆分变大 */
  const fonts = [short.fontSize, ja.fontSize, cn.fontSize, live.fontSize];
  check('bilingual-font-uniform-across-split-and-plain', new Set(fonts).size === 1
    && parseFloat(ja.fontSize) >= 16 && parseFloat(ja.fontSize) <= ja.model.upper, { fonts, model: ja.model });

  /* 7) 竖卡渲染（数据层）未动：整行原文照旧 */
  const lyricLines = await page.evaluate(() => window.__playerDebug.lyricFlowState().clock.length);
  const cardLine = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.lyric-line .lyric-text')];
    return rows.map((n) => n.textContent).find((t) => t.indexOf('僕が歌う') >= 0) || null;
  });
  check('bilingual-vertical-card-keeps-original-text', !!cardLine
    && cardLine.indexOf('（可我所演唱的歌曲 不是已经有了吗——）') >= 0, { cardLine, lyricLines });

  /* 8) 转场覆盖层与星尘：旧句也拆两行，粒子从两行真实字迹发出 */
  await page.evaluate(() => {
    window.__dust = [];
    const bar = document.getElementById('stripBar');
    const obs = new MutationObserver(() => {
      const old = document.querySelector('.strip-lyric-previous'), dust = document.querySelector('.strip-lyric-dust');
      if (!old || !dust) return;
      const m = old.querySelector('.strip-lyric-main'), s = old.querySelector('.strip-lyric-sub');
      const range = document.createRange(), centers = [];
      [m, s].forEach((row) => {
        if (!row) return;
        const node = row.firstChild;
        if (!node) return;
        for (let i = 0; i < node.nodeValue.length; i++) {
          range.setStart(node, i); range.setEnd(node, i + 1);
          const b = range.getBoundingClientRect();
          centers.push([(b.left + b.right) / 2, (b.top + b.bottom) / 2]);
        }
      });
      const rowsOf = (row) => {
        if (!row) return null;
        const b = row.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, text: row.textContent };
      };
      window.__dust.push({
        oldText: old.textContent, hasMain: !!m, hasSub: !!s,
        mainRow: rowsOf(m), subRow: rowsOf(s), centers: centers,
        dustCanvas: !!dust, dustTag: dust.tagName
      });
    });
    obs.observe(document.getElementById('stripLyric').parentNode, { childList: true, subtree: true });
  });
  /* 落在可拆的那句里（00:02.00 → 下一句 00:05.00），让**旧句**就是双行句。 */
  await seek(4.55);
  await page.waitForFunction(() => window.__dust.length > 0, { timeout: 8000 });
  await sleep(160);
  const dust = await page.evaluate(() => {
    /* 取「旧句真的是可拆的那句」的那一次转场；切句竞态可能先记到别的句。 */
    const hit = window.__dust.filter((d) => d.hasMain && d.hasSub).slice(-1)[0];
    const d = hit || window.__dust[window.__dust.length - 1];
    if (!d) return null;
    /* 量粒子的实际出生点：重跑一次取样函数（同款 Range 口径） */
    const old = document.querySelector('.strip-lyric-previous');
    return {
      ...d,
      live: !!old,
      /* 星尘画布按两行各自的 y 带统计亮像素：两行都得有粒子出生。 */
      bandPixels: (function () {
        const cv = document.querySelector('.strip-lyric-dust');
        const oldEl = document.querySelector('.strip-lyric-previous');
        if (!cv || !oldEl) return null;
        const m = oldEl.querySelector('.strip-lyric-main'), s = oldEl.querySelector('.strip-lyric-sub');
        if (!m || !s) return null;
        const barCv = cv.getBoundingClientRect();
        const rm = m.getBoundingClientRect(), rs = s.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const ctx = cv.getContext('2d');
        const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let top = 0, bottom = 0;
        for (let py = 0; py < cv.height; py++) {
          const cssY = barCv.top + py / dpr;
          for (let px = 0; px < cv.width; px++) {
            const a = data[(py * cv.width + px) * 4 + 3];
            if (a <= 8) continue;
            if (cssY >= rm.top - 2 && cssY <= rm.bottom + 2) top++;
            else if (cssY >= rs.top - 2 && cssY <= rs.bottom + 2) bottom++;
          }
        }
        return { top: top, bottom: bottom };
      })(),
      centerRows: new Set(d.centers.map((c) => Math.round(c[1]))).size,
      mainText: d.mainRow && d.mainRow.text, subText: d.subRow && d.subRow.text,
      subBelowMain: !!(d.mainRow && d.subRow) && d.subRow.top >= d.mainRow.bottom - 1
    };
  });
  check('bilingual-outgoing-overlay-keeps-two-rows', !!dust && dust.hasMain && dust.hasSub
    && dust.mainText === '僕が歌うものは 既にあるものじゃーーーん'
    && dust.subText === '可我所演唱的歌曲 不是已经有了吗——'
    && dust.subBelowMain && dust.dustCanvas, dust);
  check('bilingual-glyph-sampling-covers-both-rows', !!dust && dust.centerRows >= 2, { centerRows: dust.centerRows });
  check('bilingual-dust-emits-from-both-rows', !!dust && !!dust.bandPixels
    && dust.bandPixels.top > 0 && dust.bandPixels.bottom > 0, dust && dust.bandPixels);
  await page.screenshot({ path: path.join(outDir, 'bilingual-dust.png') });

  /* 9) 极端长句仍两行省略、字号不降 */
  await seek(14.6); await waitText('超过两行的极端文本');
  const extreme = await snap();
  check('bilingual-extreme-line-still-clamps-at-two', extreme.clamp === '2'
    && extreme.height <= extreme.lineHeight * 2 + 1 && extreme.scrollHeight > extreme.height
    && extreme.centered && extreme.contained && extreme.fontSize === short.fontSize, extreme);

  /* 10) 切歌 / 反复 seek 后不残留旧结构 */
  await seek(0.5); await waitText('短句');
  const back = await snap();
  check('bilingual-returning-to-plain-line-drops-row-nodes', back.nodes === 1
    && !back.hasMain && !back.hasSub && back.text === '短句', back);

  /* 字号选档必须真实反映「拆分后的两行形态」：
   * 极端长句 + 双行句都在曲里，若探针按拼成一整行去量，会选中过小的档（字号被迫变小）。
   * 这里用「把最难的句子拆成真实形态」重跑探测函数对照。 */
  const fontProbe = await page.evaluate(() => {
    const model = window.__playerDebug.stripLyricFontState();
    const ctxEl = document.querySelector('.strip-context');
    const width = Math.floor(ctxEl.getBoundingClientRect().width);
    const measure = document.createElement('span');
    measure.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;width:' + width + 'px';
    const probe = document.createElement('span');
    probe.className = 'strip-lyric';
    probe.style.webkitLineClamp = 'unset'; probe.style.overflow = 'visible';
    measure.appendChild(probe); ctxEl.appendChild(measure);
    const h = (size, build) => { measure.style.setProperty('--strip-lyric-font', size + 'px'); build(probe); return probe.getBoundingClientRect().height; };
    const long = '这是一句很长的中文歌词，让它自然换行之后仍然能够看清每一个字都不会被波浪挤到旁边的句子上';
    const asWhole = h(model.size, (el) => { el.textContent = long; });
    const asSplitLines = h(model.size, (el) => {
      el.textContent = '';
      const a = document.createElement('span'); a.className = 'strip-lyric-main'; a.textContent = long;
      const b = document.createElement('span'); b.className = 'strip-lyric-sub'; b.textContent = '风在吹';
      el.appendChild(a); el.appendChild(b);
    });
    measure.remove();
    return { model, width, asWhole, asSplitLines, limit: model.size * 2.4 + 0.5 };
  });
  check('bilingual-font-probe-measures-split-shape', fontProbe.asSplitLines > fontProbe.asWhole
    && fontProbe.asSplitLines > fontProbe.limit && fontProbe.asWhole <= fontProbe.limit, fontProbe);

  check('bilingual-no-runtime-errors', report.runtimeErrors.length === 0, report.runtimeErrors);
} catch (e) {
  check('bilingual-harness-completed', false, String(e && e.stack || e));
} finally {
  fs.writeFileSync(path.join(outDir, 'bilingual.json'), JSON.stringify(report, null, 2));
  const ok = report.assertions.filter((a) => a.ok).length;
  console.log('\n' + ok + '/' + report.assertions.length + ' passed; runtimeErrors=' + report.runtimeErrors.length);
  await browser.close(); server.closeAllConnections(); server.close();
  process.exit(report.assertions.some((a) => !a.ok) ? 1 : 0);
}

/* Local document-handoff timing probe. Reuses verify-ui's isolated fixture and
 * real owner arbiter; never talks to production. Clock/event timings are a proxy
 * for audio interruption, not a measurement of the physical speaker output. */
export async function probeAudioHandoff({ newPage, BASE, API, UI_BASE, sleep, clickTab }) {
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage({ teardown: true });
  const events = [], rounds = [];
  page.on('console', message => {
    const text = message.text();
    if (text.startsWith('HAP_HANDOFF ')) events.push(JSON.parse(text.slice(12)));
  });
  await page.evaluateOnNewDocument(() => {
    const doc = String(performance.timeOrigin);
    const mark = (type, detail = {}) => console.debug('HAP_HANDOFF ' + JSON.stringify({
      doc, type, t: performance.timeOrigin + performance.now(), ...detail
    }));
    window.__handoffProbe = { doc, advancing: false, longTasks: [] };
    mark('document-start');
    try { new PerformanceObserver(list => {
      list.getEntries().forEach(e => window.__handoffProbe.longTasks.push({ start: e.startTime, duration: e.duration }));
    }).observe({ type: 'longtask', buffered: true }); } catch {}
    const fetchOriginal = window.fetch;
    window.fetch = function (input, options) {
      const pathname = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
      const label = pathname.split('/routes/')[1];
      let action = '';
      if (label === 'api/audio-owner' && options && options.body) {
        try { action = JSON.parse(options.body).action || ''; } catch {}
      }
      if (label) mark('request', { label, action });
      return fetchOriginal.apply(this, arguments).then(response => {
        if (label) mark('response', { label, action, status: response.status });
        return response;
      });
    };
    for (const method of ['play', 'pause', 'load']) {
      const original = HTMLMediaElement.prototype[method];
      HTMLMediaElement.prototype[method] = function () {
        mark(method + '-call', { media: this.currentTime, ready: this.readyState });
        return original.apply(this, arguments);
      };
    }
    for (const type of ['loadedmetadata', 'loadeddata', 'canplay', 'seeking', 'seeked', 'playing', 'waiting', 'pause']) {
      document.addEventListener(type, event => {
        if (!(event.target instanceof HTMLMediaElement)) return;
        const a = event.target;
        mark(type, { media: a.currentTime, ready: a.readyState });
        if (type !== 'playing' || window.__handoffProbe.advancing) return;
        const first = a.currentTime;
        const timer = setInterval(() => {
          if (!a.paused && !a.seeking && a.currentTime > first + .015) {
            clearInterval(timer);
            window.__handoffProbe.advancing = true;
            mark('media-advancing', { media: a.currentTime });
          }
        }, 8);
      }, true);
    }
    document.addEventListener('DOMContentLoaded', () => mark('dom-ready'));
    window.addEventListener('beforeunload', () => mark('beforeunload'));
    window.addEventListener('pagehide', () => mark('pagehide'));
    window.addEventListener('hana-sdk-ready', () => mark('sdk-ready'));
  });
  const ready = () => page.waitForFunction(() => window.__handoffProbe.advancing, { timeout: 10000 });
  const url = (shell, round) => `${UI_BASE}/${shell}.html?appSurfaceSession=fake-ticket&timing=${round}`;
  try {
    await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
    await page.goto(url('index', 'initial'), { waitUntil: 'domcontentloaded' });
    await clickTab(page, 'imp:1');
    await page.waitForFunction(() => window.__playerDebug && document.querySelector('#queueList .q-hit'), { timeout: 8000 });
    await page.evaluate(() => document.querySelector('#queueList .q-hit').click());
    await ready();
    await page.evaluate(() => { document.querySelector('audio').currentTime = 3.4; });
    await page.waitForFunction(() => !document.querySelector('audio').seeking);
    await sleep(350);
    for (let round = 1; round <= 4; round++) {
      for (const direction of ['detach', 'reattach']) {
        await page.evaluate(() => window.__playerDebug.persistNow());
        await sleep(80);
        const oldDoc = await page.evaluate(() => window.__handoffProbe.doc);
        const detached = direction === 'detach';
        await page.setViewport({ width: detached ? 1040 : 465, height: detached ? 780 : 930, deviceScaleFactor: 1 });
        await page.goto(url(detached ? 'standalone' : 'index', `${round}-${direction}`), { waitUntil: 'domcontentloaded' });
        await ready();
        const info = await page.evaluate(() => ({
          doc: window.__handoffProbe.doc, build: window.__HANA_BUILD,
          lyricLines: document.querySelectorAll('.lyric-line').length,
          longTasks: window.__handoffProbe.longTasks,
          owner: window.__playerDebug.audioOwner(),
          media: document.querySelector('audio').currentTime
        }));
        const old = events.filter(e => e.doc === oldDoc), next = events.filter(e => e.doc === info.doc);
        const stopped = old.filter(e => e.type === 'pause-call').at(-1) || old.find(e => e.type === 'pagehide');
        const event = type => next.find(e => e.type === type)?.t;
        const playing = event('playing'), advanced = event('media-advancing'), play = event('play-call');
        const difference = (a, b) => a !== undefined && b !== undefined ? +(a - b).toFixed(2) : null;
        if (!stopped || !playing || !advanced || !play) throw new Error('incomplete handoff trace');
        rounds.push({ round, direction, ...info,
          pauseToPlayingMs: difference(playing, stopped.t),
          pauseToAdvanceMs: difference(advanced, stopped.t),
          pauseToDocumentMs: difference(event('document-start'), stopped.t),
          documentToPlayMs: difference(play, event('document-start')),
          documentToDomMs: difference(event('dom-ready'), event('document-start')),
          loadToMetadataMs: difference(event('loadedmetadata'), event('load-call')),
          seekMs: difference(event('seeked'), event('seeking')),
          playToPlayingMs: difference(playing, play),
          playingToAdvanceMs: difference(advanced, playing)
        });
        await sleep(350);
      }
    }
    const summary = {};
    for (const direction of ['detach', 'reattach']) {
      const samples = rounds.filter(r => r.direction === direction);
      summary[direction] = {};
      for (const field of ['pauseToPlayingMs', 'pauseToAdvanceMs', 'documentToPlayMs', 'documentToDomMs', 'loadToMetadataMs', 'playToPlayingMs', 'playingToAdvanceMs']) {
        const values = samples.map(r => r[field]).filter(v => v !== null).sort((a, b) => a - b);
        summary[direction][field] = { median: +((values[1] + values[2]) / 2).toFixed(2), min: values[0], max: values.at(-1) };
      }
    }
    return { scope: 'headless Chrome + real owner arbiter + synthetic WAV; document navigation, not native Hana detach or speaker-output recording', rounds, summary, events };
  } finally { await page.close(); }
}

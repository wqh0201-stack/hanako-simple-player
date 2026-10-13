// Independent browser experiment. No Hana runtime, production data, or App source access.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');

function frameHtml(id, channelName) {
  return '<!doctype html><script>(' + function (frameId, name) {
    var channel;
    function report(kind, data) {
      parent.postMessage({ probe: true, id: frameId, kind: kind, data: data }, '*');
    }
    try {
      channel = new BroadcastChannel(name);
      channel.onmessage = function (event) {
        report('received', { message: event.data, eventOrigin: event.origin });
        if (event.data.kind === 'ping') {
          channel.postMessage({ kind: 'pong', seq: event.data.seq, sender: frameId });
        }
      };
      report('ready', { constructed: true, locationOrigin: location.origin, windowOrigin: window.origin });
    } catch (error) {
      report('ready', { constructed: false, error: error.name, locationOrigin: location.origin });
    }
    addEventListener('message', function (event) {
      if (!event.data || event.data.command !== 'send' || !channel) return;
      try {
        channel.postMessage({ kind: 'ping', seq: event.data.seq, sender: frameId });
        report('sent', { seq: event.data.seq });
      } catch (error) { report('send-error', { name: error.name }); }
    });
  }.toString() + ')(' + JSON.stringify(id) + ',' + JSON.stringify(channelName) + ');<\/script>';
}

(async function () {
  const server = http.createServer(function (request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/frame') {
      response.end(frameHtml(url.searchParams.get('id'), url.searchParams.get('channel')));
    } else response.end('<!doctype html><title>Independent BC probe</title>');
  });
  let browser;
  const result = { startedAt: new Date().toISOString(), scope: 'system Chrome headless; local fixtures; no actual Hana surfaces' };
  try {
    await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    result.browserVersion = await browser.version();
    result.nodeVersion = process.version;
    result.pairs = [];
    for (const source of ['srcdoc', 'http']) {
      for (const sandbox of [null, 'allow-scripts', 'allow-scripts allow-same-origin']) {
        const page = await browser.newPage();
        await page.goto(base);
        const name = 'audio-owner-review-' + source + '-' + String(sandbox);
        await page.evaluate(function () {
          window.probeReports = [];
          addEventListener('message', function (event) {
            if (event.data && event.data.probe) window.probeReports.push({ at: performance.now(), messageOrigin: event.origin, report: event.data });
          });
        });
        await page.evaluate(function (config) {
          ['A', 'B'].forEach(function (id) {
            var frame = document.createElement('iframe');
            frame.id = id;
            if (config.sandbox !== null) frame.setAttribute('sandbox', config.sandbox);
            if (config.source === 'srcdoc') frame.srcdoc = config.html[id];
            else frame.src = config.base + '/frame?id=' + id + '&channel=' + encodeURIComponent(config.name);
            document.body.appendChild(frame);
          });
        }, { source, sandbox, base, name, html: { A: frameHtml('A', name), B: frameHtml('B', name) } });
        await page.waitForFunction(function () { return window.probeReports.filter(function (item) { return item.report.kind === 'ready'; }).length === 2; }, { timeout: 5000 });
        await page.evaluate(function () {
          document.getElementById('A').contentWindow.postMessage({ command: 'send', seq: 1 }, '*');
          document.getElementById('B').contentWindow.postMessage({ command: 'send', seq: 2 }, '*');
        });
        // A bounded negative observation, not a claim about any host death timeout.
        await new Promise(function (resolve) { setTimeout(resolve, 1200); });
        const reports = await page.evaluate(function () { return window.probeReports; });
        result.pairs.push({ source, sandbox, observationWindowMs: 1200, constructed: reports.filter(x => x.report.kind === 'ready').map(x => x.report.data.constructed), sent: reports.filter(x => x.report.kind === 'sent').length, received: reports.filter(x => x.report.kind === 'received').length, reports });
        await page.close();
      }
    }
    const page = await browser.newPage();
    await page.goto(base);
    result.pause = await page.evaluate(async function () {
      var length = 8000 * 3;
      var buffer = new ArrayBuffer(44 + length * 2);
      var view = new DataView(buffer);
      function str(offset, text) { for (var i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); }
      str(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      str(36, 'data'); view.setUint32(40, length * 2, true);
      var audio = document.createElement('audio'); audio.muted = true;
      var objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })); audio.src = objectUrl;
      document.body.appendChild(audio);
      await audio.play();
      var trace = [], pauseEvents = 0;
      audio.addEventListener('pause', function () { pauseEvents++; trace.push({ stage: 'pause-event', paused: audio.paused }); });
      trace.push({ stage: 'before-pause', paused: audio.paused });
      audio.pause();
      trace.push({ stage: 'after-pause-return', paused: audio.paused, pauseEvents: pauseEvents });
      await Promise.resolve();
      trace.push({ stage: 'after-microtask', paused: audio.paused, pauseEvents: pauseEvents });
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
      trace.push({ stage: 'after-event-loop', paused: audio.paused, pauseEvents: pauseEvents });
      audio.pause();
      await new Promise(function (resolve) { setTimeout(resolve, 50); });
      trace.push({ stage: 'pause-again-while-paused', paused: audio.paused, pauseEvents: pauseEvents });
      URL.revokeObjectURL(objectUrl);
      return trace;
    });
    await page.close();
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(__dirname, 'connectivity-and-pause.raw.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ browserVersion: result.browserVersion, pairs: result.pairs.map(({ source, sandbox, constructed, sent, received }) => ({ source, sandbox, constructed, sent, received })), pause: result.pause }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(function (resolve) { server.close(resolve); });
  }
})().catch(function (error) { console.error(error.stack); process.exitCode = 1; });

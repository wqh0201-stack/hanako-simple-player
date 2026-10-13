// BroadcastChannel 语义基线 v2（修掉 v1 的两个测法错误）：
//  · v1 里 A 只认 kind==='ping'，把 B 回的 pong 全丢了 → rtt 记录为 0，是测法的错不是通道的错
//  · v1 里 sandbox iframe 因跨域读不到 contentWindow.__r → 改成 iframe 内 postMessage 上报
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const require2 = createRequire('/Volumes/SSD/hanadesk/鹈鹕/motion-reel/');
const puppeteer = require2('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const m = /^\/(a|b)\/index\.html$/.exec(u.pathname);
  if (!m) { res.statusCode = 404; return res.end('no'); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join('/tmp/bcprobe', m[1], 'index.html')));
});

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const out = { base };

  const pa = await browser.newPage();
  await pa.goto(`${base}/a/index.html`);
  const pb = await browser.newPage();
  await pb.goto(`${base}/b/index.html`);
  await new Promise((r) => setTimeout(r, 500));
  out.tabToTab = { receivedByA: await pa.evaluate(() => window.hits), };

  // 往返：A 发 ping → B 回 pong → A 收 pong（v1 漏了这一段）
  await pa.evaluate(() => {
    window.samples = []; window.pending = new Map();
    window.ch2 = new BroadcastChannel('hana-simple-player-audio');
    window.ch2.onmessage = (e) => {
      const d = e.data || {};
      if (d.kind !== 'pong') return;
      const t0 = window.pending.get(d.seq);
      if (t0 !== undefined) { window.pending.delete(d.seq); window.samples.push(Date.now() - t0); }
    };
  });
  await pb.evaluate(() => {
    window.ch2 = new BroadcastChannel('hana-simple-player-audio');
    window.ch2.onmessage = (e) => {
      const d = e.data || {};
      if (d.kind !== 'ping') return;
      window.ch2.postMessage({ kind: 'pong', seq: d.seq });
    };
  });
  for (let i = 0; i < 30; i += 1) {
    await pa.evaluate((seq) => { window.pending.set(seq, Date.now()); window.ch2.postMessage({ kind: 'ping', seq }); }, i + 1);
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 800));
  const samples = await pa.evaluate(() => window.samples);
  const sorted = samples.slice().sort((x, y) => x - y);
  out.rtt = { sent: 30, received: samples.length, lost: 30 - samples.length,
    p50: pct(sorted, 50), p95: pct(sorted, 95), max: sorted[sorted.length - 1] ?? null, raw: samples };

  // 不透明源 / 普通 iframe：让 iframe 自己 postMessage 上报（v1 跨域读不到）
  async function probeIframe(sandboxAttr) {
    const p = await browser.newPage();
    await p.goto(`${base}/a/index.html`);
    await p.evaluate((sb) => {
      window.iframeReport = null;
      window.addEventListener('message', (e) => { if (e.data && e.data.__probe) window.iframeReport = e.data; });
      const f = document.createElement('iframe');
      const inner = `<script>
        (function(){
          var r;
          try { var c = new BroadcastChannel('probe-iframe'); c.close(); r = { bc: 'ok' }; }
          catch (err) { r = { bc: 'ERR:' + (err && err.name) }; }
          try { r.origin = location.origin; } catch (e) { r.origin = 'BLOCKED'; }
          parent.postMessage({ __probe: true, result: r }, '*');
        })();
      <\/script>`;
      if (sb) f.setAttribute('sandbox', sb);
      f.srcdoc = inner;
      document.body.appendChild(f);
    }, sandboxAttr);
    await new Promise((r) => setTimeout(r, 500));
    const rep = await p.evaluate(() => window.iframeReport);
    await p.close();
    return rep;
  }
  out.iframeOpaque = await probeIframe('allow-scripts');           // 不透明源
  out.iframeSameOrigin = await probeIframe(null);                    // 同源
  out.iframeAllowSameOrigin = await probeIframe('allow-scripts allow-same-origin');

  fs.writeFileSync('/tmp/bcprobe/result.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ tabToTab: out.tabToTab, rtt: { ...out.rtt, raw: out.rtt.raw.length + ' samples' },
    iframeOpaque: out.iframeOpaque, iframeSameOrigin: out.iframeSameOrigin, iframeAllowSameOrigin: out.iframeAllowSameOrigin }, null, 2));
  await browser.close(); server.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

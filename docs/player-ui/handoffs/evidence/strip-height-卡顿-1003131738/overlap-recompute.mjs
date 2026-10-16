#!/usr/bin/env node
/* 复算：横条高度 → 与宿主 44px 原生拖动带的重叠量。纯算术，不依赖浏览器。
 * 输入：宿主席高度 h（宿主给卡片的 CSS px，等于页面里 #frame 的高度）
 * 依据（两处源码）：
 *   1. ui/style.css:2993  --strip-y: max(0px, calc((100% - var(--strip-height)) / 2))
 *   2. ui/app.js:8113     --strip-height = max(56, min(96, h - 24))
 *   3. 宿主渲染器 ChatTranscript-DpoxT8u5.css ._tileTop_19ca0
 *      { position:absolute; top:0; left:0; right:0; height:var(--titlebar-h, 44px);
 *        pointer-events:none; -webkit-app-region:drag; z-index:5 }
 *      assets/mobile-BT7ks5Ep.css 定义 --titlebar-h: 44px
 * 输出：条上下沿、与 0~44px 带的重叠像素、是否安全。
 */
const BAR_TOP = 0, BAR_BOTTOM = 44;          // 宿主拖动带（iframe 视口坐标系）
const heights = process.argv[2]
  ? process.argv[2].split(',').map(Number)
  : [56, 60, 68, 80, 94, 103, 112, 120, 130, 140, 150, 160, 170, 180, 192, 220, 260];

const rows = heights.map(h => {
  const sh = Math.max(56, Math.min(96, h - 24));   // app.js:8113
  const sy = Math.max(0, (h - sh) / 2);            // --strip-y
  const top = sy, bottom = sy + sh;
  const overlap = Math.max(0, Math.min(BAR_BOTTOM, bottom) - Math.max(BAR_TOP, top));
  return { h, sh, sy, top, bottom, overlap, coveredPct: sh ? (overlap / sh) * 100 : 0 };
});

const pad = (v, n) => String(v).padStart(n);
console.log('宿主高 |  条高 | 条顶 | 条底 | 与44px带重叠 | 条被覆盖占比 | 判定');
console.log('-------+-------+------+------+--------------+--------------+------');
for (const r of rows) {
  const verdict = r.overlap > 0.5 ? `卡顿区(重叠${r.overlap.toFixed(1)}px)` : '安全';
  console.log(
    `${pad(r.h, 6)} | ${pad(r.sh.toFixed(1), 5)} | ${pad(r.top.toFixed(1), 4)} | ${pad(r.bottom.toFixed(1), 4)} |`
    + ` ${pad(r.overlap.toFixed(1), 12)} | ${pad(r.coveredPct.toFixed(0) + '%', 12)} | ${verdict}`
  );
}
const safe = rows.filter(r => r.overlap <= 0.5).map(r => r.h);
console.log('\n完全脱离 44px 带的最小宿主高 =', safe.length ? Math.min(...safe) : '（本表内无）', 'px');

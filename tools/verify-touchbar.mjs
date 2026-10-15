// Touch Bar 行为回归，借用 verify-ui 的真实文档/媒体与可控后端。
import fs from 'node:fs';
import path from 'node:path';
export async function verifyTouchbar({ newPage, BASE, API, UI_BASE, outDir, assert, sleep, clickTab, report }) {
  const dir = path.join(outDir, 'touchbar'); fs.mkdirSync(dir, { recursive: true });
  const check = (id, ok, info) => assert('TB-' + id, ok, typeof info === 'string' ? info : JSON.stringify(info));
  await fetch(`${BASE}${API}/__fixture/reset?mode=lyric-flow&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.goto(`${UI_BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__playerDebug && document.querySelector('#listTabs .list-tab'));
  await clickTab(page, 'imp:1');
  await page.evaluate(() => document.querySelector('#queueList .q-hit').click());
  await page.waitForFunction(() => !document.querySelector('audio').paused && document.querySelectorAll('.lyric-line').length === 7);
  const state = () => page.evaluate(() => window.__playerDebug.stripState());
  const TB_TRACE = process.env.TB_TRACE === '1';
  const trace = (msg) => { if (TB_TRACE) console.log('[tb-trace] ' + msg); };
  const geo = () => page.evaluate(() => {
    const $ = id => document.getElementById(id), rect = id => { const r = $(id).getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom }; };
    const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && +getComputedStyle(el).opacity > .01;
    const controls = [...document.querySelectorAll('#stripLayout button, #stripLayout input')].filter(visible).filter(el => !el.disabled && !el.closest('[inert]')).map(el => {
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return { id:el.id || el.getAttribute('data-strip-proxy'),x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom,hit:hit===el||el.contains(hit) };
    });
    return { cover:rect('stripCover'),bar:rect('stripBar'),identity:rect('stripIdentity'),now:rect('stripNow'),total:rect('stripTotal'),artist:rect('stripArtist'),controls,
      titleFont:getComputedStyle($('stripTitle')).fontSize,artistFont:getComputedStyle($('stripArtist')).fontSize,
      seekHit:(()=>{const r=$('stripBar').getBoundingClientRect();return document.elementFromPoint(r.x+r.width*.75,r.bottom-12)?.id;})(),
      field:getComputedStyle($('stripPlayed')).backgroundImage, fill:$('stripBar').style.getPropertyValue('--strip-fill'),
      stageHidden:getComputedStyle($('stage')).display==='none',footerHidden:getComputedStyle($('controls')).display==='none',
      lyric:$('stripLyric').textContent,hot:$('stripLayout').dataset.hot,volume:(()=>{const r=$('stripVolumeReveal').getBoundingClientRect();const cs=getComputedStyle($('stripVolumeReveal'));return {w:r.width,x:r.x,right:r.right,op:+cs.opacity,vis:cs.visibility};})(),
      audio:{time:$('audio').currentTime,paused:$('audio').paused,src:$('audio').currentSrc,owner:window.__playerDebug.audioOwner().generation},
      overflow:document.documentElement.scrollWidth>innerWidth,rootHeight:$('player').getBoundingClientRect().height };
  });
  // 首次布局立即完整提交，动画只按时间结束；停止尺寸变化也必落定。
  const audioBefore = (await geo()).audio;
  await page.evaluate(() => { window.__tbAudio = document.querySelector('audio'); window.__tbPlayEvents = 0; window.__tbAudio.addEventListener('play',()=>window.__tbPlayEvents++); });
  const frames = [];
  await page.setViewport({ width:1040,height:128,deviceScaleFactor:1 });
  await page.waitForFunction(() => document.getElementById('player').dataset.layout==='strip');
  check('08-discrete-target-committed', (await state()).layout === 'strip');
  for(let i=0;i<7;i++) { frames.push({at:Date.now(),state:await state(),geometry:await geo()}); await page.screenshot({path:path.join(dir,`morph-${String(i).padStart(2,'0')}.png`)}); await sleep(35); }
  await sleep(320);
  check('08-stopped-resize-finishes', !(await state()).motion, await state());
  check('13-no-stationary-hover', (await state()).hot === false, await state());
  check('11-same-audio-no-new-play', await page.evaluate(() => window.__tbAudio===document.querySelector('audio') && window.__tbPlayEvents===0), {before:audioBefore,after:(await geo()).audio});
  check('11-clock-owner-continuous', (await geo()).audio.time > audioBefore.time && (await geo()).audio.owner===audioBefore.owner);
  await page.evaluate(() => { document.querySelector('audio').currentTime=5; });
  await sleep(320);
  check('03-real-current-line', (await geo()).lyric.length>0, (await geo()).lyric);
  // 三宽度、两主题，固定封面/身份/字体与真实命中。控件区域不进入右上安全区。
  const geometry=[];
  for(const width of [1040,640,593,480,420,416,360,312]) {
    await page.setViewport({width,height:128,deviceScaleFactor:1}); await sleep(70);
    await page.evaluate(()=>document.activeElement?.blur()); await page.mouse.move(1,127);
    const calm=await geo();
    check(`02-fixed-${width}`,calm.cover.w===64&&calm.cover.h===64&&calm.identity.w===112&&calm.titleFont==='13px'&&calm.artistFont==='11px',calm);
    /* 用户否决了「为避让宿主控件把内容压低」：条必须在容器里垂直居中，
     * 封面与条同轴（各自 64 高、同 top），不再强制 y>=40 的避让余量。 */
    check(`01-shape-${width}`,calm.bar.x>=calm.cover.right+12&&calm.bar.bottom<=128&&calm.stageHidden&&calm.footerHidden
      &&Math.abs(calm.bar.y-calm.cover.y)<.5
      &&Math.abs((calm.bar.y+calm.bar.bottom)/2-128/2)<=1.5
      &&Math.abs((calm.cover.y+calm.cover.bottom)/2-128/2)<=1.5,calm);
    await page.mouse.move(calm.bar.x+calm.bar.w-20,calm.bar.y+22); await sleep(35);
    const hot=await geo();
    check(`03-controls-hit-${width}`,hot.hot==='1'&&hot.controls.filter(c=>c.id!=='stripCover'&&c.id!=='stripSeek').every(c=>c.hit&&c.right<=width&&c.bottom<=128&&!(c.right>width-100&&c.y<40)),hot.controls);
    check(`06-times-inside-${width}`,hot.now.x>=hot.bar.x&&hot.total.right<=hot.bar.right&&hot.now.bottom<=hot.bar.bottom&&hot.total.y>=hot.artist.bottom,hot);
    /* 控件组在条内垂直居中（用户点名「播放控件在歌词区域偏上」）。 */
    const ctr=hot.controls.filter(c=>c.id!=='stripCover'&&c.id!=='stripSeek');
    check(`03-controls-centered-${width}`,ctr.length>0&&ctr.every(c=>Math.abs((c.y+c.bottom)/2-(hot.bar.y+hot.bar.bottom)/2)<=1.5),ctr.map(c=>({id:c.id,mid:(c.y+c.bottom)/2})).concat([{id:'barMid',mid:(hot.bar.y+hot.bar.bottom)/2}]));
    /* 身份区与条同轴居中。 */
    check(`02-identity-centered-${width}`,Math.abs((calm.identity.y+calm.identity.bottom)/2-(calm.bar.y+calm.bar.bottom)/2)<=1.5,calm.identity);
    for(const tone of ['light','dark']) {
      await page.evaluate(t=>window.__fixtureTheme(t),tone); await page.mouse.move(calm.bar.x+calm.bar.w-20,calm.bar.y+22); await sleep(40);
      await page.screenshot({path:path.join(dir,`strip-${width}-${tone}-hot.png`)});
      await page.mouse.move(1,127); await page.evaluate(()=>document.activeElement?.blur()); await sleep(30);
      await page.screenshot({path:path.join(dir,`strip-${width}-${tone}-quiet.png`)});
    }
    geometry.push({width,quiet:calm,hot});
  }
  check('10-resize-within-strip-no-replay',(await state()).transitions===1,await state());
  /* 宽度不够**不折叠、不做二级面板**：按优先级逐个丢按钮，最后只剩播放键（用户拍板）。
   * 断言用真实可见控件集合与命中，不看 class。 */
  const visible=()=>page.evaluate(()=>{
    const bar=document.getElementById('stripBar').getBoundingClientRect();
    return [...document.querySelectorAll('#stripControls > *, #stripControls button')].filter(el=>el.getClientRects().length&&!el.hidden&&!el.closest('[inert]'))
      .filter((el,i,a)=>a.indexOf(el)===i)
      .map(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {id:el.id,hidden:!!el.hidden,w:r.width,right:r.right,bottom:r.bottom,
        inBar:r.left>=bar.left-0.5&&r.right<=bar.right+0.5,hit:!!hit&&(hit===el||el.contains(hit))};});
  });
  await page.setViewport({width:312,height:128,deviceScaleFactor:1}); await sleep(120);
  /* 控件只在 hot（指针在条内/键盘聚焦）时可见，所以要先悬停再断言可见性。 */
  await page.mouse.move(200,64); await sleep(140);
  /* 用真实可见性（有没有布局盒），不是 hidden property —— 属性写了但 CSS 没生效这种
   * 「假隐藏」必须被这条抓住（本轮就踩了：prev/next 嵌在 .strip-transport 里）。 */
  const seen=()=>page.evaluate(()=>{const on=id=>{const el=document.getElementById(id);return !!el&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';};
    return {play:on('stripPlay'),mode:on('stripMode'),prev:on('stripPrev'),next:on('stripNext'),fav:on('stripFav'),vol:on('stripVolumeGroup')};});
  const narrow=await seen();
  check('04-narrow-keeps-play-only',narrow.play&&!narrow.mode&&!narrow.prev&&!narrow.next&&!narrow.fav&&!narrow.vol,narrow);
  const narrowHot=(await visible()).filter(c=>c.id);
  check('04-narrow-play-still-hittable',
    narrowHot.some(c=>c.id==='stripPlay'&&c.hit&&c.inBar)&&
    narrowHot.filter(c=>c.id!=='stripSeek').every(c=>c.hit&&c.inBar),narrowHot);
  await page.screenshot({path:path.join(dir,'strip-312-play-only.png')});
  /* 中等宽度：边缘键先丢，核心三键保留（顺序稳定、可预期）。 */
  await page.setViewport({width:420,height:128,deviceScaleFactor:1}); await sleep(120);
  const mid420=await page.evaluate(()=>{
    const bar=document.getElementById('stripBar').getBoundingClientRect();
    const box=document.getElementById('stripControls').getBoundingClientRect();
    const ids={play:'stripPlay',prev:'stripPrev',next:'stripNext',fav:'stripFav',mode:'stripMode',vol:'stripVolumeGroup'};
    const vis={}; Object.keys(ids).forEach(k=>{const el=document.getElementById(ids[k]);vis[k]=!!el&&el.getClientRects().length>0;});
    return {vis, fits:box.right<=bar.right+0.5&&box.left>=bar.left-0.5};
  });
  /* 契约：播放键与上一首/下一首永远在；掉队一定从边缘（音量→喜欢→模式）开始；
   * 可见控件绝不溢出条。不写死「恰好剩几个」——那取决于真实文字宽度。 */
  const dropped=Object.keys(mid420.vis).filter(k=>!mid420.vis[k]);
  const droppedEdgesOnly=dropped.every(k=>['vol','fav','mode'].indexOf(k)>=0);
  check('04-mid-drops-edges-not-transport',mid420.vis.play&&mid420.vis.prev&&mid420.vis.next&&droppedEdgesOnly&&dropped.length>0&&mid420.fits,mid420);
  /* 音量：悬停向右展开（与大窗一致），不挤压左边控件；点喇叭=静音。 */
  await page.setViewport({width:640,height:128,deviceScaleFactor:1}); await sleep(120);
  await page.mouse.move(200,64); await sleep(140);
  const menu=await geo();
  const vb=menu.controls.find(c=>c.id==='stripVolumeBtn');
  await page.mouse.move(vb.x+vb.w/2,vb.y+vb.h/2); await sleep(260);
  const smallVolume=await geo();
  check('05-volume-right-reveal',(await state()).volume===true&&smallVolume.volume.op>.9&&smallVolume.volume.w>100&&smallVolume.controls.find(c=>c.id==='stripVol')?.hit,{state:await state(),vol:smallVolume.volume});
  await page.focus('#stripVol'); await page.keyboard.press('ArrowLeft');
  check('05-volume-keyboard',await page.evaluate(()=>Math.round(document.querySelector('audio').volume*100)===+document.getElementById('stripVol').value));
  await page.keyboard.press('Escape'); await sleep(180);
  check('05-escape-collapses',!(await state()).volume,{state:await state(),hover:await page.evaluate(()=>!!document.querySelector('.strip-volume:hover'))});

  // 横条应该是只读的一行歌词：旧歌词面（点句跳转/滚轮/长按校准）必须收干净，
  // 但进度背景仍可点按定位。用命中测试证明，不看 class。
  await page.setViewport({ width: 640, height: 128, deviceScaleFactor: 1 }); await sleep(80);
  await page.mouse.move(1, 127); await page.evaluate(() => document.activeElement?.blur()); await sleep(40);
  const lyricHit = await page.evaluate(() => {
    const pl = document.getElementById('player'), stage = document.getElementById('stage');
    const lyr = document.getElementById('lyrics'), wrap = document.getElementById('lyricWrap');
    const t = document.getElementById('stripLyric'), bar = document.getElementById('stripBar').getBoundingClientRect();
    const r = t.getBoundingClientRect();
    const atLyric = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
    const atWrap = document.elementFromPoint(wrap.getBoundingClientRect().left + 8, wrap.getBoundingClientRect().top + 8);
    const chain = (el) => { const out = []; let n = el; while (n && n !== document.body) { out.push(n.id || n.className || n.tagName); n = n.parentElement; } return out.slice(0, 5); };
    return {
      stageDisplay: getComputedStyle(stage).display, stageInert: stage.inert === true,
      lyricDisplay: getComputedStyle(lyr).display, wrapDisplay: getComputedStyle(wrap).display,
      lyricLines: lyr.querySelectorAll('.lyric-line').length,
      hot: document.getElementById('stripLayout').dataset.hot,
      lyricTarget: atLyric && (atLyric.id || atLyric.className || atLyric.tagName), lyricChain: chain(atLyric),
      wrapTarget: atWrap && (atWrap.id || atWrap.className || atWrap.tagName),
      stripLyricPointer: getComputedStyle(document.getElementById('stripLyric')).pointerEvents,
      barCenterTarget: (() => { const h = document.elementFromPoint(bar.left + bar.width * .4, bar.top + bar.height * .82); return h && (h.id || h.className); })(),
      tabbable: [...document.querySelectorAll('#stage button, #stage input, #stage [tabindex]')].filter((e) => e.getClientRects().length > 0).length,
      layout: pl.dataset.layout
    };
  });
  trace('lyric-inert ' + JSON.stringify(lyricHit));
  check('15-strip-lyric-readonly',
    lyricHit.layout === 'strip' && lyricHit.stageDisplay === 'none' && lyricHit.stageInert && lyricHit.lyricLines > 0 &&
    (lyricHit.lyricTarget === 'strip-lyric' || lyricHit.lyricTarget === 'stripBar' || lyricHit.lyricTarget === 'stripSeek') &&
    !lyricHit.lyricChain.includes('lyrics') && !lyricHit.lyricChain.includes('lyricWrap') &&
    lyricHit.stripLyricPointer === 'none' && lyricHit.tabbable === 0,
    lyricHit);

  // 正在唱的这句要有高光描边（用户点名）：颜色走 --hl-accent、带 text-shadow 光晕；
  // 无歌词时空字符串不发光，不能凭空给假高光。
  const glow=await page.evaluate(()=>{
    const el=document.getElementById('stripLyric'), cs=getComputedStyle(el);
    const before=cs.textShadow, color=cs.color, text=el.textContent;
    el.textContent=''; const empty={shadow:getComputedStyle(el).textShadow,color:getComputedStyle(el).color};
    el.textContent=text;
    return { text, before, color, empty, hl:getComputedStyle(document.getElementById('player')).getPropertyValue('--hl-accent').trim() };
  });
  trace('strip-glow '+JSON.stringify(glow));
  check('15-current-lyric-highlight',glow.text.length>0&&glow.before!=='none'&&glow.before.split(',').length>=3&&glow.hl!=='',glow);
  check('15-empty-lyric-no-glow',glow.empty.shadow==='none',glow);
  for(const tone of ['light','dark']) {
    await page.evaluate(t=>window.__fixtureTheme(t),tone); await sleep(60);
    const g=await page.evaluate(()=>{const cs=getComputedStyle(document.getElementById('stripLyric'));return {shadow:cs.textShadow,color:cs.color};});
    check('15-lyric-highlight-'+tone,g.shadow!=='none'&&g.shadow.length>10,g);
  }

  // 文字墨迹盒（Range 量真实行盒，不是容器盒）在条内垂直居中：
  // 歌手行为空时标题也不能吊在身份区顶部。用户点名这两处不居中。
  const ink=await page.evaluate(()=>{
    const mid=el=>{const r=document.createRange();r.selectNodeContents(el);const b=r.getBoundingClientRect();return {top:b.top,bottom:b.bottom,mid:(b.top+b.bottom)/2,h:b.height,text:el.textContent};};
    const bar=document.getElementById('stripBar').getBoundingClientRect();
    return { barMid:(bar.top+bar.bottom)/2, title:mid(document.getElementById('stripTitle')),
      artist:mid(document.getElementById('stripArtist')), lyric:mid(document.getElementById('stripLyric')) };
  });
  trace('ink '+JSON.stringify(ink));
  check('02-identity-ink-centered',Math.abs(ink.title.mid-ink.barMid)<=3,ink);
  check('15-lyric-ink-centered',Math.abs(ink.lyric.mid-ink.barMid)<=3,ink);

  // 宿主真实最小高度（截图实测 ≈103 CSS px）：不得裁切、不得出现滚动条。
  for (const hh of [112, 108, 104, 100, 96]) {
    await page.setViewport({ width: 480, height: hh, deviceScaleFactor: 1 }); await sleep(70);
    await page.evaluate(() => document.activeElement?.blur()); await page.mouse.move(1, hh - 1);
    const m = await page.evaluate(() => {
      const pl = document.getElementById('player'), sl = document.getElementById('stripLayout');
      const b = document.getElementById('stripBar').getBoundingClientRect();
      const c = document.getElementById('stripCover').getBoundingClientRect();
      return { layout: pl.dataset.layout, scrollY: sl.scrollHeight - sl.clientHeight, scrollX: sl.scrollWidth - sl.clientWidth,
        plScrollY: pl.scrollHeight - pl.clientHeight, plScrollX: pl.scrollWidth - pl.clientWidth,
        barTop: b.top, barBottom: b.bottom, barH: b.height, coverTop: c.top, coverBottom: c.bottom, coverH: c.height };
    });
    trace(`height ${hh}: ` + JSON.stringify(m));
    check(`15-height-${hh}-no-clip`, m.layout === 'strip' && m.barBottom <= hh && m.coverBottom <= hh && m.plScrollY <= 0 && m.plScrollX <= 0, m);
  }
  await page.setViewport({ width: 480, height: 128, deviceScaleFactor: 1 }); await sleep(70);

  // 正常宽度控件不会误seek；音量为点击向右，而不是悬停弹层或点击静音。
  await page.setViewport({width:640,height:128,deviceScaleFactor:1}); await sleep(80);
  let g=await geo(); await page.mouse.move(g.bar.x+150,g.bar.y+20); await sleep(30);
  const beforeAction=(await geo()).audio.time;
  const oldMode=await page.$eval('#modeBtn',e=>e.getAttribute('aria-label'));
  await page.click('#stripMode');
  check('04-mode-real-state',await page.$eval('#modeBtn',e=>e.getAttribute('aria-label'))!==oldMode);
  await page.click('#stripFav');
  check('04-favorite-real-state',await page.evaluate(()=>document.getElementById('stripFav').getAttribute('aria-pressed')===document.getElementById('favBtn').getAttribute('aria-pressed')));
  check('06-buttons-do-not-seek',Math.abs((await geo()).audio.time-beforeAction)<2);
  const volumeBefore=await page.evaluate(()=>({muted:document.querySelector('audio').muted,volume:document.querySelector('audio').volume}));
  /* 悬停喇叭 → 向右展开（与大窗同一套：悬停开、移开收）。 */
  const ctlBefore=(await geo()).controls.filter(c=>c.id!=='stripVol');
  await page.hover('#stripVolumeBtn'); await sleep(280);
  check('05-hover-opens',(await state()).volume===true,await state());
  g=await geo();
  const volumeRect=g.controls.find(c=>c.id==='stripVol'), buttonRect=g.controls.find(c=>c.id==='stripVolumeBtn');
  check('05-volume-extends-right',volumeRect&&volumeRect.x>=buttonRect.right&&volumeRect.hit&&volumeRect.right<=640,g.controls);
  /* 浮层是绝对定位：展开期间左侧控件一个都不许移动（不挤压）。 */
  const ctlAfter=g.controls.filter(c=>c.id!=='stripVol');
  const moved=ctlBefore.filter(b=>{const a=ctlAfter.find(x=>x.id===b.id);return a&&Math.abs(a.x-b.x)>0.5;});
  check('05-volume-does-not-squeeze-controls',moved.length===0,{moved});
  /* 点喇叭 = 静音/取消静音（沿用既有 muteBtn），不是开合。 */
  await page.click('#stripVolumeBtn'); await sleep(120);
  check('05-button-toggles-mute',await page.evaluate(()=>document.querySelector('audio').muted)!==volumeBefore.muted,{volumeBefore,now:await page.evaluate(()=>({muted:document.querySelector('audio').muted}))});
  await page.click('#stripVolumeBtn'); await sleep(120);
  await page.screenshot({path:path.join(dir,'strip-640-volume-open.png')});
  await page.mouse.move(1,127); await sleep(200);
  check('05-leave-collapses',(await state()).volume===false,await state());
  await page.mouse.move(volumeRect.x+volumeRect.w*.7,volumeRect.y+10); await page.mouse.down(); await page.mouse.move(volumeRect.x+volumeRect.w*.3,volumeRect.y+10,{steps:5});
  await page.setViewport({width:600,height:128,deviceScaleFactor:1}); await page.mouse.up();
  check('05-drag-resize-finishes',await page.evaluate(()=>Math.abs(document.querySelector('audio').volume-Number(document.getElementById('stripVol').value)/100)<.011));
  await page.mouse.move(1,127); await page.evaluate(()=>document.activeElement?.blur()); await sleep(50);
  check('03-leave-restores-lyrics',!(await state()).hot,await state());
  // 原生 range 真实拖动背景，完整色场不随比例改变。
  /* 前置条件显式化：先落一次真正的暂停再点进度。裸 audio.pause() 只暂停元素，
   * 应用侧的 owner 快照仍可能判为「该续播」，稍后被一次 restore 覆盖 —— 那会让
   * 后面的 seek 断言拿到「点击没生效 + 还在播」的假红。用应用自己的入口并等到位。 */
  await page.evaluate(() => window.__playerDebug.pauseAll());
  await page.waitForFunction(() => document.querySelector('audio').paused === true, { timeout: 3000 });
  g=await geo(); const field=g.field;
  for(const fraction of [0,.005,.5,1]) {
    const target=Math.min(g.bar.right-1,g.bar.x+g.bar.w*fraction);
    await page.mouse.move(target,g.bar.bottom-10);
    const hit=await page.evaluate((x,y)=>{const el=document.elementFromPoint(x,y);return el&&el.id;},target,g.bar.bottom-10);
    await page.mouse.down(); await page.mouse.up();
    await sleep(50);
    const at=await geo();
    trace(`seek f=${fraction} hit=${hit} slider=${at.fill} time=${at.audio.time}`);
    check('06-seek-'+fraction,hit==='stripSeek'&&Math.abs(at.audio.time-30*fraction)<1.2,{hit,...at.audio});
    check('07-field-stable-'+fraction,at.field===field);
  }
  /* 正在播放时点按进度条，绝不能被播报时钟（timeupdate≈250ms 一次 → renderStrip）
   * 回写成旧位置：值要在按住期间稳住，松手后落到点击处。这是 TB-06-seek-1 首跑偶发的根因。 */
  await page.evaluate(()=>window.__playerDebug.requestPlay('user'));
  await page.waitForFunction(()=>!document.querySelector('audio').paused,{timeout:5000});
  g=await geo();
  await page.mouse.move(g.bar.x+g.bar.w*.9,g.bar.bottom-10); await page.mouse.down();
  const held=await page.evaluate(()=>Number(document.getElementById('stripSeek').value));
  await sleep(600);   // 跨过至少两个 timeupdate 周期
  const heldLater=await page.evaluate(()=>Number(document.getElementById('stripSeek').value));
  await page.mouse.up(); await sleep(80);
  const settled=(await geo()).audio.time;
  check('06-seek-not-clobbered-while-playing',held===heldLater&&held>=25&&Math.abs(settled-30)<3,{held,heldLater,settled});
  await page.evaluate(()=>window.__playerDebug.pauseAll());
  await page.waitForFunction(()=>document.querySelector('audio').paused,{timeout:3000});
  await page.evaluate(()=>document.querySelector('audio').pause()); await sleep(60);
  // 键盘可从安静态bar主动进入，隐藏按钮不截获背景命中。
  await page.mouse.move(1,127); await page.evaluate(()=>document.activeElement?.blur()); await page.focus('#stripBar');
  check('13-keyboard-entry',(await state()).hot);
  await page.keyboard.press('Tab'); check('13-keyboard-range',await page.evaluate(()=>document.activeElement.id==='stripSeek'));
  // 超长文案保持固定矩形、原生完整title，无字号缩小。
  await page.evaluate(()=>{const t=window.__playerDebug.currentTrack(); t.title='这是非常长的中文歌曲名称 Long Song Name '.repeat(8);t.author='非常长的歌手名字 '.repeat(8);window.__playerDebug.renderTrack?.();document.getElementById('modeBtn').click();});
  check('02-long-copy-ellipsis',await page.evaluate(()=>{const e=document.getElementById('stripTitle');return e.scrollWidth>e.clientWidth&&getComputedStyle(e).textOverflow==='ellipsis'&&document.getElementById('stripIdentity').title.includes('Long Song');}));
  // 长歌词：不能因为居中就把首字裁掉（省略必须发生在尾部），短句才居中。
  for (const width of [1040, 480, 312]) {
    await page.setViewport({width,height:128,deviceScaleFactor:1}); await sleep(70);
    const ly=await page.evaluate(()=>{
      const el=document.getElementById('stripLyric'), bar=document.getElementById('stripBar').getBoundingClientRect();
      el.textContent='这是一句很长的中文歌词，让它自然换行之后仍然能够看清，每一个字都不会被波浪挤到旁边的句子上';
      const r=el.getBoundingClientRect();
      // 用 Range 量首字位置，判断是否被左侧容器裁掉
      const rng=document.createRange(); rng.setStart(el.firstChild,0); rng.setEnd(el.firstChild,1);
      const first=rng.getBoundingClientRect();
      return { elL:r.left, elR:r.right, textW:el.scrollWidth, boxW:r.width, firstL:first.left, barL:bar.left, barR:bar.right,
        overflowHidden:getComputedStyle(el).textOverflow==='ellipsis' };
    });
    check(`15-long-lyric-head-visible-${width}`,ly.firstL>=ly.elL-0.5&&ly.firstL>=ly.barL&&ly.overflowHidden,ly);
    check(`15-long-lyric-no-bleed-${width}`,ly.elR<=ly.barR+0.5,ly);
  }
  // 短句居中在轴线上。
  await page.setViewport({width:1040,height:128,deviceScaleFactor:1}); await sleep(70);
  const shortAxis=await page.evaluate(()=>{
    const el=document.getElementById('stripLyric'); el.textContent='短的';
    const r=el.getBoundingClientRect();
    const bar=document.getElementById('stripBar').getBoundingClientRect();
    const idr=document.getElementById('stripIdentity').getBoundingClientRect();
    return { mid:(r.left+r.right)/2, barMid:(bar.left+bar.right)/2, idRight:idr.right };
  });
  check('15-short-lyric-centered',Math.abs(shortAxis.mid-shortAxis.barMid)<=2&&shortAxis.mid>shortAxis.idRight,shortAxis);
  // 滞回区稳定；动画反向与同一布局持续缩放不会留下旧回调。
  await page.setViewport({width:1040,height:210,deviceScaleFactor:1}); await sleep(50);
  check('09-hysteresis-retains-strip',(await state()).layout==='strip');
  await page.setViewport({width:1040,height:224,deviceScaleFactor:1}); await sleep(60);
  check('09-exit-complete-target',(await state()).layout==='wide');
  await page.setViewport({width:1000,height:128,deviceScaleFactor:1}); await sleep(40);
  await page.setViewport({width:800,height:130,deviceScaleFactor:1}); await sleep(40);
  await page.setViewport({width:700,height:128,deviceScaleFactor:1}); await sleep(40);
  await page.setViewport({width:600,height:128,deviceScaleFactor:1}); await sleep(250);
  check('09-interrupted-latest-target-settles',!(await state()).motion&&(await state()).layout==='strip',await state());
  const counts=(await state()).transitions;
  for(const width of [900,480,320,640]) {await page.setViewport({width,height:128,deviceScaleFactor:1});await sleep(35);}
  check('10-no-clock-restart-in-strip',!(await state()).motion&&(await state()).transitions===counts,await state());
  await page.setViewport({width:312,height:930,deviceScaleFactor:1}); await sleep(380);
  check('10-tall-card-not-strip',(await state()).layout==='long');
  check('14-old-layout-controls-visible',await page.$eval('#playBtn',e=>e.getBoundingClientRect().width===44));
  /* 离开横条后旧控制面必须恢复可点：进条时给 #controls 上的 inert 不能留在原地，
   * 诊断层也不能还压着。命中测试为准，不看 class。 */
  const restored=await page.evaluate(()=>{
    const ctl=document.getElementById('controls'), b=document.getElementById('playBtn');
    const r=b.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return { inert:ctl.inert===true, aria:ctl.getAttribute('aria-hidden'), hit:hit&&(hit.id||hit.className), inPlay:!!hit&&(hit===b||b.contains(hit)) };
  });
  check('14-controls-interactive-after-strip',!restored.inert&&restored.aria!=='true'&&restored.inPlay,restored);
  check('14-strip-hidden-after-exit',await page.$eval('#stripLayout',e=>getComputedStyle(e).display==='none'));
  // 0尺寸保持上次布局；恢复为正确新预算，不让歌词恢复路径覆盖strip。
  await page.evaluate(()=>{document.getElementById('frame').style.display='none';}); await sleep(50);
  check('12-zero-does-not-commit',(await state()).layout==='long');
  await page.setViewport({width:640,height:128,deviceScaleFactor:1});
  await page.evaluate(()=>{document.getElementById('frame').style.display='';window.dispatchEvent(new Event('pageshow'));}); await sleep(450);
  check('12-restored-strip',(await state()).layout==='strip'&&!(await state()).motion,await state());
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.setViewport({width:1040,height:780,deviceScaleFactor:1});await sleep(60);
  await page.setViewport({width:640,height:128,deviceScaleFactor:1});await sleep(60);
  check('12-reduced-motion-settles',!(await state()).motion&&(await state()).layout==='strip');
  check('12-hidden-full-lyrics-no-loop',await page.evaluate(()=>!window.__playerDebug.lyricFlowState().raf));
  const sampleCount=(await state()).samples;
  for(const width of [620,600,640]) {await page.setViewport({width,height:128,deviceScaleFactor:1});await sleep(35);}
  check('07-no-resample-on-resize',(await state()).samples===sampleCount,{sampleCount,now:await state()});
  // 封面是纯封面（用户点名去掉那颗没功能的角标）；按钮走仓库既有那套
  // （默认透明底 + 次级字色，悬停才起底/光环，按下缩放），不是自造的灰块。
  const styleCheck=await page.evaluate(()=>{
    const cover=document.getElementById('stripCover');
    const btn=document.getElementById('stripPlay');
    const aux=document.getElementById('stripMode');
    const cs=getComputedStyle(aux);
    const tr=document.getElementById('stripTransport')||aux.parentElement;
    return {
      coverChildren:cover.children.length,
      coverBgImg:getComputedStyle(cover).backgroundImage!=='none',
      auxBg:cs.backgroundColor, auxRadius:cs.borderRadius,
      playRadius:getComputedStyle(btn).borderRadius,
      transportBg:(()=>{const p=document.querySelector('.strip-controls .strip-transport');return p?getComputedStyle(p).backgroundColor:'n/a';})(),
      volumeBg:(()=>{const p=document.querySelector('.strip-volume');return p?getComputedStyle(p).backgroundColor:'n/a';})(),
      hoverRule:(()=>[...document.styleSheets].flatMap(sh=>{try{return [...sh.cssRules]}catch(e){return []}}).some(r=>r.selectorText&&/\.strip-btn:hover/.test(r.selectorText)&&/hv-surface-strong/.test(r.style.cssText)))(),
    };
  });
  trace('style '+JSON.stringify(styleCheck));
  check('01-cover-no-decorative-badge',styleCheck.coverChildren===0&&styleCheck.coverBgImg,styleCheck);
  check('03-buttons-house-style',/rgba?\(0, 0, 0, 0\)|transparent/.test(styleCheck.auxBg)&&styleCheck.playRadius==='50%'&&styleCheck.transportBg==='rgba(0, 0, 0, 0)'&&styleCheck.volumeBg==='rgba(0, 0, 0, 0)',styleCheck);
  check('03-buttons-hover-ring',styleCheck.hoverRule===true,styleCheck);

  // 悬停跟手：指针从 A 移到 B，A 必须不再命中（不能粘在旧图标上）；
  // 且每个按钮的 :hover 高亮由 CSS 原生负责，不靠 JS 每次移动重算。
  {
    await page.setViewport({width:640,height:128,deviceScaleFactor:1}); await sleep(80);
    await page.mouse.move(300,64); await sleep(140);
    const st=await geo();
    const pick=id=>st.controls.find(c=>c.id===id);
    const chain=()=>page.evaluate(()=>[...document.querySelectorAll(':hover')].map(e=>e.id).filter(Boolean));
    const pairs=[['stripMode','stripPrev'],['stripPrev','stripFav'],['stripFav','stripVolumeBtn'],['stripVolumeBtn','stripNext']];
    let ok=true, detail=[];
    for (const [A,B] of pairs) {
      const a=pick(A), b=pick(B);
      if (!a||!b) { ok=false; detail.push('missing '+A+'/'+B); continue; }
      await page.mouse.move(a.x+a.w/2,a.y+a.h/2); await sleep(120);
      const atA=await chain();
      await page.mouse.move(b.x+b.w/2,b.y+b.h/2); await sleep(160);
      const atB=await chain();
      const stuckA=atB.indexOf(A)>=0, onB=atB.indexOf(B)>=0;
      if (stuckA||!onB||atA.indexOf(A)<0) { ok=false; }
      detail.push({A,B,atA,atB,stuckA,onB});
    }
    check('03-hover-follows-pointer',ok,detail);
  }

  // 轴线：歌词与控件共用「自由区中线」（条右缘-10 与身份区右缘+12 的中点），
  // 短内容居中在该轴；宽度不足时退回靠左紧接身份区。控件同行内不重叠。
  const axis=await page.evaluate(()=>({css:getComputedStyle(document.getElementById('stripLayout')).getPropertyValue('--strip-axis').trim()}));
  for (const width of [1040,640,480]) {
    await page.setViewport({width,height:128,deviceScaleFactor:1}); await sleep(70);
    await page.mouse.move(1,127); await page.evaluate(()=>document.activeElement?.blur()); await sleep(30);
    /* 轴线 = 条中线（用户拍板）。左边界恒 136，右留白由 JS 解成 136 → 盒与条同轴；
     * 窄容器才收右留白（轴右偏），<480 另走左对齐。 */
    const m=await page.evaluate(()=>{
      const bar=document.getElementById('stripBar').getBoundingClientRect();
      const cx=document.getElementById('stripControls').getBoundingClientRect();
      const idr=document.getElementById('stripIdentity').getBoundingClientRect();
      return { barMid:(bar.left+bar.right)/2, barRight:bar.right, ctlL:cx.left, ctlR:cx.right, idRight:idr.right, right:getComputedStyle(document.getElementById('stripLayout')).getPropertyValue('--strip-right').trim() };
    });
    const ctlMid=(m.ctlL+m.ctlR)/2;
    const centered=Math.abs(ctlMid-m.barMid)<=2;
    /* 装得下 → 必须落在条中线；装不下（宽度不足）→ 允许贴左紧接身份区，但不得越出条右缘。 */
    check(`01-axis-on-bar-center-${width}`,centered||(m.ctlL<=m.idRight+13&&m.ctlR<=m.barRight+1),{...m,ctlMid,centered});
    check(`01-controls-clear-of-identity-${width}`,m.ctlL>=m.idRight+12,{...m,ctlMid});
  }
  // 疏密分档：宽→10px，中→8px，窄（<480）→4px 且靠左不居中。
  const readGap=()=>page.evaluate(()=>{const cs=getComputedStyle(document.getElementById('stripControls'));const r=document.getElementById('stripControls').getBoundingClientRect();
    const bar=document.getElementById('stripBar').getBoundingClientRect();
    return {gap:cs.gap,justify:cs.justifyContent,small:document.getElementById('stripLayout').dataset.small,fits:r.right<=bar.right+0.5&&r.left>=bar.left-0.5};});
  await page.setViewport({width:312,height:128,deviceScaleFactor:1}); await sleep(80);
  const gapNarrow=await readGap();
  check('03-gap-narrow-compact',gapNarrow.small==='1'&&gapNarrow.gap==='4px'&&gapNarrow.fits,gapNarrow);
  await page.setViewport({width:520,height:128,deviceScaleFactor:1}); await sleep(80);
  const gapMid=await readGap();
  check('03-gap-mid-8',gapMid.small==='0'&&gapMid.gap==='8px'&&gapMid.justify==='center',gapMid);
  await page.setViewport({width:1040,height:128,deviceScaleFactor:1}); await sleep(80);
  const gapWide=await readGap();
  check('03-gap-wide-10',gapWide.gap==='10px'&&gapWide.justify==='center',gapWide);
  // 按压反馈：:active 必须是缩放/换底之一，不是「点了毫无反应」。
  const press=await page.evaluate(()=>{
    const cs=[...document.styleSheets].flatMap(sh=>{try{return [...sh.cssRules]}catch(e){return []}}).filter(r=>r.selectorText&&/strip-(btn|cover)/.test(r.selectorText)&&/:active/.test(r.selectorText));
    return cs.map(r=>r.selectorText+' {'+r.style.cssText+'}');
  });
  check('03-press-feedback-defined',press.length>=2&&press.some(r=>/scale\(/.test(r)),press);
  // 真实按下：几何要变（用 CDP 按住不放地量）。
  await page.setViewport({width:640,height:128,deviceScaleFactor:1}); await sleep(70);
  await page.mouse.move(1,127); await page.evaluate(()=>document.activeElement?.blur()); await sleep(30);
  await page.mouse.move(300,64); await sleep(40);
  const hot=await geo();
  const target=hot.controls.find(c=>c.id==='stripPlay');
  // 按压反馈测试前必须退出 reduced-motion（那档按约定把 scale 关掉，测不到会假红）。
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
  await page.setViewport({width:640,height:128,deviceScaleFactor:1}); await sleep(80);
  const btnTf=()=>page.evaluate((x,y)=>{const b=document.getElementById('stripPlay');const hit=document.elementFromPoint(x,y);return {tf:getComputedStyle(b).transform,hit:hit&&(hit.id||hit.className),hot:document.getElementById('stripLayout').dataset.hot};},target.x+target.w/2,target.y+target.h/2);
  const before=await btnTf();
  await page.mouse.move(target.x+target.w/2,target.y+target.h/2); await page.mouse.down(); await sleep(120);
  const during=await btnTf();
  await page.mouse.up(); await sleep(220);
  const after=await btnTf();
  const scaleOf=t=>{const m=/\(([\d.]+)/.exec(String(t));return m?+m[1]:1;};
  check('03-press-feedback-visible',scaleOf(before.tf)===1&&scaleOf(during.tf)<0.97&&scaleOf(after.tf)>0.99,{before:before.tf,during:during.tf,after:after.tf});
  await page.mouse.move(1,127); await page.evaluate(()=>document.activeElement?.blur()); await sleep(40);

  fs.writeFileSync(path.join(dir,'geometry.json'),JSON.stringify({geometry,frames},null,2));
  await page.close();
  // 空列表/未知时长保持完整骨架且不会出现NaN或假词。
  await fetch(`${BASE}${API}/__fixture/reset?mode=empty&appSurfaceSession=fake-ticket`);
  const empty=await newPage();await empty.setViewport({width:360,height:104,deviceScaleFactor:1});
  await empty.goto(`${UI_BASE}/standalone.html?appSurfaceSession=fake-ticket`,{waitUntil:'domcontentloaded'});
  await empty.waitForFunction(()=>window.__playerDebug);await sleep(250);
  check('06-empty-stable',await empty.evaluate(()=>{const s=document.getElementById('stripSeek');return s.disabled&&document.getElementById('stripLyric').textContent===''&&document.getElementById('stripBar').style.getPropertyValue('--strip-fill')==='0.000%'&&document.getElementById('stripTotal').textContent==='--:--';}));
  await empty.screenshot({path:path.join(dir,'empty-360x104.png')});await empty.close();
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
}

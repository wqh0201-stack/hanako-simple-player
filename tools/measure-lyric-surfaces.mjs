import fs from 'node:fs';
import path from 'node:path';

// 黑白图只定位实际 DOM 字形的覆盖率；fill/stroke RGB 均从未改色的 rendered PNG 取。
// 不把声明色、Canvas 重画的字体或生产背景模型当成真实像素。
const hideInk = '.strip-lyric,.lyric-text,.lyric-line{color:transparent!important;-webkit-text-fill-color:transparent!important;-webkit-text-stroke-width:0!important;text-shadow:none!important}';
const maskCSS = (selector, stroke = false) => 'html,body{background:#000!important}body *{visibility:hidden!important}'
  + selector + '{visibility:visible!important;background:none!important;box-shadow:none!important;'
  + 'color:' + (stroke ? '#000' : '#fff') + '!important;-webkit-text-fill-color:' + (stroke ? '#000' : '#fff')
  + '!important;-webkit-text-stroke-color:#fff!important;text-shadow:none!important;'
  + (stroke ? '' : '-webkit-text-stroke-width:0!important;') + '}';

const shadowMaskCSS = selector => 'html,body{background:#000!important}body *{visibility:hidden!important}'
  + ':root{--lyric-separation-color:#fff!important}' + selector
  + '{visibility:visible!important;background:none!important;box-shadow:none!important;color:transparent!important;'
  + '-webkit-text-fill-color:transparent!important;-webkit-text-stroke-width:0!important;text-shadow:var(--lyric-separation-shadow,none)!important}';

export function scoreSoftShadow(surface) {
  const lum=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const shadow=surface.shadowInk&&surface.shadowInk.rgb,shadowFill=shadow?contrast(shadow,surface.foreground):0;
  const samples=surface.pixels.map(p=>({...p,luminance:lum(p.rgb),fillContrast:contrast(surface.foreground,p.rgb),
    shadowContrast:shadow?contrast(shadow,p.rgb):0,effective:Math.max(contrast(surface.foreground,p.rgb),shadow?contrast(shadow,p.rgb):0)}));
  return {name:surface.name,fill:surface.foreground,shadow,shadowFill,samples,
    minimumFill:Math.min(...samples.map(p=>p.fillContrast)),minimumEffective:Math.min(...samples.map(p=>p.effective)),
    pass:samples.length>0&&samples.every(p=>surface.name==='vertical'&&p.luminance<.175?p.fillContrast>=3:p.effective>=4.5&&shadowFill>=3)};
}

export async function captureLyricInk(page, dir, name, selector, rectSelector = selector) {
  const style = await page.addStyleTag({ content:'/* pixel probe */' });
  const images = {};
  try {
    const strokeRule = await page.$eval(selector, el => { const s=getComputedStyle(el);
      return {color:s.webkitTextStrokeColor,width:s.webkitTextStrokeWidth,paintOrder:s.paintOrder,glow:s.textShadow,
        separation:s.getPropertyValue('--lyric-separation-shadow').trim()}; });
    const rect = await page.$eval(rectSelector, (el) => {
      const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height };
    });
    if (!(rect.width>0&&rect.height>0)) throw new Error('Lyric sample is not laid out: '+name+' '+JSON.stringify(rect));
    for (const [kind, css] of [['rendered',''], ['background',hideInk], ['fill-mask',maskCSS(selector)], ['stroke-mask',maskCSS(selector,true)], ['shadow-mask',shadowMaskCSS(selector)]]) {
      await style.evaluate((node, css) => { node.textContent = css; }, css);
      const png = await page.screenshot({ encoding:'base64' });
      images[kind] = png;
      fs.writeFileSync(path.join(dir, name + '-' + kind + '.png'), Buffer.from(png,'base64'));
    }
    return await page.evaluate(async ({ images, name, rect, strokeRule }) => {
      const decoded = {};
      for (const [key, png] of Object.entries(images)) {
        const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0);
        decoded[key] = { data:ctx.getImageData(0,0,canvas.width,canvas.height).data, width:canvas.width, height:canvas.height };
      }
      const full = decoded.rendered, rgbAt = (image,x,y) => {
        const i = (y * image.width + x) * 4; return [...image.data.slice(i,i+3)];
      };
      const ink = (kind) => {
        const mask = decoded[kind], fillMask=decoded['fill-mask']; let maximum = 0;
        const eligible=i=>kind!=='shadow-mask'||fillMask.data[i]<=1;
        for (let i=0;i<mask.data.length;i+=4) if(eligible(i))maximum = Math.max(maximum,mask.data[i]);
        if (!maximum) return null; // 删除描边的反向场景应该走到这里，而不是伪造一个 stroke RGB。
        const modes = new Map(); let pixels = 0;
        for (let y=0;y<mask.height;y++) for (let x=0;x<mask.width;x++) {
          if (!eligible((y*mask.width+x)*4)||mask.data[(y*mask.width+x)*4] < maximum-1) continue;
          const rgb = rgbAt(full,x,y), key = rgb.join(','); pixels++;
          const hit = modes.get(key) || { rgb,x,y,count:0 }; hit.count++; modes.set(key,hit);
        }
        const mode = [...modes.values()].sort((a,b)=>b.count-a.count)[0];
        return { ...mode, pixels, maximumCoverage:maximum/255, source:name+'-rendered.png' };
      };
      const fillInk = ink('fill-mask'), strokeInk = ink('stroke-mask'), shadowInk=ink('shadow-mask'), pixels=[];
      if (!fillInk) throw new Error('No rendered fill core: '+name);
      for (let row=0;row<5;row++) for (let x=Math.ceil(rect.x);x<Math.floor(rect.x+rect.width);x++) {
        const y=Math.round(rect.y+(row+.5)/5*Math.min(rect.height,54));
        if (x>=0 && y>=0 && x<full.width && y<full.height) pixels.push({x,y,rgb:rgbAt(decoded.background,x,y)});
      }
      return { name, strokeRule, viewport:{width:full.width,height:full.height}, foreground:fillInk.rgb,
        stroke:strokeInk && strokeInk.rgb, fillInk,strokeInk,shadowInk,inkKind:shadowInk?'soft-shadow':strokeInk?'stroke':'fill-only',rect,pixels };
    }, { images,name,rect,strokeRule });
  } finally { await style.evaluate(node=>node.remove()); }
}

// 对两行/省略场景把纯绘制 clip-margin 扩大作参考；盒模型与 line-clamp 不变。
export async function measureLyricClip(page, dir, name, sourceSelector, text) {
  await page.$eval(sourceSelector,(source,text)=>{const probe=source.cloneNode(false);probe.id='lyricInkClipProbe';probe.textContent=text;
    Object.assign(probe.style,{position:'absolute',left:'0',top:'50%',transform:'translateY(-50%)'});source.parentNode.appendChild(probe);},text);
  const selector='#lyricInkClipProbe';
  const style = await page.addStyleTag({content:'/* clip probe */'}), images=[];
  try {
    const geometry = () => page.$eval(selector, el=> {
      const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
      return {x:r.x,y:r.y,width:r.width,height:r.height,overflow:cs.overflow,margin:cs.overflowClipMargin,
        stroke:cs.webkitTextStrokeWidth,clamp:cs.webkitLineClamp};
    });
    const before=await geometry();
    const white=maskCSS(selector).replace('-webkit-text-stroke-width:0!important;','');
    for (const expanded of [false,true]) {
      await style.evaluate((node,css)=>{node.textContent=css;},white+(expanded?selector+'{overflow-clip-margin:8px!important;clip-path:inset(0 -8px)!important}':''));
      const png=await page.screenshot({encoding:'base64'});images.push(png);
      fs.writeFileSync(path.join(dir,name+(expanded?'-reference':'-clip')+'.png'),Buffer.from(png,'base64'));
    }
    const after=await geometry();
    // 柔影单独记录，不替换旧字形裁切断言，也不把柔影冒充实体描边。
    for(const expanded of [false,true]) {
      await style.evaluate((node,css)=>{node.textContent=css;},shadowMaskCSS(selector)
        +(expanded?selector+'{overflow-clip-margin:8px!important;clip-path:inset(0 -8px)!important}':''));
      const png=await page.screenshot({encoding:'base64'});images.push(png);
      fs.writeFileSync(path.join(dir,name+(expanded?'-shadow-reference':'-shadow-clip')+'.png'),Buffer.from(png,'base64'));
    }
    const result=await page.evaluate(async ({images,before})=> {
      const data=[];let width=0;
      for(const png of images){const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();
        const c=document.createElement('canvas');c.width=img.width;c.height=img.height;width=c.width;const x=c.getContext('2d');x.drawImage(img,0,0);data.push(x.getImageData(0,0,c.width,c.height).data);}
      let lost=0,reference=0;
      for(let i=0;i<data[0].length;i+=4){if(data[1][i]>64)reference++;if(data[1][i]>64&&data[0][i]+16<data[1][i])lost++;}
      let outsideRows=0,verticalEdge=0;
      for(let i=0;i<data[0].length;i+=4)if(data[0][i]>64){const y=Math.floor(i/4/width);
        if(y<Math.floor(before.y)||y>=Math.ceil(before.y+before.height))outsideRows++;
        if(y===Math.floor(before.y)||y===Math.ceil(before.y+before.height)-1)verticalEdge++;}
      let shadowLost=0,maximumMissing=0,shadowBorder=0;
      for(let i=0;i<data[2].length;i+=4){const diff=data[3][i]-data[2][i];maximumMissing=Math.max(maximumMissing,diff);if(diff>16)shadowLost++;
        const y=Math.floor(i/4/width);if(data[0][i]<=1&&(y===Math.ceil(before.y)||y===Math.floor(before.y+before.height)-1))shadowBorder=Math.max(shadowBorder,data[2][i]);}
      return {lost,reference,outsideRows,verticalEdge,shadowClip:{shadowLost,maximumMissing,verticalBorderOpacity:shadowBorder/255}};
    },{images,before});
    return {...result,before,after};
  } finally {await style.evaluate(node=>node.remove());await page.$eval(selector,node=>node.remove());}
}

export async function measureLyricSurfaces(page, dir) {
  const originalViewport=page.viewport(),results=[];
  let original=null;
  const settle=(strip)=>page.waitForFunction(strip=>{
    const d=window.__playerDebug,p=document.getElementById('player'),context=document.querySelector('.strip-context');
    const mode=p.getAttribute('data-layout')==='strip',font=d.stripLyricFontState();
    return mode===strip&&!d.stripState().motion&&document.getElementById('layoutBackdropGhost').hidden
      &&(!strip||font&&font.width===Math.floor(context.getBoundingClientRect().width));
  },{timeout:3000},strip);
  try {
    await page.evaluate(()=>window.__playerDebug.pauseAll());
    await page.setViewport({width:720,height:128,deviceScaleFactor:1});await page.mouse.move(1,127);await settle(true);
    original=await page.$eval('#stripBar',bar=>({style:bar.getAttribute('style'),progress:bar.getAttribute('data-progress')}));
    for(const fill of [0,50,100]) {
      await page.$eval('#stripBar',(bar,fill)=>{bar.style.setProperty('--strip-fill',fill+'%');bar.setAttribute('data-progress',fill===0?'empty':fill===100?'full':'partial');},fill);
      results.push(await captureLyricInk(page,dir,'strip-'+fill,'#stripLyric','.strip-lyric-line'));
    }
    // 实际 fill 像素本身作为底色：旧的单 fill 判据必败，描边必须真正出现在 rendered PNG。
    await page.evaluate(rgb=> {
      const probe=document.getElementById('stripLyric').cloneNode(false);probe.id='lyricStrokeRegression';
      probe.textContent='描边让文字离开同色背景';
      Object.assign(probe.style,{position:'absolute',left:'0',top:'50%',transform:'translateY(-50%)',zIndex:'3',backgroundColor:'rgb('+rgb.join(',')+')'});
      document.querySelector('.strip-lyric-line').appendChild(probe);
    },results[0].foreground);
    let regression;
    try {
      await page.$eval('#lyricStrokeRegression',el=>{el.style.setProperty('-webkit-text-stroke-width','0px','important');
        el.style.setProperty('--lyric-separation-shadow','none');});
      const before=await captureLyricInk(page,dir,'regression-without-stroke','#lyricStrokeRegression');
      await page.$eval('#lyricStrokeRegression',el=>{el.style.removeProperty('-webkit-text-stroke-width');el.style.removeProperty('--lyric-separation-shadow');});
      const after=await captureLyricInk(page,dir,'regression-with-stroke','#lyricStrokeRegression');
      regression={before,after};
    } finally {await page.$eval('#lyricStrokeRegression',el=>el.remove());}
    await page.setViewport({width:465,height:930,deviceScaleFactor:1});await settle(false);
    results.push(await captureLyricInk(page,dir,'vertical','.lyric-line.is-current .lyric-text'));
    // 独立柔影口径：stroke仍如实为null，不为旧硬描边断言伪造stroke字段。
    fs.writeFileSync(path.join(dir,'soft-shadow-surfaces.json'),JSON.stringify({
      policy:'strip effective>=4.5 && shadow/fill>=3; vertical dark fill>=3 user-approved, not 4.5 fix',
      surfaces:results.map(scoreSoftShadow),regression:{before:scoreSoftShadow(regression.before),after:scoreSoftShadow(regression.after)}
    },null,2));
    return {surfaces:results,regression};
  } finally {
    await page.setViewport(originalViewport);
    if(original)await page.$eval('#stripBar',(bar,original)=>{
      for(const [attr,value] of [['style',original.style],['data-progress',original.progress]])if(value===null)bar.removeAttribute(attr);else bar.setAttribute(attr,value);
    },original);
  }
}

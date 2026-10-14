for (const damping of [.972,1]) {
  const cols=97,rows=160;let field=new Float32Array(cols*rows),prev=new Float32Array(cols*rows),peak=0,count=0;
  for(let frame=0;frame<540;frame++){
    if(frame%26===0){count++;const nx=.23+Math.sin(count*1.3)*.09,ny=.48+Math.cos(count*.9)*.14,x=nx*(cols-1),y=ny*(rows-1),r=2.2;
      for(let j=Math.max(1,Math.floor(y)-6);j<Math.min(rows-1,Math.ceil(y)+6);j++)for(let i=Math.max(1,Math.floor(x)-6);i<Math.min(cols-1,Math.ceil(x)+6);i++)field[j*cols+i]+=Math.exp(-((i-x)**2+(j-y)**2)/(r*r))*6.5;
    }
    let energy=0;for(let y=1;y<rows-1;y++)for(let x=1;x<cols-1;x++){const i=y*cols+x;const v=((field[i-1]+field[i+1]+field[i-cols]+field[i+cols])*.5-prev[i])*damping;prev[i]=v;energy+=v*v;}
    const swap=prev;prev=field;field=swap;peak=Math.max(peak,energy/(cols*rows));
  } console.log({damping,peak});
}

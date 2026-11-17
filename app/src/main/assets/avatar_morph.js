/* Offline, transparent 2D artwork deformation.
 * Visual trend only: circumference values cannot reconstruct anatomy.
 */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const REFERENCE={shoulder_cm:112.1,chest_cm:90.2,waist_cm:84,
   hip_cm:93,upper_arm_cm:27.5,thigh_cm:53.9,calf_cm:39.5};
 let selectedDate="",measures={};
 const bound=(x,a,b)=>Math.max(a,Math.min(b,x));
 function ratio(key){
  const value=Number(measures[key]);
  const baseline=REFERENCE[key];
  if(!Number.isFinite(value)||value<=0)return 1;
  return bound(value/baseline,.88,1.12);
 }
 function scaleAt(position){
  const knots=[
   [0,1],[.21,1],
   [.285,1+(ratio("shoulder_cm")-1)*.55+(ratio("upper_arm_cm")-1)*.20],
   [.345,1+(ratio("chest_cm")-1)*.85],
   [.435,1+(ratio("waist_cm")-1)*.88],
   [.535,1+(ratio("hip_cm")-1)*.82],
   [.645,1+(ratio("thigh_cm")-1)*.7],
   [.76,1+(ratio("calf_cm")-1)*.65],
   [.89,1],[1,1]
  ];
  for(let i=1;i<knots.length;i++){
   if(position>knots[i][0])continue;
   const [lo,sv]=knots[i-1],[hi,ev]=knots[i];
   let t=bound((position-lo)/(hi-lo),0,1);
   t=t*t*(3-2*t);return bound(sv+(ev-sv)*t,.89,1.11);
  }
  return 1;
 }
 function render(){
  const img=$("avatarPicture"),canvas=$("avatarWarpCanvas"),
        container=$("avatarFrame"),toggle=$("bodyWarpEnabled");
  if(!img||!canvas||!container||!toggle)return;
  const enabled=toggle.checked&&selectedDate&&img.complete&&img.naturalWidth>0&&img.naturalHeight>0;
  canvas.hidden=!enabled;
  img.style.visibility=enabled?"hidden":"visible";
  if(!enabled)return;
  const cw=container.clientWidth,ch=container.clientHeight;
  if(cw<=0||ch<=0)return;
  const pixelRatio=Math.min(2,window.devicePixelRatio||1);
  canvas.width=Math.round(cw*pixelRatio);
  canvas.height=Math.round(ch*pixelRatio);
  const ctx=canvas.getContext("2d");
  if(!ctx){img.style.visibility="visible";canvas.hidden=true;return}
  ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
  ctx.clearRect(0,0,cw,ch);
  const sw=img.naturalWidth,sh=img.naturalHeight;
  const zoom=Math.min(cw/sw,ch/sh),baseW=sw*zoom,baseH=sh*zoom;
  const yStart=(ch-baseH)/2;
  // Every band is 2 source pixels high; overlap conceals horizontal seams.
  for(let y=0;y<sh;y+=2){
   const sourceHeight=Math.min(2,sh-y);
   const width=baseW*scaleAt((y+sourceHeight/2)/sh);
   ctx.drawImage(img,0,y,sw,sourceHeight,(cw-width)/2,
     yStart+y*zoom-.25,width,sourceHeight*zoom+.50);
  }
  const waistPercent=Math.round((ratio("waist_cm")-1)*100);
  $("bodyMorphLegend").textContent="按 "+selectedDate+" 围度调整二维人物轮廓（腰部相对 4 月 15 日 "+
   (waistPercent>0?"+":"")+waistPercent+"%）。这只是视觉模拟，不是人体扫描。";
 }
 $("bodyWarpEnabled")?.addEventListener("change",render);
 $("avatarPicture")?.addEventListener("load",render);
 window.addEventListener("resize",()=>requestAnimationFrame(render));
 window.BodyTraceMorph={
  set(date,fields){selectedDate=date||"";measures=Object.assign({},fields||{});
   requestAnimationFrame(render)},
  redraw:render
 };
})();

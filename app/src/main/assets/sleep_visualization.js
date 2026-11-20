/* Local full-night sound explorer. Inspired by the UX of wavesurfer.js and
 * Audacity, with no third-party code or network playback dependencies.
 * Dense ~8h data is reduced to screen pixels on Canvas; never render 28K DOM nodes.
 * The curves are 1-second RMS/peak ENVELOPES, not sample-rate waveforms.
 */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const canvas=$("sleepWaveCanvas"),panel=$("sleepVisualization");
 const context=canvas.getContext("2d");
 let result=null,windowStart=0,windowSpan=0,cursor=-1,paintPending=false;
 const COLORS={background:"#102127",peak:"#718ca7",rms:"#64d4ab",
  grid:"#33505a",event:"#ff8f82",text:"#9bb7b8",threshold:"#dfad6e"};
 const pad=n=>String(Math.floor(n)).padStart(2,"0");
 const relative=t=>{
  const n=Math.max(0,Math.floor(t));
  return pad(Math.floor(n/3600))+":"+pad(Math.floor(n%3600/60))+":"+pad(n%60);
 };
 const stamp=sec=>{
  if(!result)return relative(sec);
  if(result.date_basis==="imported_at")return "+"+relative(sec);
  return new Date(Number(result.started_ms)+sec*1000)
   .toLocaleTimeString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false,
    hour:"2-digit",minute:"2-digit",second:"2-digit"});
 };
 const total=()=>Array.isArray(result?.levels_dbfs)?result.levels_dbfs.length:0;
 const rms=()=>result?.levels_dbfs||[];
 const peaks=()=>result?.peak_levels_dbfs||[];
 const events=()=>Array.isArray(result?.events)?result.events:[];
 const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
 function metrics(){
  const levels=rms();
  if(!levels.length)return;
  const sorted=levels.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length)return;
  const percentile=p=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))];
  const active=levels.filter(v=>v>=result.threshold_dbfs).length;
  const greatest=events().reduce((n,e)=>Math.max(n,Number(e.active_sec)||0),0);
  const cells=[
   ["候选声音",events().length+" 段","满足持续时间的事件"],
   ["超阈值",relative(active),"含短暂干扰声"],
   ["安静背景 P10",percentile(.1).toFixed(1)+" dBFS","仅相对音量"],
   ["典型响度 P50",percentile(.5).toFixed(1)+" dBFS","整晚中位数"],
   ["偏高响度 P95",percentile(.95).toFixed(1)+" dBFS","整晚95百分位"],
   ["最长候选",relative(greatest),"阈值以上累计秒数"]
  ];
  const root=$("sleepSoundStats");root.replaceChildren();
  for(const [name,value,subtitle] of cells){
   const item=document.createElement("div");item.className="sleep-sound-stat";
   const label=document.createElement("small");label.textContent=name;
   const strong=document.createElement("strong");strong.textContent=value;
   const sub=document.createElement("small");sub.textContent=subtitle;
   item.append(label,strong,sub);root.append(item);
  }
 }
 function schedule(){
  if(paintPending)return;
  paintPending=true;
  requestAnimationFrame(()=>{paintPending=false;draw();});
 }
 function draw(){
  if(!result||!total())return;
  const bounds=canvas.getBoundingClientRect();
  const width=Math.max(240,Math.round(bounds.width||320));
  const height=220,dpr=Math.min(3,window.devicePixelRatio||1);
  canvas.width=Math.round(width*dpr);
  canvas.height=Math.round(height*dpr);
  context.setTransform(dpr,0,0,dpr,0,0);
  const ctx=context;
  ctx.fillStyle=COLORS.background;ctx.fillRect(0,0,width,height);
  const left=36,right=width-10,top=16,bottom=height-30;
  const plotWidth=right-left;
  const plotHeight=bottom-top;
  const yMid=(top+bottom)/2;
  const amplitude=db=>clamp((Number(db)+90)/90,0,1)*plotHeight*.46;
  const xAt=sec=>left+(sec-windowStart)/windowSpan*plotWidth;
  // 1-second peak and RMS envelopes are aggregated per drawn pixel.
  // Work is O(seconds shown), independent of the original sample rate.
  const n=total();
  for(let px=0;px<plotWidth;px++){
   const a=Math.max(0,Math.floor(windowStart+px/plotWidth*windowSpan));
   const b=Math.min(n,Math.max(a+1,Math.ceil(windowStart+(px+1)/plotWidth*windowSpan)));
   let maxRms=-96,maxPeak=-96;
   for(let i=a;i<b;i++){
    const mean=Number(rms()[i]),peak=Number(peaks()[i]);
    if(Number.isFinite(mean))maxRms=Math.max(maxRms,mean);
    if(Number.isFinite(peak))maxPeak=Math.max(maxPeak,peak);
   }
   const peakH=amplitude(maxPeak),rmsH=amplitude(maxRms);
   ctx.fillStyle=COLORS.peak;ctx.globalAlpha=.65;
   ctx.fillRect(left+px,yMid-peakH,1,Math.max(1,peakH*2));
   ctx.globalAlpha=1;ctx.fillStyle=COLORS.rms;
   ctx.fillRect(left+px,yMid-rmsH,1,Math.max(1,rmsH*2));
  }
  // Event regions are drawn AFTER amplitude so candidates stay visible.
  ctx.fillStyle=COLORS.event;ctx.globalAlpha=.18;
  for(const event of events()){
   const first=Math.max(windowStart,Number(event.start_sec));
   const last=Math.min(windowStart+windowSpan,Number(event.end_sec));
   if(last<=first)continue;
   const startX=xAt(first),endX=xAt(last);
   ctx.fillRect(startX,top,Math.max(2,endX-startX),plotHeight);
  }
  ctx.globalAlpha=1;
  const th=amplitude(result.threshold_dbfs);
  ctx.strokeStyle=COLORS.threshold;ctx.setLineDash([5,4]);ctx.lineWidth=1;
  for(const y of [yMid-th,yMid+th]){
   ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle=COLORS.text;ctx.font="10px system-ui,sans-serif";
  ctx.textBaseline="middle";
  ctx.fillText("0 dBFS",2,top+4);
  ctx.fillText("-90",8,bottom-3);
  ctx.fillText("0",17,yMid);
  ctx.textBaseline="alphabetic";
  const labels=4;
  for(let i=0;i<=labels;i++){
   const sec=windowStart+windowSpan*i/labels,x=xAt(sec);
   ctx.strokeStyle=COLORS.grid;ctx.lineWidth=.7;
   ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
   ctx.fillStyle=COLORS.text;
   ctx.textAlign=i===0?"left":i===labels?"right":"center";
   ctx.fillText(stamp(sec),x,210);
  }
  ctx.textAlign="left";
  if(cursor>=windowStart&&cursor<=windowStart+windowSpan){
   const x=xAt(cursor);
   ctx.strokeStyle="#f3eee0";ctx.lineWidth=1.5;
   ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
   ctx.fillStyle="#f3eee0";ctx.beginPath();ctx.arc(x,top+4,3.5,0,Math.PI*2);ctx.fill();
  }
  updateZoomButtons();
 }
 function updateZoomButtons(){
  for(const button of document.querySelectorAll("[data-sleep-zoom]")){
   const v=button.dataset.sleepZoom;
   const selected=v==="all"?windowSpan===total():windowSpan===Number(v);
   button.classList.toggle("active",selected);
  }
 }
 function setSpan(seconds,focus){
  if(!total())return;
  windowSpan=clamp(seconds,1,total());
  const mid=Number.isFinite(focus)?focus:windowStart+windowSpan/2;
  windowStart=clamp(mid-windowSpan/2,0,Math.max(0,total()-windowSpan));
  schedule();
 }
 function moveSpan(direction){
  windowStart=clamp(windowStart+direction*windowSpan*.75,0,
   Math.max(0,total()-windowSpan));
  schedule();
 }
 function setCursor(sec){
  cursor=clamp(Math.round(sec),0,Math.max(0,total()-1));
  const level=rms()[cursor],pk=peaks()[cursor];
  $("sleepWaveSelection").textContent=stamp(cursor)+" · RMS "+
   (Number.isFinite(level)?Number(level).toFixed(1):"未知")+" dBFS"+
   " · 峰值 "+(Number.isFinite(pk)?Number(pk).toFixed(1):"未知")+" dBFS";
  $("sleepPlaySelection").disabled=false;
  $("sleepFocusSelection").disabled=false;
  schedule();
 }
 function plotHourBars(){
  const root=$("sleepHourlyActivity");root.replaceChildren();
  if(!result||!total())return;
  const seconds=total(),hourCount=Math.ceil(seconds/3600);
  let high=[];
  for(let h=0;h<hourCount;h++){
   let count=0;
   for(let i=h*3600;i<Math.min(seconds,(h+1)*3600);i++){
    if(rms()[i]>=result.threshold_dbfs)count++;
   }
   high.push(count);
  }
  const maximum=Math.max(1,...high);
  for(let i=0;i<hourCount;i++){
   const button=document.createElement("button");
   button.type="button";button.className="sleep-hour-block";
   button.setAttribute("aria-label","查看第"+(i+1)+"小时，超阈值"+high[i]+"秒");
   const label=document.createElement("small");
   label.textContent=stamp(i*3600).slice(0,5);
   const bar=document.createElement("div");bar.className="sleep-hour-bar";
   const fill=document.createElement("span");fill.style.height=(high[i]/maximum*100)+"%";
   bar.append(fill);
   const count=document.createElement("strong");
   count.textContent=high[i]+"s";
   button.append(label,bar,count);
   button.onclick=()=>{setSpan(Math.min(3600,seconds),Math.min(seconds-1,i*3600+1800));setCursor(Math.min(seconds-1,i*3600));};
   root.append(button);
  }
 }
 function update(evt){
  if(!evt||!Array.isArray(evt.levels_dbfs)||!evt.levels_dbfs.length){
   panel.hidden=true;result=null;return;
  }
  const same=result&&result.id===evt.id;
  result=evt;panel.hidden=false;
  if(!same){cursor=-1;windowStart=0;windowSpan=total();}
  else {
   windowSpan=Math.min(windowSpan,total());
   windowStart=clamp(windowStart,0,Math.max(0,total()-windowSpan));
  }
  if(evt.date_basis==="imported_at"){
   $("sleepVisualCaveat").textContent="该导入文件未填写录音开始日期，时间轴以 +HH:MM:SS 表示相对时间；不能据此推算真实夜间时刻。音量筛选不能确认打鼾。";
  }else{
   $("sleepVisualCaveat").textContent="时间轴以中国标准时间显示。音量筛选只定位候选声音，不能确认打鼾、呼吸暂停或睡眠分期。";
  }
  metrics();plotHourBars();schedule();
 }
 for(const zoom of document.querySelectorAll("[data-sleep-zoom]")){
  zoom.onclick=()=>{if(!result)return;
   const size=zoom.dataset.sleepZoom==="all"?total():Number(zoom.dataset.sleepZoom);
   setSpan(size,cursor>=0?cursor:windowStart+windowSpan/2);
  };
 }
 $("sleepPreviousWindow").onclick=()=>moveSpan(-1);
 $("sleepNextWindow").onclick=()=>moveSpan(1);
 canvas.addEventListener("click",evt=>{
  if(!result)return;
  const rect=canvas.getBoundingClientRect(),left=36,right=Math.max(37,rect.width-10);
  const x=clamp(evt.clientX-rect.left,left,right);
  const sec=windowStart+(x-left)/(right-left)*windowSpan;
  setCursor(sec);
 });
 $("sleepPlaySelection").onclick=()=>{
  if(!result||cursor<0)return;
  if(!window.BodyTraceNative?.sleepPlay)return;
  window.BodyTraceNative.sleepPlay(result.id,Math.max(0,cursor-3),15);
 };
 $("sleepFocusSelection").onclick=()=>{if(cursor>=0)setSpan(Math.min(600,total()),cursor);};
 window.BodyTraceSleepVisual={
  focus(start,end){
   if(!result)return;
   const mid=(Number(start)+Number(end))/2;
   setCursor(mid);
   setSpan(Math.min(600,total()),mid);
   panel.scrollIntoView({behavior:"smooth",block:"nearest"});
  },
  state:()=>({id:result?.id||"",seconds:total(),start:windowStart,
   span:windowSpan,cursor,events:events().length})
 };
 const priorReceive=window.bodyTraceReceive;
 window.bodyTraceReceive=function(evt){
  if(typeof priorReceive==="function")priorReceive(evt);
  if(evt?.type==="sleep_analysis")update(evt);
  else if(evt?.type==="sleep_status"&&!Array.isArray(evt?.sessions))update(null);
 };
 if(typeof ResizeObserver==="function")new ResizeObserver(schedule).observe(canvas);
 else window.addEventListener("resize",schedule);
})();

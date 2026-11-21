/* Interactive, cached one-second RMS/peak audio explorer.
 * Never load source PCM into WebView. Android keeps the original M4A and caches
 * one-second envelopes locally. Filtering and chart gestures are JS only.
 */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const canvas=$("sleepWaveCanvas"),panel=$("sleepVisualization");
 const context=canvas.getContext("2d");
 const COLORS={background:"#102127",peak:"#8297a9",rms:"#65d6b2",
  grid:"#334952",event:"#e87e8c",text:"#b1c9ce",threshold:"#ff536d"};
 const clamp=(v,low,high)=>Math.max(low,Math.min(high,v));
 const pad=n=>String(Math.floor(n)).padStart(2,"0");
 const relative=sec=>{
  const t=Math.max(0,Math.floor(sec));
  return pad(Math.floor(t/3600))+":"+pad(Math.floor(t%3600/60))+":"+pad(t%60);
 };
 let result=null,windowStart=0,windowSpan=0,cursor=-1,paintPending=false;
 const timeModeById=new Map();
 let timeAxisMode="relative";
 let playheadSeconds=-1,playheadActive=false,followPlayback=true;
 const axisById=new Map();
 let axisMin=-10,axisMax=25,backgroundDb=-40;
 function quantile(values,p){
  const list=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  return list.length?list[Math.floor((list.length-1)*p)]:null;
 }
 function initializeAxis(evt){
  const saved=axisById.get(evt.id);
  backgroundDb=Number.isFinite(Number(evt.background_dbfs))?
   Number(evt.background_dbfs):-40;
  if(saved){axisMin=saved.low;axisMax=saved.high;return;}
  // Global quantile range is computed ONCE for each recording.
  // Horizontal pinch/drag NEVER changes the Y axis.
  const p05=quantile(evt.levels_dbfs,.05);
  // Keep the locked Y axis relevant to the audible short-RMS curve.
  // Raw PCM peak outliers used to inflate the scale by 60-80 dB.
  const p995=quantile(evt.short_levels_dbfs||evt.levels_dbfs,.995);
  const lower=Math.min(-4,(p05??backgroundDb-5)-backgroundDb);
  const upper=Math.max(8,(p995??backgroundDb+12)-backgroundDb);
  axisMin=Math.floor((lower-2)/5)*5;
  axisMax=Math.ceil((upper+2)/5)*5;
  if(axisMax-axisMin<12)axisMax=axisMin+12;
  axisById.set(evt.id,{low:axisMin,high:axisMax});
 }
 function adjustAxis(low,high){
  if(!result||!Number.isFinite(low)||!Number.isFinite(high))return;
  const span=high-low;
  if(span<4||span>125)return;
  axisMin=low;axisMax=high;
  axisById.set(result.id,{low,high});
  schedule();
 }
 let lastTap={at:0,x:0},gesture=null,gestureHadMultiple=false;
 const pointers=new Map();
 const total=()=>Array.isArray(result?.levels_dbfs)?result.levels_dbfs.length:0;
 const rms=()=>result?.levels_dbfs||[];
 const peaks=()=>result?.peak_levels_dbfs||[];
 const shortRms=()=>Array.isArray(result?.short_levels_dbfs)&&
  result.short_levels_dbfs.length===rms().length?result.short_levels_dbfs:rms();
 const events=()=>Array.isArray(result?.events)?result.events:[];
 const aiMode=()=>result?.detection_mode==="ai"&&
  Array.isArray(result?.ai_snore_scores)&&result.ai_snore_scores.length===total();
 const aiScores=()=>aiMode()?result.ai_snore_scores:[];
 function hasRecordingStart(){
  return !!result&&result.date_basis!=="imported_at"&&
   Number.isFinite(Number(result.started_ms))&&Number(result.started_ms)>0;
 }
 function stamp(sec){
  if(timeAxisMode!=="clock"||!hasRecordingStart())return "+"+relative(sec);
  return new Date(Number(result.started_ms)+sec*1000).toLocaleTimeString(
   "zh-CN",{timeZone:"Asia/Shanghai",hour12:false,
    hour:"2-digit",minute:"2-digit",second:"2-digit"});
 }
 function updateTimeModeLabel(){
  $("sleepTimeMode").value=timeAxisMode;
  const basis=result?.date_basis;
  const warning=!hasRecordingStart()?
   "录制起点未知 · 可展开校正时间":
   timeAxisMode==="clock"&&basis==="media_date_unverified"?
    "媒体日期可能是结束时间":
   timeAxisMode==="clock"&&basis==="filename_inferred"?
    "开始时间由文件名推断":
   "";
  $("sleepTimeModeHint").textContent=warning;
  $("sleepTimeModeHint").hidden=!warning;
 }
 function setTimeMode(mode){
  if(mode==="clock"&&!hasRecordingStart()){
   timeAxisMode="relative";
  }else timeAxisMode=mode==="relative"?"relative":"clock";
  if(result)timeModeById.set(result.id,timeAxisMode);
  updateTimeModeLabel();
  refreshFilters();
  window.BodyTraceSleepRenderEvents?.();
 }
 function plotSize(){
  const width=Math.max(240,Math.round(canvas.getBoundingClientRect().width||320));
  return {width,left:42,right:width-12,top:15,bottom:174,
   plotWidth:width-54};
 }
 function secAt(x){
  const {left,plotWidth}=plotSize();
  return clamp(windowStart+(x-left)/plotWidth*windowSpan,0,total());
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
  const height=208,dpr=Math.min(3,window.devicePixelRatio||1);
  const deviceW=Math.round(width*dpr),deviceH=Math.round(height*dpr);
  if(canvas.width!==deviceW||canvas.height!==deviceH){
   canvas.width=deviceW;canvas.height=deviceH;
  }
  context.setTransform(dpr,0,0,dpr,0,0);
  const ctx=context,{left,right,top,bottom,plotWidth}=plotSize();
  const plotHeight=bottom-top,levels=rms(),pks=peaks(),shortLevels=shortRms();
  ctx.fillStyle=COLORS.background;ctx.fillRect(0,0,width,height);
  const yAt=db=>clamp(top+
   (axisMax-(Number(db)-backgroundDb))/(axisMax-axisMin)*plotHeight,top,bottom);
  const xAt=sec=>left+(sec-windowStart)/windowSpan*plotWidth;
  ctx.font="10px system-ui,sans-serif";
  ctx.textAlign="left";ctx.textBaseline="middle";
  const axisRange=axisMax-axisMin;
  const step=axisRange>70?20:axisRange>32?10:axisRange>16?5:2;
  for(let delta=Math.ceil(axisMin/step)*step;delta<=axisMax;delta+=step){
   const y=yAt(backgroundDb+delta);
   ctx.strokeStyle=COLORS.grid;ctx.lineWidth=.75;
   ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
   ctx.fillStyle=COLORS.text;
   ctx.fillText((delta>0?"+":"")+delta,4,y);
  }
  // Render the audio envelope first. Event highlights will be overlaid
  // ON THE SHORT-RMS CURVE instead of spanning the whole graph height.
  const threshold=Number(result.threshold_dbfs);
  for(let px=0;px<plotWidth;px++){
   const a=Math.max(0,Math.floor(windowStart+px/plotWidth*windowSpan));
   const b=Math.min(total(),Math.max(a+1,
    Math.ceil(windowStart+(px+1)/plotWidth*windowSpan)));
   let maxRms=-96,maxPeak=-96,maxShort=-96;
   for(let i=a;i<b;i++){
    const v=Number(levels[i]),pk=Number(pks[i]),sv=Number(shortLevels[i]);
    if(Number.isFinite(v))maxRms=Math.max(maxRms,v);
    if(Number.isFinite(pk))maxPeak=Math.max(maxPeak,pk);
    if(Number.isFinite(sv))maxShort=Math.max(maxShort,sv);
   }
   const x=left+px,ry=yAt(maxRms),py=yAt(maxPeak),sy=yAt(maxShort);
   ctx.fillStyle=COLORS.rms;ctx.globalAlpha=.22;
   ctx.fillRect(x,ry,1,bottom-ry);
   ctx.globalAlpha=.35;
   ctx.fillStyle=COLORS.peak;
   ctx.fillRect(x,py,1,Math.max(1,ry-py));
   ctx.globalAlpha=1;
   // Short RMS is the detector; peak is a faint diagnostic channel.
   ctx.fillStyle=aiMode()?"#e8b66f":
    maxShort>=threshold?COLORS.threshold:"#e8b66f";
   ctx.fillRect(x,sy,1,Math.max(2,ry-sy));
   // AI scores are available in the selection readout; no bottom score bars.
  }
  // Candidate ribbons follow the same short-RMS height used for the yellow
  // waveform. Leave the grey peak envelope and chart grid unobscured.
  // Expand subpixel events to 4 px visually only (not in stored time ranges).
  for(const event of events()){
   const a=Math.max(windowStart,Number(event.start_sec));
   const b=Math.min(windowStart+windowSpan,Number(event.end_sec));
   if(b<=a)continue;
   const xa=xAt(a),xb=xAt(b),actualWidth=xb-xa;
   const markWidth=Math.min(plotWidth,Math.max(4,actualWidth));
   const center=clamp((xa+xb)/2,left+markWidth/2,right-markWidth/2);
   const x=center-markWidth/2;
   const eventFirst=Math.max(0,Math.floor(a));
   const eventLast=Math.min(total(),Math.ceil(b));
   let topLevel=-96;
   for(let i=eventFirst;i<eventLast;i++){
    const v=Number(shortLevels[i]);
    if(Number.isFinite(v))topLevel=Math.max(topLevel,v);
   }
   const referenceY=yAt(topLevel);
   const baselineY=yAt(backgroundDb);
   // A narrow cap remains visible at full-night scale; NO top-to-bottom blocks.
   ctx.fillStyle="#ff6e81";ctx.globalAlpha=.94;
   ctx.fillRect(x,clamp(referenceY-1,top,bottom-2),markWidth,2);
   for(let px=Math.floor(x);px<Math.ceil(x+markWidth);px++){
    if(px<left||px>=right)continue;
    const secA=windowStart+(px-left)/plotWidth*windowSpan;
    const secB=windowStart+(px+1-left)/plotWidth*windowSpan;
    const first=clamp(Math.floor(Math.max(a,secA)),eventFirst,eventLast-1);
    const last=clamp(Math.max(first+1,Math.ceil(Math.min(b,secB))),first+1,eventLast);
    let shortMax=-96;
    for(let i=first;i<last;i++){
     const v=Number(shortLevels[i]);
     if(Number.isFinite(v))shortMax=Math.max(shortMax,v);
    }
    const sy=yAt(shortMax);
    const bandTop=Math.min(sy,baselineY);
    const bandHeight=Math.max(2,Math.abs(sy-baselineY));
    ctx.fillStyle="#f05c79";ctx.globalAlpha=.20;
    ctx.fillRect(px,bandTop,1,bandHeight);
    ctx.fillStyle="#ff6e81";ctx.globalAlpha=.96;
    ctx.fillRect(px,clamp(sy-1,top,bottom-2),1,2);
   }
  }
  ctx.globalAlpha=1;
  // A high-contrast horizontal RED reference, moving synchronously with slider.
  const thresholdY=yAt(threshold);
  if(!aiMode()){
  ctx.save();
  ctx.strokeStyle=COLORS.threshold;ctx.lineWidth=2;
  ctx.setLineDash([7,4]);ctx.beginPath();
  ctx.moveTo(left,thresholdY);ctx.lineTo(right,thresholdY);ctx.stroke();
  ctx.setLineDash([]);
  const offset=threshold-backgroundDb;
  const label="阈值 "+(offset>=0?"+":"")+offset.toFixed(1)+" dB";
  ctx.font="bold 11px system-ui,sans-serif";
  const labelWidth=ctx.measureText(label).width+10;
  const labelX=Math.max(left,Math.min(right-labelWidth,left+6));
  const labelY=clamp(thresholdY-22,top+2,bottom-19);
  ctx.fillStyle="#572b39";ctx.fillRect(labelX,labelY,labelWidth,17);
  ctx.fillStyle="#ffbdc7";ctx.textBaseline="middle";
  ctx.fillText(label,labelX+5,labelY+8);
  ctx.restore();
  }
  // Vertical grid / axes. Reduce labels on narrow phones to avoid collisions.
  const ticks=width<400?2:3;
  ctx.textBaseline="alphabetic";ctx.font="10px system-ui,sans-serif";
  for(let i=0;i<=ticks;i++){
   const time=windowStart+windowSpan*i/ticks,x=xAt(time);
   ctx.strokeStyle=COLORS.grid;ctx.lineWidth=.7;
   ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
   ctx.fillStyle=COLORS.text;
   ctx.textAlign=i===0?"left":i===ticks?"right":"center";
   // Whole-night view does not need seconds in every tick label.
   const label=stamp(time);
   ctx.fillText(windowSpan>=1800?label.slice(0,-3):label,x,196);
  }
  ctx.textAlign="left";
  if(cursor>=windowStart&&cursor<=windowStart+windowSpan){
   const x=xAt(cursor);
   ctx.strokeStyle="#ffe7b2";ctx.lineWidth=1.4;
   ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
   ctx.fillStyle="#ffe7b2";ctx.beginPath();ctx.arc(x,top+4,3.5,0,Math.PI*2);ctx.fill();
  }
  // Playback playhead has its own vivid red vertical cursor. Never move
  // the manual selection cursor to simulate time; native MediaPlayer owns it.
  if(playheadSeconds>=windowStart&&playheadSeconds<=windowStart+windowSpan){
   const x=xAt(playheadSeconds);
   ctx.save();ctx.globalAlpha=playheadActive?1:.70;
   ctx.strokeStyle="#0d1820";ctx.lineWidth=5;
   ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
   ctx.strokeStyle="#ff3557";ctx.lineWidth=2.8;
   ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
   ctx.fillStyle="#ff3557";ctx.beginPath();ctx.arc(x,top+5,5,0,Math.PI*2);ctx.fill();
   ctx.fillStyle="#fff4f4";ctx.beginPath();ctx.arc(x,top+5,1.8,0,Math.PI*2);ctx.fill();
   ctx.restore();
  }
  updateZoomButtons();
 }
 function updateZoomButtons(){
  for(const button of document.querySelectorAll("[data-sleep-zoom]")){
   const size=button.dataset.sleepZoom;
   const active=size==="all"?Math.abs(windowSpan-total())<.5:
    Math.abs(windowSpan-Number(size))<.5;
   button.classList.toggle("active",active);
  }
 }
 function setSpan(seconds,focus){
  if(!total())return;
  const oldSpan=windowSpan;
  const anchor=Number.isFinite(focus)?focus:
   (playheadSeconds>=0&&playheadActive?playheadSeconds:windowStart+oldSpan/2);
  windowSpan=clamp(Number(seconds),5,total());
  windowStart=clamp(anchor-windowSpan/2,0,Math.max(0,total()-windowSpan));
  schedule();
 }
 function moveSpan(direction){
  if(playheadActive)followPlayback=false;
  windowStart=clamp(windowStart+direction*windowSpan*.75,0,
   Math.max(0,total()-windowSpan));
  schedule();
 }
 function showCursor(sec){
  if(!result)return;
  cursor=clamp(Math.floor(sec),0,total()-1);
  if(cursor<windowStart||cursor>windowStart+windowSpan){
   windowStart=clamp(cursor-windowSpan*.5,0,Math.max(0,total()-windowSpan));
  }
  const value=Number(rms()[cursor]),short=Number(shortRms()[cursor]);
   const eligible=events().some(e=>cursor>=e.start_sec&&cursor<e.end_sec);
   const detector=Number.isFinite(short)?short:value;
   const delta=detector-backgroundDb;
   const datePrefix=timeAxisMode==="clock"&&hasRecordingStart()?
    new Date(Number(result.started_ms)+cursor*1000).toLocaleDateString(
     "zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit"})+" ":"";
   $("sleepWaveSelection").textContent=datePrefix+stamp(cursor)+
    (aiMode()?" · AI "+Number(aiScores()[cursor]).toFixed(3):
     " · "+(Number.isFinite(detector)?detector.toFixed(1):"未知")+" dBFS")+
    " · "+(eligible?"候选":"未命中")+
    (aiMode()?" · "+(Number.isFinite(detector)?detector.toFixed(1):"未知")+" dBFS":"");
  $("sleepPlaySelection").disabled=false;
  $("sleepFocusSelection").disabled=false;
  schedule();
 }
 function metrics(){
  const levels=rms();
  if(!levels.length)return;
  // The P20 reference was computed once on file load by sleep.js.
  // Slider changes must not sort tens of thousands of samples again.
  const isAI=aiMode();
  const active=isAI?aiScores().filter(v=>v>=Number(result.ai_score_threshold)).length:
   shortRms().filter(v=>v>=result.threshold_dbfs).length;
  const max=events().reduce((n,e)=>Math.max(n,Number(e.end_sec)-Number(e.start_sec)),0);
  const cells=[
   ["合格片段",events().length+" 段"],
   [isAI?"AI 命中时间":"超响度阈值比例",
    (100*active/levels.length).toFixed(1)+"%"],
   ["最长片段",relative(max)],
   ["本晚背景 P20",backgroundDb.toFixed(1)+" dBFS"]
  ];
  const root=$("sleepSoundStats");root.replaceChildren();
  for(const [name,value] of cells){
   const item=document.createElement("div");item.className="sleep-sound-stat";
   const label=document.createElement("small");label.textContent=name;
   const strong=document.createElement("strong");strong.textContent=value;
   item.append(label,strong);root.append(item);
  }
  const warning=$("sleepNoiseWarning");
  warning.hidden=isAI||active/levels.length<.90;
  if(!warning.hidden)warning.textContent=
   "阈值过低：整晚至少90%的短时RMS都超过红线；建议调高阈值。";
  const compact=$("sleepNoiseHint");
  compact.hidden=warning.hidden;
  if(!compact.hidden)compact.textContent="阈值过低，几乎整晚都超标，请调高红线";
  $("sleepQuickSummary").textContent=
   events().length+" 段 · "+(active/levels.length*100).toFixed(1)+
   (isAI?"% AI命中（非概率）":"% 超响度阈值");
 }
 function plotHourBars(){
  const root=$("sleepHourlyActivity");root.replaceChildren();
  if(!result||!total())return;
  const high=[],seconds=total(),hours=Math.ceil(seconds/3600);
  for(let h=0;h<hours;h++){
   let count=0;
   for(let t=h*3600;t<Math.min(seconds,(h+1)*3600);t++){
    if(aiMode()?Number(aiScores()[t])>=Number(result.ai_score_threshold):
     shortRms()[t]>=result.threshold_dbfs)count++;
   }
   high.push(count);
  }
  const max=Math.max(1,...high);
  for(let i=0;i<hours;i++){
   const btn=document.createElement("button");
   btn.type="button";btn.className="sleep-hour-block";
   btn.setAttribute("aria-label","查看第"+(i+1)+"小时，超阈值"+high[i]+"秒");
   const title=document.createElement("small");
   title.textContent=stamp(i*3600).slice(0,-3);
   const bar=document.createElement("div");bar.className="sleep-hour-bar";
   const fill=document.createElement("span");fill.style.height=(high[i]/max*100)+"%";bar.append(fill);
   const count=document.createElement("strong");count.textContent=high[i]+"s";
   btn.append(title,bar,count);
   btn.onclick=()=>{
    setSpan(Math.min(3600,total()),Math.min(total()-1,i*3600+1800));
    showCursor(Math.min(total()-1,i*3600));
   };
   root.append(btn);
  }
 }
 function refreshFilters(){
  if(!result)return;
  metrics();plotHourBars();schedule();
  if(cursor>=0)showCursor(cursor);
  $("sleepPreviousEvent").disabled=!events().length;
  $("sleepNextEvent").disabled=!events().length;
 }
 function update(evt){
  if(!evt||!Array.isArray(evt.levels_dbfs)||!evt.levels_dbfs.length){
   panel.hidden=true;result=null;return;
  }
  const same=result&&result.id===evt.id;
  result=evt;panel.hidden=false;
  if(!same){
   initializeAxis(evt);
   cursor=-1;playheadSeconds=-1;playheadActive=false;followPlayback=true;
   windowStart=0;windowSpan=total();
   // Clock time is the default when start time exists; never fabricate it
   // from imported_at. A user's per-recording toggle is retained in memory.
   timeAxisMode=hasRecordingStart()?
    (timeModeById.get(evt.id)||"clock"):"relative";
  }
  else{
   windowSpan=clamp(windowSpan,5,total());
   windowStart=clamp(windowStart,0,Math.max(0,total()-windowSpan));
  }
  updateTimeModeLabel();
  $("sleepVisualCaveat").textContent=aiMode()?
    "AI YAMNet 对每秒音频离线分类；模型得分可在点击时间点后查看，既不是概率也不是医学诊断。":
    "纵轴是相对本晚背景的 dB，而非校准声压 dB SPL；横轴可切换录制时钟或相对时长。";
  refreshFilters();
 }
 function playFromCursor(){
  if(!result)return;
  const now=cursor>=0?cursor:0;
  const skip=$("sleepSkipQuiet").checked;
  let ranges;
  if(skip){
   ranges=events().filter(e=>Number(e.end_sec)>now)
    .map(e=>[Math.floor(Math.max(Number(e.start_sec),now)),Math.ceil(e.end_sec)]);
   if(!ranges.length){
    $("sleepPlaybackStatus").textContent="当前游标之后没有满足筛选条件的片段";
    return;
   }
   if(ranges.length>3000)ranges=ranges.slice(0,3000);
  }else ranges=[[now,total()]];
  if(!window.BodyTraceNative?.sleepPlaySequence){
   $("sleepPlaybackStatus").textContent="请安装支持连续播放的新版 APK";
   return;
  }
  $("sleepPlaybackStatus").textContent=skip?"正在准备有效片段连续播放…":
   "正在从 "+stamp(now)+" 播放…";
  followPlayback=true;
  playheadSeconds=now;
  schedule();
  window.BodyTraceNative.sleepPlaySequence(result.id,JSON.stringify(ranges),skip);
 }
 function playEvent(index){
  const event=events()[index];
  if(!result||!event)return;
  showCursor(event.start_sec);
  followPlayback=true;
  playheadSeconds=Number(event.start_sec);
  setSpan(Math.min(windowSpan,600),event.start_sec);
  if(window.BodyTraceNative?.sleepPlaySequence){
   window.BodyTraceNative.sleepPlaySequence(result.id,
    JSON.stringify([[Math.floor(event.start_sec),Math.ceil(event.end_sec)]]),true);
  }else if(window.BodyTraceNative?.sleepPlay){
   window.BodyTraceNative.sleepPlay(result.id,Math.floor(event.start_sec),
    Math.min(180,Math.max(1,Math.ceil(event.end_sec-event.start_sec))));
  }
 }
 function moveEvent(direction){
  const list=events();
  if(!list.length)return;
  const origin=cursor>=0?cursor:(direction>0?-1:total());
  let index;
  if(direction>0){
   index=list.findIndex(e=>Number(e.start_sec)>origin);
   if(index<0)index=list.length-1;
  }else{
   index=list.length-1;
   while(index>0&&Number(list[index].start_sec)>=origin)index--;
  }
  playEvent(index);
 }
 $("sleepTimeMode").addEventListener("change",()=>{
  setTimeMode($("sleepTimeMode").value);
 });
 for(const zoom of document.querySelectorAll("[data-sleep-zoom]")){
  zoom.onclick=()=>{if(!result)return;
   const size=zoom.dataset.sleepZoom==="all"?total():Number(zoom.dataset.sleepZoom);
   setSpan(size,cursor>=0?cursor:windowStart+windowSpan/2);
  };
 }
 $("sleepPreviousWindow").onclick=()=>moveSpan(-1);
 $("sleepNextWindow").onclick=()=>moveSpan(1);
 $("sleepPlaySelection").onclick=playFromCursor;
 $("sleepFocusSelection").onclick=()=>{if(cursor>=0)setSpan(Math.min(600,total()),cursor);};
 $("sleepPreviousEvent").onclick=()=>moveEvent(-1);
 $("sleepNextEvent").onclick=()=>moveEvent(1);
 $("sleepSkipQuiet").addEventListener("change",()=>{
  $("sleepPlaybackStatus").textContent=$("sleepSkipQuiet").checked?
   "已启用跳过安静段：只连播满足阈值、持续时间、空隙规则的片段":
   "普通播放：从游标位置连续播放原录音";
 });
 // Pointer Events work in Android WebView and on desktop; avoid the native
 // scroll handler competing with pinch/drag (CSS touch-action:none).
 function localX(evt){return evt.clientX-canvas.getBoundingClientRect().left;}
 function resetGesture(){
  const pts=[...pointers.values()];
  if(pts.length===1)gesture={kind:"pan",x:pts[0].x,start:windowStart,moved:false};
  else if(pts.length>=2){
   const distanceX=Math.max(1,Math.abs(pts[0].x-pts[1].x));
   const distanceY=Math.max(1,Math.abs(pts[0].y-pts[1].y));
   const midX=(pts[0].x+pts[1].x)/2,midY=(pts[0].y+pts[1].y)/2;
   gesture={kind:"dual",mode:null,distanceX,distanceY,midX,midY,
    startYs:pts.map(p=>p.y),span:windowSpan,
    anchor:secAt(midX),low:axisMin,high:axisMax,moved:true};
  }else gesture=null;
 }
 canvas.addEventListener("pointerdown",evt=>{
  if(!result)return;
  canvas.setPointerCapture?.(evt.pointerId);
  pointers.set(evt.pointerId,{x:localX(evt),y:evt.clientY});
  if(pointers.size>=2)gestureHadMultiple=true;
  resetGesture();
 });
 canvas.addEventListener("pointermove",evt=>{
  if(!pointers.has(evt.pointerId)||!result)return;
  const p=pointers.get(evt.pointerId);
  p.x=localX(evt);p.y=evt.clientY;
  if(!gesture)return;
  if(pointers.size>=2&&gesture.kind==="dual"){
   const pts=[...pointers.values()];
   const midX=(pts[0].x+pts[1].x)/2,midY=(pts[0].y+pts[1].y)/2;
   const distanceX=Math.max(1,Math.abs(pts[0].x-pts[1].x));
   const distanceY=Math.max(1,Math.abs(pts[0].y-pts[1].y));
   const moveY=Math.abs(midY-gesture.midY),moveX=Math.abs(midX-gesture.midX);
   const diffX=Math.abs(distanceX-gesture.distanceX);
   const diffY=Math.abs(distanceY-gesture.distanceY);
   if(!gesture.mode){
    // Do not treat the FIRST finger's vertical move as a pinch. Wait for
    // BOTH fingers to move, then classify same-direction vs opposite-direction.
    const dyA=pts[0].y-gesture.startYs[0];
    const dyB=pts[1].y-gesture.startYs[1];
    const twoMoved=Math.abs(dyA)>6&&Math.abs(dyB)>6;
    if(twoMoved&&dyA*dyB>0&&moveY>8&&moveY>moveX)
     gesture.mode="vertical-pan";
    else if(twoMoved&&dyA*dyB<0&&diffY>12)
     gesture.mode="vertical-zoom";
    else if(diffX>8||moveX>10)gesture.mode="horizontal";
   }
   if(gesture.mode==="vertical-pan"){
    // Only an explicit two-finger vertical drag changes the dB axis.
    const dy=(midY-gesture.midY)/(plotSize().bottom-plotSize().top);
    const delta=dy*(gesture.high-gesture.low);
    adjustAxis(gesture.low+delta,gesture.high+delta);
   }else if(gesture.mode==="vertical-zoom"){
    // Vertical two-finger pinch changes the dB range, not time.
    const range=clamp((gesture.high-gesture.low)*
      gesture.distanceY/distanceY,4,125);
    const center=(gesture.high+gesture.low)/2;
    adjustAxis(center-range/2,center+range/2);
   }else if(gesture.mode==="horizontal"){
    const {left,plotWidth}=plotSize();
    windowSpan=clamp(gesture.span*gesture.distanceX/distanceX,5,total());
    windowStart=clamp(gesture.anchor-
      (midX-left)/plotWidth*windowSpan,0,Math.max(0,total()-windowSpan));
    schedule();
   }
  }else if(pointers.size===1&&gesture.kind==="pan"){
   const dx=p.x-gesture.x;
   if(Math.abs(dx)>=6)gesture.moved=true;
   if(gesture.moved){
    if(playheadActive)followPlayback=false;
    windowStart=clamp(gesture.start-dx/plotSize().plotWidth*windowSpan,
     0,Math.max(0,total()-windowSpan));
    schedule();
   }
  }
 });
 function pointerFinish(evt,cancelled){
  const p=pointers.get(evt.pointerId);
  if(!p)return;
  const tapped=!cancelled&&!gestureHadMultiple&&pointers.size===1&&
   gesture?.kind==="pan"&&!gesture.moved;
  pointers.delete(evt.pointerId);
  if(tapped){
   const sec=secAt(localX(evt)),now=Date.now(),x=localX(evt);
   if(now-lastTap.at<320&&Math.abs(x-lastTap.x)<32){
    setSpan(Math.max(30,windowSpan/2),sec);
    lastTap.at=0;
   }else{showCursor(sec);lastTap={at:now,x};}
  }
  resetGesture();
  if(!pointers.size)gestureHadMultiple=false;
 }
 canvas.addEventListener("pointerup",evt=>pointerFinish(evt,false));
 canvas.addEventListener("pointercancel",evt=>pointerFinish(evt,true));
 canvas.addEventListener("lostpointercapture",evt=>{
  if(pointers.has(evt.pointerId))pointerFinish(evt,true);
 });
 canvas.addEventListener("wheel",evt=>{
  if(!result)return;
  evt.preventDefault();
  const sec=secAt(localX(evt)),{left,plotWidth}=plotSize();
  const span=clamp(windowSpan*(evt.deltaY>0?1.2:1/1.2),5,total());
  windowStart=clamp(sec-(localX(evt)-left)/plotWidth*span,
   0,Math.max(0,total()-span));
  windowSpan=span;schedule();
 },{passive:false});
 window.BodyTraceSleepVisual={
  focus(start,end){
   if(!result)return;
   const mid=(Number(start)+Number(end))/2;
   showCursor(mid);setSpan(Math.min(600,total()),mid);
   panel.scrollIntoView?.({behavior:"smooth",block:"nearest"});
  },
  refreshFilters,
  setCursor:showCursor,
  playFromCursor,playEvent,
  setTimeMode,
  formatTime:(seconds,id)=>result&&result.id===id?stamp(seconds):null,
  state:()=>({id:result?.id||"",seconds:total(),start:windowStart,
   span:windowSpan,cursor,events:events().length,timeAxisMode,
   axisMin,axisMax,backgroundDb,playheadSeconds,playheadActive,followPlayback})
 };
 const priorReceive=window.bodyTraceReceive;
 window.bodyTraceReceive=function(evt){
  if(typeof priorReceive==="function")priorReceive(evt);
  if(evt?.type==="sleep_analysis")update(evt);
  else if(evt?.type==="sleep_playback"||evt?.type==="sleep_playback_position"){
   if(!result||evt.id!==result.id)return;
   if(evt.playing){
    const reported=Number(evt.position_ms);
    // The native player sends its REAL decoded position at ~220ms intervals.
    // Ignore stale packets and reject invalid positions from other sessions.
    if(!Number.isFinite(reported)||reported<0)return;
    playheadSeconds=clamp(reported/1000,0,total());
    playheadActive=true;
    if(followPlayback&&
       (playheadSeconds<windowStart||playheadSeconds>windowStart+windowSpan)){
     windowStart=clamp(playheadSeconds-windowSpan*.22,0,
      Math.max(0,total()-windowSpan));
    }
   }else if(evt.type==="sleep_playback"){
    playheadActive=false;
   }
   schedule();
  }else if(evt?.type==="sleep_status"&&!Array.isArray(evt?.sessions))update(null);
 };
 if(typeof ResizeObserver==="function")new ResizeObserver(schedule).observe(canvas);
 else window.addEventListener("resize",schedule);
})();

/* BodyTrace sleep screen: local-only recording, offline analysis and clip review. */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const receiver=window.bodyTraceReceive;
 let recording=false,sessions=[],selectedId="",analysis=null,busy=false;
 let pendingDelete="";
 let eventLimit=80;
 let runningAnalysisId="";
 let analysisStarting=false;
 let loadingCachedId="";
 let completedAnalysisId="";
 let importing=false;
 let pendingAutoAnalyzeId="";
 let pendingRemoveId="";
 let playbackActive=false;
 const noiseBySession=new Map();
 const thresholdBySession=new Map();
 const DEFAULT_ABOVE_BACKGROUND=2.0;
 const clampDb=value=>Math.max(-90,Math.min(-5,Math.round(value*10)/10));
 function estimateNoiseFloor(levels){
  if(!Array.isArray(levels))return null;
  const sorted=levels.map(Number).filter(v=>Number.isFinite(v)&&v<=0&&v>=-96)
   .sort((a,b)=>a-b);
  if(!sorted.length)return null;
  // A robust quiet-background estimate: P20 of measured RMS values.
  // A simple mean is distorted by alarms and other loud transients.
  return Math.round(sorted[Math.floor((sorted.length-1)*.20)]*10)/10;
 }
 function noiseFloor(){
  return noiseBySession.get(selectedId)??null;
 }
 function setThreshold(value,update=true){
  const corrected=clampDb(value);
  $("sleepThreshold").value=corrected.toFixed(1);
  if(selectedId)thresholdBySession.set(selectedId,corrected);
  updateThreshold();
  if(update)onFilterChanged();
 }
 function restoreBaseline(){
  const floor=noiseFloor();
  setThreshold(floor===null?-40:floor+DEFAULT_ABOVE_BACKGROUND);
 }
 function onFilterChanged(){
  if(playbackActive&&$("sleepSkipQuiet").checked){
   bridge()?.sleepStopPlayback?.();
   playbackActive=false;
   $("sleepPlaybackStatus").textContent=
    "已修改筛选规则，跳段播放停止，请重新播放";
  }
  applyLiveFilters();
 }
 // Match native filter: only above-threshold seconds count toward minimum;
 // allowed gaps join valid spans but do not count as sound.
 function detectCandidates(levels,peaks,threshold,minimum,maxGap){
  if(!Array.isArray(levels)||!Number.isFinite(threshold)||
     !Number.isInteger(minimum)||minimum<1||minimum>120||
     !Number.isInteger(maxGap)||maxGap<0||maxGap>5)return [];
  const result=[];
  let start=-1,lastHigh=-1,active=0,peak=-96;
  for(let t=0;t<=levels.length;t++){
   const loud=t<levels.length&&Number(levels[t])>=threshold;
   if(loud){
    if(start<0)start=t;
    lastHigh=t;active++;
    const value=Number(peaks?.[t]);
    peak=Math.max(peak,Number.isFinite(value)?value:Number(levels[t]));
   }else if(start>=0&&(t===levels.length||t-lastHigh>maxGap)){
    if(active>=minimum)result.push({
     start_sec:start,end_sec:lastHigh+1,active_sec:active,peak_dbfs:peak
    });
    start=-1;lastHigh=-1;active=0;peak=-96;
   }
  }
  return result;
 }
 function applyLiveFilters(updateUi=true){
  if(!analysis||!Array.isArray(analysis.levels_dbfs))return false;
  const threshold=Number($("sleepThreshold").value);
  const minimum=Number($("sleepMinSeconds").value);
  const gap=Number($("sleepGapSeconds").value);
  if(!Number.isFinite(threshold)||threshold<-90||threshold>-5||
     !Number.isInteger(minimum)||minimum<1||minimum>120||
     !Number.isInteger(gap)||gap<0||gap>5)return false;
  analysis.threshold_dbfs=threshold;
  analysis.minimum_seconds=minimum;
  analysis.gap_seconds=gap;
  analysis.events=detectCandidates(analysis.levels_dbfs,
   analysis.peak_levels_dbfs,threshold,minimum,gap);
  if(updateUi){
   renderEvents();
   window.BodyTraceSleepVisual?.refreshFilters?.();
  }
  return true;
 }
 window.BodyTraceAudioFilter={detect:detectCandidates,estimateNoiseFloor};
 function updateAnalysisProgress(percent,updatedMs){
  const raw=Number(percent);
  const pct=Number.isFinite(raw)?Math.max(0,Math.min(100,Math.floor(raw))):0;
  $("sleepAnalysisProgress").hidden=false;
  $("sleepAnalysisTrack").value=pct;
  $("sleepAnalysisPercent").textContent=pct+"%";
  const stamp=Number(updatedMs)||Date.now();
  const label=new Date(stamp).toLocaleTimeString("zh-CN",
   {timeZone:"Asia/Shanghai",hour12:false});
  $("sleepAnalysisStage").textContent="最后更新 "+label+
   " · "+(pct===0?"正在初始化解码器或读取音频":"已解码约 "+pct+"%")+
   " · 可以锁屏，通知栏继续提示进度";
 }
 function clearAnalysisProgress(){
  $("sleepAnalysisProgress").hidden=true;
  runningAnalysisId="";
 }
 const bridge=()=>window.BodyTraceNative||null;
 const pad=n=>String(n).padStart(2,"0");
 const time=ms=>!Number.isFinite(Number(ms))?"未知时间":
  new Date(Number(ms)).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false,
   year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"});
 const clock=ms=>new Date(Number(ms)).toLocaleTimeString("zh-CN",
  {timeZone:"Asia/Shanghai",hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"});
 const duration=sec=>{
  const n=Math.max(0,Math.floor(Number(sec)||0));
  return Math.floor(n/3600)+"小时"+pad(Math.floor(n%3600/60))+"分"+pad(n%60)+"秒";
 };
 const statusText=code=>({
  recording:"录音中",completed:"可分析",interrupted:"可能被系统中断",failed:"录音失败"
 })[code]||code||"未知";
 function updateThreshold(){
  const raw=Number($("sleepThreshold").value);
  const floor=noiseFloor();
  $("sleepThresholdText").textContent=raw.toFixed(1)+" dBFS";
  $("sleepThresholdRelative").textContent=floor===null?
   "等待背景估算":((raw-floor)>=0?"+":"")+(raw-floor).toFixed(1)+" dB / 背景";
  $("sleepBaselineLabel").textContent=floor===null?
   "首次分析后估算背景，默认高于背景 2.0 dB":
   "本晚背景估计 "+floor.toFixed(1)+" dBFS（P20）；按「基线」恢复背景 +2.0 dB。不是环境 dB SPL。";
 }
 function current(){
  return sessions.find(s=>s.id===selectedId)||null;
 }
 function readCachedIfAvailable(id){
  const target=sessions.find(s=>s.id===id);
  if(busy||loadingCachedId||analysis?.id===id||!target?.levels_cached||!bridge()?.sleepReadCached)return;
  loadingCachedId=id;
  busy=true;
  render();
  bridge().sleepReadCached(id,Number($("sleepThreshold").value),
   Number($("sleepMinSeconds").value),Number($("sleepGapSeconds").value));
 }
 function selectSession(id){
  if((busy||loadingCachedId)&&id!==selectedId){
   toast("已有整晚录音正在后台分析，完成后可切换",true);return;
  }
  if(selectedId!==id)analysis=null;
  selectedId=id;
  eventLimit=80;
  render();
  readCachedIfAvailable(id);
 }
 function render(){
  $("sleepStatus").textContent=recording?
   "正在录制 · 可锁屏，麦克风前台服务持续工作（通知栏可以停止）":
   "当前没有正在进行的录音";
  $("sleepStatus").classList.toggle("sleep-live",recording);
  $("sleepStart").disabled=recording||busy;
  $("sleepStop").disabled=!recording;
  $("sleepImport").disabled=importing||busy;
  $("sleepImport").textContent=importing?"正在读取文件信息…":"选择本机音频（不复制原文件）";
  const chosen=current();
  $("sleepAnalyze").disabled=!chosen||recording||busy||!!loadingCachedId||
   !(chosen.status==="completed"||chosen.status==="interrupted");
  $("sleepAnalyze").textContent=loadingCachedId?"正在加载波形缓存…":busy?"正在后台分析，请查看进度":
   chosen?.levels_cached?"✓ 已生成波形 · 重新筛选":"首次分析并生成波形";
  $("sleepAnalyze").hidden=!!chosen?.levels_cached&&!busy&&!loadingCachedId;
  const select=$("sleepSessionSelect");
  select.replaceChildren();
  const empty=document.createElement("option");empty.value="";empty.textContent="选择录音";
  select.append(empty);
  for(const session of sessions){
   const opt=document.createElement("option");opt.value=session.id;
   const prefix=session.original_name||(
    session.date_basis==="imported_at"?"导入音频":time(session.started_ms));
   opt.textContent=(session.levels_cached?"✓ ":"")+prefix+
    " · "+duration(Number(session.duration_ms||0)/1000);
   select.append(opt);
  }
  select.value=chosen?.id||"";
  $("sleepLibraryCount").textContent=sessions.length+" 条记录";
  $("sleepSelected").textContent=chosen?
   "已选："+(chosen.date_basis==="imported_at"?"导入录音（未知录制起始日期）":
    time(chosen.started_ms))+" · "+statusText(chosen.status):
   "请从下方选择一个已完成的录音";
  const history=$("sleepHistory");history.replaceChildren();
  if(!sessions.length){
   const empty=document.createElement("p");empty.className="sub";
   empty.textContent="还没有录音记录。首次使用请先授予麦克风权限，再点击开始。";
   history.append(empty);
  }
  for(const item of sessions){
   const card=document.createElement("article");
   card.className="sleep-history-card"+(item.id===selectedId?" selected":"");
   const title=document.createElement("strong");
   title.textContent=(item.date_basis==="imported_at"?
    "导入录音 · 原始开始时间未提供":time(item.started_ms))+
    " · "+statusText(item.status);
   const extra=document.createElement("div");extra.className="sub";
   const millis=Number(item.duration_ms)>0?Number(item.duration_ms):
    (item.ended_ms||Date.now())-item.started_ms;
   const sourceLabel=item.external_file?"引用原文件 · 不占用音频副本空间":
    item.source==="imported-audio"?"旧版导入副本":"APP 内录制";
   extra.textContent=sourceLabel+" · "+
    (item.original_name?item.original_name+" · ":"")+
    "时长 "+duration(millis/1000)+" · "+
     ((Number(item.bytes)||0)/1048576).toFixed(1)+" MB（音频大小）"+
     (item.levels_cached?" · ✓ 波形已缓存":" · 未解析");
   card.append(title,extra);
   if(item.error){
    const err=document.createElement("p");err.className="sleep-error";
    err.textContent=item.error;card.append(err);
   }
   const actions=document.createElement("div");actions.className="sleep-history-actions";
   const choose=document.createElement("button");
   choose.type="button";choose.className="mini"+(item.id===selectedId?" active":"");
   choose.textContent=item.id===selectedId?"已选中":"选择分析";
   choose.onclick=()=>selectSession(item.id);
   actions.append(choose);
   if(!recording&&item.status!=="recording"){
    const del=document.createElement("button");
    del.type="button";del.className="mini danger-soft";
    const external=!!item.external_file;
    const ownedCopy=item.source==="imported-audio";
    del.textContent=pendingRemoveId===item.id?"正在移除…":
     pendingDelete===item.id?
       (external?"确认移出（不删原件）":"确认清除 APP 内文件"):
       external?"移出列表（保留原文件）":
       ownedCopy?"清除导入副本":"删除 APP 录音";
    del.disabled=pendingRemoveId===item.id||!!runningAnalysisId&&
     runningAnalysisId===item.id&&busy;
    del.onclick=()=>{
     if(pendingDelete!==item.id){
      pendingDelete=item.id;render();return;
     }
     if(!bridge()?.sleepDelete){toast("请安装支持移除录音的版本",true);return;}
     pendingRemoveId=item.id;render();
     bridge().sleepDelete(item.id);
    };
    actions.append(del);
   }
   card.append(actions);history.append(card);
  }
  renderEvents();
 }
 function renderEvents(){
  const root=$("sleepAnalysis");root.replaceChildren();
  if(!analysis||analysis.id!==selectedId)return;
  const head=document.createElement("p");head.className="sleep-analysis-summary";
  const events=Array.isArray(analysis.events)?analysis.events:[];
  const total=events.reduce((sum,e)=>sum+(Number(e.active_sec)||0),0);
  head.textContent="符合规则 "+events.length+" 段 · 有效超阈值累计 "+
   duration(total)+" · 最短 "+analysis.minimum_seconds+" 秒，允许空隙 "+
   analysis.gap_seconds+" 秒（不等于确诊鼾声）";
  root.append(head);
  $("sleepEventCount").textContent=events.length+" 段";
  if(!events.length){
   const p=document.createElement("p");p.className="sub";
   p.textContent="没有符合阈值和持续时间的候选片段；可调整筛选参数重新分析。";
   root.append(p);return;
  }
  events.slice(0,eventLimit).forEach((event,i)=>{
   const row=document.createElement("div");row.className="sleep-event";
   const info=document.createElement("div");
   const name=document.createElement("strong");
   const label=offset=>analysis.date_basis==="imported_at"?
    "+"+duration(offset):clock(analysis.started_ms+offset*1000);
   name.textContent="声音片段 "+(i+1)+" · "+
    label(event.start_sec)+"—"+label(event.end_sec);
   const meta=document.createElement("small");
   meta.textContent="超阈值 "+event.active_sec+" 秒 · 峰值 "+
    Number(event.peak_dbfs).toFixed(1)+" dBFS";
   info.append(name,meta);
   const play=document.createElement("button");
   play.type="button";play.className="mini secondary";
   play.textContent="回听";
   play.onclick=()=>window.BodyTraceSleepVisual?.playEvent?.(i);
   const focus=document.createElement("button");
   focus.type="button";focus.className="mini secondary sleep-event-focus";
   focus.textContent="查看波形";
   focus.onclick=()=>window.BodyTraceSleepVisual?.focus(event.start_sec,event.end_sec);
   const controls=document.createElement("div");controls.className="sleep-event-actions";
   controls.append(play,focus);
   row.append(info,controls);root.append(row);
  });
  if(events.length>eventLimit){
   const more=document.createElement("button");more.type="button";
   more.className="secondary mini sleep-event-more";
   more.textContent="再显示后续 80 段（"+eventLimit+"/"+events.length+"）";
   more.onclick=()=>{eventLimit+=80;renderEvents();};
   root.append(more);
  }
 }
 function analyze(){
  if(busy||!!loadingCachedId||!current()||recording)return;
  const threshold=Number($("sleepThreshold").value);
  const seconds=Number($("sleepMinSeconds").value);
  const gap=Number($("sleepGapSeconds").value);
  if(!Number.isInteger(seconds)||seconds<1||seconds>120||
    !Number.isInteger(gap)||gap<0||gap>5){
   toast("最短持续时间限制1–120秒，间断时间限制0–5秒",true);return;
  }
  if(current()?.levels_cached&&bridge()?.sleepReadCached){
   // Changing thresholds requires only a quick rescan of cached 1s levels.
   busy=true;loadingCachedId=selectedId;
   $("sleepAnalyze").disabled=true;
   $("sleepSelected").textContent="正在使用缓存重新筛选声音片段…";
   render();
   bridge().sleepReadCached(selectedId,threshold,seconds,gap);
   return;
  }
  if(!bridge()?.sleepAnalyze){toast("当前 APK 不支持睡眠分析",true);return;}
  busy=true;
  analysisStarting=true;
  completedAnalysisId="";
  runningAnalysisId=selectedId;
  $("sleepAnalyze").disabled=true;
  updateAnalysisProgress(0,Date.now());
  render();
  bridge().sleepAnalyze(selectedId,threshold,seconds,gap);
 }
 // Filtering is immediate: no second native decode or long-running task.
 $("sleepThreshold").addEventListener("input",()=>{
  setThreshold(Number($("sleepThreshold").value));
 });
 for(const field of ["sleepMinSeconds","sleepGapSeconds"]){
  $(field).addEventListener("input",onFilterChanged);
 }
 $("sleepThresholdDown").onclick=()=>setThreshold(Number($("sleepThreshold").value)-.1);
 $("sleepThresholdUp").onclick=()=>setThreshold(Number($("sleepThreshold").value)+.1);
 $("sleepThresholdReset").onclick=restoreBaseline;
 $("sleepSessionSelect").addEventListener("change",()=>{
  if($("sleepSessionSelect").value)selectSession($("sleepSessionSelect").value);
 });
 $("sleepImport").onclick=()=>{
  if(recording||busy||importing){toast("请先完成当前录音或分析",true);return;}
  if(!bridge()?.sleepImport){toast("请安装支持导入录音的新版 APK",true);return;}
  importing=true;
  $("sleepImportStatus").textContent="请选择原始 M4A；仅授权读取，不会复制、移动或删除原文件。";
  render();
  bridge().sleepImport($("sleepImportStarted").value||"");
 };
 $("sleepStart").onclick=()=>{
  if(!bridge()?.sleepStart){toast("请安装含睡眠录音功能的 APK",true);return;}
  $("sleepStatus").textContent="正在请求麦克风权限／启动录音…";
  bridge().sleepStart();
 };
 $("sleepStop").onclick=()=>{
  if(!bridge()?.sleepStop)return;
  $("sleepStatus").textContent="正在停止并保存，请不要强行结束 APP…";
  bridge().sleepStop();
 };
 $("sleepRefresh").onclick=()=>{
  if(!bridge()?.sleepStatus){toast("请在 Android APP 内查看本机录音",true);return;}
  bridge().sleepStatus();
 };
 $("sleepAnalyze").onclick=analyze;
 $("sleepStopPlayback").onclick=()=>{
  bridge()?.sleepStopPlayback?.();
  $("sleepPlaybackStatus").textContent="正在停止播放…";
 };
 document.querySelector('.tabs button[data-page="sleep"]')?.addEventListener("click",()=>{
  bridge()?.sleepStatus?.();
 });
 window.bodyTraceReceive=function(evt){
  if(typeof receiver==="function")receiver(evt);
  if(!evt||!evt.type)return;
  if(evt.type==="sleep_status"){
   recording=!!evt.recording;
   sessions=Array.isArray(evt.sessions)?evt.sessions:[];
   // Status responses may have been queued BEFORE the user pressed Analyze.
   // Never unlock the button while startup, cache-read, or background decode is pending.
   const running=!!evt.analysis_running&&!!evt.analysis_id;
   if(running&&!(evt.analysis_id===completedAnalysisId&&analysis?.id===evt.analysis_id)){
    if(selectedId!==evt.analysis_id)analysis=null;
    selectedId=evt.analysis_id;
    runningAnalysisId=evt.analysis_id;
    analysisStarting=false;
    busy=true;
    updateAnalysisProgress(evt.analysis_percent,Date.now());
   }else if(!analysisStarting&&!loadingCachedId){
    if(runningAnalysisId&&!analysis){
     // The process may have finished while the Activity was not listening.
     // If its cache exists, load that result rather than restarting decode.
     const finished=sessions.find(x=>x.id===runningAnalysisId);
     if(!finished?.levels_cached)
      toast("音频分析已中断，未产生缓存；可以重新尝试",true);
    }
    busy=false;
    clearAnalysisProgress();
   }
   if(pendingAutoAnalyzeId&&sessions.some(x=>x.id===pendingAutoAnalyzeId)){
    selectedId=pendingAutoAnalyzeId;
    analysis=null;
   }
   if(!sessions.some(x=>x.id===selectedId)){
    selectedId=sessions.find(x=>x.status==="completed"||x.status==="interrupted")?.id||"";
    analysis=null;
   }
   render();
   if(pendingAutoAnalyzeId&&selectedId===pendingAutoAnalyzeId&&!busy){
    pendingAutoAnalyzeId="";
    if(current()?.levels_cached)readCachedIfAvailable(selectedId);
    else analyze();
   }else if(!busy&&!analysis&&selectedId)readCachedIfAvailable(selectedId);
  }else if(evt.type==="sleep_analysis"){
   busy=false;analysisStarting=false;loadingCachedId="";
   completedAnalysisId=evt.id||selectedId;
   clearAnalysisProgress();
   selectedId=evt.id||selectedId;analysis=evt;eventLimit=80;
   if(!noiseBySession.has(selectedId)){
    const floor=estimateNoiseFloor(evt.levels_dbfs);
    if(floor!==null)noiseBySession.set(selectedId,floor);
   }
   const known=thresholdBySession.get(selectedId);
   setThreshold(known??((noiseFloor()??-42)+DEFAULT_ABOVE_BACKGROUND),false);
   applyLiveFilters(false);
   render();
  }else if(evt.type==="sleep_imported"){
   importing=false;
   pendingAutoAnalyzeId=evt.id||"";
   $("sleepImportStatus").textContent=evt.already_exists?
    "这个音频已经关联过，正在打开已有波形，不会创建重复记录。":
    "已授权引用原文件（不复制音频）。自动生成波形；以后可直接查看和回听。";
   render();
  }else if(evt.type==="sleep_import_cancelled"){
   importing=false;
   $("sleepImportStatus").textContent="已取消选择；没有复制、删除或修改音频。";
   render();
  }else if(evt.type==="sleep_removed"){
   pendingRemoveId="";pendingDelete="";
   if(evt.id===selectedId){analysis=null;loadingCachedId="";}
   toast(evt.original_preserved?"已移出列表，手机原文件未改变":"已移除 APP 内文件和分析数据");
   render();
  }else if(evt.type==="sleep_import_progress"){
   // Backward compatibility with a pending old-version import.
   $("sleepImportStatus").textContent="正在处理旧版音频："+evt.percent+"%";
  }else if(evt.type==="sleep_playback"){
   playbackActive=!!evt.playing;
   if(evt.playing){
    $("sleepPlaybackStatus").textContent=
     (evt.skip?"正在跳过不达标声音 · ":"正在正常播放 · ")+
     "第 "+evt.segment_index+"/"+evt.total_segments+" 段 · "+
     duration(evt.start_sec||0);
   }else $("sleepPlaybackStatus").textContent="播放已结束或停止";
  }else if(evt.type==="sleep_analysis_progress"){
   if(evt.id&&runningAnalysisId&&evt.id!==runningAnalysisId)return;
   analysisStarting=false;
   completedAnalysisId="";
   busy=true;
   runningAnalysisId=evt.id||selectedId;
   updateAnalysisProgress(evt.percent,evt.updated_ms);
   $("sleepAnalyze").disabled=true;
  }else if(evt.type==="error"&&/睡眠|录音|片段/.test(evt.message||"")){
   busy=false;analysisStarting=false;loadingCachedId="";
   importing=false;pendingRemoveId="";
   clearAnalysisProgress();render();
  }
 };
 updateThreshold();
 render();
})();

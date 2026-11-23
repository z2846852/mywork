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
 const autoAnalysisAttemptedIds=new Set();
 let startEditorSessionId="";
 let pendingRemoveId="";
 let playbackActive=false;
 const noiseBySession=new Map();
 const thresholdBySession=new Map();
 const snoreThresholdBySession=new Map();
 const speechThresholdBySession=new Map();
 const detectorModeBySession=new Map();
 const SPEECH_DEFAULT_SCORE=0.20;
 const AI_DEFAULT_SCORE=0.15;
 const AI_HIGH_RECALL_SCORE=0.05;
 function aiAvailable(){
  return Array.isArray(analysis?.ai_snore_scores)&&
   analysis.ai_snore_scores.length===analysis.levels_dbfs?.length;
 }
 function speechAvailable(){
  return Array.isArray(analysis?.ai_speech_scores)&&
   analysis.ai_speech_scores.length===analysis.levels_dbfs?.length;
 }
 function aiActive(){return aiAvailable()&&$("sleepDetectionMode").value==="ai";}
 function speechActive(){return speechAvailable()&&$("sleepDetectionMode").value==="speech";}
 function selectedAiScores(){return speechActive()?analysis.ai_speech_scores:
  aiActive()?analysis.ai_snore_scores:null;}
 function selectedAiActive(){return aiActive()||speechActive();}
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
 function detectCandidates(levels,peaks,threshold,minimum,maxGap,shortLevels){
  if(!Array.isArray(levels)||!Number.isFinite(threshold)||
     !Number.isInteger(minimum)||minimum<1||minimum>120||
     !Number.isInteger(maxGap)||maxGap<0||maxGap>5)return [];
  const result=[];
  const useShort=Array.isArray(shortLevels)&&shortLevels.length===levels.length;
  const detector=useShort?shortLevels:levels;
  let start=-1,lastHigh=-1,active=0,peak=-96;
  for(let t=0;t<=levels.length;t++){
   const loud=t<levels.length&&Number(detector[t])>=threshold;
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
 // Merge model-positive one-second windows; scores are NOT calibrated probabilities.
 function detectSnoreEvents(scores,threshold,minimum,maxGap){
  if(!Array.isArray(scores)||!Number.isFinite(threshold)||threshold<0||threshold>1||
   !Number.isInteger(minimum)||minimum<1||minimum>120||
   !Number.isInteger(maxGap)||maxGap<0||maxGap>5)return [];
  const found=[];
  let start=-1,lastHigh=-1,active=0,maxScore=0;
  for(let t=0;t<=scores.length;t++){
   const score=t<scores.length?Number(scores[t]):0;
   const loud=t<scores.length&&Number.isFinite(score)&&score>=threshold;
   if(loud){
    if(start<0)start=t;
    lastHigh=t;active++;maxScore=Math.max(maxScore,score);
   }else if(start>=0&&(t===scores.length||t-lastHigh>maxGap)){
    if(active>=minimum)found.push({
     start_sec:start,end_sec:lastHigh+1,active_sec:active,
     ai_score:Math.round(maxScore*1000)/1000
    });
    start=-1;lastHigh=-1;active=0;maxScore=0;
   }
  }
  return found;
 }
 function updateDetectorControls(){
  const mode=$("sleepDetectionMode").value;
  const active=selectedAiActive();
  $("sleepAiControls").hidden=!active;
  $("sleepAiScoreControls").hidden=!active;
  $("sleepThresholdWorkbench").hidden=mode!=="level";
  $("sleepDetectionMode").disabled=!aiAvailable()&&!speechAvailable();
  const missing=mode==="speech"&&!speechAvailable();
  $("sleepDetectorNote").textContent=missing?
   "旧录音缺少人声标签；不会自动重新解码。点击补充后可以反复筛选。检测到人声不一定是在说梦话。":
   aiAvailable()||speechAvailable()?"":"AI 结果未生成";
  $("sleepDetectorNote").hidden=!(missing||(!aiAvailable()&&!speechAvailable()));
  $("sleepSpeechUpgrade").hidden=!analysis?.id||speechAvailable()||!aiAvailable();
  $("sleepSpeechUpgrade").disabled=busy||recording;
  $("sleepAiPresetHint").textContent=mode==="speech"?
   "人声模型得分不是概率；标准 0.20/2 秒，高召回 0.05/1 秒；不自动转写。":
   "标准 0.15/2 秒；高召回 0.05/1 秒；仅重新筛选缓存。";
  const score=Number($("sleepSnoreThreshold").value);
  const minimum=Number($("sleepMinSeconds").value);
  const gap=Number($("sleepGapSeconds").value);
  const normalScore=mode==="speech"?SPEECH_DEFAULT_SCORE:AI_DEFAULT_SCORE;
  const standard=active&&Math.abs(score-normalScore)<.001&&minimum===2&&gap===3;
  const recall=active&&Math.abs(score-AI_HIGH_RECALL_SCORE)<.001&&minimum===1&&gap===3;
  for(const [id,pressed] of [["sleepAiStandard",standard],["sleepAiHighRecall",recall]]){
   $(id).classList.toggle("active",pressed);
   $(id).setAttribute("aria-pressed",String(pressed));
  }
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
  const scoreThreshold=Number($("sleepSnoreThreshold").value);
  analysis.detection_mode=$("sleepDetectionMode").value;
  if(!["ai","speech","level"].includes(analysis.detection_mode))
   analysis.detection_mode="level";
  analysis.ai_score_threshold=scoreThreshold;
  const scores=selectedAiScores();
  analysis.events=analysis.detection_mode==="speech"&&!speechAvailable()?[]:
   scores?detectSnoreEvents(scores,scoreThreshold,minimum,gap):
   analysis.detection_mode==="ai"?[]:
   detectCandidates(analysis.levels_dbfs,
    analysis.peak_levels_dbfs,threshold,minimum,gap,analysis.short_levels_dbfs);
  updateDetectorControls();
  if(updateUi){
   renderEvents();
   window.BodyTraceSleepVisual?.refreshFilters?.();
  }
  return true;
 }
 window.BodyTraceAudioFilter={detect:detectCandidates,
  detectSnoreEvents,estimateNoiseFloor};
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
   "";
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
  $("sleepBaselineLabel").textContent=floor===null?"":
   "背景 "+floor.toFixed(1)+" dBFS (P20)";
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
  // First manual selection: analyze uncached audio exactly once.
  // Cached files load the saved model scores without decoding.
  const target=current();
  if(!target||recording||
    !(target.status==="completed"||target.status==="interrupted"))return;
  if(target.levels_cached)readCachedIfAvailable(id);
  else if(!autoAnalysisAttemptedIds.has(id)){
   autoAnalysisAttemptedIds.add(id);
   analyze();
  }
 }
 function render(){
  $("sleepStatus").textContent=recording?
   "● 录音中":"未录音";
  $("sleepStatus").classList.toggle("sleep-live",recording);
  $("sleepStatus").hidden=!recording;
  $("sleepStart").disabled=recording||busy;
  $("sleepStop").disabled=!recording;
  $("sleepImport").disabled=importing||busy;
  $("sleepImport").textContent=importing?"…":"＋";
  $("sleepImport").title=importing?"读取音频信息…":"导入本机音频";
  const chosen=current();
  $("sleepAnalyze").disabled=!chosen||recording||busy||!!loadingCachedId||
   !(chosen.status==="completed"||chosen.status==="interrupted");
  const ready=analysis?.id===selectedId&&aiAvailable();
  $("sleepAnalyze").textContent=loadingCachedId?"读取缓存…":
   busy?"AI 分析中":ready?"已缓存":
   chosen?.levels_cached?"补充 AI":"重试 AI";
  $("sleepAnalyze").hidden=!chosen||ready&&!busy&&!loadingCachedId;
  $("sleepAnalyzeHint").textContent=chosen?.levels_cached?
   "AI 缓存待升级":"AI 待分析";
  $("sleepAnalyzeHint").hidden=!chosen||ready||busy||!!loadingCachedId;
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
  const chosenBytes=Number(chosen?.bytes)||0;
  const chosenDuration=Number(chosen?.duration_ms)||(
   chosen?.ended_ms&&chosen?.started_ms?
    Math.max(0,Number(chosen.ended_ms)-Number(chosen.started_ms)):0);
  const knownTime=!!chosen&&
   (chosen.external_file?
    ["user_supplied","media_date_unverified","filename_inferred",
     "filename_media_end_match"].includes(chosen.date_basis):
    chosen.date_basis!=="imported_at")&&
   Number.isFinite(Number(chosen.started_ms))&&Number(chosen.started_ms)>0;
  const timeSource=!chosen?"":chosen.date_basis==="user_supplied"?
   "手动确认时间":
   chosen.date_basis==="filename_media_end_match"?
    "文件名录制时间（与结束时间吻合）":
   chosen.date_basis==="filename_inferred"?
    "文件名推断录制开始时间":
   chosen.date_basis==="media_date_unverified"?
    "媒体日期（可能是录制结束时间）":
   knownTime?"APP 实际录制时间":"录音开始时间未知";
  $("sleepSelectedFile").textContent=chosen?
   (chosenBytes>0?(chosenBytes/1048576).toFixed(2)+" MB":"大小未知")+
   " · "+duration(chosenDuration/1000)+" · "+timeSource+
   (chosen.levels_cached?" · ✓ 已缓存":" · 未分析"):
   "";
  $("sleepEditStartRow").hidden=!chosen?.external_file;
  if(chosen?.external_file){
   if(startEditorSessionId!==selectedId){
    const ms=knownTime?Number(chosen.started_ms):0;
    $("sleepEditStart").value=ms?
     new Date(ms+8*60*60*1000).toISOString().slice(0,19):"";
    startEditorSessionId=selectedId;
   }
   $("sleepTimeSourceHint").textContent=chosen.date_basis==="filename_media_end_match"?
    "识别了文件名中的录制时间；结合音频时长计算的结束时间与媒体日期接近。这是高置信推断，可手动校正。":
    chosen.date_basis==="filename_inferred"?
    "已提取文件名中的时间（默认按北京时间）。这是录制开始时间的推断，请确认。":
    chosen.date_basis==="media_date_unverified"?
    "内嵌媒体日期可能是文件结束写入时间，不一定是录制开始；请优先根据文件名确认。":
    knownTime?"当前录制起点已指定。修改这里只更新时间轴，不会重新分析 AI。":
    "此录音没有可信的起始时间。手动填入后横轴即可显示凌晨 03:00 等真实时间。";
  }
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
     (Number(item.bytes)>0?(Number(item.bytes)/1048576).toFixed(2)+" MB":
       "文件大小未确定")+"（音频文件）"+
     (item.levels_cached?" · ✓ 波形已缓存":" · 未解析");
   card.append(title,extra);
   if(item.error){
    const err=document.createElement("p");err.className="sleep-error";
    err.textContent=item.error;card.append(err);
   }
   const actions=document.createElement("div");actions.className="sleep-history-actions";
   const choose=document.createElement("button");
   choose.type="button";choose.className="mini"+(item.id===selectedId?" active":"");
   choose.textContent=item.id===selectedId?"已选中":"选择（自动 AI）";
   choose.onclick=()=>selectSession(item.id);
   actions.append(choose);
   if(!item.external_file&&item.source==="local-microphone"&&
       item.status!=="recording"&&Number(item.bytes)>1024){
    const exportButton=document.createElement("button");
    exportButton.type="button";exportButton.className="mini secondary";
    exportButton.textContent="导出 M4A 到手机";
    exportButton.onclick=()=>{
     if(!bridge()?.sleepExport){toast("需要新版 APK 才能导出录音",true);return;}
     bridge().sleepExport(item.id);
    };
    actions.append(exportButton);
   }
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
  if(!analysis||analysis.id!==selectedId){
   $("sleepQuickSummary").textContent="暂无候选片段";return;
  }
  const head=document.createElement("p");head.className="sleep-analysis-summary";
  const events=Array.isArray(analysis.events)?analysis.events:[];
  $("sleepQuickSummary").textContent=events.length+" 段候选";
  const total=events.reduce((sum,e)=>sum+(Number(e.active_sec)||0),0);
  const mode=analysis.detection_mode==="speech"?"疑似梦话（人声候选）":
   analysis.detection_mode==="ai"?"AI 鼾声候选":"响度候选";
  head.textContent=mode+"：符合规则 "+events.length+" 段 · 有效累计 "+
   duration(total)+" · 最短 "+analysis.minimum_seconds+" 秒，允许空隙 "+
   analysis.gap_seconds+" 秒（仅为声音候选，需人工回听确认）";
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
   const label=offset=>window.BodyTraceSleepVisual?.formatTime?.(offset,analysis.id)||
    (analysis.date_basis==="imported_at"?
     "+"+duration(offset):clock(analysis.started_ms+offset*1000));
   name.textContent="声音片段 "+(i+1)+" · "+
    label(event.start_sec)+"—"+label(event.end_sec);
   const meta=document.createElement("small");
   meta.textContent=["ai","speech"].includes(analysis.detection_mode)?
    "模型命中 "+event.active_sec+" 秒 · 最高得分 "+
      Number(event.ai_score).toFixed(3)+"（非概率）":
    "超阈值 "+event.active_sec+" 秒 · 峰值 "+
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
 window.BodyTraceSleepRenderEvents=renderEvents;
 function analyze(){
  if(busy||!!loadingCachedId||!current()||recording)return;
  const threshold=Number($("sleepThreshold").value);
  const seconds=Number($("sleepMinSeconds").value);
  const gap=Number($("sleepGapSeconds").value);
  if(!Number.isInteger(seconds)||seconds<1||seconds>120||
    !Number.isInteger(gap)||gap<0||gap>5){
   toast("最短持续时间限制1–120秒，间断时间限制0–5秒",true);return;
  }
  const ready=analysis?.id===selectedId&&aiAvailable();
  if(current()?.levels_cached&&ready&&bridge()?.sleepReadCached){
    // Enhanced cache already exists: only a quick rescan is needed.
   busy=true;loadingCachedId=selectedId;
   $("sleepAnalyze").disabled=true;
   $("sleepSelected").textContent="正在使用缓存重新筛选声音片段…";
   render();
   bridge().sleepReadCached(selectedId,threshold,seconds,gap);
   return;
  }
  if(!bridge()?.sleepAnalyze){toast("当前 APK 不支持睡眠分析",true);return;}
  busy=true;
  autoAnalysisAttemptedIds.add(selectedId);
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
 $("sleepDetectionMode").addEventListener("change",()=>{
  const mode=$("sleepDetectionMode").value;
  if(selectedId)detectorModeBySession.set(selectedId,mode);
  const val=mode==="speech"?
   speechThresholdBySession.get(selectedId)??SPEECH_DEFAULT_SCORE:
   snoreThresholdBySession.get(selectedId)??AI_DEFAULT_SCORE;
  $("sleepSnoreThreshold").value=val.toFixed(2);
  $("sleepSnoreThresholdText").textContent=val.toFixed(2);
  onFilterChanged();
 });
 $("sleepSpeechUpgrade").onclick=()=>{
  if(!bridge()?.sleepAnalyzeSpeech||!analysis?.id||busy||recording)return;
  const seconds=Number($("sleepMinSeconds").value),gap=Number($("sleepGapSeconds").value);
  if(!Number.isInteger(seconds)||seconds<1||seconds>120||
     !Number.isInteger(gap)||gap<0||gap>5){toast("持续/空隙参数不合法",true);return;}
  busy=true;loadingCachedId="";analysisStarting=true;completedAnalysisId="";
  runningAnalysisId=selectedId;updateAnalysisProgress(0,Date.now());render();
  bridge().sleepAnalyzeSpeech(selectedId,Number($("sleepThreshold").value),seconds,gap);
 };
 // Presets only refilter cached AI scores; they never restart native decoding.
 function setAiPreset(score,minimum){
  const mode=$("sleepDetectionMode").value==="speech"?"speech":"ai";
  $("sleepDetectionMode").value=mode;
  const chosen=mode==="speech"&&score===AI_DEFAULT_SCORE?SPEECH_DEFAULT_SCORE:score;
  $("sleepSnoreThreshold").value=chosen.toFixed(2);
  $("sleepSnoreThresholdText").textContent=chosen.toFixed(2);
  $("sleepMinSeconds").value=String(minimum);
  $("sleepGapSeconds").value="3";
  if(selectedId)(mode==="speech"?speechThresholdBySession:snoreThresholdBySession)
   .set(selectedId,Number($("sleepSnoreThreshold").value));
  onFilterChanged();
 }
 $("sleepAiStandard").onclick=()=>setAiPreset(AI_DEFAULT_SCORE,2);
 $("sleepAiHighRecall").onclick=()=>setAiPreset(AI_HIGH_RECALL_SCORE,1);
 $("sleepSnoreThreshold").addEventListener("input",()=>{
  $("sleepSnoreThresholdText").textContent=Number($("sleepSnoreThreshold").value).toFixed(2);
  if(selectedId)($("sleepDetectionMode").value==="speech"?
   speechThresholdBySession:snoreThresholdBySession).set(selectedId,
   Number($("sleepSnoreThreshold").value));
  onFilterChanged();
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
  $("sleepImportStatus").textContent="等待选择本机音频…";
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
 $("sleepSaveStart").onclick=()=>{
  const value=$("sleepEditStart").value;
  if(!current()?.external_file||!value){
   toast("请先选择外部录音并填写准确的录制开始时间",true);return;
  }
  if(!bridge()?.sleepSetStartTime){
   toast("当前 APK 不支持修改录音起始时间，请安装完整版",true);return;
  }
  $("sleepTimeSourceHint").textContent="正在保存录制起点，不重新分析音频…";
  bridge().sleepSetStartTime(selectedId,value);
 };
 $("sleepStopPlayback").onclick=()=>{
  bridge()?.sleepStopPlayback?.();
  $("sleepPlaybackStatus").textContent="正在停止播放…";
 };
 // Android UsageStatsManager retains events for a system-defined period.
 // A long inactivity interval is not measured sleep.
 const phoneStamp=ms=>new Date(Number(ms)).toLocaleString("zh-CN",{
  timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",
  hour:"2-digit",minute:"2-digit",hour12:false
 });
 const phoneDuration=ms=>{
  const m=Math.floor(Math.max(0,Number(ms)||0)/60000);
  return Math.floor(m/60)+"小时"+String(m%60).padStart(2,"0")+"分";
 };
 const phoneLabels={auto_sleep:"睡眠（自动）",suspected:"睡眠（自动）",unknown:"未知",
  confirmed_sleep:"睡眠（已确认）",not_sleep:"不是睡眠"};
 let phoneReviewBusy=false;
 const phoneExpanded=new Map();
 function phoneReview(id,decision){
  if(phoneReviewBusy)return;
  if(!bridge()?.reviewPhoneSleep){
   toast("请更新完整 APK 才能保存人工确认",true);return;
  }
  phoneReviewBusy=true;
  $("phoneSleepStatus").textContent="正在保存人工确认…";
  bridge().reviewPhoneSleep(id,decision);
 }
 function renderPhoneSleep(evt){
  phoneReviewBusy=false;
  $("phoneSleepRefresh").disabled=false;
  const state=evt.state||"error";
  $("phoneSleepStatus").textContent=evt.message||"无法获取系统使用记录";
  $("phoneSleepGrant").hidden=state!=="permission_required";
  const history=$("phoneSleepHistory");history.replaceChildren();
  const hasSaved=Array.isArray(evt.history)&&evt.history.length>0;
  if(state!=="ready"&&!(state==="no_events"&&hasSaved)){
   $("phoneSleepCoverage").hidden=true;
   return;
  }
  const reports=Array.isArray(evt.history)?evt.history:[];
  $("phoneSleepCoverage").hidden=false;
  $("phoneSleepCoverage").textContent=
   (state==="no_events"?"仅显示本机已存历史":
    "可读："+phoneStamp(evt.first_event_ms)+"—"+phoneStamp(evt.last_event_ms))+
   " · 扫描 "+(Number(evt.events_scanned)||0)+" 条"+
   " · 睡眠 "+reports.filter(r=>["auto_sleep","confirmed_sleep"].includes(r.sleep_status)).length+
   " · 未知 "+reports.filter(r=>r.sleep_status==="unknown").length+
   " · 人工修正 "+reports.filter(r=>!!r.reviewed).length+
   " · 本次新增 "+(Number(evt.created_count)||0)+
   (evt.truncated?" · ! 历史读取被截断":"");
  for(const [index,report] of reports.entries()){
   const status=report.sleep_status||"unknown";
   const wrapper=document.createElement("details");
   wrapper.className="phone-sleep-night phone-sleep-"+status;
   wrapper.open=phoneExpanded.has(report.id)?phoneExpanded.get(report.id):index===0;
   wrapper.addEventListener("toggle",()=>phoneExpanded.set(report.id,wrapper.open));
   const title=document.createElement("summary");
   title.textContent=report.day+" · "+phoneDuration(report.inactive_window_ms)+
    " · "+(phoneLabels[status]||"未知");
   const times=document.createElement("div");
   times.className="phone-sleep-interval";
   times.textContent="未明显使用："+phoneStamp(report.screen_off_ms)+
    " → "+phoneStamp(report.next_screen_on_ms);
   const evidence=document.createElement("p");
   evidence.className="sub";
   const count=Number(report.short_use_count)||0;
   evidence.textContent=(status==="auto_sleep"?"按规则自动识别为睡眠，并非实测睡眠时长。":
    status==="confirmed_sleep"?"已由你确认睡眠；时长是手机无明显使用的时间窗口。":
    "手机未使用不等于真实睡眠。")+
    (count?" 已容忍短暂亮屏 "+count+" 次，共 "+
     phoneDuration(report.short_use_ms)+"。":"")+
    (report.note?" "+report.note:"");
   const actions=document.createElement("div");
   actions.className="phone-sleep-actions";
   for(const [value,label] of [
    ["confirmed_sleep","✓ 睡了"],["not_sleep","× 没睡"],
    ["unknown","? 未知"]]){
    const btn=document.createElement("button");
    btn.type="button";btn.className="secondary mini";btn.textContent=label;
    btn.setAttribute("aria-pressed",String(!!report.reviewed&&status===value));
    btn.onclick=()=>phoneReview(report.id,value);
    actions.appendChild(btn);
   }
   wrapper.append(title,times,evidence,actions);history.appendChild(wrapper);
  }
  const pending=Array.isArray(evt.insufficient)?evt.insufficient:[];
  if(pending.length){
   const details=document.createElement("details");
   details.className="phone-sleep-unresolved";
   const label=document.createElement("summary");
   label.textContent="! "+pending.length+" 段尚未结束（不推算时长）";
   details.appendChild(label);
   for(const item of pending){
    const line=document.createElement("p");
    line.textContent=item.day+" · "+item.message;
    details.appendChild(line);
   }
   history.appendChild(details);
  }
  if(!reports.length&&!pending.length){
   const note=document.createElement("p");
   note.className="sub";
   note.textContent="系统可读事件中没有完整的 4 小时以上区间；不能据此认定空白日期未睡觉。";
   history.appendChild(note);
  }
  // No daily interruption. Unusual intervals remain editable in the list.
 }
 $("phoneSleepRefresh").onclick=()=>{
  if(!bridge()?.phoneSleepReports){
   $("phoneSleepStatus").textContent="请完整安装支持手机行为报告的新版 APK";
   return;
  }
  $("phoneSleepRefresh").disabled=true;
  $("phoneSleepStatus").textContent="正在扫描 Android 当前保留的全部历史事件…";
  bridge().phoneSleepReports();
 };
 $("phoneSleepGrant").onclick=()=>{
  if(!bridge()?.requestPhoneUsageAccess){
   toast("请安装新版 APK 才能打开权限设置",true);return;
  }
  bridge().requestPhoneUsageAccess();
 };
 document.querySelector('.tabs button[data-page="sleep"]')?.addEventListener("click",()=>{
  bridge()?.sleepStatus?.();
  if(bridge()?.phoneSleepReports)$("phoneSleepRefresh").onclick();
 });
 $("vivoSleepRead").onclick=()=>{
  if(!bridge()?.vivoSleepProbe){
   $("vivoSleepResult").textContent="需要安装支持 vivo 健康读取测试的新版 APK。";
   return;
  }
  $("vivoSleepRead").disabled=true;
  $("vivoSleepBadge").textContent="读取中";
  $("vivoSleepResult").textContent="正在检测手机上的 vivo 健康接口与读取权限…";
  $("vivoSleepValues").hidden=true;
  bridge().vivoSleepProbe();
 };
 const vivoTime=ms=>new Date(Number(ms)).toLocaleString("zh-CN",{
  timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",
  day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false
 });
 const vivoLength=ms=>{
  const mins=Math.floor(Math.max(0,Number(ms)||0)/60000);
  return Math.floor(mins/60)+"小时"+String(mins%60).padStart(2,"0")+"分";
 };
 function renderVivoSleep(evt){
  $("vivoSleepRead").disabled=false;
  const pass=evt.capability==="PASS";
  $("vivoSleepBadge").textContent=pass?"✓ 已读取":
   evt.capability==="NOT_GRANTED"?"缺少权限":
   evt.capability==="UNSUPPORTED"?"不支持":
   evt.capability==="NO_DATA"?"暂无数据":"读取失败";
  $("vivoSleepResult").textContent=evt.message||"没有返回诊断结果";
  const list=$("vivoSleepValues");
  list.replaceChildren();list.hidden=!pass;
  if(!pass)return;
  const rows=[
   ["开始",vivoTime(evt.start_ms)],
   ["结束",vivoTime(evt.end_ms)],
   ["睡眠时长",vivoLength(evt.duration_ms)]
  ];
  for(const [label,key] of [
   ["浅睡","light_ms"],["深睡","deep_ms"],["REM","rem_ms"],["清醒","awake_ms"]]){
   if(Number.isFinite(Number(evt[key]))&&evt[key]!==undefined&&evt[key]!==null)
    rows.push([label,vivoLength(evt[key])]);
  }
  if(Number.isFinite(Number(evt.score))&&evt.score!==undefined)
   rows.push(["睡眠评分",String(evt.score)]);
  for(const [name,value] of rows){
   const item=document.createElement("div");
   const caption=document.createElement("span");caption.textContent=name;
   const number=document.createElement("strong");number.textContent=value;
   item.append(caption,number);list.appendChild(item);
  }
 }
 window.bodyTraceReceive=function(evt){
  if(typeof receiver==="function")receiver(evt);
  if(!evt||!evt.type)return;
  if(evt.type==="phone_sleep"){renderPhoneSleep(evt);return;}
  if(evt.type==="vivo_sleep"){renderVivoSleep(evt);return;}
  if(evt.type==="sleep_status"){
   recording=!!evt.recording;
   const previous=sessions.find(x=>x.id===selectedId);
   sessions=Array.isArray(evt.sessions)?evt.sessions:[];
   const updated=sessions.find(x=>x.id===selectedId);
   if(previous&&updated&&
     (previous.started_ms!==updated.started_ms||previous.date_basis!==updated.date_basis))
    startEditorSessionId="";
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
    const id=pendingAutoAnalyzeId;
    pendingAutoAnalyzeId="";
    selectSession(id);
   }else if(!busy&&!analysis&&selectedId)readCachedIfAvailable(selectedId);
  }else if(evt.type==="sleep_analysis"){
   busy=false;analysisStarting=false;loadingCachedId="";
   completedAnalysisId=evt.id||selectedId;
   clearAnalysisProgress();
   selectedId=evt.id||selectedId;analysis=evt;eventLimit=80;
   const hasAi=aiAvailable();
   $("sleepDetectionMode").value=detectorModeBySession.get(selectedId)||(hasAi?"ai":"level");
   const knownScore=$("sleepDetectionMode").value==="speech"?
    speechThresholdBySession.get(selectedId)??SPEECH_DEFAULT_SCORE:
    snoreThresholdBySession.get(selectedId)??AI_DEFAULT_SCORE;
   $("sleepSnoreThreshold").value=knownScore.toFixed(2);
   $("sleepSnoreThresholdText").textContent=knownScore.toFixed(2);
   if(!noiseBySession.has(selectedId)){
    const floor=estimateNoiseFloor(evt.levels_dbfs);
    if(floor!==null)noiseBySession.set(selectedId,floor);
   }
   const known=thresholdBySession.get(selectedId);
   setThreshold(known??((noiseFloor()??-42)+DEFAULT_ABOVE_BACKGROUND),false);
   analysis.background_dbfs=noiseFloor()??-40;
   applyLiveFilters(false);
   render();
   // Upgrade old 1-second RMS caches that are missing YAMNet scores once.
   if(!hasAi&&!recording&&!autoAnalysisAttemptedIds.has(selectedId)){
    autoAnalysisAttemptedIds.add(selectedId);
    analyze();
   }
  }else if(evt.type==="sleep_start_updated"){
   const target=sessions.find(x=>x.id===evt.id);
   if(target){
    target.started_ms=evt.started_ms;
    target.ended_ms=Number(evt.started_ms)+Number(target.duration_ms||0);
    target.date_basis="user_supplied";
   }
   if(analysis?.id===evt.id){
    analysis.started_ms=evt.started_ms;
    analysis.date_basis="user_supplied";
    window.BodyTraceSleepVisual?.setTimeMode?.("clock");
    renderEvents();
   }
   startEditorSessionId="";
   render();
   toast("已保存真实时间轴，不需要重新分析 AI");
  }else if(evt.type==="sleep_recording_finished"){
   // Recording file and metadata have been finalized on the service side.
   if(evt.saved&&evt.id)pendingAutoAnalyzeId=evt.id;
   $("sleepRecordingResult").textContent=evt.saved?
    "✓ 已保存在 APP 本机存储 · "+((Number(evt.bytes)||0)/1048576).toFixed(2)+
      " MB · "+duration((Number(evt.duration_ms)||0)/1000):
    "录音保存失败："+(evt.message||"请查看详情");
   bridge()?.sleepStatus?.();
  }else if(evt.type==="sleep_exported"){
   $("sleepRecordingResult").textContent="✓ 已导出 M4A 至所选手机文件夹，APP 内原件保留";
   toast("导出成功 · "+((Number(evt.bytes)||0)/1048576).toFixed(2)+" MB");
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
   if(evt.id!==selectedId)return;
   playbackActive=!!evt.playing;
   if(evt.playing){
    $("sleepPlaybackStatus").textContent=
     (evt.skip?"跳过安静段 · ":"连续播放 · ")+
     "第 "+evt.segment_index+"/"+evt.total_segments+" 段 · "+
     duration(evt.start_sec||0);
   }else $("sleepPlaybackStatus").textContent="播放已结束或停止";
  }else if(evt.type==="sleep_playback_position"){
   if(evt.id!==selectedId||!evt.playing)return;
   playbackActive=true;
   const played=Math.max(0,Number(evt.position_ms)||0)/1000;
   const hh=pad(Math.floor(played/3600));
   const mm=pad(Math.floor(played%3600/60));
   const ss=pad(Math.floor(played%60));
   $("sleepPlaybackStatus").textContent=
    (evt.skip?"跳过安静段":"连续播放")+" · "+hh+":"+mm+":"+ss+
    " · 第 "+evt.segment_index+"/"+evt.total_segments+" 段";
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

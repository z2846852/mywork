/* BodyTrace sleep screen: local-only recording, offline analysis and clip review. */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const receiver=window.bodyTraceReceive;
 let recording=false,sessions=[],selectedId="",analysis=null,busy=false,sleepView="browser";
 let comparisonThreshold=null;
 let wearableEditorId="",wearableSaving=false,experimentUploading="";
 const experimentUploadResults=new Map();
 let pendingDelete="";
 let eventLimit=80,feedbackEventLimit=40;
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
  eventLimit=80;feedbackEventLimit=40;
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
 const nightNumber=v=>v===null||v===undefined||!Number.isFinite(Number(v))?null:Number(v);
 const nightFmt=v=>nightNumber(v)===null?"—":duration(Math.max(0,Number(v)));
 const nightRate=x=>x?.valid_seconds>0&&nightNumber(x.episodes_per_hour)!==null?Number(x.episodes_per_hour).toFixed(1)+" 次/h":"—";
 const nightMode=x=>!x?"待分析":x.source==="offline"?"离线回算":x.armed_seconds>0?(x.silent_seconds>0?"混合":"反馈开启"):(x.valid_seconds>0?"静默":"无有效窗口");
 const nightMetrics=session=>comparisonThreshold===null?session?.snore_metrics:session?.comparison_metrics;
 function nightValue(session,key){
  const m=nightMetrics(session);
  if(key==="sleep_quality")return nightNumber(session?.sleep_quality);
  if(key==="snore_fraction")return m?.valid_seconds>0?100*m.snore_seconds/m.valid_seconds:null;
  if(["episodes_per_hour","snore_seconds"].includes(key)&&!(m?.valid_seconds>0))return null;
  return nightNumber(m?.[key]);
 }
 function nightValueText(v,key){
  if(v===null)return "—";
  if(key==="snore_seconds")return nightFmt(v);
  if(key==="episodes_per_hour")return v.toFixed(1)+" 次/h";
  if(key==="snore_fraction")return v.toFixed(1)+"%";
  return String(v);
 }
 function nightBar(root,label,value,max,detail,offline,onClick){
  const row=document.createElement("div");row.style.cssText="display:grid;grid-template-columns:minmax(70px,110px) 1fr minmax(48px,auto);align-items:center;gap:5px;font-size:12px";
  const name=document.createElement(onClick?"button":"span");name.textContent=label;name.title=detail||label;
  if(onClick){name.type="button";name.className="secondary mini";name.style.cssText="padding:2px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";name.onclick=onClick;}
  const track=document.createElement("div");track.style.cssText="height:10px;border-radius:3px;background:rgba(128,128,128,.17);overflow:hidden";
  const fill=document.createElement("div");fill.style.cssText="height:100%;border-radius:3px;background:"+(offline?"#879bb7":"#43a88d");
  fill.style.width=value===null?"0%":Math.max(0,Math.min(100,value/max*100))+"%";track.append(fill);
  const count=document.createElement("span");count.textContent=detail;count.style.textAlign="right";
  row.append(name,track,count);root.append(row);
 }
 function renderNightHistory(){
  const root=$("sleepNightHistoryChart");if(!root)return;root.replaceChildren();
  const key=$("sleepNightHistoryMetric").value;
  const rows=sessions.filter(s=>s.status!=="recording").slice(0,14).reverse();
  const max=Math.max(key==="sleep_quality"?5:key==="snore_fraction"?100:1,...rows.map(s=>nightValue(s,key)??0));
  for(const s of rows){
   const val=nightValue(s,key),m=nightMetrics(s);
   const label=s.date_basis==="imported_at"?(s.original_name||"导入"):(s.started_ms?new Date(s.started_ms).toLocaleDateString("zh-CN",{month:"numeric",day:"numeric",timeZone:"Asia/Shanghai"}):"未知");
   nightBar(root,label+(m?.source==="offline"?" 离":!m?" 待":""),val,max,nightValueText(val,key),m?.source==="offline",()=>selectSession(s.id));
  }
  if(!rows.length)root.textContent="暂无历史录音";
 }
 function wearableTemplate(chosen){
  const iso=ms=>new Date(ms+8*3600000).toISOString().slice(0,19)+"+08:00";
  return {schema_version:1,coverage_start:iso(Number(chosen.started_ms)),coverage_end:iso(Number(chosen.started_ms)+Number(chosen.duration_ms)),uncertainty_seconds:120,baseline_bpm:null,sleep_score:null,sleep_minutes:null,awake:[],heart_rate_peaks:[]};
 }
 function renderWearable(chosen){
  const data=chosen.wearable_review_v1,root=$("sleepWearableTimeline"),summary=$("sleepWearableSummary"),editor=$("sleepWearableJson");
  if(!root||!editor)return;
  const disabled=recording||busy||chosen.status==="recording"||wearableSaving||!bridge()?.sleepSaveWearableReview;
  for(const id of ["sleepWearableSave","sleepWearableClear","sleepWearableTemplate"])$(id).disabled=disabled;
  $("sleepWearableExport").disabled=recording||busy||!bridge()?.sleepFeedbackExportSession;
  $("sleepExperimentUpload").disabled=recording||busy||!!experimentUploading||!bridge()?.sleepUploadExperiment;
  $("sleepExperimentUpload").textContent=experimentUploading===chosen.id?"上传中…":"同步本晚";
  $("sleepExperimentUploadStatus").textContent=experimentUploadResults.get(chosen.id)||
    (chosen.experiment_uploaded_path?"曾同步 · 修改后可再次同步":"仅手动上传结构化 JSON 到私有数据仓库");
  if(wearableEditorId!==chosen.id){wearableEditorId=chosen.id;editor.value=data?JSON.stringify(data,null,2):"";$("sleepWearableStatus").textContent="";}
  root.replaceChildren();
  if(!data){summary.textContent="尚未录入手环数据 · 可先复制本晚实验 JSON 与完整手环截图";return;}
  const start=Date.parse(data.coverage_start),end=Date.parse(data.coverage_end),tol=Number(data.uncertainty_seconds)*1000;
  const awake=Array.isArray(data.awake)?data.awake:[],peaks=Array.isArray(data.heart_rate_peaks)?data.heart_rate_peaks:[];
  const journal=analysis?.id===chosen.id&&analysis.feedback_journal_version&&!analysis.feedback_journal_error?
    (analysis.feedback_events||[]) : null;
  const cues=journal?.filter(e=>e.kind==="cue")??null;
  const outcomeByTrial=new Map(),reportsByTrial=new Map();
  for(const e of journal||[]){
   if(!e.trial_id)continue;
   if(e.kind==="trial_outcome")outcomeByTrial.set(e.trial_id,e);
   if(e.kind==="self_report"){const list=reportsByTrial.get(e.trial_id)||[];list.push(e.report);reportsByTrial.set(e.trial_id,list);}
  }
  const baseline=nightNumber(data.baseline_bpm);
  const label=t=>clock(t);
  const text=["截图估算 ±"+data.uncertainty_seconds+"s",label(start)+"–"+label(end),"清醒标记 "+awake.length+" 段","心率峰 "+peaks.length+" 个"];
  if(baseline!==null)text.push("基准 "+baseline+" bpm");
  if(nightNumber(data.sleep_score)!==null)text.push("评分 "+data.sleep_score);
  if(nightNumber(data.sleep_minutes)!==null)text.push("睡眠 "+data.sleep_minutes+" 分");
  summary.textContent=text.join(" · ");
  // Each marker can be near several cues. Keep every match rather than invent causality.
  const rows=(cues||[]).map(e=>({e,t:Number(e.time_ms)||Number(chosen.started_ms)+Number(e.offset_ms)})).filter(x=>Number.isFinite(x.t)).sort((a,b)=>a.t-b.t);
  let covered=0,near=0;
  for(const {e,t} of rows){
   const from=t-tol,to=t+tol+60000;
   const inRange=from>=start&&to<=end;
   if(inRange)covered++;
   const aw=awake.filter(x=>Date.parse(x.end)>=from&&Date.parse(x.start)<=to);
   const hr=peaks.filter(x=>Date.parse(x.time)>=from&&Date.parse(x.time)<=to);
   if(inRange&&(aw.length||hr.length))near++;
   const row=document.createElement("div");row.className="sleep-recorded-feedback-row";
   const info=document.createElement("div"),title=document.createElement("strong"),detail=document.createElement("small");
   const p=e.parameters||{};
   title.textContent=label(t)+" · "+[e.sound_enabled?"声 "+(e.volume??"—")+"%":"",e.vibration?"振 "+(p.vibrationAmplitude??"—")+"%":""].filter(Boolean).join(" / ");
   const rel=ms=>{const n=Math.round((ms-t)/1000);return (n>=0?"+":"")+n+"s";};
   const markers=[...aw.map(x=>"清醒 "+label(Date.parse(x.start))+" ("+rel(Date.parse(x.start))+")"),...hr.map(x=>"心率 "+x.bpm+" bpm ("+rel(Date.parse(x.time))+(baseline!==null?", 基准差 "+(x.bpm-baseline)+"":"")+")")];
   const outcome=outcomeByTrial.get(p.trial_id),reports=reportsByTrial.get(p.trial_id)||[];
   const reportLabels={gain_hold:"保持",gain_too_strong:"太强/太吵",gain_too_weak:"太弱",felt_vibration:"感到振动",heard_snoring:"听到鼾声",aware_snoring:"意识到打鼾",turned_side:"翻身",awake_unsure:"醒来原因未知"};
   const result=outcome?("AI "+outcome.snore_seconds+"/"+outcome.valid_seconds+"s"+(outcome.result==="incomplete"?"（观察不完整）":"")):"AI结果未知";
   detail.textContent=[result,...reports.map(v=>reportLabels[v]||v),markers.length?markers.join(" · ")+(inRange?"":" · 覆盖不完整"):inRange?"截图未标记（不等于未觉醒）":"手环覆盖不足"].join(" · ");
   info.append(title,detail);row.append(info);root.append(row);
  }
  summary.textContent+=" · "+(cues===null?"刺激日志待加载或未知":near+"/"+covered+" 个完整覆盖刺激附近有标记");
  if(!rows.length)root.textContent=cues===null?"暂无可对齐的刺激日志":"本晚无自动刺激记录";
 }
 function renderNightExperiment(chosen){
  const panel=$("sleepNightExperiment");if(!panel)return;
  panel.hidden=!chosen||sleepView!=="metrics";
  if(!chosen)return;
  const m=nightMetrics(chosen), mode=nightMode(m), comparing=comparisonThreshold!==null;
  const compare=$("sleepNightCompare"),rebuild=$("sleepNightRebuild");
  if(compare){compare.textContent=comparing?"返回原始指标":"统一回算";compare.disabled=recording||busy;compare.setAttribute("aria-pressed",String(comparing));}
  if(rebuild){rebuild.hidden=!comparing||!!m;rebuild.disabled=recording||busy||!!loadingCachedId;}
  if($("sleepNightCompareHint"))$("sleepNightCompareHint").textContent=comparing?"统一离线 · AI ≥"+comparisonThreshold.toFixed(2)+" · 全部历史同口径，原始数据不变":"按当前反馈 AI 阈值统一回算历史及本次录音";
  $("sleepNightSummary").textContent=m?(comparing?"统一回算":mode)+" · 有效 "+nightFmt(m.valid_seconds)+(m.source==="offline"?" · AI ≥"+Number(m.threshold??0.15).toFixed(2)+(!m.journal_known?" · 反馈日志未知":""):""):
    comparing?(chosen.comparison_metrics_error?"统一回算失败，点刷新重试":"暂无同模型 AI 缓存，请补全后比较"):chosen.snore_metrics_error?"缓存读取失败，点刷新重试":"暂无 AI 指标，选择录音后可分析";
  const kpis=$("sleepNightKpis");kpis.replaceChildren();
  const metrics=[["鼾声频率",nightRate(m)],["累计时长",nightValueText(nightValue(chosen,"snore_seconds"),"snore_seconds")],["时间占比",nightValueText(nightValue(chosen,"snore_fraction"),"snore_fraction")],["声音反馈",nightValueText(nightValue(chosen,"sound_count"),"sound_count")],["振动反馈",nightValueText(nightValue(chosen,"vibration_count"),"vibration_count")],["混合反馈",nightValueText(nightValue(chosen,"mixed_count"),"mixed_count")]];
  for(const [label,value] of metrics){const box=document.createElement("div");box.style.cssText="padding:4px;border:1px solid rgba(128,128,128,.25);border-radius:5px;min-width:0";
   const title=document.createElement("small"),number=document.createElement("strong");title.textContent=label;title.style.cssText="display:block;opacity:.75;font-size:11px";number.textContent=value;number.style.cssText="display:block;font-size:14px";box.append(title,number);kpis.append(box);}
  const quality=$("sleepNightQuality");quality.value=String(chosen.sleep_quality||0);
  quality.disabled=chosen.status==="recording"||recording||typeof bridge()?.sleepRateNight!=="function";
  quality.onchange=()=>bridge()?.sleepRateNight?.(chosen.id,Number(quality.value));
  renderWearable(chosen);
  const hourly=m?.hourly||[],chart=$("sleepNightHourlyChart");chart.replaceChildren();
  const max=Math.max(1,...hourly.map(h=>h.valid_seconds>0?Number(h.episodes_per_hour)||0:0));
  hourly.forEach((h,i)=>{
   const offset=Number(h.offset_seconds)||i*3600;
   const label=chosen.date_basis==="imported_at"?"+"+(offset/3600)+"h":clock(Number(chosen.started_ms)+offset*1000);
   nightBar(chart,label,h.valid_seconds>0?nightNumber(h.episodes_per_hour):null,max,nightRate(h),m.source==="offline");
  });
  if(!hourly.length)chart.textContent="暂无小时指标";
  const hourLines=hourly.map((h,i)=>"第"+(i+1)+"小时 · "+nightRate(h)+" · 鼾声 "+(h.valid_seconds>0?nightFmt(h.snore_seconds):"—")+" · 有效 "+nightFmt(h.valid_seconds));
  const responses=(m?.responses||[]).map(r=>nightFmt(r.offset_ms/1000)+" "+(r.sound&&r.vibration?"混合":r.sound?"声音":"震动")+" · "+(!r.observed?"未获得有效观察":(r.censored?"至少 ":"")+nightFmt(r.quiet_seconds)+(r.censored?"（观察中断/结束）":"")));
  $("sleepNightDetail").textContent=[...hourLines,...responses,...(m?.source==="offline"?["历史回算不能还原实时反馈后的未检出时长"]:[])].join("\n")||"暂无有效记录";
  $("sleepNightHistory").textContent=sessions.slice(0,14).map(s=>{const n=nightMetrics(s);return time(s.started_ms)+" · "+nightMode(n)+" · "+nightRate(n)+" · "+nightValueText(nightValue(s,"snore_seconds"),"snore_seconds")+" · 声 "+nightValueText(nightValue(s,"sound_count"),"sound_count")+" · 评分 "+(s.sleep_quality||"—");}).join("\n")||"暂无记录";
  renderNightHistory();
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
  renderNightExperiment(chosen);
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
 function renderRecordedFeedback(){
  const panel=$("sleepRecordedFeedback"),root=$("sleepRecordedFeedbackList");
  const valid=analysis?.id===selectedId;
  panel.hidden=!valid;$("sleepFeedbackTimelineLegend").hidden=!valid||!analysis?.feedback_events?.length;
  root.replaceChildren();if(!valid)return;
  const items=Array.isArray(analysis.feedback_events)?analysis.feedback_events:[];
  const cues=items.filter(e=>e.kind==="cue"),sounds=cues.filter(e=>e.sound_enabled??!e.vibration),vibrations=cues.filter(e=>e.vibration);
  const previews=items.filter(e=>e.kind==="preview").length,manual=items.filter(e=>e.kind==="manual").length;
  $("sleepRecordedFeedbackSummary").textContent=analysis.feedback_journal_error?"日志读取失败："+analysis.feedback_journal_error:!analysis.feedback_journal_version?"旧录音或导入文件：未记录反馈事件，无法追溯是否播放。":`自动反馈 ${cues.length} 次 · 声音 ${sounds.length} · 震动 ${vibrations.length} · 试听 ${previews} · 标记 ${manual}`;
  $("sleepFeedbackSessionExport").disabled=!analysis.feedback_journal_version||!bridge()?.sleepFeedbackExportSession;
  const filter=$("sleepRecordedFeedbackFilter").value;
  const filtered=items.filter(e=>filter==="all"||filter===e.kind||filter==="sound"&&e.kind==="cue"&&(e.sound_enabled??!e.vibration)||filter==="vibrate"&&e.kind==="cue"&&e.vibration||filter==="switch"&&["feedback_on","feedback_off"].includes(e.kind)).sort((a,b)=>Number(a.offset_ms)-Number(b.offset_ms));
  for(const e of filtered.slice(0,feedbackEventLimit)){
   const sec=Math.max(0,Number(e.offset_ms)||0)/1000;
   const label=window.BodyTraceSleepVisual?.formatTime?.(sec,analysis.id)||clock(analysis.started_ms+sec*1000);
   const selfLabels={gain_hold:"保持强度",gain_too_strong:"太强/太吵",gain_too_weak:"太弱",felt_vibration:"感到振动",heard_snoring:"听到自己的鼾声",aware_snoring:"意识到自己在打鼾",turned_side:"已翻身侧睡",awake_unsure:"醒来原因不确定"};
   const name=e.kind==="trial_outcome"?({stopped:"鼾声候选减少",continued:"仍有鼾声候选",incomplete:"观察不完整"}[e.result]||"试验结果"):e.kind==="self_report"?(selfLabels[e.report]||"夜间自报"):e.kind==="feedback_on"?"开启反馈":e.kind==="feedback_off"?"关闭反馈":e.kind==="manual"?"手动标记":e.kind==="preview"?"手动试听":e.kind==="control"?"无刺激对照":"自动"+(e.vibration&&e.sound_enabled?"声音＋震动":e.vibration?"震动":"提示音");
   const sound=[...$("sleepFeedbackSound").options].find(o=>o.value===e.sound)?.textContent.split(" · ")[0]||e.sound||"";
   const meta=[];if(e.kind==="self_report")meta.push(e.linked?"关联近期刺激":"未关联刺激");if(e.kind==="trial_outcome")meta.push(`${e.snore_seconds||0}/${e.valid_seconds||0}s 鼾声候选`);if(e.kind!=="control"&&e.kind!=="self_report"&&e.kind!=="trial_outcome"){if(e.sound_enabled??!e.vibration){if(e.sound)meta.push(sound+" · "+e.volume+"%");}if(e.vibration)meta.push((e.parameters?.vibrationPattern||"震动")+" · "+(e.parameters?.vibrationAmplitude??"系统默认")+"%");}if(Number.isFinite(e.score))meta.push("AI "+e.score.toFixed(3));if(Number(e.planned_duration_ms)>0)meta.push((e.planned_duration_ms/1000).toFixed(2)+"s");
   if(Number.isFinite(e.detector_offset_ms))meta.push("检测 "+(window.BodyTraceSleepVisual?.formatTime?.(e.detector_offset_ms/1000,analysis.id)||duration(e.detector_offset_ms/1000)));
   const row=document.createElement("div");row.className="sleep-recorded-feedback-row";const info=document.createElement("div"),title=document.createElement("strong"),detail=document.createElement("small");title.textContent=label+" · "+name;detail.textContent=meta.join(" · ");info.append(title,detail);
   const controls=document.createElement("div");controls.className="actions";const focus=document.createElement("button"),play=document.createElement("button");focus.type=play.type="button";focus.className=play.className="secondary mini";focus.textContent="定位";play.textContent="回听";const from=Math.max(0,Math.floor(sec)-3),end=Math.min(analysis.levels_dbfs.length,Math.ceil(sec+Math.max(3,(Number(e.planned_duration_ms)||0)/1000+3)));
   focus.onclick=()=>window.BodyTraceSleepVisual?.focusFeedback?.(sec);play.onclick=()=>{window.BodyTraceSleepVisual?.focusFeedback?.(sec);bridge()?.sleepPlay?.(analysis.id,from,Math.max(1,end-from));};play.disabled=recording||end<=from;controls.append(focus,play);row.append(info,controls);root.append(row);
  }
  if(filtered.length>feedbackEventLimit){const more=document.createElement("button");more.type="button";more.className="secondary mini";more.textContent="更多 "+feedbackEventLimit+"/"+filtered.length;more.onclick=()=>{feedbackEventLimit+=40;renderRecordedFeedback();};root.append(more);}
  if(!filtered.length&&analysis.feedback_journal_version&&!analysis.feedback_journal_error)root.textContent="当前筛选没有记录";
 }
 $("sleepRecordedFeedbackFilter").onchange=()=>{feedbackEventLimit=40;renderRecordedFeedback();};
 $("sleepShowFeedbackMarkers").onchange=()=>window.BodyTraceSleepVisual?.refreshFilters?.();
 $("sleepFeedbackSessionExport").onclick=()=>{if(analysis?.id===selectedId)bridge()?.sleepFeedbackExportSession?.(selectedId);};
 function renderEvents(){
  renderRecordedFeedback();
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
 function analyze(forceNative=false){
  forceNative=forceNative===true;
  if(busy||!!loadingCachedId||!current()||recording)return;
  const threshold=Number($("sleepThreshold").value);
  const seconds=Number($("sleepMinSeconds").value);
  const gap=Number($("sleepGapSeconds").value);
  if(!Number.isInteger(seconds)||seconds<1||seconds>120||
    !Number.isInteger(gap)||gap<0||gap>5){
   toast("最短持续时间限制1–120秒，间断时间限制0–5秒",true);return;
  }
  const ready=analysis?.id===selectedId&&aiAvailable();
  if(!forceNative&&current()?.levels_cached&&ready&&bridge()?.sleepReadCached){
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
 function refreshNightMetrics(){
  if(!bridge()?.sleepStatus){toast("请在 Android APP 内查看本机录音",true);return;}
  bridge().sleepStatus();
  toast("正在刷新录音及实验指标");
 }
 $("sleepRefresh").onclick=refreshNightMetrics;
 $("sleepNightRefresh")?.addEventListener("click",refreshNightMetrics);
 $("sleepNightRefreshPanel")?.addEventListener("click",refreshNightMetrics);
 $("sleepNightCompare")?.addEventListener("click",()=>{
  if(!bridge()?.sleepCompareMetrics){toast("请升级完整 APK 后使用统一回算",true);return;}
  bridge().sleepCompareMetrics(comparisonThreshold===null);
  toast(comparisonThreshold===null?"正在按当前反馈阈值统一回算":"正在恢复原始指标");
 });
 $("sleepNightRebuild")?.addEventListener("click",()=>analyze(true));
 $("sleepWearableEdit")?.addEventListener("click",()=>{$("sleepWearableEditor").open=!$("sleepWearableEditor").open;});
 $("sleepWearableExport")?.addEventListener("click",()=>{if(current())bridge()?.sleepFeedbackExportSession?.(current().id);});
 $("sleepExperimentUpload")?.addEventListener("click",()=>{
  const chosen=current();if(!chosen||recording||busy||experimentUploading||!bridge()?.sleepUploadExperiment)return;
  if(!confirm("将本晚鼾声指标、反馈日志、主观及手环标记上传到私有 GitHub 数据仓库？不上传音频或截图。"))return;
  experimentUploading=chosen.id;experimentUploadResults.set(chosen.id,"正在上传本晚 JSON…");renderWearable(chosen);
  bridge().sleepUploadExperiment(chosen.id);
 });
 $("sleepWearableTemplate")?.addEventListener("click",()=>{if(current()&&(!$("sleepWearableJson").value.trim()||confirm("替换编辑框内容？未保存的修改会丢失。")))$("sleepWearableJson").value=JSON.stringify(wearableTemplate(current()),null,2);});
 function saveWearable(clear=false){
  const chosen=current();if(!chosen||busy||recording||wearableSaving||!bridge()?.sleepSaveWearableReview)return;
  const raw=$("sleepWearableJson").value.trim();
  if(clear){if(!confirm("仅删除所选录音的手环数据？原始录音和反馈不变。"))return;}
  else {try{if(!raw||!JSON.parse(raw))throw Error();}catch(e){$("sleepWearableStatus").textContent="请输入有效 JSON";return;}}
  wearableSaving=true;renderWearable(chosen);
  $("sleepWearableStatus").textContent="正在保存…";
  bridge().sleepSaveWearableReview(chosen.id,clear?"":raw);
 }
 $("sleepWearableSave")?.addEventListener("click",()=>saveWearable());
 $("sleepWearableClear")?.addEventListener("click",()=>saveWearable(true));
 $("sleepNightHistoryMetric")?.addEventListener("change",renderNightHistory);
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
   comparisonThreshold=nightNumber(evt.comparison_threshold);
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
  }else if(evt.type==="sleep_experiment_uploaded"){
   experimentUploading="";
   experimentUploadResults.set(evt.id,evt.ok?"✓ 已同步本晚 JSON":"同步失败（本地仍保留）："+(evt.message||"未知错误"));
   if(current())renderWearable(current());
   toast(evt.ok?"本晚实验已同步":(evt.message||"同步失败"),!evt.ok);
  }else if(evt.type==="sleep_wearable_saved"){
   wearableSaving=false;
   if(evt.id===selectedId){
    if(evt.ok){wearableEditorId="";$("sleepWearableStatus").textContent="已保存本晚手环数据";toast("手环数据已保存");}
    else{$("sleepWearableStatus").textContent=evt.message||"保存失败";renderWearable(current());}
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

 // The input and output graphs are independent: PCM monitoring works without cues,
 // and synthesized cue previews work without microphone permission.
 (function initSnoreFeedback(){
  const ids=["sleepFeedbackSound","sleepFeedbackVolume","sleepFeedbackThreshold","sleepFeedbackDecaySeconds","sleepFeedbackDirectGain","sleepFeedbackDirectExtend",
   "sleepFeedbackMinimum","sleepFeedbackRepeat","sleepFeedbackVibrate","sleepFeedbackSoundEnabled","sleepFeedbackSoundPool","sleepFeedbackVibrationPool","sleepFeedbackVibrationCompatibility","sleepFeedbackSoundRhythm","sleepFeedbackSoundMs","sleepFeedbackSoundMax","sleepFeedbackVibrationPattern","sleepFeedbackVibrationAmplitude","sleepFeedbackVibrationMs","sleepFeedbackVibrationMax","sleepFeedbackMode","sleepFeedbackDelayMinutes","sleepFeedbackMaxCues","sleepFeedbackSoundMin","sleepFeedbackVibrationMin","sleepFeedbackSoundMsMax","sleepFeedbackVibrationMsMax","sleepFeedbackSoundRhythmPool","sleepFeedbackPauseOnScreen"];
  let micActive=false,recordActive=false,feedbackActive=false;
  let selfState={},selfPending=false,selfTimer=0;
  const selfButtons=[...$("sleepSelfReport").querySelectorAll("[data-report]")];
  function renderSelfReport(state){
   selfState=state||{};
   $("sleepSelfReport").hidden=false;
   const cue=selfState.cue||{},checked=selfState.checked||{};
   $("sleepSelfCue").textContent=selfState.trial_id?"最近刺激 "+clock(cue.started_ms||cue.time_ms)+" · "+(cue.direct_gain_percent?"强度 "+cue.direct_gain_percent+"% · ":"")+(cue.soundEnabled?"声音 "+cue.volume+"% ":"")+(cue.vibrate?"振动 "+cue.vibrationAmplitude+"%":"")+(cue.direct_repeats===2?" · 双播":""):(recordActive?"当前感受 · 无可关联的近期刺激":"等待反馈；有刺激后可确认强度");
   for(const button of selfButtons){
    const kind=button.dataset.report,adjust=kind.startsWith("gain_"),repeatable=kind==="gain_too_strong"||kind==="gain_too_weak";const done=!repeatable&&!!checked[kind];button.classList.toggle("checked",done);
    button.setAttribute("aria-pressed",String(done));button.disabled=selfPending||done||(adjust?!selfState.gain_adjustable:!recordActive&&!selfState.gain_adjustable);
   }
  }
  for(const button of selfButtons)button.onclick=()=>{
   if(selfPending||button.disabled)return;
   if(!bridge()?.sleepExperimentSelfReport){$("sleepSelfStatus").textContent="请更新完整 APK";return;}
   selfPending=true;renderSelfReport(selfState);
   selfTimer=setTimeout(()=>{selfPending=false;renderSelfReport(selfState);$("sleepSelfStatus").textContent="未收到保存确认，刷新后查看";},10000);
   bridge().sleepExperimentSelfReport(button.dataset.report,selfState.trial_id||"");
  };
  $("sleepSelfRefresh").onclick=()=>bridge()?.sleepFeedbackStatus?.();
  let consoleTab="night",lastExperiment={},reportExpiryRequested="";
  let soundMaterials=[],vibMaterials=[],nextDirectGain=10,directLocked=false,directCanExtend=false;
  const consoleTabs=[...$("sleepFeedbackPanel").querySelectorAll("[data-console]")];
  function setConsoleTab(tab){
   if(consoleTab==="materials"&&tab!=="materials")stopPad();
   consoleTab=tab;
   for(const b of consoleTabs){const active=b.dataset.console===tab;b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active));}
   for(const [id,key] of [["sleepConsoleNight","night"],["sleepConsoleTest","test"],["sleepConsoleMaterials","materials"],["sleepConsoleSettings","settings"]])$(id).hidden=tab!==key;
   $("sleepConsoleLive").hidden=tab!=="night"&&tab!=="test";
   if(tab==="night"||tab==="test")requestAnimationFrame(()=>{micGraph();if(tab==="test")speakerGraph();});
   if(tab==="materials"){renderMaterials();bridge()?.sleepFeedbackStatus?.();}
  }
  consoleTabs.forEach(b=>b.onclick=()=>setConsoleTab(b.dataset.console));
  $("sleepConsoleRefresh").onclick=()=>bridge()?.sleepFeedbackStatus?.();
  $("sleepConsoleRecord").onclick=()=>{if(recordActive){$("sleepFeedbackInfo").textContent="正在录音；如需结束请到录音页停止并保存。";switchPage("browser");}else if(bridge()?.sleepStart){$("sleepFeedbackInfo").textContent="正在启动录音…";bridge().sleepStart();}};
  $("sleepConsoleArm").onclick=()=>{
   if(!recordActive&&!feedbackActive&&cfg().mode!=="direct"){$("sleepFeedbackInfo").textContent="请先开始录音，再开启实验反馈";return;}
   $("sleepFeedbackEnabled").checked=!feedbackActive;$("sleepFeedbackEnabled").onchange();
  };
  const reportLabels={gain_hold:"保持强度",gain_too_strong:"太强/太吵",gain_too_weak:"太弱",felt_vibration:"感到振动",heard_snoring:"听到鼾声",aware_snoring:"意识到打鼾",turned_side:"翻身",awake_unsure:"醒来原因未知"};
  function renderTrialBoard(e){
   const root=$("sleepConsoleTrials");root.replaceChildren();
   const trials=Array.isArray(e.recent_trials)?e.recent_trials:[];
   if(!trials.length){root.textContent="暂无试验；开始后自动更新。";return;}
   for(const t of [...trials].reverse()){
    const row=document.createElement("div");row.className="sleep-trial-row";
    const head=document.createElement("div");head.className="sleep-trial-head";
    const stimulus=t.control?"无刺激对照":[t.vibrate?"振动 "+t.vibrationAmplitude+"% / "+(t.actualVibrationMs||t.vibrationMs)+"ms":"",t.soundEnabled?"声音 "+t.volume+"%":""].filter(Boolean).join(" ＋ ");
    const left=document.createElement("strong");left.textContent=clock(t.time_ms)+" · "+stimulus;
    const result=document.createElement("span");result.className="sleep-trial-result "+t.result;result.textContent=({pending:"待观察",stopped:"低鼾",continued:"持续",incomplete:"不完整"}[t.result]||"未知");head.append(left,result);row.append(head);
    const info=document.createElement("small");info.textContent=t.result==="pending"?"等待30秒有效观测":(t.snore_seconds||0)+"/"+(t.valid_seconds||0)+"秒鼾声候选"+(t.screen_on?" · 亮屏":"");row.append(info);
    const tags=document.createElement("div");tags.className="sleep-trial-tags";
    for(const [key,name] of Object.entries(reportLabels)){const tag=document.createElement("span");tag.className=t.reports?.[key]?"confirmed":"unknown";tag.textContent=(t.reports?.[key]?"✓ ":"? ")+name;tags.append(tag);}row.append(tags);root.append(row);
   }
  }
  function renderPlan(e=lastExperiment){
   const c=cfg(),vt=e.vibration_threshold||{},mode=c.mode==="vibration_threshold",direct=c.mode==="direct";
   $("sleepConsoleState").textContent=feedbackActive?"自动反馈已开启":recordActive?"录音中 · 反馈关闭":micActive?"检测测试中":"未开始实验";
   $("sleepConsoleRecord").textContent=recordActive?"录音中 · 管理录音":"开始录音";
   $("sleepConsoleArm").textContent=feedbackActive?"关闭反馈":"开启反馈";
   $("sleepConsoleArm").disabled=false;
   $("sleepDirectGainRow").hidden=!direct;$("sleepDirectExtendRow").hidden=true;$("sleepDirectMaterials").hidden=!direct;
   $("sleepLadderLegend").textContent=direct?"每轮从10%档开始；30秒未检出则归零，观察不足不升档。最多12次/晚。":"绿：低鼾声候选；橙：仍有鼾声；灰：待测。";
   if(direct){
    const sound=$("sleepFeedbackSound").selectedOptions[0]?.textContent||c.sound,vib=$("sleepFeedbackVibrationPattern").selectedOptions[0]?.textContent||c.vibrationPattern;
    $("sleepConsoleConfig").textContent="每4声触发 · 观察30秒 · 仍有鼾声才升档 · 间隔≥60秒";
    $("sleepDirectMaterials").textContent="声音："+(c.soundEnabled?sound+"（上限 "+c.volume+"%）":"关闭")+"；振动："+(c.vibrate?vib+"（上限 "+c.vibrationAmplitude+"%）":"关闭");
    const gain=feedbackActive?nextDirectGain:(c.directGain?10:100);
    $("sleepConsoleNext").textContent="下一次 · "+(c.soundEnabled?"声音 "+Math.max(1,Math.round(c.volume*gain/100))+"% ":"")+(c.vibrate?"振动 "+Math.max(1,Math.round(c.vibrationAmplitude*gain/100))+"%":"")+(c.soundEnabled||c.vibrate?" · "+gain+"%档"+(feedbackActive&&directLocked?" · 已锁定":feedbackActive&&directCanExtend&&c.directExtend&&c.soundEnabled?" · 下次双播":""):"请启用反馈通道");
    const root=$("sleepThresholdLadder");root.replaceChildren();
    const levels=[...new Set([...(c.directGain?[10,20,30,40,50,60,70,80,90,100]:[100]),gain])].sort((a,b)=>a-b);
    for(const n of levels){const cell=document.createElement("div");cell.className="sleep-ladder-cell "+(n===gain?"next":n<gain?"passed":"untested");const title=document.createElement("strong");title.textContent=(n===gain?"▶ ":"")+n+"%";cell.append(title);root.append(cell);}
    return;
   }
   $("sleepConsoleConfig").textContent=(mode?"阈值搜索 · 纯振动":$("sleepFeedbackMode").selectedOptions[0]?.textContent||c.mode)+" · "+c.minimum+"声触发 · "+c.decaySeconds+"秒退格 · "+Math.max(mode?30:0,c.delayMinutes)+"分钟保护 · 最多"+Math.min(mode?8:40,c.maxCues)+"次"+(mode?" · 冷却5分钟":"");
   const root=$("sleepThresholdLadder");root.replaceChildren();
   const liveLevels=mode&&Array.isArray(vt.levels)&&vt.levels.length?vt.levels:null;
   const low=Math.min(c.vibrationMin,c.vibrationMax,e.vibrationLimit??100),high=Math.min(c.vibrationMax,e.vibrationLimit??100),cap=Math.min(c.vibrationMsMax,e.vibrationDurationLimit??2000,1500);
   let planned=[];
   if(mode&&!liveLevels&&high>=1&&cap>=100){
    const base=Math.min(500,cap),a=Math.max(1,low);
    for(let v=a;v<high;v+=20)planned.push({amplitude:v,duration_ms:base});
    planned.push({amplitude:high,duration_ms:base});
    for(const ms of [800,1200])if(ms>base&&ms<cap)planned.push({amplitude:high,duration_ms:ms});
    if(cap>base)planned.push({amplitude:high,duration_ms:cap});
    planned=planned.map((v,i)=>({...v,level:i+1,stopped:0,continued:0}));
   }
   const levels=liveLevels||planned,next=liveLevels?Number(vt.next_level):1;
   const selected=levels.find(v=>v.level===next);
   $("sleepConsoleNext").textContent=mode?(vt.upper_failures>=2?"最高档两次无响应 · 停止搜索":selected?"下一档 "+selected.amplitude+"% / "+selected.duration_ms+"ms · 第"+next+"/"+levels.length+"档":"无可用档位 · 检查排除限制"):"当前模式："+($("sleepFeedbackMode").selectedOptions[0]?.textContent||c.mode)+" · 应用今晚方案开启阶梯";
   if(!mode){root.textContent="当前不是阈值搜索模式。点击上方「应用今晚方案」。";return;}
   for(const level of levels){
    const cell=document.createElement("div");cell.className="sleep-ladder-cell "+(level.stopped?"passed":level.continued?"failed":"untested")+(level.level===next?" next":"");
    const title=document.createElement("strong");title.textContent=(level.level===next?"▶ ":"")+level.amplitude+"%";
    const detail=document.createElement("small");detail.textContent=level.duration_ms+"ms · "+(level.stopped||0)+"/"+((level.stopped||0)+(level.continued||0));
    cell.append(title,detail);root.append(cell);
   }
  }
  const micHistory=[];
  let latestSecond=-1,liveSpan=60,captureStart=0;
  const sensitivity={high:{threshold:.35,minimum:4},normal:{threshold:.50,minimum:4},low:{threshold:.65,minimum:4}};
  let outputWave=[],outputStarted=0,outputDuration=300,animation=0;
  const cfg=()=>({
   sound:$("sleepFeedbackSound").value,
   volume:Number($("sleepFeedbackVolume").value),
   ai_curve_version:1,threshold:Number($("sleepFeedbackThreshold").value),
   minimum:Math.max(3,Number($("sleepFeedbackMinimum").value)||4),trigger_episodes:Math.max(3,Number($("sleepFeedbackMinimum").value)||4),trigger_window_seconds:300,
   repeat:Number($("sleepFeedbackRepeat").value),decaySeconds:Number($("sleepFeedbackDecaySeconds").value),
   vibrate:$("sleepFeedbackVibrate").checked,
   soundEnabled:$("sleepFeedbackSoundEnabled").checked,
   soundPool:[...$("sleepFeedbackSoundPool").selectedOptions].map(o=>o.value).join(",")||"__none__",
   vibrationPool:[...$("sleepFeedbackVibrationPool").selectedOptions].map(o=>o.value).join(",")||"__none__",
   soundRhythm:$("sleepFeedbackSoundRhythm").value,soundMs:Number($("sleepFeedbackSoundMs").value),
   soundRhythmPool:[...$("sleepFeedbackSoundRhythmPool").selectedOptions].map(o=>o.value).join(",")||"__none__",
   soundMin:Number($("sleepFeedbackSoundMin").value),vibrationMin:Number($("sleepFeedbackVibrationMin").value),soundMsMax:Number($("sleepFeedbackSoundMsMax").value),vibrationMsMax:Number($("sleepFeedbackVibrationMsMax").value),pauseOnScreen:$("sleepFeedbackPauseOnScreen").checked,
   soundMax:Number($("sleepFeedbackSoundMax").value),vibrationMax:Number($("sleepFeedbackVibrationMax").value),
   vibrationCompatibility:$("sleepFeedbackVibrationCompatibility").checked,
   vibrationPattern:$("sleepFeedbackVibrationPattern").value,vibrationAmplitude:Number($("sleepFeedbackVibrationAmplitude").value),vibrationMs:Number($("sleepFeedbackVibrationMs").value),
   directGain:$("sleepFeedbackDirectGain").checked,directExtend:$("sleepFeedbackDirectExtend").checked,mode:$("sleepFeedbackMode").value,delayMinutes:Number($("sleepFeedbackDelayMinutes").value),maxCues:Number($("sleepFeedbackMaxCues").value)
  });
  function labels(){
   renderPlan();
   $("sleepFeedbackVolumeText").textContent=cfg().volume+"%";
   $("sleepDreamHint").hidden=!cfg().sound.startsWith("dream_");
   $("sleepFeedbackThresholdText").textContent=cfg().threshold.toFixed(2);
   $("sleepFeedbackMinimumText").textContent=cfg().minimum+" 声";
   $("sleepFeedbackRepeatText").textContent=cfg().repeat+" 秒";
   $("sleepFeedbackDecaySecondsText").textContent=cfg().decaySeconds+" 秒";
   $("sleepLiveSensitivity").value=Object.keys(sensitivity).find(k=>Math.abs(sensitivity[k].threshold-cfg().threshold)<.0001&&sensitivity[k].minimum===cfg().minimum)||"custom";
   $("sleepLivePresets").querySelectorAll("[data-sound]").forEach(b=>{const active=b.dataset.sound===cfg().sound;b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active));});
  }
  function save(){
   if(!bridge()?.sleepFeedbackSave){
    $("sleepFeedbackInfo").textContent="需完整安装支持实时声音控制台的新版 APK";
    return false;
   }
   if(bridge().sleepFeedbackSave(JSON.stringify(cfg()))!==true){
    $("sleepFeedbackInfo").textContent="保存设置失败";return false;
   }
   return true;
  }
  function graph(id,values,color,progress=1,autoScale=false){
   if($("sleepFeedbackPanel").hidden||consoleTab!=="test")return;
   const canvas=$(id);
   if(!canvas||typeof canvas.getContext!=="function")return;
   const ctx=canvas.getContext("2d");if(!ctx)return;
   const w=canvas.width,h=canvas.height,mid=h/2;
   ctx.fillStyle="#0b171b";ctx.fillRect(0,0,w,h);
   ctx.strokeStyle="#264147";ctx.lineWidth=1;
   for(const y of [h*.2,mid,h*.8]){
    ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();
   }
   for(let x=w/8;x<w;x+=w/8){
    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();
   }
   const gain=autoScale?Math.max(.005,...values):1;
   const dx=w/Math.max(1,values.length);
   ctx.lineWidth=Math.max(1.4,Math.min(3,dx*.68));
   for(let i=0;i<values.length;i++){
    const v=Math.max(0,Math.min(1,(Number(values[i])||0)/gain));
    const amp=Math.max(.6,v*(mid-13));
    const x=(i+.5)*dx;
    ctx.strokeStyle=color;
    ctx.globalAlpha=(i/values.length<=progress)?(.38+v*.55):.12;
    ctx.beginPath();ctx.moveTo(x,mid-amp);ctx.lineTo(x,mid+amp);ctx.stroke();
   }
   ctx.globalAlpha=1;
   if(progress>0&&progress<1){
    ctx.strokeStyle="#ffffff";ctx.lineWidth=1.4;
    ctx.beginPath();ctx.moveTo(w*progress,4);ctx.lineTo(w*progress,h-4);ctx.stroke();
   }
  }
  function micGraph(){
   if($("sleepFeedbackPanel").hidden||$("sleepConsoleLive").hidden)return;
   const rows=micHistory.slice(-liveSpan),threshold=cfg().threshold;
   window.BodyTraceLiveEnvelope?.($("sleepMicCanvas"),rows,threshold,liveSpan);
   window.BodyTraceLiveAiScore?.($("sleepAiScoreCanvas"),rows,threshold,liveSpan);
  }
  function micSecond(evt){
   const sec=Number(evt.second);if(!Number.isFinite(sec))return;
   if(sec<latestSecond)return;
   if(sec>latestSecond){
    if(latestSecond>=0){
     const gap=Math.min(59,sec-latestSecond-1);
     for(let i=gap;i>0;i--)micHistory.push({second:sec-i,rms_dbfs:-96,peak_dbfs:-96,short_rms_dbfs:-96});
    }
    micHistory.push({...evt});if(micHistory.length>60)micHistory.splice(0,micHistory.length-60);latestSecond=sec;
   }
   const db=Number(evt.rms_dbfs);
   $("sleepMicDbfs").textContent=Number.isFinite(db)?db.toFixed(1)+" dBFS":"—";
   const peak=Number(evt.peak_dbfs);$("sleepLivePeak").textContent=Number.isFinite(peak)?"峰值 "+peak.toFixed(1):"峰值 —";
   $("sleepLiveMark").disabled=!micActive||!bridge()?.sleepFeedbackMark;
   micGraph();
  }
  function speakerGraph(progress=1){
   graph("sleepSpeakerCanvas",outputWave,"#f2c27e",progress,true);
  }
  function animateOutput(){
   cancelAnimationFrame(animation);
   function frame(){
    const p=Math.min(1,(performance.now()-outputStarted)/outputDuration);
    speakerGraph(p);
    if(p<1)animation=requestAnimationFrame(frame);
    else {if(outputWave.length)$("sleepSpeakerNow").textContent="声音输出结束 · 保留波形";if($("sleepVibrationTrack").classList.contains("running")){$("sleepVibrationTrack").classList.remove("running");$("sleepVibrationNow").textContent="振动输出时段结束";}}
   }
   animation=requestAnimationFrame(frame);
  }
  function switchPage(page){
   if(page!=="feedback")stopPad();
   const live=page==="feedback",metrics=page==="metrics";
   sleepView=page;
   $("sleepBrowserPanel").hidden=live;
   $("sleepFeedbackPanel").hidden=!live;
   $("sleepAnalysisArea").hidden=metrics;
   $("sleepDeviceReports").hidden=metrics;
   for(const [id,pressed] of [["sleepFeedbackTab",live],["sleepBrowserTab",!live&&!metrics],["sleepMetricsTab",metrics]]){
    $(id).classList.toggle("active",pressed);
    $(id).setAttribute("aria-pressed",String(pressed));
   }
   renderNightExperiment(current());
   if(live){micGraph();speakerGraph();bridge()?.sleepFeedbackStatus?.();}
   else if(metrics)bridge()?.sleepStatus?.();
   else requestAnimationFrame(()=>window.BodyTraceSleepVisual?.refreshFilters?.());
  }
  function paintTriggerCount(evt){
   if($("sleepFeedbackPanel").hidden)return;
   if(evt.trigger_reason!==undefined)$("sleepTriggerReason").textContent=evt.trigger_reason;
   if(evt.ai_enter!==undefined)$("sleepPulseScores").textContent="AI 鼾声 "+Number(evt.context_snore||0).toFixed(3)+" · 进入 "+Number(evt.ai_enter).toFixed(2)+" / 退出 "+Number(evt.ai_exit).toFixed(2)+" · "+(evt.ai_curve_wait_low?"等待有效低谷":evt.ai_curve_active?"已计入，等待下降":"等待下一个鼾声峰")+(Number(evt.trigger_count)>0&&evt.decay_remaining!==undefined?" · "+evt.decay_remaining+"秒后退格":"");
   if(evt.direct_next_gain!==undefined){const n=Number(evt.direct_next_gain),locked=!!evt.direct_gain_locked,extend=!!evt.direct_can_extend;if(nextDirectGain!==n||directLocked!==locked||directCanExtend!==extend){nextDirectGain=n;directLocked=locked;directCanExtend=extend;renderPlan();}}
   const value="AI鼾声 "+(Number(evt.trigger_count)||0)+"/"+Math.max(3,Number(evt.trigger_required??evt.settings?.minimum)||4)+" · 起伏 "+(Number(evt.envelope_count)||0);
   const node=$("sleepTriggerCount");
   if(node.textContent!==value){node.textContent=value;const root=$("sleepTriggerProgress"),need=Math.max(3,Number(evt.trigger_required??evt.settings?.minimum)||4),count=Number(evt.trigger_count)||0;root.replaceChildren();for(let i=0;i<need;i++){const cell=document.createElement("i");cell.className=i<count?"hit":"";root.append(cell);}}
  }
  function status(evt){
   const oldMic=micActive;
   const session=Number(evt.capture_started_ms)||0;
   if(session&&session!==captureStart){captureStart=session;micHistory.length=0;latestSecond=-1;}
   micActive=!!evt.microphone_active;
   recordActive=!!evt.recording;
   feedbackActive=!!evt.active;
   renderSelfReport(evt.experiment?.self_report);
   const strip=$("sleepRecordingFeedback");strip.hidden=!recordActive;
   strip.textContent=(feedbackActive?"● 自动反馈开启":"○ 自动反馈关闭")+" · 本段声音 "+(evt.recording_sound_cues||0)+" · 震动 "+(evt.recording_vibration_cues||0)+(evt.journal_error?" · "+evt.journal_error:"");
   if(evt.journal_error)$("sleepFeedbackInfo").textContent=evt.journal_error;
   $("sleepMicBadge").textContent=recordActive?"● 录音共享中":
    micActive?"● 监听测试中":"未连接";
   $("sleepMicBadge").classList.toggle("active",micActive);
   $("sleepMicStart").disabled=micActive;
   $("sleepMicStop").disabled=!micActive||recordActive;
   $("sleepMicMode").textContent=recordActive?"共享录音 · 回录音页停止":micActive?"独立监听 · 不保存音频":"独立监听不保存音频";
   $("sleepLiveMark").disabled=!micActive||!bridge()?.sleepFeedbackMark;
   $("sleepLiveExport").disabled=!bridge()?.sleepFeedbackExportLog;
   renderEvents(evt.recent_events);
   $("sleepSpeakerBadge").textContent=feedbackActive?"● 自动反馈中":"自动反馈关闭";
   $("sleepSpeakerBadge").classList.toggle("active",feedbackActive);
   $("sleepFeedbackEnabled").checked=feedbackActive;
   $("sleepFeedbackCount").textContent=String(evt.cues||0);
   const count=Number(evt.inferred_windows)||0;
   $("sleepFeedbackScore").textContent=micActive&&count>0?Number(evt.last_score||0).toFixed(3):"—";
   paintTriggerCount(evt);
   $("sleepLiveAnalyzed").textContent=micActive?count+"s":"—";
   $("sleepInferenceStatus").textContent=evt.inference_state==="error"?"AI 错误："+evt.inference_error:
    evt.inference_state==="loading"?"AI 加载中":
    evt.inference_state==="running"?"AI 正常 · 丢弃 "+(evt.dropped_windows||0)+" 窗":"AI 未运行";
   if(evt.latest_mic&&micActive)micSecond(evt.latest_mic);
   if(!micActive&&oldMic){
    micHistory.length=0;latestSecond=-1;$("sleepMicDbfs").textContent="—";$("sleepLivePeak").textContent="峰值 —";micGraph();
   }
   if(Array.isArray(evt.clips)){
    soundMaterials=evt.clips;
    const main=$("sleepFeedbackSound");
    evt.clips.forEach(c=>{if(![...main.options].some(o=>o.value===c.id)){const o=document.createElement("option");o.value=c.id;o.textContent=c.name;main.append(o);}});
    const pool=$("sleepFeedbackSoundPool");[...main.options].forEach(o=>{if(![...pool.options].some(p=>p.value===o.value)){const n=o.cloneNode(true);n.selected=false;pool.append(n);}});
   }
   if(Array.isArray(evt.vibration_clips)){
    vibMaterials=evt.vibration_clips;
    for(const id of ["sleepFeedbackVibrationPattern","sleepFeedbackVibrationPool"]){const select=$(id);for(const c of vibMaterials){if(![...select.options].some(o=>o.value===c.id)){const o=document.createElement("option");o.value=c.id;o.textContent=c.name;select.append(o);}}}
   }
   if(evt.vibration_hardware){const v=evt.vibration_hardware;vibrationAvailable=!!v.available;vibrationAmplitudeControl=!!v.amplitude;$("sleepVibrationHardware").textContent=(v.model?v.model+" · ":"")+(!v.available?"未发现振动马达":v.amplitude?"支持振幅控制":"仅占空比")+(v.permission===false?" · VIBRATE 权限缺失":"")+(v.interruption_filter===2||v.interruption_filter===3||v.interruption_filter===4?" · 勿扰限制可能生效":"");if(!previewPending)previewBusy(false);}
   if(evt.experiment){lastExperiment=evt.experiment;renderTrialBoard(lastExperiment);const e=evt.experiment,l=e.last||{};const stats=e.channels||{};$("sleepExperimentChannels").textContent=[["纯声音","sound"],["纯震动","vib"],["混合","mix"]].map(([name,k])=>name+" "+(stats[k]?.stopped||0)+"/"+(stats[k]?.observed||0)).join(" · ");const restore=$("sleepExperimentRestoreKey");restore.replaceChildren();for(const key of [...(e.excluded||[]),...(e.soundLimit<100?["soundLimit"]:[]),...(e.vibrationLimit<100?["vibrationLimit"]:[]),...(e.soundDurationLimit<5000?["soundDurationLimit"]:[]),...(e.vibrationDurationLimit<2000?["vibrationDurationLimit"]:[])]){const o=document.createElement("option");o.value=key;o.textContent=key==="soundLimit"?"恢复声音上限":key==="vibrationLimit"?"恢复震动上限":key==="soundDurationLimit"?"恢复声音时长上限":key==="vibrationDurationLimit"?"恢复震动时长上限":key.replace("deny_sound_","声音：").replace("deny_vib_","震动：").replace("deny_pair_","搭配：").replace("deny_rhythm_","声音节奏：");restore.append(o);} $("sleepExperimentRestore").disabled=!restore.options.length;for(const o of $("sleepFeedbackSoundPool").options){o.disabled=(e.excluded||[]).includes("deny_sound_"+o.value);if(o.disabled)o.selected=false;}for(const o of $("sleepFeedbackVibrationPool").options){o.disabled=(e.excluded||[]).includes("deny_vib_"+o.value);if(o.disabled)o.selected=false;}
     for(const o of $("sleepFeedbackSoundRhythmPool").options){o.disabled=(e.excluded||[]).includes("deny_rhythm_"+o.value);if(o.disabled)o.selected=false;}
     const typeRoot=$("sleepExperimentTypes");typeRoot.replaceChildren();
     for(const [title,id,prefix,suffix] of [["声音","sleepFeedbackSoundPool","deny_sound_","|off"],["震动","sleepFeedbackVibrationPool","deny_vib_",""]]){
      const label=document.createElement("strong");label.textContent=title;typeRoot.append(label);
      const grid=document.createElement("div");grid.className="sleep-feedback-type-grid";typeRoot.append(grid);
      for(const o of $(id).options){
       const k=title==="声音"?o.value+suffix:"off|"+o.value,t=e.types?.[k],row=document.createElement("button");
       row.type="button";row.className="secondary mini sleep-feedback-type-chip";row.classList.toggle("excluded",o.disabled);row.classList.toggle("observed",!!t?.stopped&&!o.disabled);
       row.textContent=o.textContent.split(" · ")[0]+" · "+(o.disabled?"排除":t?t.stopped+"/"+t.observed:"待测");
       row.title=o.disabled?"恢复此类型":"排除此类型";
       row.onclick=()=>o.disabled?bridge()?.sleepExperimentRestore?.(prefix+o.value):bridge()?.sleepExperimentExclude?.(title==="声音"?"sound":"vibration",o.value);
       grid.append(row);
      }
     }
     const candidateRoot=$("sleepExperimentCandidates");candidateRoot.replaceChildren();
     const heading=document.createElement("strong");heading.textContent="候选方案（非已证实疗效）";candidateRoot.append(heading);
     for(const p of e.candidates||[]){const row=document.createElement("div");row.className="sleep-live-event";row.textContent=(p.soundEnabled?p.sound+" "+p.volume+"% "+p.soundRhythm:"静音")+" / "+(p.vibrate?p.vibrationPattern+" "+p.vibrationAmplitude+"%":"无震动")+" · "+p.stopped+"/"+p.observed;candidateRoot.append(row);}
     $("sleepExperimentSummary").textContent=`今晚 ${e.nightCount||0} 次 · 累计 ${e.trials} · 刺激后低鼾声 ${e.stopped}/${e.observed} · 对照 ${e.controlStopped}/${e.controlObserved} · 人工上限 声${e.soundLimit}%/${e.soundDurationLimit}ms 震${e.vibrationLimit}%/${e.vibrationDurationLimit}ms · 最近 ${l.sound||"—"} ${l.volume||0}% / ${l.vibrationPattern||"—"} ${l.vibrationAmplitude||0}%`;}
   if(evt.settings&&typeof evt.settings==="object"&&
       !ids.includes(document.activeElement?.id)){
    for(const k of ["sound","volume","threshold","minimum","repeat","decaySeconds","soundRhythm","soundMs","soundMax","vibrationMax","vibrationPattern","vibrationAmplitude","vibrationMs","mode","delayMinutes","maxCues","soundMin","vibrationMin","soundMsMax","vibrationMsMax"]){
     const id="sleepFeedback"+k[0].toUpperCase()+k.slice(1);
     if(evt.settings[k]!==undefined)$(id).value=String(evt.settings[k]);
    }
    $("sleepFeedbackVibrate").checked=!!evt.settings.vibrate;
    $("sleepFeedbackVibrationCompatibility").checked=!!evt.settings.vibrationCompatibility;
    $("sleepFeedbackSoundEnabled").checked=evt.settings.soundEnabled!==false;
    $("sleepFeedbackPauseOnScreen").checked=evt.settings.pauseOnScreen!==false;
    $("sleepFeedbackDirectGain").checked=evt.settings.directGain!==false;
    $("sleepFeedbackDirectExtend").checked=evt.settings.directExtend!==false;
    for(const k of ["SoundPool","VibrationPool","SoundRhythmPool"]){const key=k[0].toLowerCase()+k.slice(1), set=new Set(String(evt.settings[key]||(k==="SoundPool"?evt.settings.sound:"")).split(","));for(const o of $("sleepFeedback"+k).options)o.selected=!o.disabled&&set.has(o.value); }
    labels();renderVibrationPattern();
   }
   renderPlan();
   if(consoleTab==="materials")renderMaterials();
   if(recordActive!==recording)bridge()?.sleepStatus?.();
  }
  function renderEvents(events){
   if(!Array.isArray(events))return;
   const root=$("sleepLiveEvents");root.replaceChildren();
   if(!events.length){root.textContent="暂无自动反馈或手动标记";return;}
   events.slice(-3).reverse().forEach(e=>{
    const row=document.createElement("div");row.className="sleep-live-event";
    const time=document.createElement("span");time.textContent=new Date(Number(e.time_ms)).toLocaleTimeString("zh-CN",{hour12:false});
    const label=document.createElement("span");label.textContent=e.kind==="manual"?"手动标记":e.vibration?"自动震动":("自动反馈 · "+([...$("sleepFeedbackSound").options].find(o=>o.value===e.sound)?.textContent.split(" · ")[0]||e.sound));
    const score=document.createElement("span");score.textContent=Number(e.score).toFixed(3);row.append(time,label,score);root.append(row);
   });
  }
  $("sleepLiveSpan").onchange=()=>{liveSpan=Number($("sleepLiveSpan").value)||60;micGraph();};
  $("sleepLiveSensitivity").onchange=()=>{const p=sensitivity[$("sleepLiveSensitivity").value];if(!p)return;$("sleepFeedbackThreshold").value=p.threshold;$("sleepFeedbackMinimum").value=p.minimum;labels();micGraph();save();};
  $("sleepLivePresets").querySelectorAll("[data-sound]").forEach(b=>b.onclick=()=>{$("sleepFeedbackSound").value=b.dataset.sound;labels();save();});
  $("sleepLiveMark").onclick=()=>{bridge()?.sleepFeedbackMark?.();};
  $("sleepLiveExport").onclick=()=>{bridge()?.sleepFeedbackExportLog?.();};
  $("sleepLiveDim").onclick=()=>{const dim=$("sleepFeedbackPanel").classList.toggle("sleep-live-dim");$("sleepLiveDim").setAttribute("aria-pressed",String(dim));$("sleepLiveDim").textContent=dim?"☀ 恢复":"☾ 夜间";};
  ids.forEach(id=>{
   $(id).addEventListener("input",()=>{labels();micGraph();});
   $(id).addEventListener("change",save);
  });
  $("sleepBrowserTab").onclick=()=>switchPage("browser");
  $("sleepMetricsTab").onclick=()=>switchPage("metrics");
  $("sleepFeedbackTab").onclick=()=>switchPage("feedback");
  $("sleepMicStart").onclick=()=>{
   if(!bridge()?.sleepMicMonitorStart){
    $("sleepMicMode").textContent="请安装含实时麦克风监测的新版 APK";return;
   }
   $("sleepMicMode").textContent="正在开启测试监听…";
   bridge().sleepMicMonitorStart();
  };
  $("sleepMicStop").onclick=()=>{
   $("sleepMicMode").textContent="正在停止测试监听…";
   bridge()?.sleepMicMonitorStop?.();
  };
  $("sleepThresholdPreset").onclick=()=>{
   if(feedbackActive){$("sleepFeedbackInfo").textContent="请先关闭反馈再切换模式";return;}
   $("sleepFeedbackMode").value="direct";$("sleepFeedbackMinimum").value="4";$("sleepFeedbackPauseOnScreen").checked=false;
   labels();if(save()){$("sleepFeedbackInfo").textContent="直接反馈已配置 · 当前声音和振动保持不变";bridge()?.sleepFeedbackStatus?.();}
  };
  $("sleepFeedbackEnabled").onchange=()=>{
   if($("sleepFeedbackEnabled").checked&&cfg().mode==="direct"){
    $("sleepFeedbackMinimum").value="4";$("sleepFeedbackPauseOnScreen").checked=false;
    if(!cfg().soundEnabled&&!cfg().vibrate){$("sleepFeedbackEnabled").checked=false;$("sleepFeedbackInfo").textContent="请先在素材库选择声音或振动";return;}
   }
   if(!save()){
    $("sleepFeedbackEnabled").checked=feedbackActive;return;
   }
   if($("sleepFeedbackEnabled").checked){
    $("sleepFeedbackInfo").textContent="正在开启鼾声反馈…";
    bridge()?.sleepFeedbackStart?.(JSON.stringify(cfg()));
   }else{
    $("sleepFeedbackInfo").textContent="反馈关闭；录音和麦克风将继续。";
    bridge()?.sleepFeedbackStop?.();
   }
  };
  let previewPending=false,previewTimeout=0,vibrationAvailable=null,vibrationAmplitudeControl=null;
  function previewBusy(value){
   previewPending=value;
   for(const id of ["sleepFeedbackPreview","sleepFeedbackVibratePreview","sleepFeedbackMixedPreview","sleepVibrationMotorTest","sleepVibrationNightTest"]){
    $(id).disabled=value||(id!=="sleepFeedbackPreview"&&vibrationAvailable===false);
   }
   if(!value){clearTimeout(previewTimeout);previewTimeout=0;}
  }
  function preview(mode,overrides={}){
   if(previewPending)return;
   if(!bridge()?.sleepFeedbackPreview){$("sleepFeedbackInfo").textContent="请安装完整新版 APK";return;}
   if(mode!=="sound"&&vibrationAvailable===false){$("sleepFeedbackInfo").textContent="设备没有可用振动马达";return;}
   const c={...cfg(),...overrides},v=mode!=="sound",a=mode==="sound"||mode==="mixed";
   $("sleepFeedbackInfo").textContent=mode==="motor"?"正在测试系统默认振幅 800ms":mode==="night"?"正在测试夜间通知振动通道":mode==="sound"?"正在测试声音（无振动）":mode==="vibration"?"正在测试振动（无声音）":"正在测试声音＋振动";
   if(v)$("sleepVibrationNow").textContent=mode==="motor"?"系统默认强度 · 800ms":"请求 "+c.vibrationAmplitude+"% · "+c.vibrationMs+"ms";
   previewBusy(true);
   previewTimeout=setTimeout(()=>{previewBusy(false);$("sleepFeedbackInfo").textContent="未收到测试结果，请重试";},10000);
   bridge().sleepFeedbackPreview(JSON.stringify({...c,soundEnabled:a,vibrate:v,defaultMotorTest:mode==="motor",nightChannelTest:mode==="night"}));
  }
  $("sleepFeedbackPreview").onclick=()=>preview("sound");
  $("sleepFeedbackVibratePreview").onclick=()=>preview("vibration");
  $("sleepFeedbackMixedPreview").onclick=()=>preview("mixed");
  $("sleepVibrationMotorTest").onclick=()=>preview("motor");
  $("sleepVibrationNightTest").onclick=()=>preview("night");
  function renderVibrationPattern(){
   const root=$("sleepVibrationTrack");root.replaceChildren();
   const c=cfg(),continuous=c.vibrationPattern==="continuous",dutyMode=c.vibrationCompatibility||vibrationAmplitudeControl===false;
   const custom=vibMaterials.find(v=>v.id===c.vibrationPattern);
   if(custom&&Array.isArray(custom.samples)){for(const a of custom.samples){const seg=document.createElement("div"),pulse=document.createElement("i");seg.style.flex="1";pulse.style.width=(dutyMode?a*c.vibrationAmplitude/100:100)+"%";pulse.style.opacity=String(dutyMode?(a?1:0):a*c.vibrationAmplitude/10000);seg.append(pulse);root.append(seg);}root.title="自录请求曲线，非实测马达输出";return;}
   const n=continuous?1:3;
   for(let i=0;i<n;i++){
    const ratio=c.vibrationPattern==="rising"?(i+1)/3:c.vibrationPattern==="falling"?(3-i)/3:1;
    const duty=continuous?1:c.vibrationPattern==="shortlong"&&i<2?.35:.7;
    const seg=document.createElement("div"),pulse=document.createElement("i");
    seg.style.flex="1";pulse.style.width=(100*duty*(dutyMode?c.vibrationAmplitude/100*ratio:1))+"%";
    pulse.style.opacity=String(Math.max(.15,dutyMode?1:c.vibrationAmplitude/100*ratio));seg.append(pulse);root.append(seg);
   }
   root.title="请求节奏示意，非实测振动";
  }
  for(const id of ["sleepFeedbackVibrationPattern","sleepFeedbackVibrationAmplitude","sleepFeedbackVibrationMs","sleepFeedbackVibrationCompatibility"])$(id).addEventListener("input",renderVibrationPattern);
  function materialMessage(msg){$("sleepMaterialSoundStatus").textContent=msg;}
  function useMaterial(kind,c,action){
   if(action==="preview"){
    if(padActive||padArmed){materialMessage("请先结束振动录制");return;}
    if(feedbackActive){materialMessage("请先关闭自动反馈再试听");return;}
    preview(kind==="sound"?"sound":"vibration",kind==="sound"?{sound:c.id,soundRhythm:"single",soundMs:0}:{vibrationPattern:c.id,vibrationAmplitude:100,vibrationMs:c.duration_ms});
    return;
   }
   if(feedbackActive){materialMessage("先关闭自动反馈，再修改素材");return;}
   const isSound=kind==="sound",main=$(isSound?"sleepFeedbackSound":"sleepFeedbackVibrationPattern"),pool=$(isSound?"sleepFeedbackSoundPool":"sleepFeedbackVibrationPool");
   const option=[...pool.options].find(o=>o.value===c.id);
   if(!option||option.disabled){materialMessage("此素材已排除或尚未加载，请先刷新或恢复限制");return;}
   if(action==="pool"){option.selected=!option.selected;}
   else{
    main.value=c.id;
    if(isSound){$("sleepFeedbackSoundEnabled").checked=true;$("sleepFeedbackSoundRhythm").value="single";$("sleepFeedbackSoundMs").value="0";}
    else{$("sleepFeedbackVibrate").checked=true;$("sleepFeedbackVibrationAmplitude").value="100";$("sleepFeedbackVibrationMs").value=String(c.duration_ms);}
    $("sleepFeedbackMode").value="direct";$("sleepFeedbackMinimum").value="4";$("sleepFeedbackPauseOnScreen").checked=false;
   }
   labels();renderVibrationPattern();
   if(save()){materialMessage(c.name+(action==="pool"?(option.selected?" · 已加入候选池":" · 已移出候选池"):" · 已设为反馈素材（不开启反馈）"));renderMaterials();}
  }
  function renderMaterials(){
   for(const [kind,items,id] of [["sound",soundMaterials,"sleepMaterialSoundList"],["vibration",vibMaterials,"sleepMaterialVibList"]]){
    const root=$(id);root.replaceChildren();
    if(!items.length){root.textContent=kind==="sound"?"尚无自录提示音":"尚无自定义振动";continue;}
    const pool=$(kind==="sound"?"sleepFeedbackSoundPool":"sleepFeedbackVibrationPool"),main=$(kind==="sound"?"sleepFeedbackSound":"sleepFeedbackVibrationPattern");
    for(const c of items){
     const row=document.createElement("div");row.className="sleep-material-row";
     const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("small");name.textContent=c.name;meta.textContent=(Number(c.duration_ms)/1000).toFixed(2)+"s"+(main.value===c.id?" · 当前选中":"");info.append(name,meta);row.append(info);
     if(kind==="vibration"&&Array.isArray(c.samples)){const wave=document.createElement("div");wave.className="sleep-pad-wave small";for(const value of c.samples){const bar=document.createElement("i");bar.style.height=value+"%";wave.append(bar);}info.append(wave);}
     const actions=document.createElement("div");actions.className="sleep-material-actions";
     const o=[...pool.options].find(o=>o.value===c.id);
     for(const [action,label] of [["preview","试听"],["select","设为反馈"],["pool",o?.selected?"✓ 候选池":"＋候选池"]]){
      const button=document.createElement("button");button.type="button";button.className="secondary mini";button.textContent=label;button.disabled=action!=="preview"&&!!o?.disabled;button.onclick=()=>useMaterial(kind,c,action);actions.append(button);
     }
     row.append(actions);root.append(row);
    }
   }
   $("sleepCueRecord").disabled=micActive||feedbackActive;
   if(micActive&&!feedbackActive)materialMessage("麦克风正在采集；停止监听或录音后可录制自己的声音");
  }
  $("sleepMaterialRefresh").onclick=()=>bridge()?.sleepFeedbackStatus?.();
  $("sleepCueRecord").onclick=()=>{if(!micActive&&!feedbackActive)bridge()?.sleepCueImport?.(true);};
  $("sleepCueImport").onclick=()=>{if(feedbackActive)materialMessage("先关闭自动反馈再导入");else bridge()?.sleepCueImport?.(false);};
  const pad=$("sleepVibrationPad"),padCursor=$("sleepPadCursor");
  let padArmed=false,padActive=false,padPointer=null,padLevel=0,padStart=0,padTimer=0,padSamples=[],padSaving=false,padSaved=false,padLastMotor=0;
  function drawPad(){
   $("sleepPadTime").textContent=(padSamples.length*.05).toFixed(2)+" / 2.00s";
   $("sleepPadLevel").textContent=padLevel+"%";
   $("sleepPadRecord").textContent=padActive?"■ 结束录制":padArmed?"取消准备":"准备录制";
   $("sleepPadSave").disabled=padArmed||padActive||padSaving||padSaved||padSamples.length<2||!padSamples.some(v=>v>0);
   const root=$("sleepPadWave");root.replaceChildren();
   for(let i=0;i<40;i++){const bar=document.createElement("i");bar.style.height=(padSamples[i]||0)+"%";if(i<padSamples.length)bar.className="sampled";root.append(bar);}
  }
  function padMotor(value){bridge()?.sleepVibrationTouch?.(value);}
  function samplePad(now){
   if(!padActive)return;
   const target=Math.min(40,Math.floor((now-padStart)/50));
   while(padSamples.length<target)padSamples.push(padLevel);
  }
  function stopPad(){
   if(!padArmed&&!padActive)return;
   if(padActive)samplePad(performance.now());
   clearInterval(padTimer);padTimer=0;padArmed=padActive=false;padPointer=null;padLevel=0;padCursor.hidden=true;padMotor(0);
   $("sleepPadStatus").textContent=padSamples.some(v=>v>0)?"录制完成 · 保存后可试听":"未录到有效振动";
   drawPad();
  }
  function updatePad(evt){
   if(evt.pointerId!==padPointer)return;
   samplePad(performance.now());
   const rect=pad.getBoundingClientRect(),y=Math.max(0,Math.min(1,(evt.clientY-rect.top)/Math.max(1,rect.height)));
   padLevel=Math.round(5+95*y);padCursor.hidden=false;padCursor.style.top=(y*100)+"%";padCursor.textContent=padLevel+"%";
   const now=performance.now();if(now-padLastMotor>=90){padMotor(padLevel);padLastMotor=now;}drawPad();
  }
  pad.onpointerdown=evt=>{
   if(!padArmed&&!padActive)return;
   if(padPointer!==null)return;
   if(feedbackActive||previewPending){stopPad();$("sleepPadStatus").textContent="请先关闭反馈及试听";return;}
   evt.preventDefault();padPointer=evt.pointerId;try{pad.setPointerCapture(evt.pointerId);}catch(_){}
   if(padArmed){padArmed=false;padActive=true;padStart=performance.now();padLastMotor=-Infinity;$("sleepPadStatus").textContent="录制中 · 松手保留间隔";
    padTimer=setInterval(()=>{const now=performance.now();samplePad(now);if(padSamples.length>=40){stopPad();return;}if(padLevel&&now-padLastMotor>=90){padMotor(padLevel);padLastMotor=now;}drawPad();},50);}
   padLastMotor=-Infinity;updatePad(evt);
  };
  pad.onpointermove=evt=>{if(evt.pointerId===padPointer){evt.preventDefault();updatePad(evt);}};
  function releasePad(evt){if(evt.pointerId!==padPointer)return;samplePad(performance.now());padPointer=null;padLevel=0;padCursor.hidden=true;padMotor(0);drawPad();}
  pad.onpointerup=releasePad;pad.onpointercancel=releasePad;pad.onlostpointercapture=releasePad;
  $("sleepPadRecord").onclick=()=>{
   if(padActive||padArmed){stopPad();return;}
   if(feedbackActive||previewPending||padSaving){$("sleepPadStatus").textContent="请先关闭自动反馈和试听";return;}
   if(!bridge()?.sleepVibrationSave||!bridge()?.sleepVibrationTouch){$("sleepPadStatus").textContent="请安装含自定义振动功能的新版 APK";return;}
   if(vibrationAvailable===false){$("sleepPadStatus").textContent="未检测到振动马达";return;}
   padSamples=[];padSaved=false;padArmed=true;$("sleepPadStatus").textContent="已准备 · 触摸板开始计时";drawPad();
  };
  $("sleepPadClear").onclick=()=>{if(padSaving)return;stopPad();padSamples=[];padSaved=false;$("sleepPadStatus").textContent="已清空 · 可重新录制";drawPad();};
  $("sleepPadSave").onclick=()=>{
   if(padSaving||padSaved||padSamples.length<2||!padSamples.some(v=>v>0))return;
   if(feedbackActive){$("sleepPadStatus").textContent="先关闭自动反馈再保存";return;}
   padSaving=true;drawPad();$("sleepPadStatus").textContent="正在保存…";
   bridge()?.sleepVibrationSave?.(JSON.stringify({name:$("sleepPadName").value,samples:padSamples}));
   setTimeout(()=>{if(padSaving){padSaving=false;drawPad();$("sleepPadStatus").textContent="保存未确认，请刷新素材库";}},10000);
  };
  document.addEventListener("visibilitychange",()=>{if(document.hidden)stopPad();});
  window.addEventListener("blur",stopPad);
  drawPad();
  $("sleepExcludeSound").onclick=()=>bridge()?.sleepExperimentExclude?.("sound",$("sleepFeedbackSound").value);
  $("sleepExcludeRhythm").onclick=()=>bridge()?.sleepExperimentExclude?.("rhythm",$("sleepFeedbackSoundRhythm").value);
  $("sleepExcludeVibration").onclick=()=>bridge()?.sleepExperimentExclude?.("vibration",$("sleepFeedbackVibrationPattern").value);
  $("sleepExperimentApply").onclick=()=>bridge()?.sleepExperimentReview?.($("sleepExperimentReview").value);
  $("sleepExperimentRestore").onclick=()=>{const k=$("sleepExperimentRestoreKey").value;if(k)bridge()?.sleepExperimentRestore?.(k);};
  $("sleepExperimentExport").onclick=()=>bridge()?.sleepExperimentExport?.();
  window.bodyTraceReceiveFeedback=function(evt){
   if(!evt?.type)return;
   if(evt.type==="sleep_feedback_status"){
    status(evt);
   }else if(evt.type==="sleep_feedback_self_report"){
    clearTimeout(selfTimer);selfPending=false;
    if(evt.ok){renderSelfReport(evt.state);if(Number(evt.state?.next_gain)>0){nextDirectGain=Number(evt.state.next_gain);directLocked=true;directCanExtend=false;renderPlan();}$("sleepSelfStatus").textContent="✓ 已记录 "+clock(Date.now())+(evt.state?.next_gain?" · 下次 "+evt.state.next_gain+"%":"")+" · 可以锁屏继续睡";bridge()?.sleepFeedbackStatus?.();}
    else {renderSelfReport(selfState);$("sleepSelfStatus").textContent=evt.message||"保存失败";bridge()?.sleepFeedbackStatus?.();}
   }else if(evt.type==="sleep_feedback_material_saved"){
    if(evt.kind==="vibration"){padSaving=false;padSaved=true;drawPad();$("sleepPadStatus").textContent="✓ 已保存 · 在下方试听或加入候选池";}
    else materialMessage("✓ 自录声音已保存 · 在下方试听或设为反馈");
    renderMaterials();bridge()?.sleepFeedbackStatus?.();
   }else if(evt.type==="sleep_feedback_clip_recording"){
    $("sleepCueRecord").textContent=evt.active?"■ 停止录音":"● 录制我的声音";$("sleepFeedbackInfo").textContent=evt.message||"";materialMessage(evt.message||"");
   }else if(evt.type==="sleep_feedback_mic"){
    if(!micActive){micActive=true;bridge()?.sleepFeedbackStatus?.();}
    micSecond(evt);
   }else if(evt.type==="sleep_feedback_score"){
    const row=micHistory.find(r=>Number(r.second)===Number(evt.second));
    if(row){row.score=Number(evt.context_snore??evt.score);row.muted=!!evt.muted;row.confirmed=Number(evt.confirmed_pulses)||0;}
    $("sleepFeedbackScore").textContent=Number(evt.context_snore??evt.score).toFixed(3);
    paintTriggerCount(evt);
    if(selfState.trial_id&&!selfState.gain_adjustable&&selfState.trial_id!==reportExpiryRequested&&Date.now()-Number(selfState.cue?.started_ms||selfState.cue?.time_ms)>120000){reportExpiryRequested=selfState.trial_id;bridge()?.sleepFeedbackStatus?.();}
    $("sleepLiveAnalyzed").textContent=evt.inferred_windows+"s";
    $("sleepInferenceStatus").textContent="AI 正常 · 丢弃 "+evt.dropped_windows+" 窗"+(evt.muted?" · 抑制":"");
    micGraph();
   }else if(evt.type==="sleep_feedback_output"){
    outputWave=Array.isArray(evt.wave)?evt.wave.map(Number):[];
    outputDuration=Math.max(120,Number(evt.duration_ms)||300);
    outputStarted=performance.now();
    const sound=evt.sound===true||(evt.sound===undefined&&outputWave.some(v=>v!==0));
    if(!sound)outputWave=[];
    $("sleepSpeakerNow").textContent=sound?(evt.reason||"提示音")+" · 正在播放":"本次无声音输出";
    if(evt.vibration){$("sleepVibrationNow").textContent="系统已启动振动 · "+outputDuration+"ms 内";$("sleepVibrationTrack").classList.add("running");}
    animateOutput();
   }else if(evt.type==="sleep_feedback_session_exported"){
    toast(evt.message||"反馈日志已复制");
   }else if(evt.type==="sleep_feedback_preview"){
    previewBusy(false);
    if(consoleTab==="materials")materialMessage(evt.message||"试听结束");
    $("sleepFeedbackInfo").textContent=evt.message||(evt.ok?"测试完成":"测试失败");
    if(evt.channel==="vibration"||evt.channel==="mixed")$("sleepVibrationNow").textContent=evt.ok?"请求已执行 · 请确认体感":"振动请求失败";
   }else if(evt.type==="sleep_feedback_error"||
      (evt.type==="error"&&/麦克风|鼾声|反馈/.test(evt.message||""))){
    $("sleepFeedbackInfo").textContent=evt.message||"反馈操作失败";
    if(consoleTab==="materials"){materialMessage(evt.message||"素材操作失败");if(padSaving){padSaving=false;drawPad();$("sleepPadStatus").textContent=evt.message||"保存失败";}}
    bridge()?.sleepFeedbackStatus?.();
   }
  };
  const prior=window.bodyTraceReceive;
  window.bodyTraceReceive=function(evt){
   if(evt?.type?.startsWith("sleep_feedback_"))window.bodyTraceReceiveFeedback(evt);
   else if(typeof prior==="function")prior(evt);
  };
  labels();renderVibrationPattern();setConsoleTab("night");renderSelfReport({});
 })();
})();

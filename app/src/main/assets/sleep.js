/* BodyTrace sleep screen: local-only recording, offline analysis and clip review. */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const receiver=window.bodyTraceReceive;
 let recording=false,sessions=[],selectedId="",analysis=null,busy=false;
 let pendingDelete="";
 let eventLimit=80;
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
  $("sleepThresholdText").textContent=$("sleepThreshold").value+" dBFS";
 }
 function current(){
  return sessions.find(s=>s.id===selectedId)||null;
 }
 function selectSession(id){
  if(selectedId!==id)analysis=null;
  selectedId=id;
  eventLimit=80;
  busy=false;render();
 }
 function render(){
  $("sleepStatus").textContent=recording?
   "正在录制 · 可锁屏，麦克风前台服务持续工作（通知栏可以停止）":
   "当前没有正在进行的录音";
  $("sleepStatus").classList.toggle("sleep-live",recording);
  $("sleepStart").disabled=recording||busy;
  $("sleepStop").disabled=!recording;
  const chosen=current();
  $("sleepAnalyze").disabled=!chosen||recording||busy||
   !(chosen.status==="completed"||chosen.status==="interrupted");
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
   extra.textContent=(item.source==="imported-audio"?"本机导入 · ":"")+
    (item.original_name?item.original_name+" · ":"")+
    "时长 "+duration(millis/1000)+" · "+
     ((Number(item.bytes)||0)/1048576).toFixed(1)+" MB"+
     (item.levels_cached?" · 已有音量分析":"");
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
    del.textContent=pendingDelete===item.id?"再次点击确认删除":"删除本机录音";
    del.onclick=()=>{
     if(pendingDelete!==item.id){pendingDelete=item.id;render();return;}
     pendingDelete="";
     if(!bridge()?.sleepDelete){toast("请安装支持删除录音的版本",true);return;}
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
  head.textContent="已筛选 "+events.length+" 段候选声音 · 超阈值累计 "+
   duration(total)+" · 总录音 "+duration(analysis.total_seconds)+
   " · 阈值 "+analysis.threshold_dbfs+" dBFS · 最短 "+analysis.minimum_seconds+
   " 秒（不代表确认为鼾声）";
  root.append(head);
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
   play.onclick=()=>{
    const start=Math.max(0,Number(event.start_sec)-2);
    const length=Math.min(180,Math.max(1,Number(event.end_sec)-start+3));
    if(!bridge()?.sleepPlay){toast("请安装支持录音播放的版本",true);return;}
    bridge().sleepPlay(analysis.id,Math.floor(start),Math.ceil(length));
    toast("正在播放候选片段（含前后几秒）");
   };
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
  if(busy||!current()||recording)return;
  const threshold=Number($("sleepThreshold").value);
  const seconds=Number($("sleepMinSeconds").value);
  const gap=Number($("sleepGapSeconds").value);
  if(!Number.isInteger(seconds)||seconds<1||seconds>120||
    !Number.isInteger(gap)||gap<0||gap>5){
   toast("最短持续时间限制1–120秒，间断时间限制0–5秒",true);return;
  }
  if(!bridge()?.sleepAnalyze){toast("当前 APK 不支持睡眠分析",true);return;}
  busy=true;
  $("sleepSelected").textContent="分析中：首次处理整晚音频可能需要一段时间…";
  $("sleepAnalyze").disabled=true;
  bridge().sleepAnalyze(selectedId,threshold,seconds,gap);
 }
 $("sleepThreshold").addEventListener("input",updateThreshold);
 for(const field of ["sleepThreshold","sleepMinSeconds","sleepGapSeconds"])
  $(field).addEventListener("change",()=>{if(analysis&&selectedId)analyze();});
 $("sleepImport").onclick=()=>{
  if(recording||busy){toast("请先完成当前录音或分析",true);return;}
  if(!bridge()?.sleepImport){toast("请安装支持导入录音的新版 APK",true);return;}
  $("sleepImportStatus").textContent="请选择已有录音文件；会复制到 APP 私有空间，不删除原文件。";
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
 $("sleepStopPlayback").onclick=()=>{bridge()?.sleepStopPlayback?.();};
 document.querySelector('.tabs button[data-page="sleep"]')?.addEventListener("click",()=>{
  bridge()?.sleepStatus?.();
 });
 window.bodyTraceReceive=function(evt){
  if(typeof receiver==="function")receiver(evt);
  if(!evt||!evt.type)return;
  if(evt.type==="sleep_status"){
   recording=!!evt.recording;
   sessions=Array.isArray(evt.sessions)?evt.sessions:[];
   if(!sessions.some(s=>s.id===selectedId)){
    selectedId=sessions.find(s=>s.status==="completed"||s.status==="interrupted")?.id||"";
    analysis=null;
   }
   busy=false;pendingDelete="";render();
  }else if(evt.type==="sleep_analysis"){
   busy=false;selectedId=evt.id||selectedId;analysis=evt;eventLimit=80;
   render();
  }else if(evt.type==="sleep_import_progress"){
   $("sleepImportStatus").textContent="正在复制到本机："+evt.percent+"%";
  }else if(evt.type==="sleep_imported"){
   $("sleepImportStatus").textContent="已导入 "+(Number(evt.bytes)/1048576).toFixed(1)+" MB，可选择记录后分析。";
  }else if(evt.type==="sleep_import_cancelled"){
   $("sleepImportStatus").textContent="已取消导入，未修改本机数据。";
  }else if(evt.type==="sleep_analysis_progress"){
   $("sleepSelected").textContent="正在解码整晚音频："+evt.percent+"%";
  }else if(evt.type==="error"&&/睡眠|录音|片段/.test(evt.message||"")){
   busy=false;render();
  }
 };
 updateThreshold();
 render();
})();

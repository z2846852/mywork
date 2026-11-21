/* BodyTrace Sound Lab: isolated from sleep/recording UI.
 * Pitch = continuous voiced-only acoustic axis (NOT wall-clock time).
 * Phones = hold/release, analyse the WHOLE short PCM utterance after release.
 * No ASR, no word-to-IPA conversion, no recording persistence. */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const bridge=()=>window.BodyTraceNative;
 const oldReceiver=window.bodyTraceReceive;
 const SVG="http://www.w3.org/2000/svg";
 const pitchPoints=[];
 let pitchOn=false,holding=false,analyzing=false,hasPhonemeResult=false,latestNote="",currentPanel="pitch";
 const maxPoints=700;
 const pitchChart=$("voicePitchChart"),grid=$("voicePitchGrid"),traces=$("voicePitchTraces");
 const hold=$("voicePhonemeHold");
 let modelsInstalled=new Set();
 let modelsSelected="acoustic";
 let lastPhonemeEvent=null;
 let modelBusy=false;
 function voiceModelStatus(message){safeText("voiceModelsStatus",message);}
 function renderModels(evt){
  if(evt.state==="downloading"||evt.state==="checking"){
   modelBusy=true;
   $("voiceModelsInstall").disabled=true;
   $("voiceModelsDelete").disabled=true;
   voiceModelStatus(evt.message||"下载中…");
   return;
  }
  if(evt.state==="error"){
   modelBusy=false;
   voiceModelStatus(evt.message||"模型下载失败");
   $("voiceModelsInstall").disabled=false;
   return;
  }
  if(evt.state==="installed"){
   voiceModelStatus(evt.message||"下载完成");
   return;
  }
  if(evt.state!=="listed")return;
  modelBusy=false;
  modelsInstalled=new Set((evt.models||[]).filter(m=>m.installed).map(m=>m.id));
  modelsSelected=evt.selected||"acoustic";
  $("voiceModelsChoice").value=modelsSelected;
  safeText("voiceModelsEngine",
   modelsSelected==="acoustic"?"基础声学探针":modelsSelected+" ✓ 已安装");
  const chosen=modelsSelected;
  $("voiceModelsInstall").disabled=chosen==="acoustic"||modelsInstalled.has(chosen);
  $("voiceModelsDelete").disabled=chosen==="acoustic"||!modelsInstalled.has(chosen);
  voiceModelStatus(evt.message||"模型已就绪，可开始测试");
 }
 function updateModelActions(){
  const choice=$("voiceModelsChoice").value;
  $("voiceModelsInstall").disabled=modelBusy||
    choice==="acoustic"||modelsInstalled.has(choice);
  $("voiceModelsDelete").disabled=modelBusy||
    choice==="acoustic"||!modelsInstalled.has(choice);
  if(choice==="acoustic"||modelsInstalled.has(choice)){
   if(bridge()?.voiceModelsSelect)bridge().voiceModelsSelect(choice);
   else voiceModelStatus("安装新 APK 后才能选择神经音素模型");
  }else{
   voiceModelStatus("当前选项尚未安装。点击“下载并启用”，从独立 GitHub Release 获取模型。");
  }
 }
 $("voiceModelsChoice").addEventListener("change",updateModelActions);
 $("voiceModelsInstall").addEventListener("click",()=>{
  const id=$("voiceModelsChoice").value;
  if(modelBusy||id==="acoustic"||modelsInstalled.has(id))return;
  if(!bridge()?.voiceModelsInstall){
   voiceModelStatus("需要安装支持模型包的新 APK");return;
  }
  modelBusy=true;$("voiceModelsInstall").disabled=true;
  voiceModelStatus("正在查询模型包；首装会下载几十 MB，后续 APK 升级不重复下载。");
  bridge().voiceModelsInstall(id);
 });
 $("voiceModelsDelete").addEventListener("click",()=>{
  const id=$("voiceModelsChoice").value;
  if(modelBusy||id==="acoustic"||!modelsInstalled.has(id))return;
  if(holding||analyzing){
   voiceModelStatus("请结束发音分析后再删除");return;
  }
  if(bridge()?.voiceModelsDelete)bridge().voiceModelsDelete(id);
 });
 $("voiceModelsRefresh").addEventListener("click",()=>bridge()?.voiceModelsStatus?.());
 function displayPhoneExamples(){
  const lang=$("voicePhoneDisplay").value;
  const isZh=lang==="zh";
  $("voicePhonemeEnglishBox").hidden=isZh;
  $("voicePhonemePinyinBox").hidden=!isZh;
  bridge()?.voiceLabSetLanguage?.(lang);
  if(lastPhonemeEvent&&lastPhonemeEvent.language&&
     lastPhonemeEvent.language!==lang){
   safeText("voicePhonemeLimit","语言模式已切换。上方 IPA 是上一次的声学结果，"+
    "请重新按住说话；不会把原有音素直接当成另一种语言的单词。");
  }else if(isZh){
   safeText("voicePhonemePinyin",
    "保留上方 IPA 音段；不能由无声调音素可靠反推汉字或带调拼音。");
   safeText("voicePhonemeLimit",
    "普通话当前显示 ZIPA 的声学 IPA，不把单个音素映射成“你、衣、妈”等臆测词语。");
  }else if(lastPhonemeEvent){
   safeText("voicePhonemeLimit",
    lastPhonemeEvent.warning||"词典的音素相似度不代表发音准确度");
  }
 }
 $("voicePhoneDisplay").addEventListener("change",displayPhoneExamples);
 displayPhoneExamples();

 // Installed models are private app data, queried once when the Voice page opens.
 document.querySelector('.tabs button[data-page="voice"]')?.addEventListener("click",
  ()=>bridge()?.voiceModelsStatus?.());


 const names=["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
 const noteName=midi=>names[((midi%12)+12)%12]+(Math.floor(midi/12)-1);
 const el=(tag,attrs={})=>{
  const node=document.createElementNS(SVG,tag);
  for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
  return node;
 };
 function safeText(id,value){$(id).textContent=String(value);}
 function redrawPitch(){
  if(!grid||!traces)return;
  grid.replaceChildren();traces.replaceChildren();
  let minMidi=57,maxMidi=72;
  if(pitchPoints.length){
   minMidi=Math.floor(Math.min(...pitchPoints.map(v=>v.midi)))-2;
   maxMidi=Math.ceil(Math.max(...pitchPoints.map(v=>v.midi)))+2;
   if(maxMidi-minMidi<10){
    const center=(maxMidi+minMidi)/2;
    minMidi=Math.floor(center-5);maxMidi=minMidi+10;
   }
  }
  // MIDI is linear in pitch semitones; this makes vibrato and detuning visible.
  const x0=48,x1=351,y0=13,y1=194;
  const y=midi=>y1-(midi-minMidi)/(maxMidi-minMidi)*(y1-y0);
  for(let midi=Math.ceil(minMidi);midi<=Math.floor(maxMidi);midi++){
   const yy=y(midi);
   const major=midi%12===0||midi%12===5||midi%12===9;
   grid.appendChild(el("line",{
    x1:x0,x2:x1,y1:yy,y2:yy,stroke:major?"#3f6453":"#2a483b",
    "stroke-width":major?1.1:0.6,"stroke-dasharray":major?"":"3 4"
   }));
   if(major||maxMidi-minMidi<=11){
    const label=el("text",{x:6,y:yy+3,fill:"#9bbdaa","font-size":10});
    label.textContent=noteName(midi);
    grid.appendChild(label);
   }
  }
  if(!pitchPoints.length){
   const empty=el("text",{x:200,y:100,"text-anchor":"middle",fill:"#8ab3a0","font-size":12});
   empty.textContent="开始哼唱后显示逐音轨迹";
   traces.appendChild(empty);return;
  }
  const len=pitchPoints.length;
  const dx=(x1-x0)/Math.max(1,len-1);
  // Each continuous musical note gets its own colored trace so a do-re-mi
  // exercise produces distinct plateaus rather than a single flat timeline.
  const palette=["#73e0ac","#71bbfb","#edbf7a","#b6a1ee","#f09696"];
  let from=0;
  function segment(to){
   if(to<=from)return;
   const arr=pitchPoints.slice(from,to),begin=arr[0].nearest;
   const color=palette[((begin%palette.length)+palette.length)%palette.length];
   const d=arr.map((item,i)=>{
    const xx=x0+(from+i)*dx,yy=y(item.midi);
    return (i===0?"M":"L")+xx.toFixed(1)+" "+yy.toFixed(1);
   }).join(" ");
   if(arr.length===1){
    traces.appendChild(el("circle",{cx:x0+from*dx,cy:y(arr[0].midi),
      r:2.5,fill:color}));
   }else traces.appendChild(el("path",{d,fill:"none",stroke:color,
    "stroke-width":2.3,"stroke-linejoin":"round","stroke-linecap":"round"}));
   // Label durable note runs only; filter short transitions for clarity.
   if(arr.length>=3){
    const x=x0+from*dx+2, yy=Math.max(18,y(begin)-7);
    const tag=el("text",{x,y:yy,fill:color,"font-size":11,"font-weight":700});
    tag.textContent=noteName(begin);
    traces.appendChild(tag);
   }
  }
  for(let i=1;i<pitchPoints.length;i++){
   if(pitchPoints[i].nearest!==pitchPoints[i-1].nearest){
    segment(i);from=i;
   }
  }
  segment(pitchPoints.length);
  // The last voiced sample remains visible indefinitely, even in silence.
  const last=pitchPoints[pitchPoints.length-1];
  traces.appendChild(el("circle",{cx:x0+(len-1)*dx,
    cy:y(last.midi),r:3.2,fill:"#ffffff"}));
 }
 function pitchSample(evt){
  const hz=Number(evt.pitch_hz),midi=Number(evt.midi);
  if(!(hz>0)||!Number.isFinite(midi)||!pitchOn)return; // HOLD on silence.
  const nearest=Math.round(midi);
  const cents=Number(evt.cents)||0;
  pitchPoints.push({midi,nearest});
  if(pitchPoints.length>maxPoints)pitchPoints.splice(0,pitchPoints.length-maxPoints);
  latestNote=evt.note||noteName(nearest);
  safeText("voicePitchNote",latestNote);
  safeText("voicePitchHz",hz.toFixed(1)+" Hz");
  safeText("voicePitchCents",(cents>0?"+":"")+cents.toFixed(1)+" cents");
  redrawPitch();
 }
 function resetPitch(){
  pitchPoints.length=0;latestNote="";
  safeText("voicePitchNote","—");
  safeText("voicePitchHz","—");
  safeText("voicePitchCents","—");
  redrawPitch();
 }
 function setPitchRunning(on){
  pitchOn=on;
  $("voicePitchStart").disabled=on;
  $("voicePitchStop").disabled=!on;
  safeText("voicePitchState",on?"● 采集中":
    pitchPoints.length?"已暂停 · 结果保留":"未开始");
 }
 function setPhonemeState(state,message){
  safeText("voicePhonemeState",state);
  if(message)safeText("voicePhonemeStatus",message);
 }
 function showPhonemes(evt){
  lastPhonemeEvent=evt;
  safeText("voicePhonemeUsedEngine",evt.engine_kind==="neural_ctc"?
   "· 神经网络："+evt.engine_id:evt.engine_kind==="neural_error"?
   "· 模型运行错误":"· 基础声学探针");
  analyzing=false;holding=false;hasPhonemeResult=true;hold.disabled=false;
  hold.textContent="按住说话";
  setPhonemeState("已完成 · 结果保留",evt.message||"本次声学分析已结束");
  safeText("voicePhonemeDuration",
   evt.duration_ms?("· "+(Number(evt.duration_ms)/1000).toFixed(2)+" 秒"):"");
  const target=$("voicePhonemeSequence");
  target.replaceChildren();
  const candidates=Array.isArray(evt.candidates)?evt.candidates:[];
  if(!candidates.length){
   const empty=document.createElement("span");empty.className="voice-empty";
   empty.textContent="没有稳定的可归类音素（不是未发音）";
   target.appendChild(empty);
  }
  for(const candidate of candidates){
   const chip=document.createElement("span");
   chip.className="voice-phoneme-chip";
   chip.textContent=String(candidate.ipa||"未分类");
   target.appendChild(chip);
  }
  const matches=Array.isArray(evt.word_matches)?evt.word_matches:[];
  const results=$("voiceWordMatches");
  results.replaceChildren();
  const neural=evt.engine_kind==="neural_ctc";
  const english=evt.language==="en";
  if(neural&&english&&matches.length){
   safeText("voicePhonemeEnglish",matches.length+" 个候选");
   for(const [i,match] of matches.entries()){
    const card=document.createElement("div");
    card.className="voice-word-match";
    const title=document.createElement("div");
    title.className="voice-word-match-title";
    const word=document.createElement("strong");
    word.textContent=String(match.word||"");
    const ipa=document.createElement("span");
    ipa.textContent="/"+String(match.ipa||"").replace(/^[\/]+|[\/]+$/g,"")+"/";
    const grade=document.createElement("span");
    grade.className="voice-word-match-score";
    grade.textContent=match.exact?"完整音素匹配":
      "音素相似 "+Number(match.phone_similarity||0)+"%";
    title.append(word,ipa,grade);
    const translation=document.createElement("p");
    translation.textContent=String(match.zh||"无中文释义");
    card.append(title,translation);
    results.appendChild(card);
   }
  }else{
   safeText("voicePhonemeEnglish","无完整词典匹配");
   const empty=document.createElement("p");
   empty.className="voice-empty";
   empty.textContent=evt.dictionary_error||(
    !neural?"当前基础声学探针不能可靠查整词；请选用 ZIPA 神经音素模型。":
    !english?"请切换英语模式并重新发音，才进行英汉整词反查。":
    "没有找到足够接近的英语词条；保留上方音素原样。");
   results.appendChild(empty);
  }
  safeText("voiceDictionaryNotice",neural&&english?
   "离线词典 "+(Number(evt.dictionary_entries)||0).toLocaleString("zh-CN")+
   " 词条 · 词典相似度≠模型置信度，更不是口音评分。":
   "词典匹配只有在英语模式使用 ZIPA 声学音素模型时才运行。");
  safeText("voicePhonemePinyin",evt.mandarin_note||
   "原始 IPA 已保留；当前不能可靠识别普通话汉字或声调。");
  safeText("voicePhonemeLimit",evt.warning||
   "声学候选不能直接代表完整音素转录或发音准确率。");
  displayPhoneExamples();
 }
 function stopAll(){
  if(pitchOn||holding||analyzing)bridge()?.voiceLabStop?.();
  if(holding){
   holding=false;hold.disabled=false;hold.textContent="按住说话";
  }
  analyzing=false;
  setPitchRunning(false);
 }
 function selectPanel(panel){
  if(panel===currentPanel)return;
  stopAll();
  currentPanel=panel;
  for(const value of ["pitch","phoneme"]){
   const chosen=value===panel;
   $("voice"+(value==="pitch"?"Pitch":"Phoneme")+"View").classList.toggle("active",chosen);
   $("voice"+(value==="pitch"?"Pitch":"Phoneme")+"View").hidden=!chosen;
   const tab=$("voice"+(value==="pitch"?"Pitch":"Phoneme")+"Tab");
   tab.classList.toggle("active",chosen);
   tab.setAttribute("aria-selected",String(chosen));
  }
  // Crucial: switching views never clears previous pitch or phoneme results.
  if(panel==="pitch")redrawPitch();
 }
 function startPitch(){
  if(!bridge()?.voiceLabStart){
   safeText("voicePitchStatus","需要安装新版 APK；仅界面更新无法新增录音功能");
   return;
  }
  bridge().voiceLabStart("pitch");
  safeText("voicePitchStatus","正在开启麦克风…");
 }
 $("voicePitchStart").addEventListener("click",startPitch);
 $("voicePitchStop").addEventListener("click",()=>bridge()?.voiceLabStop?.());
 $("voicePitchClear").addEventListener("click",resetPitch);
 $("voicePitchTab").addEventListener("click",()=>selectPanel("pitch"));
 $("voicePhonemeTab").addEventListener("click",()=>selectPanel("phoneme"));

 function down(event){
  if(holding||analyzing||hold.disabled)return;
  if(event&&event.preventDefault)event.preventDefault();
  if(!bridge()?.voiceLabStart){
   setPhonemeState("需要升级 APK","当前版本不支持按住录音");
   return;
  }
  holding=true;
  hold.classList.add("holding");
  hold.textContent="● 录音中 · 松开分析";
  setPhonemeState("录音中","正在采集完整发音，松开后开始分析。最长 5 秒。");
  if(event?.pointerId!==undefined)try{hold.setPointerCapture(event.pointerId);}catch(_){}
  bridge().voiceLabStart("phoneme");
 }
 function up(event){
  if(!holding)return;
  if(event&&event.preventDefault)event.preventDefault();
  holding=false;analyzing=true;
  hold.classList.remove("holding");
  hold.textContent="正在分析…";
  hold.disabled=true;
  setPhonemeState("分析中","已松开，正在分析刚才的整段录音…");
  bridge()?.voiceLabFinishPhoneme?.();
 }
 function cancel(){
  if(!holding)return;
  holding=false;analyzing=false;
  hold.classList.remove("holding");
  hold.textContent="按住说话";
  hold.disabled=false;
  setPhonemeState("已取消","本次发音已取消；上一条分析结果仍保留。");
  bridge()?.voiceLabStop?.();
 }
 hold.addEventListener("pointerdown",down);
 hold.addEventListener("pointerup",up);
 hold.addEventListener("pointercancel",cancel);
 hold.addEventListener("keydown",event=>{
  if((event.key===" "||event.key==="Enter")&&!event.repeat)down(event);
 });
 hold.addEventListener("keyup",event=>{
  if(event.key===" "||event.key==="Enter")up(event);
 });
 // Avoid drag/long-press selection and browser generated synthetic clicks.
 hold.addEventListener("contextmenu",event=>event.preventDefault());

 window.bodyTraceReceive=function(evt){
  if(typeof oldReceiver==="function")oldReceiver(evt);
  if(!evt)return;
  if(evt.type==="voice_models"){renderModels(evt);return;}
  if(evt.type!=="voice_lab")return;
  if(evt.state==="pitch_sample"){pitchSample(evt);return;}
  if(evt.state==="phoneme_result"){showPhonemes(evt);return;}
  if(evt.state==="permission_ready"){
   holding=false;analyzing=false;hold.disabled=false;
   hold.textContent="按住说话";hold.classList.remove("holding");
   setPhonemeState("权限已开启",evt.message||"请再次按住发音");
   return;
  }
  if(evt.state==="running"){
   if(evt.mode==="pitch"){
    setPitchRunning(true);
    safeText("voicePitchStatus","发声时绘图，停声时冻结，最后音高会保留。");
   }else if(evt.mode==="phoneme"){
    if(!holding)bridge()?.voiceLabFinishPhoneme?.();
   }
   return;
  }
  if(evt.state==="analyzing"){
   setPhonemeState("分析中",evt.message||"正在分析整段录音…");return;
  }
  if(evt.state==="stopped"){
   if(evt.mode==="pitch"){
    setPitchRunning(false);
    safeText("voicePitchStatus",evt.message||"已停止，音高轨迹保留。");
   }else if(!analyzing&&!holding&&!hasPhonemeResult)
    setPhonemeState("待发音",evt.message||"麦克风已关闭；上次结果保留");
   return;
  }
  if(evt.state==="error"){
   if(evt.mode==="pitch"){
    setPitchRunning(false);
    safeText("voicePitchStatus",evt.message||"麦克风启动失败");
   }else{
    holding=false;analyzing=false;hold.disabled=false;
    hold.classList.remove("holding");hold.textContent="按住说话";
    setPhonemeState("错误",evt.message||"分析失败；上次结果保留");
   }
  }
 };
 document.querySelectorAll(".tabs button[data-page]").forEach(tab=>{
  if(tab.dataset.page!=="voice")
   tab.addEventListener("click",stopAll);
 });
 window.addEventListener("pagehide",stopAll);
 redrawPitch();
 window.BodyTraceVoiceLab={
  // Read-only regression/debug status, no raw microphone audio.
  state:()=>({pitchPoints:pitchPoints.length,latestNote,holding,analyzing,currentPanel})
 };
})();
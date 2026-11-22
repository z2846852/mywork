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
 let allModelsReady=false;
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
  allModelsReady=Number(evt.installed_count)===Number(evt.total_count)&&
    Number(evt.total_count)>0;
  $("voiceModelsChoice").value=modelsSelected;
  safeText("voiceModelsEngine",
   modelsSelected==="acoustic"?"基础声学探针":modelsSelected+" ✓ 已安装");
  const chosen=modelsSelected;
  $("voiceModelsInstall").disabled=allModelsReady;
  $("voiceModelsDelete").disabled=chosen==="acoustic"||!modelsInstalled.has(chosen);
  const count=Number(evt.installed_count)||0;
  const dictionary=evt.dictionary_ready?
    "英汉词典 "+Number(evt.dictionary_entries).toLocaleString("zh-CN")+" 词条 ✓":
    "英汉词典异常，需更新 APK";
  voiceModelStatus("模型："+count+"/3 已完整 · "+dictionary+
    (allModelsReady?" · 可离线使用":" · 点击下载缺失模型")+
    (evt.message&&evt.message.includes("失败")?" · "+evt.message:""));
 }
 function updateModelActions(){
  const choice=$("voiceModelsChoice").value;
  $("voiceModelsInstall").disabled=modelBusy||allModelsReady;
  $("voiceModelsDelete").disabled=modelBusy||
    choice==="acoustic"||!modelsInstalled.has(choice);
  if(choice==="acoustic"||modelsInstalled.has(choice)){
   if(bridge()?.voiceModelsSelect)bridge().voiceModelsSelect(choice);
   else voiceModelStatus("安装新 APK 后才能选择神经音素模型");
  }else{
   voiceModelStatus("该模型尚未安装，点击“下载缺失资源”可一次补齐全部模型。");
  }
 }
 $("voiceModelsChoice").addEventListener("change",updateModelActions);
 $("voiceModelsInstall").addEventListener("click",()=>{
  const id="all";
  if(modelBusy||allModelsReady)return;
  if(!bridge()?.voiceModelsInstall){
   voiceModelStatus("需要安装支持模型包的新 APK");return;
  }
  modelBusy=true;$("voiceModelsInstall").disabled=true;
  voiceModelStatus("正在下载缺失模型（最多 3 个），已完整的不会重复下载。");
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



 const KEY_SIGNATURES={C:[0,0],G:[7,1],D:[2,2],A:[9,3],E:[4,4],B:[11,5],
   "F#":[6,6],"C#":[1,7],F:[5,-1],Bb:[10,-2],Eb:[3,-3],
   Ab:[8,-4],Db:[1,-5],Gb:[6,-6],Cb:[11,-7]};
 const LETTERS=["C","D","E","F","G","A","B"],NATURAL=[0,2,4,5,7,9,11];
 const SHARP=["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
 const FLAT=["C","D♭","D","E♭","E","F","G♭","G","A♭","A","B♭","B"];
 const STAFF={bass:[43,47,50,53,57],treble:[64,67,71,74,77]};
 const PASTELS=["#73e0ac","#71bbfb","#edbf7a","#b6a1ee","#f0adbd"],RED="#f17f86";
 const pc=n=>((n%12)+12)%12;
 function keyInfo(){
  const [tonic,fifths]=KEY_SIGNATURES[$("voicePitchKey").value]||KEY_SIGNATURES.C;
  const acc={},order=fifths<0?["B","E","A","D","G","C","F"]:["F","C","G","D","A","E","B"];
  for(let i=0;i<Math.abs(fifths);i++)acc[order[i]]=fifths<0?-1:1;
  return {tonic,fifths,acc,scale:new Set(NATURAL.map(n=>pc(n+tonic)))};
 }
 function noteName(midi,info=keyInfo()){
  const n=Math.round(midi),pitch=pc(n);
  for(let i=0;i<7;i++){
   const alt=info.acc[LETTERS[i]]||0;
   if(pc(NATURAL[i]+alt)===pitch)
    return LETTERS[i]+(alt===1?"♯":alt===-1?"♭":"")+
      Math.round((n-12-NATURAL[i]-alt)/12);
  }
  // Non-diatonic tones use the key's conventional sharp or flat direction.
  const name=(info.fifths<0?FLAT:SHARP)[pitch],i=LETTERS.indexOf(name[0]);
  const alt=name.includes("♯")?1:name.includes("♭")?-1:0;
  return name+Math.round((n-12-NATURAL[i]-alt)/12);
 }
 function toleranceCents(){
  const n=Number($("voicePitchTolerance").value);
  return Number.isFinite(n)?Math.max(10,Math.min(100,n)):50;
 }
 // Compare against the closest pitch permitted by this key signature, not a song.
 function gradePitch(midi,info=keyInfo(),tol=toleranceCents()){
  let target=null,delta=Infinity;
  const center=Math.round(midi);
  for(let n=center-3;n<=center+3;n++){
   if(!info.scale.has(pc(n)))continue;
   const offset=(midi-n)*100;
   if(Math.abs(offset)<Math.abs(delta)){delta=offset;target=n;}
  }
  return {target,delta,off:Math.abs(delta)>tol+1e-7};
 }
 function chosenStaff(){
  const selected=$("voicePitchClef").value;
  if(selected==="bass"||selected==="treble")return selected;
  if(!pitchPoints.length)return "bass";
  const sorted=pitchPoints.slice(-100).map(p=>p.midi).sort((a,b)=>a-b);
  return sorted[Math.floor(sorted.length/2)]>=62?"treble":"bass";
 }
 const el=(tag,attrs={})=>{
  const node=document.createElementNS(SVG,tag);
  for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
  return node;
 };
 function safeText(id,value){$(id).textContent=String(value);}

 function updatePitchFeedback(){
  safeText("voicePitchToleranceValue",toleranceCents()+" cents");
  if(!pitchPoints.length){
   $("voicePitchQuality").classList.remove("off");
   safeText("voicePitchQuality","等待有效音高");
   safeText("voicePitchNote","—");safeText("voicePitchCents","—");
   return;
  }
  const last=pitchPoints[pitchPoints.length-1],info=keyInfo();
  const near=Math.round(last.midi),cents=(last.midi-near)*100;
  const grade=gradePitch(last.midi,info);
  latestNote=noteName(near,info);
  safeText("voicePitchNote",latestNote);
  safeText("voicePitchCents",(cents>0?"+":"")+cents.toFixed(1)+" cents");
  safeText("voicePitchQuality",(grade.off?"偏离调内音":"调内")+" · 最近 "+
   noteName(grade.target,info)+" · "+(grade.delta>0?"+":"")+
   grade.delta.toFixed(0)+" cents");
  $("voicePitchQuality").classList.toggle("off",grade.off);
 }
 function redrawPitch(){
  if(!grid||!traces)return;
  grid.replaceChildren();traces.replaceChildren();
  const staff=STAFF[chosenStaff()],low=staff[0],high=staff[4],info=keyInfo();
  let min=low-4,max=high+4;
  if(pitchPoints.length){
   min=Math.min(min,Math.floor(Math.min(...pitchPoints.map(p=>p.midi)))-2);
   max=Math.max(max,Math.ceil(Math.max(...pitchPoints.map(p=>p.midi)))+2);
  }
  const x0=54,x1=352,y0=16,y1=197;
  const y=n=>y1-(n-min)/(max-min)*(y1-y0);
  for(let n=Math.ceil(min);n<=Math.floor(max);n++){
   const solid=staff.includes(n),outside=n<low||n>high;
   if(!solid&&!(outside&&NATURAL.includes(pc(n))))continue;
   const yy=y(n);
   grid.appendChild(el("line",{x1:x0,x2:x1,y1:yy,y2:yy,
    stroke:solid?"#719b85":"#3a604d","stroke-width":solid?1.25:0.75,
    "stroke-dasharray":solid?"":"3 5"}));
   if(solid||pc(n)===0){
    const label=el("text",{x:5,y:yy+3,fill:solid?"#b9d9c6":"#88a995","font-size":10});
    label.textContent=noteName(n,info);grid.appendChild(label);
   }
  }
  if(!pitchPoints.length){
   const empty=el("text",{x:202,y:105,"text-anchor":"middle",
    fill:"#8ab3a0","font-size":12});
   empty.textContent="开始哼唱后显示逐音轨迹";
   traces.appendChild(empty);return;
  }
  const dx=(x1-x0)/Math.max(1,pitchPoints.length-1);
  const grades=pitchPoints.map(p=>gradePitch(p.midi,info,toleranceCents()));
  let from=0;
  function segment(to){
   if(to<=from)return;
   const points=pitchPoints.slice(from,to),note=points[0].nearest;
   const color=grades[from].off?RED:PASTELS[pc(note)%PASTELS.length];
   const d=points.map((p,i)=>(i?"L":"M")+(x0+(from+i)*dx).toFixed(1)+" "+y(p.midi).toFixed(1)).join(" ");
   if(points.length===1)traces.appendChild(el("circle",{
    cx:x0+from*dx,cy:y(points[0].midi),r:2.7,fill:color}));
   else traces.appendChild(el("path",{d,fill:"none",stroke:color,
    "stroke-width":2.4,"stroke-linejoin":"round","stroke-linecap":"round"}));
   if(points.length>=3){
    const label=el("text",{x:x0+from*dx+2,y:Math.max(13,y(note)-7),fill:color,
     "font-size":11,"font-weight":700});
    label.textContent=noteName(note,info);traces.appendChild(label);
   }
  }
  for(let i=1;i<pitchPoints.length;i++){
   if(pitchPoints[i].nearest!==pitchPoints[i-1].nearest||
      grades[i].off!==grades[i-1].off){segment(i);from=i;}
  }
  segment(pitchPoints.length);
  const last=pitchPoints[pitchPoints.length-1],grade=grades[grades.length-1];
  traces.appendChild(el("circle",{cx:x0+(pitchPoints.length-1)*dx,
   cy:y(last.midi),r:3.1,fill:grade.off?RED:"#f5fff9",
   stroke:"#122820","stroke-width":1}));
 }
 function pitchSample(evt){
  const hz=Number(evt.pitch_hz),midi=Number(evt.midi);
  if(!(hz>0)||!Number.isFinite(midi)||!pitchOn)return; // HOLD on silence.
  pitchPoints.push({midi,nearest:Math.round(midi)});
  if(pitchPoints.length>maxPoints)pitchPoints.splice(0,pitchPoints.length-maxPoints);
  safeText("voicePitchHz",hz.toFixed(1)+" Hz");
  updatePitchFeedback();redrawPitch();
 }
 function resetPitch(){
  pitchPoints.length=0;latestNote="";
  safeText("voicePitchHz","—");updatePitchFeedback();redrawPitch();
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
 $("voicePitchKey").addEventListener("change",()=>{updatePitchFeedback();redrawPitch();});
 $("voicePitchClef").addEventListener("change",redrawPitch);
 for(const type of ["input","change"])$("voicePitchTolerance").addEventListener(type,
  ()=>{updatePitchFeedback();redrawPitch();});
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
 updatePitchFeedback();
 redrawPitch();
 window.BodyTraceVoiceLab={
  // Read-only regression/debug status, no raw microphone audio.
  state:()=>({pitchPoints:pitchPoints.length,latestNote,holding,analyzing,currentPanel,
   key:$("voicePitchKey").value,tolerance:toleranceCents(),clef:chosenStaff()})
 };
})();
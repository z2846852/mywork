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
  analyzing=false;holding=false;hasPhonemeResult=true;hold.disabled=false;
  hold.textContent="按住说话";
  setPhonemeState("已完成 · 结果保留",evt.message||"本次声学分析已结束");
  safeText("voicePhonemeDuration",
   evt.duration_ms?("· "+(Number(evt.duration_ms)/1000).toFixed(2)+" 秒"):"");
  const target=$("voicePhonemeSequence");
  target.replaceChildren();
  const candidates=Array.isArray(evt.candidates)?evt.candidates:[];
  const uniqueEnglish=new Set(),uniquePinyin=new Set();
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
   if(candidate.english_words)uniqueEnglish.add(candidate.english_words);
   if(candidate.pinyin_examples)uniquePinyin.add(candidate.pinyin_examples);
  }
  safeText("voicePhonemeEnglish",[...uniqueEnglish].slice(0,4).join("；")||"—");
  safeText("voicePhonemePinyin",[...uniquePinyin].slice(0,4).join("；")||"—");
  safeText("voicePhonemeLimit",evt.warning||
   "实验性声学特征，不能代表完整音素转录或发音准确率。");
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
  if(!evt||evt.type!=="voice_lab")return;
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
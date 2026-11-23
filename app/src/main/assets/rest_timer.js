/* Training rest timer: per-exercise presets, wall-clock countdown, negative overtime.
 * UI and preference state stay on device. No network, alarm, or notification permission.
 */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const H=1000;
 const BASE=Object.freeze({
  // Large, multi-joint or taxing machine/free-weight lifts: 2.5–3 min.
  assisted_pullup:180,assisted_dip:180,barbell_bench:180,smith_bench:150,
  dumbbell_bench:150,incline_dumbbell_bench:150,decline_bench:150,
  leg_press:180,leg_press_45:180,single_leg_press:150,hip_thrust:150,
  overhead_press:180,dumbbell_shoulder_press:150,shoulder_press:150,
  chest_press:150,horizontal_bench:150,incline_chest_press:150,
  row:150,vertical_traction:150,
  // Smaller, single-joint movements: 90 sec.
  adductor:90,abductor:90,lateral_raise:90,reverse_fly:90,
  pec_deck:90,leg_extension:90,prone_leg_curl:90,seated_leg_curl:90,
  front_raise:90,rear_delt_fly:90,face_pull:90
 });
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
 function defaultSeconds(id,label){
  if(own(BASE,id))return BASE[id];
  const name=String(label||"").toLowerCase();
  if(/弯举|侧平举|飞鸟|伸腿|腿屈伸|内收|外展|提踵|卷腹|夹胸|curl|raise|fly|extension/.test(name))return 90;
  if(/深蹲|硬拉|卧推|引体|腿举|倒蹬|臀推|推举|squat|deadlift|press|pullup/.test(name))return 180;
  if(/划船|下拉|row|traction/.test(name))return 150;
  return 120; // Unknown custom movement: editable, not a false precise prescription.
 }
 function remainingSeconds(deadline,now){const n=Math.ceil((deadline-now)/H);return n===0?0:n;}
 function clock(seconds){
  const negative=seconds<0;
  let a=Math.abs(Math.trunc(seconds));
  const hours=Math.floor(a/3600);a%=3600;
  const minutes=Math.floor(a/60),secs=a%60;
  const padded=n=>String(n).padStart(2,"0");
  return (negative?"-":"")+(hours?hours+":"+padded(minutes)+":"+padded(secs):
   padded(minutes)+":"+padded(secs));
 }
 // Exposed for deterministic Node regressions, no coupling to timers.
 window.BodyTraceRestMath=Object.freeze({defaultSeconds,remainingSeconds,clock});

 let running=false,deadlineMs=0,durationSec=0,exerciseId="";
 let overrides={},goals={};
 let userTouched=false,preferenceRestored=false,pendingAuto="";
 let advancedTouched=false,advancedKnownOpen=$("recordAdvancedTools").open;
 $("recordAdvancedTools").addEventListener("toggle",()=>{
  const open=$("recordAdvancedTools").open;
  if(open===advancedKnownOpen)return;
  advancedKnownOpen=open;advancedTouched=true;
  window.BodyTraceNative?.setRecordAdvancedExpanded?.(open);
 });
 const exercise=()=>$("recordExercise")?.value||"";
 const label=id=>exerciseLabels[id]||id||"未选择动作";
 const validId=id=>/^[a-z][a-z0-9_]{1,63}$/.test(id);
 const goalFor=id=>Number(goals[id])||4;
 function presetFor(id){
  return own(overrides,id)?Number(overrides[id]):defaultSeconds(id,label(id));
 }
 function countToday(id){
  const date=$("recordDate")?.value;
  if(!id||!date||typeof state==="undefined")return 0;
  return state.rows.filter(row=>row.exercise_id===id&&row.session_date===date).length;
 }
 function renderProgress(){
  const id=exercise(),target=goalFor(id);
  const completed=countToday(id);
  $("recordProgress").textContent=completed+" / "+target+" 组";
  $("recordTargetSets").value=String(target);
  const dots=$("recordSetDots");
  dots.replaceChildren();
  const total=Math.min(12,Math.max(target,completed));
  for(let i=0;i<total;i++){
   const dot=document.createElement("span");
   dot.className="record-set-dot"+(i<completed?" done":"");
   dot.textContent=String(i+1);
   dot.title=i<completed?"已保存第"+(i+1)+"组":"待完成第"+(i+1)+"组";
   dots.appendChild(dot);
  }
 }
 function stateSnapshot(){
  return {running,deadline_ms:running?deadlineMs:0,
   duration_seconds:durationSec,exercise_id:running?exerciseId:"",
   overrides,goals};
 }
 function saveState(){
  userTouched=true;
  window.BodyTraceNative?.setRestTimerState?.(JSON.stringify(stateSnapshot()));
 }
 function renderTimer(){
  const id=exercise(),base=presetFor(id);
  $("recordRestPreset").textContent=clock(base);
  $("recordRestExercise").textContent=label(id);
  $("recordRestStart").disabled=!id;
  $("recordRestStart").textContent=running?"↻ 重计本动作":"▶ 开始休息";
  $("recordRestStop").disabled=!running;
  const seconds=running?remainingSeconds(deadlineMs,Date.now()):base;
  $("recordRestClock").textContent=clock(seconds);
  $("recordRestCard").classList.toggle("rest-overtime",running&&seconds<0);
  $("recordRestCard").classList.toggle("rest-running",running&&seconds>=0);
  $("recordRestState").textContent=!running?"尚未开始":seconds<0?"已超时 · 可继续恢复":"休息倒计时";
  $("recordRestHint").textContent=!running?
   "完成一组后点击开始，或保存本组并自动计时":
   (exerciseId!==id?"当前正在计时："+label(exerciseId):
    seconds<0?"负数表示超出预设休息时间":"切换页面后按真实经过时间继续");
 }
 function render(){renderProgress();renderTimer();}
 function start(id){
  if(!id||!validId(id))return false;
  durationSec=presetFor(id);
  if(!Number.isFinite(durationSec)||durationSec<30||durationSec>600)return false;
  exerciseId=id;
  deadlineMs=Date.now()+durationSec*H;
  running=true;saveState();render();
  return true;
 }
 function stop(){
  running=false;deadlineMs=0;exerciseId="";durationSec=0;
  saveState();render();
 }
 function adjust(delta){
  const id=exercise();if(!id)return;
  const next=Math.max(30,Math.min(600,presetFor(id)+delta));
  overrides={...overrides,[id]:next};
  // Adjust the preset for future rests. An already-running rest is not
  // unexpectedly shortened, especially when another movement is selected.
  saveState();render();
 }
 function restore(raw){
  if(userTouched||preferenceRestored)return;
  preferenceRestored=true;
  try{
   const obj=typeof raw==="string"?JSON.parse(raw||"{}"):raw||{};
   const clean=(values,min,max,allowed)=>{
    const result={};
    if(!values||typeof values!=="object"||Array.isArray(values))return result;
    for(const [id,value] of Object.entries(values).slice(0,128)){
     const n=Number(value);
     if(validId(id)&&Number.isInteger(n)&&n>=min&&n<=max&&
        (!allowed||allowed.includes(n)))result[id]=n;
    }
    return result;
   };
   overrides=clean(obj.overrides,30,600);
   goals=clean(obj.goals,2,10,[2,3,4,5,6,8,10]);
   running=obj.running===true&&validId(obj.exercise_id||"")&&
    Number.isFinite(Number(obj.deadline_ms))&&Number(obj.deadline_ms)>0&&
    Number.isInteger(Number(obj.duration_seconds))&&
    Number(obj.duration_seconds)>=30&&Number(obj.duration_seconds)<=600;
   if(running){
    deadlineMs=Number(obj.deadline_ms);
    durationSec=Number(obj.duration_seconds);
    exerciseId=obj.exercise_id;
   }
  }catch(e){running=false;}
  render();
 }
 $("recordRestShorter").onclick=()=>adjust(-15);
 $("recordRestLonger").onclick=()=>adjust(15);
 $("recordRestStart").onclick=()=>start(exercise());
 $("recordRestStop").onclick=stop;
 $("recordTargetSets").onchange=()=>{
  const id=exercise(),n=Number($("recordTargetSets").value);
  if(id&&[2,3,4,5,6,8,10].includes(n)){goals={...goals,[id]:n};saveState();}
  renderProgress();
 };
 $("recordExercise").addEventListener("change",render);
 $("recordGroup").addEventListener("change",()=>requestAnimationFrame(render));
 $("recordDate").addEventListener("change",renderProgress);
 window.setInterval(()=>{if(running&&document.body.dataset.activePage==="record")renderTimer();},500);
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)render();});
 window.addEventListener("pageshow",render);
 window.BodyTraceRestTimer={
  render,
  armAfterSave(id){
   // Only a genuine native local_saved receipt starts the rest clock.
   pendingAuto=id;
  },
  shouldStayOnRecord(evt){
   return !!pendingAuto && !!evt?.event?.exercise_id &&
    evt.event.exercise_id===pendingAuto;
  },
  cancelPending(){pendingAuto="";},
  state:stateSnapshot
 };
 const previous=window.bodyTraceReceive;
 window.bodyTraceReceive=function(evt){
  if(typeof previous==="function")previous(evt);
  if(!evt||!evt.type)return;
  if(evt.type==="ui_preferences"){
   if(!advancedTouched){
    advancedKnownOpen=!!evt.record_advanced_expanded;
    $("recordAdvancedTools").open=advancedKnownOpen;
   }
   restore(evt.rest_timer_state);
  }
  if(evt.type==="data"||evt.type==="workout_edit_local_saved"||
     evt.type==="exercise_catalog")requestAnimationFrame(render);
  if(evt.type==="local_saved"){
   const shouldStart=pendingAuto&&evt.event?.exercise_id===pendingAuto;
   pendingAuto="";
   if(shouldStart)start(evt.event.exercise_id);
   else render();
  }
  if(evt.type==="error")pendingAuto="";
 };
 render();
})();

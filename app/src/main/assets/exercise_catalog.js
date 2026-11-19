/* BodyTrace exercise catalog: user-managed labels, soft hiding and sort preference.
 * Actual workout records are never deleted by catalog changes.
 * Native syncs catalog JSON to private GitHub; this script is UI only.
 */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const groups=["胸","肩","背","腿","手臂","核心","其他"];
 const overviewGroup=region=>["胸","肩","背","腿"].includes(region)?region:"其他";
 const defaults=Object.entries(exerciseLabels).map(([id,label],position)=>({
  id,label,region:exerciseRegionById[id]||"其他",builtin:true,position
 }));
 let config={schema_version:1,sort_mode:"recent",custom:[],hidden:[]};
 let deleteConfirmId="";
 function copyConfig(c){
  const src=c&&typeof c==="object"?c:{};
  return {schema_version:1,
   sort_mode:src.sort_mode==="region"?"region":"recent",
   custom:Array.isArray(src.custom)?src.custom.map(o=>({
    id:String(o.id),label:String(o.label),region:String(o.region)
   })):[],
   hidden:Array.isArray(src.hidden)?src.hidden.slice():[]};
 }
 function allActions(){
  const list=defaults.slice();
  for(const [index,entry] of config.custom.entries()){
   if(!entry.id||!entry.label||!groups.includes(entry.region))continue;
   list.push({...entry,builtin:false,position:defaults.length+index});
  }
  return list;
 }
 function lastUsed(rows){
  const result=new Map();
  rows.forEach((row,index)=>{
   if(!row.exercise_id||!/^\d{4}-\d{2}-\d{2}$/.test(row.session_date||""))return;
   const next={date:row.session_date,created:String(row.created_at||""),index};
   const older=result.get(row.exercise_id);
   if(!older||next.date>older.date||
     next.date===older.date&&(next.created>older.created||
      next.created===older.created&&index>older.index))result.set(row.exercise_id,next);
  });
  return result;
 }
 function compareUsage(a,b,usage){
  const first=usage.get(a.id),second=usage.get(b.id);
  if(!first&&!second)return a.position-b.position;
  if(!first)return 1;
  if(!second)return -1;
  return second.date.localeCompare(first.date)||
   second.created.localeCompare(first.created)||
   second.index-first.index||a.position-b.position;
 }
 function order(actions,rows){
  const recent=lastUsed(rows);
  return actions.slice().sort((a,b)=>{
   if(config.sort_mode==="region"){
    const region=groups.indexOf(a.region)-groups.indexOf(b.region);
    if(region!==0)return region;
   }
   return compareUsage(a,b,recent);
  });
 }
 // The first data hydration picks the newest exercise. Later refreshes keep user selection.
let hydrated=false;
let groupChosen=false;
let blockedDraftExerciseId="";
function rebuild(rows,keepSelection=true){
 const select=$("recordExercise"),groupSelect=$("recordGroup");
 const previous=select.value;
 const hidden=new Set(config.hidden);
 const sorted=order(allActions().filter(a=>!hidden.has(a.id)),rows||[]);
 const group=groupSelect.value;
 const visible=group?sorted.filter(a=>overviewGroup(a.region)===group):sorted;
 select.replaceChildren();
 for(const entry of visible){
  const option=document.createElement("option");
  option.value=entry.id;
  option.textContent="【"+overviewGroup(entry.region)+"】"+entry.label;
  select.append(option);
 }
 // Hidden actions still have their historical labels.
 for(const entry of allActions()){
  exerciseLabels[entry.id]=entry.label;exerciseRegionById[entry.id]=entry.region;
 }
 const stillVisible=!!previous&&visible.some(a=>a.id===previous);
 const keep=keepSelection&&stillVisible&&(recordExerciseTouched||groupChosen||trainingFormDirty||hydrated);
 let selected=keep?previous:(visible[0]?.id||"");
 const missingDraft=!!blockedDraftExerciseId||
   (keepSelection&&trainingFormDirty&&!!previous&&!stillVisible);
 if(missingDraft&&!blockedDraftExerciseId)blockedDraftExerciseId=previous;
 if(missingDraft){
  const warning=document.createElement("option");
  warning.value="";
  warning.textContent="原动作已隐藏，请重新选择动作";
  select.append(warning);
  selected="";
 }else if(!visible.length){
  const warning=document.createElement("option");
  warning.value="";
  warning.textContent="暂无可选动作，请在管理中恢复";
  select.append(warning);
 }
 select.value=selected;
 $("recordSortMode").value=config.sort_mode;
 if(missingDraft){
  $("suggestedLoad").textContent="原动作已隐藏；输入已保留，请重新选动作后保存。";
 }else if(!keepSelection||selected!==previous){
  clearTrainingEdits();
  refreshExerciseRecommendation(true);
 }else refreshExerciseRecommendation(false);
 if(Array.isArray(rows)&&rows.length)hydrated=true;
 renderManager();
}
function commit(){
  rebuild(state.rows);
  if(window.BodyTraceNative?.saveCatalog){
   BodyTraceNative.saveCatalog(JSON.stringify(config));
  }else{
   toast("动作列表已更新，但当前 APK 不支持持久保存",true);
  }
 }
 function renderManager(){
  const target=$("exerciseManageList");
  if(!target)return;
  target.replaceChildren();
  const hidden=new Set(config.hidden);
  for(const entry of allActions().sort((a,b)=>{
   const first=groups.indexOf(a.region)-groups.indexOf(b.region);
   return first||a.position-b.position;
  })){
   const row=document.createElement("div");row.className="exercise-manage-item";
   row.dataset.exerciseId=entry.id;
   const label=document.createElement("span");
   label.textContent="【"+entry.region+"】"+entry.label;
   label.className="exercise-manage-name";
   if(hidden.has(entry.id))label.classList.add("muted");
   const controls=document.createElement("div");controls.className="exercise-manage-controls";
   const visibility=document.createElement("button");
   visibility.type="button";visibility.className="mini secondary";
   visibility.textContent=hidden.has(entry.id)?"恢复":"隐藏";
   visibility.onclick=()=>{
    const current=new Set(config.hidden);
    if(current.has(entry.id))current.delete(entry.id);else current.add(entry.id);
    config.hidden=[...current];deleteConfirmId="";commit();
   };
   controls.append(visibility);
   if(!entry.builtin){
    const remove=document.createElement("button");
    remove.type="button";remove.className="mini danger-soft";
    remove.textContent=deleteConfirmId===entry.id?"确认删除":"删除";
    remove.onclick=()=>{
     if(deleteConfirmId!==entry.id){
      deleteConfirmId=entry.id;renderManager();return;
     }
     config.custom=config.custom.filter(item=>item.id!==entry.id);
     config.hidden=config.hidden.filter(id=>id!==entry.id);
     deleteConfirmId="";
     commit();
    };
    controls.append(remove);
   }
   row.append(label,controls);target.append(row);
  }
 }
 function applyRemote(data){
  config=copyConfig(data);
  for(const item of config.custom){
   exerciseLabels[item.id]=item.label;
   exerciseRegionById[item.id]=item.region;
  }
  rebuild(state.rows,true);
  // A newer shared catalog can resolve previously unknown legacy classes.
  // Refresh home quadrants, trends and anatomy immediately after it arrives.
  indexData();
  if(typeof window.BodyTraceRenderFeatures==="function")window.BodyTraceRenderFeatures();
 }
 $("recordExercise").addEventListener("change",()=>{blockedDraftExerciseId="";});
 $("recordGroup").addEventListener("change",()=>{blockedDraftExerciseId="";groupChosen=true;
 recordExerciseTouched=false;
 clearTrainingEdits();
 rebuild(state.rows,false);
});
$("recordSortMode").addEventListener("change",e=>{
  config.sort_mode=e.target.value==="region"?"region":"recent";
  // Changing sort must not unexpectedly change the selected action.
  recordExerciseTouched=true;commit();
 });
 $("manageExercises").onclick=()=>{
  $("exerciseManager").hidden=false;
  renderManager();
 };
 $("closeExerciseManager").onclick=()=>{
  $("exerciseManager").hidden=true;deleteConfirmId="";
 };
 $("addCustomExercise").onclick=()=>{
  const name=$("customActionName").value.trim();
  const region=$("customActionRegion").value;
  if(!name||name.length>60||!groups.includes(region)){
   toast("请输入1–60字的动作名称并选择训练部位",true);return;
  }
  if(allActions().some(o=>o.label.toLowerCase()===name.toLowerCase())){
   toast("该动作已经存在；可以在下方恢复隐藏的动作",true);return;
  }
  if(config.custom.length>=64){toast("自定义动作最多64个",true);return}
  const id="custom_"+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
  config.custom.push({id,label:name,region});
  $("customActionName").value="";
  config.hidden=config.hidden.filter(x=>x!==id);
  deleteConfirmId="";
  recordExerciseTouched=true;
  // Select the new action within its assigned muscle group.
  $("recordGroup").value=region;
  rebuild(state.rows,false);
  $("recordExercise").value=id;
  refreshExerciseRecommendation(true);
  commit();
  toast("动作已新增，历史数据不受影响");
 };
 window.BodyTraceExerciseCatalog={
  refresh(rows){rebuild(rows,true)},
  region(id){return exerciseRegionById[id]||"其他"},
  label(id){return exerciseLabels[id]||id},
  getConfig(){return copyConfig(config)},
  order,
  apply:applyRemote
 };
 const previousReceiver=window.bodyTraceReceive;
 window.bodyTraceReceive=function(event){
  if(typeof previousReceiver==="function")previousReceiver(event);
  if(event?.type==="exercise_catalog"){
   applyRemote(event.catalog);
  }else if(event?.type==="data"||event?.type==="local_saved"){
   rebuild(state.rows,true);
  }
 };
 rebuild(state.rows,false);
})();

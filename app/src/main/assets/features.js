/* BodyTrace offline features: editable nutrition, workout trends, regional body map.
 * Only derived chart state is recalculated. Raw JSON is never replaced here.
 */
(function() {
"use strict";
const FIXED_HEIGHT_CM = 173.5;
const mealLabels = {breakfast:"早餐",lunch:"午餐",dinner:"晚餐",snack:"加餐",other:"其他"};
const foodPresets = {
  rice:{name:"熟白米饭",kcal:116,protein:2.6,carbs:25.9,fat:0.3},
  egg:{name:"鸡蛋",kcal:145,protein:12.6,carbs:1.1,fat:10.5},
  soy:{name:"无糖豆浆",kcal:32,protein:3,carbs:1.8,fat:1.2},
  chicken:{name:"熟鸡胸肉",kcal:165,protein:31,carbs:0,fat:3.6},
  soup:{name:"肉骨茶/排骨汤",kcal:null}
};
const regions = ["胸","肩","背","腿","手臂","核心"];
const regionCodes = {胸:"chest",肩:"shoulders",背:"back",腿:"legs",手臂:"arms",核心:"core"};
const exRegion = {
  chest_press:"胸",smith_bench:"胸",pec_deck:"胸",incline_chest_press:"胸",
  horizontal_bench:"胸",assisted_dip:"胸",
  lateral_raise:"肩",reverse_fly:"肩",shoulder_press:"肩",
  row:"背",assisted_pullup:"背",vertical_traction:"背",
  leg_press:"腿",adductor:"腿",abductor:"腿",leg_extension:"腿",
  prone_leg_curl:"腿",hip_thrust:"腿"
};
let selectedRegion = "背";
const round1 = v => Math.round(v*10)/10;
const validNum = x => x !== "" && x !== null && x !== undefined && Number.isFinite(Number(x));
const safeNum = x => Number(x);
function foodEnergy(item) {
  if (validNum(item.grams) && validNum(item.kcal_per_100g)) {
    return safeNum(item.grams)*safeNum(item.kcal_per_100g)/100;
  }
  if (validNum(item.kcal_total)) return safeNum(item.kcal_total);
  return null;
}
function foodMacro(item, key) {
  if (!validNum(item.grams) || !validNum(item[key+"_per_100g"])) return null;
  return safeNum(item.grams)*safeNum(item[key+"_per_100g"])/100;
}
function energyEntries() {
  return state.nutrition.filter(item => item && item.date && foodEnergy(item)!==null);
}
function foodDailySummary(date) {
  const rows = energyEntries().filter(r => r.date===date);
  let sum=0,protein=0,carbs=0,fat=0,pc=0,cc=0,fc=0;
  for (const row of rows) {
    sum += foodEnergy(row);
    const p=foodMacro(row,"protein"),c=foodMacro(row,"carbs"),f=foodMacro(row,"fat");
    if(p!==null){protein+=p;pc++}if(c!==null){carbs+=c;cc++}if(f!==null){fat+=f;fc++}
  }
  return {rows,total:sum,protein:pc?round1(protein):null,carbs:cc?round1(carbs):null,
    fat:fc?round1(fat):null,partialMacros:pc<rows.length||cc<rows.length||fc<rows.length};
}
function nutritionRender() {
  const date=$("foodDate").value||today;
  const daily=foodDailySummary(date);
  $("foodDateLabel").textContent=date+" · 饮食";
  $("foodDayTotals").textContent=daily.rows.length
    ? round1(daily.total)+" kcal（已录入项） · 蛋白质"+(daily.protein===null?"未知":daily.protein+"g")+
      " · 碳水"+(daily.carbs===null?"未知":daily.carbs+"g")+" · 脂肪"+
      (daily.fat===null?"未知":daily.fat+"g")+
      (daily.partialMacros?" · 部分营养素未填写":"")
    : "没有记录；不代表这一天没有摄入热量";
  $("foodRecordCount").textContent=daily.rows.length+"条";
  const list=$("foodList");list.replaceChildren();
  if(!daily.rows.length) {
    const empty=document.createElement("p");empty.className="empty";empty.textContent="尚无该日饮食条目";list.append(empty);
  } else for(const row of daily.rows) {
    const card=document.createElement("div");card.className="food-card";
    const left=document.createElement("div");const food=document.createElement("strong");
    food.textContent=row.food||"未命名食物";const note=document.createElement("small");
    note.textContent=(mealLabels[row.meal]||"饮食")+" · "+
      (validNum(row.grams)?row.grams+"g":"重量未知")+
      (validNum(row.kcal_per_100g)?" · "+row.kcal_per_100g+"kcal/100g":"");
    left.append(food,note);const k=document.createElement("span");k.className="kcal";
    k.textContent=round1(foodEnergy(row))+" kcal";card.append(left,k);list.append(card);
  }
  const chart=$("nutritionBars");chart.replaceChildren();
  const days=Array.from({length:14},(_,i)=>plus(date,-(13-i)));
  const values=days.map(d=>({date:d,info:foodDailySummary(d)}));
  const max=Math.max(1,...values.map(v=>v.info.total));
  const bar=document.createElement("div");bar.className="nutrition-bar";
  for(const v of values) {
    const day=document.createElement("div");day.className="day";
    const pole=document.createElement("div");pole.className="bar";
    pole.style.height=Math.max(2,Math.round((v.info.total/max)*65))+"px";
    pole.title=v.date+" 已记录 "+round1(v.info.total)+" kcal";
    const lbl=document.createElement("small");lbl.textContent=v.date.slice(8);
    day.append(pole,lbl);bar.append(day);
  }
  chart.append(bar);
  const note=document.createElement("p");note.className="sub";
  note.textContent="最近14天已记录热量；未录入的日期显示0高度，不代表实际没吃东西。";
  chart.append(note);
}
function choosePreset() {
  const p=foodPresets[$("foodPreset").value];
  if(!p)return;
  $("foodName").value=p.name;
  $("foodKcal").value=p.kcal===null?"":String(p.kcal);
  for(const [field,key] of [["foodProtein","protein"],["foodCarbs","carbs"],["foodFat","fat"]]) {
    $(field).value=p[key]===undefined?"":String(p[key]);
  }
  updateFoodPreview();
}
function updateFoodPreview() {
  const g=$("foodGrams").value,k=$("foodKcal").value;
  const valid=g!==""&&k!==""&&Number(g)>0&&Number.isFinite(Number(k));
  $("foodPreviewKcal").textContent=valid?round1(Number(g)*Number(k)/100)+" kcal":"— kcal";
  const parts=[];
  for(const [id,label] of [["foodProtein","蛋白质"],["foodCarbs","碳水"],["foodFat","脂肪"]]) {
    if($(id).value!=="")parts.push(label+" "+round1(Number($(id).value)*Number(g||0)/100)+"g");
  }
  $("foodPreviewMacros").textContent=parts.length?parts.join(" · "):"营养素未知可留空；不会按0g记录";
}
$("foodDate").value=today;
$("foodMeal").value="lunch";
$("foodPreset").onchange=choosePreset;
$("foodDate").onchange=nutritionRender;
for(const id of ["foodGrams","foodKcal","foodProtein","foodCarbs","foodFat"]) {
  $(id).addEventListener("input",updateFoodPreview);
}
$("saveNutrition").onclick=()=>{
  const date=$("foodDate").value,food=$("foodName").value.trim();
  const gramsText=$("foodGrams").value,kcalText=$("foodKcal").value;
  if(!date||!food||!gramsText||!kcalText) {
    toast("请填写日期、食物名称、重量以及每100g热量；未知的营养素可以留空",true);return;
  }
  const grams=Number(gramsText),kcal=Number(kcalText);
  if(!Number.isFinite(grams)||grams<=0||grams>5000||
      !Number.isFinite(kcal)||kcal<0||kcal>1200){
    toast("请检查重量和热量数值",true);return;
  }
  const event={date,meal:$("foodMeal").value,food,grams,kcal_per_100g:kcal};
  for(const [id,key] of [["foodProtein","protein_per_100g"],["foodCarbs","carbs_per_100g"],["foodFat","fat_per_100g"]]){
    if($(id).value!==""){
      const val=Number($(id).value);
      if(!Number.isFinite(val)||val<0||val>100){toast("营养素每100g数值须介于0和100",true);return}
      event[key]=val;
    }
  }
  if(!window.BodyTraceNative||typeof BodyTraceNative.saveNutrition!=="function"){
    toast("当前 App 版本没有饮食保存接口，请更新 APK",true);return;
  }
  BodyTraceNative.saveNutrition(JSON.stringify(event));
  $("saveNutrition").disabled=true;
  setTimeout(()=>$("saveNutrition").disabled=false,900);
};

function categoryForRow(row) {
  return exRegion[row.exercise_id]||null;
}
function regionalCounts() {
  const counts=Object.fromEntries(regions.map(r=>[r,0]));
  const end=today,start=plus(end,-27);
  for(const r of state.rows) {
    const key=categoryForRow(r);
    if(key && r.session_date>=start && r.session_date<=end)counts[key]++;
  }
  return counts;
}
function renderRegionSummary(){
  const node=$("regionSummary");node.replaceChildren();
  const counts=regionalCounts(),max=Math.max(1,...Object.values(counts));
  for(const key of regions){
    const row=document.createElement("div");row.className="zone-bar";
    const label=document.createElement("span");label.textContent=key;
    const track=document.createElement("div");track.className="track";
    const fill=document.createElement("div");fill.className="fill";
    fill.style.width=(counts[key]/max*100)+"%";track.append(fill);
    const amount=document.createElement("b");amount.textContent=counts[key]+"组";
    row.append(label,track,amount);node.append(row);
  }
}
const musclePaths={
  front:[
    ["肩","M35 54 L56 50 L56 69 L39 77 L28 70 Z"],
    ["肩","M94 50 L115 54 L122 70 L111 77 L94 69 Z"],
    ["胸","M56 57 L75 60 L75 95 L55 93 L43 79 L56 70 Z"],
    ["胸","M75 60 L94 57 L107 79 L95 93 L75 95 Z"],
    ["手臂","M26 73 L40 78 L33 112 L24 132 L14 126 Z"],
    ["手臂","M110 78 L124 73 L136 126 L126 132 L117 112 Z"],
    ["核心","M55 97 L75 98 L95 97 L90 144 L60 144 Z"],
    ["腿","M58 147 L74 147 L74 207 L63 237 L52 232 L49 180 Z"],
    ["腿","M76 147 L92 147 L102 180 L98 232 L87 237 L76 207 Z"]
  ],
  back:[
    ["肩","M35 54 L56 50 L58 70 L37 77 L28 68 Z"],
    ["肩","M94 50 L115 54 L122 68 L113 77 L92 70 Z"],
    ["背","M56 57 L75 64 L94 57 L109 83 L98 118 L75 135 L52 118 L41 83 Z"],
    ["手臂","M26 73 L40 78 L33 112 L24 132 L14 126 Z"],
    ["手臂","M110 78 L124 73 L136 126 L126 132 L117 112 Z"],
    ["核心","M58 135 L75 139 L92 135 L90 144 L60 144 Z"],
    ["腿","M58 147 L74 147 L74 207 L63 237 L52 232 L49 180 Z"],
    ["腿","M76 147 L92 147 L102 180 L98 232 L87 237 L76 207 Z"]
  ]
};
function strengthShade(n,max){
  if(!n)return "#28413a";
  const alpha=n/max;
  return alpha>.75?"#54edaa":alpha>.4?"#2dab78":"#206a54";
}
function drawMuscleMap(){
  const root=$("bodyMuscleView");root.replaceChildren();
  const counts=regionalCounts(),max=Math.max(1,...Object.values(counts));
  for(const orientation of ["front","back"]){
    const group=document.createElement("div");group.className="muscle-person";
    const title=document.createElement("small");title.textContent=orientation==="front"?"正面":"背面";
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("viewBox","0 0 150 250");svg.setAttribute("role","img");
    svg.setAttribute("aria-label",title.textContent+"训练部位示意");
    const bg=document.createElementNS("http://www.w3.org/2000/svg","path");
    bg.setAttribute("d","M51 40 L43 51 L27 55 L13 91 L7 128 L25 140 L42 95 L48 145 L49 184 L53 238 L72 238 L75 181 L78 238 L97 238 L101 184 L102 145 L108 95 L125 140 L143 128 L137 91 L123 55 L107 51 L99 40 Z");
    bg.setAttribute("fill","#172d29");bg.setAttribute("stroke","#3c6454");
    svg.append(bg);
    const head=document.createElementNS("http://www.w3.org/2000/svg","ellipse");
    head.setAttribute("cx","75");head.setAttribute("cy","23");head.setAttribute("rx","18");head.setAttribute("ry","22");
    head.setAttribute("fill","#2a493e");head.setAttribute("stroke","#7fa994");svg.append(head);
    for(const [label,d] of musclePaths[orientation]){
      const path=document.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("d",d);
      path.setAttribute("fill",strengthShade(counts[label],max));
      path.setAttribute("class","muscle-path"+(selectedRegion===label?" selected":""));
      path.setAttribute("tabindex","0");
      path.setAttribute("role","button");
      path.setAttribute("aria-label",label+"：最近28天"+counts[label]+"组");
      const labelEl=document.createElementNS("http://www.w3.org/2000/svg","title");
      labelEl.textContent=label+" · 最近28天 "+counts[label]+"组";path.append(labelEl);
      path.addEventListener("click",()=>{selectedRegion=label;drawMuscleMap()});
      path.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();selectedRegion=label;drawMuscleMap()}});
      svg.append(path);
    }
    group.append(svg,title);root.append(group);
  }
  const key=selectedRegion,n=counts[key];
  const exercises=[...new Set(state.rows.filter(r=>categoryForRow(r)===key).map(r=>r.exercise))];
  $("muscleDetail").textContent=key+" · 最近28天 "+n+" 组。相关动作："+(exercises.join("、")||"暂无记录")+
    "。颜色仅表示记录量，不反映肌肉厚度或脂肪分布。";
}
function latestMetric(key) {
  const r=state.measurements.filter(m=>m.reported_date && validNum(m[key]))
    .sort((a,b)=>a.reported_date.localeCompare(b.reported_date)).at(-1);
  return r?Number(r[key]):null;
}
function renderProfile(){
  const list=$("profileStats");list.replaceChildren();
  const weight=latestMetric("weight_kg"),waist=latestMetric("waist_cm"),
    chest=latestMetric("chest_cm");
  const entries=[
    ["身高",FIXED_HEIGHT_CM+"cm"],
    ["体重",weight===null?"—":weight+"kg"],
    ["BMI参考",weight===null?"—":round1(weight/(FIXED_HEIGHT_CM/100)**2)],
    ["腰围",waist===null?"—":waist+"cm"],
    ["胸围",chest===null?"—":chest+"cm"],
    ["腰高比",waist===null?"—":(waist/FIXED_HEIGHT_CM).toFixed(3)]
  ];
  for(const [label,val] of entries){
    const card=document.createElement("div");card.className="profile-stat";
    const strong=document.createElement("strong");strong.textContent=val;
    const small=document.createElement("small");small.textContent=label;
    card.append(strong,small);list.append(card);
  }
}
function renderStrength(){
  const select=$("analyticsExercise"),rows=state.rows;
  const available=[...new Set(rows.map(r=>r.exercise_id).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const previous=select.value;
  select.replaceChildren();
  if(!available.length){
    const item=document.createElement("option");item.value="";item.textContent="暂无训练记录";select.append(item);
    $("strengthChart").textContent="同步或录入训练后显示力量曲线";return;
  }
  for(const id of available){
    const opt=document.createElement("option");opt.value=id;
    opt.textContent=exerciseLabels[id]||id;select.append(opt);
  }
  select.value=available.includes(previous)?previous:available[0];
  renderStrengthPlot();
}
function renderStrengthPlot() {
  const ex=$("analyticsExercise").value;
  const list=state.rows.map((row,i)=>({...row,sequence:i}))
    .filter(r=>r.exercise_id===ex&&validNum(r.reps)&&safeNum(r.reps)>0&&
       validNum(ex==="assisted_pullup"||ex==="assisted_dip"?r.assistance_kg:r.load_kg))
    .sort((a,b)=>a.session_date.localeCompare(b.session_date)||a.sequence-b.sequence);
  const chart=$("strengthChart");chart.replaceChildren();
  const isAssist=ex==="assisted_pullup"||ex==="assisted_dip";
  $("analyticsSets").textContent=list.length+"组";
  if(!list.length){chart.textContent="该动作缺少可比较的数值记录";$("analyticsRange").textContent="—";return}
  const values=list.map(r=>{
    const load=Number(isAssist?r.assistance_kg:r.load_kg);
    const reps=Number(r.reps);
    return {...r,load,estimated:!isAssist&&reps<=15?load*(1+reps/30):null};
  });
  const tracked=values.map(v=>isAssist?v.load:(v.estimated??v.load));
  const maximum=Math.max(...tracked),minimum=Math.min(...tracked),spread=Math.max(1,maximum-minimum,maximum*.05);
  const lo=Math.max(0,minimum-spread*.25),hi=maximum+spread*.25;
  $("analyticsRange").textContent=round1(minimum)+"–"+round1(maximum)+(isAssist?"kg辅助":"kg参考");
  const NS="http://www.w3.org/2000/svg";
  const el=(tag,attrs={})=>{const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n};
  const svg=el("svg",{viewBox:"0 0 400 245",role:"img","aria-label":ex+"训练趋势图"});
  const days=[...new Set(values.map(v=>v.session_date))].sort();
  const xVal=day=>days.length===1?200:32+days.indexOf(day)/(days.length-1)*338;
  const yVal=num=>210-(num-lo)/(hi-lo)*178;
  for(let i=0;i<5;i++){
    const y=30+i*45;svg.append(el("line",{x1:31,y1:y,x2:378,y2:y,stroke:"#365249","stroke-width":.8}));
  }
  const labels=[days[0],days[days.length-1]];
  for(let i=0;i<labels.length;i++){
    const t=el("text",{x:i?375:32,y:234,"text-anchor":i?"end":"start",fill:"#9eafa7","font-size":10});
    t.textContent=labels[i].slice(5);svg.append(t);
  }
  const byDate=new Map();
  for(const v of values){
    const val=isAssist?v.load:(v.estimated??v.load);
    const point=el("circle",{cx:xVal(v.session_date),cy:yVal(val),r:4.5,
      fill:"#70edb3",stroke:"#0a2419","stroke-width":1});
    const title=el("title");title.textContent=v.session_date+" "+v.load+"kg × "+v.reps+
       (isAssist?"次（辅助量）":"次（e1RM仅为简化参考）");
    point.append(title);svg.append(point);
    const old=byDate.get(v.session_date);
    if(old===undefined||(isAssist?val<old:val>old))byDate.set(v.session_date,val);
  }
  if(days.length>1){
    const poly=el("polyline",{points:days.map(d=>xVal(d)+","+yVal(byDate.get(d))).join(" "),
      fill:"none",stroke:"#3cb4db","stroke-width":2,"stroke-linejoin":"round"});
    svg.insertBefore(poly,svg.firstChild);
  }
  chart.append(svg);
  $("strengthDisclaimer").textContent=isAssist
    ?"纵轴为器械标称辅助量，数值越低通常更难。不同档位下次数不同，不能仅凭辅助量判断力量进步。"
    :"绿色点是各训练组的简化 Epley e1RM 参考（只对不超过15次使用），蓝线是每天最高参考值；器械标称负重不等于实际肌肉力。";
}
$("analyticsExercise").onchange=renderStrengthPlot;


// The character image is a consistent illustration; it never morphs into a
// supposedly exact 3D reconstruction. Measurements come from daily JSON.
let avatarView = "front";
let avatar3d = null;
let avatarMode = "3d";
let selectedAvatarDate = "";
let selectedAvatarMetric = "chest_cm";
const avatarMetrics = [
  {key:"chest_cm",label:"胸围",unit:"cm",column:"left"},
  {key:"waist_cm",label:"腰围",unit:"cm",column:"left"},
  {key:"thigh_cm",label:"大腿围",unit:"cm",column:"left"},
  {key:"shoulder_cm",label:"肩围",unit:"cm",column:"right"},
  {key:"upper_arm_cm",label:"手臂围",unit:"cm",column:"right"},
  {key:"hip_cm",label:"臀围",unit:"cm",column:"right"},
  {key:"calf_cm",label:"小腿围",unit:"cm",column:"right"}
];
function measuredDates(){
 return [...new Set(state.measurements.map(x=>x.reported_date).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)))]
  .sort((a,b)=>b.localeCompare(a));
}
function metricAt(key,date){
 return state.measurements.filter(m=>m.reported_date<=date&&validNum(m[key]))
   .sort((a,b)=>b.reported_date.localeCompare(a.reported_date))
   .map(m=>({date:m.reported_date,value:Number(m[key])}))[0]||null;
}
function metricPrevious(key, date){
 return state.measurements.filter(m=>m.reported_date<date&&validNum(m[key]))
   .sort((a,b)=>b.reported_date.localeCompare(a.reported_date))
   .map(m=>({date:m.reported_date,value:Number(m[key])}))[0]||null;
}
function metricText(value){
 if(value===null)return "—";
 return (Math.round(value*10)/10).toFixed(1);
}
function avatarSetView(next){
 avatarView=next==="back"?"back":"front";
 $("avatarFrame").classList.toggle("view-back",avatarView==="back");
 if(avatarMode==="3d"&&avatar3d)avatar3d.setView(avatarView);
 for(const [id,view] of [["avatarFront","front"],["avatarBack","back"]]){
  const button=$(id);
  button.classList.toggle("active",avatarView===view);
  button.setAttribute("aria-pressed",String(avatarView===view));
 }
}
function avatarShowDetail(){
 const def=avatarMetrics.find(x=>x.key===selectedAvatarMetric);
 const label=def?def.label:"体重",unit=def?def.unit:"kg";
 const current=metricAt(selectedAvatarMetric,selectedAvatarDate);
 const previous=current?metricPrevious(selectedAvatarMetric,current.date):null;
 let message=label+": ";
 if(!current)message+="此日期之前无有效数据";
 else {
  message+=metricText(current.value)+unit+"（"+current.date+"）";
  if(previous){
   const diff=Math.round((current.value-previous.value)*10)/10;
   message+="，相比 "+previous.date+" "+(diff>0?"增加":diff<0?"减少":"不变")+
     (diff===0?"":Math.abs(diff).toFixed(1)+unit);
  }
 }
 $("avatarSelectedDetail").textContent=message+"。人物外形并未由围度精确重建。";
}
function renderAvatar(){
 const dates=measuredDates();
 const dateSelect=$("avatarMeasureDate");
 const oldSelected=selectedAvatarDate;
 dateSelect.replaceChildren();
 if(!dates.length){
  const option=document.createElement("option");option.value="";option.textContent="暂无身体测量";
  dateSelect.append(option);
  selectedAvatarDate="";
 }else{
  for(const day of dates){
   const option=document.createElement("option");
   option.value=day;option.textContent=day;
   dateSelect.append(option);
  }
  selectedAvatarDate=dates.includes(oldSelected)?oldSelected:dates[0];
  dateSelect.value=selectedAvatarDate;
 }
 for(const side of ["left","right"]){
  const root=$("avatarStat"+(side==="left"?"Left":"Right"));
  root.replaceChildren();
  for(const def of avatarMetrics.filter(x=>x.column===side)){
   const now=selectedAvatarDate?metricAt(def.key,selectedAvatarDate):null;
   const previous=now?metricPrevious(def.key,now.date):null;
   const button=document.createElement("button");button.type="button";button.className="avatar-metric";
   button.classList.toggle("selected",selectedAvatarMetric===def.key);
   const label=document.createElement("small");label.textContent=def.label;
   const value=document.createElement("strong");
   value.textContent=now?metricText(now.value)+def.unit:"—";
   const delta=document.createElement("span");delta.className="delta";
   if(!now)delta.textContent="未测量";
   else if(!previous)delta.textContent=now.date===selectedAvatarDate?"首次记录":"截至 "+now.date;
   else {
    const difference=Math.round((now.value-previous.value)*10)/10;
    delta.classList.add(difference>0?"up":difference<0?"down":"same");
    delta.textContent=difference>0?"↑ "+difference.toFixed(1):
      difference<0?"↓ "+Math.abs(difference).toFixed(1):"→ 0.0";
    if(now.date!==selectedAvatarDate)delta.textContent+=" · "+now.date.slice(5);
   }
   button.append(label,value,delta);
   button.onclick=()=>{selectedAvatarMetric=def.key;renderAvatar()};
   root.append(button);
  }
 }
 const weight=selectedAvatarDate?metricAt("weight_kg",selectedAvatarDate):null;
 const wprevious=weight?metricPrevious("weight_kg",weight.date):null;
 const w=$("avatarWeightSummary");w.replaceChildren();
 const name=document.createElement("span");name.textContent="体重";
 const value=document.createElement("strong");
 value.textContent=weight?metricText(weight.value)+"kg":"—";
 const change=document.createElement("span");
 if(weight&&wprevious){
  const difference=weight.value-wprevious.value;
  change.textContent=(difference>0?" ↑ ":difference<0?" ↓ ":" → ")+
    Math.abs(difference).toFixed(1)+"kg";
 }
 w.append(name,value,change);
 avatarShowDetail();
 if(avatar3d) {
  const shape={height_cm:FIXED_HEIGHT_CM};
  const keys=["weight_kg","shoulder_cm","chest_cm","waist_cm","hip_cm",
   "upper_arm_cm","thigh_cm","calf_cm"];
  for(const k of keys){
   const item=selectedAvatarDate?metricAt(k,selectedAvatarDate):null;
   if(item)shape[k]=item.value;
  }
  avatar3d.setMeasurements(shape);
 }
}
function avatarDisplayMode(target){
 avatarMode=target==="2d"?"2d":"3d";
 if(avatarMode==="3d"&&!avatar3d)avatarMode="2d";
 const real=avatarMode==="3d",frame=$("avatarFrame");
 frame.classList.toggle("real-3d",real);
 frame.parentElement.parentElement.classList.toggle("has-webgl",real);
 $("avatar3dCanvas").hidden=!real;
 $("avatarPicture").hidden=real;
 $("avatarHotspot").hidden=real;
 $("avatar3dMode").classList.toggle("active",real);
 $("avatar2dMode").classList.toggle("active",!real);
 $("avatar3dMode").setAttribute("aria-pressed",String(real));
 $("avatar2dMode").setAttribute("aria-pressed",String(!real));
 $("avatarModeLabel").textContent=real?
  "真实 WebGL 三维网格 · 手指拖动可360°旋转 · 模型按测量围度近似变化":
  "二维原画：只有正背两帧，可导入高清 PNG；不是三维模型";
 if(real){avatar3d.draw();avatar3d.setView(avatarView)}
}
try {
 avatar3d=window.BodyTrace3D.mount($("avatar3dCanvas"));
} catch(error){
 avatar3d=null;
 $("avatarModeLabel").textContent="当前设备不支持 WebGL，显示二维原画";
}
avatarDisplayMode(avatar3d?"3d":"2d");
$("avatar3dMode").onclick=()=>avatarDisplayMode("3d");
$("avatar2dMode").onclick=()=>avatarDisplayMode("2d");
$("avatarImport").onclick=()=>{
 if(!window.BodyTraceNative||typeof BodyTraceNative.pickAvatar!=="function"){
  toast("请在 Android App 中导入本地高清图",true);return;
 }
 BodyTraceNative.pickAvatar();
};
$("avatarMeasureDate").addEventListener("change",e=>{
 selectedAvatarDate=e.target.value;
 renderAvatar();
});
$("avatarFront").onclick=()=>avatarSetView("front");
$("avatarBack").onclick=()=>avatarSetView("back");
// Tap different vertical regions to inspect the closest relevant measurement.
// This is a hotspot on a picture, not true 3D ray tracing.
$("avatarHotspot").onclick=e=>{
 const rect=e.currentTarget.getBoundingClientRect();
 const relativeY=(e.clientY-rect.top)/rect.height;
 selectedAvatarMetric=relativeY<.32?"chest_cm":relativeY<.65?"waist_cm":"hip_cm";
 renderAvatar();
};
let swipeStartX=null;
$("avatarFrame").addEventListener("touchstart",e=>{
 if(e.touches.length===1)swipeStartX=e.touches[0].clientX;
},{passive:true});
$("avatarFrame").addEventListener("touchend",e=>{
 if(swipeStartX===null||!e.changedTouches.length)return;
 const dx=e.changedTouches[0].clientX-swipeStartX;swipeStartX=null;
 if(Math.abs(dx)>35)avatarSetView(dx<0?"back":"front");
},{passive:true});
function renderAllFeatures(){
 nutritionRender();renderStrength();renderRegionSummary();drawMuscleMap();renderProfile();renderAvatar();
}
const originalReceive = window.bodyTraceReceive;
window.bodyTraceReceive=function(evt){
  if(typeof originalReceive==="function") originalReceive(evt);
  if(evt.type==="avatar_imported"){
    $("avatarPicture").src="data:"+evt.mime+";base64,"+evt.base64;
    avatarDisplayMode("2d");
    toast("高清二维原画已保存在本机资源库，APK 覆盖升级后仍保留");
  }
  if(evt.type==="nutrition_local_saved"){
    const parsed=evt.view_model?.view_schema_version===1 ? fromViewModel(evt.view_model) : null;
    if(parsed){
      state.rows=parsed.rows;state.measurements=parsed.measurements;state.nutrition=parsed.nutrition;
      indexData();renderBody();
    }
    state.pending=evt.count||state.pending;renderStatus();
    $("foodName").value="";$("foodPreset").value="";$("foodKcal").value="";
    $("foodProtein").value="";$("foodCarbs").value="";$("foodFat").value="";
    updateFoodPreview();navigate("nutrition");
    toast("饮食已经存入本机 JSON；已连接时将尝试上传 GitHub");
  }
  if(evt.type==="saved"&&evt.category==="nutrition"){
    toast("饮食记录已同步 GitHub");
  }
  if(evt.type==="data"||evt.type==="local_saved"||evt.type==="nutrition_local_saved"){
    renderAllFeatures();
  }
};
renderAllFeatures();
updateFoodPreview();
})();

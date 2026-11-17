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
// Recent means latest workout date per exercise; within the same day, use
// source created_at if available, then stable input insertion order.
function orderedExerciseGroups(rows){
 const byId=new Map();
 rows.forEach((row,index)=>{
  const id=row.exercise_id;
  if(!id)return;
  if(!byId.has(id)){
   byId.set(id,{id,records:[],latestDate:"",latestCreated:"",lastIndex:-1});
  }
  const group=byId.get(id);
  group.records.push({row,index});
  const date=/^\d{4}-\d{2}-\d{2}$/.test(row.session_date||"")?row.session_date:"";
  const created=String(row.created_at||"");
  if(date>group.latestDate||
    date===group.latestDate&&(created>group.latestCreated||
     created===group.latestCreated&&index>group.lastIndex)){
   group.latestDate=date;group.latestCreated=created;group.lastIndex=index;
  }
 });
 return [...byId.values()].sort((a,b)=>
  b.latestDate.localeCompare(a.latestDate)||
  b.latestCreated.localeCompare(a.latestCreated)||
  b.lastIndex-a.lastIndex||a.id.localeCompare(b.id));
}
function renderStrength(){
 const root=$("strengthList");root.replaceChildren();
 const groups=orderedExerciseGroups(state.rows);
 if(!groups.length){
  const empty=document.createElement("p");
  empty.className="note";
  empty.textContent="还没有训练动作。录入或同步 GitHub 后，这里自动显示全部动作的趋势。";
  root.append(empty);return;
 }
 for(const group of groups){
  const region=exRegion[group.id]||"其他";
  const card=document.createElement("article");card.className="strength-exercise-card";
  card.dataset.exerciseId=group.id;
  const heading=document.createElement("div");heading.className="strength-exercise-heading";
  const header=document.createElement("div");header.className="strength-exercise-info";
  const title=document.createElement("h3");
  title.textContent="【"+region+"】"+(exerciseLabels[group.id]||group.records.at(-1)?.row.exercise||group.id);
  const date=document.createElement("small");
  date.textContent="最近训练 "+(group.latestDate||"未知日期");
  header.append(title,date);
  const count=document.createElement("span");count.className="tag";
  count.textContent=group.records.length+"组";
  heading.append(header,count);
  const range=document.createElement("div");range.className="strength-exercise-range";
  const chart=document.createElement("div");chart.className="feature-chart";
  const disclaimer=document.createElement("p");disclaimer.className="note strength-exercise-note";
  card.append(heading,range,chart,disclaimer);
  root.append(card);
  renderStrengthPlot(group,chart,range,disclaimer);
 }
}
function renderStrengthPlot(group,chart,range,disclaimer){
 const ex=group.id;
 const list=group.records.map(({row,index})=>({...row,sequence:index}))
   .filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.session_date||"")&&
      validNum(r.reps)&&safeNum(r.reps)>0&&
      validNum(ex==="assisted_pullup"||ex==="assisted_dip"?r.assistance_kg:r.load_kg))
   .sort((a,b)=>a.session_date.localeCompare(b.session_date)||a.sequence-b.sequence);
 const isAssist=ex==="assisted_pullup"||ex==="assisted_dip";
 chart.replaceChildren();
 if(!list.length){
  range.textContent="可比较数据 0 组";
  chart.textContent="该动作暂缺重量和次数记录";
  disclaimer.textContent="记录保存不受影响；缺失值不会被自动填补。";
  return;
 }
 const values=list.map(r=>{
  const load=Number(isAssist?r.assistance_kg:r.load_kg);
  const reps=Number(r.reps);
  return {...r,load,estimated:!isAssist&&reps<=15?load*(1+reps/30):null};
 });
 const tracked=values.map(v=>isAssist?v.load:(v.estimated??v.load));
 const maximum=Math.max(...tracked),minimum=Math.min(...tracked);
 const spread=Math.max(1,maximum-minimum,maximum*.05);
 const lo=Math.max(0,minimum-spread*.25),hi=maximum+spread*.25;
 range.textContent=round1(minimum)+"–"+round1(maximum)+
   (isAssist?" kg 辅助量":" kg 参考值")+" · "+list.length+" 组有效记录";
 const NS="http://www.w3.org/2000/svg";
 const el=(tag,attrs={})=>{
  const item=document.createElementNS(NS,tag);
  for(const [key,val] of Object.entries(attrs))item.setAttribute(key,String(val));
  return item;
 };
 const svg=el("svg",{viewBox:"0 0 400 225",role:"img",
   "aria-label":(exerciseLabels[ex]||ex)+"训练重量趋势"});
 const days=[...new Set(values.map(v=>v.session_date))].sort();
 const xVal=day=>days.length===1?200:32+days.indexOf(day)/(days.length-1)*338;
 const yVal=num=>199-(num-lo)/(hi-lo)*160;
 for(let i=0;i<5;i++){
  const y=28+i*42;
  svg.append(el("line",{x1:31,y1:y,x2:378,y2:y,stroke:"#365249","stroke-width":.8}));
 }
 const labels=[days[0],days[days.length-1]];
 for(let i=0;i<labels.length;i++){
  const t=el("text",{x:i?375:32,y:217,"text-anchor":i?"end":"start",
    fill:"#9eafa7","font-size":10});
  t.textContent=labels[i].slice(5);svg.append(t);
 }
 const byDate=new Map();
 for(const v of values){
  const numeric=isAssist?v.load:(v.estimated??v.load);
  const point=el("circle",{cx:xVal(v.session_date),cy:yVal(numeric),r:4.5,
    fill:"#70edb3",stroke:"#0a2419","stroke-width":1});
  const tooltip=el("title");
  tooltip.textContent=v.session_date+" "+v.load+"kg × "+v.reps+
    (isAssist?"次（标称辅助量）":"次（e1RM仅为公式参考）");
  point.append(tooltip);svg.append(point);
  const old=byDate.get(v.session_date);
  if(old===undefined||(isAssist?numeric<old:numeric>old))byDate.set(v.session_date,numeric);
 }
 if(days.length>1){
  const poly=el("polyline",{
    points:days.map(d=>xVal(d)+","+yVal(byDate.get(d))).join(" "),
    fill:"none",stroke:"#3cb4db","stroke-width":2,"stroke-linejoin":"round"
  });
  svg.insertBefore(poly,svg.firstChild);
 }
 chart.append(svg);
 disclaimer.textContent=isAssist
  ?"绿色点为器械标称辅助量（越低通常越难）；蓝线为当天最低辅助量，不直接代表力量增幅。"
  :"绿色点为各组负重/简化 Epley e1RM 参考值（仅不超过15次的组计算 e1RM）；蓝线为当天最高参考值，器械重量不等于实际肌肉力。";
}

// The character image is a consistent illustration; it never morphs into a
// supposedly exact 3D reconstruction. Measurements come from daily JSON.
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
function mostRecentMetric(key,cutoff,strictBefore){
 const matched=state.measurements.map((m,index)=>({m,index})).filter(({m})=>
   m.reported_date&&validNum(m[key])&&
   (strictBefore?m.reported_date<cutoff:m.reported_date<=cutoff));
 matched.sort((a,b)=>a.m.reported_date.localeCompare(b.m.reported_date)||
   String(a.m.created_at||"").localeCompare(String(b.m.created_at||""))||a.index-b.index);
 const result=matched.at(-1);
 return result?{date:result.m.reported_date,value:Number(result.m[key])}:null;
}
function metricAt(key,date){return mostRecentMetric(key,date,false)}
function metricPrevious(key,date){return mostRecentMetric(key,date,true)}
function metricText(value){
 if(value===null)return "—";
 return (Math.round(value*10)/10).toFixed(1);
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
 // Derived picture contour only; measurement JSON remains canonical.
 if(window.BodyTraceMorph){
  const fields={};
  for(const def of avatarMetrics){
   const metric=selectedAvatarDate?metricAt(def.key,selectedAvatarDate):null;
   if(metric)fields[def.key]=metric.value;
  }
  BodyTraceMorph.set(selectedAvatarDate,fields);
 }
 
}

// Only measurements explicitly confirmed on the ruler are appended to JSON.
// Values shown from earlier dates are recommendations, NOT new observations.
const bodyEntryFields=[
 {key:"weight_kg",label:"体重",unit:"kg",min:20,max:300,step:0.1},
 {key:"shoulder_cm",label:"肩围",unit:"cm",min:30,max:200,step:0.1},
 {key:"chest_cm",label:"胸围",unit:"cm",min:30,max:200,step:0.1},
 {key:"waist_cm",label:"腰围",unit:"cm",min:30,max:200,step:0.1},
 {key:"upper_arm_cm",label:"手臂围",unit:"cm",min:10,max:90,step:0.1},
 {key:"hip_cm",label:"臀围",unit:"cm",min:30,max:200,step:0.1},
 {key:"thigh_cm",label:"大腿围",unit:"cm",min:20,max:120,step:0.1},
 {key:"calf_cm",label:"小腿围",unit:"cm",min:10,max:100,step:0.1}
];
let bodyEdited=new Map();
$("bodyEntryDate").value=today;
function bodyEntryDisplay(def,value){
 if(value===null||value===undefined)return "—";
 if(def.key==="weight_kg"&&$("bodyWeightUnit").value==="jin")
  return (value*2).toFixed(1)+" 斤";
 return Number(value).toFixed(1)+" "+def.unit;
}
function renderBodyEntry(){
 const grid=$("bodyEntryGrid");grid.replaceChildren();
 const date=$("bodyEntryDate").value||today;
 for(const def of bodyEntryFields){
  const reported=metricAt(def.key,date);
  const edited=bodyEdited.has(def.key),value=edited?bodyEdited.get(def.key):reported?.value;
  const button=document.createElement("button");
  button.type="button";button.className="body-entry-metric";
  button.classList.toggle("changed",edited);
  const label=document.createElement("small");label.textContent=def.label;
  const current=document.createElement("strong");current.textContent=bodyEntryDisplay(def,value);
  const state=document.createElement("span");
  state.textContent=edited?"✓ 本次录入 · 待保存":
    reported?"上次记录 "+reported.date+" · 仅参考":"尚无历史数据 · 点此记录";
  button.append(label,current,state);
  button.onclick=()=>{
   if(!window.BodyTraceWheel){toast("滚轮尚未初始化",true);return}
   const jin=def.key==="weight_kg"&&$("bodyWeightUnit").value==="jin";
   const start=Number.isFinite(Number(value))&&value!==null&&value!==undefined?
    Number(value):(def.key==="weight_kg"?70:def.key==="waist_cm"?85:90);
   const startValue=jin?start*2:start;
   BodyTraceWheel.open({
    title:"记录"+def.label,min:jin?40:def.min,max:jin?600:def.max,
    step:jin?0.2:def.step,unit:jin?"斤":def.unit,value:startValue,
    onConfirm:chosen=>{
     const canonical=jin?Math.round(chosen*5)/10:Math.round(chosen*10)/10;
     bodyEdited.set(def.key,canonical);
     renderBodyEntry();
    }
   });
  };
  grid.append(button);
 }
 const count=bodyEdited.size;
 $("bodyChangedCount").textContent=count?count+" 项待保存":"尚未选择本次测量项目";
}
$("bodyEntryDate").addEventListener("change",()=>{
 bodyEdited.clear();renderBodyEntry();
});
$("bodyWeightUnit").addEventListener("change",renderBodyEntry);
$("bodyClearChanges").onclick=()=>{bodyEdited.clear();renderBodyEntry()};
$("bodySaveMeasurement").onclick=()=>{
 const date=$("bodyEntryDate").value;
 if(!date){toast("请选择测量日期",true);return}
 if(!bodyEdited.size){toast("先点选至少一项本次实际测量的数据",true);return}
 if(!window.BodyTraceNative||typeof BodyTraceNative.saveMeasurement!=="function"){
  toast("请升级 App 才能保存身体测量数据",true);return;
 }
 const input={date};
 for(const [key,value] of bodyEdited)input[key]=value;
 BodyTraceNative.saveMeasurement(JSON.stringify(input));
 $("bodySaveMeasurement").disabled=true;
 setTimeout(()=>$("bodySaveMeasurement").disabled=false,1500);
};
$("avatarImport").onclick=()=>{
 if(!window.BodyTraceNative||typeof BodyTraceNative.pickAvatar!=="function"){
  toast("当前 Android 版本不支持图片导入",true);return;
 }
 BodyTraceNative.pickAvatar();
};
$("avatarMeasureDate").addEventListener("change",e=>{
 selectedAvatarDate=e.target.value;
 renderAvatar();
});
// Tap different vertical regions to inspect the closest relevant measurement.
// This is a hotspot on a picture, not true 3D ray tracing.
$("avatarHotspot").onclick=e=>{
 const rect=e.currentTarget.getBoundingClientRect();
 const relativeY=(e.clientY-rect.top)/rect.height;
 selectedAvatarMetric=relativeY<.32?"chest_cm":relativeY<.65?"waist_cm":"hip_cm";
 renderAvatar();
};
function renderAllFeatures(){
 nutritionRender();renderStrength();renderRegionSummary();drawMuscleMap();renderProfile();renderAvatar();renderBodyEntry();
}
const originalReceive = window.bodyTraceReceive;
window.bodyTraceReceive=function(evt){
  if(typeof originalReceive==="function") originalReceive(evt);
  if(evt.type==="avatar_imported"){
    $("avatarPicture").src="data:"+evt.mime+";base64,"+evt.base64;
    $("avatarModeLabel").textContent="你的高清卡通人物图 · 本机已保存 · 正常升级后仍保留";
    navigate("body");
    toast("高清人物图导入成功；已保存在本机，升级 APK 不会丢失");
  }
  if(evt.type==="measurement_local_saved"){
    const parsed=evt.view_model?.view_schema_version===1?fromViewModel(evt.view_model):null;
    if(parsed){
      state.rows=parsed.rows;state.measurements=parsed.measurements;
      state.nutrition=parsed.nutrition;
      indexData();renderBody();
    }
    state.pending=evt.count||state.pending;renderStatus();
    bodyEdited.clear();
    selectedAvatarDate=evt.event?.date||selectedAvatarDate;
    renderAllFeatures();
    navigate("body");
    toast("身体测量已保存本机；已连接时正在上传 GitHub");
  }
  if(evt.type==="saved"&&evt.category==="measurements"){
    toast("身体测量已同步 GitHub");
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

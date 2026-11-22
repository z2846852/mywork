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
const regions = ["胸","肩","背","腿","其他"];
const regionCodes = {胸:"chest",肩:"shoulders",背:"back",腿:"legs",手臂:"arms",核心:"core"};
const exRegion = {
  chest_press:"胸",smith_bench:"胸",pec_deck:"胸",incline_chest_press:"胸",
  horizontal_bench:"胸",assisted_dip:"胸",
  lateral_raise:"肩",reverse_fly:"肩",shoulder_press:"肩",
  row:"背",assisted_pullup:"背",vertical_traction:"背",
  leg_press:"腿",adductor:"腿",abductor:"腿",leg_extension:"腿",
  prone_leg_curl:"腿",hip_thrust:"腿"
};
let selectedRegion = "髋内收肌群";
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
// Subjective four-flag DAILY CHECK-IN. One immutable snapshot per save,
// latest created_at wins for that date, including after offline/GitHub merge.
// Deliberately separate from measured food calories/macros and meal entries.
const intakeKeys=["intake_creatine","intake_protein_powder","intake_carbs","intake_sugar_oil"];
const intakeLabels=["肌酸","蛋白粉","碳水","劣质糖油"];
const intakeInputs=["intakeCreatine","intakeProtein","intakeCarbs","intakeSugarOil"];
let intakeDraftDirty=false,intakeLoadedDate="";
function isIntakeCheckin(row){
 return row && row.entry_kind==="daily_checkin" &&
  /^\d{4}-\d{2}-\d{2}$/.test(row.date||"");
}
function latestIntakeByDate(rows){
 const found=new Map();
 for(const [index,row] of rows.entries()){
  if(!isIntakeCheckin(row))continue;
  const created=String(row.created_at||"");
  const previous=found.get(row.date);
  if(!previous || created>previous.created ||
    (created===previous.created&&index>previous.index)){
   found.set(row.date,{row,created,index});
  }
 }
 return new Map([...found.entries()].map(([date,rec])=>[date,rec.row]));
}
function renderIntakeCalendar(byDate){
 const root=$("intakeCalendar"),months=$("intakeMonths");
 root.replaceChildren();months.replaceChildren();
 const selected=$("intakeDate").value||today;
 const dateEnd=selected>today?selected:today;
 const monday=plus(dateEnd,-((parse(dateEnd).getUTCDay()+6)%7));
 const start=plus(monday,-51*7);
 let lastMonth="";
 for(let week=0;week<52;week++){
  const first=plus(start,week*7),month=first.slice(0,7);
  if(month!==lastMonth){
   const title=document.createElement("span");title.className="intake-month";
   title.style.left=(week*23)+"px";title.textContent=Number(first.slice(5,7))+"月";
   months.append(title);lastMonth=month;
  }
  for(let dayOffset=0;dayOffset<7;dayOffset++){
   const date=plus(first,dayOffset),row=byDate.get(date);
   const button=document.createElement("button");button.type="button";
   button.className="intake-cell"+(date===selected?" selected":"")+
    (date>today?" future":"");
   if(row)button.dataset.saved="true";
   const checked=intakeKeys.map(k=>row?.[k]===true);
   button.title=date+" · "+(row?
    (checked.some(Boolean)?intakeLabels.filter((_,i)=>checked[i]).join("、"):"已保存：未勾选任何项"):
    "尚未记录");
   button.setAttribute("aria-label",button.title);
   for(let k=0;k<4;k++){
    const square=document.createElement("span");
    square.className="intake-quadrant"+(checked[k]?" active":"");
    square.dataset.kind=intakeKeys[k];square.setAttribute("aria-hidden","true");
    button.append(square);
   }
   button.onclick=()=>{
    $("intakeDate").value=date;
    renderIntakeCheckin(true);
   };
   root.append(button);
  }
 }
}
function renderIntakeCheckin(force=false){
 const date=$("intakeDate").value||today;
 const byDate=latestIntakeByDate(state.nutrition);
 if(intakeDraftDirty&&!force&&intakeLoadedDate===date){
  renderIntakeCalendar(byDate);return;
 }
 intakeDraftDirty=false;intakeLoadedDate=date;
 const saved=byDate.get(date);
 for(let i=0;i<4;i++)$(intakeInputs[i]).checked=saved?.[intakeKeys[i]]===true;
 $("intakeCheckStatus").textContent=saved?
  "已保存："+(intakeKeys.map((k,i)=>saved[k]===true?intakeLabels[i]:null)
   .filter(Boolean).join("、")||"未勾选任何项"):
  "该日期尚无体感摄入记录";
 renderIntakeCalendar(byDate);
}
$("intakeDate").value=today;
$("intakeDate").addEventListener("change",()=>renderIntakeCheckin(true));
$("intakeToday").onclick=()=>{
 $("intakeDate").value=today;renderIntakeCheckin(true);
 $("intakeCalendarScroll").scrollLeft=$("intakeCalendarScroll").scrollWidth;
};
for(const id of intakeInputs){
 $(id).addEventListener("change",()=>{
  intakeDraftDirty=true;
  $("intakeCheckStatus").textContent="勾选已变更，点击保存后写入当天 JSON";
 });
}
// The calendar spans 52 weeks; show the recent weeks on first tab opening.
document.querySelector('.tabs button[data-page="body"]')?.addEventListener("click",()=>{
 requestAnimationFrame(()=>{
  const scroll=$("intakeCalendarScroll");
  if(scroll&&!scroll.dataset.opened){
   scroll.scrollLeft=Math.max(0,scroll.scrollWidth-scroll.clientWidth);
   scroll.dataset.opened="true";
  }
 });
});
$("saveIntakeCheck").onclick=()=>{
 const date=$("intakeDate").value;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||"")||date>plus(today,1)){
  toast("请选择有效的摄入日期（北京时间）",true);return;
 }
 if(!window.BodyTraceNative||typeof BodyTraceNative.saveNutrition!=="function"){
  toast("请安装支持饮食保存的 App 版本",true);return;
 }
 const event={date,entry_kind:"daily_checkin"};
 for(let i=0;i<4;i++)event[intakeKeys[i]]=$(intakeInputs[i]).checked;
 BodyTraceNative.saveNutrition(JSON.stringify(event));
 $("intakeCheckStatus").textContent="正在保存本机 JSON，连接后会同步 GitHub…";
 $("saveIntakeCheck").disabled=true;
 setTimeout(()=>$("saveIntakeCheck").disabled=false,1000);
};
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
  const category=primaryRegionForRow(row);
  return category==="其他"?
    (window.BodyTraceExerciseCatalog?.region(row.exercise_id)||exRegion[row.exercise_id]||"其他"):
    category;
}
function regionalCounts() {
  const counts=Object.fromEntries(regions.map(r=>[r,0]));
  const end=today,start=plus(end,-27);
  for(const r of state.rows) {
    const key=categoryForRow(r);
    if(!isFailedAttempt(r) && r.session_date>=start && r.session_date<=end){
      counts[Object.hasOwn(counts,key)?key:"其他"]++;
    }
  }
  return counts;
}
// Four comparable trend cards: charted metric is workout-set count, never total kg.
const dashboardRegions=["胸","肩","背","腿"];
const dashboardNames={胸:"CHEST",肩:"SHOULDERS",背:"BACK",腿:"LEGS"};
const dashboardColors=regionThemeColors;
const dashboardClasses={胸:"region-chest",肩:"region-shoulder",背:"region-back",腿:"region-leg"};
function computeRegionDashboard(rows,anchorDate=today){
 const first=plus(anchorDate,-55),prevEnd=plus(anchorDate,-28),currentStart=plus(anchorDate,-27);
 const stats=dashboardRegions.map(region=>({
  region,weeks:Array(8).fill(0),total28:0,previous28:0,latest:null,frequency:new Map()
 }));
 const byRegion=new Map(stats.map(item=>[item.region,item]));
 const activeDays=new Set();
 let currentTotal=0;
 for(const [index,row] of rows.entries()){
  if(isFailedAttempt(row))continue;
  const date=row.session_date,card=byRegion.get(categoryForRow(row));
  if(!card||!(/^\d{4}-\d{2}-\d{2}$/.test(date||""))||date<first||date>anchorDate)continue;
  // Relative 7-day blocks, oldest to newest; includes the current date.
  const diffDays=Math.round((parse(date)-parse(first))/86400000);
  const week=Math.floor(diffDays/7);
  if(week>=0&&week<8)card.weeks[week]++;
  if(date<=prevEnd){card.previous28++;continue}
  if(date<currentStart)continue;
  card.total28++;currentTotal++;activeDays.add(date);
  const name=exerciseLabels[row.exercise_id]||row.exercise||row.exercise_id||"未知动作";
  card.frequency.set(name,(card.frequency.get(name)||0)+1);
  const created=String(row.created_at||"");
  if(!card.latest||date>card.latest.date||
   date===card.latest.date&&(created>card.latest.created||
    created===card.latest.created&&index>card.latest.index)){
   card.latest={date,created,index,name};
  }
 }
 for(const card of stats){
  card.last7=card.weeks[7];
  card.topAction=[...card.frequency].sort((a,b)=>b[1]-a[1])[0]?.[0]||"尚无训练";
 }
 return {cards:stats,total28:currentTotal,activeDays:activeDays.size};
}
// Shared-date, shared-value multi-exercise e1RM chart. One series is one
// exercise plus one load basis, never a sum of muscle strengths or machines.
const trendColorShades={
 胸:["#FF9C95","#E77776","#FFC0B0","#D96772","#FFA5AC","#CF8589"],
 肩:["#F9D07C","#E7AD51","#FFE5A2","#CF994B","#F2BD68","#DEC789"],
 背:["#83C7FF","#50A7E9","#B0DEFF","#6B94DC","#6FBBD6","#9BA9F0"],
 腿:["#C7A6FF","#A78CE2","#E0C4FF","#9270D0","#D9A0E5","#B59ACD","#AE80EF","#E1B5D6"]
};
let trendSelectedPeriod="30",trendStart="",trendEnd="",trendAssistBase=70;
let trendFocusKey=null;
// All exercises use the SAME y-axis in the SAME plot, without per-region lanes.
const trendDashStyles=["","10 6","3 6","15 5 3 5","2 3","11 4 2 4"];
const trendMarkerStyles=["circle","square","diamond","triangle","cross","hexagon"];
function trendRelativeIndex(value,reference,assisted){
 // 100 marks this exercise's own first effective record. For an assisted
 // exercise with 0 kg estimated load, the fixed floor avoids division by zero.
 // Do not squash small changes with tanh or flatten real declines.
 const denominator=Math.max(assisted?20:10,reference*.6);
 return 100+100*(value-reference)/denominator;
}
function trendRecordedRange(series){
 const dates=series.flatMap(s=>s.points.map(p=>p.date)).sort();
 return {first:dates[0]||"",last:dates[dates.length-1]||""};
}
const validTrendDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x||"")&&
 !Number.isNaN(Date.parse(x+"T12:00:00Z"));
const trendMillis=x=>Date.parse(x+"T12:00:00Z");
function trendRange(){
 const end=validTrendDate(trendEnd)?trendEnd:today;
 const from=validTrendDate(trendStart)?trendStart:plus(end,-29);
 return {from,end,valid:trendMillis(from)<=trendMillis(end)};
}
function trendInitialDates(period){
 const known=state.rows.map(r=>r.session_date).filter(validTrendDate).sort();
 const end=today;
 return {from:period==="all"?(known[0]||plus(end,-29)):
  plus(end,-(Number(period)||90)+1),end};
}
function trendData(rows,from,end,bodyWeight=70){
 const groups=new Map(),ignored={failed:0,missing:0,highReps:0,other:0};
 for(const row of rows){
  const day=row.session_date,region=categoryForRow(row);
  if(!validTrendDate(day)||day<from||day>end)continue;
  if(!dashboardRegions.includes(region)){ignored.other++;continue}
  if(isFailedAttempt(row)){ignored.failed++;continue}
  const reps=Number(row.reps);
  if(!validNum(row.reps)||!Number.isInteger(reps)||reps<1||reps>15){
   ignored.highReps++;continue;
  }
  const assisted=row.exercise_id==="assisted_pullup"||
   row.exercise_id==="assisted_dip";
  const basis=assisted?"assisted":row.load_basis==="per_side"?"per_side":
   row.load_basis==="bodyweight"?"bodyweight":"machine";
  // A raw 'bodyweight' field is typically EXTRA kg, not the total weight.
  // Exclude it from the shared estimate unless its meaning is known.
  if(basis==="bodyweight"){ignored.missing++;continue}
  const raw=assisted?row.assistance_kg:row.load_kg;
  const load=Number(raw);
  if(!validNum(raw)||!Number.isFinite(load)||load<0||(!assisted&&load===0)){
   ignored.missing++;continue;
  }
  const effective=assisted?Math.max(0,bodyWeight-load):load;
  const estimate=effective*(1+reps/30);
  if(!Number.isFinite(estimate)){ignored.missing++;continue}
  const id=row.exercise_id||row.exercise;
  if(!id){ignored.missing++;continue}
  const key=id+"|"+basis;
  if(!groups.has(key)){
   const target=targetForExercise(id);
   groups.set(key,{key,id,region,muscle:target||"",name:exerciseLabels[id]||
    row.exercise||id,basis,assisted,days:new Map()});
  }
  const group=groups.get(key),prev=group.days.get(day);
  if(!prev||estimate>prev.value)group.days.set(day,{
   date:day,value:estimate,load,reps,bodyWeight:assisted?bodyWeight:null,
   note:row.note||"",unit:basis==="per_side"?"每侧":"标称"
  });
 }
 const series=[...groups.values()].map(group=>({...group,
  points:[...group.days.values()].sort((a,b)=>a.date.localeCompare(b.date))
 })).sort((a,b)=>dashboardRegions.indexOf(a.region)-dashboardRegions.indexOf(b.region)||
   a.muscle.localeCompare(b.muscle,"zh-CN")||a.name.localeCompare(b.name,"zh-CN")||
   a.key.localeCompare(b.key));
 const counts={胸:0,肩:0,背:0,腿:0};
 for(const group of series){
  const index=counts[group.region]++;
  const palette=trendColorShades[group.region];
  group.color=palette[index%palette.length];
  group.dash=trendDashStyles[index%trendDashStyles.length];
  group.marker=trendMarkerStyles[index%trendMarkerStyles.length];
  group.styleIndex=index;
 }
 return {series,ignored};
}
function renderRegionDashboard(){
 const dashboard=$("trainingOverview"),root=$("regionTrendGrid");
 dashboard.replaceChildren();root.replaceChildren();
 const summary=computeRegionDashboard(state.rows);
 const main=document.createElement("div");main.className="training-overview-main";
 const label=document.createElement("span");label.textContent="最近28天有效训练";
 const number=document.createElement("strong");number.textContent=summary.total28+" 组";
 main.append(label,number);
 const aside=document.createElement("div");aside.className="training-overview-stat";
 aside.textContent="活跃 "+summary.activeDays+" 天";dashboard.append(main,aside);
 for(const button of document.querySelectorAll("#trendPeriodToolbar .trend-period")){
  button.classList.toggle("active",button.dataset.period===trendSelectedPeriod);
  button.setAttribute("aria-pressed",String(button.dataset.period===trendSelectedPeriod));
 }
 const {from,end,valid}=trendRange();
 if(!valid){root.textContent="起始日期不能晚于结束日期";return}
 const dataset=trendData(state.rows,from,end,trendAssistBase);
 const all=dataset.series;
 // A reference is established from the first recorded session for THIS
 // exercise, regardless of the currently selected viewing window.
 const history=trendData(state.rows,"1900-01-01",end,trendAssistBase).series;
 const reference=new Map(history.map(group=>[group.key,group.points[0]?.value??0]));
 if(trendFocusKey&&!all.some(group=>group.key===trendFocusKey))trendFocusKey=null;
 const ns="http://www.w3.org/2000/svg";
 const el=(tag,attrs={})=>{
  const node=document.createElementNS(ns,tag);
  for(const [key,val] of Object.entries(attrs))node.setAttribute(key,String(val));
  return node;
 };
 const svgMarker=(kind,cx,cy,color,size=6)=>{
  let node;
  if(kind==="square"){
   node=el("rect",{x:cx-size,y:cy-size,width:size*2,height:size*2,rx:1.4});
  }else if(kind==="diamond"){
   node=el("polygon",{points:[cx,cy-size*1.25,cx+size*1.1,cy,
    cx,cy+size*1.25,cx-size*1.1,cy].join(",")});
  }else if(kind==="triangle"){
   node=el("polygon",{points:[cx,cy-size*1.35,cx+size*1.25,cy+size,
    cx-size*1.25,cy+size].join(",")});
  }else if(kind==="cross"){
   node=el("path",{d:"M "+(cx-size)+" "+cy+" L "+(cx+size)+" "+cy+
    " M "+cx+" "+(cy-size)+" L "+cx+" "+(cy+size),fill:"none",
    stroke:color,"stroke-width":"3.8","stroke-linecap":"round"});
  }else if(kind==="hexagon"){
   node=el("polygon",{points:Array.from({length:6},(_,i)=>{
    const a=(i/3)*Math.PI;
    return (cx+Math.cos(a)*size)+","+(cy+Math.sin(a)*size);
   }).join(" ")});
  }else node=el("circle",{cx,cy,r:size});
  if(kind!=="cross"){
   node.setAttribute("fill",color);
   node.setAttribute("stroke","#14241e");
   node.setAttribute("stroke-width","1.5");
  }
  node.setAttribute("class","combined-trend-marker");
  node.setAttribute("pointer-events","none");
  node.setAttribute("data-marker",kind);
  return node;
 };
 const recorded=trendRecordedRange(all);
 const status=document.createElement("div");status.className="combined-trend-status";
 status.textContent=from+" — "+end+" · "+all.length+" 条动作曲线"+
  (recorded.last?" · 最新记录 "+recorded.last:" · 当前没有有效记录");
 root.append(status);
 if(!all.length){
  const empty=document.createElement("p");empty.className="note";
  empty.textContent="所选日期内没有可用的力量表现记录，可尝试「全部」查看历史。";
  root.append(empty);return;
 }
 const section=document.createElement("div");section.className="combined-trend-scroll";
 // SVG aspect ratio gives the full plot roughly one phone-screen width of height.
 // There is a single shared y-domain, never a fixed region-per-row lane.
 const W=800,H=750,plotTop=48,plotBottom=676;
 const svg=el("svg",{viewBox:"0 0 "+W+" "+H,role:"img",
  "aria-label":"所有胸肩背腿动作共用完整高度与一个表现指数纵轴的折线图"});
 svg.append(el("rect",{x:0,y:0,width:W,height:H,
  fill:"transparent","pointer-events":"all"}));
 const clip=el("clipPath",{id:"trend-shared-plot-clip"});
 clip.append(el("rect",{x:70,y:plotTop,width:718,
  height:plotBottom-plotTop}));
 const defs=el("defs");defs.append(clip);svg.append(defs);
 const span=Math.max(0,trendMillis(recorded.last)-trendMillis(recorded.first));
 // Only recorded dates set chart extents. No left-only blank 90-day viewport.
 const x=day=>span===0?775:73+
  (trendMillis(day)-trendMillis(recorded.first))/span*702;
 const curveValues=all.map(group=>{
  const base=reference.get(group.key)??group.points[0].value;
  return {group,base,points:group.points.map(point=>({
   point,index:trendRelativeIndex(point.value,base,group.assisted)
  }))};
 });
 // On focus zoom into selected action's real variation. With no selection,
 // calculate one y domain for ALL actions, not one scale per muscle.
 const chosenValues=trendFocusKey?
  curveValues.filter(v=>v.group.key===trendFocusKey):curveValues;
 const samples=chosenValues.flatMap(v=>v.points.map(p=>p.index));
 const rawMin=Math.min(...samples,100),rawMax=Math.max(...samples,100);
 // Do not force a 100 baseline into the focused domain: subtle gains need
 // most of the total plotting height, not another miniature subplot.
 const focusSamples=trendFocusKey?chosenValues.flatMap(v=>v.points.map(p=>p.index)):[];
 const minIndex=focusSamples.length?Math.min(...focusSamples):rawMin;
 const maxIndex=focusSamples.length?Math.max(...focusSamples):rawMax;
 const delta=Math.max(trendFocusKey?3:12,maxIndex-minIndex);
 const midpoint=(maxIndex+minIndex)/2;
 const low=midpoint-delta*.64,high=midpoint+delta*.64;
 const y=value=>plotBottom-(value-low)/(high-low)*(plotBottom-plotTop);
 svg.setAttribute("data-ymin",low.toFixed(3));
 svg.setAttribute("data-ymax",high.toFixed(3));
 svg.setAttribute("data-axis-mode",trendFocusKey?"focused":"all");
 for(let i=0;i<=5;i++){
  const value=low+(high-low)*i/5,py=y(value);
  svg.append(el("line",{x1:70,y1:py,x2:788,y2:py,
   stroke:"#3a554c","stroke-width":1,opacity:".8"}));
  const label=el("text",{x:63,y:py+5,
   "text-anchor":"end",fill:"#a9c8b8","font-size":15});
  label.textContent=round1(value);svg.append(label);
 }
 const title=el("text",{x:15,y:22,fill:"#a9c8b8","font-size":16});
 title.textContent="表现指数";svg.append(title);
 const baseline=y(100);
 if(baseline>=plotTop&&baseline<=plotBottom){
  svg.append(el("line",{x1:70,y1:baseline,x2:788,y2:baseline,
   stroke:"#b1c7bd","stroke-width":1.4,opacity:".68",
   "stroke-dasharray":"5 6"}));
 }
 const dateSpan=Math.round(span/86400000);
 if(dateSpan>0){
  const ticks=Math.min(4,dateSpan);
  for(let i=0;i<=ticks;i++){
   const day=plus(recorded.first,Math.round(dateSpan*i/ticks));
   const px=x(day);
   svg.append(el("line",{x1:px,y1:plotTop,x2:px,y2:plotBottom,
    stroke:"#304d44","stroke-width":1,"stroke-dasharray":"2 9"}));
   const label=el("text",{x:px,y:719,
    "text-anchor":i===0?"start":i===ticks?"end":"middle",
    fill:"#aecabb","font-size":17});
   label.textContent=day.slice(5);svg.append(label);
  }
 }else{
  const label=el("text",{x:776,y:719,"text-anchor":"end",
   fill:"#aecabb","font-size":17});
  label.textContent=recorded.last.slice(5);svg.append(label);
 }
 const details=document.createElement("div");details.className="combined-trend-selection";
 details.setAttribute("role","status");
 const curves=curveValues.map(v=>({
  group:v.group,base:v.base,
  pts:v.points.map(p=>({x:x(p.point.date),y:y(p.index),
   point:p.point,index:p.index}))
 }));
 const showPoint=(curve,pt)=>{
  const {group,base}=curve,point=pt.point;
  const difference=point.value-base;
  const change=difference>0.05?"较起点提高":difference<-.05?"较起点下降":"与起点接近";
  details.textContent=group.name+" · "+point.date+" · "+
   round1(point.load)+" kg"+(group.assisted?"辅助":"")+
   " × "+point.reps+"次 · 表现估算 "+round1(point.value)+" kg"+
   "（"+change+" "+round1(Math.abs(difference))+" kg）";
 };
 const setFocus=(key,pt)=>{
  trendFocusKey=trendFocusKey===key&&!pt?null:key;
  renderRegionDashboard();
  // Preserve the picked observation after rebuilding.
  if(key&&pt&&trendFocusKey===key){
   const name=all.find(g=>g.key===key);
   const referenceValue=reference.get(key)??0;
   const difference=pt.value-referenceValue;
   const change=difference>0.05?"较起点提高":difference<-.05?"较起点下降":"与起点接近";
   const detailsNode=root.querySelector(".combined-trend-selection");
   if(detailsNode)detailsNode.textContent=name.name+" · "+pt.date+" · "+
    round1(pt.load)+" kg"+(name.assisted?"辅助":"")+" × "+pt.reps+
    "次 · 表现估算 "+round1(pt.value)+" kg（"+change+" "+
    round1(Math.abs(difference))+" kg）";
  }
 };
 const selection=trendFocusKey?all.find(s=>s.key===trendFocusKey):null;
 if(selection){
  const latest=selection.points[selection.points.length-1];
  const old=reference.get(selection.key)??latest.value;
  const delta=latest.value-old;
  details.textContent="已选 "+selection.name+" · 最近 "+latest.date+" · "+
   (delta>0.05?"进步":delta<-.05?"下降":"基本持平")+" "+
   round1(Math.abs(delta))+" kg（相对历史首条记录）";
 }else details.textContent="点击某条曲线或下方动作名称：突出该动作，其他曲线变淡；再次点击恢复全部";
 for(const curve of curves){
  const {group,pts}=curve;
  const focused=trendFocusKey===group.key;
  const dimmed=!!trendFocusKey&&!focused;
  const line=el("polyline",{
   class:"combined-trend-line"+(focused?" selected":"")+(dimmed?" muted":""),
   "data-key":group.key,"data-region":group.region,
   points:pts.map(p=>p.x+","+p.y).join(" "),
   fill:"none",stroke:group.color,
   "stroke-width":focused?5.2:3.1,
   "stroke-linejoin":"round","stroke-linecap":"round",
   opacity:dimmed?".16":"1",
   "clip-path":"url(#trend-shared-plot-clip)"});
  if(group.dash)line.setAttribute("stroke-dasharray",group.dash);
  line.setAttribute("pointer-events","none");
  svg.append(line);
  for(const pt of pts){
   const marker=svgMarker(group.marker,pt.x,pt.y,group.color,focused?8:6);
   if(dimmed)marker.setAttribute("opacity",".16");
   marker.setAttribute("clip-path","url(#trend-shared-plot-clip)");
   svg.append(marker);
   // Accessible named points; pointer activation is handled on SVG itself
   // so that overlapping touch targets never steal clicks.
   const hit=el("circle",{class:"combined-trend-point",cx:pt.x,cy:pt.y,
    r:11,fill:"transparent","pointer-events":"none",tabindex:0,
    role:"button","aria-label":group.name+" "+pt.point.date+
    " 估算1RM "+round1(pt.point.value)+"公斤"});
   hit.addEventListener("keydown",e=>{
    if(e.key==="Enter"||e.key===" "){e.preventDefault();setFocus(group.key,pt.point);}
   });
   svg.append(hit);
  }
 }
 // Select the NEAREST VISIBLE CURVE SEGMENT, rather than toggling/hiding lines.
 svg.addEventListener("click",e=>{
  const rect=svg.getBoundingClientRect();
  if(!rect.width||!rect.height)return;
  const px=(e.clientX-rect.left)/rect.width*W;
  const py=(e.clientY-rect.top)/rect.height*H;
  let chosen=null,best=Infinity;
  for(const curve of curves){
   for(let i=0;i<curve.pts.length;i++){
    const p=curve.pts[i];
    const dx=p.x-px,dy=p.y-py;
    const pointDistance=dx*dx+dy*dy;
    if(pointDistance<best){best=pointDistance;chosen={curve,pt:p};}
    if(i===0)continue;
    const a=curve.pts[i-1],vx=p.x-a.x,vy=p.y-a.y;
    const t=Math.max(0,Math.min(1,
     ((px-a.x)*vx+(py-a.y)*vy)/Math.max(1e-8,vx*vx+vy*vy)));
    const cx=a.x+t*vx,cy=a.y+t*vy;
    const dist=(px-cx)**2+(py-cy)**2;
    if(dist<best){
     best=dist;
     chosen={curve,pt:t<.5?a:p};
    }
   }
  }
  if(chosen&&best<35*35)
   setFocus(chosen.curve.group.key,chosen.pt.point);
 });
 section.append(svg);
 root.append(section,details);
 if(trendFocusKey){
  const clear=document.createElement("button");clear.type="button";
  clear.className="secondary mini combined-trend-clear";
  clear.textContent="显示全部曲线";
  clear.onclick=()=>setFocus(trendFocusKey,null);
  root.append(clear);
 }
 const legend=document.createElement("div");legend.className="combined-trend-legend";
 for(const region of ["胸","肩","背","腿"]){
  const part=all.filter(s=>s.region===region);
  if(!part.length)continue;
  const wrapper=document.createElement("div");
  wrapper.className="combined-trend-legend-region";
  const title=document.createElement("strong");
  title.textContent=region+" · "+part.length+"项";
  title.style.color=regionThemeColors[region];wrapper.append(title);
  const items=document.createElement("div");
  items.className="combined-trend-legend-items";
  for(const group of part){
   const button=document.createElement("button");
   button.type="button";button.className="combined-trend-legend-item";
   const chosen=trendFocusKey===group.key;
   button.classList.toggle("selected",chosen);
   button.classList.toggle("muted",!!trendFocusKey&&!chosen);
   button.setAttribute("aria-pressed",String(chosen));
   button.setAttribute("title","查看 "+group.name+"；再次点击恢复所有曲线");
   const key=el("svg",{viewBox:"0 0 48 20",width:46,height:20,
    "aria-hidden":"true",class:"combined-trend-legend-symbol"});
   const sample=el("line",{x1:2,y1:10,x2:46,y2:10,
    stroke:group.color,"stroke-width":3});
   if(group.dash)sample.setAttribute("stroke-dasharray",group.dash);
   key.append(sample,svgMarker(group.marker,24,10,group.color,5));
   const name=document.createElement("span");
   name.textContent=group.name.split("（")[0]+
    (group.basis==="per_side"?"·每侧":"");
   button.append(key,name);
   button.onclick=()=>setFocus(group.key,null);
   items.append(button);
  }
  wrapper.append(items);legend.append(wrapper);
 }
 root.append(legend);
 const note=document.createElement("p");
 note.className="note combined-trend-note";
 note.textContent="全部动作共用一张图和一条表现指数纵轴（首条有效记录=100）。"+
  "点选动作后会自动放大该动作的上下波动，其他曲线仍保留为淡色背景。"+
  "这是便于观察趋势的相对指标，不是跨器械可比的肌肉力量。"+
  "未训练日不补点，辅助动作沿用 "+round1(trendAssistBase)+" kg 体重基准。";
 root.append(note);
}
function updateTrendPreference(){
 const from=$("trendStartDate").value,to=$("trendEndDate").value;
 if(!validTrendDate(from)||!validTrendDate(to))return;
 trendStart=from;trendEnd=to;
 const weight=Number($("trendAssistWeight").value);
 if(!Number.isFinite(weight)||weight<30||weight>250){
  $("trendAssistWeight").value=String(trendAssistBase);
  return;
 }
 trendAssistBase=weight;
 renderRegionDashboard();
}
for(const button of document.querySelectorAll("#trendPeriodToolbar .trend-period")){
 button.onclick=()=>{
  trendSelectedPeriod=button.dataset.period;
  if(trendSelectedPeriod!=="custom"){
   const range=trendInitialDates(trendSelectedPeriod);
   trendStart=range.from;trendEnd=range.end;
   $("trendStartDate").value=trendStart;
   $("trendEndDate").value=trendEnd;
  }
  updateTrendPreference();
 };
}
for(const name of ["trendStartDate","trendEndDate"])
 $(name).onchange=()=>{trendSelectedPeriod="custom";updateTrendPreference();};
$("trendAssistWeight").onchange=updateTrendPreference;
({from:trendStart,end:trendEnd}=trendInitialDates("30"));
$("trendStartDate").value=trendStart;
$("trendEndDate").value=trendEnd;
function renderRegionSummary(){
  const node=$("regionSummary");node.replaceChildren();
  const counts=regionalCounts(),max=Math.max(1,...Object.values(counts));
  for(const key of regions){
    const row=document.createElement("div");row.className="zone-bar";row.dataset.region=key;
    const label=document.createElement("span");label.textContent=key;
    const track=document.createElement("div");track.className="track";
    const fill=document.createElement("div");fill.className="fill";
    fill.style.width=(counts[key]/max*100)+"%";fill.style.background=regionThemeColors[key]||"#91a9a8";track.append(fill);
    const amount=document.createElement("b");amount.textContent=counts[key]+"组";
    row.append(label,track,amount);node.append(row);
  }
}
// Exercise-to-primary-target classification. One set is assigned ONE target for
// visualization only; this is not measured EMG or precise activation of a muscle.
const muscleTargets={
 adductor:"髋内收肌群",abductor:"髋外展肌群",
 leg_extension:"股四头肌",leg_press:"股四头肌",leg_press_45:"股四头肌",
 single_leg_press:"股四头肌",prone_leg_curl:"腘绳肌群",seated_leg_curl:"腘绳肌群",
 hip_thrust:"臀大肌",
 lateral_raise:"三角肌中束",front_raise:"三角肌前束",
 rear_delt_fly:"三角肌后束",reverse_fly:"三角肌后束",
 shoulder_press:"三角肌前束",dumbbell_shoulder_press:"三角肌前束",
 overhead_press:"三角肌前束",face_pull:"三角肌后束",
 row:"上背肌群",assisted_pullup:"背阔肌",vertical_traction:"背阔肌",
 custom_shoulderpullpending:"背阔肌",custom_bodyweightpullup:"背阔肌",
 custom_hacksquat:"股四头肌",custom_bothwaysquat:"股四头肌",
 chest_press:"胸大肌",smith_bench:"胸大肌",pec_deck:"胸大肌",
 custom_pectoralmachine:"胸大肌",
 incline_chest_press:"胸大肌",horizontal_bench:"胸大肌",assisted_dip:"胸大肌",
 barbell_bench:"胸大肌",dumbbell_bench:"胸大肌",
 incline_dumbbell_bench:"胸大肌",decline_bench:"胸大肌"
};
const muscleLabels=[
 "胸大肌","三角肌前束","三角肌中束","三角肌后束",
 "背阔肌","上背肌群","肱二头肌","肱三头肌","腹部肌群",
 "髋外展肌群","髋内收肌群","臀大肌","股四头肌","腘绳肌群","小腿后群"
];
function targetForExercise(id){
 return muscleTargets[id]||null;
}
function muscleCounts(){
 const start=plus(today,-27),count=Object.fromEntries(muscleLabels.map(label=>[label,0]));
 for(const row of state.rows){
  const label=targetForExercise(row.exercise_id);
  if(label&&!isFailedAttempt(row)&&row.session_date>=start&&row.session_date<=today)count[label]++;
 }
 return count;
}
// Simple positional schematic, not a photorealistic or diagnostic anatomy atlas.
// Particularly, abduction is located at LATERAL HIP, not on outer mid-thigh.
const musclePaths={
 front:[
  ["三角肌前束","M42 54 Q50 51 56 54 L54 69 L40 77 L35 68 Z"],
  ["三角肌前束","M94 54 Q101 51 109 54 L115 68 L110 77 L96 69 Z"],
  ["三角肌中束","M33 57 L42 54 L39 77 L28 72 L26 66 Z"],
  ["三角肌中束","M108 54 L117 57 L124 66 L122 72 L111 77 Z"],
  ["胸大肌","M55 70 L73 62 L74 95 L59 96 L43 82 Z"],
  ["胸大肌","M77 62 L95 70 L107 82 L91 96 L76 95 Z"],
  ["肱二头肌","M27 79 L37 79 L34 108 L24 121 L19 116 Z"],
  ["肱二头肌","M113 79 L123 79 L131 116 L126 121 L116 108 Z"],
  ["腹部肌群","M60 98 L75 100 L90 98 L90 141 L60 141 Z"],
  ["股四头肌","M52 160 L67 155 L69 197 L62 207 L53 195 L50 177 Z"],
  ["股四头肌","M83 155 L98 160 L100 177 L97 195 L88 207 L81 197 Z"],
  ["髋外展肌群","M49 144 L61 145 L61 162 L50 171 L47 157 Z"],
  ["髋外展肌群","M89 145 L101 144 L103 157 L100 171 L89 162 Z"],
  ["髋内收肌群","M66 149 L74 153 L74 198 L68 190 L63 162 Z"],
  ["髋内收肌群","M76 153 L84 149 L87 162 L82 190 L76 198 Z"]
 ],
 back:[
  ["三角肌后束","M34 55 L56 52 L54 72 L37 78 L27 70 Z"],
  ["三角肌后束","M94 52 L116 55 L123 70 L113 78 L96 72 Z"],
  ["上背肌群","M60 56 L75 63 L90 56 L101 73 L91 91 L75 98 L59 91 L49 73 Z"],
  ["背阔肌","M48 78 L61 97 L73 101 L72 129 L54 123 L42 93 Z"],
  ["背阔肌","M102 78 L108 93 L96 123 L78 129 L77 101 L89 97 Z"],
  ["肱三头肌","M26 79 L38 81 L34 110 L23 125 L17 118 Z"],
  ["肱三头肌","M112 81 L124 79 L133 118 L127 125 L116 110 Z"],
  ["腹部肌群","M60 130 L75 135 L90 130 L91 142 L59 142 Z"],
  ["臀大肌","M54 149 L74 146 L74 167 L64 175 L52 167 Z"],
  ["臀大肌","M76 146 L96 149 L98 167 L86 175 L76 167 Z"],
  ["髋外展肌群","M49 143 L60 143 L60 159 L51 167 L46 157 Z"],
  ["髋外展肌群","M90 143 L101 143 L104 157 L99 167 L90 159 Z"],
  ["腘绳肌群","M53 171 L72 175 L70 207 L62 214 L53 203 Z"],
  ["腘绳肌群","M78 175 L97 171 L97 203 L88 214 L80 207 Z"],
  ["小腿后群","M54 208 L65 215 L66 230 L57 236 L51 223 Z"],
  ["小腿后群","M85 215 L96 208 L99 223 L93 236 L84 230 Z"]
 ]
};
function muscleMacroRegion(label){
 if(label==="胸大肌")return "胸";
 if(label.startsWith("三角肌"))return "肩";
 if(label==="背阔肌"||label==="上背肌群")return "背";
 if(["髋外展肌群","髋内收肌群","臀大肌","股四头肌","腘绳肌群","小腿后群"].includes(label))return "腿";
 return "";
}
function muscleShade(label,n){
 return n?(regionThemeColors[muscleMacroRegion(label)]||"#718b99"):"#28413a";
}
function drawMuscleMap(){
 const root=$("bodyMuscleView"),legend=$("muscleLegend");
 root.replaceChildren();legend.replaceChildren();
 const counts=muscleCounts(),max=Math.max(1,...Object.values(counts));
 for(const orientation of ["front","back"]){
  const group=document.createElement("div");group.className="muscle-person";
  const title=document.createElement("small");title.textContent=orientation==="front"?"正面":"背面";
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 150 250");svg.setAttribute("role","img");
  svg.setAttribute("aria-label",title.textContent+"细分肌群示意");
  const bg=document.createElementNS("http://www.w3.org/2000/svg","path");
  bg.setAttribute("d","M51 40 L43 51 L27 55 L13 91 L7 128 L25 140 L42 95 L48 145 L49 184 L53 238 L72 238 L75 181 L78 238 L97 238 L101 184 L102 145 L108 95 L125 140 L143 128 L137 91 L123 55 L107 51 L99 40 Z");
  bg.setAttribute("fill","#172d29");bg.setAttribute("stroke","#3c6454");svg.append(bg);
  const head=document.createElementNS("http://www.w3.org/2000/svg","ellipse");
  head.setAttribute("cx","75");head.setAttribute("cy","23");head.setAttribute("rx","18");head.setAttribute("ry","22");
  head.setAttribute("fill","#2a493e");head.setAttribute("stroke","#7fa994");svg.append(head);
  for(const [label,d] of musclePaths[orientation]){
   const path=document.createElementNS("http://www.w3.org/2000/svg","path");
   path.setAttribute("d",d);path.setAttribute("fill",muscleShade(label,counts[label]));
   if(counts[label])path.setAttribute("fill-opacity",String(0.62+0.38*counts[label]/max));
   path.setAttribute("class","muscle-path"+(selectedRegion===label?" selected":""));
   path.setAttribute("tabindex","0");path.setAttribute("role","button");
   path.setAttribute("aria-label",label+"：最近28天"+counts[label]+"组");
   const labelEl=document.createElementNS("http://www.w3.org/2000/svg","title");
   labelEl.textContent=label+" · 最近28天 "+counts[label]+"组";path.append(labelEl);
   path.addEventListener("click",()=>{selectedRegion=label;drawMuscleMap()});
   path.addEventListener("keydown",e=>{
    if(e.key==="Enter"||e.key===" "){e.preventDefault();selectedRegion=label;drawMuscleMap()}
   });
   svg.append(path);
  }
  group.append(svg,title);root.append(group);
 }
 for(const label of muscleLabels){
  const chip=document.createElement("button");
  chip.type="button";chip.className="muscle-legend-btn"+(selectedRegion===label?" selected":"");
  const macro=muscleMacroRegion(label);
  chip.dataset.region=macro||"其他";
  chip.style.setProperty("--muscle-color",regionThemeColors[macro]||"#97b1bd");
  const name=document.createElement("span");name.textContent=label;
  const qty=document.createElement("strong");qty.textContent=counts[label];
  chip.append(name,qty);
  chip.addEventListener("click",()=>{selectedRegion=label;drawMuscleMap()});
  legend.append(chip);
 }
 const key=selectedRegion,n=counts[key]||0;
 const exercises=[...new Set(state.rows.filter(r=>targetForExercise(r.exercise_id)===key).map(r=>r.exercise))];
 $("muscleDetail").textContent=key+" · 最近28天 "+n+" 组。主要归类动作："+(exercises.join("、")||"暂无对应记录")+
  "。一个动作只计入一个主要目标，不表示其他协同肌不参与；未映射的自定义动作不会被猜测分配。";
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
   byId.set(id,{id,records:[],latestDate:"",lastIndex:-1,latestRow:null});
  }
  const group=byId.get(id);
  group.records.push({row,index});
  const date=/^\d{4}-\d{2}-\d{2}$/.test(row.session_date||"")?row.session_date:"";
  // Append position wins within a date: ChatGPT/GitHub entries may lack
  // created_at, and comparing "" to a native timestamp made new rows stale.
  // A position here is an ordering of saved records, NOT an inferred workout time.
  if(date>group.latestDate||(date===group.latestDate&&index>group.lastIndex)){
   group.latestDate=date;group.lastIndex=index;group.latestRow=row;
  }
 });
 return [...byId.values()].sort((a,b)=>
  b.latestDate.localeCompare(a.latestDate)||
  b.lastIndex-a.lastIndex||a.id.localeCompare(b.id));
}
function compactStrengthSet(row,exerciseId){
 const assisted=exerciseId==="assisted_pullup"||exerciseId==="assisted_dip";
 const raw=assisted?row.assistance_kg:row.load_kg;
 const prefix=assisted?"辅助 ":row.load_basis==="per_side"?"每侧 ":
  row.load_basis==="bodyweight"?"外加 ":"";
 const weight=validNum(raw)?prefix+Number(raw)+" kg":"负重未录入";
 const rep=validNum(row.reps)?Number(row.reps)+" 次":"次数未录入";
 return weight+" × "+rep+(isFailedAttempt(row)?"（0次失败）":"");
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
  const region=categoryForRow(group.records.at(-1).row)||"其他";
  const card=document.createElement("article");card.className="strength-exercise-card";
  card.dataset.region=region;
  card.style.setProperty("--region-accent",regionThemeColors[region]||"#8bb6ad");
  card.dataset.exerciseId=group.id;
  const heading=document.createElement("div");heading.className="strength-exercise-heading";
  const header=document.createElement("div");header.className="strength-exercise-info";
  const title=document.createElement("h3");
  title.textContent="【"+region+"】"+(exerciseLabels[group.id]||group.records.at(-1)?.row.exercise||group.id);
  const date=document.createElement("small");
  date.textContent="最近记录 "+(group.latestDate||"未知日期")+
   (group.latestRow?" · "+compactStrengthSet(group.latestRow,group.id):"");
  header.append(title,date);
  const count=document.createElement("span");count.className="tag";
  const finished=group.records.filter(x=>!isFailedAttempt(x.row)).length;
  const failed=group.records.length-finished;
  count.textContent=finished+"组"+(failed?" · "+failed+"次失败":"");
  heading.append(header,count);
  const range=document.createElement("div");range.className="strength-exercise-range";
  const chart=document.createElement("div");chart.className="feature-chart";
  const disclaimer=document.createElement("p");disclaimer.className="note strength-exercise-note";
  card.append(heading,range,chart,disclaimer);
  root.append(card);
  renderStrengthPlot(group,chart,range,disclaimer,region);
 }
}
// Same machine, same recorded units and strictly later date; avoid fabricating
// intra-day ordering when a workout entry has no actual completion timestamp.
function findFailureMilestone(values,attempt){
 if(!isFailedAttempt(attempt))return null;
 const basis=v=>v.load_basis||"machine";
 const next=values.filter(v=>!isFailedAttempt(v)&&v.reps>=1&&
   v.load===attempt.load&&basis(v)===basis(attempt)&&
   v.session_date>attempt.session_date)
   .sort((a,b)=>a.session_date.localeCompare(b.session_date))[0];
 if(!next)return null;
 return {date:next.session_date,days:Math.round(
  (Date.parse(next.session_date+"T12:00:00Z")-
   Date.parse(attempt.session_date+"T12:00:00Z"))/86400000)};
}
function renderStrengthPlot(group,chart,range,disclaimer,region){
 const plotColor=regionThemeColors[region]||"#8bb6ad";
 const ex=group.id, isAssist=ex==="assisted_pullup"||ex==="assisted_dip";
 const list=group.records.map(({row,index})=>({...row,sequence:index}))
   .filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.session_date||"")&&
     validNum(r.reps)&&safeNum(r.reps)>=0&&
     validNum(isAssist?r.assistance_kg:r.load_kg))
   .sort((a,b)=>a.session_date.localeCompare(b.session_date)||a.sequence-b.sequence);
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
  return {...r,load,reps,
   estimated:!isFailedAttempt(r)&&!isAssist&&reps>0&&reps<=15?
      load*(1+reps/30):null};
 });
 const completed=values.filter(v=>!isFailedAttempt(v));
 const failures=values.filter(isFailedAttempt);
 // A red 0-rep marker is at its actual ATTEMPTED load in the same plot
 // coordinates, NOT at zero kg and NOT treated as a measured e1RM.
 const tracked=completed.map(v=>isAssist?v.load:(v.estimated??v.load));
 const attempts=failures.map(v=>v.load);
 const domain=tracked.concat(attempts);
 const maximum=Math.max(...domain),minimum=Math.min(...domain);
 const spread=Math.max(1,maximum-minimum,maximum*.05);
 const lo=Math.max(0,minimum-spread*.25),hi=maximum+spread*.25;
 range.textContent=(completed.length?
  round1(minimum)+"–"+round1(maximum)+(isAssist?" kg 辅助量":" kg 参考值")+
   " · "+completed.length+"组成功记录":"尚无成功完成组")+
  (failures.length?" · "+failures.length+"次失败尝试":"");
 const NS="http://www.w3.org/2000/svg";
 const el=(tag,attrs={})=>{
  const item=document.createElementNS(NS,tag);
  for(const [key,val] of Object.entries(attrs))item.setAttribute(key,String(val));
  return item;
 };
 const svg=el("svg",{viewBox:"0 0 400 225",role:"img",
   "aria-label":(exerciseLabels[ex]||ex)+"训练重量与失败尝试趋势"});
 const days=[...new Set(values.map(v=>v.session_date))].sort();
 const xVal=day=>days.length===1?200:32+days.indexOf(day)/(days.length-1)*338;
 const byDayPoints=new Map();
 for(const v of values){
  if(!byDayPoints.has(v.session_date))byDayPoints.set(v.session_date,[]);
  byDayPoints.get(v.session_date).push(v);
 }
 // Same-day records must not be identical pixels; small jitter retains the
 // day coordinate, and the recent-set buttons below allow precise selection.
 const pointX=v=>{
  const sameDay=byDayPoints.get(v.session_date);
  const index=sameDay.indexOf(v);
  const step=Math.min(9,36/Math.max(1,sameDay.length-1));
  return xVal(v.session_date)+(index-(sameDay.length-1)/2)*step;
 };
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
 const byDate=new Map(),points=[],pointSelectors=[],recentButtons=[];
 const editAction=document.createElement("button");
 editAction.type="button";
 editAction.className="secondary mini strength-edit-action";
 editAction.textContent="编辑所选训练点";
 editAction.disabled=true;
 const detail=document.createElement("div");
 detail.className="strength-point-detail";
 detail.setAttribute("role","status");
 detail.setAttribute("aria-live","polite");
 detail.textContent="点击图中圆点查看日期、重量和次数；红点表示该重量尝试0次（不代表1RM）";
 // The colored trend line must never interpolate through a failed attempt.
 for(const v of completed){
  const numeric=isAssist?v.load:(v.estimated??v.load);
  const old=byDate.get(v.session_date);
  if(old===undefined||(isAssist?numeric<old:numeric>old))byDate.set(v.session_date,numeric);
 }
 if(byDate.size>1){
  const lineDays=[...byDate.keys()].sort();
  const poly=el("polyline",{
    points:lineDays.map(d=>xVal(d)+","+yVal(byDate.get(d))).join(" "),
    fill:"none",stroke:plotColor,"stroke-width":2,"stroke-opacity":0.7,
    "stroke-linejoin":"round"
  });
  svg.append(poly);
 }
 for(const v of values){
  const failure=isFailedAttempt(v);
  const numeric=isAssist?v.load:(v.estimated??v.load);
  const cx=pointX(v),cy=yVal(failure?v.load:numeric);
  const point=el("circle",{cx,cy,r:failure?6:4.5,
    fill:failure?"#F07780":plotColor,
    stroke:failure?"#ffcbcb":"#0a2419","stroke-width":1});
  point.setAttribute("class","strength-visible-point"+(failure?" failed-point":""));
  point.dataset.normalRadius=failure?"6":"4.5";
  points.push(point);
  const units=v.load_basis==="per_side"?"（每侧）":
   v.load_basis==="bodyweight"?"（仅外加重量；自重另计）":"";
  const dateLabel=v.date_basis==="report_date"?"（对话报告日期，非确认训练日）":"";
  const hint=v.session_date+dateLabel+" · "+v.load+" kg"+units+" × "+v.reps+" 次"+
    (failure?" · 未完成":isAssist?"（辅助量）":"");
  const milestone=findFailureMilestone(values,v);
  const extra=(milestone?"\n同重量首次完成至少1次："+milestone.date+
    "（相隔"+milestone.days+"天"+(v.date_basis==="report_date"?
     "；起点为报告日，非实测训练间隔":"")+"）":"")+
   (failure&&!milestone?"\n尚无此重量后续成功记录":"")+
   (v.note?"\n备注："+v.note:"");
  const tooltip=el("title");tooltip.textContent=hint+extra;point.append(tooltip);
  const hit=el("circle",{cx,cy,r:17,fill:"transparent",
    "pointer-events":"all",tabindex:0,role:"button",
    "aria-label":"查看 "+hint});
  hit.setAttribute("class","strength-point-hit");
  hit.style.cursor="pointer";
  const selectPoint=()=>{
   for(const other of points){
    other.setAttribute("r",other.dataset.normalRadius);
    other.setAttribute("stroke",other.classList.contains("failed-point")?"#ffcbcb":"#0a2419");
    other.setAttribute("stroke-width","1");
   }
   point.setAttribute("r","8");
   point.setAttribute("stroke","#ffffff");
   point.setAttribute("stroke-width","2");
   detail.textContent="已选："+hint+extra;
   detail.classList.toggle("failed",failure);
   editAction.disabled=!v.id;
   editAction.onclick=()=>window.BodyTraceWorkoutEditor?.open(v);
   for(const entry of recentButtons)entry.button.classList.toggle("active",entry.value===v);
  };
  hit.addEventListener("click",selectPoint);
  hit.addEventListener("keydown",event=>{
   if(event.key==="Enter"||event.key===" "){
    event.preventDefault();selectPoint();
   }
  });
  svg.append(point,hit);
  pointSelectors.push({value:v,select:selectPoint});
 }
 const recent=document.createElement("div");
 recent.className="strength-recent-sets";
 recent.setAttribute("aria-label","最近六次记录（可点击查看）");
 for(const entry of pointSelectors.slice(-6).reverse()){
  const button=document.createElement("button");
  button.type="button";button.className="strength-recent-set";
  button.textContent=entry.value.session_date.slice(5)+" · "+
   compactStrengthSet(entry.value,ex);
  button.setAttribute("aria-label","查看 "+entry.value.session_date+" "+
   compactStrengthSet(entry.value,ex));
  button.onclick=entry.select;
  recentButtons.push({button,value:entry.value});
  recent.append(button);
 }
 chart.append(svg,detail,recent);
 chart.append(editAction);
 // On each sync, show the newest SAVED set without requiring a dot tap.
 if(pointSelectors.length)pointSelectors[pointSelectors.length-1].select();
 disclaimer.textContent=isAssist?
  "部位色点显示成功组标称辅助量；红点按实际尝试的辅助量定位，表示0次失败，不参与趋势线。":
  "部位色点按负重/简化Epley e1RM展示（仅1–15次）；红点按尝试重量定位，表示0次失败，不是测得的1RM、不参与连线。";
}

// Basic body diagram is a training-zone schematic, never inferred anatomy.
// Actual body measurements are read directly from the daily JSON records.
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
$("avatarMeasureDate").addEventListener("change",e=>{
 selectedAvatarDate=e.target.value;
 renderAvatar();
});
function renderAllFeatures(){
 renderIntakeCheckin();nutritionRender();renderRegionDashboard();renderStrength();renderRegionSummary();drawMuscleMap();renderProfile();renderAvatar();renderBodyEntry();
}
// Expose a narrow redraw callback after catalog updates; the function itself
// remains inside this module, and rendering never changes source JSON.
window.BodyTraceRenderFeatures=renderAllFeatures;
const originalReceive = window.bodyTraceReceive;
window.bodyTraceReceive=function(evt){
  if(typeof originalReceive==="function") originalReceive(evt);
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
    if(evt.event?.entry_kind!=="daily_checkin"){
      $("foodName").value="";$("foodPreset").value="";$("foodKcal").value="";
      $("foodProtein").value="";$("foodCarbs").value="";$("foodFat").value="";
      updateFoodPreview();
    }
    if(evt.event?.entry_kind==="daily_checkin")intakeDraftDirty=false;
    renderIntakeCheckin();navigate("body");
    toast(evt.event?.entry_kind==="daily_checkin"?
      "每日四色摄入勾选已保存本机；连接后同步 GitHub":
      "饮食已经存入本机 JSON；已连接时将尝试上传 GitHub");
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

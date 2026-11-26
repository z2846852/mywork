"use strict";
// Fast, focused regression for Beijing rollover, date edits and training-volume heatmap.
// The full UI suite runs separately; it has unrelated legacy assumptions.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const html = read("app/src/main/assets/index.html");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "WebView inline script exists");
new vm.Script(script, { filename:"index.html" });
const heatPart = script.slice(script.indexOf("function summarizeHeatDays("),
  script.indexOf("function focusCalendarLatest()"));
assert.ok(heatPart.startsWith("function summarizeHeatDays("));
const heatCtx = {
  isFailedAttempt: row => row.attempt_status === "failed" || String(row.reps).trim() === "0",
  primaryRegionForRow: row => row.exercise_region ||
    ({chest_press:"胸",lateral_raise:"肩",row:"背",leg_extension:"腿"})[row.exercise_id] || "其他"
};
const heat = vm.runInNewContext(heatPart +
  "\n({summarizeHeatDays,regionIntensityLevel})",heatCtx);
for(const [sets,expected] of [
 [0,0],[1,1],[2,2],[3,2],[4,3],[5,3],[6,4],[24,4]
])assert.equal(heat.regionIntensityLevel(sets),expected,
 "Separate quadrant depth should reflect that region's completed set count");
assert.ok(script.includes('quadrant.dataset.intensity=String(regionIntensityLevel(sets))'));
const actual = heat.summarizeHeatDays([
 {session_date:"2026-11-25",exercise_id:"chest_press",reps:"12"},
 {session_date:"2026-11-25",exercise_id:"row",reps:"0"},
 {session_date:"2026-11-25",exercise_id:"leg_extension",reps:"8"}
]);
assert.equal(actual.get("2026-11-25").total,2, "Failed attempts do not add volume");
assert.equal(actual.get("2026-11-25").failures,1);
const datePart = script.slice(script.indexOf("function refreshToday(){"),
 script.indexOf('window.addEventListener("focus",refreshToday);'));
assert.ok(datePart.startsWith("function refreshToday()"));
const dateFields = Object.fromEntries(["recordDate","intakeDate","foodDate","bodyEntryDate"]
 .map(id => [id,{value:"2026-11-24"}]));
const ctx = {
 today:"2026-11-24", todayShanghai:()=>"2026-11-25",
 dateInputsAutoReset:Object.keys(dateFields),
 dateManuallyChosen:new Set(["foodDate"]),
 $:id=>dateFields[id],
 state:{selected:"2026-11-24",calendarBrowsing:false},
 renderHeat(){},renderDay(){},updateRecordDateFlag(){},
 window:{BodyTraceRenderFeatures(){}}
};
vm.runInNewContext(datePart+"\nrefreshToday();",ctx);
for(const id of ["recordDate","intakeDate","bodyEntryDate"])
 assert.equal(dateFields[id].value,"2026-11-25",id+" should roll over");
assert.equal(dateFields.foodDate.value,"2026-11-24",
 "Explicit historical date must not be overwritten");
assert.equal(ctx.state.selected,"2026-11-25");
const header=html.slice(html.indexOf('class="record-top-heading"'),
 html.indexOf('class="formgrid exercise-top-row'));
const advanced=html.slice(html.indexOf('id="recordAdvancedTools"'),
 html.indexOf('id="exerciseManager"'));
assert.ok(header.includes('id="recordDate" type="date"'));
assert.ok(header.indexOf("训练记录")<header.indexOf('id="recordDate"'));
assert.ok(!advanced.includes('id="recordDate"'));
assert.ok(header.includes('id="recordDateStatus"'));
assert.ok(script.includes('if(id==="recordDate"&&$(id).value===today)dateManuallyChosen.delete(id)'));
assert.ok(script.includes('updateRecordDateFlag();'));
const predictor=html.slice(html.indexOf('id="saveRecordOnly"'),
 html.indexOf('id="recordAdvancedTools"'));
assert.ok(predictor.includes('id="e1rmTool"')&&!predictor.includes('id="e1rmTool" aria-label="估算最大力量与重量次数试算" hidden'),
 "e1RM must be always visible directly before More Settings");
assert.ok(!html.includes('id="e1rmToolToggle"')&&
 script.includes('node.config.hidden=!open'),
 "The old visibility toggle is gone, but per-exercise calibration stays collapsible");
assert.ok(html.includes('id="recordRestoreMax"')&&
 script.includes('function maximumRepeatableLoad(rows,id)')&&
 script.includes('Number.isInteger(reps)&&reps>5'),
 "R must restore actual maximum history with more than five completed reps");
assert.ok(script.includes('session_date:correctedDate'));
assert.ok(script.includes('activeWorkoutEdit.source_date||activeWorkoutEdit.session_date'));
assert.ok(html.includes('id="workoutEditDate" type="date"'));
const native=read("app/src/main/java/com/z2846852/bodytrace/MainActivity.java");
const edits=read("app/src/main/java/com/z2846852/bodytrace/WorkoutEdits.java");
const projection=read("app/src/main/java/com/z2846852/bodytrace/ViewProjector.java");
const github=read("app/src/main/java/com/z2846852/bodytrace/GitHubApi.java");
assert.ok(native.includes('event.put("session_date",sessionDate)'));
assert.ok(native.includes('WorkoutEdits.apply(day.optJSONArray("workouts")'));
assert.ok(edits.includes('revised.put("session_date",sessionDate)'));
assert.ok(projection.includes('item.put("source_date",date)'));
assert.ok(projection.includes('item.put("session_date", effectiveDate)'));
assert.ok(projection.includes('counts.put(effectiveDate,'));
assert.ok(github.includes('"action", "session_date", "load_key"'));
assert.ok(html.includes('--quadrant-strength:30%') &&
 html.includes('--quadrant-strength:100%'));
assert.ok(!html.includes('#page-home #heat .cell[data-level'),
 "Daily total must no longer color the entire cell green");
const chestVsLeg=heat.summarizeHeatDays([
 ...Array.from({length:5},()=>({session_date:"2026-11-25",exercise_id:"chest_press",reps:"10"})),
 {session_date:"2026-11-25",exercise_id:"leg_extension",reps:"10"}
]).get("2026-11-25");
assert.equal(heat.regionIntensityLevel(chestVsLeg.regions["胸"]),3);
assert.equal(heat.regionIntensityLevel(chestVsLeg.regions["腿"]),1);
assert.equal(heat.regionIntensityLevel(chestVsLeg.regions["肩"]),0);
// Upper-lower linkage: verify selection state and layout remain stable.
const trends=read("app/src/main/assets/features.js");
const css=read("app/src/main/assets/features.css");
const begin=trends.indexOf("function syncFocusedStrengthCard(){");
const end=trends.indexOf("function renderStrength(){",begin);
assert.ok(begin>0&&end>begin);
const linkage=trends.slice(begin,end);
const cards=["row","assisted_pullup"].map(exerciseId=>({
 dataset:{exerciseId},selected:false,
 classList:{toggle(name,active){if(name==="selected-trend-exercise")this.selected=active;}}
}));
const list={querySelectorAll:()=>cards,append(){throw Error("Card must not be moved")}};
const trendDateFields={trendStartDate:{value:""},trendEndDate:{value:""}};
const selectedKeys=[];
const groups=[
 {key:"row|machine",id:"row",basis:"machine",points:[{date:"2026-11-24"}]},
 {key:"row|per_side",id:"row",basis:"per_side",points:[{date:"2026-11-23"}]},
 {key:"assisted_pullup|assisted",id:"assisted_pullup",basis:"assisted",
  points:[{date:"2026-11-25"}]}
];
let linkageApi;
const context={
 $:id=>id==="strengthList"?list:trendDateFields[id],
 state:{rows:[]},latestTrendWeight:()=>70,
 trendRange:()=>({from:"2026-11-01",end:"2026-11-25",valid:true}),
 trendData:()=>({series:groups}),
 trendInitialDates:()=>({from:"2025-01-01",end:"2026-11-25"}),
 renderRegionDashboard:()=>selectedKeys.push(linkageApi.selected()),
 toast:message=>{throw Error("Unexpected toast: "+message)}
};
linkageApi=vm.runInNewContext(
 "let trendFocusKey=null,trendSelectedPeriod='30',trendStart='',trendEnd='';\n"+
 linkage+"\n({syncFocusedStrengthCard,focusTrendFromStrengthCard,selected:()=>trendFocusKey})",
 context);
assert.equal(linkageApi.focusTrendFromStrengthCard("row","per_side"),true);
assert.equal(linkageApi.selected(),"row|per_side");
linkageApi.syncFocusedStrengthCard();
assert.equal(cards[0].classList.selected,true);
assert.equal(cards[1].classList.selected,false);
assert.equal(linkageApi.focusTrendFromStrengthCard("assisted_pullup"),true);
linkageApi.syncFocusedStrengthCard();
assert.equal(cards[0].classList.selected,false);
assert.equal(cards[1].classList.selected,true);
assert.equal(cards[0].dataset.trendSelected,"false");
assert.equal(cards[1].dataset.trendSelected,"true");
assert.deepEqual(selectedKeys,["row|per_side","assisted_pullup|assisted"]);
assert.ok(!linkage.includes("slot.append")&&!linkage.includes("list.append"));
assert.ok(trends.includes('svg.setAttribute("data-axis-mode","all")'));
assert.ok(trends.includes('const samples=curveValues.flatMap('));
assert.ok(!trends.includes("const chosenValues=trendFocusKey?"));
assert.ok(trends.includes("setFocus(null,null); // Empty plot = show all curves again."));
assert.ok(!trends.includes('clear.textContent="显示全部曲线"'));
assert.ok(trends.includes("if(syncUpper)focusTrendFromStrengthCard(ex,v.load_basis);"));
assert.ok(trends.includes("heading.addEventListener(\"keydown\""));
assert.ok(trends.includes("button.onclick=()=>entry.select(true);"));
assert.ok(html.includes('class="trend-dashboard-header"'));
assert.ok(!html.includes('id="trendFocusedDetail"'));
assert.ok(css.includes(".strength-exercise-card.selected-trend-exercise"));
// Overview must render every action for a day, without truncation or a toggle.
const renderDayStart=script.indexOf("function renderDay(){");
const renderDayEnd=script.indexOf("function renderBody(){",renderDayStart);
assert.ok(renderDayStart>=0&&renderDayEnd>renderDayStart);
const dayRender=script.slice(renderDayStart,renderDayEnd);
assert.ok(dayRender.includes("for(const [position,[ex,items]] of ordered.entries())"));
assert.ok(!dayRender.includes("position>=2")&&!dayRender.includes("showAllDayActions"));
assert.ok(!script.includes("overview-all-actions")&&!script.includes("persistAllDayActions"));
assert.ok(script.includes('if(showWorkoutHistory&&recentDates.length)'),
 "The separate historical-sets visibility preference must remain intact");
assert.ok(html.includes('id="toggleHistory"'));
// Personal milestones are exercise-specific; none claims to be an adult norm.
const goalsStart=trends.indexOf("const strengthGoalStorageKey=");
const goalsEnd=trends.indexOf("function trendRecordedRange(",goalsStart);
assert.ok(goalsStart>=0&&goalsEnd>goalsStart);
const stored={};
const goalCtx={
 localStorage:{
  getItem:key=>stored[key]||null,
  setItem:(key,value)=>{stored[key]=value;}
 },
 window:{BodyTraceNative:null},
 state:{rows:[
  {exercise_id:"chest_press",load_kg:30,reps:10},
  {exercise_id:"chest_press",load_kg:40,reps:8},
  {exercise_id:"assisted_pullup",assistance_kg:65,reps:10}
 ]},
 isFailedAttempt:r=>Number(r.reps)===0,
 validNum:x=>x!==null&&x!==undefined&&x!==""&&Number.isFinite(Number(x)),
 Math,Object,JSON,Number
};
const goalApi=vm.runInNewContext(trends.slice(goalsStart,goalsEnd)+
 "\n({strengthGoalFor,strengthGoalEstimate,trendRelativeIndex,strengthGoalStore,strengthGoalStorageKey})",goalCtx);
const hip=goalApi.strengthGoalFor("hip_thrust","machine");
assert.equal(hip.kg,60);
assert.equal(hip.reps,8);
assert.equal(hip.hidden,false);
const hipTarget=goalApi.strengthGoalEstimate(hip,"machine");
assert.ok(Math.abs(hipTarget-76)<1e-9);
const startIndex=goalApi.trendRelativeIndex(15,15,false,"hip_thrust",hipTarget);
const nowIndex=goalApi.trendRelativeIndex(65*(1+8/30),15,false,"hip_thrust",hipTarget);
const nextIndex=goalApi.trendRelativeIndex(70*(1+8/30),15,false,"hip_thrust",hipTarget);
assert.ok(startIndex>10&&startIndex<13);
assert.ok(nowIndex>110&&nowIndex<113);
assert.ok(nextIndex>122&&nextIndex<125);
assert.ok(nextIndex-nowIndex>nowIndex-100,
 "Near-goal progress must remain perceptible; no 0.2 global dampening");
const chest=goalApi.strengthGoalFor("chest_press","machine");
assert.ok(chest.kg>40&&chest.origin==="generated");
const assistedGoal=goalApi.strengthGoalFor("assisted_pullup","assisted");
assert.equal(assistedGoal.hidden,true);
assert.equal(assistedGoal.kg,null);
assert.ok(stored["bodytrace.strengthGoals.v1"]);
assert.equal(goalApi.strengthGoalFor("chest_press","machine").kg,chest.kg,
 "Generated stage target must not drift as training increases");
assert.ok(trends.includes('class:"strength-reference-line"'));
assert.ok(trends.includes('toggle.textContent=goal.hidden?"显示参考":"隐藏参考"'));
assert.ok(trends.includes('origin:"manual"')&&trends.includes('strengthGoalStore[goalKey]'));
const nativeSource=read("app/src/main/java/com/z2846852/bodytrace/MainActivity.java");
assert.ok(nativeSource.includes("@JavascriptInterface public String loadStrengthGoals()"));
assert.ok(nativeSource.includes("@JavascriptInterface public boolean saveStrengthGoals(String payload)"));
assert.ok(nativeSource.includes('getSharedPreferences("bodytrace_strength_goals",MODE_PRIVATE)'));
assert.ok(nativeSource.includes("@JavascriptInterface public void openStrengthGuide(String slug)"));
assert.ok(nativeSource.includes("@JavascriptInterface public String loadE1rmCalibration()"));
assert.ok(nativeSource.includes("@JavascriptInterface public boolean saveE1rmCalibration(String raw)"));
assert.ok(nativeSource.includes('getSharedPreferences("bodytrace_e1rm_calibration",MODE_PRIVATE)'));
assert.ok(html.includes('native.loadE1rmCalibration()'));
assert.ok(html.includes('native.saveE1rmCalibration(json)'));
assert.ok(nativeSource.includes('"none".equals(origin)'),"Empty-reference hide state must save");
assert.ok(trends.includes('native.loadStrengthGoals()')&&trends.includes('native.saveStrengthGoals(json)'));
assert.ok(!trends.includes("trendIndexGrowthFactors"));
// e1RM slider interaction is deliberately limited to 1–20 repetitions.
const sliderStart=script.indexOf("function e1rmTrialLoad(");
const sliderEnd=script.indexOf("(function initialiseRecordE1rm(){",sliderStart);
assert.ok(sliderStart>0&&sliderEnd>sliderStart);
const sliderFunctions=vm.runInNewContext(script.slice(sliderStart,sliderEnd)+
 "\n({e1rmTrialLoad,e1rmTrialRange})", {Math,Number});
const cfg={coeff:30,gain:1,offset:0};
const estimate=40*(1+10/30);
const range=sliderFunctions.e1rmTrialRange(estimate,cfg,false);
assert.ok(range.min>30&&range.max<55,"Dynamic weight slider should not reach 500kg");
assert.ok(Math.abs(sliderFunctions.e1rmTrialLoad(estimate,10,cfg,false)-40)<1e-9);
assert.ok(Math.abs(sliderFunctions.e1rmTrialLoad(estimate,1,cfg,false)-range.max)<.11);
assert.ok(Math.abs(sliderFunctions.e1rmTrialLoad(estimate,20,cfg,false)-range.min)<.11);
const assisted={coeff:30,gain:1,offset:100};
const assistedE1rm=(100-65)*(1+10/30);
const assistedRange=sliderFunctions.e1rmTrialRange(assistedE1rm,assisted,true);
assert.ok(assistedRange.at1<assistedRange.at20,
 "Assisted exercises should use the reverse scale (less assistance for 1RM)");
assert.ok(Math.abs(sliderFunctions.e1rmTrialLoad(assistedE1rm,10,assisted,true)-65)<1e-9);
assert.ok(assistedRange.min>0&&assistedRange.max<100);
assert.ok(html.includes('id="e1rmTrialRepsSlider" min="1" max="20"'));
assert.ok(!html.includes('id="e1rmTrialKgSlider" min="0" max="500"'));
assert.ok(script.includes('node.kgSlider.min=String(limits.min)'));
assert.ok(script.includes('node.kgSlider.max=String(limits.max)'));
assert.ok(script.includes('node.repsSlider.value=String(bound(Math.round(reps),1,20))'));
assert.ok(script.includes("input.value=String(round(value));"));
console.log("PASS workout dates, quadrant, trends, dynamic 1–20RM trial sliders");
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
 renderHeat(){},renderDay(){},
 window:{BodyTraceRenderFeatures(){}}
};
vm.runInNewContext(datePart+"\nrefreshToday();",ctx);
for(const id of ["recordDate","intakeDate","bodyEntryDate"])
 assert.equal(dateFields[id].value,"2026-11-25",id+" should roll over");
assert.equal(dateFields.foodDate.value,"2026-11-24",
 "Explicit historical date must not be overwritten");
assert.equal(ctx.state.selected,"2026-11-25");
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
const dateFields={trendStartDate:{value:""},trendEndDate:{value:""}};
const selectedKeys=[];
const groups=[
 {key:"row|machine",id:"row",basis:"machine",points:[{date:"2026-11-24"}]},
 {key:"row|per_side",id:"row",basis:"per_side",points:[{date:"2026-11-23"}]},
 {key:"assisted_pullup|assisted",id:"assisted_pullup",basis:"assisted",
  points:[{date:"2026-11-25"}]}
];
let linkageApi;
const context={
 $:id=>id==="strengthList"?list:dateFields[id],
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
console.log("PASS Beijing rollover, workout date edits, four-color quadrant and trend linkage");
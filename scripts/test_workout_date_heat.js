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
  "\n({summarizeHeatDays,heatIntensityThresholds,heatIntensityLevel})",heatCtx);
const inputs = [1,8,10,10,10,11,13,13,19,24,24];
const history = new Map(inputs.map((n,i) => [i, {total:n}]));
const tiers = heat.heatIntensityThresholds(history);
assert.equal(tiers.normal,15);
assert.equal(tiers.peak,30);
assert.equal(heat.heatIntensityLevel(0,tiers),0);
assert.equal(heat.heatIntensityLevel(10,tiers),2);
assert.equal(heat.heatIntensityLevel(13,tiers),2);
assert.equal(heat.heatIntensityLevel(19,tiers),3);
assert.equal(heat.heatIntensityLevel(24,tiers),3);
assert.equal(heat.heatIntensityLevel(30,tiers),4);
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
assert.ok(html.includes('--region-mix:48%') && html.includes('--region-mix:65%'));
assert.ok(html.includes('--heat-bg:#355b44'));
console.log("PASS Beijing rollover, workout date edits and softened heatmap");
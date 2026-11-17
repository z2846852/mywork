// Zero-dependency tests for BodyTrace's inline WebView interactions.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "app/src/main/assets/index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "Embedded JavaScript should exist");
new vm.Script(script, {filename: "index.html script"}); // parse all embedded JS

const helpers = script.slice(script.indexOf("function loadRecommendation("),
  script.indexOf("function refreshExerciseRecommendation("));
assert.ok(helpers.startsWith("function loadRecommendation"));
const load = vm.runInNewContext(helpers + "\nloadRecommendation");
const demo = JSON.parse(fs.readFileSync(path.join(root, "data/demo/2026-11-17.json"), "utf8"));
const rows = demo.workouts.map(x => ({
  exercise_id: x.exercise_id,
  session_date: demo.date,
  load_kg: x.load_kg === undefined ? "" : String(x.load_kg),
  assistance_kg: x.assistance_kg === undefined ? "" : String(x.assistance_kg),
}));
function check(ex,expected) {
  assert.deepEqual(JSON.parse(JSON.stringify(load(rows,ex))),expected);
}
check("lateral_raise",{amount:18,count:4,isAssist:false});
check("adductor",{amount:20,count:3,isAssist:false});
check("row",{amount:27.5,count:1,isAssist:false});
check("assisted_pullup",{amount:73,count:1,isAssist:true});
check("horizontal_bench",null);
const recent = Array.from({length:12},(_,i)=>({
  exercise_id:"row",session_date:"2026-10-"+String(i+1).padStart(2,"0"),
  load_kg:String(i+1),assistance_kg:""
}));
assert.deepEqual(JSON.parse(JSON.stringify(load(recent,"row"))),{amount:7,count:10,isAssist:false});
assert.ok(html.includes('id="recordReps" type="number" min="1" max="200" step="1" inputmode="numeric" value="10" readonly'));
assert.ok(html.includes('id="recordSets" type="number" min="1" max="10"'));
assert.ok(html.includes('id="wheelCanvas"')&&html.includes('id="wheelOverlay"'));
assert.ok(html.includes('id="bodyEntryPanel"')&&html.includes('id="bodySaveMeasurement"'));
assert.ok(html.includes('id="bodyWeightUnit"'));
assert.ok(html.includes('id="heatScroll"'));
assert.ok(html.includes('state.selected=ds.at(-1)||today;renderHeat(true)'));
const scrollHelper = script.slice(script.indexOf("function focusCalendarLatest()"),
  script.indexOf("function weight(r)"));
const scroll={scrollWidth:1200,clientWidth:300,scrollLeft:0};
vm.runInNewContext(scrollHelper+"\nfocusCalendarLatest();",{
  $:id=>id==="heatScroll"?scroll:null,requestAnimationFrame:callback=>callback()
});
assert.equal(scroll.scrollLeft,900);
// Basic body schematic + all action charts. No image rendering or forced 2D morphs.
const features=fs.readFileSync(path.join(root,"app/src/main/assets/features.js"),"utf8");
const native=fs.readFileSync(path.join(root,
  "app/src/main/java/com/z2846852/bodytrace/MainActivity.java"),"utf8");
const workflow=fs.readFileSync(path.join(root,".github/workflows/android.yml"),"utf8");
new vm.Script(features,{filename:"features.js"});
const wheel=fs.readFileSync(path.join(root,"app/src/main/assets/wheel.js"),"utf8");
new vm.Script(wheel,{filename:"wheel.js"});
assert.ok(wheel.includes("pointermove")&&wheel.includes("wheelCanvas"));
assert.ok(html.includes('id="bodyMuscleView"')&&html.includes('id="avatarStatLeft"')&&html.includes('id="avatarStatRight"'));
assert.ok(html.includes('id="avatarMeasureDate"')&&html.includes('id="bodyEntryPanel"'));
assert.ok(!html.includes('id="avatarPicture"')&&!html.includes('id="avatarWarpCanvas"'));
assert.ok(!html.includes('id="avatarImport"')&&!html.includes('id="bodyWarpEnabled"'));
assert.ok(!html.includes('id="analyticsExercise"')&&html.includes('id="strengthList"'));
assert.ok(features.includes("orderedExerciseGroups(state.rows)"));
assert.ok(features.includes("for(const group of groups)"));
assert.ok(features.includes("musclePaths")&&features.includes("drawMuscleMap()"));
assert.ok(native.includes('readAsset("wheel.js")')&&!native.includes('readAsset("avatar_morph.js")'));
const manifest=fs.readFileSync(path.join(root,"app/src/main/AndroidManifest.xml"),"utf8");
assert.ok(!manifest.includes('android.intent.action.SEND'),"No stale image-share registration in schematic-only App");
assert.ok(native.includes("saveBatch(String batchJson)")&&native.includes("saveMeasurement(String measurementJson)"));
assert.ok(features.includes("bodyEdited")&&features.includes("saveMeasurement("));
const github=fs.readFileSync(path.join(root,"app/src/main/java/com/z2846852/bodytrace/GitHubApi.java"),"utf8");
assert.ok(github.includes('isMeasurement ? "measurements"'));
const projection=fs.readFileSync(path.join(root,"app/src/main/java/com/z2846852/bodytrace/ViewProjector.java"),"utf8");
assert.ok(projection.includes('item.put("created_at"'));
assert.ok(html.includes('exerciseRegionById')&&html.includes('orderRecordOptionsByRecent(valid)'));
assert.ok(html.includes('option.textContent="【"+prefix+"】"+option.textContent'));
assert.ok(workflow.includes("app:assembleRelease")&&workflow.includes("Load fixed public signing identity"));

const start=features.indexOf("function orderedExerciseGroups(rows){");
const end=features.indexOf("function renderStrength(){",start);
assert.ok(start>=0&&end>start,"recent-first sorting function missing");
const sorting=vm.runInNewContext(features.slice(start,end)+"\norderedExerciseGroups");
const sample=[
 {exercise_id:"row",session_date:"2026-11-17",created_at:"2026-11-17T11:00:00+08:00"},
 {exercise_id:"chest_press",session_date:"2026-11-15"},
 {exercise_id:"adductor",session_date:"2026-11-17",created_at:"2026-11-17T12:00:00+08:00"},
 {exercise_id:"lateral_raise",session_date:"2026-04-15"},
 {exercise_id:"row",session_date:"2026-11-01"}
];
assert.deepEqual(Array.from(sorting(sample),g=>g.id),[
 "adductor","row","chest_press","lateral_raise"
]);
assert.deepEqual(Array.from(sorting([]),g=>g.id),[]);
console.log("BodyTrace UI tests passed: recent-first all-action trends, region-prefixed selectors, simple anatomy, wheel input, JSON and signed Release.");

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
const legacy = vm.runInNewContext(helpers + "\nhistoricalRecommendation");
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
check("lateral_raise",{amount:27,reps:10,count:1,isAssist:false});
check("adductor",{amount:25,reps:10,count:1,isAssist:false});
check("row",{amount:27.5,reps:10,count:1,isAssist:false});
check("assisted_pullup",{amount:73,reps:10,count:1,isAssist:true});
assert.deepEqual(JSON.parse(JSON.stringify(legacy(rows,"lateral_raise"))),
 {amount:18,count:4,isAssist:false});
check("horizontal_bench",null);
const recent = Array.from({length:12},(_,i)=>({
  exercise_id:"row",session_date:"2026-10-"+String(i+1).padStart(2,"0"),
  load_kg:String(i+1),assistance_kg:""
}));
assert.deepEqual(JSON.parse(JSON.stringify(load(recent,"row"))),{amount:12,reps:10,count:1,isAssist:false});
assert.deepEqual(JSON.parse(JSON.stringify(legacy(recent,"row"))),{amount:7,count:10,isAssist:false});
const userChanges=rows.concat([
 {exercise_id:"lateral_raise",session_date:"2026-11-18",load_kg:"23",reps:"12"},
 {exercise_id:"lateral_raise",session_date:"2026-11-18",load_kg:"32",reps:"7",created_at:"2026-11-18T12:56:14+08:00"}
]);
assert.deepEqual(JSON.parse(JSON.stringify(load(userChanges,"lateral_raise"))),
 {amount:32,reps:7,count:1,isAssist:false});
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
const catalogJS=fs.readFileSync(path.join(root,"app/src/main/assets/exercise_catalog.js"),"utf8");
new vm.Script(catalogJS,{filename:"exercise_catalog.js"});
assert.ok(catalogJS.includes('option.textContent="【"+entry.region+"】"+entry.label'));
assert.ok(catalogJS.includes('compareUsage')&&catalogJS.includes('config.sort_mode==="region"'));
assert.ok(catalogJS.includes('saveCatalog(JSON.stringify(config))'));
assert.ok(html.includes('id="recordSortMode"')&&html.includes('id="exerciseManager"'));
assert.ok(html.includes('id="recordGroup"')&&html.includes('id="resetTrainingDefault"'));
assert.ok(catalogJS.includes('sorted.filter(a=>a.region===group)'));
assert.ok(html.includes('id="gitLogList"')&&html.includes('id="refreshGitLog"'));
const gitLogJS=fs.readFileSync(path.join(root,"app/src/main/assets/git_log.js"),"utf8");
new vm.Script(gitLogJS,{filename:"git_log.js"});
assert.ok(github.includes('readRecentCommits(String token)'));
assert.ok(native.includes('void readGitLog()')&&native.includes('readAsset("git_log.js")'));
assert.ok(github.includes('currentSha.equals(expectedSha)'));
assert.ok(html.includes('id="manageExercises"')&&html.includes('id="addCustomExercise"'));
for(const id of ["leg_extension","leg_press","leg_press_45","barbell_bench","dumbbell_bench","front_raise","rear_delt_fly","face_pull"]){
 assert.ok(html.includes(id+":"),"Built-in action missing: "+id);
 assert.ok(native.includes('case "'+id+'"'),"Native action must accept: "+id);
}
assert.ok(native.includes('void saveCatalog(String catalogJson)'));
assert.ok(native.includes('syncExerciseCatalog(String token)'));
assert.ok(native.includes('custom_[a-z0-9]{8,32}'));
const store=fs.readFileSync(path.join(root,"app/src/main/java/com/z2846852/bodytrace/JsonStore.java"),"utf8");
assert.ok(store.includes('exercise_catalog.json'));
assert.ok(github.includes('readExerciseCatalog(String token)')&&github.includes('writeExerciseCatalog(String token'));
assert.ok(native.includes('readAsset("exercise_catalog.js")'));
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

// Calendar browsing should not be reset to the latest date by an unrelated sync.
const indexStart=script.indexOf("function indexData(){");
const indexEnd=script.indexOf("function renderHeat(",indexStart);
assert.ok(indexStart>=0&&indexEnd>indexStart);
const indexNodes={statSets:{},statDays:{},statMovements:{},filter:element("select")};
const calendarState={
 rows:[
  {exercise:"Row",exercise_id:"row",session_date:"2026-11-01"},
  {exercise:"Leg Extension",exercise_id:"leg_extension",session_date:"2026-11-18"}
 ],
 selected:"2026-11-01",calendarBrowsing:true,filter:""
};
const renderFocus=[];
const calendarIndex=vm.runInNewContext(script.slice(indexStart,indexEnd)+"\nindexData",{
 state:calendarState,
 $:id=>indexNodes[id],
 document:{createElement:element},
 exerciseRegionById:{row:"背",leg_extension:"腿"},
 orderRecordOptionsByRecent(){},refreshExerciseRecommendation(){},
 renderHeat:focus=>renderFocus.push(focus),renderDay(){}
});
calendarIndex();
assert.equal(calendarState.selected,"2026-11-01","Browsing old dates must survive syncing");
assert.equal(renderFocus.at(-1),false,"Do not scroll away from an old date");
calendarState.calendarBrowsing=false;
calendarIndex();
assert.equal(calendarState.selected,"2026-11-18","Latest mode should track fresh workouts");

// UI behavior regression: actual catalog controller under a minimal DOM.
assert.ok(html.includes('<option value="">全部动作</option>'));
assert.ok(html.includes('if(trainingFormDirty&&!force)return;'));
assert.ok(html.includes('if(dates.length&&!state.calendarBrowsing)'));
assert.ok(html.includes('state.calendarBrowsing=true;state.selected=day'));
assert.ok(html.includes('!exercise_id||'),"Cannot save when the selected action disappeared");
function element(tag="div"){
 return {
  tagName:tag,value:"",textContent:"",children:[],dataset:{},style:{},listeners:{},
  classList:{add(){},remove(){}},
  append(...items){this.children.push(...items)},
  replaceChildren(){this.children=[];this.value=""},
  addEventListener(kind,fn){this.listeners[kind]=fn}
 };
}
const nodeIds=["recordGroup","recordExercise","recordSortMode","exerciseManageList",
 "suggestedLoad","manageExercises","closeExerciseManager","exerciseManager",
 "addCustomExercise","customActionName","customActionRegion","recordKg","recordReps",
 "recordSets","recordDate","weightLabel"];
const nodes=Object.fromEntries(nodeIds.map(id=>[id,element(
 ["recordGroup","recordExercise","recordSortMode"].includes(id)?"select":"div")]));
const catalogContext={
 state:{rows:[]},
 document:{getElementById:id=>nodes[id],createElement:element},
 exerciseLabels:{chest_press:"Chest Press",lateral_raise:"Lateral Raise",
   row:"Seated Row",leg_extension:"Leg Extension"},
 exerciseRegionById:{chest_press:"胸",lateral_raise:"肩",row:"背",leg_extension:"腿"},
 recordExerciseTouched:false,weightEditedByUser:false,repsEditedByUser:false,
 trainingFormDirty:false,
 window:{BodyTraceNative:{saveCatalog(){}},bodyTraceReceive(){}},
 clearTrainingEdits(){this.trainingFormDirty=false;this.weightEditedByUser=false;this.repsEditedByUser=false},
 refreshExerciseRecommendation(force){if(force){nodes.recordKg.value="auto";nodes.recordReps.value="auto"}},
 toast(){}
};
// JS sees these as free functions, not methods, so bind explicitly.
catalogContext.clearTrainingEdits=()=>{
 catalogContext.trainingFormDirty=false;
 catalogContext.weightEditedByUser=false;
 catalogContext.repsEditedByUser=false;
};
vm.runInNewContext(catalogJS,catalogContext);
const selectIds=()=>Array.from(nodes.recordExercise.children,item=>item.value);
assert.equal(nodes.recordGroup.value,"","Default muscle filter must be All");
catalogContext.state.rows=[
 {exercise_id:"row",session_date:"2026-11-01"},
 {exercise_id:"lateral_raise",session_date:"2026-11-17"},
 {exercise_id:"leg_extension",session_date:"2026-11-18"}
];
catalogContext.window.BodyTraceExerciseCatalog.refresh(catalogContext.state.rows);
assert.deepEqual(selectIds().slice(0,3),["leg_extension","lateral_raise","row"],
 "All movements should be sorted newest-first");
assert.equal(nodes.recordExercise.value,"leg_extension");
// While typing, a remote workout or catalog refresh must not switch action or override inputs.
catalogContext.trainingFormDirty=true;
catalogContext.recordExerciseTouched=true;
nodes.recordExercise.value="lateral_raise";
nodes.recordKg.value="32";nodes.recordReps.value="7";
catalogContext.state.rows.push({exercise_id:"row",session_date:"2026-11-19"});
catalogContext.window.BodyTraceExerciseCatalog.refresh(catalogContext.state.rows);
assert.equal(nodes.recordExercise.value,"lateral_raise");
assert.equal(nodes.recordKg.value,"32");assert.equal(nodes.recordReps.value,"7");
catalogContext.window.BodyTraceExerciseCatalog.apply({sort_mode:"region",custom:[],hidden:[]});
assert.equal(nodes.recordExercise.value,"lateral_raise");
assert.equal(nodes.recordKg.value,"32");assert.equal(nodes.recordReps.value,"7");
// Switching the group intentionally selects the latest in that group.
catalogContext.trainingFormDirty=false;
nodes.recordGroup.value="腿";nodes.recordGroup.listeners.change();
assert.deepEqual(selectIds(),["leg_extension"]);
assert.equal(nodes.recordExercise.value,"leg_extension");
// A hidden exercise must not turn an in-progress draft into a different exercise.
catalogContext.trainingFormDirty=true;
catalogContext.recordExerciseTouched=true;
nodes.recordKg.value="35";nodes.recordReps.value="12";
catalogContext.window.BodyTraceExerciseCatalog.apply({
 sort_mode:"recent",custom:[],hidden:["leg_extension"]
});
assert.equal(nodes.recordExercise.value,"");
assert.equal(nodes.recordKg.value,"35");
catalogContext.window.BodyTraceExerciseCatalog.refresh(catalogContext.state.rows);
assert.equal(nodes.recordExercise.value,"");
assert.equal(nodes.recordReps.value,"12");
console.log("BodyTrace UI tests passed: catalog recent/region sorting, add/hide/restore/delete actions, leg extension, body schematic, wheel and fixed Release signing.");

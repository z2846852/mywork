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
const load = vm.runInNewContext(helpers + "\nloadRecommendation",{isFailedAttempt:r=>r.attempt_status==="failed"||String(r.reps).trim()==="0"});
const legacy = vm.runInNewContext(helpers + "\nhistoricalRecommendation",{isFailedAttempt:r=>r.attempt_status==="failed"||String(r.reps).trim()==="0"});
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
assert.ok(html.includes('id="recordReps" type="number" min="0" max="200" step="1" inputmode="numeric" value="10" readonly'));
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
// Semantic palette must be stable in ALL four views: chest coral, shoulder amber,
 // back blue, leg violet. APP controls/status keep their original green.
const colorTokens={胸:"#F28B82",肩:"#F2C66D",背:"#67B7F7",腿:"#B9A9DD"};
for(const [region,color] of Object.entries(colorTokens)){
 assert.ok(html.includes(region+':"'+color+'"'),"Missing shared region color: "+region);
 assert.ok(html.includes(color),"HTML theme must expose palette for all views");
}
assert.ok(html.includes('const regionThemeColors=Object.freeze('));
assert.ok(html.includes('id="recordRegionBadge"'));
assert.ok(html.includes('const byDay=summarizeHeatDays(filtered())'));
assert.ok(html.includes('className="cell-quadrant"')||html.includes('className="cell-quadrant"+'));
assert.ok(!html.includes('grid-template-rows:repeat(7,13px)'));
const heatStart=script.indexOf("function summarizeHeatDays(");
const heatEnd=script.indexOf("function focusCalendarLatest()",heatStart);
assert.ok(heatStart>=0&&heatEnd>heatStart);
const heatFn=vm.runInNewContext(script.slice(heatStart,heatEnd)+"\nsummarizeHeatDays",{
 isFailedAttempt:r=>r.attempt_status==="failed"||String(r.reps).trim()==="0",
 exerciseRegionById:{chest_press:"胸",lateral_raise:"肩",row:"背",
  leg_extension:"腿",adductor:"腿",custom_ar:"手臂"},
});
const quad=heatFn([
 {session_date:"2026-11-19",exercise_id:"chest_press"},
 {session_date:"2026-11-19",exercise_id:"lateral_raise"},
 {session_date:"2026-11-19",exercise_id:"row"},
 {session_date:"2026-11-19",exercise_id:"leg_extension"},
 {session_date:"2026-11-19",exercise_id:"adductor"},
 {session_date:"2026-11-19",exercise_id:"custom_ar"},
 {session_date:"2026-11-20",exercise_id:"custom_ar"},
 {session_date:"2026-11-18",exercise_id:"leg_extension",exercise_region:"背"},
 {session_date:"bad-date",exercise_id:"row"}
]);
assert.equal(quad.get("2026-11-19").total,6);
assert.deepEqual(JSON.parse(JSON.stringify(quad.get("2026-11-19").regions)),
 {胸:1,肩:1,背:1,腿:2});
assert.equal(quad.get("2026-11-19").other,1);
assert.equal(quad.get("2026-11-20").other,1);
assert.equal(quad.get("2026-11-18").regions["背"],1,
 "Explicit per-record region metadata must be preserved");
assert.ok(!quad.has("bad-date"));
const paletteStart=features.indexOf("function muscleMacroRegion(");
const paletteEnd=features.indexOf("function drawMuscleMap(",paletteStart);
const musclePalette=vm.runInNewContext(features.slice(paletteStart,paletteEnd)+
 "\n({muscleMacroRegion,muscleShade})",{regionThemeColors:colorTokens});
for(const [muscle,region] of [["胸大肌","胸"],["三角肌中束","肩"],
 ["背阔肌","背"],["髋内收肌群","腿"],["髋外展肌群","腿"],["股四头肌","腿"]]){
 assert.equal(musclePalette.muscleMacroRegion(muscle),region);
 assert.equal(musclePalette.muscleShade(muscle,1),colorTokens[region]);
}
assert.equal(musclePalette.muscleShade("股四头肌",0),"#28413a");
assert.ok(features.includes('const dashboardColors=regionThemeColors;'));
assert.ok(features.includes('fill:failure?"#F07780":plotColor')&&features.includes('stroke:plotColor'));
assert.ok(features.includes('fill.style.background=regionThemeColors[key]'));
const cssBefore=fs.readFileSync(path.join(root,"app/src/main/assets/features.css"),"utf8");
for(const [selector,variable] of [["region-chest","--region-chest"],
 ["region-shoulder","--region-shoulder"],["region-back","--region-back"],["region-leg","--region-leg"]]){
 assert.ok(cssBefore.includes(".region-overview-card."+selector+"{--accent:var("+variable+")"));
}
// Saved workout data can be inspected on touch devices, not only SVG hover.
assert.ok(features.includes('hit.addEventListener("click",selectPoint)'));
assert.ok(features.includes('hit.addEventListener("keydown",event=>'));
assert.ok(features.includes('detail.textContent="已选："+hint+extra;'));
assert.ok(features.includes('const detail=document.createElement("div")'));
assert.ok(features.includes('hit=el("circle",{cx,cy,r:17,fill:"transparent"'));
assert.ok(features.includes('svg.append(point,hit)'));
assert.ok(features.includes('chart.append(svg,detail)'));
assert.ok(cssBefore.includes(".strength-point-detail{"));
assert.ok(cssBefore.includes(".strength-point-hit{touch-action:manipulation;"));
// 0 reps is a failed attempt, not 0 kg, not a training set, never Epley 1RM.
const failureHelper=vm.runInNewContext(
 script.slice(script.indexOf("function isFailedAttempt("),
  script.indexOf("const regionThemeColors="))+"\nisFailedAttempt");
assert.equal(failureHelper({reps:"0",attempt_status:"failed"}),true);
assert.equal(failureHelper({reps:"8",attempt_status:"completed_with_pain"}),false);
assert.equal(failureHelper({reps:""}),false);
const future=load([{exercise_id:"shoulder_press",session_date:"2026-11-19",
 load_kg:"10",reps:"0",attempt_status:"failed"},
 {exercise_id:"shoulder_press",session_date:"2026-11-19",
 load_kg:"5",reps:"8",note:"手腕疼痛"}],"shoulder_press");
assert.equal(future.amount,5,"Failed load is not a recommendation");
assert.equal(future.reps,8);
assert.ok(html.includes('id="recordLoadBasis"'));
assert.ok(html.includes('id="recordNote"'));
assert.ok(html.includes("if(counts.failures)cell.dataset.failed="));
assert.ok(html.includes('if(isFailedAttempt(r)){day.failures='));
assert.ok(html.includes('load_basis:entry.load_basis||""'));
assert.ok(features.includes('const cy=failure?194:yVal(numeric)'));
assert.ok(features.includes('fill:failure?"#F07780":plotColor'));
assert.ok(features.includes('if(isFailedAttempt(row))continue;'));
assert.ok(features.includes('if(label&&!isFailedAttempt(row)'));
const milestoneStart=features.indexOf("function findFailureMilestone(");
const milestoneEnd=features.indexOf("function renderStrengthPlot(",milestoneStart);
const findMilestone=vm.runInNewContext(
 features.slice(milestoneStart,milestoneEnd)+"\nfindFailureMilestone",
 {isFailedAttempt:failureHelper});
const failure={session_date:"2026-11-19",load:10,load_basis:"per_side",reps:0,attempt_status:"failed"};
const sequence=[
 failure,
 {session_date:"2026-11-23",load:10,load_basis:"machine",reps:4},
 {session_date:"2026-11-29",load:10,load_basis:"per_side",reps:1},
 {session_date:"2026-12-02",load:10,load_basis:"per_side",reps:3}
];
const milestone=findMilestone(sequence,failure);
assert.equal(milestone.date,"2026-11-29");
assert.equal(milestone.days,10);
assert.equal(findMilestone([failure],failure),null);
assert.equal(findMilestone(sequence,sequence[2]),null);
assert.ok(native.includes('result.put("attempt_status", "failed")'));
assert.ok(native.includes('result.put("load_basis", loadBasis)'));
assert.ok(native.includes('result.put("note", note)'));
const projector=fs.readFileSync(path.join(root,
 "app/src/main/java/com/z2846852/bodytrace/ViewProjector.java"),"utf8");
assert.ok(projector.includes('item.put("attempt_status"'));
assert.ok(projector.includes('item.put("load_basis"'));
assert.ok(projector.includes('item.put("note"'));
const gh=fs.readFileSync(path.join(root,
 "app/src/main/java/com/z2846852/bodytrace/GitHubApi.java"),"utf8");
assert.ok(gh.includes('"load_basis", "note", "source", "created_at"'));
// Compact chrome, always reachable save, and distinct muscle categories.
const featureStyles=fs.readFileSync(path.join(root,"app/src/main/assets/features.css"),"utf8");
assert.ok(html.includes('class="quick-head"')&&!html.includes('<h1>体迹'),
 "App chrome should be a single small line, not a tall page title");
assert.ok(html.includes('class="record-save-dock"')&&
 featureStyles.includes(".record-save-dock{position:fixed;"),
 "Save must be bottom-docked above the fixed navigation");
assert.ok(featureStyles.includes("env(safe-area-inset-bottom"),
 "Fixed action must account for device safe-area inset");
assert.ok(html.includes('id="trainingOverview"')&&html.includes('id="regionTrendGrid"'));
assert.ok(html.includes('id="muscleLegend"'));
const chartStart=features.indexOf("const dashboardRegions=");
const chartEnd=features.indexOf("function renderRegionSummary()",chartStart);
assert.ok(chartStart>=0&&chartEnd>chartStart);
const chartFuncs=vm.runInNewContext(features.slice(chartStart,chartEnd)+
 "\ncomputeRegionDashboard",{
  regionThemeColors:{胸:"#F28B82",肩:"#F2C66D",背:"#67B7F7",腿:"#B9A9DD"},
  isFailedAttempt:r=>r.attempt_status==="failed"||String(r.reps).trim()==="0",
  today:"2026-11-18",
  plus:(s,n)=>new Date(Date.parse(s+"T12:00:00Z")+n*86400000).toISOString().slice(0,10),
  parse:s=>new Date(s+"T12:00:00Z"),
  categoryForRow:r=>({
   adductor:"腿",abductor:"腿",chest_press:"胸",
   lateral_raise:"肩",row:"背"
  })[r.exercise_id],
  exerciseLabels:{adductor:"髋内收",abductor:"髋外展",chest_press:"胸推",
   lateral_raise:"侧平举",row:"划船"}
});
const chartStats=chartFuncs([
 {exercise_id:"adductor",session_date:"2026-11-18"},
 {exercise_id:"abductor",session_date:"2026-11-17"},
 {exercise_id:"chest_press",session_date:"2026-11-17"},
 {exercise_id:"lateral_raise",session_date:"2026-10-28"},
 {exercise_id:"row",session_date:"2026-10-18"},
 {exercise_id:"row",session_date:"2026-09-01"}
],"2026-11-18");
assert.deepEqual(Array.from(chartStats.cards,c=>c.region),["胸","肩","背","腿"]);
assert.deepEqual(Array.from(chartStats.cards,c=>c.total28),[1,1,0,2]);
assert.deepEqual(Array.from(chartStats.cards,c=>c.previous28),[0,0,1,0]);
assert.equal(chartStats.total28,4);
assert.equal(chartStats.activeDays,3);
assert.equal(chartStats.cards[3].last7,2);
assert.equal(chartStats.cards[2].last7,0);
assert.ok(features.includes('renderRegionDashboard();renderStrength();'),
 "The overview must refresh whenever training records refresh");
const targetsStart=features.indexOf("const muscleTargets=");
const targetsEnd=features.indexOf("const musclePaths=",targetsStart);
assert.ok(targetsStart>=0&&targetsEnd>targetsStart);
const targetFor=vm.runInNewContext(features.slice(targetsStart,targetsEnd)+
 "\ntargetForExercise");
assert.equal(targetFor("adductor"),"髋内收肌群");
assert.equal(targetFor("abductor"),"髋外展肌群");
assert.equal(targetFor("leg_extension"),"股四头肌");
assert.equal(targetFor("prone_leg_curl"),"腘绳肌群");
assert.equal(targetFor("custom_unknown"),null,"Never infer muscle target of an unknown action");
const pathsStart=features.indexOf("const musclePaths=");
const pathsEnd=features.indexOf("function muscleMacroRegion(",pathsStart);
const anatomy=vm.runInNewContext(features.slice(pathsStart,pathsEnd)+"\nmusclePaths");
assert.ok(anatomy.front.some(([label])=>label==="髋内收肌群"));
assert.ok(anatomy.back.some(([label])=>label==="髋外展肌群"));
assert.ok(anatomy.front.some(([label])=>label==="股四头肌"));
assert.ok(anatomy.back.some(([label])=>label==="腘绳肌群"));

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

// Git log renders every file's lines directly and uses textContent, not HTML injection.
const themeCSS=fs.readFileSync(path.join(root,"app/src/main/assets/features.css"),"utf8");
assert.ok(themeCSS.includes(".git-diff-added{background:")&&
 themeCSS.includes(".git-diff-removed{background:"));
assert.ok(!gitLogJS.includes('createElement("details")')&&
 !gitLogJS.includes('item("summary"'));
const settingsHTML=html.slice(html.indexOf('id="page-settings"'),
 html.indexOf('</section>',html.indexOf('id="page-settings"')));
assert.ok(settingsHTML.indexOf('id="gitHistoryPanel"')<
 settingsHTML.indexOf('SECURE CONNECTION'),
 "Git log should come before GitHub authorization");
assert.ok(settingsHTML.indexOf('可视化 JSON')<
 settingsHTML.indexOf('SECURE CONNECTION'),
 "GitHub authorization belongs at the bottom of the page");
assert.ok(settingsHTML.indexOf('class="settings-sync-strip"')>=0 &&
 settingsHTML.indexOf('id="syncSettings"')<settingsHTML.indexOf('id="gitHistoryPanel"'),
 "The one-tap sync action must be ABOVE Git log as the first control on Settings");
assert.equal((html.match(/id="syncSettings"/g)||[]).length,1,
 "Settings must expose exactly one GitHub sync button");
assert.ok(settingsHTML.indexOf('id="disconnect"')>settingsHTML.indexOf('SECURE CONNECTION'),
 "Disconnect stays in the credential section at the bottom");
const syncStyle=fs.readFileSync(path.join(root,"app/src/main/assets/features.css"),"utf8");
assert.ok(syncStyle.includes('.settings-sync-strip{display:flex;'));
assert.ok(html.includes('<span class="ico">≡</span>日志</button>'));
function logElement(tag){
 return {tagName:tag,children:[],className:"",textContent:"",style:{},
  handlers:{},disabled:false,
  classList:{contains:()=>true},
  append(...children){this.children.push(...children)},
  replaceChildren(){this.children=[]},
  addEventListener(name,handler){this.handlers[name]=handler}
 };
}
const logNodes={
 gitLogList:logElement("div"),gitLogStatus:logElement("p"),
 refreshGitLog:logElement("button"),"page-settings":logElement("section")
};
const logTab=logElement("button");
let refreshCount=0;
const nativeLog={readGitLog:()=>refreshCount++};
const logContext={
 state:{connected:true},
 window:{BodyTraceNative:nativeLog,bodyTraceReceive(){}},
 BodyTraceNative:nativeLog,
 document:{
  getElementById:id=>logNodes[id],
  createElement:logElement,
  querySelector:selector=>selector.includes('data-page="settings"')?logTab:null
 }
};
vm.runInNewContext(gitLogJS,logContext);
logTab.handlers.click();
assert.equal(refreshCount,1,"Opening the log page fetches latest commits");
logContext.window.bodyTraceReceive({type:"git_log",commits:[{
 sha:"1234567890123456789012345678901234567890",
 message:"record: add lateral raise",date:"2026-11-18T12:00:00+08:00",
 additions:2,deletions:1,files:[
  {filename:"data/daily/2026-11-18.json",status:"modified",additions:2,deletions:1,
   patch:"@@ -1,2 +1,3 @@\n- old value\n+ new value\n+ <script>alert('x')</script>\n unchanged\n\\ No newline at end of file"},
  {filename:"data/raw_inbox/test.json",status:"added",additions:1,deletions:0,patch:"",patch_truncated:false},
  {filename:"data/archive.json",status:"modified",additions:1,deletions:0,
   patch:"@@ -4 +4 @@\n+ sample",patch_truncated:true}
 ]
}]});
function descend(root){
 return [root,...root.children.flatMap(descend)];
}
const allLogNodes=descend(logNodes.gitLogList);
assert.equal(allLogNodes.filter(el=>el.tagName==="details").length,0,
 "Commit and file diffs must never be collapsed");
assert.equal(allLogNodes.filter(el=>el.className.includes("git-commit-file")).length,3);
assert.ok(allLogNodes.some(el=>el.className.includes("git-diff-added")&&
 el.textContent==="+ new value"));
assert.ok(allLogNodes.some(el=>el.className.includes("git-diff-removed")&&
 el.textContent==="- old value"));
assert.ok(allLogNodes.some(el=>el.className.includes("git-diff-hunk")&&
 el.textContent.startsWith("@@")));
assert.ok(allLogNodes.some(el=>el.className.includes("git-diff-meta")&&
 el.textContent.startsWith("\\ No newline")));
assert.ok(allLogNodes.some(el=>el.className.includes("git-diff-added")&&
 el.textContent.includes("<script>")),"Untrusted diff must be assigned as plain text");
assert.ok(allLogNodes.some(el=>el.className==="git-diff-unavailable"&&
 el.textContent.includes("GitHub 未提供")));
assert.ok(allLogNodes.some(el=>el.className==="git-diff-unavailable"&&
 el.textContent.includes("截断")));
logTab.handlers.click();
assert.equal(refreshCount,2,"Reopening log page must refetch instead of caching stale history");
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
 isFailedAttempt:r=>r.attempt_status==="failed"||String(r.reps).trim()==="0",
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

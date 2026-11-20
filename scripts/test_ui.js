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

const sleepJS=fs.readFileSync(path.join(root,"app/src/main/assets/sleep.js"),"utf8");
new vm.Script(sleepJS,{filename:"sleep.js"});
const sleepRecorder=fs.readFileSync(path.join(root,
 "app/src/main/java/com/z2846852/bodytrace/SleepRecorderService.java"),"utf8");
const sleepAnalyzer=fs.readFileSync(path.join(root,
 "app/src/main/java/com/z2846852/bodytrace/SleepAudioAnalyzer.java"),"utf8");
const sleepAnalysisService=fs.readFileSync(path.join(root,
 "app/src/main/java/com/z2846852/bodytrace/SleepAnalysisService.java"),"utf8");
const sleepStore=fs.readFileSync(path.join(root,
 "app/src/main/java/com/z2846852/bodytrace/SleepSessions.java"),"utf8");
for(const field of ["page-sleep","sleepStart","sleepStop","sleepStatus",
 "sleepHistory","sleepAnalyze","sleepThreshold","sleepMinSeconds",
 "sleepGapSeconds","sleepAnalysis","sleepStopPlayback"]){
 assert.ok(html.includes('id="'+field+'"'),"Missing sleep field "+field);
}
assert.ok(html.includes('data-page="sleep"'),"Sleep tab should be selectable");
for(const perm of ["RECORD_AUDIO","FOREGROUND_SERVICE_MICROPHONE",
 "FOREGROUND_SERVICE","WAKE_LOCK","POST_NOTIFICATIONS"]){
 assert.ok(manifest.includes('android.permission.'+perm),"Missing permission "+perm);
}
assert.ok(manifest.includes('android:foregroundServiceType="microphone"'));
assert.ok(manifest.includes('android:exported="false"'));
assert.ok(native.includes('readAsset("sleep.js")'));
for(const name of ["sleepStart()","sleepStop()","sleepStatus()","sleepAnalyze(",
 "sleepPlay(","sleepStopPlayback()","sleepDelete("]){
 assert.ok(native.includes(name),"Missing sleep native bridge "+name);
}
assert.ok(sleepRecorder.includes('startForeground(NOTIFICATION_ID,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)'));
assert.ok(sleepRecorder.includes('MediaRecorder.AudioEncoder.AAC'));
assert.ok(sleepRecorder.includes('PowerManager.PARTIAL_WAKE_LOCK'));
assert.ok(sleepRecorder.includes('START_NOT_STICKY'),"Microphone must be user initiated, not auto-restored");
assert.ok(sleepAnalyzer.includes('MediaExtractor')&&sleepAnalyzer.includes('MediaCodec'));
assert.ok(sleepAnalyzer.includes('Math.sqrt((double)squareSum/count)/32768.0'));
assert.ok(sleepAnalyzer.includes('short[] pcmBlock=new short[8192]'));
assert.ok(sleepAnalyzer.includes('ShortBuffer')&&sleepAnalyzer.includes('samples.get(pcmBlock,0,n)'),
 "Bulk PCM processing should avoid per-sample ByteBuffer.getShort()");
assert.ok(sleepAnalyzer.includes('now-lastReport>=1500'),"Progress heartbeat should report liveness");
assert.ok(sleepAnalysisService.includes('startForeground('));
assert.ok(sleepAnalysisService.includes('FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING'));
assert.ok(sleepAnalysisService.includes('SleepSessions.write(this,session)'));
assert.ok(sleepAnalysisService.includes('sendBroadcast(intent)'));
assert.ok(sleepAnalysisService.includes('publishProgress(id,pct)'));
assert.ok(sleepAnalysisService.includes('NotificationManager'));
assert.ok(manifest.includes('android:name=".SleepAnalysisService"'));
assert.ok(manifest.includes('android.permission.FOREGROUND_SERVICE_MEDIA_PROCESSING'));
assert.ok(manifest.includes('android.permission.FOREGROUND_SERVICE_DATA_SYNC'));
assert.ok(native.includes('registerReceiver(sleepAnalysisReceiver'));
assert.ok(native.includes('SleepAnalysisService.ACTION_START'));
assert.ok(native.includes('analysis_running'));
for(const field of ['sleepAnalysisProgress','sleepAnalysisTrack','sleepAnalysisPercent',
  'sleepAnalysisStage']) assert.ok(html.includes('id="'+field+'"'));
assert.ok(sleepJS.includes('updateAnalysisProgress('));
assert.ok(sleepJS.includes('analysis_running'));
assert.ok(sleepAnalyzer.includes('if(highCount>=minimum)'));
assert.ok(sleepAnalyzer.includes('int maxGap'));
assert.ok(sleepStore.includes('AtomicFile'),"Sessions must save atomically");
assert.ok(sleepStore.includes('sleep_audio')&&sleepStore.includes('sleep_sessions'));
assert.ok(!sleepStore.includes('mcp__GitHub__')&&!sleepJS.includes('GitHub'),
 "Personal audio must not be uploaded to workout GitHub sync");
assert.ok(sleepJS.includes('detectCandidates('));
assert.ok(sleepJS.includes('estimateNoiseFloor('));
assert.ok(sleepJS.includes('DEFAULT_ABOVE_BACKGROUND=2.0'));
assert.ok(sleepJS.includes('setThreshold('));
assert.ok(sleepJS.includes('thresholdBySession'));
assert.ok(sleepJS.includes('sleepSessionSelect'));
assert.ok(sleepJS.includes('applyLiveFilters('));
assert.ok(!sleepJS.includes('$(field).addEventListener("change",()=>{if(analysis&&selectedId)analyze()'),
 "Filter changes must be instantaneous and MUST NOT schedule native decoding");
assert.ok(sleepJS.includes('window.bodyTraceReceive=function(evt)'));

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
 primaryRegionForRow:r=>r.exercise_region||
  ({chest_press:"胸",lateral_raise:"肩",row:"背",
   leg_extension:"腿",adductor:"腿",custom_ar:"手臂"})[r.exercise_id]||"其他",
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
const regionStart=script.indexOf("function primaryRegionForRow(");
const regionEnd=script.indexOf("const exerciseLabels=",regionStart);
const primaryRegion=vm.runInNewContext(
 script.slice(regionStart,regionEnd)+"\nprimaryRegionForRow",{
  majorRegions:["胸","肩","背","腿"],
  exerciseRegionById:{
   custom_shoulderpullpending:"背",custom_bothwaysquat:"腿",
   leg_extension:"腿",custom_arm:"手臂"
  }
});
assert.equal(primaryRegion({exercise_id:"custom_shoulderpullpending",exercise_region:"其他"}),"背",
 "Catalog correction must override stale Other in old lat pulldown record");
assert.equal(primaryRegion({exercise_id:"custom_bothwaysquat",exercise_region:"其他"}),"腿",
 "Both Way Squat must be leg even when legacy row says Other");
assert.equal(primaryRegion({exercise_id:"leg_extension",exercise_region:"背"}),"背",
 "Real explicit classifications must retain priority");
assert.equal(primaryRegion({exercise_id:"custom_arm"}),"手臂");
assert.ok(features.includes('const region=categoryForRow(group.records.at(-1).row)||"其他"'));
const targetStart=features.indexOf("const muscleTargets={");
const targetEnd=features.indexOf("const muscleLabels=",targetStart);
const targets=vm.runInNewContext(features.slice(targetStart,targetEnd)+"\nmuscleTargets");
for(const [ex,zone] of [
 ["custom_shoulderpullpending","背阔肌"],["custom_bodyweightpullup","背阔肌"],
 ["custom_hacksquat","股四头肌"],["custom_bothwaysquat","股四头肌"],
 ["custom_pectoralmachine","胸大肌"]]){
 assert.equal(targets[ex],zone,"Known custom exercise missing from anatomy classification: "+ex);
}
assert.ok(features.includes('const regions = ["胸","肩","背","腿","其他"];'),
 "Macroscopic summary should expose only the four main categories plus Other");

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
assert.ok(features.includes('chart.append(svg,detail,recent)'));
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
assert.ok(features.includes('cy=yVal(failure?v.load:numeric)'));
assert.ok(features.includes('fill:failure?"#F07780":plotColor'));
assert.ok(features.includes('const domain=tracked.concat(attempts)'));
assert.ok(features.includes('v.date_basis==="report_date"'));
assert.ok(features.includes('v.load_basis==="bodyweight"'));
assert.ok(html.includes('id="recordLoadBasis"'));
assert.ok(html.includes('<option value="bodyweight">'));
assert.ok(html.includes('<option value="unspecified">'));
assert.ok(!features.includes('cy=failure?194:yVal(numeric)'));
assert.ok(features.includes('红点按尝试重量定位'));
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
assert.ok(gh.includes('"load_basis", "date_basis", "note", "source", "created_at"'));
// Four daily subjective intake flags are independent from food calories and
// from muscle-region training activity. The latest save wins for each date.
for(const id of ["intakeDate","intakeCreatine","intakeProtein","intakeCarbs",
 "intakeSugarOil","saveIntakeCheck","intakeCalendar","intakeCalendarScroll"]){
 assert.ok(html.includes('id="'+id+'"'),"Missing nutrition check-in element "+id);
}
const nutritionCss=fs.readFileSync(path.join(root,"app/src/main/assets/features.css"),"utf8");
for(const [key,color] of [["--intake-creatine","#B9A9DD"],
 ["--intake-protein","#EAF0F5"],["--intake-carbs","#62D5A2"],
 ["--intake-sugar-oil","#F28B82"]]){
 assert.ok(nutritionCss.includes(key+":"+color),
  "Nutrition flags must use requested color "+key);
}
const intakeStart=features.indexOf("function isIntakeCheckin(");
const intakeEnd=features.indexOf("function renderIntakeCalendar(",intakeStart);
assert.ok(intakeStart>=0&&intakeEnd>intakeStart);
const intakeHelpers=vm.runInNewContext(
 features.slice(intakeStart,intakeEnd)+"\n({isIntakeCheckin,latestIntakeByDate})");
const snapshots=[
 {id:"meal",date:"2026-11-19",food:"米饭",grams:200,kcal_per_100g:120},
 {id:"v1",entry_kind:"daily_checkin",date:"2026-11-19",
  created_at:"2026-11-19T12:00:00+08:00",
  intake_creatine:true,intake_protein_powder:true,intake_carbs:true,intake_sugar_oil:false},
 {id:"v2",entry_kind:"daily_checkin",date:"2026-11-19",
  created_at:"2026-11-19T12:05:00+08:00",
  intake_creatine:false,intake_protein_powder:true,intake_carbs:false,intake_sugar_oil:true},
 {id:"old",entry_kind:"daily_checkin",date:"2026-11-18",
  created_at:"2026-11-18T11:00:00+08:00",
  intake_creatine:true,intake_protein_powder:false,intake_carbs:false,intake_sugar_oil:false}
];
const latest=intakeHelpers.latestIntakeByDate(snapshots);
assert.equal(latest.size,2);
assert.equal(latest.get("2026-11-19").id,"v2",
 "Latest snapshot must override earlier checkboxes, including unchecking");
assert.equal(latest.get("2026-11-19").intake_creatine,false);
assert.equal(latest.get("2026-11-18").intake_creatine,true);
assert.equal(intakeHelpers.isIntakeCheckin(snapshots[0]),false);
assert.ok(features.includes('intakeDraftDirty&&!force&&intakeLoadedDate===date'),
 "Remote sync must not discard unsubmitted checkbox edits");
assert.ok(features.includes('entry_kind:"daily_checkin"'));
assert.ok(features.includes('BodyTraceNative.saveNutrition(JSON.stringify(event))'));
const nativeNutrition=fs.readFileSync(path.join(root,
 "app/src/main/java/com/z2846852/bodytrace/MainActivity.java"),"utf8");
assert.ok(nativeNutrition.includes('if ("daily_checkin".equals(input.optString("entry_kind")))'));
assert.ok(nativeNutrition.includes('input.get(key) instanceof Boolean'));
const apiNutrition=fs.readFileSync(path.join(root,
 "app/src/main/java/com/z2846852/bodytrace/GitHubApi.java"),"utf8");
assert.ok(apiNutrition.includes('"entry_kind", "intake_creatine", "intake_protein_powder"'));
assert.ok(apiNutrition.includes('"intake_carbs", "intake_sugar_oil"'));
const projectionNutrition=fs.readFileSync(path.join(root,
 "app/src/main/java/com/z2846852/bodytrace/ViewProjector.java"),"utf8");
assert.ok(projectionNutrition.includes('if ("daily_checkin".equals(item.optString("entry_kind"))) continue;'));
// Workout correction is append-only, offline-safe and applied before charts.
const editing=fs.readFileSync(path.join(root,
 "app/src/main/java/com/z2846852/bodytrace/WorkoutEdits.java"),"utf8");
const apiEdits=fs.readFileSync(path.join(root,
 "app/src/main/java/com/z2846852/bodytrace/GitHubApi.java"),"utf8");
const projectorEdits=fs.readFileSync(path.join(root,
 "app/src/main/java/com/z2846852/bodytrace/ViewProjector.java"),"utf8");
for(const word of ["workout_edits","workout_edit","target_id","editWorkout("]){
 assert.ok(native.includes(word),"Native workout edits missing "+word);
}
assert.ok(native.includes('if (!key.equals("workouts") && !key.equals("measurements")'));
assert.ok(native.includes('new String[]{"workouts", "measurements", "nutrition", "workout_edits"}'));
assert.ok(native.includes('plain.putPending(pending);')&&native.includes('plain.putDays(days);'));
assert.ok(apiEdits.includes('isWorkoutEdit ? "workout_edits" : "workouts"'));
assert.ok(apiEdits.includes('"target_id", "action", "load_key", "load_kg"'));
assert.ok(projectorEdits.includes('WorkoutEdits.apply(day.optJSONArray("workouts")'));
assert.ok(editing.includes('rows.remove(target);'));
assert.ok(editing.includes('UUID.nameUUIDFromBytes('));
assert.ok(editing.includes('rows.put(target,revised);'));
assert.ok(editing.includes('new JSONObject(source.toString())'));
assert.ok(editing.includes('if(reps==0)revised.put("attempt_status","failed")'));
assert.ok(html.includes('const recentDates=[...byDate.keys()].sort((a,b)=>b.localeCompare(a)).slice(0,10)'));
assert.ok(html.includes('r.exercise_id===exerciseId'));
assert.ok(html.includes('className="exercise-history"'));
assert.ok(html.includes('className="exercise-history-date"'));
assert.ok(html.includes('let activeWorkoutEdit=null'));
for(const id of ["workoutEditOverlay","workoutEditKg","workoutEditReps",
 "workoutEditCopies","workoutEditNote","workoutEditSave","workoutEditDelete",
 "workoutEditClose"]){
 assert.ok(html.includes('id="'+id+'"'),"Missing workout editor field: "+id);
}
assert.ok(html.includes('BodyTraceNative.editWorkout(JSON.stringify(payload))'));
assert.ok(html.includes('case "workout_edit_local_saved":{'));
assert.ok(features.includes('className="secondary mini strength-edit-action"'));
assert.ok(features.includes('editAction.onclick=()=>window.BodyTraceWorkoutEditor?.open(v)'));
const editStyle=fs.readFileSync(path.join(root,"app/src/main/assets/features.css"),"utf8");
assert.ok(editStyle.includes('.workout-edit-overlay[hidden]{display:none!important}'));
assert.ok(editStyle.includes('.exercise-history-date-head{display:flex'));
// Sleep audio import uses SAF URI grants + streaming copy (not full-file RAM)
// and samples RMS/peak levels for whole-night waveforms.
const sleepVisualization=fs.readFileSync(path.join(root,
 "app/src/main/assets/sleep_visualization.js"),"utf8");
new vm.Script(sleepVisualization,{filename:"sleep_visualization.js"});
assert.ok(native.includes('readAsset("sleep_visualization.js")'));
assert.ok(native.includes("Intent.ACTION_OPEN_DOCUMENT"));
assert.ok(native.includes('choose.setType("audio/*")'));
assert.ok(native.includes('PICK_SLEEP_AUDIO_REQUEST=7204'));
assert.ok(native.includes('takePersistableUriPermission('),
 "Import needs permanent read-only document grants");
assert.ok(native.includes('extractor.setDataSource(this,uri,null)'),
 "Import should inspect source metadata without copying");
assert.ok(!native.includes('new FileOutputStream(dest)'),
 "Imported M4A must never be copied into app private files");
assert.ok(native.includes('getContentResolver().query(uri'));
assert.ok(native.includes('knownSize>SLEEP_IMPORT_MAX_BYTES'));
assert.ok(native.includes('reportedStart.trim()'));
assert.ok(native.includes('.put("audio_extension",ext)'));
assert.ok(native.includes('MediaExtractor extractor=new MediaExtractor()'));
assert.ok(native.includes('"sleep_imported"'));
assert.ok(native.includes('msg.put("copied",false)'));
assert.ok(native.includes('"sleep_removed"'));
assert.ok(native.includes('SleepSessions.configurePlayer('));
assert.ok(sleepStore.includes('configureExtractor('));
assert.ok(sleepStore.includes('configurePlayer('));
assert.ok(sleepStore.includes('source_uri'));
assert.ok(sleepStore.includes('external_file'));
assert.ok(sleepAnalysisService.includes('SleepAudioAnalyzer.decodeEnvelope('));
assert.ok(sleepAnalyzer.includes('decodeEnvelope(Context context,JSONObject session,IntConsumer progress)'));
assert.ok(sleepJS.includes('pendingAutoAnalyzeId'));
assert.ok(sleepJS.includes('pendingRemoveId'));
assert.ok(sleepJS.includes('if(!analysisStarting&&!loadingCachedId)') ||
  sleepJS.includes('!analysisStarting&&!loadingCachedId'),
 "Do not unlock Analyze button while loading cached envelope");
assert.ok(sleepJS.includes('移出列表（保留原文件）'));
assert.ok(html.includes('不会复制 400 MB 原音频'));
assert.ok(sleepStore.includes('static File importedAudio('));
assert.ok(sleepStore.includes('"audio_extension"'));
assert.ok(sleepStore.includes('"original_name","duration_ms"'));
assert.ok(sleepAnalyzer.includes('decodeEnvelope(File input,IntConsumer progress)'));
assert.ok(sleepAnalyzer.includes('levels.add(dbfs(squares,count))'));
assert.ok(sleepAnalyzer.includes('peaks.add(peakDbfs(peak))'));
assert.ok(native.includes('answer.put("levels_dbfs",levels)'));
assert.ok(native.includes('answer.put("peak_levels_dbfs",peaks)'));
assert.ok(sleepAnalysisService.includes('session.put("peak_levels_dbfs",peaks)'),
 "Foreground analyzer must persist peak envelope locally");
assert.ok(html.includes('id="sleepImport"'));
assert.ok(html.includes('id="sleepImportStarted"'));
assert.ok(html.includes('id="sleepWaveCanvas"'));
assert.ok(html.includes('id="sleepHourlyActivity"'));
assert.ok(html.includes('id="sleepSoundStats"'));
assert.ok(sleepJS.includes('bridge().sleepImport('));
assert.ok(sleepJS.includes('events.slice(0,eventLimit)'));
assert.ok(sleepJS.includes('eventLimit+=80'));
assert.ok(sleepVisualization.includes('getContext("2d")'));
assert.ok(sleepVisualization.includes('requestAnimationFrame('));
assert.ok(sleepVisualization.includes('for(let px=0;px<plotWidth;px++)'));
assert.ok(sleepVisualization.includes('Math.max(240,Math.round(bounds.width||320))'));
assert.ok(sleepVisualization.includes('window.BodyTraceSleepVisual={'));
assert.ok(sleepVisualization.includes('pointerdown')&&sleepVisualization.includes('pointermove'));
assert.ok(sleepVisualization.includes('touch-action:none')||
  fs.readFileSync(path.join(root,"app/src/main/assets/features.css"),"utf8")
    .includes('#sleepWaveCanvas{width:100%;height:260px;display:block;touch-action:none'));
assert.ok(sleepVisualization.includes('COLORS.threshold')&&sleepVisualization.includes('"#ff536d"'));
assert.ok(sleepVisualization.includes('axisById=new Map()'));
assert.ok(sleepVisualization.includes('gesture.mode==="vertical-pan"'));
assert.ok(sleepVisualization.includes('gesture.mode==="vertical-zoom"'));
assert.ok(sleepVisualization.includes('backgroundDb'));
assert.ok(sleepVisualization.includes('sleepPlaySequence('));
assert.ok(native.includes('sleepPlaySequence(String sessionId,'));
assert.ok(native.includes('playNextRange(')&&native.includes('setOnSeekCompleteListener'));
for(const id of ['sleepSkipQuiet','sleepPlaybackStatus','sleepPreviousEvent','sleepNextEvent',
 'sleepNoiseWarning','sleepNoiseHint','sleepSessionSelect','sleepThresholdDown',
 'sleepThresholdUp','sleepThresholdReset','sleepThresholdRelative','sleepBaselineLabel',
 'sleepQuickSummary','sleepLibraryCount','sleepEventCount'])assert.ok(html.includes('id="'+id+'"'),id);
assert.ok(html.includes('step="0.1"'));
assert.ok(html.indexOf('id="sleepWaveCanvas"')<html.indexOf('id="sleepThreshold"'),
 "Threshold must sit immediately BELOW the always-visible waveform");
assert.ok(html.indexOf('id="sleepThreshold"')<html.indexOf('id="sleepPlaySelection"'));
assert.ok(html.includes('<details class="sleep-collection"'));
assert.ok(html.includes('<details class="sleep-events-details"'));
assert.ok(html.includes('<details class="sleep-extras"'));
assert.ok(fs.readFileSync(path.join(root,"app/src/main/assets/features.css"),"utf8")
 .includes('#page-sleep #sleepWaveCanvas{height:208px}'));

assert.ok(!html.includes('data-page="raw"'),"Remove Raw from bottom tabs");
assert.ok(html.includes('id="rawSettingsAccordion"'));
assert.ok(html.indexOf('id="page-settings"')<html.indexOf('id="page-raw"'));
assert.ok(html.indexOf('id="page-raw"')<html.indexOf('</section>',html.indexOf('id="page-settings"')));
// Global default-on history visibility is persisted to Android SharedPreferences
// (not only in JS memory) and applies to ALL selected days/movements.
assert.ok(html.includes('id="toggleHistory"'));
assert.ok(html.includes('let showWorkoutHistory=true;'));
assert.ok(html.includes('if(showWorkoutHistory&&recentDates.length)'));
assert.ok(html.includes('case "ui_preferences":'));
assert.ok(html.includes('window.BodyTraceNative.setWorkoutHistoryVisible(showWorkoutHistory)'));
assert.ok(native.includes('getSharedPreferences("bodytrace_ui_prefs",MODE_PRIVATE)'));
assert.ok(native.includes('.getBoolean("show_workout_history",true)'));
assert.ok(native.includes('.edit().putBoolean("show_workout_history",visible).commit()'));
assert.ok(native.includes('sendUiPreferences();'));
assert.ok(native.includes('@JavascriptInterface public void setWorkoutHistoryVisible(boolean visible)'));
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
// Action creation/removal were previously buried in the manager: ensure both
// now have explicit adjacent buttons directly under the exercise selector.
assert.ok(html.includes('id="quickAddExercise"'));
assert.ok(html.includes('id="manageExercises">－ 删除 / 恢复动作'));
assert.ok(catalogJS.includes('$("quickAddExercise").onclick=()=>openManager(true)'));
assert.ok(catalogJS.includes('$("manageExercises").onclick=()=>openManager(false)'));
assert.ok(catalogJS.includes('if(typeof window.BodyTraceRenderFeatures==="function")window.BodyTraceRenderFeatures();'));
assert.ok(catalogJS.includes('indexData();'));

assert.ok(catalogJS.includes('option.textContent="【"+overviewGroup(entry.region)+"】"+entry.label'));
assert.ok(catalogJS.includes('compareUsage')&&catalogJS.includes('config.sort_mode==="region"'));
assert.ok(catalogJS.includes('const overviewGroup=region=>["胸","肩","背","腿"]'));
assert.ok(catalogJS.includes('indexData();')&&
 catalogJS.includes('window.BodyTraceRenderFeatures()')&&
 features.includes('window.BodyTraceRenderFeatures=renderAllFeatures;'),
 "Catalog sync must redraw through the exported feature callback");
assert.ok(!html.includes('<option value="手臂">')&&!html.includes('<option value="核心">'),
 "Record group selector must present four primary categories plus Other");
assert.ok(projection.includes('final String[] areas = {"胸","肩","背","腿","其他"};'));

assert.ok(catalogJS.includes('saveCatalog(JSON.stringify(config))'));
assert.ok(html.includes('id="recordSortMode"')&&html.includes('id="exerciseManager"'));
assert.ok(html.includes('id="recordGroup"')&&html.includes('id="resetTrainingDefault"'));
assert.ok(catalogJS.includes('sorted.filter(a=>overviewGroup(a.region)===group)'));
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
const mixedSources=[
 {id:"native-1",exercise_id:"chest_press",session_date:"2026-11-19",
  created_at:"2026-11-19T14:36:00+08:00",load_kg:"40",reps:"8"},
 {id:"manual-smith-1",exercise_id:"smith_bench",session_date:"2026-11-19",
  load_kg:"25",reps:"10"},
 {id:"manual-smith-2",exercise_id:"smith_bench",session_date:"2026-11-19",
  load_kg:"30",reps:"5",load_basis:"unspecified"},
 {id:"old-native",exercise_id:"row",session_date:"2026-11-18",
  created_at:"2026-11-18T22:00:00+08:00",load_kg:"45",reps:"10"}
];
const updated=sorting(mixedSources);
assert.deepEqual(Array.from(updated,g=>g.id),["smith_bench","chest_press","row"],
 "Rows appended on the same date must outrank older native timestamps");
assert.equal(updated[0].latestRow.id,"manual-smith-2",
 "Newest saved same-day set must be identified without created_at");
const compact=vm.runInNewContext(
 features.slice(features.indexOf("function compactStrengthSet("),
  features.indexOf("function renderStrength(){"))+"\ncompactStrengthSet",
 {validNum:x=>x!==""&&x!=null&&Number.isFinite(Number(x)),
  isFailedAttempt:r=>r.attempt_status==="failed"||String(r.reps).trim()==="0"});
assert.equal(compact(updated[0].latestRow,"smith_bench"),"30 kg × 5 次");
assert.ok(features.includes('const byDayPoints=new Map()'));
assert.ok(features.includes('const cx=pointX(v)'));
assert.ok(features.includes('pointSelectors[pointSelectors.length-1].select()'));
assert.ok(features.includes('strength-recent-sets'));
assert.ok(!features.includes('（重量标注待核实）'),
 "Unspecified recording basis must not overwhelm user-facing chart labels");

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
  addEventListener(kind,fn){this.listeners[kind]=fn},
  focus(){this.focused=true},scrollIntoView(){this.scrolled=true}
 };
}
const nodeIds=["recordGroup","recordExercise","recordSortMode","exerciseManageList",
 "suggestedLoad","manageExercises","quickAddExercise","closeExerciseManager","exerciseManager",
 "addCustomExercise","customActionName","customActionRegion","recordKg","recordReps",
 "recordSets","recordDate","weightLabel"];
const nodes=Object.fromEntries(nodeIds.map(id=>[id,element(
 ["recordGroup","recordExercise","recordSortMode"].includes(id)?"select":"div")]));
const catalogContext={
 state:{rows:[]},
 indexData(){},renderAllFeatures(){},
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
catalogContext.BodyTraceNative=catalogContext.window.BodyTraceNative;
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
// Functional test for new easy-to-find per-exercise add button.
catalogContext.trainingFormDirty=false;
catalogContext.recordExerciseTouched=false;
nodes.recordGroup.value="背";
nodes.quickAddExercise.onclick();
assert.equal(nodes.exerciseManager.hidden,false);
assert.equal(nodes.customActionRegion.value,"背");
assert.equal(nodes.customActionName.focused,true);
nodes.customActionName.value="坐姿划船 · 用户自建";
nodes.addCustomExercise.onclick();
const newId=nodes.recordExercise.value;
assert.ok(newId.startsWith("custom_"));
assert.equal(catalogContext.window.BodyTraceExerciseCatalog.region(newId),"背");
assert.ok(selectIds().includes(newId));
assert.equal(catalogContext.window.BodyTraceExerciseCatalog.getConfig().custom.length,1);
// Removing the self-created movement is a catalog operation, not a workout deletion.
nodes.manageExercises.onclick();
const selectedManagerRow=nodes.exerciseManageList.children.find(x=>x.dataset.exerciseId===newId);
assert.ok(selectedManagerRow&&selectedManagerRow.scrolled);
const removeFrom=row=>row.children.at(-1).children.find(b=>b.textContent==="删除"||b.textContent==="确认删除");
removeFrom(selectedManagerRow).onclick();
const confirmationRow=nodes.exerciseManageList.children.find(x=>x.dataset.exerciseId===newId);
removeFrom(confirmationRow).onclick();
assert.equal(catalogContext.window.BodyTraceExerciseCatalog.getConfig().custom.length,0);
assert.ok(!selectIds().includes(newId));
console.log("BodyTrace UI tests passed: catalog recent/region sorting, add/hide/restore/delete actions, leg extension, body schematic, wheel and fixed Release signing.");


// Sleep UX regression: an imported document is analyzed once, stale status
// refreshes cannot reenable buttons, and cached waveforms require no second decode.
{
  const sleepNodes=new Map(), calls={decode:[],cached:[],delete:[]};
  function node(tag="div"){
    return {
      tagName:tag, value:"",textContent:"",children:[],hidden:false,disabled:false,
      classList:{add(){},remove(){},toggle(){}},
      append(...items){this.children.push(...items)},
      replaceChildren(){this.children=[]},
      addEventListener(name,fn){this.handlers??={};this.handlers[name]=fn},
      focus(){}
    };
  }
  const el=id=>{
    if(!sleepNodes.has(id))sleepNodes.set(id,node());
    return sleepNodes.get(id);
  };
  el("sleepThreshold").value="-40";
  el("sleepMinSeconds").value="5";
  el("sleepGapSeconds").value="1";
  const sleepWindow={
    bodyTraceReceive(){},
    BodyTraceNative:{
      sleepAnalyze(...args){calls.decode.push(args)},
      sleepReadCached(...args){calls.cached.push(args)},
      sleepDelete(id){calls.delete.push(id)},
      sleepStatus(){}
    }
  };
  const sleepContext={
    window:sleepWindow,
    document:{getElementById:el,createElement:node,querySelector:()=>node()},
    toast(){}
  };
  vm.runInNewContext(sleepJS,sleepContext);
  const input={id:"imported_doc",status:"completed",external_file:true,
    source:"saf-document",duration_ms:28800000,bytes:419430400,
    original_name:"8h.m4a",levels_cached:false,started_ms:1795090000000};
  sleepWindow.bodyTraceReceive({type:"sleep_imported",id:input.id,bytes:input.bytes});
  sleepWindow.bodyTraceReceive({type:"sleep_status",recording:false,
    analysis_running:false,sessions:[input]});
  assert.equal(calls.decode.length,1,"Import should start first analysis automatically");
  assert.equal(el("sleepAnalyze").disabled,true);
  sleepWindow.bodyTraceReceive({type:"sleep_status",recording:false,
    analysis_running:false,sessions:[input]});
  assert.equal(calls.decode.length,1,"Queued status must not restart analysis");
  assert.equal(el("sleepAnalyze").disabled,true,"Stale status must not unlock button");
  sleepWindow.bodyTraceReceive({type:"sleep_analysis_progress",
    id:input.id,percent:7,updated_ms:1795090000000});
  assert.equal(el("sleepAnalysisTrack").value,7);
  assert.equal(el("sleepAnalysisProgress").hidden,false);
  sleepWindow.bodyTraceReceive({type:"sleep_status",recording:false,
    analysis_running:true,analysis_id:input.id,analysis_percent:9,sessions:[input]});
  assert.equal(el("sleepAnalyze").disabled,true);
  // The service finished while the UI missed its tiny completion broadcast;
  // status + saved envelope must recover the chart without re-decoding M4A.
  const cached={...input,levels_cached:true};
  sleepWindow.bodyTraceReceive({type:"sleep_status",recording:false,
    analysis_running:false,sessions:[cached]});
  assert.equal(calls.cached.length,1,"Completed envelope should load from local cache");
  assert.equal(calls.decode.length,1,"Do not re-decode after completed work");
  assert.equal(el("sleepAnalyze").disabled,true,"Cache read should lock the button");
  sleepWindow.bodyTraceReceive({type:"sleep_status",recording:false,
    analysis_running:false,sessions:[cached]});
  assert.equal(calls.cached.length,1,"Concurrent status must not duplicate cache fetch");
  assert.equal(el("sleepAnalyze").disabled,true);
  const results={type:"sleep_analysis",id:input.id,started_ms:1795090000000,
    total_seconds:2,threshold_dbfs:-40,minimum_seconds:5,
    events:[],levels_dbfs:[-50,-20],peak_levels_dbfs:[-43,-10]};
  sleepWindow.bodyTraceReceive(results);
  assert.equal(el("sleepThreshold").value,"-48.0",
   "P20(-50 dBFS)+2 dB should be the adaptive default");
  assert.equal(sleepWindow.BodyTraceAudioFilter.estimateNoiseFloor([-45,-45,-45,-20,-5]),-45);
  assert.match(el("sleepBaselineLabel").textContent,/本晚背景估计 -50.0 dBFS/);
  el("sleepThresholdUp").onclick();
  assert.equal(el("sleepThreshold").value,"-47.9");
  el("sleepThresholdDown").onclick();
  assert.equal(el("sleepThreshold").value,"-48.0");
  el("sleepThreshold").value="-15.5";
  el("sleepThreshold").handlers.input();
  assert.equal(el("sleepThreshold").value,"-15.5");
  el("sleepThresholdReset").onclick();
  assert.equal(el("sleepThreshold").value,"-48.0");
  assert.equal(el("sleepAnalysisProgress").hidden,true);
  assert.match(el("sleepAnalyze").textContent,/已生成波形/);
  el("sleepAnalyze").onclick();
  assert.equal(calls.cached.length,2,"Refilter must reuse the local envelope");
  assert.equal(calls.decode.length,1);
  assert.equal(el("sleepAnalyze").disabled,true);
  sleepWindow.bodyTraceReceive(results);
  // External removal is a two-tap confirmation and never a content-URI delete.
  function deleteControl(){
    const card=el("sleepHistory").children[0];
    return card.children.at(-1).children[1];
  }
  assert.match(deleteControl().textContent,/保留原文件/);
  deleteControl().onclick();
  assert.match(deleteControl().textContent,/确认移出/);
  deleteControl().onclick();
  assert.deepEqual(calls.delete,["imported_doc"]);
  console.log("Sleep UX tests passed: zero-copy auto analysis, status race, cache recovery and safe removal.");
}


// Exact per-second filter and waveform gesture/skip-play regression.
{
  const begin=sleepJS.indexOf(" function detectCandidates(");
  const finish=sleepJS.indexOf(" function applyLiveFilters(",begin);
  assert.ok(begin>0&&finish>begin);
  const detect=vm.runInNewContext(sleepJS.slice(begin,finish)+"\ndetectCandidates");
  const values=[-60,-32,-34,-61,-33,-35,-70,-65,-30,-30,-30];
  const peaks=values.map(x=>x+5);
  const merged=detect(values,peaks,-40,4,1);
  assert.equal(merged.length,1);
  assert.equal(merged[0].start_sec,1);
  assert.equal(merged[0].end_sec,6);
  assert.equal(merged[0].active_sec,4,
    "Allowed gaps join a span but cannot be counted toward minimum");
  assert.equal(detect(values,peaks,-40,4,0).length,0);
  assert.equal(detect(values,peaks,-40,2,0).length,3);
  assert.equal(detect(values,peaks,-20,1,5).length,0);

  const nodes=new Map(),eventsByName={},calls=[],redLines=[];
  const fakeCtx={
    setTransform(){},save(){},restore(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},
    arc(){},fill(){},fillText(){},setLineDash(){},
    measureText(v){return {width:v.length*6}},
    stroke(){if(this.strokeStyle==="#ff536d")redLines.push(true)}
  };
  function node(tag="div"){
    return {tagName:tag,hidden:false,disabled:false,checked:false,value:"",
      textContent:"",children:[],style:{},dataset:{},
      classList:{toggle(){},add(){},remove(){}},
      append(...children){this.children.push(...children)},
      replaceChildren(){this.children=[]},
      setAttribute(){},scrollIntoView(){},
      addEventListener(name,fn){this.handlers??={};this.handlers[name]=fn}
    };
  }
  function get(id){
    if(!nodes.has(id))nodes.set(id,node());
    return nodes.get(id);
  }
  const canvas=get("sleepWaveCanvas");
  canvas.width=360;canvas.height=260;
  canvas.getContext=()=>fakeCtx;
  canvas.getBoundingClientRect=()=>({width:360,left:0});
  canvas.setPointerCapture=()=>{};
  canvas.addEventListener=(name,fn)=>{eventsByName[name]=fn};
  get("sleepSkipQuiet").checked=true;
  const fakeWindow={devicePixelRatio:1,bodyTraceReceive(){},addEventListener(){},
    BodyTraceNative:{sleepPlaySequence(...args){calls.push(args)}}};
  vm.runInNewContext(sleepVisualization,{
    window:fakeWindow,document:{
      getElementById:get,querySelectorAll(){return []},
      createElement:node
    },
    requestAnimationFrame(fn){fn()},
    ResizeObserver:undefined,Date,Math,Number
  });
  const levels=Array.from({length:600},()=>-70);
  const levelPeaks=levels.map(x=>x+7);
  for(let i=20;i<30;i++){levels[i]=-24;levelPeaks[i]=-16;}
  for(let i=200;i<220;i++){levels[i]=-22;levelPeaks[i]=-12;}
  const segments=detect(levels,levelPeaks,-40,5,1);
  fakeWindow.bodyTraceReceive({type:"sleep_analysis",id:"night1",date_basis:"imported_at",
    levels_dbfs:levels,peak_levels_dbfs:levelPeaks,threshold_dbfs:-40,
    minimum_seconds:5,gap_seconds:1,events:segments});
  assert.ok(redLines.length>0,"Red reference must be drawn on the actual canvas");
  assert.equal(fakeWindow.BodyTraceSleepVisual.state().span,600);
  // Tap positions cursor, whereas a pointer drag pans without triggering a tap.
  function pointer(kind,id,x,y=100){
    eventsByName[kind]({pointerId:id,clientX:x,clientY:y});
  }
  pointer("pointerdown",1,120);pointer("pointerup",1,120);
  assert.ok(fakeWindow.BodyTraceSleepVisual.state().cursor>=0);
  const beforeHorizontal=fakeWindow.BodyTraceSleepVisual.state();
  pointer("pointerdown",2,115);pointer("pointerdown",3,215);
  pointer("pointermove",3,280);
  assert.ok(fakeWindow.BodyTraceSleepVisual.state().span<600,
    "Pinch spreading must zoom in the timeline");
  assert.equal(fakeWindow.BodyTraceSleepVisual.state().axisMin,beforeHorizontal.axisMin,
    "Horizontal gestures MUST NOT rescale the vertical dB axis");
  assert.equal(fakeWindow.BodyTraceSleepVisual.state().axisMax,beforeHorizontal.axisMax);
  pointer("pointerup",2,115);pointer("pointerup",3,280);
  pointer("pointerdown",4,160);pointer("pointermove",4,90);pointer("pointerup",4,90);
  assert.ok(fakeWindow.BodyTraceSleepVisual.state().start>0,
    "One-finger drag must pan a zoomed waveform");
  const beforeVertical=fakeWindow.BodyTraceSleepVisual.state();
  pointer("pointerdown",5,110,105);pointer("pointerdown",6,240,105);
  pointer("pointermove",5,110,65);
  pointer("pointermove",6,240,65);
  assert.notEqual(fakeWindow.BodyTraceSleepVisual.state().axisMin,beforeVertical.axisMin,
    "Intentional two-finger vertical swipe changes the locked dB axis");
  assert.equal(fakeWindow.BodyTraceSleepVisual.state().span,beforeVertical.span,
    "Vertical swipe must not change horizontal time zoom");
  pointer("pointerup",5,110,65);pointer("pointerup",6,240,65);
  fakeWindow.BodyTraceSleepVisual.setCursor(0);
  fakeWindow.BodyTraceSleepVisual.playFromCursor();
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"night1");
  assert.equal(calls[0][2],true);
  assert.deepEqual(JSON.parse(calls[0][1]),[[20,30],[200,220]],
    "Skip mode must play only candidates passing threshold+duration+gap");
  get("sleepSkipQuiet").checked=false;
  fakeWindow.BodyTraceSleepVisual.playFromCursor();
  assert.deepEqual(JSON.parse(calls[1][1]),[[0,600]],
    "Ordinary mode must play continuously from cursor, without arbitrary 15s cap");
  console.log("Sleep gesture/filter/skip regression passed.");
}

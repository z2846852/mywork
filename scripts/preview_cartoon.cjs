// Chromium visual/interaction smoke test for the actual Android WebView UI.
// Sample values are synthetic, NOT written to the user's GitHub health JSON.
"use strict";
const {chromium}=require("playwright");
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,"app/src/main/assets",name),"utf8");
let html=read("index.html");
html=html.replace("</head>","<style>"+read("features.css")+"</style></head>");
html=html.replace("</body>","<script>"+read("wheel.js")+"\n"+read("features.js")+"\n"+read("exercise_catalog.js")+"\n"+read("git_log.js")+"\n"+read("sleep.js")+"\n"+read("sleep_visualization.js")+"\n"+read("voice_lab.js")+"</script></body>");
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const page=await browser.newPage({viewport:{width:390,height:900},deviceScaleFactor:2});
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
  await page.setContent(html,{waitUntil:"load"});
  const headerHeight=await page.locator(".quick-head").evaluate(x=>x.getBoundingClientRect().height);
  if(headerHeight>60)throw Error("Header is not compact: "+headerHeight);
  await page.evaluate(()=>{
   const previewDays=[
    {schema_version:2,date:"2026-04-15",
     workouts:[{id:"demo-row",exercise_id:"row",reps:8,load_kg:27.5}],
     nutrition:[],
     measurements:[{id:"demo-measurement-april",weight_kg:68.5,shoulder_cm:112.1,chest_cm:90.2,
      waist_cm:84,hip_cm:93,upper_arm_cm:27.5,thigh_cm:53.9,calf_cm:39.5}]},
    {schema_version:2,date:"2026-11-14",
     workouts:[{id:"demo-chest",exercise_id:"chest_press",reps:12,load_kg:35}],nutrition:[],measurements:[]},
    {schema_version:2,date:"2026-11-17",workouts:[
      {id:"demo-shoulder",exercise_id:"lateral_raise",reps:10,load_kg:23},
      {id:"demo-leg",exercise_id:"adductor",reps:15,load_kg:25}
     ],nutrition:[],
     measurements:[{id:"demo-measurement-november",weight_kg:74,shoulder_cm:112.1,chest_cm:89,
      waist_cm:89,hip_cm:95,upper_arm_cm:28.5,thigh_cm:54.5,calf_cm:39.5}]}
   ];
   window.__previewDays=previewDays;
   window.bodyTraceReceive({type:"data",cached:true,days:previewDays});
   navigate("body");
  });
  const bodies=await page.locator("#bodyMuscleView .muscle-person svg").count();
  if(bodies!==2)throw Error("Expected front/back simple body outlines: "+bodies);
  const inner=await page.locator('#bodyMuscleView [aria-label^="髋内收肌群"]').count();
  const outer=await page.locator('#bodyMuscleView [aria-label^="髋外展肌群"]').count();
  if(inner<2||outer<2)throw Error("Inner thigh and outer hip are not separate regions: "+inner+"/"+outer);
  const muscleChoice=page.locator("#muscleLegend .muscle-legend-btn").filter({hasText:"髋外展肌群"});
  await muscleChoice.click();
  const regionDetail=await page.$eval("#muscleDetail",x=>x.textContent);
  if(!regionDetail.startsWith("髋外展肌群"))throw Error("Muscle legend selection failed");
  const hipColor=await muscleChoice.evaluate(el=>getComputedStyle(el).getPropertyValue("--muscle-color").trim());
  if(hipColor!=="#B9A9DD")throw Error("Hip abductor color should use the leg violet: "+hipColor);
  const dates=await page.$eval("#avatarMeasureDate",e=>e.options.length);
  if(dates!==2)throw Error("Body measurement history failed: "+dates);
  if(await page.locator("#avatarPicture").count())throw Error("Old cartoon still visible");
  await page.screenshot({path:"bodytrace-cartoon-preview.png",fullPage:true});
  await page.evaluate(()=>{
   window.BodyTraceNative={setUiNavigation:p=>window.__savedNavigation=p};
   navigate("home");
  });
  if(!(await page.locator("#page-analytics").isHidden()))
   throw Error("Trends must be hidden on Overview");
  await page.locator('.tabs button[data-page="analytics"]').click();
  if(await page.locator("#page-analytics").isHidden()||
     !(await page.locator("#page-home").isHidden()))
   throw Error("Separate Trends page did not open");
  if((await page.evaluate(()=>window.__savedNavigation))!=="analytics")
   throw Error("Trends tab choice did not persist");
  const ordered=await page.locator("#strengthList .strength-exercise-card").evaluateAll(
   cards=>cards.map(card=>card.dataset.exerciseId));
  const wanted=["adductor","lateral_raise","chest_press","row"];
  if(JSON.stringify(ordered)!==JSON.stringify(wanted))
   throw Error("Trend cards not recent-first: "+JSON.stringify(ordered));
  if(await page.locator("#analyticsExercise").count())throw Error("Trend dropdown still visible");
  const plots=await page.locator("#strengthList .feature-chart svg").count();
  if(plots!==4)throw Error("Expected every recorded exercise to have a chart: "+plots);
  if(await page.locator("#strengthList").isVisible())
   throw Error("Per-exercise detailed charts should be collapsed by default");
  await page.locator("#strengthDetailExpander > summary").click();
  // Mobile taps on graph dots must show saved kg/reps, not desktop hover alone.
  await page.evaluate(()=>{
   // Exercise charts are private module functions; refresh through the same
   // public data event that the native Android bridge uses.
   window.__previewDays.push({schema_version:2,date:"2026-11-15",
    workouts:[{id:"preview-chest-second",exercise_id:"chest_press",
     load_kg:40,reps:8}],nutrition:[],measurements:[]});
   window.bodyTraceReceive({type:"data",cached:true,days:window.__previewDays});
  });
  const pressCard=page.locator('#strengthList .strength-exercise-card[data-exercise-id="chest_press"]');
  const pressHits=pressCard.locator(".strength-point-hit");
  if(await pressHits.count()!==2)throw Error("Expected two selectable points in chest press trend");
  await pressHits.nth(0).click();
  const firstDetail=await pressCard.locator(".strength-point-detail").innerText();
  if(!firstDetail.includes("35 kg × 12 次")||!firstDetail.includes("2026-11-14"))
   throw Error("First graph point did not reveal kg/reps: "+firstDetail);
  await pressHits.nth(1).click();
  const secondDetail=await pressCard.locator(".strength-point-detail").innerText();
  if(!secondDetail.includes("40 kg × 8 次")||!secondDetail.includes("2026-11-15"))
   throw Error("Second graph point did not change details: "+secondDetail);
  if(await pressCard.locator(".strength-visible-point").nth(1).getAttribute("r")!=="8")
   throw Error("Selected graph point did not get highlighted");
  await pressHits.nth(0).focus();
  await page.keyboard.press("Enter");
  const keyboardDetail=await pressCard.locator(".strength-point-detail").innerText();
  if(!keyboardDetail.includes("35 kg × 12 次"))
   throw Error("Keyboard activation of graph point failed: "+keyboardDetail);
  // Failed attempt is 0 completed reps at a named load: tap its RED base marker.
  // A later success with identical load and units must report days-to-first-success.
  await page.evaluate(()=>{
   const entries=[
    ["2026-11-12",{id:"demo-shoulder-fail",exercise_id:"shoulder_press",
     load_kg:10,load_basis:"per_side",reps:0,attempt_status:"failed",
     note:"两边各10kg，一个也推不起来"}],
    ["2026-11-17",{id:"demo-shoulder-pain",exercise_id:"shoulder_press",
     load_kg:5,load_basis:"unspecified",reps:8,attempt_status:"completed_with_pain",
     note:"手腕酸痛，单侧还是总计未知"}],
    ["2026-11-19",{id:"demo-shoulder-success",exercise_id:"shoulder_press",
     load_kg:10,load_basis:"per_side",reps:1}]
   ];
   for(const [date,workout] of entries)
    window.__previewDays.push({schema_version:2,date,workouts:[workout],
      nutrition:[],measurements:[]});
   window.bodyTraceReceive({type:"data",cached:true,days:window.__previewDays});
  });
  const shoulderCard=page.locator('#strengthList [data-exercise-id="shoulder_press"]');
  const failure=shoulderCard.locator(".strength-visible-point.failed-point");
  if(await failure.count()!==1)throw Error("0-rep attempt not shown as red dot");
  const redColor=await failure.getAttribute("fill");
  const redY=Number(await failure.getAttribute("cy"));
  const greenY=Number(await shoulderCard.locator(".strength-visible-point:not(.failed-point)").last().getAttribute("cy"));
  if(redColor!=="#F07780"||redY>=185||redY<=25||!(redY>greenY))
   throw Error("Failed 10kg should be at attempted-load y below successful 10kg e1RM, not at baseline: "+redColor+" "+redY+" success="+greenY);
  await shoulderCard.locator(".strength-point-hit").first().click();
  const failDetail=await shoulderCard.locator(".strength-point-detail").innerText();
  if(!failDetail.includes("2026-11-12")||!failDetail.includes("10 kg（每侧） × 0 次")||
     !failDetail.includes("同重量首次完成至少1次：2026-11-19（相隔7天）"))
   throw Error("Failed attempt + later success milestone missing: "+failDetail);
  const warn=await shoulderCard.locator(".strength-point-detail").evaluate(e=>e.classList.contains("failed"));
  if(!warn)throw Error("Failed point detail missing warning styling");
  await shoulderCard.locator(".strength-point-hit").nth(1).click();
  const painDetail=await shoulderCard.locator(".strength-point-detail").innerText();
  if(!painDetail.includes("5 kg")||!painDetail.includes("8 次")||!painDetail.includes("手腕酸痛"))
   throw Error("Pain note on completed set missing: "+painDetail);
  const statSets=await page.locator("#statSets").innerText();
  const actualCompleted=await page.evaluate(()=>state.rows.filter(x=>!isFailedAttempt(x)).length);
  if(Number(statSets)!==actualCompleted)
   throw Error("Failed attempts incorrectly inflated total completed sets: "+statSets);
  await page.screenshot({path:"bodytrace-zero-rep-red-dots-preview.png",fullPage:true});
  // Reproduce field issue: same-day native rows have created_at, ChatGPT
  // append-only GitHub rows often do not. Trend must show most recent saved set.
  await page.evaluate(()=>{
   window.__previewDays.push({
    schema_version:2,date:"2026-11-19",workouts:[
     {id:"demo-same-day-native",exercise_id:"face_pull",
      created_at:"2026-11-19T14:32:00+08:00",load_kg:25,reps:12},
     {id:"demo-same-day-smith-25",exercise_id:"smith_bench",
      load_kg:25,reps:10,load_basis:"unspecified"},
     {id:"demo-same-day-smith-30",exercise_id:"smith_bench",
      load_kg:30,reps:5,load_basis:"unspecified"}
    ],nutrition:[],measurements:[]
   });
   window.bodyTraceReceive({type:"data",cached:false,days:window.__previewDays});
  });
  const newest=await page.locator("#strengthList .strength-exercise-card").first()
   .getAttribute("data-exercise-id");
  if(newest!=="smith_bench")
   throw Error("Newest GitHub same-day manual records were wrongly placed behind native record: "+newest);
  const smith=page.locator('#strengthList [data-exercise-id="smith_bench"]');
  const smithMeta=await smith.locator(".strength-exercise-info small").innerText();
  if(!smithMeta.includes("2026-11-19")||!smithMeta.includes("30 kg × 5 次"))
   throw Error("Latest saved set not shown on trend: "+smithMeta);
  const initiallySelected=await smith.locator(".strength-point-detail").innerText();
  if(!initiallySelected.includes("30 kg × 5 次")||initiallySelected.includes("标注待核实"))
   throw Error("Trend should auto-select latest 30kg and hide technical metadata: "+initiallySelected);
  const positions=await smith.locator(".strength-visible-point").evaluateAll(
   el=>el.map(x=>Number(x.getAttribute("cx"))));
  if(positions.length!==2||positions[0]===positions[1])
   throw Error("Two sets on same day overlay completely: "+JSON.stringify(positions));
  const latestButtons=smith.locator(".strength-recent-set");
  if(await latestButtons.count()!==2)
   throw Error("Same-day sets must each have a dedicated selectable button");
  await latestButtons.nth(1).click();
  const former=await smith.locator(".strength-point-detail").innerText();
  if(!former.includes("25 kg × 10 次"))
   throw Error("Older same-day set cannot be selected independently: "+former);
  await latestButtons.nth(0).click();
  if(!(await smith.locator(".strength-point-detail").innerText()).includes("30 kg × 5 次"))
   throw Error("Latest set chip did not reselect newest entry");
  await page.screenshot({path:"bodytrace-same-day-github-trends-preview.png",fullPage:true});
  // Restore the baseline fixture after failure-point tests: subsequent
  // recording tests intentionally check the original recent-first leg choice.
  await page.evaluate(()=>{
   window.__previewDays=window.__previewDays.filter(day=>
    !day.workouts?.some(w=>String(w.id).startsWith("demo-shoulder-")||String(w.id).startsWith("demo-same-day-")));
   window.bodyTraceReceive({type:"data",cached:true,days:window.__previewDays});
  });
  // The demo includes one April workout, outside the default 90-day window.
  await page.locator('.trend-period[data-period="365"]').click();
  const multi=page.locator("#regionTrendGrid .combined-trend-scroll svg");
  if(await multi.count()!==1)throw Error("Expected one shared multi-exercise chart");
  if(await page.locator("#regionTrendGrid .region-overview-card").count())
   throw Error("Legacy four-panel bars must not remain");
  const curves=await page.locator("#regionTrendGrid polyline").count();
  if(curves!==4)throw Error("Demo should create four color-family curves: "+curves);
  const names=await page.locator(".combined-trend-legend-region > strong").allTextContents();
  if(JSON.stringify(names)!==JSON.stringify(["胸 · 1项","肩 · 1项","背 · 1项","腿 · 1项"]))
   throw Error("All four muscle families should appear automatically: "+names);
  const lineColors=await page.locator("#regionTrendGrid polyline").evaluateAll(
   nodes=>nodes.map(n=>n.getAttribute("stroke")));
  if(new Set(lineColors).size!==4)throw Error("Four regional colors were not unique");
  // Time controls must permit exact dates without adding invented no-workout data.
  await page.locator('.trend-period[data-period="30"]').click();
  if((await page.locator("#trendEndDate").inputValue())!==(await page.evaluate(()=>today)))
   throw Error("End date should use the local app calendar date");
  await page.locator("#trendStartDate").fill("2026-11-15");
  await page.locator("#trendStartDate").dispatchEvent("change");
  if(!(await page.locator('.trend-period[data-period="custom"]').getAttribute("class")).includes("active"))
   throw Error("Manual date edit must activate Custom");
  const filteredCount=await page.locator("#regionTrendGrid polyline").count();
  if(filteredCount>=curves||filteredCount<1)
   throw Error("Date filter must hide pre-range series, without removing current ones: "+
    filteredCount+" of "+curves);
  const filteredLabels=await page.locator("#regionTrendGrid .combined-trend-point").evaluateAll(
   nodes=>nodes.map(n=>n.getAttribute("aria-label")||""));
  if(filteredLabels.some(label=>label.includes("2026-11-14")||label.includes("2026-04-15")))
   throw Error("Out-of-range training dots leaked into the shared timeline");
  await page.locator('.trend-period[data-period="365"]').click();
  const markers=page.locator("#regionTrendGrid .combined-trend-point");
  if(await markers.count()<4)throw Error("Combined chart needs clickable raw-data points");
  await markers.first().click();
  if(!(await page.locator(".combined-trend-selection").innerText()).includes("e1RM"))
   throw Error("Combined chart point needs e1RM drilldown");
  await page.screenshot({path:"bodytrace-trends-preview.png",fullPage:true});
  await page.evaluate(()=>{
   navigate("home");
   // Extend synthetic demo only, never the actual private training repository.
   for(const [id,label] of [["chest_press","胸推"],["row","划船"]]){
    state.rows.push({id:"quad-demo-"+id,exercise_id:id,exercise:label,
     session_date:"2026-11-17",created_at:"2026-11-17T20:00:00+08:00"});
   }
   renderHeat();
  });
  const dayTile=page.locator('#heat .cell[title^="2026-11-17"]');
  const lit=await dayTile.locator(".cell-quadrant.active").evaluateAll(
    items=>items.map(el=>({region:el.dataset.region,color:getComputedStyle(el).backgroundColor})));
  if(lit.length!==4||new Set(lit.map(x=>x.region)).size!==4||
     new Set(lit.map(x=>x.color)).size!==4)
   throw Error("The same calendar day must illuminate all four unique region colors: "+JSON.stringify(lit));
  const emptyDay=page.locator('#heat .cell[title^="2026-11-16"]');
  if(await emptyDay.locator(".cell-quadrant.active").count())
   throw Error("Rest day is unexpectedly illuminated");
  await page.screenshot({path:"bodytrace-four-region-heatmap-preview.png",fullPage:false});
  await page.evaluate(()=>{
   window.BodyTraceNative={
    saveBatch:json=>{window.__capturedWorkout=JSON.parse(json)},
    saveMeasurement:json=>{window.__capturedBody=JSON.parse(json)},
    saveCatalog:json=>{window.__capturedCatalog=JSON.parse(json)}
   };
   navigate("record");
  });
  const docked=await page.evaluate(()=>{
   const dock=document.querySelector(".record-save-dock"),tabs=document.querySelector(".tabs");
   const action=document.getElementById("saveRecord").getBoundingClientRect();
   const nav=tabs.getBoundingClientRect();
   return {position:getComputedStyle(dock).position,top:action.top,bottom:action.bottom,navTop:nav.top};
  });
  if(docked.position!=="fixed"||docked.top<0||docked.bottom>docked.navTop+3)
   throw Error("Save button not visible above navigation: "+JSON.stringify(docked));
  const badgeRegion=await page.$eval("#recordRegionBadge",e=>e.textContent);
  if(!badgeRegion.includes("腿"))throw Error("Current exercise badge should show purple leg category: "+badgeRegion);
  const badgeColor=await page.locator("#recordRegionBadge").evaluate(el=>getComputedStyle(el).color);
  if(badgeColor!=="rgb(185, 169, 221)")throw Error("Record leg accent must be violet: "+badgeColor);
  const initialGroup=await page.$eval("#recordGroup",e=>e.value);
  if(initialGroup!=="")throw Error("Default group should be All: "+initialGroup);
  const first=await page.locator("#recordExercise option").first().evaluate(e=>({id:e.value,label:e.textContent}));
  if(first.id!=="adductor"||!first.label.startsWith("【腿】"))
   throw Error("Recent-first labeled dropdown failed: "+JSON.stringify(first));
  await page.selectOption("#recordSortMode","region");
  const regionFirst=await page.$eval("#recordExercise",x=>x.options[0]?.value);
  if(regionFirst!=="chest_press")throw Error("Region ordering should start from chest: "+regionFirst);
  await page.selectOption("#recordSortMode","recent");
  await page.click("#quickAddExercise");
  if(await page.$eval("#exerciseManager",x=>x.hidden))throw Error("Quick add action failed to open editor");
  if(!(await page.locator("#customActionName").evaluate(el=>el===document.activeElement)))
   throw Error("Quick add must focus action-name field");
  await page.click("#manageExercises");
  if(await page.$eval("#exerciseManager",x=>x.hidden))throw Error("Manager did not open");
  await page.locator('[data-exercise-id="leg_extension"] button').first().click();
  const hidden=await page.locator('#recordExercise option[value="leg_extension"]').count();
  if(hidden)throw Error("Hidden action remained selectable");
  await page.locator('[data-exercise-id="leg_extension"] button').first().click();
  const restored=await page.locator('#recordExercise option[value="leg_extension"]').count();
  if(restored!==1)throw Error("Restored action missing");
  await page.fill("#customActionName","自定义三角肌训练");
  await page.selectOption("#customActionRegion","肩");
  await page.click("#addCustomExercise");
  const added=await page.$eval("#recordExercise",x=>x.value);
  if(!added.startsWith("custom_"))throw Error("Custom action not selectable: "+added);
  const removeButton=page.locator('[data-exercise-id="'+added+'"] .danger-soft');
  await removeButton.click();
  await removeButton.click();
  if(await page.locator('#recordExercise option[value="'+added+'"]').count())
    throw Error("Removed custom action still selectable");
  const stored=await page.evaluate(()=>window.__capturedCatalog);
  if(!stored||stored.sort_mode!=="recent"||stored.custom.length)
    throw Error("Catalog changes not sent to native JSON store");
  await page.click("#closeExerciseManager");
  await page.selectOption("#recordGroup","");
  const optionsAll=await page.locator("#recordExercise option").evaluateAll(
    opts=>opts.map(o=>o.value));
  if(!optionsAll.includes("adductor")||!optionsAll.includes("lateral_raise"))
    throw Error("All filter missing actions: "+JSON.stringify(optionsAll));
  await page.selectOption("#recordGroup","腿");
  const legOnly=await page.locator("#recordExercise option").evaluateAll(
    opts=>opts.map(o=>o.value));
  if(!legOnly.includes("adductor")||legOnly.includes("lateral_raise"))
    throw Error("Leg filter invalid: "+JSON.stringify(legOnly));
  await page.selectOption("#recordGroup","");
  await page.selectOption("#recordExercise","adductor");
  await page.click("#recordKg");
  if(await page.$eval("#wheelOverlay",x=>x.hidden))throw Error("Weight ruler did not open");
  await page.screenshot({path:"bodytrace-wheel-preview.png",fullPage:false});
  await page.fill("#wheelValue","27.5");
  await page.click("#wheelDone");
  await page.click("#recordReps");
  await page.fill("#wheelValue","12");
  await page.click("#wheelDone");
  await page.evaluate(()=>{
   window.BodyTraceExerciseCatalog.refresh(state.rows);
   window.bodyTraceReceive({type:"exercise_catalog",
    catalog:{schema_version:1,sort_mode:"recent",custom:[],hidden:[]}});
  });
  const draft=await page.evaluate(()=>({
   action:document.getElementById("recordExercise").value,
   weight:document.getElementById("recordKg").value,
   reps:document.getElementById("recordReps").value
  }));
  if(draft.action!=="adductor"||draft.weight!=="27.5"||draft.reps!=="12")
   throw Error("Refresh clobbered the unsaved workout: "+JSON.stringify(draft));
  await page.click("#recordSets");
  await page.fill("#wheelValue","3");
  await page.click("#wheelDone");
  await page.click("#saveRecord");
  const workout=await page.evaluate(()=>window.__capturedWorkout);
  if(!workout||workout.kg!==27.5||workout.reps!==12||workout.sets!==3||workout.exercise_id!=="adductor")
   throw Error("Workout ruler/batch JSON mismatch: "+JSON.stringify(workout));
  await page.evaluate(()=>{
   state.selected="2026-04-15";state.calendarBrowsing=true;indexData();
  });
  const historic=await page.$eval("#selectedDate",e=>e.textContent);
  if(!historic.startsWith("2026-04-15"))
   throw Error("Sync jump changed historical date: "+historic);
  await page.evaluate(()=>navigate("body"));
  await page.locator("#bodyEntryGrid .body-entry-metric").first().click();
  await page.fill("#wheelValue","74.5");
  await page.click("#wheelDone");
  await page.click("#bodySaveMeasurement");
  const measured=await page.evaluate(()=>window.__capturedBody);
  if(!measured||measured.weight_kg!==74.5||"shoulder_cm" in measured)
   throw Error("Body JSON should contain edited values only: "+JSON.stringify(measured));
  // Opening Settings checks only Release metadata; downloading requires
  // exactly one explicit user click on the right-side APK upgrade action.
  await page.evaluate(()=>{
   window.__apkVersionChecks=0;window.__apkUpgradeClicks=0;
   window.__apkInstallClicks=0;
   window.BodyTraceNative.checkApkVersion=()=>{window.__apkVersionChecks++};
   window.BodyTraceNative.checkApkUpdate=()=>{window.__apkUpgradeClicks++};
   window.BodyTraceNative.installPendingApk=()=>{window.__apkInstallClicks++};
   navigate("settings");
   window.bodyTraceReceive({type:"apk_update",state:"update_available",
    installed_version:170,latest_version:171,
    message:"发现新版 v0.2.171，点击右侧即可升级"});
   window.bodyTraceReceive({type:"git_log",commits:[{
    sha:"0123456789abcdef0123456789abcdef01234567",
    message:"record: workout updated",date:"2026-11-18T10:00:00+08:00",
    additions:2,deletions:1,files:[{
     filename:"data/daily/2026-11-18.json",status:"modified",
     additions:2,deletions:1,
     patch:"@@ -1,2 +1,3 @@\n- old set\n+ new set\n+ extra set\n unchanged"
    }]
   }]});
  });
  if((await page.evaluate(()=>window.__apkVersionChecks))!==1)
   throw Error("Settings page should automatically make exactly one metadata-only version check");
  if((await page.locator("#apkInstalledVersion").innerText())!=="v0.2.170"||
     (await page.locator("#apkLatestVersion").innerText())!=="v0.2.171")
   throw Error("Installed and latest APK versions should both be visible on Settings");
  if(await page.locator("#apkUpdatePanel > .apk-version-row > button").count()!==1)
   throw Error("APK upgrade panel should expose a SINGLE action button");
  if((await page.evaluate(()=>window.__apkUpgradeClicks))!==0)
   throw Error("Automatic version check must not initiate a download");
  await page.locator("#checkApkUpdate").click();
  if((await page.evaluate(()=>window.__apkUpgradeClicks))!==1)
   throw Error("Upgrade button must invoke native APK download exactly once");
  await page.evaluate(()=>window.bodyTraceReceive({
   type:"apk_update",state:"ready",installed_version:170,latest_version:171,
   message:"差分已校验",method:"delta"}));
  if((await page.locator("#checkApkUpdate").innerText())!=="继续安装")
   throw Error("Single APK upgrade button should become a continue-install action");
  await page.locator("#checkApkUpdate").click();
  if((await page.evaluate(()=>window.__apkInstallClicks))!==1)
   throw Error("One-button installer reopen action did not invoke the native bridge");
  const quickSyncPosition=await page.evaluate(()=>{
   const page=document.getElementById("page-settings");
   const first=page.firstElementChild;
   const button=document.getElementById("syncSettings");
   return {firstIsSync:first?.classList.contains("settings-sync-strip"),
    buttonInside:first?.contains(button),
    beforeHistory:button.getBoundingClientRect().top <
     document.getElementById("gitHistoryPanel").getBoundingClientRect().top};
  });
  if(!quickSyncPosition.firstIsSync||!quickSyncPosition.buttonInside||
      !quickSyncPosition.beforeHistory)
   throw Error("Settings quick-sync must be first and above Git history: "+JSON.stringify(quickSyncPosition));
  await page.evaluate(()=>{
   window.__syncClicks=0;
   window.BodyTraceNative.sync=()=>{window.__syncClicks++};
  });
  await page.locator("#syncSettings").click();
  if(await page.evaluate(()=>window.__syncClicks)!==1)
   throw Error("Quick GitHub sync did not invoke native sync exactly once");
  // UI-only update is deliberately hidden behind the APK card's help (!).
  if(await page.locator("#uiUpdatePanel").isVisible())
   throw Error("Advanced UI-only updater should be collapsed on Settings entry");
  if(await page.locator("#apkUpdatePanel .apk-update-help>summary").count()!==1)
   throw Error("APP update card must expose a single ! help disclosure");
  await page.locator("#apkUpdatePanel .apk-update-help>summary").click();
  if(!(await page.locator("#uiUpdatePanel").isVisible()))
   throw Error("Opening ! must expose advanced UI-only updater");
  const advancedVisible=await page.locator("#uiUpdatePanel").locator("button").count();
  if(advancedVisible!==3)
   throw Error("Advanced UI updater must retain all three operational controls");
  await page.screenshot({path:"bodytrace-settings-update-help-preview.png",fullPage:false});
  await page.locator("#apkUpdatePanel .apk-update-help>summary").click();
  if(await page.locator("#uiUpdatePanel").isVisible())
   throw Error("Closing ! must collapse advanced update controls");
  if(await page.locator("#gitLogList details").count())
   throw Error("Git diffs must be visible without an expand action");
  if(await page.locator("#gitLogList .git-diff-added").count()!==2||
     await page.locator("#gitLogList .git-diff-removed").count()!==1)
   throw Error("Gerrit-style diff row classification failed");
  const styles=await page.locator("#gitLogList .git-diff-added, #gitLogList .git-diff-removed")
   .evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundColor));
  if(styles[0]===styles.at(-1))throw Error("Added and removed diff backgrounds must differ");
  const lastSettings=await page.locator("#page-settings > .panel").last().innerText();
  if(!lastSettings.includes("连接 GitHub 私有仓库"))
   throw Error("GitHub authorization must be the last settings panel");
  await page.screenshot({path:"bodytrace-git-diff-preview.png",fullPage:true});
  // Nutrition check-in: four semantic quadrants, saved snapshots and GitHub
  // native bridge payload. Synthetic samples only, never personal nutrition.
  await page.locator('.tabs button[data-page="body"]').click();
  const bodyFirst=await page.locator("#page-body > div").first().getAttribute("id");
  if(bodyFirst!=="bodyNutritionSection")
   throw Error("Nutrition four-grid should be the first Body card: "+bodyFirst);
  const quickGeometry=await page.locator("#intakeDate, .intake-quick-controls .intake-choice, #saveIntakeCheck")
   .evaluateAll(items=>items.map(x=>x.getBoundingClientRect().top));
  if(quickGeometry.length!==6||Math.max(...quickGeometry)-Math.min(...quickGeometry)>8)
   throw Error("Nutrition date, four checkboxes, and save must be one compact row: "+quickGeometry);
  if(await page.locator("#intakeCalendar .intake-cell").count()!==364)
   throw Error("Nutrition 52-week calendar should render 364 day cells");
  const scrollState=await page.locator("#intakeCalendarScroll").evaluate(node=>
   ({left:node.scrollLeft,span:node.scrollWidth-node.clientWidth}));
  if(scrollState.span>50&&scrollState.left<scrollState.span*0.7)
   throw Error("Nutrition calendar did not start near the most recent weeks");
  await page.fill("#intakeDate","2026-11-17");
  for(const id of ["intakeCreatine","intakeProtein","intakeCarbs","intakeSugarOil"])
   await page.locator("#"+id).check();
  await page.evaluate(()=>{
   window.BodyTraceNative.saveNutrition=value=>{
    window.__capturedIntake=JSON.parse(value);
   };
  });
  await page.locator("#saveIntakeCheck").click();
  const firstIntake=await page.evaluate(()=>window.__capturedIntake);
  if(firstIntake?.entry_kind!=="daily_checkin"||firstIntake.date!=="2026-11-17"||
   !["intake_creatine","intake_protein_powder","intake_carbs","intake_sugar_oil"]
     .every(k=>firstIntake[k]===true))
   throw Error("Four-flag nutrition save payload invalid: "+JSON.stringify(firstIntake));
  await page.evaluate(()=>{
   const day=window.__previewDays.find(x=>x.date==="2026-11-17");
   day.nutrition.push({id:"intake-all",...window.__capturedIntake,
    created_at:"2026-11-17T11:00:00+08:00",source:"bodytrace-android"});
   day.nutrition.push({id:"food-item",meal:"lunch",food:"熟米饭",
    grams:200,kcal_per_100g:120,source:"bodytrace-android"});
   window.bodyTraceReceive({type:"data",cached:true,days:window.__previewDays});
  });
  const intakeDay=page.locator('#intakeCalendar .intake-cell[title^="2026-11-17"]');
  const colors=await intakeDay.locator(".intake-quadrant.active").evaluateAll(
   squares=>squares.map(x=>getComputedStyle(x).backgroundColor));
  if(colors.length!==4||new Set(colors).size!==4)
   throw Error("Four distinct colors should light up same nutrition day: "+colors);
  await page.locator("#intakeCreatine").uncheck();
  await page.locator("#intakeCarbs").uncheck();
  const pendingText=await page.locator("#intakeCheckStatus").innerText();
  if(!pendingText.includes("待保存")&&!pendingText.includes("勾选已变更"))
   throw Error("Checkbox changes must be marked as unsaved");
  // Simulate an unrelated remote refresh before saving: preserve user edits.
  await page.evaluate(()=>window.bodyTraceReceive({
   type:"data",cached:true,days:window.__previewDays
  }));
  if(await page.locator("#intakeCreatine").isChecked()||
     await page.locator("#intakeCarbs").isChecked())
   throw Error("Pending nutrition edits were erased by a sync refresh");
  await page.locator("#saveIntakeCheck").click();
  const revised=await page.evaluate(()=>window.__capturedIntake);
  if(revised.intake_creatine!==false||revised.intake_carbs!==false||
     revised.intake_protein_powder!==true||revised.intake_sugar_oil!==true)
   throw Error("Unchecking flags did not create a complete new snapshot");
  await page.evaluate(()=>{
   const day=window.__previewDays.find(x=>x.date==="2026-11-17");
   day.nutrition.unshift({id:"intake-newer",...window.__capturedIntake,
    created_at:"2026-11-17T19:00:00+08:00",source:"bodytrace-android"});
   window.bodyTraceReceive({type:"data",cached:true,days:window.__previewDays});
  });
  const remaining=await intakeDay.locator(".intake-quadrant.active").evaluateAll(
   nodes=>nodes.map(el=>el.dataset.kind));
  if(JSON.stringify(remaining)!==JSON.stringify(["intake_protein_powder","intake_sugar_oil"]))
   throw Error("Latest snapshot did not win over older saved flags: "+remaining);
  if(!(await page.locator("#nutritionLegacy").isHidden()))
   throw Error("Legacy calorie form must remain hidden in the merged Body page");
  // Hidden legacy fields still retain working calculations for future restore.
  await page.locator("#foodDate").evaluate(input=>{
   input.value="2026-11-17";
   input.dispatchEvent(new Event("change",{bubbles:true}));
  });
  const foodTotal=await page.locator("#foodDayTotals").textContent();
  if(!foodTotal.includes("240 kcal"))
   throw Error("Intake checkbox snapshots must not affect food calories: "+foodTotal);
  const foodCount=await page.locator("#foodRecordCount").textContent();
  if(foodCount!=="1条")throw Error("Qualitative check-ins inflated food count: "+foodCount);
  await page.locator('#intakeCalendar .intake-cell[title^="2026-11-16"]').click();
  for(const id of ["intakeCreatine","intakeProtein","intakeCarbs","intakeSugarOil"]){
   if(await page.locator("#"+id).isChecked())
    throw Error("Unrecorded day inherited prior checkbox selection: "+id);
  }
  await intakeDay.click();
  if(await page.locator("#intakeCreatine").isChecked()||
     !(await page.locator("#intakeProtein").isChecked()))
   throw Error("Selecting a previously saved day failed to restore its latest flags");
  await page.screenshot({path:"bodytrace-nutrition-four-quadrant-preview.png",fullPage:false});
  // Regression: corrected shared catalog must reclassify legacy Other rows.
  await page.evaluate(()=>{
   window.__previewDays.push({schema_version:2,date:"2026-11-18",
    workouts:[
     {id:"demo-lat-pulldown-legacy",exercise_id:"custom_shoulderpullpending",
      exercise_label:"肩拉（器械待确认）",exercise_region:"其他",load_kg:35,reps:10},
     {id:"demo-both-way-legacy",exercise_id:"custom_bothwaysquat",
      exercise_label:"Both Way Squat（双向深蹲机）",exercise_region:"其他",load_kg:30,reps:10}
    ],nutrition:[],measurements:[]});
   window.bodyTraceReceive({type:"data",cached:false,days:window.__previewDays});
   window.bodyTraceReceive({type:"exercise_catalog",catalog:{
    schema_version:1,sort_mode:"recent",hidden:[],custom:[
     {id:"custom_shoulderpullpending",label:"高位下拉（Lat Pulldown，龙门架）",region:"背"},
     {id:"custom_bothwaysquat",label:"Both Way Squat（双向深蹲机）",region:"腿"},
     {id:"custom_demoarm",label:"Demo arm workout",region:"手臂"}
    ]
   }});
  });
  const pulldown=page.locator('#strengthList [data-exercise-id="custom_shoulderpullpending"]');
  const bothSquat=page.locator('#strengthList [data-exercise-id="custom_bothwaysquat"]');
  if(await pulldown.getAttribute("data-region")!=="背"||
     await bothSquat.getAttribute("data-region")!=="腿")
   throw Error("Catalog correction was not applied to stale Other trend card groups");
  const pullTitle=await pulldown.locator("h3").innerText();
  if(!pullTitle.includes("高位下拉")||pullTitle.includes("肩拉"))
   throw Error("Corrected catalog label not shown on old lat pulldown: "+pullTitle);
  const heat=await page.locator('#heat .cell[title^="2026-11-18"]').getAttribute("title");
  if(!heat.includes("背1组")||!heat.includes("腿1组")||heat.includes("其他2组"))
   throw Error("Custom rows did not light correct back/leg quadrants: "+heat);
  const zones=await page.locator('#muscleLegend .muscle-legend-btn').evaluateAll(
   nodes=>nodes.filter(n=>n.textContent.includes("背阔肌")||n.textContent.includes("股四头肌"))
    .map(n=>({name:n.textContent,group:n.dataset.region})));
  if(zones.length!==2||zones.some(z=>!z.group||z.name.trim().endsWith("0")))
   throw Error("Custom workouts absent in muscle map: "+JSON.stringify(zones));
  await page.evaluate(()=>navigate("record"));
  const groupOptions=await page.locator("#recordGroup option").evaluateAll(
   nodes=>nodes.map(n=>n.value));
  if(JSON.stringify(groupOptions)!==JSON.stringify(["","胸","肩","背","腿","其他"]))
   throw Error("Top-level region grouping mismatch: "+groupOptions);
  await page.selectOption("#recordGroup","其他");
  const residual=await page.locator("#recordExercise option").evaluateAll(
   nodes=>nodes.map(n=>n.value));
  if(!residual.includes("custom_demoarm"))
   throw Error("Legacy arm workouts should remain accessible through Other");
  await page.screenshot({path:"bodytrace-four-major-regions-preview.png",fullPage:false});
  // Sleep workbench: one-screen waveform, baseline fine tuning, audio playback.
  await page.evaluate(()=>{
   window.__sleepBridge={started:0,stopped:0,list:0,analysis:[],
    cached:[],sequences:[],deleted:[],paused:0};
   window.BodyTraceNative={
    ...(window.BodyTraceNative||{}),
    sleepStatus:()=>window.__sleepBridge.list++,
    sleepStart:()=>window.__sleepBridge.started++,
    sleepStop:()=>window.__sleepBridge.stopped++,
    sleepAnalyze:(id,threshold,seconds,gap)=>
     window.__sleepBridge.analysis.push({id,threshold,seconds,gap}),
    sleepAnalyzeSpeech:(id,threshold,seconds,gap)=>
     window.__sleepBridge.analysis.push({id,threshold,seconds,gap,speech:true}),
    sleepReadCached:(id,threshold,seconds,gap)=>
     window.__sleepBridge.cached.push({id,threshold,seconds,gap}),
    sleepPlaySequence:(id,json,skip)=>
     window.__sleepBridge.sequences.push({id,ranges:JSON.parse(json),skip}),
    sleepStopPlayback:()=>window.__sleepBridge.paused++,
    sleepDelete:id=>window.__sleepBridge.deleted.push(id)
   };
  });
  await page.locator('.tabs button[data-page="sleep"]').click();
  if((await page.evaluate(()=>window.__sleepBridge.list))!==1)
   throw Error("Sleep workbench should load local sessions");
  const sleepId="1700000000000-ab123456";
  await page.evaluate(id=>window.bodyTraceReceive({
   type:"sleep_status",recording:false,sessions:[{
    id,started_ms:1795000000000,ended_ms:1795028800000,status:"completed",
    original_name:"night.m4a",bytes:419430400,levels_cached:false
   }]
  }),sleepId);
  if(await page.locator("#sleepHistory .sleep-history-card").count()!==1)
   throw Error("Local sleep history missing");
  if(await page.locator("#sleepSessionSelect").inputValue()!==sleepId)
   throw Error("Recording selector must show the current file");
  if(await page.locator("#sleepVisualization").isVisible())
   throw Error("Waveform should stay hidden until its local envelope exists");
  // Main audio/record/import actions now live in the same top browser row.
  // The drop-down is for management and optional settings only.
  if(await page.locator("#sleepAudioToolbar #sleepStart").count()!==1||
     await page.locator("#sleepAudioToolbar #sleepImport").count()!==1||
     await page.locator("#sleepAudioToolbar #sleepCollectionDetails").count()!==1)
   throw Error("Browser controls must share one top toolbar");
  await page.locator("#sleepStart").click();
  if((await page.evaluate(()=>window.__sleepBridge.started))!==1)
   throw Error("Recording start did not reach the native bridge");
  await page.evaluate(id=>window.bodyTraceReceive({
   type:"sleep_status",recording:true,active_id:id,sessions:[{
    id,started_ms:1795000000000,status:"recording",bytes:20480
   }]
  }),sleepId);
  if(!(await page.locator("#sleepStart").isDisabled())||
      (await page.locator("#sleepStop").isDisabled()))
   throw Error("Recording controls did not switch to the live state");
  await page.locator("#sleepStop").click();
  if((await page.evaluate(()=>window.__sleepBridge.stopped))!==1)
   throw Error("Stop recording should call native bridge");
  await page.evaluate(id=>window.bodyTraceReceive({
   type:"sleep_status",recording:false,sessions:[{
    id,started_ms:1795000000000,ended_ms:1795028800000,
    original_name:"night.m4a",status:"completed",bytes:419430400,levels_cached:false
   }]
  }),sleepId);
  await page.locator("#sleepAnalyze").click();
  const request=await page.evaluate(()=>window.__sleepBridge.analysis[0]);
  if(request.id!==sleepId||request.threshold!==-40)
   throw Error("First analysis should use initial -40 dBFS while loading");
  const seconds=8*60*60;
  await page.evaluate(({id,seconds})=>{
   const rms=Array.from({length:seconds},(_,i)=>
    i>=4200&&i<4250?-24:(i%3500<120?-32:-62));
   const peak=rms.map(v=>v+9);
   window.bodyTraceReceive({type:"sleep_analysis",id,
    started_ms:1795000000000,date_basis:"user_supplied",
    total_seconds:seconds,threshold_dbfs:-40,minimum_seconds:5,
    gap_seconds:1,levels_dbfs:rms,peak_levels_dbfs:peak,events:[]});
  },{id:sleepId,seconds});
  if(await page.locator("#sleepVisualization").isHidden())
   throw Error("The waveform must appear after a valid analysis");
  if(Number(await page.locator("#sleepThreshold").inputValue())!==-60)
   throw Error("Robust P20 background -62dBFS should default to -60.0dBFS");
  await page.locator("#sleepThresholdUp").click();
  if((await page.locator("#sleepThreshold").inputValue())!=="-59.9")
   throw Error("0.1 dB micro adjustment failed");
  await page.locator("#sleepThresholdReset").click();
  if(Number(await page.locator("#sleepThreshold").inputValue())!==-60)
   throw Error("Baseline reset must restore P20+2dB for this recording");
  if(await page.locator("#sleepQuickSummary").innerText()==="")
   throw Error("One-screen candidate summary is missing");
  if(await page.locator("#sleepSoundStats .sleep-sound-stat").count()!==4)
   throw Error("Detailed metrics should be compact (four, not six cards)");
  if(await page.locator("#sleepHourlyActivity .sleep-hour-block").count()!==8)
   throw Error("Eight-hour imported audio should render 8 hourly bars");
  const dims=await page.locator("#sleepWaveCanvas").evaluate(c=>({w:c.width,h:c.height}));
  if(dims.w<200||dims.h<200)
   throw Error("Compact waveform failed to render: "+JSON.stringify(dims));
  const oldAxis=await page.evaluate(()=>window.BodyTraceSleepVisual.state());
  await page.locator('#sleepVisualization [data-sleep-zoom="3600"]').click();
  const newAxis=await page.evaluate(()=>window.BodyTraceSleepVisual.state());
  if(newAxis.span!==3600||newAxis.axisMin!==oldAxis.axisMin||
      newAxis.axisMax!==oldAxis.axisMax)
   throw Error("Horizontal zoom must preserve locked Y axis");
  await page.locator("#sleepWaveCanvas").click({position:{x:190,y:85}});
  if(await page.locator("#sleepPlaySelection").isDisabled())
   throw Error("Waveform tap should enable playback");
  await page.locator("#sleepPlaySelection").click();
  const ordinary=await page.evaluate(()=>window.__sleepBridge.sequences.at(-1));
  if(!ordinary||ordinary.id!==sleepId||ordinary.skip)
   throw Error("Default playback should stream original audio from cursor");
  await page.locator("#sleepSkipQuiet").check();
  await page.locator("#sleepPlaySelection").click();
  const filtered=await page.evaluate(()=>window.__sleepBridge.sequences.at(-1));
  if(!filtered.skip||!filtered.ranges.length)
   throw Error("Skip mode should play only qualifying audio ranges");
  await page.locator("#sleepStopPlayback").click();
  if((await page.evaluate(()=>window.__sleepBridge.paused))<1)
   throw Error("Stop playback must reach native service");
  await page.locator(".sleep-events-details > summary").click();
  if((await page.locator("#sleepAnalysis .sleep-event").count())<1)
   throw Error("Candidate events should remain accessible in collapsed details");
  const decodeCount=await page.evaluate(()=>window.__sleepBridge.analysis.length);
  await page.locator("#sleepThresholdDown").click();
  if((await page.evaluate(()=>window.__sleepBridge.analysis.length))!==decodeCount)
   throw Error("Changing threshold must not decode the original M4A again");
  // Make the old cached night explicitly snore-only; plain RMS fixtures
  // intentionally trigger automatic AI initialization and cannot select modes.
  await page.evaluate(({id,seconds})=>{
   const rms=Array.from({length:seconds},()=>-61);
   const snore=Array.from({length:seconds},(_,i)=>i>=300&&i<312?.60:.01);
   window.bodyTraceReceive({type:"sleep_analysis",id,
    started_ms:1795000000000,date_basis:"user_supplied",
    total_seconds:seconds,threshold_dbfs:-40,minimum_seconds:2,gap_seconds:1,
    levels_dbfs:rms,peak_levels_dbfs:rms,ai_snore_scores:snore,events:[]});
  },{id:sleepId,seconds});
  // Existing snore-only caches must not launch another 8-hour decode silently.
  await page.locator("#sleepDetectionMode").selectOption("speech");
  if(!(await page.locator("#sleepDetectorNote").innerText()).includes("缺少人声标签"))
   throw Error("Old cache needs explicit speech-upgrade explanation");
  if(await page.locator("#sleepSpeechUpgrade").isHidden())
   throw Error("Speech upgrade button must be visible for old audio");
  await page.locator("#sleepSpeechUpgrade").click();
  const requested=await page.evaluate(()=>window.__sleepBridge.analysis.at(-1));
  if(!requested?.speech||requested.id!==sleepId)
   throw Error("One-time speech analysis did not reach the native bridge");
  await page.evaluate(({id,seconds})=>{
   const rms=Array.from({length:seconds},()=>-61);
   const speech=Array.from({length:seconds},(_,i)=>i>=120&&i<126?.75:.01);
   const snore=Array.from({length:seconds},(_,i)=>i>=300&&i<312?.60:.01);
   window.bodyTraceReceive({type:"sleep_analysis",id,
    started_ms:1795000000000,date_basis:"user_supplied",
    total_seconds:seconds,threshold_dbfs:-40,minimum_seconds:2,gap_seconds:1,
    levels_dbfs:rms,peak_levels_dbfs:rms,
    ai_snore_scores:snore,ai_speech_scores:speech,events:[]});
  },{id:sleepId,seconds});
  if(!Number((await page.locator("#sleepQuickSummary").innerText()).match(/(\d+) 段/)?.[1]))
   throw Error("Speech candidates should be found separately from snoring");
  if(await page.locator("#sleepSpeechUpgrade").isVisible())
   throw Error("New speech cache must hide rebuild button");
  await page.locator("#sleepDetectionMode").selectOption("ai");
  if(!Number((await page.locator("#sleepQuickSummary").innerText()).match(/(\d+) 段/)?.[1]))
   throw Error("Snore model must still classify independent snore windows");
  await page.locator("#sleepDetectionMode").selectOption("speech");
  await page.screenshot({path:"bodytrace-sleep-speech-candidates-preview.png",fullPage:false});
  // The optional start time is intentionally collapsed in the compact UI.
  // Expand it explicitly before typing; do not force the field visible.
  await page.locator("#sleepCollectionDetails > summary").click();
  await page.locator(".sleep-import-time > summary").click();
  await page.fill("#sleepImportStarted","2026-11-18T23:00");
  await page.evaluate(()=>window.BodyTraceNative.sleepImport=value=>{
   window.__importStarted=value;
  });
  await page.locator("#sleepImport").click();
  if((await page.evaluate(()=>window.__importStarted))!=="2026-11-18T23:00")
   throw Error("Import should preserve the supplied recording date");
  await page.screenshot({path:"bodytrace-sleep-waveform-import-preview.png",fullPage:false});
  // Emulate the user granting Usage Access and receiving two-night reports.
  await page.evaluate(()=>{
    window.__phoneSleepProbeCalls=0;
    window.BodyTraceNative.phoneSleepReports=()=>window.__phoneSleepProbeCalls++;
    window.BodyTraceNative.requestPhoneUsageAccess=()=>window.__phoneSleepPermission=true;
  });
  await page.locator("#phoneSleepRefresh").click();
  if((await page.evaluate(()=>window.__phoneSleepProbeCalls))!==1)
   throw Error("Phone sleep scan not routed to native bridge");
  await page.evaluate(()=>window.bodyTraceReceive({
    type:"phone_sleep",state:"permission_required",
    message:"需要一次性开启使用情况访问权限"
  }));
  if(await page.locator("#phoneSleepGrant").isHidden())
   throw Error("Usage access special permission button must be visible");
  await page.locator("#phoneSleepGrant").click();
  if(!(await page.evaluate(()=>window.__phoneSleepPermission)))
   throw Error("Permission button does not launch Android settings");
  await page.evaluate(()=>{
    const start=Date.UTC(2026,10,21,15,30,0);
    window.bodyTraceReceive({
      type:"phone_sleep",state:"ready",events_scanned:150,
      first_event_ms:Date.UTC(2026,10,20,10),
      last_event_ms:Date.UTC(2026,10,22,2),
      total_count:2,created_count:1,
      history:[
       {day:"2026-11-22",screen_off_ms:start,
        next_screen_on_ms:Date.UTC(2026,10,21,23,30),
        inactive_window_ms:8*3600000,screen_on_events:1,unlock_events:1},
       {day:"2026-11-21",screen_off_ms:start-86400000,
        next_screen_on_ms:start-86400000+7*3600000,
        inactive_window_ms:7*3600000,screen_on_events:1,unlock_events:1}],
      insufficient:[{day:"2026-11-20",message:"事件不足"}]
    });
  });
  if(await page.locator(".phone-sleep-night").count()!==2)
   throw Error("Phone report should preserve all scanned / cached days");
  if(!(await page.locator("#phoneSleepCoverage").innerText()).includes("已扫描 150"))
   throw Error("Phone report should show actual system event coverage");
  if(!(await page.locator(".phone-sleep-night").first().innerText()).includes("不等于睡眠时长"))
   throw Error("Phone idle interval must never be mislabeled as actual sleep");
  // Independent Sound tab: old Sleep page must not contain the live mic UI.
  await page.locator('.tabs button[data-page="voice"]').click();
  if(!await page.locator("#page-voice").isVisible()||
     await page.locator("#page-sleep").isVisible())
   throw Error("Voice Lab must have its own bottom tab");
  await page.evaluate(()=>{
    window.__labMock={started:[],stopped:0,finished:0};
    window.BodyTraceNative.voiceLabStart=mode=>window.__labMock.started.push(mode);
    window.BodyTraceNative.voiceLabStop=()=>window.__labMock.stopped++;
    window.BodyTraceNative.voiceLabFinishPhoneme=()=>window.__labMock.finished++;
  });
  const voicePitchSvg=page.locator("#voicePitchChart");
  const voicePitchBounds=await voicePitchSvg.evaluate(e=>({
    width:e.getBoundingClientRect().width,
    height:e.getBoundingClientRect().height,
    color:getComputedStyle(e).backgroundColor
  }));
  if(voicePitchBounds.width<250||voicePitchBounds.height<100||
      voicePitchBounds.height>300||voicePitchBounds.color==="rgb(255, 255, 255)")
   throw Error("Pitch chart must be a compact dark SVG, not a blank white canvas: "+
    JSON.stringify(voicePitchBounds));
  await page.locator("#voicePitchStart").click();
  if((await page.evaluate(()=>window.__labMock.started[0]))!=="pitch")
   throw Error("Pitch must start native PCM capture");
  await page.evaluate(()=>window.bodyTraceReceive({
    type:"voice_lab",state:"running",mode:"pitch",message:"started"
  }));
  await page.evaluate(()=>{
    for(const [note,midi,hz] of [["C4",60,261.63],["D4",62,293.66],["E4",64,329.63]]){
      for(let i=0;i<6;i++){
        const actualMidi=midi+Math.sin(i*2.4)*.12;
        window.bodyTraceReceive({
          type:"voice_lab",state:"pitch_sample",mode:"pitch",
          pitch_hz:hz,note,midi:actualMidi,cents:(actualMidi-midi)*100
        });
      }
    }
  });
  if(await page.locator("#voicePitchTraces path").count()<3)
   throw Error("Do-Re-Mi should form three separate pitched trace segments");
  if((await page.locator("#voicePitchNote").innerText())!=="E4")
   throw Error("Last note must remain E4");
  const before=await page.evaluate(()=>window.BodyTraceVoiceLab.state());
  await page.evaluate(()=>window.bodyTraceReceive({
    type:"voice_lab",state:"pitch_sample",mode:"pitch",
    pitch_hz:0,note:"—",midi:0,cents:0
  }));
  const after=await page.evaluate(()=>window.BodyTraceVoiceLab.state());
  if(before.pitchPoints!==after.pitchPoints||after.latestNote!=="E4"||
     (await page.locator("#voicePitchNote").innerText())!=="E4")
   throw Error("Pitch history must FREEZE across silence; never erase last note");
  await page.locator("#voicePitchStop").click();
  await page.evaluate(()=>window.bodyTraceReceive({
    type:"voice_lab",state:"stopped",mode:"pitch",message:"已停止"
  }));
  if((await page.locator("#voicePitchNote").innerText())!=="E4")
   throw Error("Stopping pitch capture must preserve last detected note");
  await page.screenshot({path:"bodytrace-voice-pitch-preview.png",fullPage:false});

  await page.locator("#voicePhonemeTab").click();
  if(!await page.locator("#voicePhonemeView").isVisible()||
     await page.locator("#voicePitchView").isVisible())
   throw Error("Pitch and phoneme must be separate subpanels");
  const hold=page.locator("#voicePhonemeHold");
  await hold.dispatchEvent("pointerdown",{pointerId:7});
  if((await page.evaluate(()=>window.__labMock.started.at(-1)))!=="phoneme")
   throw Error("Holding button should START whole-utterance PCM recording");
  if((await page.locator("#voicePhonemeState").innerText())!=="录音中")
   throw Error("Phoneme mode should not run continuous classifications");
  await hold.dispatchEvent("pointerup",{pointerId:7});
  if((await page.evaluate(()=>window.__labMock.finished))!==1)
   throw Error("Releasing button must finalize and analyse recorded utterance");
  await page.evaluate(()=>window.bodyTraceReceive({
    type:"voice_lab",state:"phoneme_result",mode:"phoneme",
    duration_ms:610,engine_kind:"neural_ctc",language:"en",
    engine_id:"zipa-cr-small-500k",dictionary_entries:45000,
    message:"ZIPA 声学音素已识别，英汉词典已匹配整段 IPA",
    candidates:[{ipa:"θ"},{ipa:"ɪ"},{ipa:"ŋ"},{ipa:"k"}],
    word_matches:[
      {word:"think",ipa:"θɪŋk",zh:"认为；思考",exact:true,phone_similarity:100},
      {word:"thing",ipa:"θɪŋ",zh:"事物；事情",exact:false,phone_similarity:75}
    ],warning:"词典匹配不是发音评分"
  }));
  const held=await page.locator("#voicePhonemeSequence").textContent();
  if(held.replace(/\s+/g,"")!=="θɪŋk")
   throw Error("Keep the original ZIPA IPA phones, without English ASR");
  const firstWordMatch=page.locator("#voiceWordMatches .voice-word-match").first();
  if(!(await firstWordMatch.innerText()).includes("think")||
     !(await firstWordMatch.innerText()).includes("思考")||
     !(await firstWordMatch.innerText()).includes("完整音素匹配"))
   throw Error("Reverse whole-utterance IPA lookup must show think + its Chinese meaning");
  if((await page.locator("#voiceWordMatches").innerText()).includes("sit、ship"))
   throw Error("Single-phone example spam must not appear in dictionary results");
  await page.evaluate(()=>window.bodyTraceReceive({
    type:"voice_lab",state:"stopped",mode:"phoneme",message:"已停止"
  }));
  if((await page.locator("#voicePhonemeSequence").textContent())!==held||
     !(await page.locator("#voicePhonemeState").innerText()).includes("已完成"))
   throw Error("A phoneme result must survive mic shutdown after release");
  await page.screenshot({path:"bodytrace-voice-phoneme-preview.png",fullPage:false});
  await page.locator("#voicePhoneDisplay").selectOption("zh");
  await page.evaluate(()=>window.bodyTraceReceive({
    type:"voice_lab",state:"phoneme_result",mode:"phoneme",
    duration_ms:1580,engine_kind:"neural_ctc",language:"zh",
    engine_id:"zipa-cr-small-ns-700k",
    candidates:[{ipa:"n"},{ipa:"i"},{ipa:"x"},{ipa:"ɑ"},{ipa:"ʊ"}],
    word_matches:[],
    mandarin_note:"仅 IPA：不依据单音素臆测汉字或声调"
  }));
  if(!(await page.locator("#voicePhonemeEnglishBox").isHidden())||
      await page.locator("#voicePhonemePinyinBox").isHidden())
   throw Error("Mandarin mode must not reuse English lexicon results");
  if((await page.locator("#voicePhonemePinyin").innerText()).includes("你")||
      (await page.locator("#voicePhonemePinyin").innerText()).includes("妈"))
   throw Error("Mandarin mode must not invent example Chinese words or tones");
  await page.locator("#voicePhoneDisplay").selectOption("en");
  // The Mandarin regression above replaced the original think result; compare
  // against the MOST RECENT real result, not an older snapshot.
  const mostRecentPhones=await page.locator("#voicePhonemeSequence").textContent();
  await page.locator('.tabs button[data-page="sleep"]').click();
  // innerText() is empty for hidden tabs, but textContent must be preserved.
  if((await page.locator("#voicePhonemeSequence").textContent())!==mostRecentPhones)
   throw Error("Last analysis must survive navigation");
  await page.screenshot({path:"bodytrace-phone-sleep-report-preview.png",fullPage:false});
  await page.screenshot({path:"bodytrace-sleep-detection-preview.png",fullPage:true});
  // Historical daily drill-down: all sets per date and max 10 past dates
  // for each of today's four actions, without mixing other exercise IDs.
  await page.evaluate(()=>{
   const current={schema_version:2,date:"2026-11-20",
    workouts:[
     {id:"64007ed2-e1ad-49c5-88b0-d3959b3c0001",exercise_id:"hip_thrust",load_kg:70,reps:10},
     {id:"64007ed2-e1ad-49c5-88b0-d3959b3c0002",exercise_id:"chest_press",load_kg:35,reps:10},
     {id:"64007ed2-e1ad-49c5-88b0-d3959b3c0003",exercise_id:"row",load_kg:40,reps:12},
     {id:"64007ed2-e1ad-49c5-88b0-d3959b3c0004",exercise_id:"shoulder_press",load_kg:15,reps:8}
    ],nutrition:[],measurements:[]};
   window.__previewDays.push(current);
   for(let i=1;i<=11;i++){
    const day="2026-11-"+String(i).padStart(2,"0");
    window.__previewDays.push({schema_version:2,date:day,
     workouts:[
      {id:"a0000000-0000-4000-8000-"+String(i).padStart(12,"0"),
       exercise_id:"hip_thrust",load_kg:20+i,reps:10},
      {id:"b0000000-0000-4000-8000-"+String(i).padStart(12,"0"),
       exercise_id:"hip_thrust",load_kg:25+i,reps:8},
      {id:"c0000000-0000-4000-8000-"+String(i).padStart(12,"0"),
       exercise_id:"chest_press",load_kg:30+i,reps:12}
     ],nutrition:[],measurements:[]});
   }
   window.bodyTraceReceive({type:"data",cached:true,days:window.__previewDays});
   state.calendarBrowsing=true;state.selected="2026-11-20";renderHeat();renderDay();
   navigate("home");
  });
  const hips=page.locator('#dayDetails .exercise[data-exercise-id="hip_thrust"]');
  const hipDates=hips.locator(".exercise-history-date");
  if(await hipDates.count()!==10)
   throw Error("Expected exactly ten historical hip-thrust DATES");
  const firstDate=await hipDates.first().locator("strong").innerText();
  const lastDate=await hipDates.last().locator("strong").innerText();
  if(firstDate!=="2026-11-11"||lastDate!=="2026-11-02")
   throw Error("Historical dates must be newest first: "+firstDate+"/"+lastDate);
  if(await hipDates.first().locator(".exercise-history-set").count()!==2)
   throw Error("History must show all sets on one previous date");
  if(await page.locator("#dayDetails > .exercise").count()!==4)
   throw Error("Selected day must retain exactly four exercise sections");
  const chestHistory=page.locator('#dayDetails .exercise[data-exercise-id="chest_press"]');
  if(await chestHistory.locator(".exercise-history-date").count()!==10 ||
    await chestHistory.locator(".exercise-history-set").count()!==10)
   throw Error("Other current-day action should get its own independent history");
  if(await page.locator('#dayDetails .exercise[data-exercise-id="row"] .exercise-history-date').count()!==1)
   throw Error("Row has one old history date from the earlier test fixture");
  // One button hides all historical groups, for EVERY selected day.
  // It is persisted through the native bridge and restored on app startup.
  await page.evaluate(()=>{
   window.__historyPrefWrites=[];
   window.BodyTraceNative.setWorkoutHistoryVisible=shown=>
    window.__historyPrefWrites.push(shown);
   window.bodyTraceReceive({type:"ui_preferences",show_workout_history:true});
  });
  if(await page.locator("#toggleHistory").innerText()!=="收起全部历史")
   throw Error("History default must be open");
  await page.locator("#toggleHistory").click();
  if(await page.locator("#dayDetails .exercise-history").count())
   throw Error("Global hide must remove all historical sessions, not today's workouts");
  if(await page.locator("#dayDetails > .exercise").count()!==4)
   throw Error("Hiding history must preserve four current-day movements");
  if((await page.evaluate(()=>window.__historyPrefWrites.at(-1)))!==false)
   throw Error("History hidden choice not saved into the native preference bridge");
  await page.evaluate(()=>{
   state.selected="2026-11-11";renderDay();
   window.bodyTraceReceive({type:"ui_preferences",show_workout_history:false});
  });
  if(await page.locator("#dayDetails .exercise-history").count())
   throw Error("Pref restored off must apply to other dates");
  if(await page.locator("#toggleHistory").innerText()!=="展开全部历史")
   throw Error("Persisted off preference must update toggle label");
  await page.locator("#toggleHistory").click();
  if((await page.evaluate(()=>window.__historyPrefWrites.at(-1)))!==true)
   throw Error("History on choice not written to native preference bridge");
  if(await page.locator("#dayDetails .exercise-history").count()===0)
   throw Error("Enabling global histories must restore historical sessions");
  await page.evaluate(()=>{state.selected="2026-11-20";renderDay();});
  if(await page.locator('#dayDetails .exercise[data-exercise-id="hip_thrust"] .exercise-history-date').count()!==10)
   throw Error("Restored history must still include the last ten hip-thrust dates");
  // Selecting a hip thrust dot then editing it must generate an immutable
  // correction payload with old UUID, not rewrite/remove source HTML rows.
  await page.evaluate(()=>{
   window.__editPayloads=[];
   window.BodyTraceNative.editWorkout=raw=>window.__editPayloads.push(JSON.parse(raw));
   navigate("analytics");
  });
  const hipChart=page.locator('#strengthList [data-exercise-id="hip_thrust"]');
  const hipRecent=hipChart.locator(".strength-recent-set");
  await hipRecent.first().click();
  await hipChart.locator(".strength-edit-action").click();
  if(await page.locator("#workoutEditOverlay").isHidden())
   throw Error("Selected trend point did not open manual edit dialog");
  const selectedId=await page.locator("#workoutEditIdentity").innerText();
  if(!selectedId.includes("2026-11-20"))
   throw Error("Edit modal did not retain chosen training date: "+selectedId);
  await page.fill("#workoutEditKg","80");
  await page.fill("#workoutEditReps","6");
  await page.fill("#workoutEditCopies","2");
  await page.fill("#workoutEditNote","更新后训练组");
  await page.locator("#workoutEditSave").click();
  const correction=await page.evaluate(()=>window.__editPayloads[0]);
  if(correction?.target_id!=="64007ed2-e1ad-49c5-88b0-d3959b3c0001" ||
    correction.date!=="2026-11-20"||correction.action!=="replace"||
    correction.load_kg!==80||correction.reps!==6||correction.copies!==2||
    correction.note!=="更新后训练组")
   throw Error("Trend editor must persist exact correction event: "+JSON.stringify(correction));
  // Native projects the immutable edit log into effective rows and replies
  // with view_model. Simulate that projection without updating source JSON.
  await page.evaluate(()=>{
   const old=state.rows.map(row=>({...row}));
   const key="64007ed2-e1ad-49c5-88b0-d3959b3c0001";
   const current=old.find(row=>row.id===key);
   current.load_kg="80";current.reps="6";current.note="更新后训练组";
   old.push({...current,id:"64007ed2-e1ad-49c5-88b0-d3959b3c0009"});
   window.__effectiveTestRows=old;
   window.bodyTraceReceive({type:"workout_edit_local_saved",
     event:{type:"workout_edit",action:"replace",target_id:key,id:"demo-edit"},
     count:1,
     view_model:{view_schema_version:1,workouts:old,
      measurements:state.measurements,nutrition:state.nutrition}});
  });
  if(!(await page.locator("#workoutEditOverlay").isHidden()))
   throw Error("Edit modal should close on confirmed native saved event");
  const afterHip=page.locator('#strengthList [data-exercise-id="hip_thrust"]');
  if(await afterHip.locator(".strength-visible-point").count()!==24)
   throw Error("Editing one group to two did not add exactly one effective workout point");
  await afterHip.locator(".strength-recent-set").first().click();
  await afterHip.locator(".strength-edit-action").click();
  await page.locator("#workoutEditDelete").click();
  const armed=await page.locator("#workoutEditDelete").innerText();
  if(!armed.includes("确认删除")||(await page.evaluate(()=>window.__editPayloads.length))!==1)
   throw Error("Workout deletion must require two clicks");
  await page.locator("#workoutEditDelete").click();
  const deletion=await page.evaluate(()=>window.__editPayloads[1]);
  if(deletion?.action!=="delete"||deletion.date!=="2026-11-20")
   throw Error("Delete must reference the selected saved UUID: "+JSON.stringify(deletion));
  await page.evaluate(op=>{
   const rows=window.__effectiveTestRows.filter(x=>x.id!==op.target_id);
   window.__effectiveTestRows=rows;
   window.bodyTraceReceive({type:"workout_edit_local_saved",event:op,count:1,
    view_model:{view_schema_version:1,workouts:rows,
     measurements:state.measurements,nutrition:state.nutrition}});
   // Re-pulling the SAME effective data must not resurrect deleted UUID.
   window.bodyTraceReceive({type:"data",cached:false,
    view_model:{view_schema_version:1,workouts:rows,
     measurements:state.measurements,nutrition:state.nutrition}});
  },deletion);
  const removed=await page.evaluate(id=>state.rows.some(row=>row.id===id),deletion.target_id);
  if(removed)throw Error("Deleted workout point resurrected on simulated GitHub sync");
  await page.screenshot({path:"bodytrace-historical-workout-and-edit-preview.png",fullPage:true});
  if(errors.length)throw Error("Browser JavaScript errors: "+errors.join(" | "));
  console.log("PASS: 2 schematic figures, "+plots+" recent-first charts, group labels, ruler, batch/measurement JSON");
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

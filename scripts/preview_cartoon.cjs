// Chromium visual/interaction smoke test for the actual Android WebView UI.
// Sample values are synthetic, NOT written to the user's GitHub health JSON.
"use strict";
const {chromium}=require("playwright");
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,"app/src/main/assets",name),"utf8");
let html=read("index.html");
html=html.replace("</head>","<style>"+read("features.css")+"</style></head>");
html=html.replace("</body>","<script>"+read("wheel.js")+"\n"+read("features.js")+"\n"+read("exercise_catalog.js")+"\n"+read("git_log.js")+"</script></body>");
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
  await page.evaluate(()=>navigate("analytics"));
  const ordered=await page.locator("#strengthList .strength-exercise-card").evaluateAll(
   cards=>cards.map(card=>card.dataset.exerciseId));
  const wanted=["adductor","lateral_raise","chest_press","row"];
  if(JSON.stringify(ordered)!==JSON.stringify(wanted))
   throw Error("Trend cards not recent-first: "+JSON.stringify(ordered));
  if(await page.locator("#analyticsExercise").count())throw Error("Trend dropdown still visible");
  const plots=await page.locator("#strengthList .feature-chart svg").count();
  if(plots!==4)throw Error("Expected every recorded exercise to have a chart: "+plots);
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
  // Restore the baseline fixture after failure-point tests: subsequent
  // recording tests intentionally check the original recent-first leg choice.
  await page.evaluate(()=>{
   window.__previewDays=window.__previewDays.filter(day=>
    !day.workouts?.some(w=>String(w.id).startsWith("demo-shoulder-")));
   window.bodyTraceReceive({type:"data",cached:true,days:window.__previewDays});
  });
  const overview=await page.locator("#regionTrendGrid .region-overview-card").evaluateAll(
   nodes=>nodes.map(node=>node.dataset.region));
  if(JSON.stringify(overview)!==JSON.stringify(["胸","肩","背","腿"]))
   throw Error("Four-region dashboard is incomplete: "+JSON.stringify(overview));
  const cardPalette=await page.locator("#regionTrendGrid .region-overview-card").evaluateAll(
    nodes=>nodes.map(n=>getComputedStyle(n.querySelector(".region-overview-count")).color));
  if(new Set(cardPalette).size!==4)throw Error("Four dashboard colors must be distinct: "+cardPalette);
  const sparks=await page.locator("#regionTrendGrid .region-overview-spark rect").count();
  if(sparks!==32)throw Error("Each region must have eight weekly bars: "+sparks);
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
  // Settings are Git-log-first and render colored unified diffs without any disclosures.
  await page.evaluate(()=>{
   navigate("settings");
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
  if(errors.length)throw Error("Browser JavaScript errors: "+errors.join(" | "));
  console.log("PASS: 2 schematic figures, "+plots+" recent-first charts, group labels, ruler, batch/measurement JSON");
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

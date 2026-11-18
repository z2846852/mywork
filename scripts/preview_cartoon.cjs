// Chromium visual/interaction smoke test for the actual Android WebView UI.
// Sample values are synthetic, NOT written to the user's GitHub health JSON.
"use strict";
const {chromium}=require("playwright");
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,"app/src/main/assets",name),"utf8");
let html=read("index.html");
html=html.replace("</head>","<style>"+read("features.css")+"</style></head>");
html=html.replace("</body>","<script>"+read("wheel.js")+"\n"+read("features.js")+"\n"+read("exercise_catalog.js")+"</script></body>");
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const page=await browser.newPage({viewport:{width:390,height:900},deviceScaleFactor:2});
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
  await page.setContent(html,{waitUntil:"load"});
  await page.evaluate(()=>{
   window.bodyTraceReceive({type:"data",cached:true,days:[
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
   ]});
   navigate("body");
  });
  const bodies=await page.locator("#bodyMuscleView .muscle-person svg").count();
  if(bodies!==2)throw Error("Expected front/back simple body outlines: "+bodies);
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
  await page.screenshot({path:"bodytrace-trends-preview.png",fullPage:true});
  await page.evaluate(()=>{
   window.BodyTraceNative={
    saveBatch:json=>{window.__capturedWorkout=JSON.parse(json)},
    saveMeasurement:json=>{window.__capturedBody=JSON.parse(json)},
    saveCatalog:json=>{window.__capturedCatalog=JSON.parse(json)}
   };
   navigate("record");
  });
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
  await page.click("#recordKg");
  if(await page.$eval("#wheelOverlay",x=>x.hidden))throw Error("Weight ruler did not open");
  await page.screenshot({path:"bodytrace-wheel-preview.png",fullPage:false});
  await page.fill("#wheelValue","27.5");
  await page.click("#wheelDone");
  await page.click("#recordSets");
  await page.fill("#wheelValue","3");
  await page.click("#wheelDone");
  await page.click("#saveRecord");
  const workout=await page.evaluate(()=>window.__capturedWorkout);
  if(!workout||workout.kg!==27.5||workout.sets!==3||workout.exercise_id!=="adductor")
   throw Error("Workout ruler/batch JSON mismatch: "+JSON.stringify(workout));
  await page.evaluate(()=>navigate("body"));
  await page.locator("#bodyEntryGrid .body-entry-metric").first().click();
  await page.fill("#wheelValue","74.5");
  await page.click("#wheelDone");
  await page.click("#bodySaveMeasurement");
  const measured=await page.evaluate(()=>window.__capturedBody);
  if(!measured||measured.weight_kg!==74.5||"shoulder_cm" in measured)
   throw Error("Body JSON should contain edited values only: "+JSON.stringify(measured));
  if(errors.length)throw Error("Browser JavaScript errors: "+errors.join(" | "));
  console.log("PASS: 2 schematic figures, "+plots+" recent-first charts, group labels, ruler, batch/measurement JSON");
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

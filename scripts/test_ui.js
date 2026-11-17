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
assert.ok(html.includes('id="recordReps" type="number" min="1" max="200" step="1" inputmode="numeric" value="10"'));
assert.ok(html.includes('id="heatScroll"'));
assert.ok(html.includes('state.selected=ds.at(-1)||today;renderHeat(true)'));
const scrollHelper = script.slice(script.indexOf("function focusCalendarLatest()"),
  script.indexOf("function weight(r)"));
const scroll={scrollWidth:1200,clientWidth:300,scrollLeft:0};
vm.runInNewContext(scrollHelper+"\nfocusCalendarLatest();",{
  $:id=>id==="heatScroll"?scroll:null,requestAnimationFrame:callback=>callback()
});
assert.equal(scroll.scrollLeft,900);
// Cartoon-first contract: UI must not load the eerie MakeHuman renderer.
const asset=fs.readFileSync(path.join(root,"app/src/main/assets/avatar_cartoon.svg"),"utf8");
const features=fs.readFileSync(path.join(root,"app/src/main/assets/features.js"),"utf8");
const native=fs.readFileSync(path.join(root,
  "app/src/main/java/com/z2846852/bodytrace/MainActivity.java"),"utf8");
const workflow=fs.readFileSync(path.join(root,".github/workflows/android.yml"),"utf8");
assert.ok(asset.startsWith("<svg ")&&asset.includes("</svg>")&&asset.includes('viewBox="0 0 600 900"'),
 "Cartoon vector must exist and scale cleanly");
assert.ok(!/<script\b/i.test(asset)&&!/https?:\/\//i.test(asset.replace("http://www.w3.org/2000/svg","")),
 "Bundled cartoon artwork must not execute code or load remote content");
new vm.Script(features,{filename:"features.js"});
assert.ok(html.includes('id="avatarPicture"'),"2D character image missing");
assert.ok(html.includes('id="avatarImport"'),"User needs high-res import button");
assert.ok(html.includes('id="avatarMeasureDate"'),"Measurements must remain date-selectable");
assert.ok(!html.includes('id="avatar3dCanvas"'),"Uncanny old 3D renderer must not appear");
assert.ok(!features.includes("bootMakeHuman")&&!features.includes("BodyTraceReal3D"),
 "No 3D startup or 3D model loading in the default body page");
assert.ok(features.includes("avatar_imported")&&features.includes("renderAvatar()"),
 "Date and custom image updates must work");
assert.ok(native.includes('readAssetBytes("avatar_cartoon.svg")'),"Native must use cartoon SVG as default");
assert.ok(native.includes('new File(getFilesDir(), "resource_library/avatar")'),
 "User-selected image must survive ordinary APK upgrades");
assert.ok(native.includes('readAsset("features.js")')&&!native.includes('readAsset("makehuman3d.bundle.js")'),
 "Default App must not load the massive GLB or Three.js bundle");
assert.ok(workflow.includes("app:assembleRelease")&&workflow.includes("Load fixed public signing identity"),
 "New APK must keep the permanent release signing key");
console.log("BodyTrace cartoon-first UI tests passed: 2D avatar, date-driven body stats, persisted custom image and stable Release signing.");

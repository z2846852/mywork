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
// Verify actual WebGL rendering + camera orbit + geometry responding to measurements.
// A PNG-only toggle must not satisfy this regression test.
const engineText = fs.readFileSync(path.join(root, "app/src/main/assets/body3d.js"), "utf8");
const featuresText = fs.readFileSync(path.join(root, "app/src/main/assets/features.js"), "utf8");
new vm.Script(engineText);
new vm.Script(featuresText);
assert.ok(html.includes('id="avatar3dCanvas"'));
assert.ok(html.includes('avatar3dMode'));
assert.ok(featuresText.includes("avatar3d.setMeasurements(shape)"));
const calls={models:[],mvps:[],draws:0};
const fakeGl={
 VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,
 ARRAY_BUFFER:5,ELEMENT_ARRAY_BUFFER:6,STATIC_DRAW:7,FLOAT:8,
 TRIANGLES:9,UNSIGNED_SHORT:10,DEPTH_TEST:11,LEQUAL:12,
 COLOR_BUFFER_BIT:13,DEPTH_BUFFER_BIT:14,
 createShader(){return{}},shaderSource(){},compileShader(){},getShaderParameter(){return true},
 createProgram(){return{}},attachShader(){},linkProgram(){},getProgramParameter(){return true},
 useProgram(){},createBuffer(){return{}},bindBuffer(){},bufferData(){},
 getAttribLocation(){return 0},getUniformLocation(_,name){return name},
 enableVertexAttribArray(){},vertexAttribPointer(){},enable(){},depthFunc(){},
 viewport(){},clearColor(){},clear(){},uniformMatrix3fv(){},uniform3fv(){},
 uniformMatrix4fv(name,transpose,value){
  if(name==="uModel")calls.models.push(Array.from(value));
  if(name==="uMvp")calls.mvps.push(Array.from(value));
 },drawElements(){calls.draws++}
};
const view={devicePixelRatio:1};
vm.runInNewContext(engineText,{window:view,Math,Float32Array,Uint16Array});
assert.equal(typeof view.BodyTrace3D.mount,"function");
const canvas={
 clientWidth:340,clientHeight:480,isConnected:true,
 style:{},getContext(type){assert.equal(type,"webgl");return fakeGl},
 addEventListener(){},setPointerCapture(){}
};
const body3d=view.BodyTrace3D.mount(canvas);
body3d.setMeasurements({height_cm:173.5,chest_cm:90.2,waist_cm:84});
assert.ok(calls.draws>10,"3D engine should issue multiple actual draw calls");
const firstChest=calls.models[0][0];
const firstMvp=calls.mvps[0].join(",");
calls.models.length=0;calls.mvps.length=0;
body3d.setMeasurements({height_cm:173.5,chest_cm:105,waist_cm:92});
assert.ok(calls.models[0][0]>firstChest,
  "A larger chest measurement must make the 3D mesh wider");
body3d.setView("back");
assert.ok(Math.abs(body3d.getYaw()-Math.PI)<.0001);
body3d.rotate(32);
assert.notEqual(body3d.getYaw(),Math.PI);
assert.notEqual(calls.mvps.at(-1).join(","),firstMvp,
  "Rotating the camera must change 3D projection, not swap 2D images");

console.log("BodyTrace tests passed: 3D WebGL draw, data-driven mesh scaling, free camera rotation, default values, and heatmap.");

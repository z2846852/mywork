// Pre-release verification of CC0 GLB files and offline renderer packaging.
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),crypto=require("node:crypto"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const catalog=JSON.parse(fs.readFileSync(path.join(root,"models/free/catalog.json"),"utf8"));
const bodySet=catalog.candidates.find(x=>x.id==="makehuman-parametric");
assert.ok(bodySet&&bodySet.files.length>=5,"missing licensed MakeHuman asset catalog");
const manifest=[];
for(const item of bodySet.files){
 const data=fs.readFileSync(path.join(root,item.path));
 const digest=crypto.createHash("sha1").update("blob "+data.length+"\0").update(data).digest("hex");
 assert.equal(digest,item.git_blob_sha1,"upstream SHA mismatch: "+item.path);
 if(item.size_bytes)assert.equal(data.length,item.size_bytes,"size mismatch: "+item.path);
 if(item.path.endsWith(".glb")){
  assert.equal(data.toString("ascii",0,4),"glTF","not glTF2 binary: "+item.path);
  assert.equal(data.readUInt32LE(4),2,"not glTF v2");
  assert.equal(data.readUInt32LE(8),data.length,"corrupt GLB length");
  assert.equal(data.toString("ascii",16,20),"JSON","GLB JSON chunk absent");
  const json=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString("utf8"));
  assert.ok(json.meshes?.length>0,"GLB has no geometry");
  if(item.path.endsWith("base_body.glb")){
   assert.ok(json.skins?.length>0,"base body needs skeletal skin");
   const count=Math.max(...json.meshes.flatMap(m=>m.primitives.map(p=>p.targets?.length||0)));
   assert.ok(count>=80,"expected morph targets for body shape");
   const names=json.meshes.flatMap(m=>m.extras?.targetNames||[]);
   assert.ok(names.includes("gender_male"),"named gender_male morph required");
   assert.ok(names.includes("weight_max")&&names.includes("weight_min"),
     "weight morph targets required");
   const defaults=json.meshes.flatMap(m=>m.weights||[]);
   if(defaults.some(v=>v!==0)){
     const viewer=fs.readFileSync(path.join(root,"scripts/makehuman_viewer.mjs"),"utf8");
     assert.ok(viewer.includes("o.morphTargetInfluences.fill(0)"),
       "Source GLB activates morphs by default; runtime must reset ALL channels");
     console.log("Source GLB morph defaults require explicit reset:",defaults.slice(0,8));
   }
   console.log("Body geometry:",json.meshes.length,"meshes,",count,"targets,",json.skins.length,"skin(s)");
   console.log("Morph names:",names.slice(0,14).join(", "));
  }
  manifest.push({file:path.basename(item.path),meshes:json.meshes.length,skins:json.skins?.length||0});
 }
}
const bundled=path.join(root,"app/src/main/assets/makehuman3d.bundle.js");
assert.ok(fs.statSync(bundled).size>100_000,"missing standalone Three.js renderer bundle");
const native=fs.readFileSync(path.join(root,"app/src/main/java/com/z2846852/bodytrace/MainActivity.java"),"utf8");
const features=fs.readFileSync(path.join(root,"app/src/main/assets/features.js"),"utf8");
for(const name of ["base_body.glb","hair_short02.glb","clothing_shorts.glb","clothing_shoes.glb"]){
 assert.ok(native.includes(name),"native APK must embed "+name);
 assert.ok(fs.existsSync(path.join(root,"app/src/main/assets/makehuman",name)),"APK asset missing "+name);
}
assert.ok(native.includes('readAsset("makehuman3d.bundle.js")'),
 "Native must load Three.js bundle");
assert.ok(!native.includes('readAsset("body3d.js")'),
 "Old procedural ellipsoid model must not be loaded");
assert.ok(features.includes("window.BodyTraceReal3D"),
 "Body page must mount real GLTFViewer");
assert.ok(features.includes("avatar3d.setMeasurements(shape)"),
 "Body date must drive mesh changes");
console.log("MakeHuman asset integrity and offline APK integration OK:",JSON.stringify(manifest));

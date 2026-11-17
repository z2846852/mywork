/* BodyTrace MakeHuman viewer. Own implementation; 3D assets: CC0, Three.js: MIT.
 * Uses actual glTF2 skinned meshes and morph targets. No runtime network calls.
 * Measurement-driven outline is an approximation, not a personal 3D scan.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const LIMIT = (v,a,b)=>Math.max(a,Math.min(b,v));
const DEBUG = window.__BT_DEBUG__||{};
const BASE = Object.freeze({
 height_cm:173.5,weight_kg:68.5,shoulder_cm:112.1,chest_cm:90.2,
 waist_cm:84.0,hip_cm:93.0,upper_arm_cm:27.5,thigh_cm:53.9,calf_cm:39.5
});
const n=(v,def)=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):def;
const fade=(a,b,x)=>{
 const t=LIMIT((x-a)/(b-a),0,1);return t*t*(3-2*t);
};
const band=(y,a,b,feather=.05)=>fade(a,a+feather,y)*(1-fade(b-feather,b,y));
function circumferenceRatio(measures,key){
 return LIMIT(n(measures[key],BASE[key])/BASE[key],.84,1.17);
}
function shapeAdjust(y,x,z,kind,r){
 const waist=band(y,.96,1.14),chest=band(y,1.13,1.37);
 const shoulder=band(y,1.26,1.48),hip=band(y,.75,1.02);
 const thigh=band(y,.49,.84),calf=band(y,.15,.52);
 const arm=band(y,.88,1.36)*fade(.21,.34,Math.abs(x));
 const torso=1-fade(.23,.34,Math.abs(x));
 const leg=1-fade(.26,.38,Math.abs(x));
 // Scale both front/back depth and width. The original mesh topology is preserved.
 const xscale = 1+(r.chest-1)*chest*torso*.7+
   (r.waist-1)*waist*torso*.82+
   (r.hip-1)*hip*torso*.88+
   (r.shoulder-1)*shoulder*torso*.48+
   (r.thigh-1)*thigh*leg*.28+
   (r.calf-1)*calf*leg*.25;
 const zscale = 1+(r.chest-1)*chest*torso*.83+
   (r.waist-1)*waist*torso*.8+
   (r.hip-1)*hip*torso*.75+
   (r.thigh-1)*thigh*leg*.30+
   (r.calf-1)*calf*leg*.30;
 const armFactor=(r.arm-1)*arm*.55;
 const centeredX=Math.sign(x)*.30;
 const newX=x*xscale+(x-centeredX)*armFactor;
 const newZ=z*zscale+z*armFactor;
 return [newX,y,newZ];
}
function decodeGLB64(encoded){
 if(!encoded||typeof encoded!=="string")throw Error("模型资源缺失");
 const raw=atob(encoded),out=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
 if(out[0]!==0x67||out[1]!==0x6c||out[2]!==0x54||out[3]!==0x46)
  throw Error("不是有效的 GLB 二进制文件");
 return out.buffer;
}
function parseGLB(loader,base64){
 const buffer=decodeGLB64(base64);
 return new Promise((resolve,reject)=>loader.parse(buffer,"",resolve,reject));
}
function allMeshes(root){const out=[];root.traverse(o=>{if(o.isMesh)out.push(o)});return out}
function primarySkinnedBody(root){
 let body=null;
 root.traverse(o=>{if(o.isSkinnedMesh&&(o.name==="Body"||o.name.startsWith("Body_")))body=o});
 if(!body)root.traverse(o=>{if(!body&&o.isSkinnedMesh&&o.morphTargetDictionary)body=o});
 return body;
}
function setMappedMorphs(root,controls){
 const male=1;
 const weight=LIMIT((n(controls.weight_kg,68.5)-68.5)/27,-.68,.68);
 const muscle=LIMIT(0.12+(n(controls.chest_cm,90.2)-90.2)/130,-.05,.24);
 const map={
  gender_male:male,gender_female:0,
  weight_max:Math.max(0,weight),weight_min:Math.max(0,-weight),
  muscle_max:Math.max(0,muscle),muscle_min:Math.max(0,-muscle),
  proportions_ideal:0.12,proportions_uncommon:0,
  age_child:0,age_old:0,height_tall:0,height_short:0
 };
 map.corr_gender_male__weight_max=map.weight_max;
 map.corr_gender_male__weight_min=map.weight_min;
 map.corr_gender_male__muscle_max=map.muscle_max;
 map.corr_gender_male__muscle_min=map.muscle_min;
 map.corr_weight_max__muscle_max=map.weight_max*map.muscle_max;
 map.corr_weight_min__muscle_max=map.weight_min*map.muscle_max;
 if(DEBUG.forceMorph)Object.assign(map,DEBUG.forceMorph);
 root.traverse(o=>{
  if(!o.isMesh||!o.morphTargetDictionary||!o.morphTargetInfluences)return;
  for(const [key,value] of Object.entries(map)){
   const id=o.morphTargetDictionary[key];
   if(id!==undefined)o.morphTargetInfluences[id]=value;
  }
 });
}
function enableLocalDeformation(root,kind){
 root.traverse(o=>{
  if(!o.isSkinnedMesh||!o.geometry?.attributes?.position)return;
  if(kind==="body"&&o.name!=="Body"&&!o.name.startsWith("Body_"))return;
  const geometry=o.geometry.clone();
  const pos=geometry.attributes.position;
  // glTF quantization may use normalized attributes; convert to Float32 to
  // preserve units and enable smooth CPU-side contour edits.
  const base=new Float32Array(pos.count*3);
  for(let i=0;i<pos.count;i++){
   base[i*3]=pos.getX(i);base[i*3+1]=pos.getY(i);base[i*3+2]=pos.getZ(i);
  }
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(base.slice(),3));
  o.geometry=geometry;
  o.userData.btDeformBase=base;
 });
}
function deformTo(root,kind,measurements){
 const r={
  shoulder:circumferenceRatio(measurements,"shoulder_cm"),
  chest:circumferenceRatio(measurements,"chest_cm"),
  waist:circumferenceRatio(measurements,"waist_cm"),
  hip:circumferenceRatio(measurements,"hip_cm"),
  arm:circumferenceRatio(measurements,"upper_arm_cm"),
  thigh:circumferenceRatio(measurements,"thigh_cm"),
  calf:circumferenceRatio(measurements,"calf_cm")
 };
 root.traverse(o=>{
  const base=o.userData.btDeformBase;
  if(!base||!o.geometry?.attributes?.position)return;
  const p=o.geometry.attributes.position;
  const array=p.array;
  for(let i=0;i<base.length;i+=3){
   const next=shapeAdjust(base[i+1],base[i],base[i+2],kind,r);
   array[i]=next[0];array[i+1]=next[1];array[i+2]=next[2];
  }
  p.needsUpdate=true;
  o.geometry.computeBoundingSphere();
  // Original normals are still a reasonable approximation for subtle changes.
 });
}
function rebindToBody(root,body){
 const bones=body.skeleton.bones;
 const byName=new Map(bones.map((bone,i)=>[bone.name,i]));
 root.traverse(mesh=>{
  if(!mesh.isSkinnedMesh||mesh===body||!mesh.skeleton)return;
  if(mesh.skeleton===body.skeleton)return;
  const old=mesh.skeleton.bones;
  const attribute=mesh.geometry.getAttribute("skinIndex");
  if(!attribute)return;
  const lookup=[];
  for(const bone of old){
   let id=byName.get(bone.name);
   if(id===undefined){
    const clean=bone.name.replace(/^(mixamorig:|Armature\/)/,"");
    id=byName.get(clean);
   }
   if(id===undefined)return; // keep original skin if incompatible
   lookup.push(id);
  }
  const next=attribute.clone();
  for(let i=0;i<attribute.count;i++)
   for(let j=0;j<4;j++){
    const oldIndex=attribute.getComponent(i,j);
    next.setComponent(i,j,lookup[oldIndex]??0);
   }
  mesh.geometry=mesh.geometry.clone();
  mesh.geometry.setAttribute("skinIndex",next);
  mesh.bind(body.skeleton,body.bindMatrix);
  mesh.bindMode=body.bindMode;
 });
}
function makeStudio(renderer,scene){
 const env=new RoomEnvironment();
 const generator=new THREE.PMREMGenerator(renderer);
 const target=generator.fromScene(env,0.08);
 scene.environment=target.texture;
 env.dispose();generator.dispose();
 scene.add(new THREE.HemisphereLight(0xe2f6f0,0x3e413b,2.1));
 function key(color,intensity,x,y,z){
  const light=new THREE.DirectionalLight(color,intensity);
  light.position.set(x,y,z);scene.add(light);return light;
 }
 const main=key(0xffead9,2.6,-2.8,4.2,3.3);
 main.castShadow=true;
 main.shadow.mapSize.set(1024,1024);
 main.shadow.camera.left=-2;main.shadow.camera.right=2;
 main.shadow.camera.top=3;main.shadow.camera.bottom=-1;
 main.shadow.bias=-.0002;
 key(0xb9f1f2,1.15,3.0,2.2,-2.1);
 key(0x9bcba9,.7,-2.8,1.2,-2.0);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(18,18),
   new THREE.ShadowMaterial({opacity:.21,color:0x06130e}));
 floor.rotation.x=-Math.PI/2;floor.position.y=.001;
 floor.receiveShadow=true;scene.add(floor);
 const circle=new THREE.Mesh(new THREE.CircleGeometry(.76,64),
  new THREE.MeshBasicMaterial({color:0x61c4ab,transparent:true,opacity:.07,depthWrite:false}));
 circle.rotation.x=-Math.PI/2;circle.position.y=.008;scene.add(circle);
 return {dispose:()=>{target.dispose();floor.geometry.dispose();floor.material.dispose();circle.geometry.dispose();circle.material.dispose();}};
}
function tuneMaterials(root,role){
 root.traverse(o=>{
  if(!o.isMesh)return;
  o.castShadow=(role!=="face");
  o.receiveShadow=true;
  o.frustumCulled=false;
  const all=Array.isArray(o.material)?o.material:[o.material];
  for(const material of all){
   if(!material)continue;
   const title=(material.name||"").toLowerCase();
   if(role==="body"&&title==="skin"&&!DEBUG.noTint){
    material.color.set("#d4a68f");
    const gain=Number(material.userData?.tint?.gain);
    if(Number.isFinite(gain)&&gain>0)material.color.multiplyScalar(gain);
    material.roughness=.72;
    material.metalness=0;
   }else if(role==="hair"||title.includes("hair")){
    material.color.set("#281d19");
    material.roughness=.91;
   }else if(role==="shorts"){
    material.color.set("#222b35");
    material.roughness=.86;material.metalness=0;
   }else if(role==="shoes"){
    material.color.set("#343b46");
    material.roughness=.72;
   }
   if(material.alphaTest>0)material.alphaToCoverage=true;
   material.needsUpdate=true;
  }
 });
}
async function mount(canvas,encoded,progress=()=>{}){
 if(!canvas||!encoded)throw Error("3D 资源未找到");
 progress("正在准备离线三维画廊…");
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:"high-performance"});
 renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;
 renderer.toneMappingExposure=1.14;
 renderer.shadowMap.enabled=true;
 renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 renderer.setClearColor(0x172b28,0);
 const scene=new THREE.Scene();
 const studio=makeStudio(renderer,scene);
 const camera=new THREE.PerspectiveCamera(33,1,.05,25);
 camera.position.set(0,1.05,3.55);
 const controls=new OrbitControls(camera,canvas);
 controls.target.set(0,.9,0);
 controls.enablePan=false;
 controls.enableDamping=true;
 controls.dampingFactor=.09;
 controls.minDistance=1.9;
 controls.maxDistance=5.6;
 controls.minPolarAngle=.35;
 controls.maxPolarAngle=Math.PI-.35;
 controls.update();
 const content=new THREE.Group();scene.add(content);
 const loader=new GLTFLoader();
 progress("正在加载 MakeHuman 人体与高精度材质…");
 const base=await parseGLB(loader,encoded.body);
 const main=base.scene,body=primarySkinnedBody(main);
 if(!body||!body.morphTargetDictionary)throw Error("人体 GLB 缺少骨骼和形变目标");
 content.add(main);
 tuneMaterials(main,"body");
 if(!DEBUG.noLocalDeform)enableLocalDeformation(main,"body");
 const accepted=[];
 for(const [key,role] of [["hair","hair"],["shorts","shorts"],["shoes","shoes"]]){
  if(!encoded[key]||DEBUG.noAccessories)continue;
  progress("正在装配 "+({hair:"寸头",shorts:"运动短裤",shoes:"运动鞋"}[key])+"…");
  try{
   const item=await parseGLB(loader,encoded[key]);
   rebindToBody(item.scene,body);
   content.add(item.scene);
   tuneMaterials(item.scene,role);
   if(key==="shorts"&&!DEBUG.noLocalDeform)enableLocalDeformation(item.scene,"clothing");
   accepted.push({key,root:item.scene});
  }catch(error){
   console.warn("[BodyTrace] optional part:",key,error);
  }
 }
 const shapeObjects=[main,...accepted.map(x=>x.root)];
 const morphAvailable=Object.keys(body.morphTargetDictionary).length;
 progress("模型已载入 · "+morphAvailable+"个形变通道");
 // Body height is about 1.7m in a standardized Y-up scene.
 let bodyScale=1,measurements={},disposed=false,frame=0,interactive=true;
 const box=new THREE.Box3().setFromObject(content);
 const baselineHeight=box.max.y-box.min.y;
 if(baselineHeight>1.4&&baselineHeight<2.2)
  content.position.y=-box.min.y;
 function size(){
  const w=Math.max(1,canvas.clientWidth),h=Math.max(1,canvas.clientHeight);
  const ratio=Math.min(window.devicePixelRatio||1,2);
  renderer.setPixelRatio(ratio);renderer.setSize(w,h,false);
  camera.aspect=w/h;camera.updateProjectionMatrix();
 }
 function render(){
  if(disposed)return;
  size();controls.update();
  renderer.render(scene,camera);
 }
 function request(){
  if(disposed||frame)return;
  frame=window.requestAnimationFrame(()=>{frame=0;render()});
 }
 controls.addEventListener("change",request);
 const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(request):null;
 observer?.observe(canvas);
 function apply(data){
  measurements={...data};
  const cm=n(measurements.height_cm,173.5);
  bodyScale=LIMIT(cm/173.5,.88,1.12);
  content.scale.setScalar(bodyScale);
  if(!DEBUG.noMorph){setMappedMorphs(main,measurements);
  for(const obj of accepted)setMappedMorphs(obj.root,measurements);}
  if(!DEBUG.noLocalDeform)for(const obj of shapeObjects)deformTo(obj,"body",measurements);
  request();
 }
 apply({height_cm:173.5,weight_kg:68.5});
 request();
 return {
  setMeasurements(data){apply(data||{})},
  setView(view){const az=view==="back"?Math.PI:0;
   const distance=camera.position.distanceTo(controls.target);
   camera.position.set(Math.sin(az)*distance,1.03,Math.cos(az)*distance);
   controls.update();request();},
  rotate(degrees){const az=Math.atan2(camera.position.x,camera.position.z)+degrees*Math.PI/180;
   const dist=camera.position.distanceTo(controls.target);
   camera.position.set(Math.sin(az)*dist,1.03,Math.cos(az)*dist);controls.update();request();},
  getYaw(){return Math.atan2(camera.position.x,camera.position.z)},
  draw:request,
  getInfo(){return {meshCount:allMeshes(main).length,morphCount:morphAvailable,parts:accepted.map(x=>x.key),bodyHeight:baselineHeight}},
  dispose(){disposed=true;observer?.disconnect();controls.dispose();studio.dispose();renderer.dispose();}
 };
}
window.BodyTraceReal3D={mount,version:"makehuman-pbr-v1"};

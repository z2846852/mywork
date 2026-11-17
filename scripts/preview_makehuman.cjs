/* Browser visual smoke test for real MakeHuman GLBs. No PAT or private data. */
const fs=require("node:fs"),path=require("node:path");
const {chromium}=require("playwright");
const root=path.resolve(__dirname,"..");
const assetsDir=path.join(root,"models/free/makehuman");
const get=name=>fs.readFileSync(path.join(assetsDir,name)).toString("base64");
const bundles=fs.readFileSync(path.join(root,"app/src/main/assets/makehuman3d.bundle.js"),"utf8");
const encoded={
 body:get("base_body.glb"),hair:get("hair_short02.glb"),
 shorts:get("clothing_shorts.glb"),shoes:get("clothing_shoes.glb")
};
const html=[
'<!doctype html><html><head><meta charset="utf-8"><style>',
'html,body{margin:0;background:#0c1719;color:#bfffea;font-family:Arial,sans-serif}',
'.stage{width:520px;height:780px;margin:auto;padding:22px;box-sizing:border-box;background:linear-gradient(155deg,#102b2b,#19272e);border-radius:20px}',
'h2{font-size:22px;margin:8px 0 4px}p{font-size:12px;margin:0 0 12px;opacity:.8}',
'canvas{width:100%;height:620px;display:block;background:radial-gradient(ellipse at 50% 40%,#365349,#112625 70%,#0e191c);border-radius:18px}',
'</style></head><body><div class="stage"><h2>BodyTrace · Studio</h2><p>MAKEHUMAN / BODY MODEL</p>',
'<canvas id="viewer"></canvas><p id="progress">正在解码真实三维资产…</p></div></body></html>'
].join("\n");
const startup=[
'window.__previewReady=false;window.__previewError="";',
'window.__BT_MODEL_ASSETS__='+JSON.stringify(encoded)+';',
'(async()=>{try{',
'const model=await window.BodyTraceReal3D.mount(document.getElementById("viewer"),window.__BT_MODEL_ASSETS__,',
'msg=>document.getElementById("progress").textContent=msg);',
'model.setMeasurements({height_cm:173.5,weight_kg:68.5,shoulder_cm:112.1,',
'chest_cm:90.2,waist_cm:84,hip_cm:93,upper_arm_cm:27.5,thigh_cm:53.9,calf_cm:39.5});',
'window.__modelInfo=model.getInfo();window.__previewReady=true;',
'document.getElementById("progress").textContent="真实 GLB · "+window.__modelInfo.morphCount+" 形变目标";',
'}catch(e){window.__previewError=String(e.stack||e);console.error(e)}})();'
].join("\n");
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox","--enable-webgl",
  "--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
 try{
  const page=await browser.newPage({viewport:{width:520,height:780},deviceScaleFactor:1.5});
  page.on("console",m=>{if(m.type()==="error")console.log("BROWSER ERROR:",m.text())});
  page.on("pageerror",e=>console.log("PAGE EXCEPTION:",e.message));
  await page.setContent(html,{waitUntil:"load"});
  await page.addScriptTag({content:bundles});
  await page.addScriptTag({content:startup});
  await page.waitForFunction(()=>window.__previewReady||window.__previewError,{timeout:90000});
  const info=await page.evaluate(()=>({ready:window.__previewReady,error:window.__previewError,
   details:window.__modelInfo||null}));
  console.log("PREVIEW RESULT",JSON.stringify(info));
  if(!info.ready)throw Error(info.error);
  await page.waitForTimeout(700);
  const dest=path.join(root,"bodytrace-makehuman-preview.png");
  await page.screenshot({path:dest,fullPage:true});
  console.log("Saved preview",dest);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

// Visually verify the actual Android WebView HTML with a local sample day.
// No external network, tokens or private data required.
"use strict";
const {chromium}=require("playwright");
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,"app/src/main/assets",name),"utf8");
const svg=fs.readFileSync(path.join(root,"app/src/main/assets/avatar_cartoon.svg"));
let html=read("index.html");
html=html.replace("</head>","<style>"+read("features.css")+"</style></head>");
html=html.replace("</body>","<script>"+read("features.js")+"</script></body>");
html=html.replace("__BODY_AVATAR_MIME__","image/svg+xml")
 .replace("__BODY_AVATAR_BASE64__",svg.toString("base64"));
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const page=await browser.newPage({viewport:{width:390,height:900},deviceScaleFactor:2});
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",msg=>{if(msg.type()==="error")errors.push(msg.text())});
  await page.setContent(html,{waitUntil:"load"});
  await page.evaluate(()=>{
   window.bodyTraceReceive({type:"data",cached:true,days:[{
    schema_version:2,date:"2026-04-15",workouts:[],nutrition:[],
    measurements:[{id:"sample",weight_kg:68.5,shoulder_cm:112.1,chest_cm:90.2,
     waist_cm:84,hip_cm:93,upper_arm_cm:27.5,thigh_cm:53.9,calf_cm:39.5}]
   }]});
   navigate("body");
  });
  await page.waitForTimeout(450);
  const image=await page.$("#avatarPicture");
  const loaded=await image.evaluate(x=>({complete:x.complete,width:x.naturalWidth,height:x.naturalHeight}));
  if(!loaded.complete||!loaded.width)throw Error("Avatar image failed to load "+JSON.stringify(loaded));
  const days=await page.$eval("#avatarMeasureDate",x=>x.options.length);
  if(days<1)throw Error("Historical measurement date selector missing");
  if(errors.length)throw Error("Browser JS errors: "+errors.join(" | "));
  await page.screenshot({path:"bodytrace-cartoon-preview.png",fullPage:true});
  console.log("PASS: cartoon avatar rendered",JSON.stringify(loaded),"date options",days);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

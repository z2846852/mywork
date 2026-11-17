/* BodyTrace: actual WebGL parametric 3D mesh. No external network or 2D projection tricks.
 * This stylized human is NOT a 3D scan; measurements scale approximate geometry. */
(function(global){
"use strict";
const VS=[
"attribute vec3 aPosition; attribute vec3 aNormal;",
"uniform mat4 uMvp; uniform mat4 uModel; uniform mat3 uNormal;",
"varying vec3 vNormal;",
"void main(){",
"vNormal=normalize(uNormal*aNormal);",
"gl_Position=uMvp*vec4(aPosition,1.0);",
"}"].join("\n");
const FS=[
"precision mediump float;",
"uniform vec3 uColor; varying vec3 vNormal;",
"void main(){",
"vec3 n=normalize(vNormal);",
"vec3 key=normalize(vec3(-0.45,0.85,1.25));",
"vec3 fill=normalize(vec3(0.8,0.25,-0.7));",
"float diff=0.43+0.51*max(dot(n,key),0.0)+0.22*max(dot(n,fill),0.0);",
"float shine=pow(max(dot(reflect(-key,n),vec3(0.0,0.0,1.0)),0.0),20.0);",
"gl_FragColor=vec4(uColor*diff+vec3(shine*0.05),1.0);",
"}"].join("\n");
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const eye4=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function mm(a,b){
 const out=new Float32Array(16);
 for(let c=0;c<4;c++)for(let r=0;r<4;r++){
  for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];
 }
 return out;
}
function tmat(x,y,z){let m=eye4();m[12]=x;m[13]=y;m[14]=z;return m}
function smat(x,y,z){let m=eye4();m[0]=x;m[5]=y;m[10]=z;return m}
function rzmat(a){let m=eye4(),c=Math.cos(a),s=Math.sin(a);m[0]=c;m[1]=s;m[4]=-s;m[5]=c;return m}
function rymat(a){let m=eye4(),c=Math.cos(a),s=Math.sin(a);m[0]=c;m[2]=-s;m[8]=s;m[10]=c;return m}
function persp(fov,aspect,near,far){
 let m=new Float32Array(16),f=1/Math.tan(fov/2);
 m[0]=f/aspect;m[5]=f;m[10]=(far+near)/(near-far);m[11]=-1;
 m[14]=2*far*near/(near-far);return m;
}
function sub(a,b){return a.map((n,i)=>n-b[i])}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function unit(a){let length=Math.hypot(...a)||1;return a.map(x=>x/length)}
function look(eye,target){
 const z=unit(sub(eye,target)),x=unit(cross([0,1,0],z)),y=cross(z,x),m=eye4();
 for(let i=0;i<3;i++){m[i*4]=x[i];m[i*4+1]=y[i];m[i*4+2]=z[i]}
 m[12]=-x[0]*eye[0]-x[1]*eye[1]-x[2]*eye[2];
 m[13]=-y[0]*eye[0]-y[1]*eye[1]-y[2]*eye[2];
 m[14]=-z[0]*eye[0]-z[1]*eye[1]-z[2]*eye[2];return m;
}
function shader(gl,type,source){
 const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
 if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))
  throw Error("WebGL shader error: "+gl.getShaderInfoLog(s));
 return s;
}
function sphere(gl){
 const verts=[],faces=[],LAT=24,LON=32;
 for(let i=0;i<=LAT;i++)for(let j=0;j<=LON;j++){
  let phi=Math.PI*i/LAT,theta=2*Math.PI*j/LON;
  let n=[Math.sin(phi)*Math.cos(theta),Math.cos(phi),Math.sin(phi)*Math.sin(theta)];
  verts.push(...n,...n);
 }
 for(let i=0;i<LAT;i++)for(let j=0;j<LON;j++){
  let a=i*(LON+1)+j,b=a+LON+1;faces.push(a,b,a+1,b,b+1,a+1);
 }
 const v=gl.createBuffer(),ib=gl.createBuffer();
 gl.bindBuffer(gl.ARRAY_BUFFER,v);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(verts),gl.STATIC_DRAW);
 gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(faces),gl.STATIC_DRAW);
 return {v,ib,count:faces.length};
}
function mount(canvas){
 const gl=canvas.getContext("webgl",{alpha:true,antialias:true,depth:true});
 if(!gl)throw Error("WebGL is not supported by this device");
 const prog=gl.createProgram();
 gl.attachShader(prog,shader(gl,gl.VERTEX_SHADER,VS));
 gl.attachShader(prog,shader(gl,gl.FRAGMENT_SHADER,FS));
 gl.linkProgram(prog);
 if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(prog));
 gl.useProgram(prog);
 const mesh=sphere(gl);
 const L={p:gl.getAttribLocation(prog,"aPosition"),n:gl.getAttribLocation(prog,"aNormal"),
   m:gl.getUniformLocation(prog,"uModel"),mvp:gl.getUniformLocation(prog,"uMvp"),
   nm:gl.getUniformLocation(prog,"uNormal"),col:gl.getUniformLocation(prog,"uColor")};
 gl.bindBuffer(gl.ARRAY_BUFFER,mesh.v);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,mesh.ib);
 gl.enableVertexAttribArray(L.p);gl.enableVertexAttribArray(L.n);
 gl.vertexAttribPointer(L.p,3,gl.FLOAT,false,24,0);
 gl.vertexAttribPointer(L.n,3,gl.FLOAT,false,24,12);
 gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
 const BASE={height_cm:173.5,weight_kg:68.5,shoulder_cm:112.1,chest_cm:90.2,
   waist_cm:84,hip_cm:93,upper_arm_cm:27.5,thigh_cm:53.9,calf_cm:39.5};
 let param={},yaw=0,pitch=.09,zoom=3.0,tracking=null;
 function factor(k){
  const v=Number(param[k]);
  return Number.isFinite(v)&&v>0?clamp(v/BASE[k],.75,1.3):1;
 }
 function render(){
  if(!canvas.isConnected)return;
  const dpr=Math.min(2,global.devicePixelRatio||1),w=Math.max(1,Math.round(canvas.clientWidth*dpr)),
    h=Math.max(1,Math.round(canvas.clientHeight*dpr));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
  gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.useProgram(prog);
  const H=factor("height_cm");
  const eye=[zoom*Math.sin(yaw)*Math.cos(pitch),.86*H+zoom*Math.sin(pitch),
             zoom*Math.cos(yaw)*Math.cos(pitch)];
  const view=look(eye,[0,.86*H,0]),vp=mm(persp(Math.PI/5,w/h,.1,10),view);
  const skin=[.90,.63,.49],skin2=[.95,.69,.54],hair=[.105,.095,.093],
    pants=[.081,.097,.111],shoes=[.066,.077,.084],sole=[.66,.68,.66];
  function ellipse(x,y,z,rx,ry,rz,color,angle=0){
   const spin=rzmat(angle),model=mm(tmat(x*H,y*H,z*H),mm(spin,smat(rx*H,ry*H,rz*H)));
   gl.uniformMatrix4fv(L.m,false,model);gl.uniformMatrix4fv(L.mvp,false,mm(vp,model));
   gl.uniformMatrix3fv(L.nm,false,new Float32Array([
     spin[0]/rx,spin[1]/rx,spin[2]/rx,
     spin[4]/ry,spin[5]/ry,spin[6]/ry,
     spin[8]/rz,spin[9]/rz,spin[10]/rz
   ]));
   gl.uniform3fv(L.col,new Float32Array(color));
   gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_SHORT,0);
  }
  function limb(from,to,rx,rz,color){
   let dx=to[0]-from[0],dy=to[1]-from[1],len=Math.hypot(dx,dy,to[2]-from[2]);
   ellipse((from[0]+to[0])/2,(from[1]+to[1])/2,(from[2]+to[2])/2,
     rx,len/2+rx*.25,rz,color,Math.atan2(-dx,dy));
  }
  const shoulder=factor("shoulder_cm"),chest=factor("chest_cm"),
   waist=factor("waist_cm"),hip=factor("hip_cm"),arm=factor("upper_arm_cm"),
   thigh=factor("thigh_cm"),calf=factor("calf_cm"),
   mass=clamp(Math.cbrt(factor("weight_kg")),.92,1.08);
  // Anatomical regions are real ellipsoid meshes, not image coordinates.
  ellipse(0,1.245,0,.186*chest*mass,.195,.14*chest*mass,skin);
  ellipse(0,1.105,0,.15*waist*mass,.185,.117*waist*mass,skin);
  ellipse(0,.960,0,.165*hip,.115,.124*hip,skin2);
  ellipse(0,.875,0,.186*hip,.11,.139*hip,pants);
  ellipse(0,.936,0,.168*hip,.027,.125*hip,[.055,.07,.077]);
  for(let side of [-1,1]){
   const x=.103*hip*side,sh=.221*shoulder*side;
   ellipse(x,.791,0,.092*thigh,.110,.101*thigh,pants);
   limb([x,.735,0],[x*1.05,.510,.009],.078*thigh,.079*thigh,skin);
   ellipse(x*1.05,.495,.007,.072*thigh,.075,.079*thigh,skin2);
   limb([x*1.05,.474,.007],[x*1.03,.163,0],.054*calf,.061*calf,skin);
   ellipse(x*1.03,.084,0,.044,.073,.052,[.68,.48,.37]);
   ellipse(x*1.03,.063,.081,.078,.045,.133,shoes);
   ellipse(x*1.03,.036,.082,.079,.014,.135,sole);
   ellipse(sh,1.339,0,.083*arm,.086,.090*arm,skin,side*.18);
   const elbow=[.311*shoulder*side,1.098,.012];
   limb([sh,1.324,0],elbow,.051*arm,.052*arm,skin);
   limb(elbow,[.349*shoulder*side,.895,.043],.040*arm,.042*arm,skin2);
   ellipse(.354*shoulder*side,.852,.05,.044*arm,.074,.036*arm,skin2);
  }
  ellipse(0,1.449,.003,.057,.077,.061,skin);
  ellipse(0,1.598,0,.094,.123,.089,skin);
  ellipse(-.095,1.602,0,.019,.030,.017,skin2);
  ellipse(.095,1.602,0,.019,.030,.017,skin2);
  ellipse(0,1.691,-.004,.095,.045,.089,hair); // buzz-cut
  for(const side of [-1,1]){
   ellipse(side*.036,1.621,.088,.010,.009,.008,[.18,.14,.11]);
   ellipse(side*.037,1.646,.086,.020,.006,.009,hair);
  }
  ellipse(0,1.568,.092,.027,.005,.005,[.52,.29,.24]);
 }
 canvas.style.touchAction="none";
 canvas.addEventListener("pointerdown",e=>{
  tracking={id:e.pointerId,x:e.clientX,y:e.clientY};
  canvas.setPointerCapture(e.pointerId);
 });
 canvas.addEventListener("pointermove",e=>{
  if(!tracking||tracking.id!==e.pointerId)return;
  yaw+=(e.clientX-tracking.x)*.012;
  pitch=clamp(pitch-(e.clientY-tracking.y)*.006,-.55,.55);
  tracking.x=e.clientX;tracking.y=e.clientY;render();
 });
 canvas.addEventListener("pointerup",e=>{if(tracking?.id===e.pointerId)tracking=null});
 canvas.addEventListener("pointercancel",()=>{tracking=null});
 canvas.addEventListener("wheel",e=>{
  e.preventDefault();zoom=clamp(zoom+Math.sign(e.deltaY)*.15,2.2,4.8);render();
 },{passive:false});
 const observer=typeof ResizeObserver==="function"?new ResizeObserver(render):null;
 observer?.observe(canvas);
 return {
  setMeasurements(values){param=Object.assign({},values||{});render()},
  setView(view){yaw=view==="back"?Math.PI:0;pitch=.09;render()},
  rotate(degrees){yaw+=degrees*Math.PI/180;render()},
  draw:render,
  getYaw(){return yaw},
  dispose(){observer?.disconnect();gl.deleteProgram(prog);gl.deleteBuffer(mesh.v);gl.deleteBuffer(mesh.ib)}
 };
}
global.BodyTrace3D={mount};
})(window);

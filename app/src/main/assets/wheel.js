/* BodyTrace offline, reusable horizontal ruler picker.
 * Pointer/touch drag with 1/0.5/0.1 increments and direct keyboard editing.
 * No external libraries; no network access.
 */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const root=$("wheelOverlay"),canvas=$("wheelCanvas");
 if(!root||!canvas)return;
 const context=canvas.getContext("2d");
 const slider=$("wheelValue"),unit=$("wheelUnit");
 const gap=14;
 let cfg=null,current=0,tracking=null,priorOverflow="",lastFocus=null;
 const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
 const precision=step=>step>=1?0:Math.max(0,Math.min(3,(String(step).split(".")[1]||"").length));
 function snap(value) {
  if(!cfg)return value;
  const raw=Number.isFinite(value)?value:current;
  const snapped=cfg.min+Math.round((clamp(raw,cfg.min,cfg.max)-cfg.min)/cfg.step)*cfg.step;
  return Number(clamp(snapped,cfg.min,cfg.max).toFixed(precision(cfg.step)));
 }
 function display(v){return v.toFixed(precision(cfg.step))}
 function render(){
  if(!cfg||root.hidden||!context)return;
  const width=Math.max(280,Math.round(canvas.getBoundingClientRect().width)),
        height=120,dpr=Math.min(3,window.devicePixelRatio||1);
  canvas.width=Math.round(width*dpr);canvas.height=height*dpr;
  context.scale(dpr,dpr);
  context.clearRect(0,0,width,height);
  const center=width/2,first=Math.max(0,Math.floor((current-cfg.min)/cfg.step));
  const radius=Math.ceil(width/(2*gap))+2;
  const endIndex=Math.round((cfg.max-cfg.min)/cfg.step);
  const major=cfg.step<1?10:cfg.step===1&&cfg.max<=12?1:5;
  context.textAlign="center";context.textBaseline="top";
  context.font="500 11px system-ui, sans-serif";
  for(let delta=-radius;delta<=radius;delta++){
   const i=first+delta;if(i<0||i>endIndex)continue;
   const x=center+delta*gap,emphasis=(i%major===0);
   context.strokeStyle=delta===0?"#7ee7ba":emphasis?"#d4e8dd":"#668b7b";
   context.globalAlpha=delta===0?1:clamp(1-Math.abs(x-center)/(width*.65),.16,.95);
   context.lineWidth=delta===0?2.6:emphasis?1.7:1;
   context.beginPath();context.moveTo(x,17);
   context.lineTo(x,emphasis?63:emphasis===false&&i%5===0?49:36);context.stroke();
   if(emphasis){
    const v=cfg.min+i*cfg.step;
    context.fillStyle=delta===0?"#90f0bd":"#b8d0c3";
    context.fillText(cfg.step<1?v.toFixed(1):v.toFixed(0),x,72);
   }
  }
  context.globalAlpha=1;
 }
 function update(value,copyInput=true){
  current=snap(value);
  if(copyInput)slider.value=display(current);
  render();
 }
 function close(){
  if(root.hidden)return;
  root.hidden=true;root.setAttribute("aria-hidden","true");
  document.body.style.overflow=priorOverflow;
  tracking=null;
  const toFocus=lastFocus;cfg=null;
  if(toFocus&&typeof toFocus.focus==="function")toFocus.focus();
 }
 function open(options){
  if(!options||typeof options.onConfirm!=="function")return;
  lastFocus=document.activeElement;
  cfg={min:Number(options.min??0),max:Number(options.max??300),
    step:Number(options.step??1),unit:String(options.unit||""),
    onConfirm:options.onConfirm,title:String(options.title||"选择数值")};
  if(!Number.isFinite(cfg.min)||!Number.isFinite(cfg.max)||
     !Number.isFinite(cfg.step)||cfg.step<=0||cfg.max<=cfg.min){
    cfg=null;throw new Error("滚轮范围不合法");
  }
  $("wheelTitle").textContent=cfg.title;unit.textContent=cfg.unit;
  slider.min=String(cfg.min);slider.max=String(cfg.max);
  slider.step=String(cfg.step);
  priorOverflow=document.body.style.overflow;
  document.body.style.overflow="hidden";
  root.hidden=false;root.setAttribute("aria-hidden","false");
  update(Number.isFinite(Number(options.value))?Number(options.value):cfg.min);
  // After layout, re-render with the actual canvas width.
  window.requestAnimationFrame(render);
 }
 function stepBy(delta){
  if(!cfg)return;
  update(current+delta*cfg.step);
 }
 canvas.style.touchAction="none";
 canvas.setAttribute("tabindex","0");
 canvas.addEventListener("pointerdown",e=>{
  if(!cfg)return;
  tracking={id:e.pointerId,startX:e.clientX,startValue:current};
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
 });
 canvas.addEventListener("pointermove",e=>{
  if(!tracking||tracking.id!==e.pointerId||!cfg)return;
  const ticks=Math.round((tracking.startX-e.clientX)/gap);
  update(tracking.startValue+ticks*cfg.step);
 });
 function finish(e){if(tracking?.id===e.pointerId)tracking=null}
 canvas.addEventListener("pointerup",finish);
 canvas.addEventListener("pointercancel",finish);
 canvas.addEventListener("wheel",e=>{
  if(!cfg)return;
  e.preventDefault();
  stepBy(Math.sign(e.deltaY||e.deltaX));
 },{passive:false});
 canvas.addEventListener("keydown",e=>{
  if(e.key==="ArrowLeft"||e.key==="ArrowDown"){e.preventDefault();stepBy(-1)}
  else if(e.key==="ArrowRight"||e.key==="ArrowUp"){e.preventDefault();stepBy(1)}
 });
 slider.addEventListener("input",()=>{
  if(!cfg||slider.value.trim()==="")return;
  const number=Number(slider.value);
  if(Number.isFinite(number))update(number,false);
 });
 slider.addEventListener("change",()=>{if(cfg)update(Number(slider.value))});
 $("wheelMinus").onclick=()=>stepBy(-1);
 $("wheelPlus").onclick=()=>stepBy(1);
 $("wheelClose").onclick=close;
 $("wheelScrim").onclick=close;
 $("wheelDone").onclick=()=>{
  if(!cfg)return;
  const proposed=Number(slider.value);
  if(!Number.isFinite(proposed)||slider.value.trim()===""){
   slider.value=display(current);return;
  }
  // Direct typed values may be more precise than the ruler step.
  const value=Number(clamp(proposed,cfg.min,cfg.max).toFixed(3));
  const callback=cfg.onConfirm;
  close();
  callback(value);
 };
 document.addEventListener("keydown",e=>{if(!root.hidden&&e.key==="Escape")close()});
 window.BodyTraceWheel={open,close,getValue:()=>current};
})();

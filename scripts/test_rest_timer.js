"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("app/src/main/assets/rest_timer.js","utf8");

function setup(saved){
 const elements=new Map(),persisted=[];
 class Element {
  constructor(id){this.id=id;this.value="";this.textContent="";this.children=[];this.disabled=false;
   this.style={};this.dataset={};this.classList={toggle(){},add(){},remove(){}};
   this.handlers={};}
  addEventListener(type,fn){this.handlers[type]=fn;}
  replaceChildren(){this.children=[];}
  appendChild(c){this.children.push(c);}
  set onclick(fn){this._click=fn;}get onclick(){return this._click;}
  set onchange(fn){this._change=fn;}get onchange(){return this._change;}
 }
 const el=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
 el("recordExercise").value="row";el("recordDate").value="2026-11-23";
 const state={rows:[{exercise_id:"row",session_date:"2026-11-23"}]};
 let now=1_900_000_000_000;
 class FakeDate extends Date{static now(){return now;}}
 const document={
  getElementById:el,createElement:()=>new Element("element"),
  body:{dataset:{activePage:"record"}},
  addEventListener(){},
  hidden:false
 };
 const window={
  setInterval(){},addEventListener(){},BodyTraceNative:{
   setRestTimerState(str){persisted.push(JSON.parse(str));}
  },
  bodyTraceReceive(){},
 };
 const ctx={window,document,state,exerciseLabels:{
  row:"坐姿划船",leg_press:"倒蹬",lateral_raise:"侧平举",
  custom_abcdefgh:"自定义动作"
 },Date:FakeDate,Number,Math,String,Object,Array,RegExp,JSON,
 requestAnimationFrame:fn=>fn()};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 if(saved!==undefined)window.bodyTraceReceive({type:"ui_preferences",rest_timer_state:saved});
 return {el,window,persisted,state,setTime(v){now=v;},now:()=>now};
}

let x=setup();
const m=x.window.BodyTraceRestMath;
assert.equal(m.defaultSeconds("leg_press"),180,"Heavy press rests 3 minutes");
assert.equal(m.defaultSeconds("row"),150,"Row rests 2.5 minutes");
assert.equal(m.defaultSeconds("lateral_raise"),90,"Isolation rests 90 seconds");
assert.equal(m.defaultSeconds("custom_abcdefgh","curl"),90,"Custom isolation recognized");
assert.equal(m.defaultSeconds("custom_abcdefgh","something unknown"),120,"Unknown defaults editable");
assert.equal(m.clock(90),"01:30");
assert.equal(m.clock(0),"00:00");
assert.equal(m.clock(-13),"-00:13");
assert.equal(m.clock(-3720),"-1:02:00");
assert.equal(m.remainingSeconds(5000,5100),0,"Just expired not a full negative second");
assert.equal(m.remainingSeconds(5000,6001),-1,"Elapsed second must show signed overrun");
assert.equal(x.el("recordProgress").textContent,"1 / 4 组");
assert.equal(x.el("recordSetDots").children.length,4);
assert.equal(x.el("recordSetDots").children[0].className,"record-set-dot done");

x.el("recordRestStart").onclick();
assert.equal(x.window.BodyTraceRestTimer.state().duration_seconds,150);
assert.equal(x.el("recordRestClock").textContent,"02:30");
assert.equal(x.persisted.at(-1).exercise_id,"row");
x.setTime(x.now()+152_000);
x.window.BodyTraceRestTimer.render();
assert.equal(x.el("recordRestClock").textContent,"-00:02","Overtime continues below zero");
x.el("recordExercise").value="lateral_raise";x.window.BodyTraceRestTimer.render();
assert.equal(x.window.BodyTraceRestTimer.state().exercise_id,"row",
 "Switching movements must not reset an active interval");
assert.ok(x.el("recordRestHint").textContent.includes("坐姿划船"));
x.el("recordRestShorter").onclick();
assert.equal(x.persisted.at(-1).overrides.lateral_raise,75);
assert.equal(x.window.BodyTraceRestTimer.state().duration_seconds,150,
 "Changing next movement preset does not rewrite running rest");
x.el("recordRestStop").onclick();
assert.equal(x.window.BodyTraceRestTimer.state().running,false);
x.el("recordTargetSets").value="6";x.el("recordTargetSets").onchange();
assert.equal(x.persisted.at(-1).goals.lateral_raise,6);
x.state.rows.push({exercise_id:"lateral_raise",session_date:"2026-11-23"});
x.window.BodyTraceRestTimer.render();
assert.equal(x.el("recordProgress").textContent,"1 / 6 组");
x.window.BodyTraceRestTimer.armAfterSave("lateral_raise");
assert.equal(x.window.BodyTraceRestTimer.shouldStayOnRecord({event:{exercise_id:"lateral_raise"}}),true);
assert.equal(x.window.BodyTraceRestTimer.state().running,false,
 "Arming a pending save does not start a fake rest");
x.window.bodyTraceReceive({type:"local_saved",event:{exercise_id:"lateral_raise"}});
assert.equal(x.window.BodyTraceRestTimer.state().running,true,
 "Rest only begins after native local_saved");
assert.equal(x.window.BodyTraceRestTimer.state().duration_seconds,75);
assert.equal(x.el("recordRestClock").textContent,"01:15");

const snapshot=JSON.stringify(x.persisted.at(-1));
let reload=setup(snapshot);
assert.equal(reload.window.BodyTraceRestTimer.state().running,true);
assert.equal(reload.window.BodyTraceRestTimer.state().duration_seconds,75);
reload.el("recordExercise").value="lateral_raise";reload.window.BodyTraceRestTimer.render();
assert.equal(reload.el("recordRestPreset").textContent,"01:15");
assert.equal(reload.el("recordTargetSets").value,"6");
reload.window.bodyTraceReceive({type:"error",message:"save failed"});
assert.equal(reload.window.BodyTraceRestTimer.shouldStayOnRecord({event:{exercise_id:"lateral_raise"}}),false);
console.log("RestTimerTest passed: presets, save receipt, negative time, restore, group progress");

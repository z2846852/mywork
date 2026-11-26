"use strict";
const fs=require("node:fs");
const vm=require("node:vm");
const assert=require("node:assert/strict");
const read=p=>fs.readFileSync(p,"utf8");

const html=read("app/src/main/assets/index.html");
const sleep=read("app/src/main/assets/sleep.js");
const history=read("app/src/main/java/com/z2846852/bodytrace/PhoneSleepHistory.java");
const infer=read("app/src/main/java/com/z2846852/bodytrace/PhoneSleepInference.java");
const main=read("app/src/main/java/com/z2846852/bodytrace/MainActivity.java");
const app=read("app/src/main/java/com/z2846852/bodytrace/BodyTraceApp.java");
const manifest=read("app/src/main/AndroidManifest.xml");
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "Main HTML must include its startup script");
new vm.Script(script,{filename:"index inline script"});
new vm.Script(sleep,{filename:"sleep.js"});

assert.ok(sleep.includes('auto_sleep:"睡眠（自动）"'),"Normal records should not appear as suspected");
assert.ok(sleep.includes('confirmed_sleep:"睡眠（已确认）"'),"Manual confirmation must remain distinct");
assert.ok(sleep.includes('unknown:"未知"'),"Unknown must remain available");
assert.ok(!html.includes('id="phoneSleepPrompt"'),"No per-day confirmation dialog");
assert.ok(!sleep.includes("activePhonePrompt"),"No daily popup logic left in JS");
assert.ok(history.includes('PhoneSleepInference.automaticStatus(from,to)'),
 "Old unreviewed records must be reclassified without re-querying expired events");
assert.ok(history.includes('if(!report.optBoolean("reviewed",false))'),
 "User-reviewed labels must not be overwritten by migration");
assert.ok(history.includes('if(record.optBoolean("reviewed",false))'),
 "User-reviewed intervals must not be overwritten by rescan");
assert.ok(history.includes('.put("prompt_id","")'),
 "Scanning must not initiate popups");
assert.ok(infer.includes('hour>=21 || hour<9'),
 "Late 05:00 sleep must count without accepting daytime spans");
assert.ok(app.includes("Thread.setDefaultUncaughtExceptionHandler"),
 "Local native exception capture is required");
assert.ok(main.includes("super.onCreate(null)"),
 "Cold-start cannot restore previous installed code WebView state");
assert.ok(main.includes("onRenderProcessGone"),
 "WebView renderer exit must be handled");
assert.ok(manifest.includes('android:name=".BodyTraceApp"'),
 "Local crash recorder must be activated at process creation");
assert.ok(manifest.includes('android:launchMode="singleTask"'),
 "Launcher and package installer should not fork multiple tasks");
assert.ok(html.includes('id="startupDiagnostic"')&&
 html.includes('case "startup_diagnostic"'),"Crash details should be locally viewable");
const recorder=read("app/src/main/java/com/z2846852/bodytrace/SleepRecorderService.java");
const tones=read("app/src/main/java/com/z2846852/bodytrace/SnoreFeedbackController.java");
assert.ok(html.includes('id="sleepMicCanvas"')&&html.includes('id="sleepSpeakerCanvas"'),
 "Feedback UI must have independent input and output waveforms");
assert.ok(html.includes('id="sleepMicStart"')&&html.includes('id="sleepFeedbackEnabled"'),
 "Mic testing and automatic output feedback need independent controls");
assert.ok(sleep.includes('sleep_feedback_mic')&&sleep.includes('sleep_feedback_output'),
 "Live input and output streams must be separately handled");
assert.ok(recorder.includes('ACTION_MONITOR_ON')&&recorder.includes('ACTION_MONITOR_OFF'),
 "Mic-only test lifecycle must exist");
assert.ok(recorder.includes('if(writer==null&&recordRequested)writer=beginRecording()'),
 "Mic-only capture must be upgradable to M4A without a second mic");
assert.ok(recorder.includes('if(writer!=null)writer.write(pcm,count)'),
 "Mic-only mode must not create encoded audio");
assert.ok(recorder.includes('envelope.add(pcm[i])')&&recorder.includes('SleepAudioAnalyzer.EnvelopeAccumulator'),
 "Mic waveform must come from actual PCM audio");
assert.ok(tones.includes('interface CueListener')&&
 main.includes('SleepRecorderService.speakerWave('),
 "Speaker waveform must come from synthesized cue samples in native code");
assert.ok(main.includes('sleepMicMonitorStart')&&main.includes('sleepMicMonitorStop'),
 "WebView needs native mic-only controls");
assert.ok(tones.indexOf('track.write(samples,0,samples.length)')<tones.indexOf('track.getState()!=AudioTrack.STATE_INITIALIZED'),"Static track becomes initialized only after writing");
assert.ok(sleep.includes('sleep_feedback_score')&&sleep.includes('BodyTraceLiveEnvelope'),"Live model score and shared envelope renderer must be wired");
assert.ok(main.includes('window.bodyTraceReceiveFeedback'),"Native live events have dedicated dispatch");
const visual=read("app/src/main/assets/sleep_visualization.js");
new vm.Script(visual,{filename:"sleep_visualization.js"});
assert.ok(visual.includes('window.BodyTraceLiveEnvelope')&&visual.includes('drawEnvelope(ctx,{left,bottom,plotWidth,yAt,start:windowStart'),"Offline and live must share rendering");
const dreams=read("app/src/main/java/com/z2846852/bodytrace/DreamCueSynth.java");
const dreamIds=[...html.matchAll(/<option value="(dream_[a-z]+)">/g)].map(m=>m[1]);
assert.equal(dreamIds.length,8,"Eight distinct original dream motifs");
for(const id of dreamIds)assert.ok(dreams.includes('case "'+id+'"'),"Native synth supports "+id);
assert.ok(tones.includes("DreamCueSynth.synthesize")&&recorder.includes("sleep-auto-cue")&&recorder.includes("SnoreFeedbackController.suppressMicrophone()"),"Long cues use native synth and do not block inference");
console.log("SleepFeedbackTest passed: decoupled mic/recording and input/output graph contracts");
console.log("SleepStartupTest passed: old records, no popup, local crash diagnostics");

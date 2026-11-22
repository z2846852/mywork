/* BodyTrace Sound Lab: isolated from sleep/recording UI.
 * Pitch = continuous voiced-only acoustic axis (NOT wall-clock time).
 * Phones = hold/release, analyse the WHOLE short PCM utterance after release.
 * No ASR, no word-to-IPA conversion, no recording persistence. */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const bridge=()=>window.BodyTraceNative;
 const oldReceiver=window.bodyTraceReceive;
 const SVG="http://www.w3.org/2000/svg";
 const pitchPoints=[];
 let pitchOn=false,holding=false,analyzing=false,hasPhonemeResult=false,latestNote="",currentPanel="pitch";
 const maxPoints=700;
 const pitchChart=$("voicePitchChart"),grid=$("voicePitchGrid"),traces=$("voicePitchTraces");
 const hold=$("voicePhonemeHold");
 let modelsInstalled=new Set();
 let modelsSelected="acoustic";
 let lastPhonemeEvent=null;
 let modelBusy=false;
 let allModelsReady=false;
 function voiceModelStatus(message){safeText("voiceModelsStatus",message);}
 function renderModels(evt){
  if(evt.state==="downloading"||evt.state==="checking"){
   modelBusy=true;
   $("voiceModelsInstall").disabled=true;
   $("voiceModelsDelete").disabled=true;
   voiceModelStatus(evt.message||"下载中…");
   return;
  }
  if(evt.state==="error"){
   modelBusy=false;
   voiceModelStatus(evt.message||"模型下载失败");
   $("voiceModelsInstall").disabled=false;
   return;
  }
  if(evt.state==="installed"){
   voiceModelStatus(evt.message||"下载完成");
   return;
  }
  if(evt.state!=="listed")return;
  modelBusy=false;
  modelsInstalled=new Set((evt.models||[]).filter(m=>m.installed).map(m=>m.id));
  modelsSelected=evt.selected||"acoustic";
  allModelsReady=Number(evt.installed_count)===Number(evt.total_count)&&
    Number(evt.total_count)>0;
  $("voiceModelsChoice").value=modelsSelected;
  safeText("voiceModelsEngine",
   modelsSelected==="acoustic"?"基础声学探针":modelsSelected+" ✓ 已安装");
  const chosen=modelsSelected;
  $("voiceModelsInstall").disabled=allModelsReady;
  $("voiceModelsDelete").disabled=chosen==="acoustic"||!modelsInstalled.has(chosen);
  const count=Number(evt.installed_count)||0;
  const dictionary=evt.dictionary_ready?
    "英汉词典 "+Number(evt.dictionary_entries).toLocaleString("zh-CN")+" 词条 ✓":
    "英汉词典异常，需更新 APK";
  voiceModelStatus("模型："+count+"/3 已完整 · "+dictionary+
    (allModelsReady?" · 可离线使用":" · 点击下载缺失模型")+
    (evt.message&&evt.message.includes("失败")?" · "+evt.message:""));
 }
 function updateModelActions(){
  const choice=$("voiceModelsChoice").value;
  $("voiceModelsInstall").disabled=modelBusy||allModelsReady;
  $("voiceModelsDelete").disabled=modelBusy||
    choice==="acoustic"||!modelsInstalled.has(choice);
  if(choice==="acoustic"||modelsInstalled.has(choice)){
   if(bridge()?.voiceModelsSelect)bridge().voiceModelsSelect(choice);
   else voiceModelStatus("安装新 APK 后才能选择神经音素模型");
  }else{
   voiceModelStatus("该模型尚未安装，点击“下载缺失资源”可一次补齐全部模型。");
  }
 }
 $("voiceModelsChoice").addEventListener("change",updateModelActions);
 $("voiceModelsInstall").addEventListener("click",()=>{
  const id="all";
  if(modelBusy||allModelsReady)return;
  if(!bridge()?.voiceModelsInstall){
   voiceModelStatus("需要安装支持模型包的新 APK");return;
  }
  modelBusy=true;$("voiceModelsInstall").disabled=true;
  voiceModelStatus("正在下载缺失模型（最多 3 个），已完整的不会重复下载。");
  bridge().voiceModelsInstall(id);
 });
 $("voiceModelsDelete").addEventListener("click",()=>{
  const id=$("voiceModelsChoice").value;
  if(modelBusy||id==="acoustic"||!modelsInstalled.has(id))return;
  if(holding||analyzing){
   voiceModelStatus("请结束发音分析后再删除");return;
  }
  if(bridge()?.voiceModelsDelete)bridge().voiceModelsDelete(id);
 });
 $("voiceModelsRefresh").addEventListener("click",()=>bridge()?.voiceModelsStatus?.());
 function displayPhoneExamples(){
  const lang=$("voicePhoneDisplay").value;
  const isZh=lang==="zh";
  $("voicePhonemeEnglishBox").hidden=isZh;
  $("voicePhonemePinyinBox").hidden=!isZh;
  bridge()?.voiceLabSetLanguage?.(lang);
  if(lastPhonemeEvent&&lastPhonemeEvent.language&&
     lastPhonemeEvent.language!==lang){
   safeText("voicePhonemeLimit","语言模式已切换。上方 IPA 是上一次的声学结果，"+
    "请重新按住说话；不会把原有音素直接当成另一种语言的单词。");
  }else if(isZh){
   safeText("voicePhonemePinyin",
    "保留上方 IPA 音段；不能由无声调音素可靠反推汉字或带调拼音。");
   safeText("voicePhonemeLimit",
    "普通话当前显示 ZIPA 的声学 IPA，不把单个音素映射成“你、衣、妈”等臆测词语。");
  }else if(lastPhonemeEvent){
   safeText("voicePhonemeLimit",
    lastPhonemeEvent.warning||"词典的音素相似度不代表发音准确度");
  }
 }
 $("voicePhoneDisplay").addEventListener("change",displayPhoneExamples);
 displayPhoneExamples();

 // Installed models are private app data, queried once when the Voice page opens.
 document.querySelector('.tabs button[data-page="voice"]')?.addEventListener("click",
  ()=>bridge()?.voiceModelsStatus?.());



 // Traditional 44-item British-English learner chart, curated original tips/words.
 // The model and the bundled dictionary may use American IPA variants.
 // Each example uses phoneme tokens for diagnostic comparison, not forced ASR.
 const IPA_DATA=[
  ["ɪ","vowel","短前元音","嘴角自然、舌位略低于 /iː/；不要拉得过长。","sit","s ɪ t","坐","iː"],
  ["e","vowel","中前元音","嘴稍张开，舌前部比 /ɪ/ 更低；接近 bed 的元音。","bed","b e d","床","ɪ"],
  ["æ","vowel","开前元音","张口比 /e/ 大，舌前部降低。","cat","k æ t","猫","e"],
  ["ɒ","vowel","英式短后圆唇元音","短促、口形圆；美式 hot 通常用 /ɑ/，不能硬判为错误。","hot","h ɒ t","热的","ɔː"],
  ["ʌ","vowel","短央元音","下巴放松，舌头自然，不要读成 /ɑː/。","cup","k ʌ p","杯子","ɑː"],
  ["ʊ","vowel","短后圆唇元音","嘴唇略圆，舌后部略抬，不要拉成 /uː/。","book","b ʊ k","书","uː"],
  ["ə","vowel","弱读央元音 schwa","弱读、短促、放松；常见于非重读音节。","about","ə b aʊ t","关于","ʌ"],
  ["iː","vowel","长前闭元音","舌位偏高、嘴角略展开；区别于短促 /ɪ/。","see","s iː","看见","ɪ"],
  ["ɑː","vowel","长开后元音","张口、舌后部偏低；别混同 /ʌ/。","father","f ɑː ð ə","父亲","ʌ"],
  ["ɔː","vowel","长后圆唇元音","嘴唇圆、声音较长；不同英语口音有合并现象。","law","l ɔː","法律","ɒ"],
  ["uː","vowel","长后闭元音","嘴唇向前收圆，舌位较高；与 /ʊ/ 区分。","blue","b l uː","蓝色","ʊ"],
  ["ɜː","vowel","英式长央元音","舌头放松略抬；美式 bird 常用带卷舌的 /ɝ/。","bird","b ɜː d","鸟","ə"],
  ["eɪ","diphthong","双元音","从 /e/ 过渡向较高的前元音。","day","d eɪ","一天","aɪ"],
  ["əʊ","diphthong","英式双元音","从较央的位置滑向圆唇后元音；美式常写 /oʊ/。","go","ɡ əʊ","去","aʊ"],
  ["aɪ","diphthong","双元音","嘴先张开，再收窄到前高位置。","my","m aɪ","我的","eɪ"],
  ["aʊ","diphthong","双元音","从张口向圆唇 /ʊ/ 过渡。","now","n aʊ","现在","əʊ"],
  ["ɔɪ","diphthong","双元音","从后圆唇向 /ɪ/ 过渡。","boy","b ɔɪ","男孩","aɪ"],
  ["ɪə","diphthong","传统英式双元音","从 /ɪ/ 滑向弱读央元音；现代英式可能已合并。","near","n ɪə","近的","eə"],
  ["eə","diphthong","传统英式双元音","从 /e/ 向央元音滑动；美式 hair 有 /r/。","hair","h eə","头发","ɪə"],
  ["ʊə","diphthong","传统英式双元音","从 /ʊ/ 滑向央元音；现代英式已有大量合并。","pure","p j ʊə","纯净的","ɔː"],
  ["p","consonant","清双唇塞音","双唇闭合再爆破，不振动声带。","pin","p ɪ n","别针","b"],
  ["b","consonant","浊双唇塞音","与 /p/ 相似但带声带振动。","bin","b ɪ n","箱","p"],
  ["t","consonant","清齿龈塞音","舌尖触上齿龈再释放气流。","ten","t e n","十","d"],
  ["d","consonant","浊齿龈塞音","舌尖触上齿龈，声带振动。","den","d e n","窝","t"],
  ["k","consonant","清软腭塞音","舌后部贴软腭，短暂阻气后释放。","key","k iː","钥匙","ɡ"],
  ["ɡ","consonant","浊软腭塞音","/k/ 的有声对应音。","go","ɡ əʊ","去","k"],
  ["f","consonant","清唇齿擦音","上牙轻触下唇、气流摩擦，不振动声带。","fan","f æ n","风扇","v"],
  ["v","consonant","浊唇齿擦音","与 /f/ 位置相同，需有声带振动。","van","v æ n","货车","f"],
  ["θ","consonant","清齿擦音","舌尖轻靠上下牙之间，让气流持续摩擦；不是 /s/。","thin","θ ɪ n","薄的","s"],
  ["ð","consonant","浊齿擦音","舌尖轻靠齿间，保持声带振动。","this","ð ɪ s","这个","z"],
  ["s","consonant","清齿龈擦音","舌尖靠近上齿龈形成细窄气流；不要伸舌。","sip","s ɪ p","小口喝","θ"],
  ["z","consonant","浊齿龈擦音","与 /s/ 口形相似，但声带振动。","zip","z ɪ p","拉链","ð"],
  ["ʃ","consonant","清后齿龈擦音","舌位比 /s/ 更靠后，嘴唇略向前。","ship","ʃ ɪ p","船","s"],
  ["ʒ","consonant","浊后齿龈擦音","/ʃ/ 的有声版本，常见于 vision 中。","vision","v ɪ ʒ ə n","视觉","ʃ"],
  ["h","consonant","清声门擦音","喉部放松、气流通过，避免发成汉语 x。","hat","h æ t","帽子","f"],
  ["tʃ","consonant","清塞擦音","先短暂堵气，再以 /ʃ/ 一样的气流释放。","chin","tʃ ɪ n","下巴","dʒ"],
  ["dʒ","consonant","浊塞擦音","/tʃ/ 的有声对应音。","gin","dʒ ɪ n","杜松子酒","tʃ"],
  ["m","consonant","双唇鼻音","闭合双唇，空气从鼻腔通过。","man","m æ n","男人","n"],
  ["n","consonant","齿龈鼻音","舌尖贴上齿龈，空气从鼻腔通过。","no","n əʊ","不","ŋ"],
  ["ŋ","consonant","软腭鼻音","舌后部贴软腭，鼻腔共鸣；不要再加 /ɡ/。","sing","s ɪ ŋ","唱歌","n"],
  ["l","consonant","齿龈边音","舌尖顶上齿龈，空气从两侧通过。","lip","l ɪ p","嘴唇","r"],
  ["r","consonant","近音","舌尖不接触上腭；英美 /r/ 与卷舌习惯不同。","red","r e d","红色","l"],
  ["j","consonant","硬腭近音","类似英语 yes 开头的快速滑音。","yes","j e s","是的","dʒ"],
  ["w","consonant","双唇软腭近音","嘴唇收圆后迅速打开；不要读成 /v/。","wet","w e t","湿的","v"]
 ];
 const IPA_LABELS={vowel:"单元音",diphthong:"双元音",consonant:"辅音"};
 let ipaSelected="ɪ",ipaGroup="vowel",recordedIpaTarget=null;
 const ipaBySymbol=symbol=>IPA_DATA.find(x=>x[0]===symbol);
 const wordsIPA=entry=>"/"+entry[5].split(" ").join("")+"/";
 function selectIpa(symbol){
  const item=ipaBySymbol(symbol);if(!item)return;
  ipaSelected=symbol;ipaGroup=item[1];
  for(const button of document.querySelectorAll("#voiceIpaGroups button")){
   const active=button.dataset.ipaGroup===ipaGroup;
   button.classList.toggle("active",active);
   button.setAttribute("aria-pressed",String(active));
  }
  const root=$("voiceIpaGrid");root.replaceChildren();
  for(const row of IPA_DATA.filter(x=>x[1]===ipaGroup)){
   const b=document.createElement("button");b.type="button";
   b.textContent=row[0];b.className=row[0]===ipaSelected?"active":"";
   b.setAttribute("aria-label","练习音标 "+row[0]);
   b.addEventListener("click",()=>selectIpa(row[0]));root.append(b);
  }
  safeText("voiceIpaSymbol","/"+item[0]+"/");
  safeText("voiceIpaName",IPA_LABELS[item[1]]+" · "+item[2]);
  safeText("voiceIpaTip",item[3]);
  safeText("voiceIpaWord",item[4]);
  safeText("voiceIpaWordIpa",wordsIPA(item));
  safeText("voiceIpaMeaning",item[6]);
  const other=ipaBySymbol(item[7]);
  safeText("voiceIpaContrast",other?
   "易混音 /"+other[0]+"/（示例词 "+other[4]+"），点击切换对比；每次录音目标按按下时的音标锁定。":
   "可点选任意音标进行独立练习。");
 }
 for(const btn of document.querySelectorAll("#voiceIpaGroups button")){
  btn.addEventListener("click",()=>{
   const first=IPA_DATA.find(x=>x[1]===btn.dataset.ipaGroup);
   if(first)selectIpa(first[0]);
  });
 }
 $("voiceIpaCompare").addEventListener("click",()=>{
  const row=ipaBySymbol(ipaSelected),other=row&&ipaBySymbol(row[7]);
  if(other)selectIpa(other[0]);
 });
 function playIpaWord(row){
  if(!row)return;
  if(!bridge()?.voiceLabSpeakExample){
   safeText("voiceIpaVoiceStatus","需要安装包含示例朗读接口的新 APK（旧版界面小包无法提供原生 TTS）。");return;
  }
  safeText("voiceIpaVoiceStatus","正在尝试播放英式示例词 "+row[4]+"…");
  bridge().voiceLabSpeakExample(row[4]);
 }
 $("voiceIpaSpeak").addEventListener("click",()=>playIpaWord(ipaBySymbol(ipaSelected)));
 $("voiceIpaSpeakContrast").addEventListener("click",()=>{
  const item=ipaBySymbol(ipaSelected);playIpaWord(item&&ipaBySymbol(item[7]));
 });
 // ZIPA model phone tokens vary with accent and tokenizer conventions.
 // Avoid asserting a pronunciation grade from a single mismatch.
 function canonicalPhone(value){
  const s=String(value||"").trim().replace(/[\/ˈˌ.]/g,"").replace(/ː/g,"");
  const aliases={"ɛ":"e","ɹ":"r","g":"ɡ","oʊ":"əʊ","ɚ":"ə"};
  return aliases[s]||s;
 }
 function normalizePhones(raw){
  const values=raw.map(canonicalPhone).filter(Boolean),out=[];
  for(let i=0;i<values.length;i++){
   if((values[i]==="t"&&values[i+1]==="ʃ")||
      (values[i]==="d"&&values[i+1]==="ʒ")){
    out.push(values[i]+values[i+1]);i++;
   }else out.push(values[i]);
  }
  return out;
 }
 function ipaFocusedComparison(entry,heardRaw){
  const expected=normalizePhones(entry[5].split(" "));
  const heard=normalizePhones(heardRaw);
  const n=expected.length,m=heard.length;
  const dp=Array.from({length:n+1},()=>Array(m+1).fill(0));
  for(let i=0;i<=n;i++)dp[i][0]=i;
  for(let j=0;j<=m;j++)dp[0][j]=j;
  for(let i=1;i<=n;i++)for(let j=1;j<=m;j++)
   dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,
    dp[i-1][j-1]+(expected[i-1]===heard[j-1]?0:1));
  const alignment=Array(n).fill(null);
  let i=n,j=m;
  while(i>0||j>0){
   if(i>0&&j>0&&dp[i][j]===dp[i-1][j-1]+
     (expected[i-1]===heard[j-1]?0:1)){
    alignment[i-1]=heard[j-1];i--;j--;
   }else if(i>0&&dp[i][j]===dp[i-1][j]+1){
    alignment[i-1]=null;i--;
   }else if(j>0)j--;
   else break;
  }
  const focus=expected.indexOf(canonicalPhone(entry[0]));
  return {expected,heard,matched:focus>=0&&alignment[focus]===expected[focus],
   possible:focus>=0?alignment[focus]:null,editDistance:dp[n][m]};
 }
 function showIpaAttempt(evt){
  const target=recordedIpaTarget;
  const out=$("voiceIpaAttempt");out.classList.remove("off");
  if(!target){out.textContent="这次没有指定练习目标，保留上方原始 ZIPA 识别结果。";return;}
  if(evt.engine_kind!=="neural_ctc"){
   out.textContent="目标 /"+target[0]+"/ · "+target[4]+
    "：本次未得到 ZIPA 神经模型识别，无法比较音素。";return;
  }
  if(evt.language!=="en"){
   out.textContent="这次使用了非英语语言模式；请切回英语后重新朗读 "+target[4]+"。";return;
  }
  const heard=(Array.isArray(evt.candidates)?evt.candidates:[]).map(x=>x.ipa||"");
  if(!heard.length){
   out.textContent="目标 "+target[4]+" "+wordsIPA(target)+
    "：模型未识别到稳定音素。可能是音太短或模型局限，请延长发音。";return;
  }
  const diff=ipaFocusedComparison(target,heard);
  const actual=diff.possible?"/"+diff.possible+"/":"未识别到对应位置";
  const intro="练习 "+target[4]+" "+wordsIPA(target)+
   " · 关注 /"+target[0]+"/。ZIPA 输出：/"+heard.join("")+"/。";
  if(diff.matched){
   out.textContent=intro+"模型在预期位置识别到目标音素；仍需多次听辨与复测，不能仅凭一次认为发音准确。";
  }else{
   out.classList.add("off");
   out.textContent=intro+"对齐后目标位置候选："+actual+
    "。可反复听例词并练习 /"+target[0]+"/ ↔ /"+target[7]+
    "/；这是模型候选，不足以断言你真的发错了。";
  }
 }
 selectIpa("ɪ");

 const KEY_SIGNATURES={C:[0,0],G:[7,1],D:[2,2],A:[9,3],E:[4,4],B:[11,5],
   "F#":[6,6],"C#":[1,7],F:[5,-1],Bb:[10,-2],Eb:[3,-3],
   Ab:[8,-4],Db:[1,-5],Gb:[6,-6],Cb:[11,-7]};
 const LETTERS=["C","D","E","F","G","A","B"],NATURAL=[0,2,4,5,7,9,11];
 const SHARP=["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
 const FLAT=["C","D♭","D","E♭","E","F","G♭","G","A♭","A","B♭","B"];
 const STAFF={bass:[43,47,50,53,57],treble:[64,67,71,74,77]};
 const PASTELS=["#73e0ac","#71bbfb","#edbf7a","#b6a1ee","#f0adbd"],RED="#f17f86";
 const pc=n=>((n%12)+12)%12;
 function keyInfo(){
  const [tonic,fifths]=KEY_SIGNATURES[$("voicePitchKey").value]||KEY_SIGNATURES.C;
  const acc={},order=fifths<0?["B","E","A","D","G","C","F"]:["F","C","G","D","A","E","B"];
  for(let i=0;i<Math.abs(fifths);i++)acc[order[i]]=fifths<0?-1:1;
  return {tonic,fifths,acc,scale:new Set(NATURAL.map(n=>pc(n+tonic)))};
 }
 function noteName(midi,info=keyInfo()){
  const n=Math.round(midi),pitch=pc(n);
  for(let i=0;i<7;i++){
   const alt=info.acc[LETTERS[i]]||0;
   if(pc(NATURAL[i]+alt)===pitch)
    return LETTERS[i]+(alt===1?"♯":alt===-1?"♭":"")+
      Math.round((n-12-NATURAL[i]-alt)/12);
  }
  // Non-diatonic tones use the key's conventional sharp or flat direction.
  const name=(info.fifths<0?FLAT:SHARP)[pitch],i=LETTERS.indexOf(name[0]);
  const alt=name.includes("♯")?1:name.includes("♭")?-1:0;
  return name+Math.round((n-12-NATURAL[i]-alt)/12);
 }
 function toleranceCents(){
  const n=Number($("voicePitchTolerance").value);
  return Number.isFinite(n)?Math.max(10,Math.min(100,n)):50;
 }
 // Compare against the closest pitch permitted by this key signature, not a song.
 function gradePitch(midi,info=keyInfo(),tol=toleranceCents()){
  let target=null,delta=Infinity;
  const center=Math.round(midi);
  for(let n=center-3;n<=center+3;n++){
   if(!info.scale.has(pc(n)))continue;
   const offset=(midi-n)*100;
   if(Math.abs(offset)<Math.abs(delta)){delta=offset;target=n;}
  }
  return {target,delta,off:Math.abs(delta)>tol+1e-7};
 }
 function chosenStaff(){
  const selected=$("voicePitchClef").value;
  if(selected==="bass"||selected==="treble")return selected;
  if(!pitchPoints.length)return "bass";
  const sorted=pitchPoints.slice(-100).map(p=>p.midi).sort((a,b)=>a-b);
  return sorted[Math.floor(sorted.length/2)]>=62?"treble":"bass";
 }
 const el=(tag,attrs={})=>{
  const node=document.createElementNS(SVG,tag);
  for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
  return node;
 };
 function safeText(id,value){$(id).textContent=String(value);}

 function updatePitchFeedback(){
  safeText("voicePitchToleranceValue",toleranceCents()+" cents");
  if(!pitchPoints.length){
   $("voicePitchQuality").classList.remove("off");
   safeText("voicePitchQuality","等待有效音高");
   safeText("voicePitchNote","—");safeText("voicePitchCents","—");
   return;
  }
  const last=pitchPoints[pitchPoints.length-1],info=keyInfo();
  const near=Math.round(last.midi),cents=(last.midi-near)*100;
  const grade=gradePitch(last.midi,info);
  latestNote=noteName(near,info);
  safeText("voicePitchNote",latestNote);
  safeText("voicePitchCents",(cents>0?"+":"")+cents.toFixed(1)+" cents");
  safeText("voicePitchQuality",(grade.off?"偏离调内音":"调内")+" · 最近 "+
   noteName(grade.target,info)+" · "+(grade.delta>0?"+":"")+
   grade.delta.toFixed(0)+" cents");
  $("voicePitchQuality").classList.toggle("off",grade.off);
 }
 function redrawPitch(){
  if(!grid||!traces)return;
  grid.replaceChildren();traces.replaceChildren();
  const staff=STAFF[chosenStaff()],low=staff[0],high=staff[4],info=keyInfo();
  let min=low-4,max=high+4;
  if(pitchPoints.length){
   min=Math.min(min,Math.floor(Math.min(...pitchPoints.map(p=>p.midi)))-2);
   max=Math.max(max,Math.ceil(Math.max(...pitchPoints.map(p=>p.midi)))+2);
  }
  const x0=54,x1=352,y0=16,y1=197;
  const y=n=>y1-(n-min)/(max-min)*(y1-y0);
  for(let n=Math.ceil(min);n<=Math.floor(max);n++){
   const solid=staff.includes(n),outside=n<low||n>high;
   if(!solid&&!(outside&&NATURAL.includes(pc(n))))continue;
   const yy=y(n);
   grid.appendChild(el("line",{x1:x0,x2:x1,y1:yy,y2:yy,
    stroke:solid?"#719b85":"#3a604d","stroke-width":solid?1.25:0.75,
    "stroke-dasharray":solid?"":"3 5"}));
   if(solid||pc(n)===0){
    const label=el("text",{x:5,y:yy+3,fill:solid?"#b9d9c6":"#88a995","font-size":10});
    label.textContent=noteName(n,info);grid.appendChild(label);
   }
  }
  if(!pitchPoints.length){
   const empty=el("text",{x:202,y:105,"text-anchor":"middle",
    fill:"#8ab3a0","font-size":12});
   empty.textContent="开始哼唱后显示逐音轨迹";
   traces.appendChild(empty);return;
  }
  const dx=(x1-x0)/Math.max(1,pitchPoints.length-1);
  const grades=pitchPoints.map(p=>gradePitch(p.midi,info,toleranceCents()));
  let from=0;
  function segment(to){
   if(to<=from)return;
   const points=pitchPoints.slice(from,to),note=points[0].nearest;
   const color=grades[from].off?RED:PASTELS[pc(note)%PASTELS.length];
   const d=points.map((p,i)=>(i?"L":"M")+(x0+(from+i)*dx).toFixed(1)+" "+y(p.midi).toFixed(1)).join(" ");
   if(points.length===1)traces.appendChild(el("circle",{
    cx:x0+from*dx,cy:y(points[0].midi),r:2.7,fill:color}));
   else traces.appendChild(el("path",{d,fill:"none",stroke:color,
    "stroke-width":2.4,"stroke-linejoin":"round","stroke-linecap":"round"}));
   if(points.length>=3){
    const label=el("text",{x:x0+from*dx+2,y:Math.max(13,y(note)-7),fill:color,
     "font-size":11,"font-weight":700});
    label.textContent=noteName(note,info);traces.appendChild(label);
   }
  }
  for(let i=1;i<pitchPoints.length;i++){
   if(pitchPoints[i].nearest!==pitchPoints[i-1].nearest||
      grades[i].off!==grades[i-1].off){segment(i);from=i;}
  }
  segment(pitchPoints.length);
  const last=pitchPoints[pitchPoints.length-1],grade=grades[grades.length-1];
  traces.appendChild(el("circle",{cx:x0+(pitchPoints.length-1)*dx,
   cy:y(last.midi),r:3.1,fill:grade.off?RED:"#f5fff9",
   stroke:"#122820","stroke-width":1}));
 }
 function pitchSample(evt){
  const hz=Number(evt.pitch_hz),midi=Number(evt.midi);
  if(!(hz>0)||!Number.isFinite(midi)||!pitchOn)return; // HOLD on silence.
  pitchPoints.push({midi,nearest:Math.round(midi)});
  if(pitchPoints.length>maxPoints)pitchPoints.splice(0,pitchPoints.length-maxPoints);
  safeText("voicePitchHz",hz.toFixed(1)+" Hz");
  updatePitchFeedback();redrawPitch();
 }
 function resetPitch(){
  pitchPoints.length=0;latestNote="";
  safeText("voicePitchHz","—");updatePitchFeedback();redrawPitch();
 }
 function setPitchRunning(on){
  pitchOn=on;
  $("voicePitchStart").disabled=on;
  $("voicePitchStop").disabled=!on;
  safeText("voicePitchState",on?"● 采集中":
    pitchPoints.length?"已暂停 · 结果保留":"未开始");
 }
 function setPhonemeState(state,message){
  safeText("voicePhonemeState",state);
  if(message)safeText("voicePhonemeStatus",message);
 }
 function showPhonemes(evt){
  lastPhonemeEvent=evt;
  safeText("voicePhonemeUsedEngine",evt.engine_kind==="neural_ctc"?
   "· 神经网络："+evt.engine_id:evt.engine_kind==="neural_error"?
   "· 模型运行错误":"· 基础声学探针");
  analyzing=false;holding=false;hasPhonemeResult=true;hold.disabled=false;
  hold.textContent="按住说话";
  setPhonemeState("已完成 · 结果保留",evt.message||"本次声学分析已结束");
  safeText("voicePhonemeDuration",
   evt.duration_ms?("· "+(Number(evt.duration_ms)/1000).toFixed(2)+" 秒"):"");
  const target=$("voicePhonemeSequence");
  target.replaceChildren();
  const candidates=Array.isArray(evt.candidates)?evt.candidates:[];
  if(!candidates.length){
   const empty=document.createElement("span");empty.className="voice-empty";
   empty.textContent="没有稳定的可归类音素（不是未发音）";
   target.appendChild(empty);
  }
  for(const candidate of candidates){
   const chip=document.createElement("span");
   chip.className="voice-phoneme-chip";
   chip.textContent=String(candidate.ipa||"未分类");
   target.appendChild(chip);
  }
  const matches=Array.isArray(evt.word_matches)?evt.word_matches:[];
  const results=$("voiceWordMatches");
  results.replaceChildren();
  const neural=evt.engine_kind==="neural_ctc";
  const english=evt.language==="en";
  if(neural&&english&&matches.length){
   safeText("voicePhonemeEnglish",matches.length+" 个候选");
   for(const [i,match] of matches.entries()){
    const card=document.createElement("div");
    card.className="voice-word-match";
    const title=document.createElement("div");
    title.className="voice-word-match-title";
    const word=document.createElement("strong");
    word.textContent=String(match.word||"");
    const ipa=document.createElement("span");
    ipa.textContent="/"+String(match.ipa||"").replace(/^[\/]+|[\/]+$/g,"")+"/";
    const grade=document.createElement("span");
    grade.className="voice-word-match-score";
    grade.textContent=match.exact?"完整音素匹配":
      "音素相似 "+Number(match.phone_similarity||0)+"%";
    title.append(word,ipa,grade);
    const translation=document.createElement("p");
    translation.textContent=String(match.zh||"无中文释义");
    card.append(title,translation);
    results.appendChild(card);
   }
  }else{
   safeText("voicePhonemeEnglish","无完整词典匹配");
   const empty=document.createElement("p");
   empty.className="voice-empty";
   empty.textContent=evt.dictionary_error||(
    !neural?"当前基础声学探针不能可靠查整词；请选用 ZIPA 神经音素模型。":
    !english?"请切换英语模式并重新发音，才进行英汉整词反查。":
    "没有找到足够接近的英语词条；保留上方音素原样。");
   results.appendChild(empty);
  }
  safeText("voiceDictionaryNotice",neural&&english?
   "离线词典 "+(Number(evt.dictionary_entries)||0).toLocaleString("zh-CN")+
   " 词条 · 词典相似度≠模型置信度，更不是口音评分。":
   "词典匹配只有在英语模式使用 ZIPA 声学音素模型时才运行。");
  safeText("voicePhonemePinyin",evt.mandarin_note||
   "原始 IPA 已保留；当前不能可靠识别普通话汉字或声调。");
  safeText("voicePhonemeLimit",evt.warning||
   "声学候选不能直接代表完整音素转录或发音准确率。");
  displayPhoneExamples();
 }
 function stopAll(){
  if(pitchOn||holding||analyzing)bridge()?.voiceLabStop?.();
  if(holding){
   holding=false;hold.disabled=false;hold.textContent="按住说话";
  }
  analyzing=false;
  setPitchRunning(false);
 }
 function selectPanel(panel){
  if(panel===currentPanel)return;
  stopAll();
  currentPanel=panel;
  for(const value of ["pitch","phoneme"]){
   const chosen=value===panel;
   $("voice"+(value==="pitch"?"Pitch":"Phoneme")+"View").classList.toggle("active",chosen);
   $("voice"+(value==="pitch"?"Pitch":"Phoneme")+"View").hidden=!chosen;
   const tab=$("voice"+(value==="pitch"?"Pitch":"Phoneme")+"Tab");
   tab.classList.toggle("active",chosen);
   tab.setAttribute("aria-selected",String(chosen));
  }
  // Crucial: switching views never clears previous pitch or phoneme results.
  if(panel==="pitch")redrawPitch();
 }
 function startPitch(){
  if(!bridge()?.voiceLabStart){
   safeText("voicePitchStatus","需要安装新版 APK；仅界面更新无法新增录音功能");
   return;
  }
  bridge().voiceLabStart("pitch");
  safeText("voicePitchStatus","正在开启麦克风…");
 }
 $("voicePitchStart").addEventListener("click",startPitch);
 $("voicePitchStop").addEventListener("click",()=>bridge()?.voiceLabStop?.());
 $("voicePitchClear").addEventListener("click",resetPitch);
 $("voicePitchKey").addEventListener("change",()=>{updatePitchFeedback();redrawPitch();});
 $("voicePitchClef").addEventListener("change",redrawPitch);
 for(const type of ["input","change"])$("voicePitchTolerance").addEventListener(type,
  ()=>{updatePitchFeedback();redrawPitch();});
 $("voicePitchTab").addEventListener("click",()=>selectPanel("pitch"));
 $("voicePhonemeTab").addEventListener("click",()=>selectPanel("phoneme"));

 function down(event){
  if(holding||analyzing||hold.disabled)return;
  if(event&&event.preventDefault)event.preventDefault();
  if(!bridge()?.voiceLabStart){
   setPhonemeState("需要升级 APK","当前版本不支持按住录音");
   return;
  }
  holding=true;
  hold.classList.add("holding");
  hold.textContent="● 录音中 · 松开分析";
  setPhonemeState("录音中","正在采集完整发音，松开后开始分析。最长 5 秒。");
  if(event?.pointerId!==undefined)try{hold.setPointerCapture(event.pointerId);}catch(_){}
  bridge().voiceLabStart("phoneme");
 }
 function up(event){
  if(!holding)return;
  if(event&&event.preventDefault)event.preventDefault();
  holding=false;analyzing=true;
  hold.classList.remove("holding");
  hold.textContent="正在分析…";
  hold.disabled=true;
  setPhonemeState("分析中","已松开，正在分析刚才的整段录音…");
  bridge()?.voiceLabFinishPhoneme?.();
 }
 function cancel(){
  if(!holding)return;
  holding=false;analyzing=false;
  hold.classList.remove("holding");
  hold.textContent="按住说话";
  hold.disabled=false;
  setPhonemeState("已取消","本次发音已取消；上一条分析结果仍保留。");
  bridge()?.voiceLabStop?.();
 }
 hold.addEventListener("pointerdown",down);
 hold.addEventListener("pointerup",up);
 hold.addEventListener("pointercancel",cancel);
 hold.addEventListener("keydown",event=>{
  if((event.key===" "||event.key==="Enter")&&!event.repeat)down(event);
 });
 hold.addEventListener("keyup",event=>{
  if(event.key===" "||event.key==="Enter")up(event);
 });
 // Avoid drag/long-press selection and browser generated synthetic clicks.
 hold.addEventListener("contextmenu",event=>event.preventDefault());

 window.bodyTraceReceive=function(evt){
  if(typeof oldReceiver==="function")oldReceiver(evt);
  if(!evt)return;
  if(evt.type==="voice_models"){renderModels(evt);return;}
  if(evt.type!=="voice_lab")return;
  if(evt.state==="pitch_sample"){pitchSample(evt);return;}
  if(evt.state==="phoneme_result"){showPhonemes(evt);return;}
  if(evt.state==="permission_ready"){
   holding=false;analyzing=false;hold.disabled=false;
   hold.textContent="按住说话";hold.classList.remove("holding");
   setPhonemeState("权限已开启",evt.message||"请再次按住发音");
   return;
  }
  if(evt.state==="running"){
   if(evt.mode==="pitch"){
    setPitchRunning(true);
    safeText("voicePitchStatus","发声时绘图，停声时冻结，最后音高会保留。");
   }else if(evt.mode==="phoneme"){
    if(!holding)bridge()?.voiceLabFinishPhoneme?.();
   }
   return;
  }
  if(evt.state==="analyzing"){
   setPhonemeState("分析中",evt.message||"正在分析整段录音…");return;
  }
  if(evt.state==="stopped"){
   if(evt.mode==="pitch"){
    setPitchRunning(false);
    safeText("voicePitchStatus",evt.message||"已停止，音高轨迹保留。");
   }else if(!analyzing&&!holding&&!hasPhonemeResult)
    setPhonemeState("待发音",evt.message||"麦克风已关闭；上次结果保留");
   return;
  }
  if(evt.state==="error"){
   if(evt.mode==="pitch"){
    setPitchRunning(false);
    safeText("voicePitchStatus",evt.message||"麦克风启动失败");
   }else{
    holding=false;analyzing=false;hold.disabled=false;
    hold.classList.remove("holding");hold.textContent="按住说话";
    setPhonemeState("错误",evt.message||"分析失败；上次结果保留");
   }
  }
 };
 document.querySelectorAll(".tabs button[data-page]").forEach(tab=>{
  if(tab.dataset.page!=="voice")
   tab.addEventListener("click",stopAll);
 });
 window.addEventListener("pagehide",stopAll);
 updatePitchFeedback();
 redrawPitch();
 window.BodyTraceVoiceLab={
  // Read-only regression/debug status, no raw microphone audio.
  state:()=>({pitchPoints:pitchPoints.length,latestNote,holding,analyzing,currentPanel,
   key:$("voicePitchKey").value,tolerance:toleranceCents(),clef:chosenStaff()})
 };
})();
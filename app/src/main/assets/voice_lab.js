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
  $("voiceWordPanel").hidden=isZh;
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
 let practiceTarget=null,currentDrillPhone=null;
 let wordTarget=null,recordedWordTarget=null;
 let wordLookupSerial=0;
 const ipaBySymbol=symbol=>IPA_DATA.find(x=>x[0]===symbol);
 const wordsIPA=entry=>"/"+entry[5].split(" ").join("")+"/";
 function selectIpa(symbol,choose=false){
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
   b.addEventListener("click",()=>selectIpa(row[0],true));root.append(b);
  }
  safeText("voiceIpaSymbol","/"+item[0]+"/");
  safeText("voiceIpaName",IPA_LABELS[item[1]]+" · "+item[2]);
  safeText("voiceIpaTip",item[3]);
  safeText("voiceIpaWord",item[4]);
  safeText("voiceIpaWordIpa",wordsIPA(item));
  safeText("voiceIpaMeaning",item[6]);
  if(choose)openPhoneDrill(symbol);
  const other=ipaBySymbol(item[7]);
  safeText("voiceIpaContrast",other?
   "易混音 /"+other[0]+"/（示例词 "+other[4]+"），点击切换对比；每次录音目标按按下时的音标锁定。":
   "可点选任意音标进行独立练习。");
 }
 for(const btn of document.querySelectorAll("#voiceIpaGroups button")){
  btn.addEventListener("click",()=>{
   const first=IPA_DATA.find(x=>x[1]===btn.dataset.ipaGroup);
   if(first)selectIpa(first[0],true);
  });
 }
 $("voiceIpaCompare").addEventListener("click",()=>{
  const row=ipaBySymbol(ipaSelected),other=row&&ipaBySymbol(row[7]);
  if(other)selectIpa(other[0],true);
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
  const expected=normalizePhones(entry.phonemes||entry[5].split(" "));
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
  const focus=expected.indexOf(canonicalPhone(entry.symbol||entry[0]));
  return {expected,heard,matched:focus>=0&&alignment[focus]===expected[focus],
   possible:focus>=0?alignment[focus]:null,editDistance:dp[n][m]};
 }
 function showIpaAttempt(evt){
  const target=recordedIpaTarget,out=$("voiceIpaAttempt");
  out.classList.remove("off");
  if(!target){out.textContent="自由识别：点击音素，选择一个例词，再按住说话复测。";return;}
  if(evt.engine_kind!=="neural_ctc"){
   out.textContent="目标 "+target.word+"：没有获得神经音素识别结果，无法进行比较。";return;
  }
  if(evt.language!=="en"){out.textContent="请切换英语模式，重新朗读 "+target.word;return;}
  const heard=(Array.isArray(evt.candidates)?evt.candidates:[])
   .map(x=>String(x.ipa||"")).filter(x=>classifyPhone(x)!=="marker");
  if(!heard.length){out.textContent="没有稳定的音素输出；试着完整朗读 "+target.word;return;}
  const diff=ipaFocusedComparison(target,heard);
  const intro="练习 "+target.word+" /"+target.phonemes.join("")+
   "/，目标音素 /"+target.symbol+"/。ZIPA 输出 /"+heard.join("")+"/。";
  if(diff.matched)out.textContent=intro+
   "模型在对应位置输出目标音素；仍不能证明发音正确，可再次复测。";
  else{
   out.classList.add("off");
   out.textContent=intro+"对应位置的模型候选为 "+
    (diff.possible?"/"+diff.possible+"/":"未检测到音素")+
    "。请听词语对比后再试；模型候选不等于错误判定。";
  }
 }

 // ZIPA is multilingual. /ɕ/ is genuine IPA, but not standard English.
 const aliasToEnglish={"i":"iː","ɛ":"e","ɹ":"r","ɚ":"ə","ɝ":"ɜː",
  "g":"ɡ","ɑ":"ɑː","ɔ":"ɔː","oʊ":"əʊ","ɐ":"ə"};
 const extraIpa=new Set(["ɕ","ʑ","ʂ","ʐ","ɾ","ʔ","ɽ","ɻ","ɨ",
  "ɲ","ɣ","ç","x","ɬ","ʋ","ʍ","ʉ","ɯ","ʈ","ɖ","ɳ","ɜ"]);
 const minimalPairs={
  "ɪ":[["sit","s ɪ t","seat","s iː t"],["ship","ʃ ɪ p","sheep","ʃ iː p"],["bit","b ɪ t","beat","b iː t"]],
  "iː":[["sit","s ɪ t","seat","s iː t"],["ship","ʃ ɪ p","sheep","ʃ iː p"],["bit","b ɪ t","beat","b iː t"]],
  "θ":[["thin","θ ɪ n","sin","s ɪ n"],["think","θ ɪ ŋ k","sink","s ɪ ŋ k"],["thick","θ ɪ k","sick","s ɪ k"]],
  "s":[["thin","θ ɪ n","sin","s ɪ n"],["think","θ ɪ ŋ k","sink","s ɪ ŋ k"],["thick","θ ɪ k","sick","s ɪ k"]],
  "e":[["pen","p e n","pin","p ɪ n"],["bed","b e d","bid","b ɪ d"],["ten","t e n","tin","t ɪ n"]],
  "æ":[["bad","b æ d","bed","b e d"],["pan","p æ n","pen","p e n"],["sat","s æ t","set","s e t"]],
  "ʊ":[["full","f ʊ l","fool","f uː l"],["pull","p ʊ l","pool","p uː l"]],
  "uː":[["full","f ʊ l","fool","f uː l"],["pull","p ʊ l","pool","p uː l"]],
  "ʃ":[["sip","s ɪ p","ship","ʃ ɪ p"],["see","s iː","she","ʃ iː"]],
  "l":[["right","r aɪ t","light","l aɪ t"],["road","r əʊ d","load","l əʊ d"]],
  "r":[["right","r aɪ t","light","l aɪ t"],["road","r əʊ d","load","l əʊ d"]]
 };

 // One verified lexical example for the non-English IPA phones likely to
 // appear in the multilingual ZIPA output. Never equate a similar Chinese
 // syllable with a phonetically different symbol.
 const MANDARIN_PHONES={
  "p":{word:"八",pinyin:"bā",note:"普通话 b 为不送气 [p]；不同于英语重读词首常见的送气 [pʰ]"},
  "t":{word:"大",pinyin:"dà",note:"普通话 d 对应不送气 [t]"},
  "k":{word:"哥",pinyin:"gē",note:"普通话 g 对应不送气 [k]"},
  "f":{word:"发",pinyin:"fā"},"s":{word:"思",pinyin:"sī"},
  "ʂ":{word:"书",pinyin:"shū"},
  "ɕ":{word:"西",pinyin:"xī"},
  "x":{word:"喝",pinyin:"hē",note:"普通话 h 常实现为 [x]，具体口音会变化"},
  "m":{word:"妈",pinyin:"mā"},"n":{word:"你",pinyin:"nǐ"},
  "ŋ":{word:"英",pinyin:"yīng",note:"/ŋ/ 在韵尾，非词首"},
  "l":{word:"拉",pinyin:"lā"},"j":{word:"呀",pinyin:"yā"},
  "w":{word:"外",pinyin:"wài"},
  "i":{word:"衣",pinyin:"yī"},"u":{word:"乌",pinyin:"wū"},
  "ɚ":{word:"儿",pinyin:"ér",note:"儿化韵母的实现会因语境变化"},
  "ɨ":{word:"四",pinyin:"sì",approx:true,note:"仅作听感类比：普通话舌尖元音常记为 [ɿ]，不等于 [ɨ]"},
  "ʐ":{word:"日",pinyin:"rì",approx:true,note:"普通话 r 的擦音/近音实现有差异"},
  "ɻ":{word:"日",pinyin:"rì",note:"普通话 r 常可实现为卷舌近音 [ɻ]"}
 };
 const OTHER_LANGUAGE_IPA={
  "ʑ":{language:"波兰语",word:"źle",ipa:"/ʑlɛ/"},
  "ɾ":{language:"西班牙语",word:"pero",ipa:"/ˈpeɾo/"},
  "ʔ":{language:"夏威夷语",word:"Hawaiʻi",ipa:"/haˈvaiʔi/",note:"ʻokina 表示声门塞音"},
  "ɽ":{language:"印地语",word:"बड़ा",ipa:"/bəɽaː/"},
  "ɨ":{language:"罗马尼亚语",word:"în",ipa:"/ɨn/"},
  "ɲ":{language:"西班牙语",word:"niño",ipa:"/ˈniɲo/"},
  "ɣ":{language:"希腊语",word:"γάλα",ipa:"/ˈɣala/"},
  "ç":{language:"德语",word:"ich",ipa:"/ɪç/"},
  "x":{language:"德语",word:"Bach",ipa:"/bax/"},
  "ɬ":{language:"威尔士语",word:"Llan",ipa:"/ɬan/"},
  "ʋ":{language:"荷兰语",word:"water",ipa:"/ˈʋaːtər/"},
  "ʍ":{language:"部分英语口音",word:"which",ipa:"/ʍɪtʃ/",
   note:"仅保留 wh 与 w 区别的口音"},
  "ʉ":{language:"瑞典语",word:"hus",ipa:"/hʉːs/"},
  "ɯ":{language:"韩语",word:"음",ipa:"/ɯm/"},
  "ʈ":{language:"印地语",word:"टोपी",ipa:"/ʈoːpi/"},
  "ɖ":{language:"印地语",word:"डाल",ipa:"/ɖaːl/"},
  "ɳ":{language:"印地语",word:"घंटा",ipa:"/ɡʱəɳʈaː/"},
  "ɜ":{language:"英式英语",word:"bird",ipa:"/bɜːd/"}
 };
 function playPhone(raw){
  if(bridge()?.voiceLabPlayPhoneme){
   bridge().voiceLabPlayPhoneme(String(raw||""));
   safeText("voiceIpaVoiceStatus","正在播放真人音标参考 /"+raw+"/");
  }else{
   safeText("voiceIpaVoiceStatus","需要更新完整 APK 才能播放离线真人音标");
  }
 }
 function speakReference(word,language){
  if(bridge()?.voiceLabSpeakReference){
   bridge().voiceLabSpeakReference(word,language);
   safeText("voiceIpaVoiceStatus","正在辅助朗读"+
    (language==="zh"?"普通话":"英文")+"例词（系统 TTS）");
  }else if(language==="en")speakDrill(word);
  else safeText("voiceIpaVoiceStatus","需要更新 APK 才能朗读中文例词");
 }
 function renderPhoneExamples(raw){
  const box=$("voicePhoneExamples");box.replaceChildren();
  const normalized=String(raw||"").trim();
  const english=ipaBySymbol(englishPhone(normalized));
  const zh=MANDARIN_PHONES[normalized];
  const foreign=OTHER_LANGUAGE_IPA[normalized];
  const add=(language,word,reading,note,speechLanguage)=>{
   const card=document.createElement("div");card.className="voice-reference-example";
   const head=document.createElement("strong");
   head.textContent=language+" · "+word+" "+reading;
   card.appendChild(head);
   if(note){
    const p=document.createElement("span");p.textContent=note;card.appendChild(p);
   }
   if(speechLanguage){
    const listen=document.createElement("button");listen.type="button";
    listen.className="secondary mini";listen.textContent="▶ 听例词";
    listen.addEventListener("click",()=>speakReference(word,speechLanguage));
    card.appendChild(listen);
   }
   box.appendChild(card);
  };
  if(english)add("英语",english[4],wordsIPA(english),
    normalized===english[0]?"":"对应英语教学音标 /"+english[0]+
    "/，音长或写法可能不同","en");
  if(zh)add(zh.approx?"普通话 · 近似":"普通话",zh.word,zh.pinyin,
   zh.note||"","zh");
  if(foreign)add(foreign.language,foreign.word,foreign.ipa,
   foreign.note||"",null);
  if(!english&&!zh&&!foreign){
   const msg=document.createElement("span");msg.className="sub";
   msg.textContent="暂无已核对的中英文/其他语言词例，不能用相似但不相同的音冒充。";
   box.appendChild(msg);
  }
  safeText("voicePhoneExamplesLabel","/"+normalized+"/ · "+
   (english?"英":"")+(english&&zh?" / ":"")+(zh?"中":"")+
   (!english&&!zh?"国际 IPA 参考":""));
 }
 function englishPhone(raw){
  const s=String(raw||"").trim().replaceAll("/","");
  const p=aliasToEnglish[s]||s;
  return ipaBySymbol(p)?p:null;
 }
 function classifyPhone(raw){
  const s=String(raw||"").trim();
  if(!s||s.startsWith("<")||s.startsWith("[")||s==="▁"||
     s==="|"||s==="-"||s==="_")return "marker";
  if(englishPhone(s))return "english";
  if(extraIpa.has(s)||MANDARIN_PHONES[s]||OTHER_LANGUAGE_IPA[s])
   return "outside-english";
  // Do not silently discard other IPA glyphs: retain them in the
  // acoustic result, even when our reference dictionary cannot name them.
  if(/^[a-zɐ-ʯʰʱːˑ͡˞̩]+$/u.test(s)&&s.length<=6)
   return "outside-english";
  return "marker";
 }
 function setPracticeTarget(target){
  practiceTarget={symbol:target.symbol,word:target.word,phonemes:[...target.phonemes]};
  safeText("voiceDrillTarget","下次跟读目标："+target.word+" /"+target.phonemes.join("")+
   "/（关注 /"+target.symbol+"/）");
  for(const btn of document.querySelectorAll("#voiceDrillPairs .voice-drill-choose"))
   btn.classList.toggle("active",btn.dataset.word===target.word);
  safeText("voiceIpaAttempt","已选择 "+target.word+"。按住下方录音键朗读，再松开进行比对。");
  $("voiceIpaAttempt").classList.remove("off");
 }
 function speakDrill(word){
  if(!bridge()?.voiceLabSpeakExample){
   safeText("voiceIpaVoiceStatus","需要新版完整 APK 才能播放示例词。");return;
  }
  safeText("voiceIpaVoiceStatus","朗读英语例词："+word);
  bridge().voiceLabSpeakExample(word);
 }
 function openPhoneDrill(raw){
  const box=$("voicePhonemeDrill"),pairsBox=$("voiceDrillPairs");
  box.hidden=false;pairsBox.replaceChildren();
  playPhone(raw);
  renderPhoneExamples(raw);
  const kind=classifyPhone(raw),phone=englishPhone(raw);
  currentDrillPhone=phone;
  if(!phone){
   practiceTarget=null;
   safeText("voiceDrillTitle","/"+raw+"/ · "+(kind==="outside-english"?
    "合法国际音标，非英语常用音素":"未归类模型标记"));
   safeText("voiceDrillDescription","该音不属于标准英语音素表。上方列出了可核对的普通话或其他语言词例（如有）；点击音标已播放真人样本。不能强行等同于相近英语音。");
   safeText("voiceDrillTarget","可直接重复点 /"+raw+"/ 试听，再按住录音键练习完整单词。");return;
  }
  const row=ipaBySymbol(phone);
  const pairs=minimalPairs[phone]||
   [[row[4],row[5],ipaBySymbol(row[7])[4],ipaBySymbol(row[7])[5]]];
  safeText("voiceDrillTitle","/"+raw+"/ → "+row[2]+
   (raw===phone?"":"（英语教学常用写法 /"+phone+"/）"));
  safeText("voiceDrillDescription",row[3]+" 每个词都可单独试听或选为复读目标。");
  for(const pair of pairs){
   const line=document.createElement("div");line.className="voice-drill-pair";
   for(const idx of [0,2]){
    const word=pair[idx],phones=pair[idx+1].split(" ");
    const cell=document.createElement("div");cell.className="voice-drill-cell";
    const choose=document.createElement("button");choose.type="button";
    choose.className="voice-drill-choose";choose.dataset.word=word;
    choose.textContent=word+" /"+phones.join("")+"/";
    choose.addEventListener("click",()=>{
     const isFocus=phones.some(x=>canonicalPhone(x)===canonicalPhone(phone));
     setPracticeTarget({symbol:isFocus?phone:row[7],word,phonemes:phones});
    });
    const listen=document.createElement("button");listen.type="button";
    listen.className="voice-drill-listen";listen.textContent="▶";
    listen.setAttribute("aria-label","播放 "+word);
    listen.addEventListener("click",()=>speakDrill(word));
    cell.append(choose,listen);line.appendChild(cell);
   }
   pairsBox.appendChild(line);
  }
  const p=pairs[0],idx=p[1].split(" ").some(x=>canonicalPhone(x)===
   canonicalPhone(phone))?0:2;
  setPracticeTarget({symbol:phone,word:p[idx],phonemes:p[idx+1].split(" ")});
 }
 function parseDictionaryIpa(value){
  const ipa=String(value||"").split("、")[0].replaceAll("/","")
   .replaceAll("ˈ","").replaceAll("ˌ","").replaceAll(".","")
   .replaceAll(" ","");
  const multi=["aɪ","aʊ","eɪ","oʊ","ɔɪ","əʊ","ɪə","eə","ʊə","tʃ","dʒ"];
  const result=[];
  for(let i=0;i<ipa.length;){
   const found=multi.find(p=>ipa.startsWith(p,i));
   if(found){result.push(found);i+=found.length;}
   else{
    const v=String.fromCodePoint(ipa.codePointAt(i));i+=v.length;
    if(v==="ː"){if(result.length)result[result.length-1]+="ː";}
    else result.push(v);
   }
  }
  return result;
 }

 // User-defined target is resolved by the bundled English pronunciation
 // dictionary, not guessed from ZIPA or a network-based ASR.
 function clearWordTarget(){
  wordTarget=null;recordedWordTarget=null;
  $("voiceWordReference").replaceChildren();
  $("voiceWordAlignment").replaceChildren();
  $("voiceWordCompare").hidden=true;
  $("voiceWordVariantRow").hidden=true;
 }
 function requestWordTarget(){
  if($("voicePhoneDisplay").value!=="en"){
   safeText("voiceWordStatus","请先切换英语模式");return;
  }
  const word=$("voiceWordInput").value.trim().toLowerCase();
  clearWordTarget();
  if(!/^[a-z]+(?:['-][a-z]+)*$/.test(word)||word.length>40){
   safeText("voiceWordStatus","请输入一个英文单词，不要输入整句");return;
  }
  if(!bridge()?.voiceLabLookupWord){
   safeText("voiceWordStatus","需要安装包含本地单词反查接口的新 APK");return;
  }
  ++wordLookupSerial;
  safeText("voiceWordStatus","正在本地查找 "+word+" 的标准音标…");
  bridge().voiceLabLookupWord(word);
 }
 $("voiceWordSet").addEventListener("click",requestWordTarget);
 $("voiceWordInput").addEventListener("keydown",event=>{
  if(event.key==="Enter"){event.preventDefault();requestWordTarget();}
 });
 $("voiceWordInput").addEventListener("input",()=>{
  ++wordLookupSerial;clearWordTarget();
  safeText("voiceWordStatus","输入后点击「设为目标」查询本地词典");
 });
 $("voiceWordVariant").addEventListener("change",()=>{
  if(!wordTarget)return;
  wordTarget.ipa=$("voiceWordVariant").value;
  wordTarget.phones=parseDictionaryIpa(wordTarget.ipa);
  renderWordReference();
 });
 $("voiceWordListen").addEventListener("click",()=>{
  if(wordTarget)speakReference(wordTarget.word,"en");
 });
 function renderWordReference(){
  const box=$("voiceWordReference");box.replaceChildren();
  if(!wordTarget)return;
  const heading=document.createElement("div");heading.className="voice-target-heading";
  heading.textContent=wordTarget.word+"  /"+wordTarget.ipa.replace(/[ˈˌ.]/g,"")+
    "/  · "+(wordTarget.zh||"暂无中文释义");
  box.appendChild(heading);
  const chips=document.createElement("div");chips.className="voice-phoneme-sequence";
  for(const symbol of wordTarget.phones){
   const btn=document.createElement("button");btn.type="button";
   btn.className="voice-phoneme-chip voice-reference-chip";
   btn.textContent=symbol;
   btn.setAttribute("aria-label","播放标准音标 /"+symbol+"/ 并查看词例");
   btn.addEventListener("click",()=>openPhoneDrill(symbol));
   chips.appendChild(btn);
  }
  box.appendChild(chips);
 }
 function receiveWordTarget(evt){
  if(evt.query!==$("voiceWordInput").value.trim().toLowerCase())return;
  if(evt.state!=="ready"){
   clearWordTarget();
   safeText("voiceWordStatus",evt.message||"词典未找到该单词");return;
  }
  const variants=(Array.isArray(evt.variants)?evt.variants:[evt.ipa])
   .map(x=>String(x||"").trim()).filter(Boolean);
  if(!variants.length)return;
  wordTarget={word:evt.word,zh:evt.zh,ipa:variants[0],
   variants,phones:parseDictionaryIpa(variants[0])};
  const select=$("voiceWordVariant");select.replaceChildren();
  variants.forEach((ipa,i)=>{
   const opt=document.createElement("option");opt.value=ipa;
   opt.textContent="读法 "+(i+1)+" /"+ipa+"/";select.append(opt);
  });
  select.value=variants[0];
  $("voiceWordVariantRow").hidden=variants.length<2;
  safeText("voiceWordStatus","目标已锁定；点击下方各音标试听，按住说词后逐音素比对");
  renderWordReference();
 }
 function alignWordPhones(expected,heard){
  const n=expected.length,m=heard.length;
  const eq=(a,b)=>canonicalPhone(a)===canonicalPhone(b);
  const dp=Array.from({length:n+1},()=>Array(m+1).fill(0));
  for(let i=0;i<=n;i++)dp[i][0]=i;
  for(let j=0;j<=m;j++)dp[0][j]=j;
  for(let i=1;i<=n;i++)for(let j=1;j<=m;j++)
   dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,
    dp[i-1][j-1]+(eq(expected[i-1],heard[j-1])?0:1));
  const aligned=[];let i=n,j=m;
  while(i||j){
   if(i&&j&&eq(expected[i-1],heard[j-1])&&
      dp[i][j]===dp[i-1][j-1]){
    aligned.push({expected:expected[--i],heard:heard[--j],state:"match"});
   }else if(i&&j&&dp[i][j]===dp[i-1][j-1]+1){
    aligned.push({expected:expected[--i],heard:heard[--j],state:"substitute"});
   }else if(j&&dp[i][j]===dp[i][j-1]+1){
    aligned.push({expected:null,heard:heard[--j],state:"insert"});
   }else if(i){
    aligned.push({expected:expected[--i],heard:null,state:"delete"});
   }else break;
  }
  return aligned.reverse();
 }
 function showWordComparison(evt){
  const box=$("voiceWordAlignment"),summary=$("voiceWordCompareStatus");
  box.replaceChildren();
  if(!recordedWordTarget)return;
  $("voiceWordCompare").hidden=false;
  if(evt.engine_kind!=="neural_ctc"||evt.language!=="en"){
   safeText("voiceWordCompareStatus","没有可对齐的 ZIPA 英语结果；请确认模型和语言模式。");return;
  }
  const observed=(Array.isArray(evt.candidates)?evt.candidates:[])
   .map(x=>String(x.ipa||"").trim())
   .filter(s=>classifyPhone(s)!=="marker");
  if(!observed.length){
   safeText("voiceWordCompareStatus","未检测到稳定音素；建议重试一次。");return;
  }
  const alignment=alignWordPhones(recordedWordTarget.phones,observed);
  let matching=0,changes=0,extra=0,missed=0;
  for(const item of alignment){
   const cell=document.createElement("div");
   cell.className="voice-alignment-cell "+item.state;
   const add=(symbol,kind)=>{
    const node=document.createElement(symbol?"button":"span");
    if(symbol){
     node.type="button";node.textContent=symbol;
     node.setAttribute("aria-label","听"+(kind==="expected"?"标准":"识别")+"音标 /"+symbol+"/");
     node.addEventListener("click",()=>openPhoneDrill(symbol));
    }else node.textContent="—";
    node.className="voice-alignment-"+kind;cell.appendChild(node);
   };
   add(item.expected,"expected");add(item.heard,"observed");
   box.appendChild(cell);
   if(item.state==="match")matching++;
   else if(item.state==="substitute")changes++;
   else if(item.state==="insert")extra++;
   else missed++;
  }
  safeText("voiceWordCompareStatus",
   "目标 "+recordedWordTarget.word+"：一致 "+matching+
   "、替换 "+changes+"、多出 "+extra+"、漏检 "+missed+
   "。红色是模型与词典的差异（待核实），不是你的口音得分。");
 }
 function chooseDictionaryWord(match){
  const phones=parseDictionaryIpa(match.ipa);
  const focus=currentDrillPhone&&phones.some(p=>canonicalPhone(p)===
   canonicalPhone(currentDrillPhone))?currentDrillPhone:
   phones.map(englishPhone).find(Boolean);
  if(!focus){safeText("voicePhonemeLimit","该词没有可匹配的英语音素。");return;}
  openPhoneDrill(focus);
  setPracticeTarget({symbol:focus,word:match.word,phonemes:phones});
  safeText("voiceDrillDescription","已主动选择词典候选 "+match.word+
   "，不代表系统已确认你刚才说的是该词。可以复读或改选下方对比词。");
 }
 $("voiceDrillClear").addEventListener("click",()=>{
  practiceTarget=null;currentDrillPhone=null;
  $("voicePhonemeDrill").hidden=true;
  safeText("voiceIpaAttempt","自由识别：先说单词，再点击音素展开纠音。");
  $("voiceIpaAttempt").classList.remove("off");
 });

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
 // A colour means proximity to a musical reference, not correct song melody.
 // Without an explicit target, compare the closest note in the chosen scale.
 // With a target, compare exactly that note. Both chart modes use this rule.
 function inSelectedScale(midi,info=keyInfo()){
  return info.scale.has(pc(Math.round(midi)));
 }
 function pitchAccuracy(midi,info=keyInfo()){
  const target=currentTarget();
  if(target===null)return gradePitch(midi,info,toleranceCents());
  const delta=(midi-target)*100;
  return {target,delta,off:Math.abs(delta)>toleranceCents()+1e-7};
 }
 function pitchColor(midi,info=keyInfo()){
  return pitchAccuracy(midi,info).off?RED:
    PASTELS[pc(Math.round(midi))%PASTELS.length];
 }
 function pitchDeviationPercent(cents){
  return (Math.pow(2,cents/1200)-1)*100;
 }
 function signed(n,d=1){return (n>0?"+":"")+n.toFixed(d);}
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

 let pitchViewMode="curve",pitchAxis=null;
 function currentTarget(){
  const raw=$("voicePitchTarget").value;
  if(raw==="")return null;
  const number=Number(raw);
  return Number.isInteger(number)&&number>=36&&number<=84?number:null;
 }
 function populateTargets(){
  const select=$("voicePitchTarget"),old=select.value;
  select.replaceChildren();
  const any=document.createElement("option");
  any.value="";any.textContent="不设目标 · 只记谱";select.append(any);
  const info=keyInfo();
  for(let midi=36;midi<=84;midi++){
   const opt=document.createElement("option");opt.value=String(midi);
   opt.textContent=noteName(midi,info);select.append(opt);
  }
  select.value=old;
 }
 function pitchTargetDeviation(midi){
  const target=currentTarget();
  if(target===null)return {target:null,delta:0,off:false};
  const delta=(midi-target)*100;
  return {target,delta,off:Math.abs(delta)>toleranceCents()};
 }

 function setPitchView(mode){
  pitchViewMode=mode==="staff"?"staff":"curve";
  const staff=pitchViewMode==="staff";
  // Key, target and cents threshold work in BOTH pitch modes.
  $("voicePitchClefSetting").hidden=!staff;
  $("voicePitchAxisActions").hidden=staff;
  for(const [name,active] of [["voicePitchModeCurve",!staff],["voicePitchModeStaff",staff]]){
   const b=$(name);b.classList.toggle("active",active);
   b.setAttribute("aria-pressed",String(active));
  }
  updatePitchFeedback();redrawPitch();
 }
 function updatePitchFeedback(){
  safeText("voicePitchToleranceValue",toleranceCents()+" cents");
  const quality=$("voicePitchQuality");
  if(!pitchPoints.length){
   quality.classList.remove("off");
   safeText("voicePitchQuality","等待有效发声");
   safeText("voicePitchNote","—");safeText("voicePitchCents","—");
   safeText("voicePitchPercent","—");return;
  }
  const last=pitchPoints[pitchPoints.length-1],info=keyInfo();
  const nearest=Math.round(last.midi),name=noteName(nearest,info);
  const explicitTarget=currentTarget(),grade=pitchAccuracy(last.midi,info);
  const target=grade.target;
  const cents=grade.delta;
  const pct=pitchDeviationPercent(cents),inside=inSelectedScale(last.midi,info);
  latestNote=name;
  safeText("voicePitchNote",name);
  safeText("voicePitchCentsLabel",explicitTarget===null?"相对最近调内音":"相对目标音");
  safeText("voicePitchCents",signed(cents,1)+" cents");
  safeText("voicePitchPercent",signed(pct,2)+"%");
  const ref=explicitTarget===null?"最近调内音 "+noteName(target,info):
    "目标 "+noteName(target,info);
  safeText("voicePitchQuality",name+" · "+(inside?"调内":"调外")+
   " · "+ref+" "+signed(cents,1)+" cents ("+signed(pct,2)+"%)"+
   (grade.off?" · 超出容差":" · 容差内"));
  quality.classList.toggle("off",grade.off);
 }
 const yClamp=(v,min,max)=>Math.max(min,Math.min(max,v));
 function defaultPitchAxis(midi){
  const center=Math.round(midi/12)*12;
  return {min:center-12,max:center+12};
 }
 function axisForPitch(){
  if(!pitchAxis){
   // An empty placeholder chart must NOT lock the axis before the first sample.
   if(!pitchPoints.length)return defaultPitchAxis(48);
   pitchAxis=defaultPitchAxis(pitchPoints[0].midi);
  }
  return pitchAxis;
 }
 function noteDiatonicStep(midi,info){
  const name=noteName(Math.round(midi),info);
  const m=name.match(/^([A-G])(?:♯|♭)?(-?\d+)$/);
  if(!m)return null;
  return (Number(m[2])+1)*7+LETTERS.indexOf(m[1]);
 }

 // Both views use the SAME pitchPoints history, including fractional MIDI.
 function redrawPitch(){
  if(!grid||!traces)return;
  grid.replaceChildren();traces.replaceChildren();
  const info=keyInfo(),x0=69,x1=347;
  if(pitchViewMode==="curve"){
   const axis=axisForPitch(),y0=26,y1=197;
   const y=midi=>y1-(midi-axis.min)/(axis.max-axis.min)*(y1-y0);
   for(let n=axis.min;n<=axis.max;n+=6){
    const yy=y(n),hz=440*Math.pow(2,(n-69)/12);
    grid.appendChild(el("line",{x1:x0,x2:x1,y1:yy,y2:yy,
     stroke:"#426c5a","stroke-width":.8,"stroke-dasharray":"3 5"}));
    const label=el("text",{x:5,y:yy+3,fill:"#a8c8b5","font-size":9});
    label.textContent=noteName(n,info)+" "+Math.round(hz)+"Hz";
    grid.appendChild(label);
   }
   safeText("voicePitchAxisCaption","频率/音名 · 各音淡彩 · 超容差红色");
   const target=currentTarget();
   if(target!==null){
    const ty=y(target);
    if(ty>=y0&&ty<=y1){
     grid.appendChild(el("line",{x1:x0,x2:x1,y1:ty,y2:ty,
      stroke:"#e9d698","stroke-width":1,"stroke-dasharray":"5 5"}));
     const aim=el("text",{x:x0+4,y:ty-5,"font-size":9,fill:"#e9d698"});
     aim.textContent="目标 "+noteName(target,info);grid.appendChild(aim);
    }
   }
   if(!pitchPoints.length){
    const hint=el("text",{x:202,y:110,"text-anchor":"middle",fill:"#8ab3a0","font-size":12});
    hint.textContent="发声后显示连续频率和彩色音名";traces.appendChild(hint);return;
   }
   const dx=(x1-x0)/Math.max(1,pitchPoints.length-1);
   const at=index=>({x:x0+index*dx,
    y:yClamp(y(pitchPoints[index].midi),y0,y1)});
   // Batch individual coloured segments into at most six SVG paths: the
   // underlying trace stays continuous without creating hundreds of nodes.
   const paths=new Map();
   for(let i=1;i<pitchPoints.length;i++){
    const prev=at(i-1),next=at(i),color=pitchColor(pitchPoints[i].midi,info);
    paths.set(color,(paths.get(color)||"")+"M"+prev.x.toFixed(2)+
     " "+prev.y.toFixed(2)+"L"+next.x.toFixed(2)+" "+next.y.toFixed(2)+" ");
   }
   for(const [color,d] of paths)traces.appendChild(el("path",{d,
    stroke:color,"stroke-width":2.6,"stroke-linejoin":"round",
    "stroke-linecap":"round",fill:"none",class:"pitch-coloured-path"}));
   // The user prefers dense information: never omit an individual note label.
   pitchPoints.forEach((point,index)=>{
    const {x,y:py}=at(index),color=pitchColor(point.midi,info);
    traces.appendChild(el("circle",{cx:x,cy:py,r:2.5,fill:color,
     class:"pitch-sample-dot"}));
    const marker=el("text",{x,y:yClamp(py-7-(index%2)*9,10,211),
     "text-anchor":"middle","font-size":8,"font-weight":650,
     fill:color,"fill-opacity":.94,
     "pointer-events":"none",class:"pitch-sample-label"});
    marker.textContent=noteName(point.midi,info);
    traces.appendChild(marker);
   });
   const last=pitchPoints[pitchPoints.length-1];
   const py=yClamp(y(last.midi),y0,y1),lastColor=pitchColor(last.midi,info);
   traces.appendChild(el("circle",{cx:x1,cy:py,r:3.8,
    stroke:"#eefff5","stroke-width":1,fill:lastColor}));
   const deviation=pitchAccuracy(last.midi,info).delta;
   const note=el("text",{x:x1,y:16,"text-anchor":"end",fill:lastColor,
    "font-size":12,"font-weight":700});
   note.textContent=noteName(last.midi,info)+"  "+signed(deviation,0)+"c";
   traces.appendChild(note);
   if(y(last.midi)!==py){
    const warn=el("text",{x:x1,y:212,"text-anchor":"end",
     fill:"#e5bb91","font-size":9});
    warn.textContent="音高超出视野";traces.appendChild(warn);
   }
   return;
  }

  // Equal-spaced five-line staff is a reference ruler, never sheet notation.
  // Horizontal bar length represents successive voiced samples (not beat time).
  const clef=chosenStaff(),staff=STAFF[clef],base=noteDiatonicStep(staff[0],info);
  const lineBottom=177,stepPx=13;
  const yForNote=n=>lineBottom-(noteDiatonicStep(n,info)-base)*stepPx;
  const yActual=midi=>yForNote(Math.round(midi))-
   (midi-Math.round(midi))*12;
  for(let index=0;index<5;index++){
   const yy=lineBottom-index*2*stepPx;
   grid.appendChild(el("line",{x1:x0,x2:x1,y1:yy,y2:yy,
    stroke:"#8daf9e","stroke-width":1.2}));
   const label=el("text",{x:5,y:yy+3,fill:"#b8d7c7","font-size":9});
   label.textContent=noteName(staff[index],info);grid.appendChild(label);
  }
  const clefText=el("text",{x:5,y:26,fill:"#c4dfce","font-size":10});
  clefText.textContent=clef==="bass"?"低音谱":"高音谱";grid.appendChild(clefText);
  safeText("voicePitchAxisCaption","K歌音高条 · 各音淡彩 · 超容差红色");
  const target=currentTarget();
  if(target!==null){
   const ty=yForNote(target);
   if(ty>=32&&ty<=200){
    grid.appendChild(el("line",{x1:x0,x2:x1,y1:ty,y2:ty,
     stroke:"#e9d698","stroke-width":1,"stroke-dasharray":"5 5"}));
    const name=el("text",{x:x0+4,y:ty-6,fill:"#e9d698","font-size":9});
    name.textContent="目标 "+noteName(target,info);grid.appendChild(name);
   }
  }
  if(!pitchPoints.length){
   const hint=el("text",{x:207,y:122,"text-anchor":"middle",
    fill:"#8ab3a0","font-size":11});
   hint.textContent="开始演唱后出现横向音高条";
   traces.appendChild(hint);return;
  }
  const visible=pitchPoints.slice(-150),dx=(x1-x0)/Math.max(1,visible.length);
  const bars=[];let run=null;
  for(let i=0;i<visible.length;i++){
   const p=visible[i],n=Math.round(p.midi),color=pitchColor(p.midi,info);
   // Preserve the colour transition even within a sustained nominal note.
   if(run&&run.note===n&&run.color===color){
    run.end=i;run.sum+=p.midi;run.count++;
   }else{
    if(run)bars.push(run);
    run={note:n,color,start:i,end:i,sum:p.midi,count:1};
   }
  }
  if(run)bars.push(run);
  for(const b of bars){
   const avg=b.sum/b.count;
   const sy=yClamp(yActual(avg),34,200);
   const bx=x0+b.start*dx,ex=x0+(b.end+1)*dx;
   const color=b.color;
   traces.appendChild(el("line",{x1:bx+1,x2:Math.max(bx+2,ex-1),
    y1:sy,y2:sy,stroke:color,"stroke-width":7,"stroke-linecap":"round"}));
   // Label every horizontal sung segment, including very brief ones. Dense
   // labels are intentional; the singer wants to see each note transition.
   const label=el("text",{x:(bx+ex)/2,y:sy-9,
    "text-anchor":"middle",fill:color,"font-size":9,"font-weight":700,
    "pointer-events":"none",class:"pitch-segment-label"});
   label.textContent=noteName(b.note,info);traces.appendChild(label);
  }
  const last=pitchPoints[pitchPoints.length-1],nearest=Math.round(last.midi);
  const color=pitchColor(last.midi,info);
  const rawY=yActual(last.midi),cy=yClamp(rawY,34,200);
  traces.appendChild(el("circle",{cx:x1,cy,r:4.2,
   stroke:color,"stroke-width":2,fill:"#edfff7"}));
  const cents=pitchAccuracy(last.midi,info).delta;
  const reading=el("text",{x:x1,y:16,"text-anchor":"end",
   fill:color,"font-size":11,"font-weight":750});
  reading.textContent=noteName(last.midi,info)+" "+
   signed(cents,0)+"c ("+signed(pitchDeviationPercent(cents),2)+"%)";
  traces.appendChild(reading);
  if(rawY!==cy){
   const warn=el("text",{x:x1,y:213,"text-anchor":"end",fill:color,"font-size":10});
   warn.textContent="当前音高超出谱表视野";traces.appendChild(warn);
  }
 }
 function pitchSample(evt){
  const hz=Number(evt.pitch_hz),midi=Number(evt.midi);
  if(!(hz>0)||!Number.isFinite(midi)||!pitchOn)return; // HOLD on silence.
  if(!pitchAxis)pitchAxis=defaultPitchAxis(midi);
  pitchPoints.push({midi,nearest:Math.round(midi)});
  if(pitchPoints.length>maxPoints)pitchPoints.splice(0,pitchPoints.length-maxPoints);
  safeText("voicePitchHz",hz.toFixed(1)+" Hz");
  updatePitchFeedback();redrawPitch();
 }
 function resetPitch(){
  pitchPoints.length=0;latestNote="";pitchAxis=null;
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
  let invalid=0,displayed=0;
  for(const candidate of candidates){
   const raw=String(candidate.ipa||"").trim(),kind=
    evt.engine_kind==="neural_ctc"?classifyPhone(raw):"marker";
   if(kind==="marker"){invalid++;continue;}
   const chip=document.createElement("button");chip.type="button";
   chip.className="voice-phoneme-chip"+
    (kind==="outside-english"?" outside-english":"");
   chip.textContent=raw;
   chip.setAttribute("aria-label","点击展开 /"+raw+"/"+
    (kind==="outside-english"?"（非英语常用音素）":" 纠音"));
   chip.addEventListener("click",()=>openPhoneDrill(raw));
   target.appendChild(chip);displayed++;
  }
  if(!displayed){
   const blank=document.createElement("span");blank.className="voice-empty";
   blank.textContent="没有可展开的英语或国际 IPA 音素；原始输出见下方诊断。";
   target.appendChild(blank);
  }
  safeText("voicePhonemeRaw",candidates.map(x=>String(x.ipa||"")).join(" · ")||"无输出");
  safeText("voicePhonemeRawNote",invalid?
   "已隐藏 "+invalid+" 个特殊标记或不能确定为 IPA 的 token。":
   "灰色音素是合法国际 IPA，但不属于常规英语音素。");
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
    const choose=document.createElement("button");choose.type="button";
    choose.className="voice-word-choose";choose.textContent="以此候选词练习";
    choose.addEventListener("click",()=>chooseDictionaryWord(match));
    card.append(title,translation,choose);
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
  showIpaAttempt(evt);
  showWordComparison(evt);
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
 $("voicePitchKey").addEventListener("change",()=>{
  populateTargets();updatePitchFeedback();redrawPitch();
 });
 $("voicePitchModeCurve").addEventListener("click",()=>setPitchView("curve"));
 $("voicePitchModeStaff").addEventListener("click",()=>setPitchView("staff"));
 $("voicePitchTarget").addEventListener("change",()=>{updatePitchFeedback();redrawPitch();});
 $("voicePitchAxisLower").addEventListener("click",()=>{
  const axis=axisForPitch();axis.min-=6;axis.max-=6;redrawPitch();
 });
 $("voicePitchAxisUpper").addEventListener("click",()=>{
  const axis=axisForPitch();axis.min+=6;axis.max+=6;redrawPitch();
 });
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
  // Snapshot the intended word at button-down so mid-recording edits do not
  // falsely compare the spoken audio against a different target.
  recordedWordTarget=$("voicePhoneDisplay").value==="en"&&wordTarget?
   {...wordTarget,phones:[...wordTarget.phones]}:null;
  recordedIpaTarget=$("voicePhoneDisplay").value==="en"&&!recordedWordTarget&&
   practiceTarget?{...practiceTarget,phonemes:[...practiceTarget.phonemes]}:null;
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
  if(evt.type==="voice_tts"){
   safeText("voiceIpaVoiceStatus",evt.message||"系统例词朗读状态未知");return;
  }
  if(evt.type==="voice_sample_audio"){
   safeText("voiceIpaVoiceStatus",evt.message||"真人音标播放状态未知");return;
  }
  if(evt.type==="voice_word_target"){receiveWordTarget(evt);return;}
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
 populateTargets();
 setPitchView("curve");
 window.BodyTraceVoiceLab={
  // Read-only regression/debug status, no raw microphone audio.
  state:()=>({pitchPoints:pitchPoints.length,latestNote,holding,analyzing,currentPanel,
   key:$("voicePitchKey").value,tolerance:toleranceCents(),clef:chosenStaff(),
   chartMode:pitchViewMode,practiceIpa:ipaSelected,
   target:currentTarget(),axis:pitchAxis,wordTarget:wordTarget?.word||null,
   alignmentShown:!$("voiceWordCompare").hidden})
 };
})();
package com.z2846852.bodytrace;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.SystemClock;
import java.io.File;
import java.io.InputStream;
import java.util.Arrays;
import java.util.zip.GZIPInputStream;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * One exclusive foreground microphone pipeline with TWO independent uses.
 *
 * pitch: YIN only, emits ONLY voiced PCM frames; silence never moves the
 * display's acoustic x-axis or erases the last pitch.
 *
 * phoneme: press/hold captures up to 5s PCM in memory. Releasing stops
 * capture, then analyses the WHOLE utterance after capture, returning a
 * retained summary. No speech recognition or fake IPA from recognized text.
 *
 * Current phoneme backend is a weak spectral heuristic. It cannot transcribe
 * /theta/ + /I/ + /N/ + /k/ in "think"; a trained model is separate future work.
 */
final class VoiceLabController {
    interface Sink { void onEvent(JSONObject event); }
    private static final int RATE=16000;
    private static final int WINDOW=4096;
    private static final int HOP=1024;
    private static final int LIMIT_SAMPLES=RATE*5;
    private final Activity activity;
    private final Sink sink;
    private final PhoneModelPacks modelPacks;
    private volatile PhoneticLexicon dictionary;
    private volatile String requestedLanguage="en";
    private volatile Session active;
    private int nextToken=0;

    private static final class Session {
        final AudioRecord input;
        final String mode;
        final int token;
        final String modelId;
        final String language;
        volatile boolean stopRequested=false;
        volatile boolean analyzeOnFinish=false;
        final short[] phrase;
        int phraseLength=0;
        Session(AudioRecord input,String mode,int token,String modelId,String language){
            this.input=input;this.mode=mode;this.token=token;
            this.modelId=modelId;this.language=language;
            this.phrase="phoneme".equals(mode)?new short[LIMIT_SAMPLES]:null;
        }
    }

    VoiceLabController(Activity activity,Sink sink,PhoneModelPacks packs){
        this.activity=activity;this.sink=sink;this.modelPacks=packs;
    }
    boolean isRunning(){return active!=null;}
    void setLanguage(String language){
        if("en".equals(language)||"zh".equals(language))
            requestedLanguage=language;
    }
    private synchronized PhoneticLexicon lexicon()throws Exception{
        if(dictionary==null){
            try(InputStream in=new GZIPInputStream(
                    activity.getAssets().open("en_pronunciation_zh.tsv.gzdata"))){
                dictionary=PhoneticLexicon.load(in);
            }catch(java.io.FileNotFoundException missing){
                throw new IllegalStateException(
                    "APK 缺少英汉发音词典文件；请安装最新完整 APK",missing);
            }
            if(dictionary.size()<1000)
                throw new IllegalStateException("离线发音字典数据不完整");
        }
        return dictionary;
    }
    /** Local lexical lookup by the user's intended spelling. No ASR, network
     * calls, or inference; the returned IPA is a reference, not an observation. */
    void lookupWord(String raw){
        String word=raw==null?"":raw.trim().toLowerCase(java.util.Locale.ROOT);
        try{
            JSONObject result=new JSONObject().put("type","voice_word_target")
                .put("query",word);
            if(word.length()>40||!word.matches("[a-z]+(?:['-][a-z]+)*")){
                result.put("state","invalid")
                    .put("message","请输入一个英文单词（仅英文字母、连字符或撇号）");
            }else{
                PhoneticLexicon.Entry e=lexicon().lookup(word);
                if(e==null){
                    result.put("state","missing")
                        .put("message","离线词典没有这个词；请检查拼写或更换练习词");
                }else{
                    result.put("state","ready").put("word",e.word)
                        .put("ipa",e.ipa).put("zh",e.zh)
                        .put("variants",new JSONArray(e.ipa.split("\\|")));
                }
            }
            sink.onEvent(result);
        }catch(Exception ex){
            try{sink.onEvent(new JSONObject().put("type","voice_word_target")
                .put("query",word).put("state","error")
                .put("message","本地发音词典读取失败："+ex.getMessage()));}
            catch(Exception ignored){}
        }
    }
    private void status(String mode,String state,String message){
        try{sink.onEvent(new JSONObject()
            .put("type","voice_lab").put("mode",mode)
            .put("state",state).put("message",message));}
        catch(Exception ignored){}
    }

    synchronized void start(String requestedMode){
        cancel(false);
        if(!("pitch".equals(requestedMode)||"phoneme".equals(requestedMode))){
            status(requestedMode,"error","不支持的声音实验模式");
            return;
        }
        if(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                !=PackageManager.PERMISSION_GRANTED){
            status(requestedMode,"error","尚未授权麦克风");
            return;
        }
        if(SleepRecorderService.isRecording()){
            status(requestedMode,"error","夜间录音正在运行，需先停止并保存");
            return;
        }
        AudioRecord input=null;
        try{
            int minimum=AudioRecord.getMinBufferSize(RATE,
                AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
            if(minimum<=0)throw new IllegalStateException("设备不支持 16kHz PCM 录音");
            input=new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,
                RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,
                Math.max(minimum,WINDOW*4));
            if(input.getState()!=AudioRecord.STATE_INITIALIZED)
                throw new IllegalStateException("音频采集器初始化失败");
            input.startRecording();
            Session session=new Session(input,requestedMode,++nextToken,
                modelPacks.selected(),requestedLanguage);
            active=session;
            Thread worker=new Thread(()->capture(session),"bodytrace-voice-capture");
            worker.setDaemon(true);
            worker.start();
            status(requestedMode,"running",requestedMode.equals("pitch")?
                "音高轨迹采集中；静音时冻结最后一个结果":
                "正在录制短发音，松开后分析本次完整语音");
        }catch(Exception e){
            if(input!=null){
                try{input.stop();}catch(Exception ignored){}
                try{input.release();}catch(Exception ignored){}
            }
            status(requestedMode,"error","启动声音实验失败："+e.getClass().getSimpleName());
        }
    }

    private void capture(Session session){
        AudioRecord input=session.input;
        short[] chunk=new short[1024];
        short[] window=new short[WINDOW];
        int filled=0;
        long lastEmission=0;
        try{
            while(active==session&&!session.stopRequested){
                int count=input.read(chunk,0,chunk.length,AudioRecord.READ_BLOCKING);
                if(count<=0){
                    if(!session.stopRequested&&active==session)
                        status(session.mode,"error","音频读取失败："+count);
                    break;
                }
                if("phoneme".equals(session.mode)){
                    int n=Math.min(count,LIMIT_SAMPLES-session.phraseLength);
                    if(n>0){
                        System.arraycopy(chunk,0,session.phrase,session.phraseLength,n);
                        session.phraseLength+=n;
                    }
                    if(session.phraseLength>=LIMIT_SAMPLES){
                        session.analyzeOnFinish=true;
                        session.stopRequested=true;
                    }
                    continue;
                }
                for(int i=0;i<count;i++){
                    window[filled++]=chunk[i];
                    if(filled==WINDOW){
                        long now=SystemClock.elapsedRealtime();
                        if(now-lastEmission>=100&&active==session){
                            PitchDetector.Result result=PitchDetector.analyze(window,RATE);
                            // Do not emit silence; neither chart nor note readout
                            // advances until a reliable, voiced frame arrives.
                            if(result.hz>0&&result.rmsDb>=-40&&result.clarity>=0.78){
                                JSONObject e=new JSONObject()
                                    .put("type","voice_lab").put("state","pitch_sample")
                                    .put("mode","pitch")
                                    .put("pitch_hz",result.hz)
                                    .put("note",result.note())
                                    .put("midi",result.midi())
                                    .put("cents",result.cents())
                                    .put("rms_dbfs",result.rmsDb)
                                    .put("clarity",result.clarity);
                                if(active==session)sink.onEvent(e);
                            }
                            lastEmission=now;
                        }
                        System.arraycopy(window,HOP,window,0,WINDOW-HOP);
                        filled=WINDOW-HOP;
                    }
                }
            }
        }catch(Exception e){
            if(active==session&&!session.stopRequested)
                status(session.mode,"error","实时声音分析失败："+e.getClass().getSimpleName());
        }finally{
            try{input.stop();}catch(Exception ignored){}
            try{input.release();}catch(Exception ignored){}
            if(active==session){
                if(session.analyzeOnFinish&&"phoneme".equals(session.mode)){
                    status("phoneme","analyzing","录音完成，正在分析整段音频…");
                    analyzePhrase(session);
                }
                if(active==session){
                    active=null;
                    status(session.mode,"stopped",
                        "phoneme".equals(session.mode)?"本次分析已结束":"音高已停止，曲线保留");
                }
            }
        }
    }

    /** Button release triggers analysis; no result is sent while held. */
    synchronized void finishPhoneme(){
        Session s=active;
        if(s==null||!"phoneme".equals(s.mode))return;
        s.analyzeOnFinish=true;
        s.stopRequested=true;
        try{s.input.stop();}catch(Exception ignored){}
    }

    /** Leaving the tab/activity cancels capture and never stores microphone data. */
    synchronized void cancel(boolean notify){
        Session old=active;
        active=null;
        if(old==null)return;
        old.analyzeOnFinish=false;
        old.stopRequested=true;
        try{old.input.stop();}catch(Exception ignored){}
        if(notify)status(old.mode,"stopped",
            old.mode.equals("pitch")?"音高已停止，曲线保留":"已取消本次短录音");
    }

    private void analyzePhrase(Session session){
        int total=session.phraseLength;
        if(!PhoneModelPacks.ACOUSTIC.equals(session.modelId)){
            analyzeNeural(session,total);
            return;
        }
        int duration=(int)Math.round(total*1000.0/RATE);
        JSONArray segments=new JSONArray();
        int evaluated=0,recognized=0;
        String previous="",previousWords="",previousPinyin="";
        int consecutive=0;
        int firstFrame=0;
        List<PhonemeProbe.Result> frameCandidates=new ArrayList<>();
        try{
            if(total>=WINDOW){
                short[] window=new short[WINDOW];
                for(int start=0;start+WINDOW<=total;start+=HOP){
                    System.arraycopy(session.phrase,start,window,0,WINDOW);
                    PitchDetector.Result pitch=PitchDetector.analyze(window,RATE);
                    PhonemeProbe.Result guess=PhonemeProbe.analyze(window,RATE,pitch);
                    evaluated++;
                    if(!"undetermined".equals(guess.method)&&
                       guess.ipa!=null&&!guess.ipa.equals("—")){
                        recognized++;
                        frameCandidates.add(guess);
                        if(guess.ipa.equals(previous)){
                            consecutive++;
                        }else{
                            flushCandidate(segments,previous,previousWords,previousPinyin,
                                consecutive,firstFrame);
                            previous=guess.ipa;
                            previousWords=guess.englishWords;
                            previousPinyin=guess.pinyinExamples;
                            consecutive=1;
                            firstFrame=start;
                        }
                    }else{
                        flushCandidate(segments,previous,previousWords,previousPinyin,
                            consecutive,firstFrame);
                        previous="";consecutive=0;
                    }
                }
                flushCandidate(segments,previous,previousWords,previousPinyin,
                    consecutive,firstFrame);
            }
            // If a very short word produces no two successive stable frames,
            // explicitly report uncertainty rather than hallucinating phones.
            JSONObject result=new JSONObject()
                .put("type","voice_lab").put("mode","phoneme")
                .put("state","phoneme_result")
                .put("duration_ms",duration)
                .put("frames_examined",evaluated)
                .put("frames_with_acoustic_cues",recognized)
                .put("candidates",segments)
                .put("is_trained_phoneme_model",false)
                .put("message",segments.length()>0?
                    "整段已分析；显示的是局部声学候选，并非完整单词的 IPA 识别":
                    "整段已分析，但声学证据不足或无法稳定归类；不编造音素")
                .put("warning",
                    "当前模型仅能尝试元音与部分擦音；英语 /θ/、/ŋ/、/k/ "+
                    "及普通话声调无法被可靠识别。不要把候选序列当作正确发音评分。");
            if(active==session)sink.onEvent(result);
        }catch(Exception e){
            if(active==session)
                status("phoneme","error","整段音素分析失败："+e.getClass().getSimpleName());
        }
    }


    /**
     * Run genuine neural IPA phone recognition AFTER recording has ended.
     * Never call the heuristic on neural failure: doing so would fake a result.
     */
    private void analyzeNeural(Session session,int count){
        String id=session.modelId;
        try{
            if(count<1600)throw new IllegalArgumentException("发声太短：至少约 0.1 秒");
            File dir=modelPacks.modelDir(id);
            if(!modelPacks.installed(id)||dir==null)
                throw new IllegalStateException("所选的神经音素模型尚未安装");
            long start=android.os.SystemClock.elapsedRealtime();
            String[] phones=new PhonemeNeuralEngine().decode(dir,session.phrase,count);
            long inferenceMs=android.os.SystemClock.elapsedRealtime()-start;
            JSONArray resultPhones=new JSONArray();
            for(String phone:phones){
                if(phone==null||phone.trim().isEmpty()||resultPhones.length()>=96)
                    continue;
                // Only acoustic phone labels. Do not attach independent
                // one-phone word/pinyin examples: that is NOT whole-word matching.
                resultPhones.put(new JSONObject().put("ipa",phone));
            }
            JSONObject result=new JSONObject()
                .put("type","voice_lab").put("state","phoneme_result")
                .put("mode","phoneme").put("engine_id",id)
                .put("engine_kind","neural_ctc")
                .put("is_trained_phoneme_model",true)
                .put("language",session.language)
                .put("duration_ms",Math.round(count*1000.0/RATE))
                .put("inference_ms",inferenceMs)
                .put("candidates",resultPhones)
                .put("message",resultPhones.length()>0?
                    "ZIPA 声学音素识别完成 · 耗时 "+inferenceMs+"ms":
                    "ZIPA 未输出稳定音素；可能是静音、短音或模型局限")
                .put("warning",
                    "ZIPA 输出音素，不是已确认的文字或口音准确率。 "+
                    "英语词典只做完整音素序列匹配；普通话声调及汉字不由该模型识别。");
            result.put("word_matches",new JSONArray());
            if("en".equals(session.language)&&phones.length>0){
                try{
                    PhoneticLexicon source=lexicon();
                    JSONArray matches=new JSONArray();
                    for(PhoneticLexicon.Match match:
                            source.find(Arrays.asList(phones),7)){
                        matches.put(new JSONObject()
                            .put("word",match.word)
                            .put("ipa",match.ipa)
                            .put("zh",match.zh)
                            .put("exact",match.exact)
                            .put("phone_similarity",match.phoneSimilarityPercent)
                            .put("edit_distance",match.phoneEditDistance));
                    }
                    result.put("word_matches",matches)
                        .put("dictionary_entries",source.size());
                }catch(Exception dictionaryFailure){
                    // Lexicon problems must not make the neural recognition
                    // fail or encourage fallbacks to fake single-phone words.
                    result.put("dictionary_error",
                        "英汉发音词典未就绪："+String.valueOf(
                            dictionaryFailure.getMessage()));
                }
            }
            if("zh".equals(session.language)){
                result.put("mandarin_note",
                    "普通话：仅显示真实 IPA 音段。音素不等于汉字或拼音音节，"+
                    "当前未提供可信的声调与拼音反向识别。");
            }
            if(active==session)sink.onEvent(result);
        }catch(Exception|LinkageError failure){
            if(active!=session)return;
            try{
                JSONObject error=new JSONObject().put("type","voice_lab")
                    .put("mode","phoneme").put("state","phoneme_result")
                    .put("engine_id",id).put("engine_kind","neural_error")
                    .put("is_trained_phoneme_model",false)
                    .put("duration_ms",Math.round(count*1000.0/RATE))
                    .put("candidates",new JSONArray())
                    .put("message","ZIPA 模型运行失败，不使用旧算法伪装结果")
                    .put("warning",failure.getClass().getSimpleName()+": "+
                        String.valueOf(failure.getMessage()).substring(0,
                            Math.min(180,String.valueOf(failure.getMessage()).length())));
                sink.onEvent(error);
            }catch(Exception ignored){}
        }
    }

    private static void flushCandidate(JSONArray target,String ipa,String english,
            String pinyin,int count,int firstFrame)throws Exception{
        // Require at least two consecutive ~64ms hops for stability.
        if(count<2||ipa.isEmpty()||target.length()>=12)return;
        target.put(new JSONObject()
            .put("ipa",ipa)
            .put("english_words",english)
            .put("pinyin_examples",pinyin)
            .put("start_ms",Math.round(firstFrame*1000.0/RATE))
            .put("duration_ms",Math.round(count*HOP*1000.0/RATE)));
    }
}

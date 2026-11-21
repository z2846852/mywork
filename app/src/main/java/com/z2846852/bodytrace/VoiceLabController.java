package com.z2846852.bodytrace;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.SystemClock;
import org.json.JSONObject;

/**
 * Foreground-only PCM16 analysis, never stores or uploads live microphone data.
 * Native microphone access is required because existing SleepRecorderService
 * produces compressed M4A, not raw PCM.
 *
 * Experimental heads:
 * - PitchDetector: YIN pitch and musical note / cents.
 * - VowelSpectrum: uncalibrated F1/F2 envelope.
 * - PhonemeProbe: vowels via F1/F2 and rough sibilants via spectrum.
 *
 * No speech-to-text, spelling, phone transcription model or scoring claims.
 */
final class VoiceLabController {
    interface Sink{void onEvent(JSONObject event);}
    private static final int RATE=16000;
    private static final int WINDOW=4096;
    private static final int HOP=2048;
    private final Activity activity;
    private final Sink sink;
    private volatile boolean running=false;
    private volatile int generation=0;
    private AudioRecord recorder;
    private String mode="pitch";

    VoiceLabController(Activity activity,Sink sink){
        this.activity=activity;
        this.sink=sink;
    }
    synchronized boolean isRunning(){return running;}
    synchronized String mode(){return mode;}

    private void send(String state,String text){
        try{
            sink.onEvent(new JSONObject().put("type","voice_lab")
                .put("state",state).put("message",text).put("mode",mode));
        }catch(Exception ignored){}
    }
    void start(String requestedMode){
        stop(false);
        if(!("pitch".equals(requestedMode)||
             "vowel".equals(requestedMode)||"fricative".equals(requestedMode))){
            send("error","未知实时模式");return;
        }
        mode=requestedMode;
        if(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
           !=PackageManager.PERMISSION_GRANTED){
            send("error","尚未授权麦克风");return;
        }
        if(SleepRecorderService.isRecording()){
            send("error","睡眠长录音正在进行，请先停止并保存");return;
        }
        try{
            int minimum=AudioRecord.getMinBufferSize(RATE,
                AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
            if(minimum<=0)throw new IllegalStateException("无法获得 16 kHz 录音缓冲区");
            AudioRecord input=new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,
                RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,
                Math.max(minimum,WINDOW*4));
            if(input.getState()!=AudioRecord.STATE_INITIALIZED){
                input.release();
                throw new IllegalStateException("音频采集器未初始化");
            }
            input.startRecording();
            recorder=input;
            running=true;
            final int token=++generation;
            final String snapshotMode=mode;
            Thread thread=new Thread(()->loop(input,token,snapshotMode),
                "bodytrace-live-voice");
            thread.setDaemon(true);
            thread.start();
            send("running","实时采集中（不会保存原始录音）");
        }catch(Exception failure){
            running=false;
            if(recorder!=null){try{recorder.release();}catch(Exception ignored){}recorder=null;}
            send("error","无法开启实时音频："+failure.getMessage());
        }
    }

    private void loop(AudioRecord input,int token,String snapshotMode){
        short[] part=new short[1024];
        short[] window=new short[WINDOW];
        int filled=0;
        long lastEmit=0;
        try{
            while(running&&token==generation){
                int count=input.read(part,0,part.length,AudioRecord.READ_BLOCKING);
                if(count<=0){
                    if(running&&token==generation)
                        send("error","麦克风读取失败："+count);
                    break;
                }
                for(int i=0;i<count;i++){
                    window[filled++]=part[i];
                    if(filled==WINDOW){
                        long now=SystemClock.elapsedRealtime();
                        if(now-lastEmit>=110&&running&&token==generation){
                            PitchDetector.Result pitch=PitchDetector.analyze(window,RATE);
                            JSONObject event=new JSONObject()
                                .put("type","voice_lab").put("state","sample")
                                .put("mode",snapshotMode)
                                .put("pitch_hz",pitch.hz)
                                .put("note",pitch.note())
                                .put("midi",pitch.midi())
                                .put("cents",pitch.cents())
                                .put("rms_dbfs",pitch.rmsDb)
                                .put("clarity",pitch.clarity)
                                .put("timestamp_ms",System.currentTimeMillis());
                            if(!"pitch".equals(snapshotMode)){
                                PhonemeProbe.Result guess=PhonemeProbe.analyze(window,RATE,pitch);
                                if("vowel".equals(snapshotMode)&&
                                   !"vowel_formants".equals(guess.method))
                                    guess=PhonemeProbe.analyze(
                                        new short[0],RATE,pitch);
                                if("fricative".equals(snapshotMode)&&
                                   !"fricative_spectral".equals(guess.method))
                                    guess=PhonemeProbe.analyze(
                                        new short[0],RATE,pitch);
                                event.put("ipa",guess.ipa)
                                    .put("english_words",guess.englishWords)
                                    .put("pinyin_examples",guess.pinyinExamples)
                                    .put("method",guess.method)
                                    .put("warning",guess.warning)
                                    .put("f1_hz",guess.f1)
                                    .put("f2_hz",guess.f2)
                                    .put("fit",guess.fit)
                                    .put("is_trained_phoneme_model",false);
                            }
                            if(token==generation)sink.onEvent(event);
                            lastEmit=now;
                        }
                        System.arraycopy(window,HOP,window,0,WINDOW-HOP);
                        filled=WINDOW-HOP;
                    }
                }
            }
        }catch(Exception failure){
            if(token==generation&&running)
                send("error","实时声音分析异常："+failure.getClass().getSimpleName());
        }finally{
            try{input.stop();}catch(Exception ignored){}
            try{input.release();}catch(Exception ignored){}
            if(token==generation){
                running=false;
                recorder=null;
                send("stopped","实时麦克风已关闭");
            }
        }
    }

    synchronized void stop(boolean notify){
        running=false;
        generation++;
        AudioRecord current=recorder;
        recorder=null;
        if(current!=null){
            try{current.stop();}catch(Exception ignored){}
            // loop's finally will release it after read unblocks.
        }
        if(notify)send("stopped","实时麦克风已关闭");
    }
}

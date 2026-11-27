package com.z2846852.bodytrace;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.VibrationEffect;
import android.os.Vibrator;
import org.json.JSONObject;
import java.util.concurrent.atomic.AtomicBoolean;

/** Feedback tones and preferences shared by microphone capture and preview. */
final class SnoreFeedbackController {
    private static final String PREF = "bodytrace_snore_feedback";
    private static final AtomicBoolean SOUND_PLAYING = new AtomicBoolean(false);
    private static volatile long muteTailUntil;
    static boolean isCuePlaying(){return SOUND_PLAYING.get();}
    static boolean suppressMicrophone(){return isCuePlaying()||android.os.SystemClock.elapsedRealtime()<muteTailUntil;}
    private SnoreFeedbackController(){}

    static final class Settings {
        String sound = "soft";
        int volume = 20;
        double threshold = 0.15;
        int minimum = 2;
        int repeat = 5;
        boolean vibrate = false, soundEnabled = true;
        int vibrationAmplitude=30, vibrationMs=500, soundMs=0;
        int soundMax=40, vibrationMax=40, maxCues=12, delayMinutes=30;
        String vibrationPattern="triplet", mode="fixed", soundPool="", vibrationPool="continuous,triplet,rising,falling,shortlong";
        String soundRhythm="single";

        static Settings parse(String source) throws Exception {
            if (source == null || source.length() > 12000)
                throw new IllegalArgumentException("反馈配置无效");
            JSONObject json = new JSONObject(source);
            Settings s = new Settings();
            s.sound = json.optString("sound", "soft");
            if (!("soft".equals(s.sound) || "low".equals(s.sound) ||
                    "double".equals(s.sound) || "bell".equals(s.sound) || DreamCueSynth.supports(s.sound) || CueLibrary.validId(s.sound)))
                throw new IllegalArgumentException("不支持的提示音");
            s.volume = json.optInt("volume", 20);
            s.threshold = json.optDouble("threshold", 0.15);
            s.minimum = json.optInt("minimum", 2);
            s.repeat = json.optInt("repeat", 5);
            s.vibrate = json.optBoolean("vibrate", false);
            s.soundEnabled=json.optBoolean("soundEnabled",!s.vibrate);
            s.vibrationAmplitude=clamp(json.optInt("vibrationAmplitude",30),1,100);
            s.vibrationMs=clamp(json.optInt("vibrationMs",500),100,2000);
            s.soundMs=clamp(json.optInt("soundMs",0),0,5000);
            s.soundMax=clamp(json.optInt("soundMax",40),1,100);
            s.vibrationMax=clamp(json.optInt("vibrationMax",40),1,100);
            s.maxCues=clamp(json.optInt("maxCues",12),1,40);
            s.delayMinutes=clamp(json.optInt("delayMinutes",30),0,120);
            s.vibrationPattern=choice(json.optString("vibrationPattern"),"triplet","continuous","triplet","rising","falling","shortlong");
            s.soundRhythm=choice(json.optString("soundRhythm"),"single","single","triplet","rising","falling","shortlong");
            s.mode=choice(json.optString("mode"),"fixed","fixed","limited","stairs","explore","adaptive","control");
            s.soundPool=json.optString("soundPool","");
            s.vibrationPool=json.optString("vibrationPool","continuous,triplet,rising,falling,shortlong");
            if (s.volume < 1 || s.volume > 100 ||
                    !Double.isFinite(s.threshold) || s.threshold < 0.01 ||
                    s.threshold > 0.80 || s.minimum < 1 || s.minimum > 5 ||
                    s.repeat < 1 || s.repeat > 60)
                throw new IllegalArgumentException("反馈参数超出范围");
            return s;
        }

        private static int clamp(int x,int lo,int hi){return Math.max(lo,Math.min(hi,x));}
        private static String choice(String x,String fallback,String... values){for(String v:values)if(v.equals(x))return v;return fallback;}
        JSONObject json() throws Exception {
            return new JSONObject().put("sound",sound).put("volume",volume)
                .put("threshold",threshold).put("minimum",minimum)
                .put("repeat",repeat).put("vibrate",vibrate).put("soundEnabled",soundEnabled)
                .put("vibrationAmplitude",vibrationAmplitude).put("vibrationMs",vibrationMs)
                .put("vibrationPattern",vibrationPattern).put("soundMs",soundMs).put("soundRhythm",soundRhythm)
                .put("soundMax",soundMax).put("vibrationMax",vibrationMax).put("maxCues",maxCues)
                .put("delayMinutes",delayMinutes).put("mode",mode).put("soundPool",soundPool).put("vibrationPool",vibrationPool);
        }

        static Settings load(Context c) {
            try {
                return parse(c.getSharedPreferences(PREF,Context.MODE_PRIVATE)
                    .getString("settings","{}"));
            } catch (Exception e) { return new Settings(); }
        }

        static Settings save(Context c,String raw) throws Exception {
            Settings s = parse(raw);
            if (!c.getSharedPreferences(PREF,Context.MODE_PRIVATE).edit()
                    .putString("settings",s.json().toString()).commit())
                throw new IllegalStateException("未能保存反馈设置");
            return s;
        }
    }




    static short[] applyRhythm(short[] pcm,String rhythm){
        if("single".equals(rhythm))return pcm;
        int n=pcm.length;
        short[] result=new short[n];
        for(int i=0;i<n;i++){
            double t=i/(double)n, phase=t*3-Math.floor(t*3);
            int part=Math.min(2,(int)(t*3));
            double gain="rising".equals(rhythm)?(part+1)/3.0:"falling".equals(rhythm)?(3-part)/3.0:1;
            double end="shortlong".equals(rhythm)&&part<2?.45:.80;
            double env=phase>=end?0:Math.min(1,phase/.08)*Math.min(1,(end-phase)/.12);
            result[i]=(short)(pcm[i]*gain*env);
        }
        return result;
    }
    static VibrationEffect vibrationEffect(Settings s,boolean amplitudeControl){
        int amplitude=Math.max(1,Math.min(255,Math.round(s.vibrationAmplitude*255/100f)));
        int total=s.vibrationMs;
        // On binary motors encode requested intensity as duty cycle, not fake amplitude.
        if(!amplitudeControl)amplitude=VibrationEffect.DEFAULT_AMPLITUDE;
        if("continuous".equals(s.vibrationPattern)){
            int on=amplitudeControl?total:Math.max(1,total*s.vibrationAmplitude/100);
            return VibrationEffect.createOneShot(on,amplitude);
        }
        long[] timings=new long[7];int[] amps=new int[7];
        for(int i=0;i<3;i++){
            int segment=total/3+(i==2?total%3:0);
            double ratio="rising".equals(s.vibrationPattern)?(i+1)/3.0:"falling".equals(s.vibrationPattern)?(3-i)/3.0:1;
            int on=Math.max(1,(int)(segment*("shortlong".equals(s.vibrationPattern)&&i<2?.35:.7)*(amplitudeControl?1:s.vibrationAmplitude/100.0*ratio)));
            timings[2*i+1]=on;timings[2*i+2]=segment-on;
            amps[2*i+1]=amplitudeControl?Math.max(1,(int)(amplitude*ratio)):VibrationEffect.DEFAULT_AMPLITUDE;
        }
        return VibrationEffect.createWaveform(timings,amps,-1);
    }
    interface CueListener {
        void onStart(short[] samples,int sampleRate,int durationMs,boolean vibrate);
    }
    static boolean playCue(Context context,Settings s) {
        return playCue(context,s,null);
    }
    static boolean playCue(Context context,Settings s,CueListener listener) {
        if(!SOUND_PLAYING.compareAndSet(false,true))return false;
        AudioTrack track=null;
        android.media.MediaPlayer player=null;
        Vibrator vibrator=null;
        short[] samples=new short[0];
        try{
            int rate=DreamCueSynth.RATE;
            boolean dream=DreamCueSynth.supports(s.sound);
            int duration=dream?DreamCueSynth.durationMs(s.sound):"double".equals(s.sound)?470:
                "bell".equals(s.sound)?510:
                "low".equals(s.sound)?330:270;
            if(s.soundEnabled && CueLibrary.validId(s.sound)) {
                player=new android.media.MediaPlayer();
                player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build());
                player.setDataSource(CueLibrary.file(context,s.sound).getAbsolutePath()); player.prepare();
                duration=Math.min(5000,player.getDuration()); if(s.soundMs>0)duration=Math.min(duration,s.soundMs);
                player.setVolume(s.volume/100f,s.volume/100f);
            } else if(s.soundEnabled) {
                if(dream){samples=DreamCueSynth.synthesize(s.sound,s.volume);}
                else {
                int length=duration*rate/1000;
                samples=new short[length];
                double gain=0.50*s.volume/100.0;
                for(int i=0;i<length;i++){
                    double ms=i*1000.0/rate;
                    double freq= "low".equals(s.sound)?320:
                        "bell".equals(s.sound)?780:
                        "double".equals(s.sound)?560:480;
                    double envelope;
                    if("double".equals(s.sound)){
                        double segment=ms<180?ms:(ms>=245?ms-245:-1);
                        envelope=segment<0||segment>175?0:
                            Math.min(1.0,segment/25.0)*Math.min(1.0,(175-segment)/65.0);
                    }else{
                        envelope=Math.min(1.0,ms/35.0)*
                            Math.min(1.0,Math.max(0,(duration-ms)/130.0));
                    }
                    double sample=Math.sin(2*Math.PI*freq*i/rate);
                    if("bell".equals(s.sound))
                        sample=0.75*sample+0.25*Math.sin(2*Math.PI*freq*2*i/rate);
                    samples[i]=(short)(sample*envelope*gain*32767);
                }
                }
                if(s.soundMs>0){
                    int target=Math.max(1,s.soundMs*rate/1000);
                    short[] resized=new short[target];
                    for(int i=0;i<target;i++)resized[i]=samples[(int)((long)i*samples.length/target)];
                    samples=resized;
                }
                samples=applyRhythm(samples,s.soundRhythm);
                duration=(int)((long)samples.length*1000/rate);
                track=new AudioTrack.Builder()
                    .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    .setAudioFormat(new AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(rate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .setBufferSizeInBytes(samples.length*2).build();
                if(track.getState()==AudioTrack.STATE_UNINITIALIZED)
                    throw new IllegalStateException("声音播放设备不可用");
                int written=track.write(samples,0,samples.length);
                if(written!=samples.length||track.getState()!=AudioTrack.STATE_INITIALIZED)
                    throw new IllegalStateException("声音缓冲区写入失败："+written);
            }
            if(Thread.currentThread().isInterrupted())return false;
            if(track!=null||player!=null){
                android.media.AudioManager audio=(android.media.AudioManager)context.getSystemService(Context.AUDIO_SERVICE);
                if(audio!=null&&audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC)==0)
                    throw new IllegalStateException("系统媒体音量为0，请调高媒体音量");
                if(player!=null)player.start();else track.play();
                if(player==null&&track.getPlayState()!=AudioTrack.PLAYSTATE_PLAYING)
                    throw new IllegalStateException("系统未进入播放状态");
            }
            if(s.vibrate){
                vibrator=android.os.Build.VERSION.SDK_INT>=31?
                    ((android.os.VibratorManager)context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE)).getDefaultVibrator():
                    (Vibrator)context.getSystemService(Context.VIBRATOR_SERVICE);
                if(vibrator==null||!vibrator.hasVibrator())
                    throw new IllegalStateException("设备没有可用震动马达");
                VibrationEffect effect=vibrationEffect(s,vibrator.hasAmplitudeControl());
                android.media.AudioAttributes attrs=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build();
                if(android.os.Build.VERSION.SDK_INT>=33)
                    vibrator.vibrate(effect,new android.os.VibrationAttributes.Builder().setUsage(android.os.VibrationAttributes.USAGE_NOTIFICATION).build());
                else vibrator.vibrate(effect,attrs);
            }
            if(!s.soundEnabled&&!s.vibrate)return false;
            duration=Math.max(s.soundEnabled?duration:0,s.vibrate?s.vibrationMs:0);
            if(listener!=null)listener.onStart(samples,rate,duration,s.vibrate);
            Thread.sleep(duration+60L);
            return true;
        }catch(InterruptedException stopped){
            Thread.currentThread().interrupt();return false;
        }catch(Exception failure){
            android.util.Log.e("SleepFeedback","Cue playback failed",failure);
            throw new IllegalStateException("提示音/震动失败："+failure.getClass().getSimpleName()+" "+failure.getMessage(),failure);
        }finally{
            if(vibrator!=null)try{vibrator.cancel();}catch(Exception ignored){}
            if(player!=null){try{player.stop();}catch(Exception ignored){}player.release();}
            if(track!=null){try{track.stop();}catch(Exception ignored){}try{track.release();}catch(Exception ignored){}}
            muteTailUntil=android.os.SystemClock.elapsedRealtime()+500L;
            SOUND_PLAYING.set(false);
        }
    }
}

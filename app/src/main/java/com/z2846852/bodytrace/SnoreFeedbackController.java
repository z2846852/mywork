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
        double threshold = 0.50;
        int minimum = 4;
        int repeat = 5;
        boolean vibrate = false, soundEnabled = true, vibrationCompatibility=false;
        int vibrationAmplitude=30, vibrationMs=500, soundMs=0;
        int soundMax=40, vibrationMax=40, soundMin=5, vibrationMin=5, soundMsMax=5000, vibrationMsMax=1000, maxCues=12, delayMinutes=30;
        int actualSoundMs=0,actualVibrationMs=0,directGainPercent=0,directRepeats=1;
        boolean pauseOnScreen=true, directGain=true,directExtend=true;
        String vibrationPattern="triplet", mode="direct", soundPool="", vibrationPool="continuous,triplet,rising,falling,shortlong";
        String soundRhythm="single", soundRhythmPool="single,triplet,rising,falling,shortlong", trialId="";

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
            s.threshold = json.optInt("ai_curve_version",0)==1?json.optDouble("threshold",0.50):0.50;
            s.minimum = json.optInt("trigger_window_seconds",0)==FeedbackPolicy.SNORE_WINDOW_SECONDS?Math.max(3,json.optInt("trigger_episodes",4)):4;
            s.repeat = json.optInt("repeat", 5);
            s.vibrate = json.optBoolean("vibrate", false);
            s.vibrationCompatibility=json.optBoolean("vibrationCompatibility",false);
            s.soundEnabled=json.optBoolean("soundEnabled",!s.vibrate);
            s.vibrationAmplitude=clamp(json.optInt("vibrationAmplitude",30),1,100);
            s.vibrationMs=clamp(json.optInt("vibrationMs",500),100,2000);
            s.soundMs=clamp(json.optInt("soundMs",0),0,5000);
            s.soundMax=clamp(json.optInt("soundMax",40),1,100);
            s.vibrationMax=clamp(json.optInt("vibrationMax",40),1,100);
            s.soundMin=clamp(json.optInt("soundMin",5),1,s.soundMax);
            s.vibrationMin=clamp(json.optInt("vibrationMin",5),1,s.vibrationMax);
            s.soundMsMax=clamp(json.optInt("soundMsMax",5000),150,5000);
            s.vibrationMsMax=clamp(json.optInt("vibrationMsMax",1000),100,2000);
            s.pauseOnScreen=json.optBoolean("pauseOnScreen",true);
            s.maxCues=clamp(json.optInt("maxCues",12),1,40);
            s.delayMinutes=clamp(json.optInt("delayMinutes",30),0,120);
            s.vibrationPattern=VibrationLibrary.validId(json.optString("vibrationPattern"))?json.optString("vibrationPattern"):choice(json.optString("vibrationPattern"),"triplet","continuous","triplet","rising","falling","shortlong");
            s.soundRhythm=choice(json.optString("soundRhythm"),"single","single","triplet","rising","falling","shortlong");
            s.mode=json.has("directGain")?choice(json.optString("mode"),"direct","direct","fixed","limited","stairs","explore","adaptive","control","vibration_threshold"):"direct";
            s.directGain=json.optBoolean("directGain",true);
            s.directExtend=json.optBoolean("directExtend",true);
            if("direct".equals(s.mode)){s.minimum=4;s.pauseOnScreen=false;}
            s.soundRhythmPool=validateRhythms(json.optString("soundRhythmPool","single,triplet,rising,falling,shortlong"));
            s.soundPool=validatePool(json.optString("soundPool",""),true);
            s.vibrationPool=validatePool(json.optString("vibrationPool","continuous,triplet,rising,falling,shortlong"),false);
            if (s.volume < 1 || s.volume > 100 ||
                    !Double.isFinite(s.threshold) || s.threshold < 0.01 ||
                    s.threshold > 0.80 || s.minimum < 3 || s.minimum > 5 ||
                    s.repeat < 1 || s.repeat > 60)
                throw new IllegalArgumentException("反馈参数超出范围");
            return s;
        }

        private static String validateRhythms(String raw){
            if("__none__".equals(raw))return raw;
            java.util.LinkedHashSet<String> set=new java.util.LinkedHashSet<>();
            for(String v:raw.split(",")){if(choice(v,"","single","triplet","rising","falling","shortlong").isEmpty())throw new IllegalArgumentException("无效声音节奏");set.add(v);}
            return String.join(",",set);
        }
        private static String validatePool(String raw,boolean sound){
            if(raw.isEmpty()||"__none__".equals(raw))return raw;
            java.util.LinkedHashSet<String> set=new java.util.LinkedHashSet<>();
            for(String v:raw.split(",")){
                boolean valid=sound?("soft".equals(v)||"low".equals(v)||"double".equals(v)||"bell".equals(v)||DreamCueSynth.supports(v)||CueLibrary.validId(v)):
                    (VibrationLibrary.validId(v)||!choice(v,"","continuous","triplet","rising","falling","shortlong").isEmpty());
                if(!valid||set.size()>=64)throw new IllegalArgumentException("无效刺激素材池");
                set.add(v);
            }return String.join(",",set);
        }
        private static int clamp(int x,int lo,int hi){return Math.max(lo,Math.min(hi,x));}
        private static String choice(String x,String fallback,String... values){for(String v:values)if(v.equals(x))return v;return fallback;}
        JSONObject json() throws Exception {
            return new JSONObject().put("sound",sound).put("volume",volume)
                .put("ai_curve_version",1).put("threshold",threshold).put("minimum",minimum).put("trigger_episodes",minimum).put("trigger_window_seconds",FeedbackPolicy.SNORE_WINDOW_SECONDS)
                .put("repeat",repeat).put("vibrate",vibrate).put("soundEnabled",soundEnabled).put("vibrationCompatibility",vibrationCompatibility)
                .put("vibrationAmplitude",vibrationAmplitude).put("vibrationMs",vibrationMs)
                .put("vibrationPattern",vibrationPattern).put("soundMs",soundMs).put("soundRhythm",soundRhythm)
                .put("trial_id",trialId).put("direct_gain_percent",directGainPercent).put("direct_repeats",directRepeats).put("actualSoundMs",actualSoundMs).put("actualVibrationMs",actualVibrationMs)
                .put("soundMin",soundMin).put("vibrationMin",vibrationMin).put("soundMsMax",soundMsMax).put("vibrationMsMax",vibrationMsMax).put("pauseOnScreen",pauseOnScreen).put("soundRhythmPool",soundRhythmPool)
                .put("soundMax",soundMax).put("vibrationMax",vibrationMax).put("maxCues",maxCues)
                .put("delayMinutes",delayMinutes).put("mode",mode).put("directGain",directGain).put("directExtend",directExtend).put("soundPool",soundPool).put("vibrationPool",vibrationPool);
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
    static Vibrator getVibrator(Context context){
        if(android.os.Build.VERSION.SDK_INT>=31){
            android.os.VibratorManager manager=(android.os.VibratorManager)context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return manager==null?null:manager.getDefaultVibrator();
        }return (Vibrator)context.getSystemService(Context.VIBRATOR_SERVICE);
    }
    static JSONObject vibrationHardware(Context c)throws Exception{
        Vibrator v=getVibrator(c);
        JSONObject info=new JSONObject().put("available",v!=null&&v.hasVibrator()).put("amplitude",v!=null&&v.hasAmplitudeControl())
            .put("manufacturer",android.os.Build.MANUFACTURER).put("model",android.os.Build.MODEL)
            .put("sdk",android.os.Build.VERSION.SDK_INT)
            .put("permission",c.checkSelfPermission(android.Manifest.permission.VIBRATE)==android.content.pm.PackageManager.PERMISSION_GRANTED);
        android.app.NotificationManager nm=(android.app.NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
        if(nm!=null)info.put("interruption_filter",nm.getCurrentInterruptionFilter());
        return info;
    }
    static VibrationEffect vibrationEffect(Context context,Settings s,boolean amplitudeControl)throws Exception{
        if(VibrationLibrary.validId(s.vibrationPattern))return VibrationLibrary.effect(context,s.vibrationPattern,s.vibrationAmplitude,s.vibrationMs,amplitudeControl);
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
        return amplitudeControl?VibrationEffect.createWaveform(timings,amps,-1):VibrationEffect.createWaveform(timings,-1);
    }
    interface CueListener {
        void onStart(short[] samples,int sampleRate,int durationMs,boolean vibrate);
    }
    static boolean playCue(Context context,Settings s) {
        return playCue(context,s,null);
    }
    static boolean playCue(Context context,Settings s,CueListener listener) {
        return playCue(context,s,listener,false,false);
    }
    // Foreground feedback is interactive media, not a notification.
    // Overnight cues retain notification usage and respect system policy.
    static boolean playCue(Context context,Settings s,CueListener listener,boolean foregroundPreview,boolean defaultMotorTest) {
        if(!SOUND_PLAYING.compareAndSet(false,true))return false;
        AudioTrack track=null;
        Vibrator vibrator=null;
        short[] samples=new short[0];
        try{
            int rate=DreamCueSynth.RATE;
            boolean dream=DreamCueSynth.supports(s.sound);
            int duration=dream?DreamCueSynth.durationMs(s.sound):"double".equals(s.sound)?470:
                "bell".equals(s.sound)?510:
                "low".equals(s.sound)?330:270;
            if(s.soundEnabled) {
                boolean clip=CueLibrary.validId(s.sound);
                if(clip){samples=CueLibrary.loadPcm(context,s.sound);}
                else if(dream){samples=DreamCueSynth.synthesize(s.sound,100);}
                else {
                int length=duration*rate/1000;
                samples=new short[length];
                double gain=0.20;
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
                int limit=s.soundMs>0?Math.min(s.soundMs,s.soundMsMax):s.soundMsMax;
                // Preserve a complete spoken clip. For original synthesized motifs, zero means native length.
                int requested=s.soundMs==0&&"single".equals(s.soundRhythm)&&samples.length*1000L/rate<=limit?0:limit;
                samples=CuePcm.render(samples,requested,s.soundRhythm,clip,s.volume);
                if("direct".equals(s.mode)&&s.directRepeats==2)samples=CuePcm.repeatOnce(samples);
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
            if(s.vibrate){vibrator=getVibrator(context);if(vibrator==null||!vibrator.hasVibrator())throw new IllegalStateException("设备没有可用震动马达");}
            if(Thread.currentThread().isInterrupted())return false;
            if(track!=null){
                android.media.AudioManager audio=(android.media.AudioManager)context.getSystemService(Context.AUDIO_SERVICE);
                if(audio!=null&&audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC)==0)
                    throw new IllegalStateException("系统媒体音量为0，请调高媒体音量");
                track.play();
                if(track.getPlayState()!=AudioTrack.PLAYSTATE_PLAYING)
                    throw new IllegalStateException("系统未进入播放状态");
            }
            if(s.vibrate){
                vibrator=getVibrator(context);
                if(vibrator==null||!vibrator.hasVibrator())
                    throw new IllegalStateException("设备没有可用震动马达");
                boolean explicitAmplitude=vibrator.hasAmplitudeControl()&&!s.vibrationCompatibility;
                VibrationEffect effect=defaultMotorTest?VibrationEffect.createOneShot(s.vibrationMs,VibrationEffect.DEFAULT_AMPLITUDE):vibrationEffect(context,s,explicitAmplitude);
                android.media.AudioAttributes attrs=new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(foregroundPreview?AudioAttributes.USAGE_MEDIA:AudioAttributes.USAGE_NOTIFICATION).build();
                if(defaultMotorTest){
                    // Standalone foreground baseline, without a notification or amplitude array.
                    vibrator.vibrate(effect);
                }else if(android.os.Build.VERSION.SDK_INT>=33){
                    int usage=foregroundPreview?android.os.VibrationAttributes.USAGE_MEDIA:android.os.VibrationAttributes.USAGE_NOTIFICATION;
                    vibrator.vibrate(effect,new android.os.VibrationAttributes.Builder().setUsage(usage).build());
                }else vibrator.vibrate(effect,attrs);
            }
            if(!s.soundEnabled&&!s.vibrate)return false;
            s.actualSoundMs=s.soundEnabled?duration:0;s.actualVibrationMs=s.vibrate?s.vibrationMs:0;
            duration=Math.max(s.actualSoundMs,s.actualVibrationMs);
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
            if(track!=null){try{track.stop();}catch(Exception ignored){}try{track.release();}catch(Exception ignored){}}
            muteTailUntil=android.os.SystemClock.elapsedRealtime()+500L;
            SOUND_PLAYING.set(false);
        }
    }
}

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
    private SnoreFeedbackController(){}

    static final class Settings {
        String sound = "soft";
        int volume = 20;
        double threshold = 0.15;
        int minimum = 2;
        int repeat = 5;
        boolean vibrate = false;

        static Settings parse(String source) throws Exception {
            if (source == null || source.length() > 2000)
                throw new IllegalArgumentException("反馈配置无效");
            JSONObject json = new JSONObject(source);
            Settings s = new Settings();
            s.sound = json.optString("sound", "soft");
            if (!("soft".equals(s.sound) || "low".equals(s.sound) ||
                    "double".equals(s.sound) || "bell".equals(s.sound)))
                throw new IllegalArgumentException("不支持的提示音");
            s.volume = json.optInt("volume", 20);
            s.threshold = json.optDouble("threshold", 0.15);
            s.minimum = json.optInt("minimum", 2);
            s.repeat = json.optInt("repeat", 5);
            s.vibrate = json.optBoolean("vibrate", false);
            if (s.volume < 1 || s.volume > 100 ||
                    !Double.isFinite(s.threshold) || s.threshold < 0.01 ||
                    s.threshold > 0.80 || s.minimum < 1 || s.minimum > 5 ||
                    s.repeat < 1 || s.repeat > 60)
                throw new IllegalArgumentException("反馈参数超出范围");
            return s;
        }

        JSONObject json() throws Exception {
            return new JSONObject().put("sound",sound).put("volume",volume)
                .put("threshold",threshold).put("minimum",minimum)
                .put("repeat",repeat).put("vibrate",vibrate);
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




    interface CueListener {
        void onStart(short[] samples,int sampleRate,int durationMs,boolean vibrate);
    }
    static boolean playCue(Context context,Settings s) {
        return playCue(context,s,null);
    }
    static boolean playCue(Context context,Settings s,CueListener listener) {
        if(!SOUND_PLAYING.compareAndSet(false,true))return false;
        AudioTrack track=null;
        short[] samples=new short[0];
        try{
            int rate=22050;
            int duration="double".equals(s.sound)?470:
                "bell".equals(s.sound)?510:
                "low".equals(s.sound)?330:270;
            if(!s.vibrate) {
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
            if(track!=null){
                android.media.AudioManager audio=(android.media.AudioManager)context.getSystemService(Context.AUDIO_SERVICE);
                if(audio!=null&&audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC)==0)
                    throw new IllegalStateException("系统媒体音量为0，请调高媒体音量");
                track.play();
                if(track.getPlayState()!=AudioTrack.PLAYSTATE_PLAYING)
                    throw new IllegalStateException("系统未进入播放状态");
            }
            if(s.vibrate){
                Vibrator vibrator=(Vibrator)context.getSystemService(Context.VIBRATOR_SERVICE);
                if(vibrator==null||!vibrator.hasVibrator())
                    throw new IllegalStateException("设备没有可用震动马达");
                vibrator.vibrate(VibrationEffect.createOneShot(100,
                    VibrationEffect.DEFAULT_AMPLITUDE));
            }
            if(listener!=null)listener.onStart(samples,rate,duration,s.vibrate);
            if(track!=null)Thread.sleep(duration+60L);
            else Thread.sleep(170L);
            return true;
        }catch(Exception failure){
            android.util.Log.e("SleepFeedback","Cue playback failed",failure);
            throw new IllegalStateException("提示音/震动失败："+failure.getClass().getSimpleName()+" "+failure.getMessage(),failure);
        }finally{
            if(track!=null){try{track.stop();}catch(Exception ignored){}try{track.release();}catch(Exception ignored){}}
            SOUND_PLAYING.set(false);
        }
    }
}

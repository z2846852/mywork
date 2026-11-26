package com.z2846852.bodytrace;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import org.json.JSONObject;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * User-started live snore feedback, using the same bundled YAMNet model as offline analysis.
 * Live microphone capture is deliberately exclusive with the legacy MediaRecorder.
 * No recording or audio is retained/uploaded in this mode.
 */
public final class SnoreFeedbackService extends Service {
    static final String ACTION_START = "com.z2846852.bodytrace.SNORE_FEEDBACK_START";
    static final String ACTION_STOP = "com.z2846852.bodytrace.SNORE_FEEDBACK_STOP";
    private static final String PREF = "bodytrace_snore_feedback";
    private static final String CHANNEL = "bodytrace_snore_feedback_mic";
    private static final int NOTIFICATION_ID = 4218;
    private static final AtomicBoolean SOUND_PLAYING = new AtomicBoolean(false);
    private static volatile boolean active;
    private static volatile double lastScore;
    private static volatile int cues;
    private static volatile long lastCueMs;
    private static volatile long startedMs;
    private static volatile long muteUntilElapsed;
    private volatile boolean running;
    private volatile AudioRecord microphone;
    private Thread captureThread;
    private PowerManager.WakeLock wakeLock;

    static boolean isActive() { return active; }

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

    static JSONObject status(Context c) throws Exception {
        return new JSONObject().put("type","sleep_feedback_status")
            .put("active",active).put("settings",Settings.load(c).json())
            .put("last_score",lastScore).put("cues",cues)
            .put("last_cue_ms",lastCueMs).put("started_ms",startedMs);
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        String action=intent==null?"":intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopCapture();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(action)) return START_NOT_STICKY;
        if (running || active) { notifyStatus(); return START_NOT_STICKY; }
        if (SleepRecorderService.isRecording()) {
            notifyError("请先停止整晚录音，再开启实时鼾声反馈");
            stopSelf();return START_NOT_STICKY;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=
                PackageManager.PERMISSION_GRANTED) {
            notifyError("未获得麦克风权限，反馈未启动");
            stopSelf();return START_NOT_STICKY;
        }
        try {
            NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
            NotificationChannel channel=new NotificationChannel(CHANNEL,"鼾声实时反馈",
                NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("实时检测鼾声，锁屏继续运行，通知可停止");
            nm.createNotificationChannel(channel);
            if (Build.VERSION.SDK_INT>=29)
                startForeground(NOTIFICATION_ID,notification(),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(NOTIFICATION_ID,notification());
            running=true;
            active=true;
            cues=0;lastCueMs=0;lastScore=0;startedMs=System.currentTimeMillis();
            PowerManager pm=(PowerManager)getSystemService(POWER_SERVICE);
            wakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,
                "bodytrace:snore-feedback");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
            captureThread=new Thread(this::captureLoop,"snore-feedback-capture");
            captureThread.start();
            notifyStatus();
        } catch (Exception e) {
            notifyError("实时反馈启动失败：" + e.getClass().getSimpleName());
            stopCapture();stopSelf();
        }
        return START_NOT_STICKY;
    }

    private Notification notification() {
        int flags=PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent open=PendingIntent.getActivity(this,4218,
            new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            flags);
        PendingIntent stop=PendingIntent.getService(this,4219,
            new Intent(this,SnoreFeedbackService.class).setAction(ACTION_STOP),flags);
        return new Notification.Builder(this,CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
            .setContentTitle("BodyTrace · 鼾声反馈中")
            .setContentText("检测到鼾声时轻声提示侧睡 · 点击停止")
            .setContentIntent(open).setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(android.R.drawable.ic_media_pause,"停止反馈",stop)
            .build();
    }

    private void captureLoop() {
        AudioRecord record=null;
        try (SleepYamnetClassifier classifier=new SleepYamnetClassifier(this,16000,1)) {
            int min=AudioRecord.getMinBufferSize(16000,
                AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
            if (min<=0) throw new IllegalStateException("设备不支持16kHz麦克风录制");
            record=new AudioRecord(MediaRecorder.AudioSource.MIC,16000,
                AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,
                Math.max(min*2,16384));
            if (record.getState()!=AudioRecord.STATE_INITIALIZED)
                throw new IllegalStateException("麦克风初始化失败");
            microphone=record;
            record.startRecording();
            if (record.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)
                throw new IllegalStateException("麦克风无法开始录制");
            short[] pcm=new short[1600];
            int previous=0,consecutive=0;
            long previousCueElapsed=0,reported=0;
            while(running) {
                int n=record.read(pcm,0,pcm.length,AudioRecord.READ_BLOCKING);
                if (n<0) {
                    if (!running) break;
                    throw new IllegalStateException("麦克风读取失败："+n);
                }
                boolean muted=SystemClock.elapsedRealtime()<muteUntilElapsed;
                for(int i=0;i<n;i++)classifier.addSample(muted?0:pcm[i]);
                int count=classifier.scoreCount();
                if(count!=previous){
                    previous=count;
                    double score=classifier.lastSnoreScore();
                    lastScore=score;
                    Settings settings=Settings.load(this);
                    consecutive=(!muted&&score>=settings.threshold)?
                        Math.min(consecutive+1,5):0;
                    long now=SystemClock.elapsedRealtime();
                    if(consecutive>=settings.minimum &&
                            (previousCueElapsed==0 ||
                             now-previousCueElapsed>=settings.repeat*1000L)) {
                        previousCueElapsed=now;
                        if(playCue(this,settings)){
                            cues++;
                            lastCueMs=System.currentTimeMillis();
                            consecutive=0;
                            notifyStatus();
                        }
                    }
                    if(now-reported>=2000){
                        reported=now;notifyStatus();
                    }
                }
            }
        }catch(Exception e){
            if(running) notifyError("实时鼾声检测已停止：" +
                e.getClass().getSimpleName()+" "+e.getMessage());
        }finally{
            running=false;active=false;lastScore=0;
            microphone=null;
            if(record!=null){
                try{record.stop();}catch(Exception ignored){}
                try{record.release();}catch(Exception ignored){}
            }
            if(wakeLock!=null){
                try{if(wakeLock.isHeld())wakeLock.release();}catch(Exception ignored){}
                wakeLock=null;
            }
            notifyStatus();
            stopSelf();
        }
    }

    private void stopCapture() {
        running=false;
        AudioRecord record=microphone;
        if(record!=null)try{record.stop();}catch(Exception ignored){}
    }

    @Override public void onDestroy() {
        stopCapture();
        if(wakeLock!=null)try{if(wakeLock.isHeld())wakeLock.release();}catch(Exception ignored){}
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    private void notifyStatus() {
        try { notifyEvent(status(this)); }catch(Exception ignored){}
    }

    private void notifyError(String error) {
        try { notifyEvent(new JSONObject().put("type","sleep_feedback_error")
            .put("message",error)); }catch(Exception ignored){}
    }

    private void notifyEvent(JSONObject event) {
        sendBroadcast(new Intent(SleepAnalysisService.ACTION_EVENT)
            .setPackage(getPackageName())
            .putExtra(SleepAnalysisService.EXTRA_JSON,event.toString()));
    }

    /**
     * Native preview and live cue are identical. Playback does not need microphone access.
     * AudioTrack uses device media volume, and the slider scales the waveform amplitude.
     */
    static boolean playCue(Context context,Settings s) {
        if(!SOUND_PLAYING.compareAndSet(false,true))return false;
        AudioTrack track=null;
        try{
            int rate=22050;
            int duration="double".equals(s.sound)?470:
                "bell".equals(s.sound)?510:
                "low".equals(s.sound)?330:270;
            if(!s.vibrate) {
                int length=duration*rate/1000;
                short[] samples=new short[length];
                double gain=0.24*s.volume/100.0;
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
                if(track.getState()!=AudioTrack.STATE_INITIALIZED)
                    throw new IllegalStateException("声音播放设备不可用");
                int written=track.write(samples,0,samples.length);
                if(written!=samples.length)
                    throw new IllegalStateException("声音缓冲区写入失败");
            }
            muteUntilElapsed=SystemClock.elapsedRealtime()+duration+350L;
            if(track!=null)track.play();
            if(s.vibrate){
                Vibrator vibrator=(Vibrator)context.getSystemService(Context.VIBRATOR_SERVICE);
                if(vibrator!=null&&vibrator.hasVibrator())
                    vibrator.vibrate(VibrationEffect.createOneShot(100,
                        VibrationEffect.DEFAULT_AMPLITUDE));
            }
            if(track!=null)Thread.sleep(duration+60L);
            else Thread.sleep(170L);
            return true;
        }catch(Exception ignored){
            return false;
        }finally{
            if(track!=null)try{track.stop();track.release();}catch(Exception ignored){}
            SOUND_PLAYING.set(false);
        }
    }
}

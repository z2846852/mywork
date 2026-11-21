package com.z2846852.bodytrace;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import org.json.JSONObject;
import java.io.File;
import java.util.UUID;

/**
 * User-initiated recording. This foreground service owns the microphone and
 * continues after the screen locks. Not auto-restarted by BOOT_COMPLETED.
 */
public final class SleepRecorderService extends Service {
    static final String ACTION_START = "com.z2846852.bodytrace.SLEEP_START";
    static final String ACTION_STOP = "com.z2846852.bodytrace.SLEEP_STOP";
    private static final String CHANNEL = "bodytrace_sleep_mic";
    private static final int NOTIFICATION_ID = 4215;
    private static volatile String currentId = "";
    private MediaRecorder recorder;
    private PowerManager.WakeLock wakeLock;
    private String id;
    private long startMs;
    private boolean started;

    static boolean isRecording() { return !currentId.isEmpty(); }
    static boolean isCurrentSession(String session) { return currentId.equals(session); }
    static String currentSessionId() { return currentId; }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        String action=intent==null?"":intent.getAction();
        if (ACTION_STOP.equals(action)) {
            finishRecording();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (started || isRecording()) return START_NOT_STICKY;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED) {
            stopSelf();return START_NOT_STICKY;
        }
        try {
            createChannel();
            Notification n=notification();
            if (Build.VERSION.SDK_INT>=29)
                startForeground(NOTIFICATION_ID,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(NOTIFICATION_ID,n);
            startMs=System.currentTimeMillis();
            id=startMs+"-"+UUID.randomUUID().toString().substring(0,8);
            File file=SleepSessions.audio(this,id);
            recorder = new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioChannels(1);
            recorder.setAudioSamplingRate(16000);
            recorder.setAudioEncodingBitRate(24000);
            recorder.setMaxDuration(12*60*60*1000); // guard accidentally leaving it on
            recorder.setOutputFile(file.getAbsolutePath());
            recorder.setOnInfoListener((mr,what,extra)->{
                if(what==MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED){
                    finishRecording();stopSelf();
                }
            });
            recorder.prepare();
            recorder.start();
            started=true;
            currentId=id;
            PowerManager pm=(PowerManager)getSystemService(POWER_SERVICE);
            wakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"bodytrace:sleep-microphone");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(12*60*60*1000L);
            JSONObject session=new JSONObject();
            session.put("id",id);
            session.put("started_ms",startMs);
            session.put("status","recording");
            session.put("codec","AAC-LC");
            session.put("source","local-microphone");
            SleepSessions.write(this,session);
        } catch(Exception e) {
            // Never leave an invisible recorder running when metadata failed.
            finishRecording();
            if(id!=null) {
                try{
                    JSONObject s=new JSONObject();
                    s.put("id",id).put("started_ms",startMs)
                        .put("status","failed").put("ended_ms",System.currentTimeMillis())
                        .put("error","录音启动失败："+e.getClass().getSimpleName());
                    SleepSessions.write(this,s);
                } catch(Exception ignored){}
            }
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void createChannel(){
        NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel ch=new NotificationChannel(CHANNEL,"睡眠录音",
            NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("录音时持续显示，可从通知停止录音");
        nm.createNotificationChannel(ch);
    }

    private Notification notification(){
        Intent open=new Intent(this,MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int immutable=PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent content=PendingIntent.getActivity(this,4215,open,immutable);
        Intent stop=new Intent(this,SleepRecorderService.class).setAction(ACTION_STOP);
        PendingIntent end=PendingIntent.getService(this,4216,stop,immutable);
        return new Notification.Builder(this,CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("BodyTrace · 正在录制睡眠声音")
            .setContentText("锁屏后继续录音 · 点击停止并保存")
            .setContentIntent(content).setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(android.R.drawable.ic_media_pause,"停止录音",end)
            .build();
    }

    private synchronized void finishRecording() {
        if(recorder==null && !started) return;
        boolean valid=started;
        if(recorder!=null){
            try {
                if(started)recorder.stop();
            }catch(RuntimeException exception){ valid=false; }
            try {recorder.reset();recorder.release();}catch(Exception ignored){}
            recorder=null;
        }
        if(wakeLock!=null){
            if(wakeLock.isHeld())wakeLock.release();
            wakeLock=null;
        }
        started=false;
        currentId="";
        if(id!=null){
            boolean saved=false;
            long bytes=0,elapsed=0;
            String failure="";
            try{
                JSONObject s;
                try{s=SleepSessions.load(this,id);}
                catch(Exception ignored){s=new JSONObject().put("id",id).put("started_ms",startMs);}
                long ended=System.currentTimeMillis();
                elapsed=Math.max(0,ended-startMs);
                File audio=SleepSessions.audio(this,id);
                bytes=audio.isFile()?audio.length():0;
                saved=valid&&bytes>1024;
                s.put("ended_ms",ended);
                s.put("duration_ms",elapsed);
                s.put("audio_bytes",bytes);
                s.put("status",saved?"completed":"failed");
                if(!saved){
                    failure="录音未能正常完成，音频可能不完整";
                    s.put("error",failure);
                }else s.remove("error");
                SleepSessions.write(this,s);
            }catch(Exception failureError){
                saved=false;
                failure="录音数据保存失败："+failureError.getClass().getSimpleName();
            }
            // Completion event is sent ONLY after MediaRecorder.stop and session JSON
            // have been committed. A fixed 1200ms refresh may arrive too early.
            try{
                JSONObject event=new JSONObject()
                    .put("type","sleep_recording_finished")
                    .put("id",id).put("saved",saved)
                    .put("bytes",bytes).put("duration_ms",elapsed)
                    .put("message",failure);
                Intent broadcast=new Intent(SleepAnalysisService.ACTION_EVENT)
                    .setPackage(getPackageName())
                    .putExtra(SleepAnalysisService.EXTRA_JSON,event.toString());
                sendBroadcast(broadcast);
            }catch(Exception ignored){}
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
    }

    @Override public void onDestroy(){
        finishRecording();
        super.onDestroy();
    }
}

package com.z2846852.bodytrace;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * User-initiated foreground analysis of a local recording. Decoding is owned by
 * this service, NOT MainActivity's GitHub/storage worker or the WebView.
 * All audio and envelope caches remain on the device.
 */
public final class SleepAnalysisService extends Service {
    static final String ACTION_START="com.z2846852.bodytrace.SLEEP_ANALYSIS_START";
    static final String ACTION_EVENT="com.z2846852.bodytrace.SLEEP_ANALYSIS_EVENT";
    static final String EXTRA_JSON="event_json";
    static final String EXTRA_ID="session_id";
    static final String EXTRA_THRESHOLD="threshold";
    static final String EXTRA_MINIMUM="minimum";
    static final String EXTRA_GAP="gap";
    static final String EXTRA_REFRESH_SPEECH="refresh_speech";
    private static final String CHANNEL="bodytrace_sleep_analysis";
    private static final int RUNNING_NOTIFICATION=4217;
    private static final int DONE_NOTIFICATION=4218;
    private static volatile String activeId="";
    private static volatile int progressPercent=0;
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private PowerManager.WakeLock decodeWakeLock;

    static boolean isRunning(){return !activeId.isEmpty();}
    static String currentId(){return activeId;}
    static int currentProgress(){return progressPercent;}

    @Override public IBinder onBind(Intent intent){return null;}

    @Override public void onCreate(){
        super.onCreate();
        NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel channel=new NotificationChannel(CHANNEL,"睡眠音频分析",
            NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("长录音分析时显示进度与完成状态");
        manager.createNotificationChannel(channel);
    }

    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null||!ACTION_START.equals(intent.getAction())){
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        String id=intent.getStringExtra(EXTRA_ID);
        int threshold=intent.getIntExtra(EXTRA_THRESHOLD,-40);
        int minimum=intent.getIntExtra(EXTRA_MINIMUM,5);
        int gap=intent.getIntExtra(EXTRA_GAP,1);
        boolean refreshSpeech=intent.getBooleanExtra(EXTRA_REFRESH_SPEECH,false);
        try{
            SleepSessions.verifyId(id);
            if(threshold<-90||threshold>-5||minimum<1||minimum>120||gap<0||gap>5)
                throw new IllegalArgumentException("分析参数不合法");
            if(SleepRecorderService.isRecording())
                throw new IllegalStateException("录音进行中不能分析，请先停止");
            synchronized(SleepAnalysisService.class){
                if(!activeId.isEmpty()){
                    if(!activeId.equals(id))
                        publishError("睡眠音频分析启动失败：已有其他录音正在分析");
                    return START_REDELIVER_INTENT;
                }
                activeId=id;
                progressPercent=0;
            }
            Notification initial=ongoingNotification(0);
            if(Build.VERSION.SDK_INT>=35)
                startForeground(RUNNING_NOTIFICATION,initial,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING);
            else if(Build.VERSION.SDK_INT>=29)
                startForeground(RUNNING_NOTIFICATION,initial,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(RUNNING_NOTIFICATION,initial);
            executor.execute(()->analyze(id,threshold,minimum,gap,refreshSpeech));
            return START_REDELIVER_INTENT;
        }catch(Exception e){
            activeId="";
            publishError("睡眠音频分析启动失败："+reason(e));
            stopSelf(startId);
            return START_NOT_STICKY;
        }
    }

    private PendingIntent openApp(){
        Intent open=new Intent(this,MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this,4219,open,
            PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification.Builder baseNotification(){
        return new Notification.Builder(this,CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentIntent(openApp())
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE);
    }

    private Notification ongoingNotification(int percent){
        return baseNotification()
            .setContentTitle("体迹 · 分析整晚音频")
            .setContentText("正在处理："+percent+"% · 可以锁屏或切换应用")
            .setProgress(100,percent,false)
            .setOngoing(true)
            .build();
    }

    private void send(JSONObject event){
        Intent intent=new Intent(ACTION_EVENT);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_JSON,event.toString());
        sendBroadcast(intent);
    }

    private void publishError(String message){
        try{
            send(new JSONObject().put("type","error").put("message",message));
        }catch(Exception ignored){}
    }

    private void publishProgress(String id,int percent){
        progressPercent=Math.max(0,Math.min(100,percent));
        try{
            NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
            manager.notify(RUNNING_NOTIFICATION,ongoingNotification(progressPercent));
            send(new JSONObject().put("type","sleep_analysis_progress")
                .put("id",id).put("percent",progressPercent)
                .put("updated_ms",System.currentTimeMillis()));
        }catch(Exception ignored){/* Decoding must continue if notification update fails. */}
    }

    private void finishedNotification(boolean success){
        stopForeground(STOP_FOREGROUND_REMOVE);
        String title=success?"睡眠音频分析完成":"睡眠音频分析未完成";
        Notification note=baseNotification()
            .setSmallIcon(success?android.R.drawable.stat_sys_download_done:
                android.R.drawable.stat_notify_error)
            .setContentTitle("体迹 · "+title)
            .setContentText(success?"点击打开 App 查看波形与声音片段":"点击打开 App 查看错误提示")
            .setProgress(0,0,false)
            .setAutoCancel(true)
            .setOngoing(false)
            .build();
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE))
            .notify(DONE_NOTIFICATION,note);
    }

    private void analyze(String id,int threshold,int minimum,int gap,boolean refreshSpeech){
        boolean success=false;
        try{
            PowerManager power=(PowerManager)getSystemService(POWER_SERVICE);
            decodeWakeLock=power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,
                "bodytrace:sleep-audio-analysis");
            // Foreground notification + a bounded CPU wake lock keep decoding
            // active while the phone is locked. The lock is always released.
            decodeWakeLock.acquire(3L*60*60*1000);
            publishProgress(id,0);
            JSONObject session=SleepSessions.load(this,id);
            // Cache is valid without the original file. Only a cache miss
            // requires reading the persisted external document or local audio.
            JSONArray levels=session.optJSONArray("levels_dbfs");
            JSONArray peaks=session.optJSONArray("peak_levels_dbfs");
            JSONArray shortLevels=session.optJSONArray("short_levels_dbfs");
            JSONArray aiScores=session.optJSONArray("ai_snore_scores");
            JSONArray speechScores=session.optJSONArray("ai_speech_scores");
            if(levels==null||peaks==null||peaks.length()!=levels.length()||
                    shortLevels==null||shortLevels.length()!=levels.length()||
                    aiScores==null||aiScores.length()!=levels.length()||
                    (refreshSpeech&&(speechScores==null||speechScores.length()!=levels.length()))||
                    !SleepYamnetClassifier.MODEL_NAME.equals(session.optString("ai_model"))){
                JSONObject envelope=SleepAudioAnalyzer.decodeEnvelope(
                    this,session,pct->publishProgress(id,pct));
                levels=envelope.getJSONArray("rms_dbfs");
                peaks=envelope.getJSONArray("peak_dbfs");
                shortLevels=envelope.getJSONArray("short_rms_dbfs");
                aiScores=envelope.getJSONArray("ai_snore_scores");
                speechScores=envelope.getJSONArray("ai_speech_scores");
                session.put("levels_dbfs",levels);
                session.put("peak_levels_dbfs",peaks);
                session.put("short_levels_dbfs",shortLevels);
                session.put("ai_snore_scores",aiScores);
                session.put("ai_speech_scores",speechScores);
                session.put("ai_model",SleepYamnetClassifier.MODEL_NAME);
                // The filename may have been corrected while this multi-hour
                // decode was running. Merge the LATEST small metadata before
                // persisting the new AI envelope, or we would overwrite the
                // corrected start time with the stale session snapshot.
                JSONObject latest=SleepSessions.loadMetadata(this,id);
                for(String key:new String[]{"started_ms","ended_ms","date_basis",
                        "filename_time_checked","media_date_checked",
                        "media_date_ms","media_date_role"}){
                    if(latest.has(key))session.put(key,latest.get(key));
                }
                long preciseDuration=latest.optLong("duration_ms",0);
                session.put("duration_ms",preciseDuration>0?
                    preciseDuration:(long)levels.length()*1000L);
                if(session.has("started_ms"))
                    session.put("ended_ms",session.optLong("started_ms")+
                        session.optLong("duration_ms"));
                // Cache even if the Activity has been closed or the device locked.
                SleepSessions.write(this,session);
            }
            // Remember the most recently completed local analysis, allowing
            // a restarted Activity to restore the chart without re-decoding.
            getSharedPreferences("bodytrace_sleep_analysis",MODE_PRIVATE).edit()
                .putString("last_id",id)
                .putInt("threshold",threshold)
                .putInt("minimum",minimum)
                .putInt("gap",gap)
                .commit();
            // Broadcast only a tiny completion token. Full-night JSON can
            // exceed Android's Binder transaction limit (1 MB). MainActivity
            // reads the cached envelope directly from its private file.
            send(new JSONObject().put("type","sleep_analysis_ready")
                .put("id",id).put("threshold",threshold)
                .put("minimum",minimum).put("gap",gap));
            success=true;
        }catch(Exception e){
            publishError("睡眠录音分析失败："+reason(e));
        }finally{
            if(decodeWakeLock!=null&&decodeWakeLock.isHeld()){
                try{decodeWakeLock.release();}catch(Exception ignored){}
            }
            activeId="";
            progressPercent=0;
            try{finishedNotification(success);}catch(Exception ignored){}
            stopSelf();
        }
    }

    private static String reason(Exception e){
        String message=e.getMessage();
        return message==null||message.isEmpty()?e.getClass().getSimpleName():message;
    }

    @Override public void onDestroy(){
        executor.shutdownNow();
        activeId="";
        super.onDestroy();
    }
}

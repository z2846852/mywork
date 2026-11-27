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
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * One AudioRecord feeds: 1) optional M4A encoding, 2) optional YAMNet feedback,
 * 3) always-on ephemeral microphone waveform telemetry.
 * Mic-only testing creates no session/files, and can be upgraded to recording
 * without releasing the microphone. No raw PCM is sent to the WebView.
 */
public final class SleepRecorderService extends Service {
    static final String ACTION_START = "com.z2846852.bodytrace.SLEEP_START";
    static final String ACTION_STOP = "com.z2846852.bodytrace.SLEEP_STOP";
    static final String ACTION_MONITOR_ON = "com.z2846852.bodytrace.SLEEP_MIC_MONITOR_ON";
    static final String ACTION_MONITOR_OFF = "com.z2846852.bodytrace.SLEEP_MIC_MONITOR_OFF";
    static final String ACTION_FEEDBACK_ON = "com.z2846852.bodytrace.SLEEP_FEEDBACK_ON";
    static final String ACTION_FEEDBACK_OFF = "com.z2846852.bodytrace.SLEEP_FEEDBACK_OFF";
    private static final String CHANNEL = "bodytrace_sleep_mic";
    private static final int NOTIFICATION_ID = 4215;
    private static final int SAMPLE_RATE = 16000;
    private static final long MAX_DURATION_MS = 12L*60*60*1000;
    private static volatile String currentId = "";
    private static volatile boolean microphoneActive;
    private static volatile boolean feedbackEnabled;
    private static volatile double lastFeedbackScore;
    private static volatile int feedbackCount;
    private static volatile long lastFeedbackMs;
    private static volatile long feedbackStartedMs;
    private volatile Thread autoCueThread;
    private void stopAutoCue(){Thread cue=autoCueThread;if(cue!=null)cue.interrupt();}
    private static volatile String inferenceState="idle",inferenceError="";
    private static volatile long inferredWindows,droppedWindows;
    private static volatile JSONObject latestMic;
    // Bounded in-process log survives WebView recreation and screen-off capture.
    private static final java.util.ArrayDeque<JSONObject> liveLog=new java.util.ArrayDeque<>();
    private static volatile long captureStartedMs;
    private static long recordingOriginElapsed;
    private static long recordingBaseSamples;
    private static volatile long capturedSamples;
    private static int recordingCueCount,recordingSoundCount,recordingVibrationCount;
    private static volatile String journalError="";
    /** Timestamp at actual action, not after playback. Separate from live monitor-only history. */
    private static synchronized void recordingEvent(android.content.Context context,String kind,
            double score,SnoreFeedbackController.Settings settings,long detectorSecond,int duration){
        String session=currentId;
        if(session.isEmpty())return;
        long elapsed=SystemClock.elapsedRealtime();
        try{
            JSONObject event=new JSONObject().put("kind",kind)
                .put("offset_ms",Math.max(0,elapsed-recordingOriginElapsed))
                .put("time_ms",System.currentTimeMillis());
            if(Double.isFinite(score))event.put("score",score);
            if(settings!=null)event.put("sound",settings.sound).put("volume",settings.volume)
                .put("vibration",settings.vibrate).put("sound_enabled",settings.soundEnabled)
                .put("parameters",settings.json()).put("threshold",settings.threshold)
                .put("minimum",settings.minimum).put("repeat",settings.repeat);
            if(duration>0)event.put("planned_duration_ms",duration);
            if(detectorSecond>=0){
                long offset=(detectorSecond*SAMPLE_RATE-recordingBaseSamples)*1000L/SAMPLE_RATE;
                if(offset>=0)event.put("detector_offset_ms",offset);
            }
            SleepSessions.appendFeedback(context,session,event);
            if("cue".equals(kind)){
                recordingCueCount++;
                if(settings!=null&&settings.vibrate)recordingVibrationCount++;
                if(settings!=null&&settings.soundEnabled)recordingSoundCount++;
            }
        }catch(Exception e){
            journalError="反馈日志保存失败："+e.getMessage();
            android.util.Log.e("SleepFeedback",journalError,e);
        }
    }
    static void recordPreview(android.content.Context context,SnoreFeedbackController.Settings settings,int duration){
        recordingEvent(context,"preview",Double.NaN,settings,-1,duration);
    }
    private static synchronized void clearLiveLog(){
        liveLog.clear();captureStartedMs=System.currentTimeMillis();
    }
    private static synchronized void addLiveLog(String kind,double score,String sound,
            int volume,boolean vibration,long second){
        try{
            JSONObject item=new JSONObject().put("kind",kind).put("time_ms",System.currentTimeMillis())
                .put("score",score).put("sound",sound).put("volume",volume)
                .put("vibration",vibration).put("second",second);
            if(liveLog.size()>=1000)liveLog.removeFirst();
            liveLog.addLast(item);
        }catch(Exception e){android.util.Log.w("SleepFeedback","live log",e);}
    }
    private static synchronized JSONArray recentLiveLog(){
        JSONArray items=new JSONArray();int skip=Math.max(0,liveLog.size()-3);
        for(JSONObject item:liveLog){if(skip>0)skip--;else items.put(item);}
        return items;
    }
    static synchronized JSONArray liveLogSnapshot(){
        JSONArray items=new JSONArray();
        for(JSONObject item:liveLog)items.put(item);
        return items;
    }
    static synchronized boolean markSnore(android.content.Context context){
        if(!microphoneActive||latestMic==null)return false;
        addLiveLog("manual",lastFeedbackScore,"",0,false,latestMic.optLong("second",-1));
        recordingEvent(context,"manual",inferredWindows>0?lastFeedbackScore:Double.NaN,null,-1,0);
        return true;
    }
    static synchronized JSONObject liveLogExport() throws Exception {
        return new JSONObject().put("capture_started_ms",captureStartedMs)
            .put("scope","current_or_last_capture_in_process")
            .put("max_events",1000).put("events",liveLogSnapshot());
    }
    private static final class LiveWindow {
        final long second; final short[] pcm; final boolean muted;
        LiveWindow(long second,short[] pcm,boolean muted){
            this.second=second;this.pcm=pcm;this.muted=muted;
        }
    }
    private final ArrayBlockingQueue<LiveWindow> inferenceQueue = new ArrayBlockingQueue<>(4);
    private volatile AudioRecord microphone;
    private volatile boolean running;
    private volatile boolean recordRequested;
    private volatile boolean started;
    private Thread captureThread;
    private Thread inferenceThread;
    private PowerManager.WakeLock wakeLock;
    private String id;
    private long startMs;
    private long startElapsed;
    private long recordedStartMs;

    static boolean isRecording() { return !currentId.isEmpty(); }
    static boolean isMicrophoneActive() { return microphoneActive; }
    static boolean isCurrentSession(String session) { return currentId.equals(session); }
    static String currentSessionId() { return currentId; }
    static boolean isFeedbackEnabled() { return feedbackEnabled; }

    static JSONObject feedbackStatus(android.content.Context c) throws Exception {
        return new JSONObject().put("type","sleep_feedback_status")
            .put("active",feedbackEnabled&&microphoneActive)
            .put("microphone_active",microphoneActive)
            .put("monitor_only",microphoneActive&&!isRecording())
            .put("recording",isRecording())
            .put("settings",SnoreFeedbackController.Settings.load(c).json()).put("experiment",FeedbackExperiment.summary(c)).put("clips",CueLibrary.list(c)).put("vibration_hardware",SnoreFeedbackController.vibrationHardware(c))
            .put("inference_state",inferenceState).put("inference_error",inferenceError)
            .put("inferred_windows",inferredWindows).put("dropped_windows",droppedWindows)
            .put("latest_mic",latestMic)
            .put("last_score",lastFeedbackScore)
            .put("cues",feedbackCount).put("last_cue_ms",lastFeedbackMs)
            .put("started_ms",feedbackStartedMs).put("capture_started_ms",captureStartedMs)
            .put("recent_events",recentLiveLog()).put("recording_id",currentId)
            .put("recording_cues",recordingCueCount).put("recording_sound_cues",recordingSoundCount)
            .put("recording_vibration_cues",recordingVibrationCount).put("journal_error",journalError);
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public synchronized int onStartCommand(Intent intent,int flags,int startId) {
        String action=intent==null?"":intent.getAction();
        if(ACTION_STOP.equals(action)){
            requestStop();
            return START_NOT_STICKY;
        }
        if(ACTION_MONITOR_OFF.equals(action)){
            // A recording owns the mic; never silently end the saved M4A here.
            if(isRecording()||recordRequested)sendError("正在录音，麦克风不能单独关闭；可关闭鼾声反馈");
            else requestStop();
            sendFeedbackStatus();
            return START_NOT_STICKY;
        }
        if(ACTION_FEEDBACK_OFF.equals(action)){
            if(feedbackEnabled)recordingEvent(this,"feedback_off",Double.NaN,null,-1,0);
            feedbackEnabled=false;stopAutoCue();
            sendFeedbackStatus();
            return START_NOT_STICKY;
        }
        if(ACTION_START.equals(action)){
            if(running){
                if(!isRecording())recordRequested=true; // upgrade mic-only capture in place
            }else startCapture(true);
            sendFeedbackStatus();
            return START_NOT_STICKY;
        }
        if(ACTION_MONITOR_ON.equals(action)){
            if(!running)startCapture(false);
            sendFeedbackStatus();
            return START_NOT_STICKY;
        }
        if(ACTION_FEEDBACK_ON.equals(action)){
            boolean changed=!feedbackEnabled;
            feedbackEnabled=true;
            feedbackStartedMs=System.currentTimeMillis();
            if(changed)recordingEvent(this,"feedback_on",Double.NaN,SnoreFeedbackController.Settings.load(this),-1,0);
            if(!running)startCapture(false);
            sendFeedbackStatus();
            return START_NOT_STICKY;
        }
        return START_NOT_STICKY;
    }

    private void startCapture(boolean saveAudio) {
        if(running||microphoneActive)return;
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
            feedbackEnabled=false;
            sendError("麦克风未授权");stopSelf();return;
        }
        try{
            createChannel();
            if(Build.VERSION.SDK_INT>=29)
                startForeground(NOTIFICATION_ID,notification(),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(NOTIFICATION_ID,notification());
            startElapsed=SystemClock.elapsedRealtime();
            recordRequested=saveAudio;
            PowerManager pm=(PowerManager)getSystemService(POWER_SERVICE);
            wakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,
                "bodytrace:sleep-microphone");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(MAX_DURATION_MS);
            running=true;
            microphoneActive=true;
            feedbackCount=0;lastFeedbackMs=0;lastFeedbackScore=0;clearLiveLog();
            inferredWindows=0;droppedWindows=0;latestMic=null;capturedSamples=0;
            inferenceState="loading";inferenceError="";
            if(feedbackEnabled)feedbackStartedMs=System.currentTimeMillis();
            inferenceQueue.clear();
            captureThread=new Thread(this::capture,"sleep-pcm-shared");
            captureThread.start();
            sendFeedbackStatus();
        }catch(Exception e){
            running=false;microphoneActive=false;feedbackEnabled=false;
            sendError("麦克风启动失败："+e.getClass().getSimpleName());
            releaseWakeLock();
            stopSelf();
        }
    }

    private AacWriter beginRecording() throws Exception {
        recordedStartMs=System.currentTimeMillis();
        startMs=recordedStartMs;
        id=startMs+"-"+UUID.randomUUID().toString().substring(0,8);
        JSONObject session=new JSONObject()
            .put("id",id).put("started_ms",startMs)
            .put("status","recording").put("codec","AAC-LC")
            .put("source","local-microphone").put("feedback_journal_version",1);
        SleepSessions.write(this,session);
        AacWriter writer=new AacWriter(SleepSessions.audio(this,id));
        synchronized(SleepRecorderService.class){
            recordingOriginElapsed=SystemClock.elapsedRealtime();recordingBaseSamples=capturedSamples;
            recordingCueCount=0;recordingSoundCount=0;recordingVibrationCount=0;journalError="";
            started=true;currentId=id;
            if(feedbackEnabled)recordingEvent(this,"feedback_on",Double.NaN,SnoreFeedbackController.Settings.load(this),-1,0);
        }
        recordRequested=false;
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE))
            .notify(NOTIFICATION_ID,notification());
        sendFeedbackStatus();
        return writer;
    }

    private void capture() {
        AudioRecord record=null;
        AacWriter writer=null;
        boolean valid=false;
        String problem="";
        try {
            int minimum=AudioRecord.getMinBufferSize(SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
            if(minimum<=0)throw new IllegalStateException("设备不支持16kHz麦克风");
            record=new AudioRecord(MediaRecorder.AudioSource.MIC,SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,
                Math.max(32768,minimum*2));
            if(record.getState()!=AudioRecord.STATE_INITIALIZED)
                throw new IllegalStateException("麦克风初始化失败");
            microphone=record;
            record.startRecording();
            if(record.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)
                throw new IllegalStateException("麦克风无法开始录制");
            inferenceThread=new Thread(this::inferLoop,"sleep-yamnet-live");
            inferenceThread.start();
            short[] pcm=new short[1600];
            final long[] second={0};
            SleepAudioAnalyzer.EnvelopeAccumulator envelope=new SleepAudioAnalyzer.EnvelopeAccumulator(
                SAMPLE_RATE,1,(rms,peak,shortRms)->sendMicrophoneSecond(second[0]++,rms,peak,shortRms));
            short[] window=new short[SAMPLE_RATE];
            int windowPos=0;
            long windowSecond=0;
            boolean windowMuted=false;
            while(running&&SystemClock.elapsedRealtime()-startElapsed<MAX_DURATION_MS){
                int count=record.read(pcm,0,pcm.length,AudioRecord.READ_BLOCKING);
                if(count<0){
                    if(!running)break;
                    throw new IllegalStateException("麦克风读取错误："+count);
                }
                if(count==0)continue;
                if(writer==null&&recordRequested)writer=beginRecording();
                if(writer!=null)writer.write(pcm,count);
                capturedSamples+=count;
                // Same statistics as offline analysis, with indexed whole-second model windows.
                boolean muted=SnoreFeedbackController.suppressMicrophone();
                for(int i=0;i<count;i++){
                    envelope.add(pcm[i]);
                    window[windowPos++]=pcm[i];
                    windowMuted|=muted;
                    if(windowPos==SAMPLE_RATE){
                        LiveWindow block=new LiveWindow(windowSecond++,window,windowMuted);
                        if(!inferenceQueue.offer(block)){
                            inferenceQueue.poll();droppedWindows++;inferenceQueue.offer(block);
                        }
                        window=new short[SAMPLE_RATE];windowPos=0;windowMuted=false;
                    }
                }
            }
            if(writer!=null){
                writer.finish();writer=null;valid=true;
            }
        }catch(Exception e){
            problem="麦克风采集失败："+e.getClass().getSimpleName()+" "+e.getMessage();
            sendError(problem);
        }finally{
            if(feedbackEnabled)recordingEvent(this,"feedback_off",Double.NaN,null,-1,0);
            running=false;microphoneActive=false;feedbackEnabled=false;
            inferenceState="idle";
            recordRequested=false;stopAutoCue();
            inferenceQueue.clear();
            if(record!=null){
                try{record.stop();}catch(Exception ignored){}
                try{record.release();}catch(Exception ignored){}
            }
            microphone=null;
            if(writer!=null)try{writer.close();}catch(Exception ignored){}
            if(inferenceThread!=null){
                try{inferenceThread.join(1000);}catch(InterruptedException ignored){
                    Thread.currentThread().interrupt();
                }
                inferenceThread=null;
            }
            finalizeSession(valid,problem);
            releaseWakeLock();
            sendFeedbackStatus();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    private void sendMicrophoneSecond(long second,double rms,double peak,double shortRms) {
        try {
            JSONObject event=new JSONObject().put("type","sleep_feedback_mic")
                .put("active",true).put("recording",isRecording())
                .put("second",second).put("rms_dbfs",rms)
                .put("peak_dbfs",peak).put("short_rms_dbfs",shortRms);
            latestMic=event;broadcast(event);
        }catch(Exception e){android.util.Log.w("SleepFeedback","mic telemetry",e);}
    }

    private void inferLoop() {
        int consecutive=0;
        long previousCue=0,lastSecond=-2;
        FeedbackExperiment experiment=new FeedbackExperiment(this);
        try(SleepYamnetClassifier classifier=new SleepYamnetClassifier(this,SAMPLE_RATE,1)){
            inferenceState="running";sendFeedbackStatus();
            while(running){
                LiveWindow block=inferenceQueue.poll(300,TimeUnit.MILLISECONDS);
                if(block==null)continue;
                if(block.second!=lastSecond+1)consecutive=0;
                lastSecond=block.second;
                int before=classifier.scoreCount();
                for(short sample:block.pcm)classifier.addSample(block.muted?0:sample);
                if(classifier.scoreCount()==before)continue;
                if(!running)break;
                double score=classifier.lastSnoreScore();
                lastFeedbackScore=score;inferredWindows++;
                SnoreFeedbackController.Settings settings=SnoreFeedbackController.Settings.load(this);
                consecutive=feedbackEnabled&&!block.muted&&score>=settings.threshold?
                    Math.min(consecutive+1,5):0;
                broadcast(new JSONObject().put("type","sleep_feedback_score")
                    .put("second",block.second).put("score",score)
                    .put("muted",block.muted).put("inferred_windows",inferredWindows)
                    .put("dropped_windows",droppedWindows));
                long now=SystemClock.elapsedRealtime();
                if(feedbackEnabled)experiment.observe(block.second,score,block.muted,now);else experiment.close();
                if(consecutive>=settings.minimum &&
                        (previousCue==0||now-previousCue>=settings.repeat*1000L)&&
                        !SnoreFeedbackController.isCuePlaying()&&
                        (autoCueThread==null||!autoCueThread.isAlive())){
                    SnoreFeedbackController.Settings selected=experiment.choose(settings,now,feedbackStartedMs);
                    if(selected==null)continue;
                    previousCue=now;consecutive=0;
                    if(experiment.begin(selected,now,currentId)){recordingEvent(this,"control",score,selected,block.second,0);experiment.executed(true);sendFeedbackStatus();continue;}
                    // Longer dream motifs never block the YAMNet inference thread.
                    Thread cue=new Thread(()->{
                        if(!running||!feedbackEnabled||Thread.currentThread().isInterrupted()){try{experiment.executed(false);}catch(Exception ignored){}return;}
                        boolean success=false;
                        try{
                            if(SnoreFeedbackController.playCue(this,selected,(samples,rate,duration,vibration)->
                                    {
                                        try{experiment.started();}catch(Exception e){sendError("实验开始日志失败："+e.getMessage());}
                                        recordingEvent(this,"cue",score,selected,block.second,duration);
                                        sendSpeakerWave(samples,rate,duration,vibration,"鼾声触发");
                                        sendFeedbackStatus();
                                    })){
                                success=true;
                                if(running){
                                    feedbackCount++;lastFeedbackMs=System.currentTimeMillis();
                                    addLiveLog("cue",score,selected.sound,selected.volume,selected.vibrate,block.second);
                                }
                            }
                        }catch(Exception e){if(running)sendError("自动提示音失败："+e.getMessage());}
                        finally{try{experiment.executed(success);}catch(Exception e){feedbackEnabled=false;sendError("实验日志失败："+e.getMessage());}}
                        if(running)sendFeedbackStatus();
                    },"sleep-auto-cue");
                    autoCueThread=cue;cue.start();
                }
            }
        }catch(Exception e){
            if(!running)return;
            inferenceError=e.getClass().getSimpleName()+" "+String.valueOf(e.getMessage());
            inferenceState="error";
            android.util.Log.e("SleepFeedback","Live inference failed",e);
            if(feedbackEnabled)recordingEvent(this,"feedback_off",Double.NaN,null,-1,0);
            feedbackEnabled=false;sendFeedbackStatus();
        }finally{try{experiment.close();}catch(Exception e){sendError("实验日志保存失败："+e.getMessage());}}
    }

    static JSONObject speakerWave(short[] samples,int rate,int duration,
                                  boolean vibration,String reason) throws Exception {
        JSONArray envelope=new JSONArray();
        int bins=72;
        for(int b=0;b<bins;b++){
            int start=b*samples.length/bins;
            int end=(b+1)*samples.length/bins;
            int peak=0;
            for(int i=start;i<end;i++)peak=Math.max(peak,Math.abs(samples[i]));
            envelope.put(Math.round(peak*1000.0/32768.0)/1000.0);
        }
        return new JSONObject().put("type","sleep_feedback_output")
            .put("wave",envelope).put("duration_ms",duration)
            .put("vibration",vibration).put("reason",reason)
            .put("sample_rate",rate);
    }

    private void sendSpeakerWave(short[] samples,int rate,int duration,boolean vibrate,
                                 String reason){
        try{broadcast(speakerWave(samples,rate,duration,vibrate,reason));}
        catch(Exception ignored){}
    }

    private void requestStop() {
        running=false;stopAutoCue();
        AudioRecord record=microphone;
        if(record!=null)try{record.stop();}catch(Exception ignored){}
    }

    private void releaseWakeLock(){
        if(wakeLock!=null){
            try{if(wakeLock.isHeld())wakeLock.release();}catch(Exception ignored){}
            wakeLock=null;
        }
    }

    private void finalizeSession(boolean valid,String problem){
        if(!started){currentId="";return;}
        started=false;
        synchronized(SleepRecorderService.class){currentId="";}
        boolean saved=false;
        long bytes=0,elapsed=0;
        String failure=problem==null?"":problem;
        try{
            JSONObject session;
            try{session=SleepSessions.load(this,id);}
            catch(Exception e){session=new JSONObject().put("id",id).put("started_ms",startMs);}
            long ended=System.currentTimeMillis();
            elapsed=Math.max(0,ended-startMs);
            File audio=SleepSessions.audio(this,id);
            bytes=audio.isFile()?audio.length():0;
            saved=valid&&bytes>1024;
            session.put("ended_ms",ended).put("duration_ms",elapsed)
                .put("audio_bytes",bytes).put("status",saved?"completed":"failed");
            if(!saved){
                if(failure.isEmpty())failure="录音未能正常完成，音频可能不完整";
                session.put("error",failure);
            }else session.remove("error");
            SleepSessions.write(this,session);
        }catch(Exception e){
            saved=false;
            failure="录音数据保存失败："+e.getClass().getSimpleName();
        }
        try{
            broadcast(new JSONObject().put("type","sleep_recording_finished")
                .put("id",id).put("saved",saved)
                .put("bytes",bytes).put("duration_ms",elapsed).put("message",failure));
        }catch(Exception ignored){}
    }

    private void broadcast(JSONObject event){
        sendBroadcast(new Intent(SleepAnalysisService.ACTION_EVENT)
            .setPackage(getPackageName())
            .putExtra(SleepAnalysisService.EXTRA_JSON,event.toString()));
    }
    private void sendFeedbackStatus(){
        try{broadcast(feedbackStatus(this));}catch(Exception ignored){}
    }
    private void sendError(String message){
        try{broadcast(new JSONObject().put("type","sleep_feedback_error")
            .put("message",message));}catch(Exception ignored){}
    }

    private void createChannel(){
        NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel channel=new NotificationChannel(CHANNEL,
            "睡眠录音和麦克风测试",NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("麦克风状态及可选鼾声提示，通知可停止");
        manager.createNotificationChannel(channel);
    }

    private Notification notification(){
        int immutable=PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent open=PendingIntent.getActivity(this,4215,
            new Intent(this,MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP),
            immutable);
        PendingIntent stop=PendingIntent.getService(this,4216,
            new Intent(this,SleepRecorderService.class).setAction(ACTION_STOP),immutable);
        PendingIntent quiet=PendingIntent.getService(this,4217,new Intent(this,SleepRecorderService.class).setAction(ACTION_FEEDBACK_OFF),immutable);
        return new Notification.Builder(this,CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("BodyTrace · 麦克风活动中")
            .setContentText("可录制、监听与鼾声提醒 · 点击停止")
            .setContentIntent(open).setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(android.R.drawable.ic_media_pause,"停止反馈",quiet)
            .addAction(android.R.drawable.ic_media_pause,"停止麦克风",stop)
            .build();
    }

    @Override public void onDestroy(){
        requestStop();
        super.onDestroy();
    }

    /** Raw PCM16 input -> AAC-LC encoder -> MP4 muxer, preserving the existing .m4a contract. */
    private static final class AacWriter implements AutoCloseable {
        private final MediaCodec encoder;
        private final MediaMuxer muxer;
        private final MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
        private int track=-1;
        private boolean started;
        private boolean finished;
        private boolean eosReached;
        private long samplesQueued;

        AacWriter(File destination) throws Exception {
            MediaFormat format=MediaFormat.createAudioFormat(
                MediaFormat.MIMETYPE_AUDIO_AAC,SAMPLE_RATE,1);
            format.setInteger(MediaFormat.KEY_AAC_PROFILE,
                MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            format.setInteger(MediaFormat.KEY_BIT_RATE,24000);
            format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE,8192);
            encoder=MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            try{
                encoder.configure(format,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);
                encoder.start();
                muxer=new MediaMuxer(destination.getAbsolutePath(),
                    MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            }catch(Exception error){
                try{encoder.release();}catch(Exception ignored){}
                throw error;
            }
        }

        void write(short[] pcm,int count) {
            int consumed=0;
            while(consumed<count){
                int slot=encoder.dequeueInputBuffer(10000);
                if(slot<0){drain(false);continue;}
                ByteBuffer buffer=encoder.getInputBuffer(slot);
                if(buffer==null)throw new IllegalStateException("AAC编码缓冲区无效");
                buffer.clear();
                buffer.order(ByteOrder.LITTLE_ENDIAN);
                int n=Math.min(count-consumed,buffer.remaining()/2);
                if(n<=0)throw new IllegalStateException("AAC输入缓冲区过小");
                for(int i=0;i<n;i++)buffer.putShort(pcm[consumed+i]);
                long pts=samplesQueued*1000000L/SAMPLE_RATE;
                encoder.queueInputBuffer(slot,0,n*2,pts,0);
                samplesQueued+=n;
                consumed+=n;
                drain(false);
            }
        }

        void finish() {
            if(finished)return;
            int tries=0;
            while(tries++<100){
                int slot=encoder.dequeueInputBuffer(10000);
                if(slot<0){drain(false);continue;}
                encoder.queueInputBuffer(slot,0,0,
                    samplesQueued*1000000L/SAMPLE_RATE,
                    MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                break;
            }
            if(tries>100)throw new IllegalStateException("AAC无法写入结束标记");
            for(int i=0;i<500&&!eosReached;i++)drain(true);
            if(!eosReached)throw new IllegalStateException("AAC编码完成超时");
            close();
        }

        private void drain(boolean wait){
            while(true){
                int index=encoder.dequeueOutputBuffer(info,wait?10000:0);
                if(index==MediaCodec.INFO_TRY_AGAIN_LATER)return;
                if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){
                    if(started)throw new IllegalStateException("重复的AAC输出格式");
                    track=muxer.addTrack(encoder.getOutputFormat());
                    muxer.start();
                    started=true;
                    continue;
                }
                if(index<0)return;
                ByteBuffer buffer=encoder.getOutputBuffer(index);
                if(buffer==null)throw new IllegalStateException("AAC输出缓冲区为空");
                if((info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)!=0)info.size=0;
                if(info.size>0){
                    if(!started)throw new IllegalStateException("AAC格式尚未就绪");
                    buffer.position(info.offset);
                    buffer.limit(info.offset+info.size);
                    muxer.writeSampleData(track,buffer,info);
                }
                boolean eos=(info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0;
                encoder.releaseOutputBuffer(index,false);
                if(eos){eosReached=true;return;}
            }
        }

        @Override public void close(){
            if(finished)return;
            finished=true;
            try{encoder.stop();}catch(Exception ignored){}
            try{encoder.release();}catch(Exception ignored){}
            if(started)try{muxer.stop();}catch(Exception ignored){}
            try{muxer.release();}catch(Exception ignored){}
        }
    }
}

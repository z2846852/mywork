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
import org.json.JSONObject;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * A single 16 kHz PCM microphone stream feeds two independent consumers:
 * AAC/M4A recording (lossless PCM handoff to MediaCodec) and optional YAMNet
 * inference. No second microphone session; toggling feedback never stops M4A.
 * User-initiated foreground service, not restarted at boot.
 */
public final class SleepRecorderService extends Service {
    static final String ACTION_START = "com.z2846852.bodytrace.SLEEP_START";
    static final String ACTION_STOP = "com.z2846852.bodytrace.SLEEP_STOP";
    static final String ACTION_FEEDBACK_ON = "com.z2846852.bodytrace.SLEEP_FEEDBACK_ON";
    static final String ACTION_FEEDBACK_OFF = "com.z2846852.bodytrace.SLEEP_FEEDBACK_OFF";
    private static final String CHANNEL = "bodytrace_sleep_mic";
    private static final int NOTIFICATION_ID = 4215;
    private static final int SAMPLE_RATE = 16000;
    private static final long MAX_DURATION_MS = 12L*60*60*1000;
    private static volatile String currentId = "";
    private static volatile boolean feedbackEnabled;
    private static volatile double lastFeedbackScore;
    private static volatile int feedbackCount;
    private static volatile long lastFeedbackMs;
    private static volatile long feedbackStartedMs;
    private static volatile long cueMutedUntilElapsed;
    private final ArrayBlockingQueue<short[]> inferenceQueue = new ArrayBlockingQueue<>(24);
    private volatile AudioRecord microphone;
    private volatile boolean running;
    private volatile boolean started;
    private Thread captureThread;
    private Thread inferenceThread;
    private PowerManager.WakeLock wakeLock;
    private String id;
    private long startMs;
    private long startElapsed;

    static boolean isRecording() { return !currentId.isEmpty(); }
    static boolean isCurrentSession(String session) { return currentId.equals(session); }
    static String currentSessionId() { return currentId; }
    static boolean isFeedbackEnabled() { return feedbackEnabled; }

    static JSONObject feedbackStatus(android.content.Context c) throws Exception {
        return new JSONObject().put("type","sleep_feedback_status")
            .put("active",feedbackEnabled&&isRecording())
            .put("recording",isRecording())
            .put("settings",SnoreFeedbackController.Settings.load(c).json())
            .put("last_score",lastFeedbackScore)
            .put("cues",feedbackCount).put("last_cue_ms",lastFeedbackMs)
            .put("started_ms",feedbackStartedMs);
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public synchronized int onStartCommand(Intent intent,int flags,int startId) {
        String action=intent==null?"":intent.getAction();
        if(ACTION_STOP.equals(action)){
            requestStop();
            return START_NOT_STICKY;
        }
        if(ACTION_FEEDBACK_OFF.equals(action)){
            feedbackEnabled=false;
            lastFeedbackScore=0;
            inferenceQueue.clear();
            sendFeedbackStatus();
            return START_NOT_STICKY;
        }
        if(ACTION_FEEDBACK_ON.equals(action)) {
            feedbackEnabled=true;
            if(!running&&!isRecording())startCapture();
            sendFeedbackStatus();
            return START_NOT_STICKY;
        }
        if(ACTION_START.equals(action)){
            if(!running&&!isRecording())startCapture();
            return START_NOT_STICKY;
        }
        return START_NOT_STICKY;
    }

    private void startCapture() {
        if(running||isRecording())return;
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
            startMs=System.currentTimeMillis();
            startElapsed=SystemClock.elapsedRealtime();
            id=startMs+"-"+UUID.randomUUID().toString().substring(0,8);
            File file=SleepSessions.audio(this,id);
            JSONObject session=new JSONObject()
                .put("id",id).put("started_ms",startMs)
                .put("status","recording").put("codec","AAC-LC")
                .put("source","local-microphone");
            SleepSessions.write(this,session);
            PowerManager pm=(PowerManager)getSystemService(POWER_SERVICE);
            wakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,
                "bodytrace:sleep-microphone");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(MAX_DURATION_MS);
            running=true;started=true;currentId=id;
            feedbackCount=0;lastFeedbackMs=0;lastFeedbackScore=0;
            feedbackStartedMs=feedbackEnabled?System.currentTimeMillis():0;
            inferenceQueue.clear();
            captureThread=new Thread(()->capture(file),"sleep-pcm-aac");
            captureThread.start();
        }catch(Exception e){
            running=false;feedbackEnabled=false;
            sendError("睡眠录音启动失败："+e.getClass().getSimpleName());
            finalizeSession(false,"录音启动失败："+e.getClass().getSimpleName());
            stopSelf();
        }
    }

    private void capture(File file) {
        AudioRecord record=null;
        AacWriter writer=null;
        boolean valid=false;
        String problem="";
        try {
            int minimum=AudioRecord.getMinBufferSize(SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
            if(minimum<=0)throw new IllegalStateException("设备不支持16kHz录音");
            record=new AudioRecord(MediaRecorder.AudioSource.MIC,SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,
                Math.max(32768,minimum*2));
            if(record.getState()!=AudioRecord.STATE_INITIALIZED)
                throw new IllegalStateException("麦克风初始化失败");
            microphone=record;
            writer=new AacWriter(file);
            record.startRecording();
            if(record.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)
                throw new IllegalStateException("麦克风无法录制");
            inferenceThread=new Thread(this::inferLoop,"sleep-yamnet-live");
            inferenceThread.start();
            short[] pcm=new short[1600];
            while(running&&SystemClock.elapsedRealtime()-startElapsed<MAX_DURATION_MS){
                int count=record.read(pcm,0,pcm.length,AudioRecord.READ_BLOCKING);
                if(count<0){
                    if(!running)break;
                    throw new IllegalStateException("录音读取错误："+count);
                }
                if(count==0)continue;
                writer.write(pcm,count);
                if(feedbackEnabled){
                    short[] copy=new short[count];
                    System.arraycopy(pcm,0,copy,0,count);
                    // Never sacrifice recording continuity to catch up on classification.
                    if(!inferenceQueue.offer(copy)){
                        inferenceQueue.poll();
                        inferenceQueue.offer(copy);
                    }
                }
            }
            writer.finish();
            writer=null;
            valid=true;
        }catch(Exception e){
            problem="录音中断："+e.getClass().getSimpleName()+" "+e.getMessage();
            sendError(problem);
        }finally{
            running=false;
            feedbackEnabled=false;
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
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    private void inferLoop() {
        int lastWindow=0,consecutive=0;
        long previousCue=0,lastReport=0;
        try(SleepYamnetClassifier classifier=new SleepYamnetClassifier(this,SAMPLE_RATE,1)){
            while(running||!inferenceQueue.isEmpty()){
                short[] block=inferenceQueue.poll(300,TimeUnit.MILLISECONDS);
                if(block==null)continue;
                if(!feedbackEnabled){
                    consecutive=0;
                    continue;
                }
                boolean muted=SystemClock.elapsedRealtime()<cueMutedUntilElapsed;
                for(short sample:block)classifier.addSample(muted?0:sample);
                int count=classifier.scoreCount();
                if(count==lastWindow)continue;
                lastWindow=count;
                double score=classifier.lastSnoreScore();
                lastFeedbackScore=score;
                SnoreFeedbackController.Settings settings=
                    SnoreFeedbackController.Settings.load(this);
                consecutive=!muted&&score>=settings.threshold?
                    Math.min(consecutive+1,5):0;
                long now=SystemClock.elapsedRealtime();
                if(consecutive>=settings.minimum &&
                        (previousCue==0 || now-previousCue>=settings.repeat*1000L)){
                    previousCue=now;
                    consecutive=0;
                    cueMutedUntilElapsed=now+1250L;
                    if(SnoreFeedbackController.playCue(this,settings)){
                        feedbackCount++;
                        lastFeedbackMs=System.currentTimeMillis();
                    }
                    sendFeedbackStatus();
                }else if(now-lastReport>=2000L){
                    lastReport=now;
                    sendFeedbackStatus();
                }
            }
        }catch(Exception e){
            sendError("实时识别暂停，录音仍在继续："+e.getClass().getSimpleName());
            feedbackEnabled=false;
        }
    }

    private synchronized void requestStop() {
        running=false;
        AudioRecord record=microphone;
        if(record!=null)try{record.stop();}catch(Exception ignored){}
    }

    private void finalizeSession(boolean valid,String problem){
        if(!started)return;
        started=false;
        feedbackEnabled=false;
        currentId="";
        if(wakeLock!=null){
            try{if(wakeLock.isHeld())wakeLock.release();}catch(Exception ignored){}
            wakeLock=null;
        }
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
            JSONObject event=new JSONObject().put("type","sleep_recording_finished")
                .put("id",id).put("saved",saved)
                .put("bytes",bytes).put("duration_ms",elapsed).put("message",failure);
            broadcast(event);
        }catch(Exception ignored){}
        sendFeedbackStatus();
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
        NotificationChannel channel=new NotificationChannel(CHANNEL,"睡眠录音和反馈",
            NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("锁屏录音和实时鼾声提醒；可从通知停止");
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
        return new Notification.Builder(this,CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("BodyTrace · 睡眠声音录制中")
            .setContentText("可同时使用实时鼾声反馈 · 点击停止")
            .setContentIntent(open).setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(android.R.drawable.ic_media_pause,"停止录音",stop)
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

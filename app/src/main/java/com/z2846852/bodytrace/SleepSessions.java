package com.z2846852.bodytrace;

import android.content.Context;
import android.net.Uri;
import android.media.MediaExtractor;
import android.media.MediaPlayer;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;

/**
 * Private, local-only sleep recordings. The GitHub training sync never touches these files.
 * Session JSON is written atomically. App recordings live in filesDir/sleep_audio;
 * external SAF documents stay in place and are referenced by persisted read grants.
 */
final class SleepSessions {
    private SleepSessions() {}

    static File sessionDir(Context context) {
        File dir = new File(context.getFilesDir(), "sleep_sessions");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("无法建立睡眠记录目录");
        return dir;
    }

    /** Small session metadata and large waveforms are intentionally separate. */
    static File envelopeDir(Context context) {
        File dir=new File(context.getFilesDir(),"sleep_envelopes");
        if(!dir.exists()&&!dir.mkdirs())
            throw new IllegalStateException("无法建立波形缓存目录");
        return dir;
    }

    static File envelopeFile(Context context,String id){
        verifyId(id);
        return new File(envelopeDir(context),id+".json");
    }

    /** Session-scoped append journal: never overwritten by offline analysis/cache updates. */
    static File feedbackFile(Context context,String id){
        verifyId(id);
        File dir=new File(context.getFilesDir(),"sleep_feedback");
        if(!dir.exists()&&!dir.mkdirs()&&!dir.isDirectory())
            throw new IllegalStateException("无法建立反馈日志目录");
        return new File(dir,id+".jsonl");
    }
    static synchronized void appendFeedback(Context context,String id,JSONObject event) throws Exception {
        File file=feedbackFile(context,id);
        if(file.length()>24_000_000L)throw new IllegalStateException("反馈日志达到24MB上限");
        // A newline before each record isolates a torn final line after process death.
        try(FileOutputStream out=new FileOutputStream(file,true)){
            out.write(("\n"+event.toString()+"\n").getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
    }
    static synchronized JSONArray readFeedback(Context context,String id) throws Exception {
        JSONArray events=new JSONArray();
        File file=feedbackFile(context,id);
        if(!file.isFile())return events;
        if(file.length()>25_000_000L)throw new IllegalStateException("反馈日志超出安全大小限制");
        try(java.io.BufferedReader in=new java.io.BufferedReader(new java.io.InputStreamReader(
                new FileInputStream(file),StandardCharsets.UTF_8))){
            String line;
            while((line=in.readLine())!=null){
                if(line.trim().isEmpty())continue;
                try{JSONObject event=new JSONObject(line);if(event.has("offset_ms"))events.put(event);}
                catch(org.json.JSONException ignored){/* preserve intact lines after interrupted write */}
            }
        }
        return events;
    }

    static File audioDir(Context context) {
        File dir = new File(context.getFilesDir(), "sleep_audio");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("无法建立录音目录");
        return dir;
    }

    static void verifyId(String id) {
        if (id == null || !id.matches("[0-9a-zA-Z_-]{6,80}"))
            throw new IllegalArgumentException("无效睡眠记录 ID");
    }

    static File audio(Context context, String id) {
        verifyId(id);
        String extension="m4a";
        try {
            File meta=json(context,id);
            if(meta.isFile()){
                JSONObject data=loadMetadata(context,id);
                String saved=data.optString("audio_extension","m4a");
                if(saved.matches("[a-z0-9]{2,5}"))extension=saved;
            }
        }catch(Exception ignored){} // New recordings do not have metadata yet.
        return new File(audioDir(context), id + "." + extension);
    }

    /** Distinguish reference-only imports from app-owned recordings and old copied imports. */
    static boolean isExternal(JSONObject session){
        return "saf-document".equals(session.optString("source")) &&
            session.optString("source_uri","").startsWith("content://");
    }

    static Uri externalUri(JSONObject session){
        if(!isExternal(session))throw new IllegalArgumentException("录音不是外部文件引用");
        return Uri.parse(session.optString("source_uri"));
    }

    static void configureExtractor(Context context,JSONObject session,MediaExtractor extractor)
            throws Exception {
        if(isExternal(session)){
            extractor.setDataSource(context,externalUri(session),null);
        }else{
            File source=audio(context,session.getString("id"));
            if(!source.isFile()||source.length()<1024)
                throw new IllegalStateException("本机音频文件不存在");
            extractor.setDataSource(source.getAbsolutePath());
        }
    }

    static void configurePlayer(Context context,JSONObject session,MediaPlayer player)
            throws Exception {
        if(isExternal(session)){
            player.setDataSource(context,externalUri(session));
        }else{
            File source=audio(context,session.getString("id"));
            if(!source.isFile())throw new IllegalStateException("本机音频文件不存在");
            player.setDataSource(source.getAbsolutePath());
        }
    }

    static String findExternalByUri(Context context,Uri uri) throws Exception {
        File[] files=sessionDir(context).listFiles((dir,name)->
            name.matches("[0-9a-zA-Z_-]{6,80}\\.json"));
        if(files==null)return "";
        for(File file:files){
            try{
                JSONObject session=loadMetadata(context,file.getName().replace(".json",""));
                if(isExternal(session)&&uri.toString().equals(session.optString("source_uri")))
                    return session.getString("id");
            }catch(Exception ignored){}
        }
        return "";
    }

    static File importedAudio(Context context,String id,String extension) {
        verifyId(id);
        if(!extension.matches("mp3|m4a|mp4|wav|ogg|opus|flac|3gp|aac|amr"))
            throw new IllegalArgumentException("不支持的录音文件格式");
        return new File(audioDir(context),id+"."+extension);
    }

    static File json(Context context, String id) {
        verifyId(id);
        return new File(sessionDir(context), id + ".json");
    }

    private static JSONObject readJson(File file,long sizeLimit) throws Exception {
        if(!file.isFile()||file.length()>sizeLimit)
            throw new IllegalArgumentException("睡眠数据不存在或损坏");
        try(FileInputStream in=new FileInputStream(file);
            java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];
            int n;
            while((n=in.read(buffer))!=-1){
                if(output.size()+n>sizeLimit)
                    throw new IllegalArgumentException("睡眠缓存超出安全大小限制");
                output.write(buffer,0,n);
            }
            return new JSONObject(new String(output.toByteArray(),StandardCharsets.UTF_8));
        }
    }

    static synchronized JSONObject loadMetadata(Context context,String id) throws Exception {
        verifyId(id);
        JSONObject doc=readJson(json(context,id),3_000_000);
        if(!id.equals(doc.optString("id")))
            throw new IllegalStateException("睡眠 ID 不一致");
        return doc;
    }

    static synchronized void saveSnoreMetrics(Context context,String id,String windows,JSONArray changes)throws Exception{
        JSONObject meta=loadMetadata(context,id);
        JSONObject metrics=snoreSummary(windows,readFeedback(context,id));
        meta.put("snore_windows_v1",windows).put("snore_settings_v1",changes).put("snore_metrics",metrics);
        write(context,meta);
    }
    private static JSONObject statsJson(SnoreMetrics.Stats s)throws Exception{
        return new JSONObject().put("valid_seconds",s.valid).put("snore_seconds",s.hit)
            .put("episodes",s.episodes).put("episodes_per_hour",s.valid==0?JSONObject.NULL:s.perHour())
            .put("armed_seconds",s.armed).put("silent_seconds",s.silent);
    }
    private static JSONObject snoreSummary(String windows,JSONArray events)throws Exception{
        JSONObject out=statsJson(SnoreMetrics.summarize(windows,0,windows.length()));
        JSONArray hourly=new JSONArray();
        for(int i=0;i<windows.length();i+=3600)hourly.put(statsJson(SnoreMetrics.summarize(windows,i,i+3600)).put("offset_seconds",i));
        ArrayList<JSONObject> cues=new ArrayList<>();
        for(int i=0;i<events.length();i++){
            JSONObject e=events.optJSONObject(i);
            if(e!=null&&("cue".equals(e.optString("kind"))||"preview".equals(e.optString("kind"))))cues.add(e);
        }
        cues.sort(Comparator.comparingLong(e->e.optLong("offset_ms")));
        int sound=0,vibration=0,mixed=0;JSONArray responses=new JSONArray();
        for(int i=0;i<cues.size();i++){
            JSONObject e=cues.get(i);
            if(!"cue".equals(e.optString("kind")))continue;
            JSONObject p=e.optJSONObject("parameters");
            boolean a=p!=null&&p.optInt("actualSoundMs")>0,b=p!=null&&p.optInt("actualVibrationMs")>0;
            if(a)sound++;if(b)vibration++;if(a&&b)mixed++;
            if(!a&&!b)continue;
            long offset=e.optLong("offset_ms");
            // Window offsets are quantized to 1s; wait an extra second beyond
            // playback plus tail to avoid counting the app's own sound.
            int start=(int)((offset+Math.max(p.optInt("actualSoundMs"),p.optInt("actualVibrationMs"))+3500+999)/1000);
            int end=windows.length();
            if(i+1<cues.size())end=Math.min(end,(int)(cues.get(i+1).optLong("offset_ms")/1000));
            SnoreMetrics.Response r=SnoreMetrics.response(windows,start,end);
            responses.put(new JSONObject().put("offset_ms",offset).put("observation_start_seconds",start)
                .put("sound",a).put("vibration",b).put("quiet_seconds",r.quiet)
                .put("censored",r.censored).put("observed",start<end&&SnoreMetrics.valid(SnoreMetrics.at(windows,start))));
        }
        return out.put("schema_version",1).put("window_seconds",windows.length())
            .put("sound_count",sound).put("vibration_count",vibration).put("mixed_count",mixed)
            .put("hourly",hourly).put("responses",responses);
    }
    // Cache derived summaries only, never rewrite a historical envelope. Keyed by
    // cache/journal revision so manual refresh sees completed analysis and new markers.
    private static final java.util.LinkedHashMap<String,OfflineEntry> offlineMetrics=new java.util.LinkedHashMap<>(64,.75f,true);
    private static final class OfflineEntry{
        final String revision;final JSONObject metrics;
        OfflineEntry(String revision,JSONObject metrics){this.revision=revision;this.metrics=metrics;}
    }
    private static String stamp(File f){return f.lastModified()+":"+f.length();}
    static synchronized JSONObject offlineSnoreMetrics(Context context,String id)throws Exception{
        return offlineSnoreMetrics(context,id,false,SnoreMetrics.OFFLINE_THRESHOLD);
    }
    // Comparison always uses decoded audio scores, never saved real-time windows.
    static synchronized JSONObject offlineSnoreMetrics(Context context,String id,boolean comparison,double threshold)throws Exception{
        JSONObject meta=loadMetadata(context,id);
        if(!comparison&&meta.has("snore_metrics"))return meta.optJSONObject("snore_metrics");
        if(SleepRecorderService.isCurrentSession(id))return null;
        File envelope=envelopeFile(context,id),journal=feedbackFile(context,id);
        String revision=stamp(envelope)+"/"+stamp(journal)+"/"+meta.optInt("feedback_journal_version",0);
        if(!envelope.isFile())revision+="/"+stamp(json(context,id));
        String cacheKey=id+"/"+comparison+"/"+threshold;
        OfflineEntry cached=offlineMetrics.get(cacheKey);
        if(cached!=null&&revision.equals(cached.revision))return cached.metrics;
        JSONObject doc=load(context,id);
        if(comparison&&!SleepYamnetClassifier.MODEL_NAME.equals(doc.optString("ai_model")))return null;
        JSONArray scores=doc.optJSONArray("ai_snore_scores"),levels=doc.optJSONArray("levels_dbfs");
        JSONObject result=null;
        if(scores!=null&&levels!=null&&scores.length()==levels.length()&&scores.length()>0){
            double[] values=new double[scores.length()];
            for(int i=0;i<values.length;i++)values[i]=scores.optDouble(i,Double.NaN);
            StringBuilder windows=new StringBuilder(SnoreMetrics.offlineWindows(values,threshold));
            JSONArray events=new JSONArray();
            boolean journalKnown=meta.optInt("feedback_journal_version",0)>0;
            if(journalKnown){try{events=readFeedback(context,id);}catch(Exception e){journalKnown=false;}}
            int sound=0,vibration=0,mixed=0;boolean channelsKnown=journalKnown;
            for(int i=0;i<events.length();i++){
                JSONObject e=events.optJSONObject(i);
                if(e==null)continue;
                String kind=e.optString("kind");
                if(!"cue".equals(kind)&&!"preview".equals(kind))continue;
                JSONObject p=e.optJSONObject("parameters");
                int duration=e.optInt("planned_duration_ms",0);
                if(p!=null)duration=Math.max(duration,Math.max(p.optInt("actualSoundMs"),p.optInt("actualVibrationMs")));
                SnoreMetrics.maskCue(windows,e.optLong("offset_ms",-1),duration>0?duration:5000);
                if(!"cue".equals(kind))continue;
                boolean a,b;
                if(p!=null&&(p.optInt("actualSoundMs")>0||p.optInt("actualVibrationMs")>0)){
                    a=p.optInt("actualSoundMs")>0;b=p.optInt("actualVibrationMs")>0;
                }else if(e.has("sound_enabled")&&e.has("vibration")){
                    a=e.optBoolean("sound_enabled");b=e.optBoolean("vibration");
                }else{channelsKnown=false;continue;}
                if(a)sound++;if(b)vibration++;if(a&&b)mixed++;
            }
            result=statsJson(SnoreMetrics.summarize(windows,0,windows.length()))
                .put("source","offline").put("threshold",threshold)
                .put("window_seconds",windows.length()).put("journal_known",journalKnown)
                .put("sound_count",channelsKnown?sound:JSONObject.NULL)
                .put("vibration_count",channelsKnown?vibration:JSONObject.NULL)
                .put("mixed_count",channelsKnown?mixed:JSONObject.NULL);
            result.remove("armed_seconds");result.remove("silent_seconds");
            JSONArray hourly=new JSONArray();
            for(int i=0;i<windows.length();i+=3600){
                JSONObject h=statsJson(SnoreMetrics.summarize(windows,i,i+3600)).put("offset_seconds",i);
                h.remove("armed_seconds");h.remove("silent_seconds");hourly.put(h);
            }
            result.put("hourly",hourly);
            // Offline model scores cannot reconstruct real-time intervention response.
        }
        offlineMetrics.put(cacheKey,new OfflineEntry(revision,result));
        while(offlineMetrics.size()>64)offlineMetrics.remove(offlineMetrics.keySet().iterator().next());
        return result;
    }
    static synchronized void rateSleep(Context context,String id,int quality)throws Exception{
        if(quality<0||quality>5)throw new IllegalArgumentException("评分必须为1–5或清空");
        if(SleepRecorderService.isCurrentSession(id))throw new IllegalStateException("请在录音结束后评分");
        JSONObject meta=loadMetadata(context,id);
        if(quality==0){meta.remove("sleep_quality");meta.remove("sleep_quality_at_ms");}
        else meta.put("sleep_quality",quality).put("sleep_quality_at_ms",System.currentTimeMillis());
        write(context,meta);
    }

    /** A structured local snapshot, intentionally excludes audio, PCM, waveforms,
     * personal voice clips, image files, filesystem paths and authorization data. */
    /** Scan every local session, not only the 50 rows shown in the UI. */
    static synchronized java.util.List<String> experimentSyncIds(Context context)throws Exception{
        File[] files=sessionDir(context).listFiles((dir,name)->name.matches("[0-9a-zA-Z_-]{6,80}\\.json"));
        if(files==null)throw new IllegalStateException("无法读取本地睡眠目录");
        java.util.Arrays.sort(files,java.util.Comparator.comparingLong(File::lastModified).reversed());
        java.util.List<String> ids=new java.util.ArrayList<>();
        for(File file:files){
            String id=file.getName().substring(0,file.getName().length()-5);
            if(SleepRecorderService.isCurrentSession(id)||(SleepAnalysisService.isRunning()&&id.equals(SleepAnalysisService.currentId())))continue;
            JSONObject meta=loadMetadata(context,id);
            String status=meta.optString("status");
            if(!"completed".equals(status)&&!"interrupted".equals(status)&&!"recording".equals(status))continue;
            if(meta.optLong("started_ms")<=0||meta.optLong("duration_ms")<=0)continue;
            ids.add(id);
        }
        return ids;
    }
    static synchronized JSONObject experimentSnapshot(Context context,String id)throws Exception{
        verifyId(id);
        if(SleepRecorderService.isCurrentSession(id)||(SleepAnalysisService.isRunning()&&id.equals(SleepAnalysisService.currentId())))
            throw new IllegalStateException("请先完成录音及分析");
        JSONObject meta=loadMetadata(context,id);
        long started=meta.getLong("started_ms"),duration=meta.getLong("duration_ms");
        if(started<=0||duration<=0)throw new IllegalStateException("录音时间不完整");
        String date=java.time.Instant.ofEpochMilli(started).atZone(java.time.ZoneId.of("Asia/Shanghai")).toLocalDate().toString();
        JSONObject data=new JSONObject().put("schema_version",1).put("session_id",id)
            .put("date",date).put("timezone","Asia/Shanghai").put("started_ms",started)
            .put("duration_ms",duration).put("date_basis",meta.optString("date_basis","recorded_at"))
            .put("feedback_journal_version",meta.optInt("feedback_journal_version",0));
        JSONObject original=offlineSnoreMetrics(context,id);
        data.put("snore_metrics",original==null?JSONObject.NULL:original);
        for(String key:new String[]{"snore_windows_v1","snore_settings_v1","sleep_quality","sleep_quality_at_ms","wearable_review_v1"})
            data.put(key,meta.has(key)?meta.get(key):JSONObject.NULL);
        double threshold=SnoreFeedbackController.Settings.load(context).threshold;
        JSONObject comparison=offlineSnoreMetrics(context,id,true,threshold);
        data.put("comparison_metrics",comparison==null?JSONObject.NULL:comparison);
        data.put("comparison_threshold",threshold);
        data.put("events",readFeedback(context,id));
        return data;
    }
    // Wearable screenshot transcription is a separate, user-supplied observation.
    // Never modify the original audio, candidate windows or stimulus policy.
    private static long wearableTime(JSONObject obj,String key)throws Exception{
        return java.time.OffsetDateTime.parse(obj.getString(key)).toInstant().toEpochMilli();
    }
    private static void wearableRange(JSONObject row,String key,int lo,int hi)throws Exception{
        if(!row.has(key)||row.isNull(key))return;
        double v=row.getDouble(key);
        if(!Double.isFinite(v)||v<lo||v>hi||v!=Math.rint(v))
            throw new IllegalArgumentException("手环字段超出范围："+key);
    }
    static synchronized void saveWearableReview(Context context,String id,String raw)throws Exception{
        verifyId(id);
        if(SleepRecorderService.isCurrentSession(id)||(SleepAnalysisService.isRunning()&&id.equals(SleepAnalysisService.currentId())))
            throw new IllegalStateException("请在录音及分析结束后保存手环数据");
        if(raw==null||raw.length()>64000)throw new IllegalArgumentException("手环 JSON 超出大小限制");
        JSONObject meta=loadMetadata(context,id);
        if(raw.trim().isEmpty()){meta.remove("wearable_review_v1");write(context,meta);return;}
        JSONObject data=new JSONObject(raw);
        if(data.optInt("schema_version")!=1)throw new IllegalArgumentException("手环数据版本必须为1");
        long start=wearableTime(data,"coverage_start"),end=wearableTime(data,"coverage_end");
        long recordingStart=meta.optLong("started_ms"),recordingEnd=recordingStart+meta.optLong("duration_ms");
        if(end<=start||end-start>86400000L||end<=recordingStart||start>=recordingEnd)
            throw new IllegalArgumentException("手环时间范围必须与所选录音重叠（含时区）");
        wearableRange(data,"uncertainty_seconds",0,600);
        if(!data.has("uncertainty_seconds")||data.isNull("uncertainty_seconds"))
            throw new IllegalArgumentException("请注明截图时间误差");
        wearableRange(data,"baseline_bpm",20,240);
        wearableRange(data,"sleep_score",0,100);
        wearableRange(data,"sleep_minutes",0,1440);
        for(String field:new String[]{"awake","heart_rate_peaks"}){
            JSONArray rows=data.getJSONArray(field);
            if(rows.length()>500)throw new IllegalArgumentException("手环标记过多");
            for(int i=0;i<rows.length();i++){
                JSONObject row=rows.getJSONObject(i);
                if("awake".equals(field)){
                    long from=wearableTime(row,"start"),to=wearableTime(row,"end");
                    if(from<start||to>end||to<from)throw new IllegalArgumentException("清醒区间超出手环范围");
                }else{
                    long when=wearableTime(row,"time");
                    if(when<start||when>end||!row.has("bpm")||row.isNull("bpm"))
                        throw new IllegalArgumentException("心率标记无效");
                    wearableRange(row,"bpm",20,240);
                }
            }
        }
        data.put("source","manual_screenshot").put("saved_at_ms",System.currentTimeMillis());
        meta.put("wearable_review_v1",data);write(context,meta);
    }

    /** Load 1s envelope only for a selected audio, not for the 50-item list. */
    static synchronized JSONObject load(Context context,String id) throws Exception {
        JSONObject doc=loadMetadata(context,id);
        if(doc.optBoolean("levels_cached",false)&&!doc.has("levels_dbfs")){
            File cached=envelopeFile(context,id);
            if(cached.isFile()){
                JSONObject envelope=readJson(cached,10_000_000);
                if(!id.equals(envelope.optString("id")))
                    throw new IllegalStateException("波形缓存 ID 不一致");
                doc.put("levels_dbfs",envelope.getJSONArray("levels_dbfs"));
                doc.put("peak_levels_dbfs",envelope.getJSONArray("peak_levels_dbfs"));
                JSONArray shortLevels=envelope.optJSONArray("short_levels_dbfs");
                if(shortLevels!=null&&
                        shortLevels.length()==doc.getJSONArray("levels_dbfs").length())
                    doc.put("short_levels_dbfs",shortLevels);
                JSONArray ai=envelope.optJSONArray("ai_snore_scores");
                if(ai!=null&&ai.length()==doc.getJSONArray("levels_dbfs").length()){
                    doc.put("ai_snore_scores",ai);
                    JSONArray speech=envelope.optJSONArray("ai_speech_scores");
                    if(speech!=null&&speech.length()==ai.length())
                        doc.put("ai_speech_scores",speech);
                    doc.put("ai_model",envelope.optString("ai_model",""));
                }
            }else{
                // Lost cache: original audio can still be decoded again.
                doc.remove("levels_cached");
            }
        }
        return doc;
    }

    private static void writeJson(File file,JSONObject data) throws Exception {
        AtomicFile atomic=new AtomicFile(file);
        FileOutputStream out=null;
        try{
            out=atomic.startWrite();
            out.write(data.toString().getBytes(StandardCharsets.UTF_8));
            atomic.finishWrite(out);
        }catch(Exception e){
            if(out!=null)atomic.failWrite(out);
            throw e;
        }
    }

    /** Atomic per-file persistence. Write envelope before its metadata flag. */
    static synchronized void write(Context context,JSONObject session) throws Exception {
        String id=session.getString("id");
        verifyId(id);
        JSONObject metadata=new JSONObject(session.toString());
        JSONArray levels=metadata.optJSONArray("levels_dbfs");
        JSONArray peaks=metadata.optJSONArray("peak_levels_dbfs");
        JSONArray shortLevels=metadata.optJSONArray("short_levels_dbfs");
        JSONArray aiScores=metadata.optJSONArray("ai_snore_scores");
        JSONArray speechScores=metadata.optJSONArray("ai_speech_scores");
        if(levels!=null&&peaks!=null&&levels.length()==peaks.length()){
            JSONObject envelope=new JSONObject()
                .put("id",id).put("schema_version",2)
                .put("levels_dbfs",levels).put("peak_levels_dbfs",peaks);
            if(shortLevels!=null&&shortLevels.length()==levels.length())
                envelope.put("short_levels_dbfs",shortLevels);
            if(aiScores!=null&&aiScores.length()==levels.length()){
                envelope.put("ai_snore_scores",aiScores);
                if(speechScores!=null&&speechScores.length()==levels.length())
                    envelope.put("ai_speech_scores",speechScores);
                envelope.put("ai_model",metadata.optString("ai_model",""));
            }
            writeJson(envelopeFile(context,id),envelope);
            metadata.remove("levels_dbfs");
            metadata.remove("peak_levels_dbfs");
            metadata.remove("short_levels_dbfs");
            metadata.remove("ai_snore_scores");
            metadata.remove("ai_speech_scores");
            metadata.remove("ai_model");
            metadata.put("levels_cached",true);
            metadata.put("envelope_seconds",levels.length());
        }
        writeJson(json(context,id),metadata);
    }

    static synchronized JSONArray list(Context context) throws Exception {
        return list(context,Double.NaN);
    }
    static synchronized JSONArray list(Context context,double comparisonThreshold) throws Exception {
        File[] files = sessionDir(context).listFiles((dir,name)->
            name.matches("[0-9a-zA-Z_-]{6,80}\\.json"));
        ArrayList<JSONObject> entries = new ArrayList<>();
        if (files != null) {
            for (File file : files) {
                if (file.length() > 3_000_000) continue;
                try {
                    String id=file.getName().replace(".json","");
                    JSONObject s=loadMetadata(context,id);
                    // Migrate old inline-array caches once, retaining the data.
                    if(s.has("levels_dbfs")&&s.has("peak_levels_dbfs")){
                        try{
                            write(context,s);
                            s=loadMetadata(context,id);
                        }catch(Exception ignored){/* legacy cache still readable */}
                    }
                    // Metadata-only migration during the regular list refresh,
                    // even while AI is still analyzing. No 300MB M4A needs reopening.
                    // Prior versions often stored the media END as started_ms.
                    if(isExternal(s)&&!"user_supplied".equals(s.optString("date_basis"))&&
                            !s.optBoolean("filename_time_checked",false)){
                        Long media=s.has("media_date_ms")&&!s.isNull("media_date_ms")?
                            s.optLong("media_date_ms"):null;
                        if(media==null&&"media_date_unverified".equals(s.optString("date_basis")))
                            media=s.optLong("started_ms",0);
                        SleepRecordingTime.Guess guess=SleepRecordingTime.infer(
                            s.optString("original_name",""),s.optLong("duration_ms",0),media,
                            System.currentTimeMillis());
                        if(guess!=null){
                            long duration=s.optLong("duration_ms",0);
                            s.put("started_ms",guess.startMillis);
                            s.put("ended_ms",guess.startMillis+duration);
                            s.put("date_basis",guess.basis);
                            s.put("media_date_role",guess.mediaLooksLikeEnd?"likely_end":"unverified");
                            s.put("filename_time_checked",true);
                            if(media!=null)s.put("media_date_ms",media);
                            write(context,s);
                        }
                    }
                    JSONObject summary = new JSONObject();
                    for (String key : new String[]{"id","started_ms","ended_ms","status","error",
                            "source","date_basis","original_name","duration_ms","snore_metrics","sleep_quality","sleep_quality_at_ms","wearable_review_v1"}) {
                        if (s.has(key)) summary.put(key, s.get(key));
                    }
                    boolean external=isExternal(s);
                    summary.put("external_file",external);
                    File audio = external?null:audio(context,s.getString("id"));
                    summary.put("bytes",external?s.optLong("original_bytes",0):
                        audio.isFile()?audio.length():0);
                    if ("recording".equals(summary.optString("status")) &&
                            !SleepRecorderService.isCurrentSession(s.optString("id"))) {
                        summary.put("status","interrupted");
                    }
                    summary.put("levels_cached",s.has("levels_dbfs")||
                        (s.optBoolean("levels_cached",false)&&
                        envelopeFile(context,s.getString("id")).isFile()));
                    entries.add(summary);
                } catch (Exception ignored) { /* a corrupt file must not erase other nights */ }
            }
        }
        entries.sort(Comparator.comparingLong((JSONObject s)->s.optLong("started_ms",0)).reversed());
        JSONArray result = new JSONArray();
        for (int i=0;i<Math.min(50,entries.size());i++){
            JSONObject entry=entries.get(i);
            if(!entry.has("snore_metrics")&&entry.optBoolean("levels_cached")&&!"recording".equals(entry.optString("status"))){
                try{
                    JSONObject derived=offlineSnoreMetrics(context,entry.getString("id"));
                    if(derived!=null)entry.put("snore_metrics",derived);
                }catch(Exception e){entry.put("snore_metrics_error",true);}
            }
            if(Double.isFinite(comparisonThreshold)&&entry.optBoolean("levels_cached")&&!"recording".equals(entry.optString("status"))){
                try{
                    JSONObject derived=offlineSnoreMetrics(context,entry.getString("id"),true,comparisonThreshold);
                    if(derived!=null)entry.put("comparison_metrics",derived);
                }catch(Exception e){entry.put("comparison_metrics_error",true);}
            }
            result.put(entry);
        }
        return result;
    }
}

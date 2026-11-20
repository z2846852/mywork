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
                JSONObject session=load(context,file.getName().replace(".json",""));
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
        if(levels!=null&&peaks!=null&&levels.length()==peaks.length()){
            JSONObject envelope=new JSONObject()
                .put("id",id).put("schema_version",1)
                .put("levels_dbfs",levels).put("peak_levels_dbfs",peaks);
            writeJson(envelopeFile(context,id),envelope);
            metadata.remove("levels_dbfs");
            metadata.remove("peak_levels_dbfs");
            metadata.put("levels_cached",true);
            metadata.put("envelope_seconds",levels.length());
        }
        writeJson(json(context,id),metadata);
    }

    static synchronized JSONArray list(Context context) throws Exception {
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
                    JSONObject summary = new JSONObject();
                    for (String key : new String[]{"id","started_ms","ended_ms","status","error",
                            "source","date_basis","original_name","duration_ms"}) {
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
        for (int i=0;i<Math.min(50,entries.size());i++) result.put(entries.get(i));
        return result;
    }
}

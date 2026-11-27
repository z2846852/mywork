package com.z2846852.bodytrace;
import android.content.Context;
import android.net.Uri;
import android.media.MediaMetadataRetriever;
import java.io.*;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
/** Private, bounded cue clips; no network or remote URI dependencies. */
final class CueLibrary {
    static boolean validId(String id){return id!=null&&id.matches("clip_[a-f0-9]{32}");}
    static File dir(Context c){File d=new File(c.getFilesDir(),"sleep-cues");d.mkdirs();return d;}
    static File file(Context c,String id){if(!validId(id))throw new IllegalArgumentException("录音标识无效");return new File(dir(c),id+".audio");}
    static String add(Context c,Uri uri)throws Exception{
        String id="clip_"+UUID.randomUUID().toString().replace("-","");
        File target=file(c,id);
        try{
            try(InputStream in=c.getContentResolver().openInputStream(uri);OutputStream out=new FileOutputStream(target)){
                if(in==null)throw new IOException("无法读取音频");
                byte[] b=new byte[8192];int n,total=0;while((n=in.read(b))!=-1){total+=n;if(total>4*1024*1024)throw new IOException("录音不超过4MB");out.write(b,0,n);}
            }
            validate(target);return id;
        }catch(Exception e){target.delete();throw e;}
    }
    static void validate(File target)throws Exception{
        MediaMetadataRetriever m=new MediaMetadataRetriever();
        try{m.setDataSource(target.getAbsolutePath());long ms=Long.parseLong(m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            if(ms<150||ms>5000||!"yes".equals(m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO)))throw new IOException("请选择0.15～5秒的音频");
        }finally{m.release();}
    }
    static JSONArray list(Context c)throws Exception{
        JSONArray a=new JSONArray();File[] files=dir(c).listFiles();if(files==null)return a;
        java.util.Arrays.sort(files,java.util.Comparator.comparingLong(File::lastModified));
        int i=0;for(File f:files){String n=f.getName();if(n.endsWith(".audio")&&validId(n.substring(0,n.length()-6)))a.put(new JSONObject().put("id",n.substring(0,n.length()-6)).put("name","自定义录音 "+(++i)));}return a;
    }
}
package com.z2846852.bodytrace;
import android.content.Context;
import android.os.VibrationEffect;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;
/** Local, bounded 50ms requested-amplitude recordings, independent of audio clips. */
final class VibrationLibrary {
    static final int STEP=50,MAX_SAMPLES=40;
    static boolean validId(String id){return id!=null&&id.matches("vib_[a-f0-9]{32}");}
    private static File dir(Context c){File d=new File(c.getFilesDir(),"sleep-vibration-cues");d.mkdirs();return d;}
    private static File file(Context c,String id){if(!validId(id))throw new IllegalArgumentException("无效振动素材");return new File(dir(c),id+".json");}
    static synchronized JSONObject save(Context c,String raw)throws Exception{
        if(raw==null||raw.length()>12000)throw new IllegalArgumentException("振动数据过长");
        JSONObject src=new JSONObject(raw);JSONArray samples=src.getJSONArray("samples");
        if(samples.length()<2||samples.length()>MAX_SAMPLES)throw new IllegalArgumentException("录制时长须为0.1–2秒");
        boolean nonzero=false;JSONArray clean=new JSONArray();
        for(int i=0;i<samples.length();i++){int v=samples.getInt(i);if(v<0||v>100)throw new IllegalArgumentException("振幅无效");nonzero|=v>0;clean.put(v);}
        if(!nonzero)throw new IllegalArgumentException("至少需要一段非零振动");
        File[] existing=dir(c).listFiles((d,n)->n.endsWith(".json"));if(existing!=null&&existing.length>=48)throw new IOException("最多保存48个振动素材");
        String name=src.optString("name","").trim();if(name.isEmpty())name="自定义振动 "+((existing==null?0:existing.length)+1);
        if(name.length()>40)name=name.substring(0,40);
        String id="vib_"+UUID.randomUUID().toString().replace("-","");
        JSONObject out=new JSONObject().put("id",id).put("name",name).put("duration_ms",clean.length()*STEP).put("samples",clean);
        File target=file(c,id),tmp=new File(target.getPath()+".tmp");
        try{try(FileOutputStream stream=new FileOutputStream(tmp)){stream.write(out.toString().getBytes(StandardCharsets.UTF_8));stream.getFD().sync();}
            if(!tmp.renameTo(target))throw new IOException("保存振动失败");
        }finally{tmp.delete();}
        return out;
    }
    static synchronized JSONObject load(Context c,String id)throws Exception{
        File f=file(c,id);if(!f.isFile()||f.length()>12000)throw new IOException("振动素材不存在或损坏");
        try(FileInputStream in=new FileInputStream(f)){byte[] data=new byte[(int)f.length()];new DataInputStream(in).readFully(data);return new JSONObject(new String(data,StandardCharsets.UTF_8));}
    }
    static synchronized JSONArray list(Context c){
        JSONArray out=new JSONArray();File[] files=dir(c).listFiles();if(files==null)return out;
        Arrays.sort(files,Comparator.comparingLong(File::lastModified));
        for(File f:files){String name=f.getName();if(name.endsWith(".json"))try{out.put(load(c,name.substring(0,name.length()-5)));}catch(Exception ignored){}}
        return out;
    }
    // Requested amplitude is a global scale, not an override of the drawn shape.
    // Rescale timing to the chosen duration (therefore honoring learned duration caps).
    static VibrationEffect effect(Context c,String id,int scale,int duration,boolean amplitude)throws Exception{
        JSONArray samples=load(c,id).getJSONArray("samples");int n=samples.length();
        if(n<2||n>MAX_SAMPLES||duration<100||duration>2000)throw new IllegalArgumentException("振动素材参数无效");
        if(amplitude){
            long[] times=new long[n];int[] amps=new int[n];
            for(int i=0;i<n;i++){times[i]=(long)(i+1)*duration/n-(long)i*duration/n;amps[i]=Math.max(0,Math.min(255,Math.round(samples.getInt(i)*scale*255/10000f)));}
            return VibrationEffect.createWaveform(times,amps,-1);
        }
        // Binary motor: alternating off/on slots, using duty cycle per segment.
        long[] times=new long[2*n+1];
        for(int i=0;i<n;i++){long ms=(long)(i+1)*duration/n-(long)i*duration/n;long on=Math.round(ms*samples.getInt(i)*scale/10000.0);times[2*i+1]=on;times[2*i+2]=ms-on;}
        return VibrationEffect.createWaveform(times,-1);
    }
}
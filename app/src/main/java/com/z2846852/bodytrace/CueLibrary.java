package com.z2846852.bodytrace;
import android.content.Context;
import android.net.Uri;
import android.media.*;
import java.io.*;
import java.nio.*;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
/** Private bounded clips with normalized, faded mono PCM sidecars. Original import retained. */
final class CueLibrary {
    static boolean validId(String id){return id!=null&&id.matches("clip_[a-f0-9]{32}");}
    static File dir(Context c){File d=new File(c.getFilesDir(),"sleep-cues");d.mkdirs();return d;}
    static File file(Context c,String id){if(!validId(id))throw new IllegalArgumentException("录音标识无效");return new File(dir(c),id+".audio");}
    static File pcmFile(Context c,String id){return new File(file(c,id).getPath()+".pcm");}
    static String add(Context c,Uri uri)throws Exception{
        try(InputStream in=c.getContentResolver().openInputStream(uri)){if(in==null)throw new IOException("无法读取音频");return addStream(c,in);}
    }
    static String addFile(Context c,File source)throws Exception{
        try(InputStream in=new FileInputStream(source)){return addStream(c,in);}
    }
    private static synchronized String addStream(Context c,InputStream in)throws Exception{
        String id="clip_"+UUID.randomUUID().toString().replace("-","");
        File target=file(c,id),tmp=new File(target.getPath()+".tmp");
        try{
            try(OutputStream out=new FileOutputStream(tmp)){
                byte[] b=new byte[8192];int n,total=0;while((n=in.read(b))!=-1){total+=n;if(total>4*1024*1024)throw new IOException("录音不超过4MB");out.write(b,0,n);}
            }
            validate(tmp);short[] data=decode(tmp);writePcm(c,id,data);
            if(!tmp.renameTo(target))throw new IOException("录音保存失败");
            return id;
        }catch(Exception e){tmp.delete();target.delete();pcmFile(c,id).delete();throw e;}
    }
    static void validate(File target)throws Exception{
        MediaMetadataRetriever m=new MediaMetadataRetriever();
        try{m.setDataSource(target.getAbsolutePath());long ms=Long.parseLong(m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            if(ms<150||ms>5200||!"yes".equals(m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO)))throw new IOException("请选择0.15～5秒的音频");
        }finally{m.release();}
    }
    private static short[] decode(File target)throws Exception{
        MediaExtractor ex=new MediaExtractor();MediaCodec codec=null;
        try{
            ex.setDataSource(target.getAbsolutePath());MediaFormat fmt=null;
            for(int i=0;i<ex.getTrackCount();i++){MediaFormat x=ex.getTrackFormat(i);String mime=x.getString(MediaFormat.KEY_MIME);if(mime!=null&&mime.startsWith("audio/")){fmt=x;ex.selectTrack(i);break;}}
            if(fmt==null)throw new IOException("音频轨道不存在");
            int rate=fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE),channels=fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            codec=MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME));codec.configure(fmt,null,null,0);codec.start();
            ByteArrayOutputStream raw=new ByteArrayOutputStream();MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
            boolean inputDone=false,outputDone=false;long deadline=android.os.SystemClock.elapsedRealtime()+8000;
            while(!outputDone&&android.os.SystemClock.elapsedRealtime()<deadline){
                if(Thread.currentThread().isInterrupted())throw new InterruptedException();
                if(!inputDone){int i=codec.dequeueInputBuffer(5000);if(i>=0){ByteBuffer b=codec.getInputBuffer(i);if(b==null)throw new IOException("音频输入缓冲缺失");b.clear();int n=ex.readSampleData(b,0);if(n<0){codec.queueInputBuffer(i,0,0,0,MediaCodec.BUFFER_FLAG_END_OF_STREAM);inputDone=true;}else{codec.queueInputBuffer(i,0,n,ex.getSampleTime(),0);ex.advance();}}}
                int o=codec.dequeueOutputBuffer(info,5000);
                if(o==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){MediaFormat out=codec.getOutputFormat();rate=out.getInteger(MediaFormat.KEY_SAMPLE_RATE);channels=out.getInteger(MediaFormat.KEY_CHANNEL_COUNT);if(out.containsKey(MediaFormat.KEY_PCM_ENCODING)&&out.getInteger(MediaFormat.KEY_PCM_ENCODING)!=AudioFormat.ENCODING_PCM_16BIT)throw new IOException("不支持该录音PCM格式");}
                else if(o>=0){ByteBuffer b=codec.getOutputBuffer(o);if(b!=null&&info.size>0&&(info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)==0){if(raw.size()+info.size>12*1024*1024)throw new IOException("解码音频过大");byte[] bytes=new byte[info.size];b.position(info.offset);b.limit(info.offset+info.size);b.get(bytes);raw.write(bytes);}outputDone=(info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0;codec.releaseOutputBuffer(o,false);}
            }
            if(!outputDone||channels<1||channels>8||rate<8000||rate>192000)throw new IOException("录音解码超时或格式无效");
            byte[] bytes=raw.toByteArray();int frames=bytes.length/(channels*2);if(frames<rate/10)throw new IOException("录音太短");
            int count=Math.min(CuePcm.MAX,Math.max(1,(int)((long)frames*CuePcm.RATE/rate)));short[] mono=new short[count];
            ByteBuffer pcm=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
            for(int i=0;i<count;i++){int frame=Math.min(frames-1,(int)((long)i*rate/CuePcm.RATE));int sum=0;for(int ch=0;ch<channels;ch++)sum+=pcm.getShort((frame*channels+ch)*2);mono[i]=(short)(sum/channels);}
            return CuePcm.normalize(mono);
        }finally{if(codec!=null){try{codec.stop();}catch(Exception ignored){}codec.release();}ex.release();}
    }
    private static void writePcm(Context c,String id,short[] data)throws Exception{
        File target=pcmFile(c,id),tmp=new File(target.getPath()+".tmp");try{
            try(DataOutputStream out=new DataOutputStream(new BufferedOutputStream(new FileOutputStream(tmp)))){for(short v:data)out.writeShort(v);}
            if(!tmp.renameTo(target))throw new IOException("PCM 保存失败");
        }finally{tmp.delete();}
    }
    static synchronized short[] loadPcm(Context c,String id)throws Exception{
        File target=pcmFile(c,id);
        if(!target.isFile()){short[] data=decode(file(c,id));writePcm(c,id,data);return data;}
        long length=target.length();if(length<2||length%2!=0||length>CuePcm.MAX*2L)throw new IOException("提示录音PCM损坏");
        short[] a=new short[(int)(length/2)];try(DataInputStream in=new DataInputStream(new BufferedInputStream(new FileInputStream(target)))){for(int i=0;i<a.length;i++)a[i]=in.readShort();}return a;
    }
    static JSONArray list(Context c)throws Exception{
        JSONArray a=new JSONArray();File[] files=dir(c).listFiles();if(files==null)return a;
        java.util.Arrays.sort(files,java.util.Comparator.comparingLong(File::lastModified));
        int i=0;for(File f:files){String n=f.getName();if(n.endsWith(".audio")&&validId(n.substring(0,n.length()-6))){String id=n.substring(0,n.length()-6);a.put(new JSONObject().put("id",id).put("name","自定义录音 "+(++i)).put("duration_ms",pcmFile(c,id).length()*1000/(2*CuePcm.RATE)));}}return a;
    }
}
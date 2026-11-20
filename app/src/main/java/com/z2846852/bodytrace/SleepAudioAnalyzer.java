package com.z2846852.bodytrace;

import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;

/** Offline AAC -> PCM analysis, aggregated into ~1-second RMS windows.
 * dBFS is DIGITAL relative level, not calibrated environmental dB SPL.
 */
final class SleepAudioAnalyzer {
    private SleepAudioAnalyzer(){}

    static JSONArray decodeLevels(File input) throws Exception {
        if(!input.isFile()||input.length()<1024)throw new IllegalArgumentException("录音文件不存在或为空");
        MediaExtractor extractor=new MediaExtractor();
        MediaCodec decoder=null;
        ArrayList<Double> levels=new ArrayList<>();
        try{
            extractor.setDataSource(input.getAbsolutePath());
            int track=-1; MediaFormat format=null;
            for(int i=0;i<extractor.getTrackCount();i++){
                MediaFormat f=extractor.getTrackFormat(i);
                if(f.getString(MediaFormat.KEY_MIME).startsWith("audio/")){track=i;format=f;break;}
            }
            if(track<0)throw new IllegalArgumentException("录音不含有效音轨");
            extractor.selectTrack(track);
            decoder=MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
            decoder.configure(format,null,null,0);
            decoder.start();
            int sampleRate=format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels=format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            long windowSamples=Math.max(1L,(long)sampleRate*channels);
            long count=0; double squares=0;
            boolean inputEnd=false,outputEnd=false;
            MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
            long lastProgress=System.currentTimeMillis();
            while(!outputEnd){
                if(!inputEnd){
                    int slot=decoder.dequeueInputBuffer(10000);
                    if(slot>=0){
                        ByteBuffer data=decoder.getInputBuffer(slot);
                        if(data==null)throw new IllegalStateException("解码输入缓冲无效");
                        data.clear();
                        int size=extractor.readSampleData(data,0);
                        if(size<0){
                            decoder.queueInputBuffer(slot,0,0,0,
                                MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputEnd=true;
                        }else{
                            long pts=extractor.getSampleTime();
                            decoder.queueInputBuffer(slot,0,size,pts,0);
                            extractor.advance();
                        }
                        lastProgress=System.currentTimeMillis();
                    }
                }
                int out=decoder.dequeueOutputBuffer(info,10000);
                if(out==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){
                    MediaFormat actual=decoder.getOutputFormat();
                    sampleRate=actual.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    channels=actual.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    if(actual.containsKey(MediaFormat.KEY_PCM_ENCODING)&&
                      actual.getInteger(MediaFormat.KEY_PCM_ENCODING)!=AudioFormat.ENCODING_PCM_16BIT)
                        throw new IllegalStateException("只支持16-bit PCM解码，请检查设备音频格式");
                    windowSamples=Math.max(1L,(long)sampleRate*channels);
                    lastProgress=System.currentTimeMillis();
                }else if(out>=0){
                    if(info.size>0){
                        ByteBuffer data=decoder.getOutputBuffer(out);
                        if(data==null)throw new IllegalStateException("解码输出缓冲无效");
                        data.order(ByteOrder.LITTLE_ENDIAN);
                        data.position(info.offset);
                        data.limit(info.offset+info.size);
                        while(data.remaining()>=2){
                            int value=data.getShort();
                            squares+=(double)value*value;
                            count++;
                            if(count>=windowSamples){
                                levels.add(dbfs(squares,count));
                                if(levels.size()>86400)throw new IllegalArgumentException("超过24小时录音分析限制");
                                squares=0;count=0;
                            }
                        }
                    }
                    outputEnd=(info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0;
                    decoder.releaseOutputBuffer(out,false);
                    lastProgress=System.currentTimeMillis();
                }
                if(System.currentTimeMillis()-lastProgress>30000)
                    throw new IllegalStateException("音频解码长时间无响应");
            }
            if(count>0)levels.add(dbfs(squares,count));
            if(levels.isEmpty())throw new IllegalStateException("解码结果为空");
            JSONArray result=new JSONArray();
            for(double db:levels)result.put(db);
            return result;
        }finally{
            if(decoder!=null){try{decoder.stop();}catch(Exception ignored){}decoder.release();}
            extractor.release();
        }
    }

    private static double dbfs(double squareSum,long count){
        double amplitude=Math.sqrt(squareSum/count)/32768.0;
        return Math.round(Math.max(-96.0,20.0*Math.log10(Math.max(0.00001585,amplitude)))*10.0)/10.0;
    }

    /** The required count is ABOVE-threshold seconds; optional gaps do not count. */
    static JSONArray detect(JSONArray levels,int threshold,int minimum,int maxGap) throws Exception {
        if(threshold<-90||threshold>-5||minimum<1||minimum>120||maxGap<0||maxGap>5)
            throw new IllegalArgumentException("筛选范围不合法");
        JSONArray results=new JSONArray();
        int start=-1,lastHigh=-1,highCount=0;
        double peak=-96;
        for(int t=0;t<=levels.length();t++){
            boolean loud=t<levels.length()&&levels.optDouble(t,-96)>=threshold;
            if(loud){
                if(start<0)start=t;
                lastHigh=t;highCount++;
                peak=Math.max(peak,levels.getDouble(t));
            } else if(start>=0&&(t==levels.length()||t-lastHigh>maxGap)){
                if(highCount>=minimum){
                    results.put(new JSONObject()
                        .put("start_sec",start)
                        .put("end_sec",lastHigh+1)
                        .put("active_sec",highCount)
                        .put("peak_dbfs",peak));
                }
                start=-1;lastHigh=-1;highCount=0;peak=-96;
            }
        }
        return results;
    }
}

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
import java.util.function.IntConsumer;

/**
 * Stream decode audio using Android MediaExtractor/MediaCodec.
 * Retain only ONE-SECOND RMS and peak envelope values (~29K pairs for 8h);
 * never load 8h PCM buffers into Java memory or a WebView.
 * dBFS is relative to digitized full-scale, NOT calibrated dB SPL.
 */
final class SleepAudioAnalyzer {
    private SleepAudioAnalyzer(){}

    static JSONArray decodeLevels(File input) throws Exception {
        return decodeEnvelope(input,null).getJSONArray("rms_dbfs");
    }

    static JSONObject decodeEnvelope(File input,IntConsumer progress) throws Exception {
        if(!input.isFile()||input.length()<1024)
            throw new IllegalArgumentException("录音文件不存在或为空");
        MediaExtractor extractor=new MediaExtractor();
        MediaCodec decoder=null;
        ArrayList<Double> levels=new ArrayList<>();
        ArrayList<Double> peaks=new ArrayList<>();
        try {
            extractor.setDataSource(input.getAbsolutePath());
            int track=-1;MediaFormat format=null;
            for(int i=0;i<extractor.getTrackCount();i++){
                MediaFormat candidate=extractor.getTrackFormat(i);
                String mime=candidate.getString(MediaFormat.KEY_MIME);
                if(mime!=null&&mime.startsWith("audio/")){track=i;format=candidate;break;}
            }
            if(track<0)throw new IllegalArgumentException("录音缺少有效音轨");
            extractor.selectTrack(track);
            decoder=MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
            decoder.configure(format,null,null,0);
            decoder.start();
            int sampleRate=format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels=format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            int encoding=AudioFormat.ENCODING_PCM_16BIT;
            long windowSamples=Math.max(1L,(long)sampleRate*channels);
            long count=0;double squares=0;int peak=0;
            boolean inputEnd=false,outputEnd=false;
            long durationUs=format.containsKey(MediaFormat.KEY_DURATION)?
                format.getLong(MediaFormat.KEY_DURATION):0;
            int reported=-1;
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
                            decoder.queueInputBuffer(slot,0,0,0,MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputEnd=true;
                        }else{
                            long pts=extractor.getSampleTime();
                            decoder.queueInputBuffer(slot,0,size,pts,0);
                            extractor.advance();
                            if(progress!=null&&durationUs>0){
                                int percent=(int)Math.min(95,Math.max(0,pts*95/durationUs));
                                if(percent/5>reported/5){
                                    reported=percent;progress.accept(percent);
                                }
                            }
                        }
                        lastProgress=System.currentTimeMillis();
                    }
                }
                int out=decoder.dequeueOutputBuffer(info,10000);
                if(out==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){
                    MediaFormat actual=decoder.getOutputFormat();
                    sampleRate=actual.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    channels=actual.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    encoding=actual.containsKey(MediaFormat.KEY_PCM_ENCODING)?
                        actual.getInteger(MediaFormat.KEY_PCM_ENCODING):AudioFormat.ENCODING_PCM_16BIT;
                    if(encoding!=AudioFormat.ENCODING_PCM_16BIT &&
                            encoding!=AudioFormat.ENCODING_PCM_FLOAT)
                        throw new IllegalStateException("设备解码器不支持的PCM采样格式");
                    windowSamples=Math.max(1L,(long)sampleRate*channels);
                    lastProgress=System.currentTimeMillis();
                }else if(out>=0){
                    if(info.size>0){
                        ByteBuffer data=decoder.getOutputBuffer(out);
                        if(data==null)throw new IllegalStateException("解码输出缓冲无效");
                        data.order(ByteOrder.LITTLE_ENDIAN);
                        data.position(info.offset);
                        data.limit(info.offset+info.size);
                        int bytes=encoding==AudioFormat.ENCODING_PCM_FLOAT?4:2;
                        while(data.remaining()>=bytes){
                            int value;
                            if(encoding==AudioFormat.ENCODING_PCM_FLOAT){
                                float sample=data.getFloat();
                                value=Float.isFinite(sample)?(int)Math.round(
                                    Math.min(1.0,Math.max(-1.0,sample))*32767):0;
                            }else value=data.getShort();
                            squares+=(double)value*value;
                            peak=Math.max(peak,Math.abs(value));
                            count++;
                            if(count>=windowSamples){
                                levels.add(dbfs(squares,count));
                                peaks.add(peakDbfs(peak));
                                if(levels.size()>86400)
                                    throw new IllegalArgumentException("超过24小时录音分析限制");
                                count=0;squares=0;peak=0;
                            }
                        }
                    }
                    outputEnd=(info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0;
                    decoder.releaseOutputBuffer(out,false);
                    lastProgress=System.currentTimeMillis();
                }
                if(System.currentTimeMillis()-lastProgress>30000)
                    throw new IllegalStateException("音频解码超过30秒无进展");
            }
            if(count>0){
                levels.add(dbfs(squares,count));peaks.add(peakDbfs(peak));
            }
            if(levels.isEmpty())throw new IllegalStateException("音频解码结果为空");
            JSONArray rms=new JSONArray(),pk=new JSONArray();
            for(int i=0;i<levels.size();i++){rms.put(levels.get(i));pk.put(peaks.get(i));}
            if(progress!=null)progress.accept(100);
            return new JSONObject().put("rms_dbfs",rms).put("peak_dbfs",pk)
                .put("duration_seconds",levels.size());
        }finally{
            if(decoder!=null){try{decoder.stop();}catch(Exception ignored){}decoder.release();}
            extractor.release();
        }
    }

    private static double dbfs(double squareSum,long count){
        double amplitude=Math.sqrt(squareSum/count)/32768.0;
        return Math.round(Math.max(-96.0,20.0*Math.log10(Math.max(0.00001585,amplitude)))*10.0)/10.0;
    }
    private static double peakDbfs(int peak) {
        return Math.round(Math.max(-96.0,20.0*Math.log10(
            Math.max(0.00001585,peak/32768.0)))*10.0)/10.0;
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
            }else if(start>=0&&(t==levels.length()||t-lastHigh>maxGap)){
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

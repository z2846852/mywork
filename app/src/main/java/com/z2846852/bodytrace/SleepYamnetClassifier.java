package com.z2846852.bodytrace;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import org.json.JSONArray;
import org.tensorflow.lite.DataType;
import org.tensorflow.lite.Interpreter;
import java.io.FileInputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.ArrayList;

/**
 * Offline AudioSet/YAMNet classification. NOT a medical snoring diagnosis.
 *
 * Model: google/yamnet/classification/tflite/1 (Apache 2.0)
 * 16 kHz mono float32 input (15600 samples), float32 [1,521] output.
 * Class 38=Snoring, 41=Snort. Outputs are UNCALIBRATED scores, not probabilities.
 *
 * The model is bundled in the APK; microphone/file samples never leave device.
 * Memory stays bounded for multi-hour audio (only 0.975 s PCM is retained).
 */
final class SleepYamnetClassifier implements AutoCloseable {
    static final String MODEL_NAME="yamnet-classification-v1";
    private static final int RATE=16000;
    private static final int WINDOW=15600;
    private static final int STRIDE=16000;
    private static final int SNORING=38, SNORT=41, CLASSES=521;

    private final Interpreter interpreter;
    private final float[] ring=new float[WINDOW];
    private final ByteBuffer input=ByteBuffer.allocateDirect(WINDOW*4)
            .order(ByteOrder.nativeOrder());
    private final float[][] output=new float[1][CLASSES];
    private final ArrayList<Double> scores=new ArrayList<>();
    private int sourceRate,channels,channelPos;
    private float channelSum,previous;
    private long sourceFrames,outputSamples;
    private double nextSourcePosition;
    private int writeHead;

    SleepYamnetClassifier(Context context,int sampleRate,int channelCount) throws Exception {
        try(AssetFileDescriptor asset=context.getAssets().openFd("yamnet.tflite");
            FileInputStream stream=new FileInputStream(asset.getFileDescriptor())) {
            MappedByteBuffer model=stream.getChannel().map(FileChannel.MapMode.READ_ONLY,
                asset.getStartOffset(),asset.getLength());
            Interpreter.Options options=new Interpreter.Options().setNumThreads(2);
            interpreter=new Interpreter(model,options);
        }
        int[] in=interpreter.getInputTensor(0).shape();
        int[] out=interpreter.getOutputTensor(0).shape();
        if(interpreter.getInputTensor(0).dataType()!=DataType.FLOAT32 ||
                interpreter.getOutputTensor(0).dataType()!=DataType.FLOAT32 ||
                !(in.length==2&&in[0]==1&&in[1]==WINDOW) ||
                !(out.length==2&&out[0]==1&&out[1]==CLASSES)) {
            interpreter.close();
            throw new IllegalStateException("YAMNet 模型张量规格不符合 [1,15600] → [1,521]");
        }
        setFormat(sampleRate,channelCount);
    }

    void setFormat(int rate,int channelCount) {
        if(rate<=0||channelCount<=0||channelCount>16)
            throw new IllegalArgumentException("不支持的音频格式");
        if(sourceFrames>0&&(sourceRate!=rate||channels!=channelCount))
            throw new IllegalStateException("解码过程中音频采样率或通道数发生变化");
        sourceRate=rate;channels=channelCount;
    }

    /** Decoded signed PCM16 values, interleaved by channel. */
    void addSample(int pcm) {
        channelSum+=Math.max(-32768,Math.min(32767,pcm))/32768f;
        if(++channelPos<channels)return;
        float mono=channelSum/channels;
        channelSum=0;channelPos=0;
        long frame=sourceFrames++;
        if(frame==0) {
            previous=mono;
            emit(mono);
            nextSourcePosition=(double)sourceRate/RATE;
            return;
        }
        while(nextSourcePosition<=frame){
            float fraction=(float)(nextSourcePosition-(frame-1));
            emit(previous+(mono-previous)*fraction);
            nextSourcePosition+=(double)sourceRate/RATE;
        }
        previous=mono;
    }

    private void emit(float value) {
        ring[writeHead]=value;
        writeHead=(writeHead+1)%WINDOW;
        ++outputSamples;
        if(outputSamples>=WINDOW&&(outputSamples-WINDOW)%STRIDE==0){
            input.clear();
            for(int i=0;i<WINDOW;i++)
                input.putFloat(ring[(writeHead+i)%WINDOW]);
            input.rewind();
            interpreter.run(input,output);
            float snore=output[0][SNORING],snort=output[0][SNORT];
            float score=Math.max(Float.isFinite(snore)?snore:0,
                    Float.isFinite(snort)?snort:0);
            scores.add(Math.round(Math.max(0,Math.min(1,score))*1000)/1000.0);
        }
    }

    JSONArray result(int seconds) throws org.json.JSONException {
        JSONArray result=new JSONArray();
        for(int i=0;i<seconds;i++)
            result.put(i<scores.size()?scores.get(i):0.0);
        return result;
    }

    @Override public void close() { interpreter.close(); }
}

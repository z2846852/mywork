package com.z2846852.bodytrace;
import java.util.Arrays;
/** Bounded speech/tone processing; no device volume changes. */
final class CuePcm {
    static final int RATE=22050, MAX=RATE*5;
    private CuePcm(){}
    static short[] normalize(short[] input){
        if(input.length==0)throw new IllegalArgumentException("empty cue");
        int peak=0;double squares=0;
        for(short v:input){peak=Math.max(peak,Math.abs((int)v));squares+=(double)v*v;}
        if(peak<16)throw new IllegalArgumentException("录音过于安静");
        double rms=Math.sqrt(squares/input.length);
        double gain=Math.min(8,Math.min(6553.0/peak,1800.0/Math.max(1,rms)));
        short[] out=new short[input.length];for(int i=0;i<out.length;i++)out[i]=(short)Math.round(input[i]*gain);
        fade(out,Math.min(RATE/40,out.length/2));return out;
    }
    static void fade(short[] a,int n){for(int i=0;i<n;i++){double k=(i+1.0)/(n+1);a[i]=(short)(a[i]*k);a[a.length-1-i]=(short)(a[a.length-1-i]*k);}}
    static short[] render(short[] source,int ms,String rhythm,boolean spoken,int volume){
        if(source.length==0)throw new IllegalArgumentException("empty cue");
        int max=ms==0?MAX:Math.max(1,Math.min(MAX,ms*RATE/1000));
        int n=Math.min(source.length,max);
        if(spoken&&n<source.length)throw new IllegalArgumentException("时长上限短于完整录音");
        boolean single="single".equals(rhythm);
        if(single){
            int length=spoken||ms==0?n:max;
            short[] a=new short[length];
            for(int i=0;i<length;i++)a[i]=(short)(source[i%n]*volume/100.0);
            fade(a,Math.min(RATE/40,length/2));return a;
        }
        int gap=RATE/12;
        int part=Math.min(n,(max-2*gap)/3);
        if(part<1||spoken&&part<source.length)throw new IllegalArgumentException("三连需要更短录音或更长时限");
        int third=part,first="shortlong".equals(rhythm)&&!spoken?Math.max(1,part/2):part;
        short[] a=new short[first*2+third+2*gap];int offset=0;
        for(int p=0;p<3;p++){
            int size=p<2?first:third;
            double gain=("rising".equals(rhythm)?(p+1)/3.0:"falling".equals(rhythm)?(3-p)/3.0:1)*volume/100.0;
            int fade=Math.min(RATE/40,size/2);
            for(int i=0;i<size;i++){
                double env=fade==0?1:Math.min(1,Math.min((i+1.0)/fade,(size-i)/(double)fade));
                a[offset+i]=(short)(source[i]*gain*env);
            }
            offset+=size+gap;
        }return a;
    }
}
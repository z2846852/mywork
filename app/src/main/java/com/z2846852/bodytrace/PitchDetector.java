package com.z2846852.bodytrace;

/**
 * Pure-Java YIN pitch tracker (independent implementation).
 *
 * Analyses a single signed-16-bit PCM window. For short real-time vocal
 * samples, YIN's cumulative-mean normalized difference estimates f0 without
 * needing FFT peak selection. Silence and non-periodic audio return 0 Hz.
 * Do not treat a stable f0 as evidence of correct singing without a target.
 */
final class PitchDetector {
    private static final int MIN_HZ=65;
    private static final int MAX_HZ=1100;
    private static final double YIN_THRESHOLD=0.15;

    static final class Result {
        final double hz,rmsDb,clarity;
        Result(double hz,double rmsDb,double clarity){
            this.hz=hz;this.rmsDb=rmsDb;this.clarity=clarity;
        }
        double midi(){return hz>0?69+12*Math.log(hz/440.0)/Math.log(2):0;}
        int nearestMidi(){return (int)Math.round(midi());}
        double cents(){return hz>0?(midi()-nearestMidi())*100:0;}
        String note(){
            if(hz<=0)return "—";
            final String[] notes={"C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"};
            int midi=nearestMidi();
            int index=((midi%12)+12)%12;
            return notes[index]+(midi/12-1);
        }
    }

    static Result analyze(short[] samples,int rate){
        if(samples==null||samples.length<512||rate<8000)
            return new Result(0,-120,0);
        final int size=samples.length;
        double energy=0;
        for(short sample:samples){
            double v=sample/32768.0;
            energy+=v*v;
        }
        double rms=Math.sqrt(energy/size);
        double db=20*Math.log10(Math.max(rms,1e-8));
        if(db < -48)return new Result(0,db,0);

        int lowTau=Math.max(2,rate/MAX_HZ);
        int highTau=Math.min(rate/MIN_HZ,size/2-1);
        if(highTau<=lowTau)return new Result(0,db,0);
        int compareLength=size-highTau;
        // Normalize to avoid precision surprises with large short differences.
        double[] d=new double[highTau+2];
        double sum=0;
        for(int tau=1;tau<=highTau;tau++){
            double difference=0;
            for(int i=0;i<compareLength;i++){
                double x=(samples[i]-samples[i+tau])/32768.0;
                difference+=x*x;
            }
            sum+=difference;
            d[tau]=sum>0?difference*tau/sum:1;
        }
        int chosen=-1;
        for(int tau=lowTau;tau<=highTau;tau++){
            if(d[tau]<YIN_THRESHOLD){
                while(tau+1<=highTau&&d[tau+1]<d[tau])tau++;
                chosen=tau;
                break;
            }
        }
        if(chosen<0){
            double best=0.26;
            for(int tau=lowTau;tau<=highTau;tau++){
                if(d[tau]<best){best=d[tau];chosen=tau;}
            }
        }
        if(chosen<1)return new Result(0,db,0);
        double lag=chosen;
        if(chosen>1&&chosen<highTau){
            double a=d[chosen-1],b=d[chosen],c=d[chosen+1];
            double denominator=a-2*b+c;
            if(Math.abs(denominator)>1e-10){
                lag+=Math.max(-0.5,Math.min(0.5,(a-c)/(2*denominator)));
            }
        }
        double freq=rate/lag;
        double clarity=Math.max(0,Math.min(1,1-d[chosen]));
        if(freq<MIN_HZ||freq>MAX_HZ||clarity<0.70)
            return new Result(0,db,clarity);
        return new Result(freq,db,clarity);
    }
}

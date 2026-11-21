package com.z2846852.bodytrace;

/**
 * Experimental two-band spectral vowel probe, NOT a trained phoneme model.
 * It attempts to find broad resonances resembling F1/F2 (in Hz), then
 * compares them with rough vowel reference positions. Unvoiced consonants,
 * nasals, tone, accents, age, microphone EQ and pitch can invalidate them.
 *
 * Deliberately returns "unknown" under weak broadband evidence. No calibrated
 * pronunciation score or speech-to-IPA inference is implied.
 */
final class VowelSpectrum {
    static final class Result {
        final int f1,f2;
        final String english,mandarin;
        final double fit;
        Result(int f1,int f2,String english,String mandarin,double fit){
            this.f1=f1;this.f2=f2;this.english=english;
            this.mandarin=mandarin;this.fit=fit;
        }
    }
    private static final int N=2048;
    // F1/F2 values only illustrate a generic adult speaker, not user norms.
    private static final Object[][] EN={
        {"/i/",300,2400},{"/ɪ/",430,1980},{"/e/",470,2050},
        {"/ɛ/",620,1800},{"/æ/",800,1700},{"/ɑ/",790,1200},
        {"/ɔ/",650,1000},{"/u/",340,1100},{"/ʊ/",470,1250},
        {"/ə/",520,1500}
    };
    private static final Object[][] ZH={
        {"i",320,2350},{"ü",340,1870},{"a",820,1380},
        {"o",560,1040},{"e",500,1580},{"u",350,1030}
    };
    private VowelSpectrum(){}

    static Result analyze(short[] samples,int rate){
        if(samples==null||samples.length<N||rate<12000)
            return unknown();
        double[] real=new double[N],imag=new double[N];
        int start=(samples.length-N)/2;
        double rms=0;
        for(int i=0;i<N;i++){
            double raw=samples[start+i]/32768.0;
            rms+=raw*raw;
            double previous=i==0?0:samples[start+i-1]/32768.0;
            double emphasized=raw-0.95*previous;
            real[i]=emphasized*(0.5-0.5*Math.cos(2*Math.PI*i/(N-1)));
        }
        if(20*Math.log10(Math.sqrt(rms/N)+1e-9)<-37)return unknown();
        fft(real,imag);
        double[] power=new double[N/2];
        for(int k=1;k<power.length;k++){
            power[k]=Math.hypot(real[k],imag[k]);
        }
        // Average over ~110 Hz to suppress individual voice harmonics.
        int radius=Math.max(4,(int)Math.round(55.0*N/rate));
        double[] smooth=new double[power.length];
        for(int k=0;k<smooth.length;k++){
            double value=0;int count=0;
            for(int i=Math.max(1,k-radius);i<=Math.min(power.length-1,k+radius);i++){
                value+=power[i];count++;
            }
            smooth[k]=value/Math.max(1,count);
        }
        int f1=peak(smooth,rate,250,1030);
        int f2=peak(smooth,rate,1050,3200);
        if(f1==0||f2==0||f2<=f1+300)return unknown();
        double peak1=powerAt(smooth,rate,f1),peak2=powerAt(smooth,rate,f2);
        if(peak1<1e-6||peak2<1e-6)return unknown();
        Object[] en=nearest(EN,f1,f2);
        Object[] zh=nearest(ZH,f1,f2);
        double d=distance(en,f1,f2);
        return new Result(f1,f2,(String)en[0],(String)zh[0],
            Math.max(0,Math.min(1,1-d/2.0)));
    }
    private static Result unknown(){return new Result(0,0,"无法判断","无法判断",0);}
    private static double distance(Object[] ref,int f1,int f2){
        double a=(f1-(int)ref[1])/400.0;
        double b=(f2-(int)ref[2])/650.0;
        return Math.hypot(a,b);
    }
    private static Object[] nearest(Object[][] pool,int f1,int f2){
        Object[] best=pool[0];
        for(Object[] ref:pool)if(distance(ref,f1,f2)<distance(best,f1,f2))
            best=ref;
        return best;
    }
    private static double powerAt(double[] spectrum,int rate,int hz){
        int i=(int)Math.round((double)hz*N/rate);
        return i>=0&&i<spectrum.length?spectrum[i]:0;
    }
    private static int peak(double[] spectrum,int rate,int min,int max){
        int low=Math.max(1,min*N/rate),high=Math.min(spectrum.length-1,max*N/rate);
        int k=low;
        for(int i=low+1;i<=high;i++)if(spectrum[i]>spectrum[k])k=i;
        return (int)Math.round(k*(double)rate/N);
    }
    private static void fft(double[] real,double[] imag){
        int n=real.length,j=0;
        for(int i=1;i<n;i++){
            int bit=n>>>1;
            while((j&bit)!=0){j^=bit;bit>>=1;}
            j^=bit;
            if(i<j){
                double t=real[i];real[i]=real[j];real[j]=t;
                t=imag[i];imag[i]=imag[j];imag[j]=t;
            }
        }
        for(int len=2;len<=n;len<<=1){
            double angle=-2*Math.PI/len;
            double wrBase=Math.cos(angle),wiBase=Math.sin(angle);
            for(int off=0;off<n;off+=len){
                double wr=1,wi=0;
                for(int k=0;k<len/2;k++){
                    int a=off+k,b=a+len/2;
                    double tr=wr*real[b]-wi*imag[b];
                    double ti=wr*imag[b]+wi*real[b];
                    real[b]=real[a]-tr;imag[b]=imag[a]-ti;
                    real[a]+=tr;imag[a]+=ti;
                    double nwr=wr*wrBase-wi*wiBase;
                    wi=wr*wiBase+wi*wrBase;wr=nwr;
                }
            }
        }
    }
}

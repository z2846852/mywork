package com.z2846852.bodytrace;

/**
 * Experimental on-device phonetic cues from raw microphone PCM.
 *
 * Unlike speech-to-text, this uses no lexicon, transcript or grammar.
 * Two independent elementary acoustic estimators are tried:
 *   1. voiced vowels: rough F1/F2 envelope + nearest IPA prototype;
 *   2. unvoiced fricative family: high-frequency noise centroid / ZCR.
 *
 * These cues are NOT a trained phone recognizer, not complete IPA, and cannot
 * reliably identify connected speech, Chinese tones or pronunciation quality.
 *
 * Reference designs (not copied): voicesu (real-time F1/F2 + per-speaker
 * calibration), Allosaurus (trained multilingual phone recognizer; future
 * distinct backend). See README for links and limitations.
 */
final class PhonemeProbe {
    static final class Result {
        final String ipa,englishWords,pinyinExamples,method,warning;
        final int f1,f2;
        final double fit;
        Result(String ipa,String englishWords,String pinyinExamples,String method,
                String warning,int f1,int f2,double fit){
            this.ipa=ipa;this.englishWords=englishWords;
            this.pinyinExamples=pinyinExamples;
            this.method=method;this.warning=warning;this.f1=f1;
            this.f2=f2;this.fit=fit;
        }
    }
    private static final Result NONE=new Result(
        "—","—","—","undetermined",
        "没有可靠的元音或强擦音线索；并不代表没有发音。",0,0,0);
    private PhonemeProbe(){}

    static Result analyze(short[] samples,int rate,PitchDetector.Result pitch){
        if(samples==null||samples.length<2048||rate<12000||
            pitch==null||pitch.rmsDb<-39)return NONE;
        // Strong voiced periodic frames -> roughly estimate vowel position.
        if(pitch.hz>70&&pitch.clarity>=0.78){
            VowelSpectrum.Result vowel=VowelSpectrum.analyze(samples,rate);
            if(vowel.f1<=0||vowel.f2<=0||vowel.fit<0.20)return NONE;
            String ipa=vowel.english;
            return new Result(ipa,englishExamples(ipa),
                pinyinExamples(vowel.mandarin),"vowel_formants",
                "F1/F2 频谱近邻，只是元音候选。说话人的声道、音高、连读都可能使匹配错误；"+
                "拼音例子只供对照，不代表识别出汉字、声母或声调。",
                vowel.f1,vowel.f2,vowel.fit);
        }

        // Only unvoiced segments with sufficiently strong high-frequency noise.
        // This cannot distinguish all fricatives (e.g. /θ/ vs /f/) reliably.
        if(pitch.hz>0)return NONE;
        int n=Math.min(2048,samples.length);
        double level=0,zeroCrossings=0;
        for(int i=0;i<n;i++){
            double x=samples[i]/32768.0;
            level+=x*x;
            if(i>0&&((samples[i]<0)!=(samples[i-1]<0)))
                zeroCrossings++;
        }
        double zcr=zeroCrossings/n;
        if(level/n<0.00005||zcr<0.12)return NONE;

        double[] re=new double[n],im=new double[n];
        for(int i=0;i<n;i++){
            double signal=samples[i]/32768.0;
            re[i]=signal*(0.5-0.5*Math.cos(2*Math.PI*i/(n-1)));
        }
        fft(re,im);
        double energy=0,weighted=0,highEnergy=0;
        for(int i=2;i<n/2;i++){
            double hz=(double)i*rate/n;
            if(hz<1000||hz>7600)continue;
            double power=re[i]*re[i]+im[i]*im[i];
            weighted+=hz*power;energy+=power;
            if(hz>=3500)highEnergy+=power;
        }
        if(energy<1e-5)return NONE;
        double centroid=weighted/energy;
        double highRatio=highEnergy/energy;
        if(highRatio<0.25)return NONE;
        if(centroid>=4400&&zcr>0.23){
            return new Result("/s/ 类","see、sit、sun",
                "s：sī (思)、sān (三)","fricative_spectral",
                "高频清擦音线索；无法仅凭此区分英语 /s/ 与普通话 s、x 等。"+
                "不等于完整辅音音素识别。",0,0,Math.min(0.75,highRatio));
        }
        if(centroid>=2300&&centroid<4700){
            return new Result("/ʃ/ 类","she、ship、shoe",
                "sh：shī (诗)；x：xī (西)，与英语 /ʃ/ 不同",
                "fricative_spectral",
                "摩擦噪声偏中频，可能接近 /ʃ/，也可能是 /ʂ/ 或 /ɕ/；"+
                "这个粗分类不应作为发音正确与否的判断。",0,0,0.4);
        }
        return NONE;
    }

    private static String englishExamples(String ipa){
        switch(ipa){
            case "/i/":return "see、sheep、beat";
            case "/ɪ/":return "sit、ship、bit";
            case "/e/":return "day、say（通常为双元音 /eɪ/）";
            case "/ɛ/":return "bed、red、head";
            case "/æ/":return "cat、bad、man";
            case "/ɑ/":return "father、hot（美音）";
            case "/ɔ/":return "saw、talk（口音差异大）";
            case "/u/":return "food、blue、moon";
            case "/ʊ/":return "book、good、foot";
            case "/ə/":return "about、sofa（弱读）";
            default:return "—";
        }
    }
    private static String pinyinExamples(String pinyin){
        switch(pinyin){
            case "i":return "i：yī (衣)、nǐ (你)（不一定等同英语元音）";
            case "ü":return "ü：yú (鱼)、lǜ (绿)";
            case "a":return "a：mā (妈)、dà (大)";
            case "o":return "o：bō (波)、wǒ (我)（韵母受上下文影响）";
            case "e":return "e：gē (哥)、hē (喝)";
            case "u":return "u：wū (屋)、lù (路)";
            default:return "—";
        }
    }

    private static void fft(double[] re,double[] im){
        int n=re.length,j=0;
        for(int i=1;i<n;i++){
            int bit=n>>>1;
            while((j&bit)!=0){j^=bit;bit>>=1;}
            j^=bit;
            if(i<j){
                double t=re[i];re[i]=re[j];re[j]=t;
                t=im[i];im[i]=im[j];im[j]=t;
            }
        }
        for(int len=2;len<=n;len<<=1){
            double angle=-2*Math.PI/len;
            double cr=Math.cos(angle),ci=Math.sin(angle);
            for(int i=0;i<n;i+=len){
                double wr=1,wi=0;
                for(int k=0;k<len/2;k++){
                    int a=i+k,b=a+len/2;
                    double vr=wr*re[b]-wi*im[b];
                    double vi=wr*im[b]+wi*re[b];
                    re[b]=re[a]-vr;im[b]=im[a]-vi;
                    re[a]+=vr;im[a]+=vi;
                    double nextR=wr*cr-wi*ci;
                    wi=wr*ci+wi*cr;wr=nextR;
                }
            }
        }
    }
}

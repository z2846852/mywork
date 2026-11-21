package com.z2846852.bodytrace;

import java.util.Random;

/** Deterministic audio DSP smoke tests, no Android/device dependencies. */
public final class VoiceLabDspTest {
    private static void check(boolean ok,String reason){
        if(!ok)throw new AssertionError(reason);
    }
    private static short[] sine(double freq,double level){
        int rate=16000;
        short[] wave=new short[4096];
        for(int i=0;i<wave.length;i++)
            wave[i]=(short)Math.round(level*Math.sin(2*Math.PI*freq*i/rate));
        return wave;
    }
    public static void main(String[] args){
        for(double freq:new double[]{110,220,330,440,659.25,880}){
            PitchDetector.Result r=PitchDetector.analyze(sine(freq,12000),16000);
            check(r.hz>0,"No pitch for "+freq);
            check(Math.abs(r.hz-freq)<freq*0.022,
                "Pitch "+freq+" was "+r.hz);
            check(r.clarity>0.70,"Unexpected pitch clarity "+freq);
        }
        PitchDetector.Result a=PitchDetector.analyze(sine(440,12000),16000);
        check("A4".equals(a.note()),"440Hz must be A4, got "+a.note());
        check(Math.abs(a.cents())<3,"440Hz must have 0 cents offset");
        PitchDetector.Result tooQuiet=PitchDetector.analyze(new short[4096],16000);
        check(tooQuiet.hz==0,"Silent mic must not hallucinate a note");
        PhonemeProbe.Result phoneme=PhonemeProbe.analyze(new short[4096],
            16000,tooQuiet);
        check("—".equals(phoneme.ipa)&&"—".equals(phoneme.englishWords),
            "Silence must not hallucinate IPA or English words");
        VowelSpectrum.Result spectral=VowelSpectrum.analyze(new short[4096],16000);
        check(spectral.f1==0&&spectral.f2==0,
            "Silence must not produce formants");
        // A pure sine has pitch, but needn't match any vowel prototype:
        // no test pretends that YIN is a pronunciation assessment system.
        System.out.println("VoiceLabDspTest passed: YIN pitches, cents, "
            +"silence and no synthetic phoneme claims");
    }
}

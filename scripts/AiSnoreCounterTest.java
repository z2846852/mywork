package com.z2846852.bodytrace;
public final class AiSnoreCounterTest {
    static int checks;
    static void check(boolean ok,String name){checks++;if(!ok)throw new AssertionError(name);}
    static void feed(AiSnoreCounter c,double... scores){for(int i=0;i<scores.length;i++)c.update(i,true,scores[i],.5);}
    static void quiet(AiSnoreCounter c,int from,int to,int decay){for(int i=from;i<=to;i++)c.update(i,true,.01,.5,decay);}
    public static void main(String[] args){
        AiSnoreCounter c=new AiSnoreCounter();
        feed(c,0,0,0,0,0,0,0,0,.59,.08,.015,0,.74,.34,.055,.10,.58,.918);
        check(c.count()==3&&!c.ready(4),"screenshot replay = 3");
        c.update(18,true,.03,.5);c.update(19,true,.7,.5);
        check(c.count()==4&&c.ready(4),"fourth triggers");c.consume();
        c.update(20,true,.95,.5);check(c.count()==0&&c.secondsToDecay()==0,"consume preserves latch");
        c.update(21,true,.03,.5);c.update(22,true,.55,.5);check(c.count()==1,"new event after valley");
        c.reset();feed(c,.01,.03,.09,.2,.34,.01,.08,.15,.22,.04);check(c.count()==0,"low-score breathing");
        c.reset();feed(c,.9,.6,.7,.4,.9,.2,.51,.8);check(c.count()==1,"continuous high score counts once");
        c.reset();feed(c,.7,.01,.7,.01,.7);check(c.count()==3&&c.secondsToDecay()==20,"new event resets timer");
        quiet(c,5,23,20);check(c.count()==3&&c.secondsToDecay()==1,"19 seconds no decay");
        quiet(c,24,24,20);check(c.count()==2&&c.secondsToDecay()==20,"20 seconds one decay");
        quiet(c,25,44,20);check(c.count()==1,"40 seconds two decay");
        quiet(c,45,64,20);check(c.count()==0&&c.secondsToDecay()==0,"60 seconds clear");
        quiet(c,65,100,20);check(c.count()==0,"never negative");
        c.reset();feed(c,.7,.01,.7,.01,.7);quiet(c,5,23,20);c.update(24,true,.8,.5);check(c.count()==3&&!c.ready(4),"decay then increment at exact boundary");
        c.reset();feed(c,.7,.01,.7,.01,.7);quiet(c,5,15,20);c.update(16,true,.01,.5,5);check(c.count()==1&&c.secondsToDecay()==3,"shorten interval applies elapsed decay");
        c.update(17,true,.01,.5,60);check(c.count()==1&&c.secondsToDecay()==57,"lengthen interval without restoring expired count");
        c.reset();for(int i=0;i<=180;i++)c.update(i,true,i%60==0?.7:.02,.5);check(c.count()==1&&!c.ready(4),"minute spaced errors do not accumulate");
        c.reset();feed(c,.55,.1,.56,.1,.57,.1,.58);check(c.count()==4&&c.ready(4),"four close peaks");
        c.reset();c.update(0,true,.8,.5);c.update(1,false,0,.5);c.update(2,true,.9,.5);check(c.count()==1,"muted gap not a valley");
        c.update(3,true,.03,.5);c.update(4,true,.8,.5);check(c.count()==2,"valid valley rearms");
        c.update(4,true,.01,.5);c.update(5,true,.9,.5);check(c.count()==2,"duplicate timestamp ignored");
        c.update(44,true,.9,.5);check(c.count()==0&&!c.ready(4),"gap decays but does not rearm");
        c.reset();feed(c,.8,.1,.8,.1,.8,.1,.8);check(c.ready(4),"frequent false positives remain possible");
        check(AiSnoreCounter.clampDecay(0)==5&&AiSnoreCounter.clampDecay(99)==60,"settings bounds");
        c.reset();c.update(0,true,.8,.5,5);quiet(c,1,5,5);check(c.count()==0,"five second setting");
        c.reset();c.update(0,true,.8,.5,60);quiet(c,1,59,60);check(c.count()==1&&c.secondsToDecay()==1,"60 second setting");quiet(c,60,60,60);check(c.count()==0,"60 second boundary");
        System.out.println("AiSnoreCounter: "+checks+" assertions passed");
    }
}

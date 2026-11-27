package com.z2846852.bodytrace;
public final class AiSnoreCounterTest {
    static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);}
    static void feed(AiSnoreCounter c,double... scores){for(int i=0;i<scores.length;i++)c.update(i,true,scores[i],.5);}
    public static void main(String[] args){
        AiSnoreCounter c=new AiSnoreCounter();
        // Approximate points read from the user's screenshot, not raw audio.
        feed(c,0,0,0,0,0,0,0,0,.59,.08,.015,0,.74,.34,.055,.10,.58,.918);
        check(c.count()==3&&!c.ready(4),"screenshot replay = 3");
        c.update(18,true,.03,.5);c.update(19,true,.7,.5);
        check(c.count()==4&&c.ready(4),"fourth triggers");c.consume();
        c.update(20,true,.95,.5);check(c.count()==0,"consume preserves latch");
        c.update(21,true,.03,.5);c.update(22,true,.55,.5);check(c.count()==1,"new event after valley");
        c.reset();feed(c,.01,.03,.09,.2,.34,.01,.08,.15,.22,.04);check(c.count()==0,"simulated low-score breathing");
        c.reset();feed(c,.9,.6,.7,.4,.9,.2,.51,.8);check(c.count()==1,"long snore and midband jitter");
        c.reset();feed(c,.55,.1,.56,.1,.57,.1,.58);check(c.count()==4&&c.ready(4),"four separate moderate peaks");
        c.reset();for(int i=0;i<=180;i++)c.update(i,true,i%60==0?.7:.02,.5);check(c.count()==4&&c.ready(4),"minute spaced events");
        for(int i=181;i<=480;i++)c.update(i,true,.01,.5);check(c.count()==0,"five minute expiry");
        c.reset();c.update(0,true,.8,.5);c.update(1,false,0,.5);c.update(2,true,.9,.5);check(c.count()==1,"muted gap not a valley");c.update(3,true,.03,.5);c.update(4,true,.8,.5);check(c.count()==2,"valid valley rearms");
        c.update(4,true,.01,.5);c.update(5,true,.9,.5);check(c.count()==2,"duplicate timestamp ignored");
        c.reset();c.update(0,true,.8,.5);c.update(3,true,.9,.5);check(c.count()==1,"missing windows not valleys");
        c.reset();feed(c,.8,.1,.8,.1,.8,.1,.8);check(c.ready(4),"high scoring false positives remain possible");
        System.out.println("AiSnoreCounter: 14 assertions passed; screenshot 3, fourth triggers; low-score breathing 0; high-score false positives remain possible");
    }
}

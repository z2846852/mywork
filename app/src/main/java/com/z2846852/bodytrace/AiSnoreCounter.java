package com.z2846852.bodytrace;
/** One event per AI score excursion; leaky count independent of microphone amplitude. */
final class AiSnoreCounter {
    static final int DEFAULT_DECAY_SECONDS=20;
    private int count,decay=DEFAULT_DECAY_SECONDS;
    private long last=Long.MIN_VALUE,lastEvent=Long.MIN_VALUE,decayAnchor=Long.MIN_VALUE;
    private boolean active,needLow;
    static double exit(double enter){return Math.min(.15,enter*.5);}
    static int clampDecay(int seconds){return Math.max(5,Math.min(60,seconds));}
    void reset(){count=0;last=lastEvent=decayAnchor=Long.MIN_VALUE;active=needLow=false;}
    void update(long second,boolean valid,double score,double enter){update(second,valid,score,enter,DEFAULT_DECAY_SECONDS);}
    void update(long second,boolean valid,double score,double enter,int decaySeconds){
        if(last!=Long.MIN_VALUE&&second<=last)return;
        if(last!=Long.MIN_VALUE&&second!=last+1)needLow=true;
        last=second;decay=clampDecay(decaySeconds);
        if(count>0){
            long steps=(second-decayAnchor)/decay;
            if(steps>0){count-= (int)Math.min(count,steps);decayAnchor+=steps*decay;}
        }
        if(!valid||!Double.isFinite(score)){needLow=true;return;}
        if(score<=exit(enter)){active=needLow=false;return;}
        if(!needLow&&!active&&score>=enter){active=true;count++;lastEvent=decayAnchor=second;}
    }
    int count(){return count;}
    int secondsToDecay(){return count==0?0:(int)Math.max(0,decay-(last-decayAnchor));}
    boolean active(){return active;}
    boolean waitingForLow(){return needLow;}
    int confirmedInSecond(long second){return count>0&&lastEvent==second?1:0;}
    boolean ready(int required){return count>=Math.max(3,required)&&last-lastEvent<2;}
    void consume(){count=0;lastEvent=decayAnchor=Long.MIN_VALUE;} // preserve latch
}

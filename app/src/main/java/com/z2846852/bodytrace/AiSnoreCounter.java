package com.z2846852.bodytrace;
/** One event per AI score excursion; independent of microphone amplitude. */
final class AiSnoreCounter {
    static final int WINDOW_SECONDS=300;
    private final java.util.ArrayDeque<Long> events=new java.util.ArrayDeque<>();
    private long last=Long.MIN_VALUE;
    private boolean active,needLow;
    static double exit(double enter){return Math.min(.15,enter*.5);}
    void reset(){events.clear();last=Long.MIN_VALUE;active=needLow=false;}
    void update(long second,boolean valid,double score,double enter){
        if(last!=Long.MIN_VALUE&&second<=last)return;
        if(last!=Long.MIN_VALUE&&second!=last+1)needLow=true;
        last=second;
        while(!events.isEmpty()&&second-events.peekFirst()>=WINDOW_SECONDS)events.removeFirst();
        if(!valid||!Double.isFinite(score)){needLow=true;return;}
        if(score<=exit(enter)){active=needLow=false;return;}
        if(!needLow&&!active&&score>=enter){active=true;events.addLast(second);}
    }
    int count(){return events.size();}
    boolean active(){return active;}
    boolean waitingForLow(){return needLow;}
    int confirmedInSecond(long second){return !events.isEmpty()&&events.peekLast()==second?1:0;}
    boolean ready(int required){return events.size()>=Math.max(3,required)&&last-events.peekLast()<2;}
    void consume(){events.clear();} // preserve latch; sustained snore is not a new event
}

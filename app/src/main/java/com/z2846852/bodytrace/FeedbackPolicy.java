package com.z2846852.bodytrace;
/** Pure policy shared by runtime and host regression test. */
final class FeedbackPolicy {
    private FeedbackPolicy(){}
    static int lowerLimit(int prior,int rejected){return Math.max(0,Math.min(prior,rejected-1));}
    static int cap(int proposed,int user,int learned){return Math.max(0,Math.min(proposed,Math.min(user,learned)));}
    static boolean canStart(boolean sound,boolean vibration,int n,int max,long now,long lastEnd,long elapsed,long delay){
        return (sound||vibration)&&n<max&&now-lastEnd>=60000&&elapsed>=delay;
    }
    static int coarse(int upper,int stage){return Math.max(1,upper*(Math.min(2,Math.max(0,stage))+1)/3);}
    static boolean reduced(int valid,int hits){return valid>=30&&hits<=3;}
}